# 每日数据同步（/daily-sync）

## 触发模式

用户说"XX 文件已更新，请 ETL 到 VPS"或类似，立即进入此 SOP。

## 0. 源文件识别与拷贝

**iCloud 默认路径**：`/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/`

**文件编号对应数据域**（`数据管理/data-sources.json` 为唯一事实源）：

| 编号 | 文件名模式 | 数据域 | 处理器 |
|------|-----------|--------|--------|
| 01 | `01_签单清单_增量_YYYYMMDD.xlsx` / `01_签单清单_剔摩_*.xlsx` | 保费 | daily.mjs premium |

> **铁律**：`current/` 不得出现**裸名主分片 + 限摩**组合（如 `01_签单清单_20230101_20241231.parquet` + `01_签单清单_限摩_*.parquet`）。裸名主分片含全险种（含摩托），限摩单独存在会让摩托数据 UNION ALL 翻倍。互补豁免仅对 `_剔摩_` ↔ `_限摩_` 成对生效。门禁在 `daily.mjs`/`sync-vps.mjs`/`check-governance.mjs` 三处由 `scripts/lib/parquet-overlap-check.mjs` 共享拦截。
| 02 | `02_理赔明细_*.xlsx` | 赔案 | daily.mjs claims_detail（CDC）|
| 03 | `03_交叉销售_*.xlsx` | 交叉销售 | daily.mjs cross_sell |
| 04 | `04_报价清单*.xlsx` | 报价 | daily.mjs quotes |
| 05 | `05_续保清单_*.xlsx` | 续保 | daily.mjs renewal |
| 07 | `07_维修资源*.xlsx` | 维修资源 | daily.mjs repair |
| 08 | `08_客户来源去向*.xlsx` | 客户来源 | daily.mjs customer_flow |

**拷贝到 ETL 入口**（daily.mjs 从 `数据管理/` 根目录扫描）：

```bash
cp "/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/<file1>.xlsx" \
   "/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/<file2>.xlsx" \
   数据管理/
```

多个增量 xlsx 可共存（如 `01_签单清单_增量_20260415.xlsx` + `01_签单清单_增量_20260416.xlsx`），daily.mjs 会按日期合并，**不要删除旧增量**。

## 1. 运行全流程（推荐）

```bash
node scripts/sync-and-reload.mjs        # daily.mjs all → governance → PM2 reload → /health
node scripts/sync-and-reload.mjs premium  # 仅保费域
node scripts/sync-and-reload.mjs --dry-run  # 仅打印计划
```

任一阶段失败立即退出，不进入后续阶段。

## 1.5 仅 ETL（不上线，调试场景）

```bash
node 数据管理/daily.mjs all              # 跑全部域
node 数据管理/daily.mjs premium          # 仅保费域
```

**daily.mjs 单一职责**：
- 智能检测哪些域需更新（根据新 xlsx）
- 转换 Parquet 到 `数据管理/warehouse/fact/*/` 和 `dim/*/`
- 末尾调用 `sync-vps.mjs --no-restart`（同步 13 个目录，**不重启 PM2**）
- 写 `.last-sync-manifest.json`（governance 数据漂移检查依据）

## 2. 手动重启 PM2（仅当用 1.5 单跑 daily.mjs 时）

```bash
ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api reload"
```

- 禁止只 `restart`——CLAUDE.md §9 明确 `reload` 能避免 errored 残留
- deployer 用户无 sudo 免密，必须通过 `/usr/local/bin/deploy-chexian-api` 包装
- 重启后 PM2 `online` + uptime 从 0 重新计时即成功

## 3. 验证（双重）

**本地 Parquet**（确认数据正确写入）：

```bash
python3 -c "
import duckdb
con = duckdb.connect()
print('policy max:', con.execute(\"SELECT MAX(policy_date) FROM read_parquet('数据管理/warehouse/fact/policy/current/*.parquet')\").fetchone())
print('claims max:', con.execute(\"SELECT MAX(report_time) FROM read_parquet('数据管理/warehouse/fact/claims_detail/*.parquet')\").fetchone())
"
```

**字段名速查**（常错）：
- 保单日期：`policy_date`（非 `保单起期`/`policy_start_date`）
- 赔案报案：`report_time`（非 `报案日期`）
- 保险起期：`insurance_start_date`
- 所有英文字段定义见 `server/src/config/field-registry/fields.json`

**线上服务**（确认 PM2 重启生效）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://chexian.cretvalu.com/health
# 期望 200
```

## 3.5 生成多年保单赔付发展报告（可选）

ETL 完成、数据校验通过后，可选择重生成 diagnose-loss-development v2.1 报告
（1 主页 + 75 副维度归因子页），自动部署到 `chexian.cretvalu.com/api/reports/`。

```bash
# 步骤 A：本地生成报告到 server/data/reports/diagnose-loss-development/<cutoff>/
python3 ~/.claude/skills/diagnose-loss-development/lib/cli.py \
  --cutoff $(date +%F) \
  --project-root "$(pwd)" \
  --deploy
# 输出末尾会打印生产 URL（约 2 分钟，含 75 子页生成）

# 步骤 B：rsync 同步到 VPS（与 Step 2 的 sync-vps 合并执行，--no-delete 累积历史快照）
node scripts/sync-vps.mjs

# 步骤 C：推送企微通知（v2.2 自动化前，先手动调用）
# 主页 URL：https://chexian.cretvalu.com/api/reports/diagnose-loss-development/<cutoff>/preview-mvp.html
# 临时方案：在企微群发消息 + 粘贴 URL
# 正式方案：v2.2 在 push_html.py 加 --external-url 参数支持多文件报告
```

**验证清单**：

- [ ] cli.py 输出含 `[OK] 部署 URL: https://chexian.cretvalu.com/api/reports/...`
- [ ] curl 主页（带 admin cookie）返回 200 + HTML
- [ ] curl 子页（含 `drill/team/<hash>.html`）返回 200
- [ ] 浏览器打开主页 → 点维度值 → 跳转下钻子页 → 返回主页正常

## 4. 故障排查

| 症状 | 根因 | 修复 |
|------|------|------|
| rsync 单目录失败（红色 CRITICAL） | 并行 rsync 网络抖动 | 手动重跑 `node scripts/sync-vps.mjs` 或单独 `rsync -azv --delete -e ssh <local>/ chexian-vps-deploy:<remote>/` |
| PM2 `errored` 状态 | 进程崩溃 | 先 `describe` 看日志，再 `reload`（非 `restart`） |
| 本地 max 日期 ≠ 文件名日期 | 上游导出时点问题（非 ETL bug） | 例：`02_理赔明细_报案时间20260416.xlsx` 实际 max(report_time)=20260415 — 需跟用户确认 |
| governance `.last-sync-manifest.json` 不一致 | sync-vps 部分 critical 目录失败 → 未写 manifest | 先修 rsync 失败的单目录，再重跑 sync-vps |

## 5. 汇报模板

```
| 环节 | 结果 |
|------|------|
| 源文件 iCloud → 数据管理/ | ✅ <N> 个 xlsx |
| daily.mjs ETL | ✅ <域列表> |
| rsync → VPS | ✅ <N> 目录 / 清单 <N> 文件 |
| PM2 reload | ✅ uptime <s>s |
| /health | ✅ 200 |
| 本地数据校验 | 保单 max=YYYY-MM-DD / 赔案 max=YYYY-MM-DD |
```

如日期与预期不符，标 ⚠️ 并说明可能原因，等用户确认。
