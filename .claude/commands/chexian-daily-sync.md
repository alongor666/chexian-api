---
name: chexian-daily-sync
description: 当用户说"XX 文件已更新，请 ETL 到 VPS"或需要执行每日数据同步时使用 — 完成 iCloud xlsx 拷贝、daily.mjs ETL、rsync 同步、PM2 reload 及双重健康验证的全链路 SOP。
category: data-pipeline
scope: project
---

# 每日数据同步（/chexian-daily-sync）

## 触发模式

用户说"XX 文件已更新，请 ETL 到 VPS"或类似，立即进入此 SOP。

## 0. 源文件获取（主链路：VPS auto_loadbi 自动拉取，2026-07-04 起替代 iCloud 手动源）

**主链路（默认）**：上游五张表由 VPS 定时导出到 `myvps:/root/workspace/auto_loadbi/exports/`，
唯一契约 = 目录内 `latest-manifest.json`（按 code 取当前份，文件名日期后缀每天变，禁止硬编文件名）。

```bash
node scripts/pull-bi-exports.mjs        # rsync → 数据管理/inbox/ → manifest 校验 → 分发 ETL 源目录
node scripts/pull-bi-exports.mjs --dry-run   # 只看计划
```

- `bun run release:daily`（sync-and-reload.mjs）已内置为 Stage 0 自动执行，无需单独跑；`--skip-pull` 可跳过
- 校验四件套：5 code 齐全 / 本地字节=manifest / **mtime=北京时间今天**（本机时钟不在北京时区，禁止本地日期直比）/ sizeMB 兜空表；任一不过 = 上游断线，**告警中止，禁止默默用旧数据**
- 省份路由：文件名 `shanxi_`/`sichuan_` 前缀只是导出配置标签（不自动跟登录账号），分发前会抽样 01 签单保单号前缀（fields.json `branch_code.derivation.mapping`）做内容核验，错配即中止；`shanxi_*` → `数据管理/staging/SX/`，`sichuan_*`/无前缀（含 04 厂牌全国口径）→ `数据管理/` 根
- 出表时机：北京时间约 09:30 出 01/03/04/05，10:30 出 02 报价；**五张齐全须 10:35 之后拉**
- 分发时自动做区间覆盖归档（同品类旧短窗 → `.xlsx-archive/<日期>/`），02 报价单日文件逐日累积不归档

**Legacy 兜底（iCloud 手动源，仅上游断线时应急）**：`/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/`，手动拷贝到 `数据管理/`（SC）或 `数据管理/staging/SX/`（SX）后按 §1 跑 ETL。

**文件编号对应数据域**（2026-06-10 上游 BI 清单重构后的**新编号体系**；运行时唯一事实源 = daily.mjs 硬编码 glob（premium/claims_detail）+ `数据管理/data-sources.json` 的 `trigger.input_globs`（其余域），文档对照块 = `数据管理/shard-config.json` 的 `source_patterns`；本表与三者保持同步）：

| 新编号 | 文件名模式（新基线为主 · legacy 兼容） | 数据域 | 处理器 |
|------|-----------|--------|--------|
| 01 | `YYYYMMDD-YYYYMMDD_01_签单清单_定稿.xlsx`（**新基线**，日期范围前缀） · legacy：`01_签单清单_*.xlsx`（含 `_剔摩_`/`_限摩_` 成对） / `????????_01_签单清单*.xlsx` / `每日数据_*.xlsx` | 保费 | daily.mjs premium |
| 02 | `YYYYMMDD_02_报价清单_商业险.xlsx`（**新**，旧编号 04） · legacy：`04_报价清单*.xlsx` / `????????_04_报价清单*.xlsx`（报价历史未重导，旧文件仍活跃） | 报价 | daily.mjs quotes（输出 `fact/quotes_conversion/latest.parquet`） |
| 03 | `YYYYMMDD-YYYYMMDD_03_维修资源.xlsx`（**新**，旧编号 07，日期范围前缀） · legacy：`07_维修资源*.xlsx` / `????????_07_维修资源*.xlsx` | 维修资源 | daily.mjs repair（**dim 表**`dim/repair/latest.parquet`） |
| 04 | `YYYYMMDD_04_厂牌明细.xlsx`（**新**，旧编号 06） · legacy：`06_厂牌明细*.xlsx` / `????????_06_厂牌明细*.xlsx` | 厂牌（品牌车型） | daily.mjs brand（**dim 表**`dim/brand/latest.parquet`） |
| 05 | `YYYYMMDD-YYYYMMDD_05_理赔明细.xlsx`（**新基线**，旧编号 02，日期范围前缀；全量替换，CDC） · legacy：`02_理赔明细_报案时间YYYYMMDD_YYYYMMDD.xlsx` / `????????_02_理赔明细*.xlsx` / `车险报立结案清单_*.xlsx` | 赔案 | daily.mjs claims_detail |
| 新能源 | `YYYYMMDD_新能源_出险信息表.xlsx`（编号体系外，不变） | 新能源出险 | daily.mjs new_energy_claims |

**停更域**（2026-06-10 上游停止下载，域冻结：存量 parquet 继续服务，不再有新 xlsx 输入）：

| 旧编号 | 文件名模式（仅识别历史文件用） | 数据域 | 状态 |
|------|-----------|--------|------|
| 03（旧） | `03_交叉销售_*.xlsx` / `????????_03_交叉销售*.xlsx` | 交叉销售 | 停更冻结（勿与**新 03 = 维修资源**混淆） |
| 08/09（旧） | `????????_08_商业险续保流失公司.xlsx` + `????????_09_商业险转保上年公司.xlsx`（必须同 batch） | 客户来源 | 停更冻结 |

注：renewal_tracker 是派生域（JOIN policy+quotes+salesman），无独立 xlsx 输入；输出 `fact/renewal_tracker/latest.parquet`。旧编号 05 `05_续保清单_*` 早已废弃——**勿与新 05_理赔明细混淆**。

> **命名识别铁律**（2026-06-10 编号重排后）：识别文件必须用「编号 + 中文名」整体匹配，**禁止只看编号**——新旧编号互相撞车：理赔 02→05、报价 04→02、维修 07→03、厂牌 06→04（即旧 02=理赔 vs 新 02=报价；旧 03=交叉销售 vs 新 03=维修；旧 04=报价 vs 新 04=厂牌；旧 05=续保清单 vs 新 05=理赔）。新基线前缀两种：签单/理赔/维修用 `YYYYMMDD-YYYYMMDD_`（日期范围），报价/厂牌用 `YYYYMMDD_`（单日期）。各域 glob 同时挂新旧多套模式（legacy 向后兼容，旧命名文件仍被接受）。`customer_flow`（已停更）/ `new_energy_claims` 仅认 `????????_` 前缀格式（`required_same_batch: true`）。
>
> **待定**：上游每日增量的实际命名尚未观察到首个样本（如是否按滚动长窗 `20260601-<最新>_01_签单清单_定稿.xlsx` 持续重导）。daily.mjs 已内置范围重叠自动归档护栏（新全量覆盖旧短窗时自动归档旧文件）；首个样本落地后回填本表。

> **互补豁免铁律**：`current/` 不得出现**裸名主分片 + 限摩**组合（如 `01_签单清单_20230101_20241231.parquet` + `01_签单清单_限摩_*.parquet`）。裸名主分片含全险种（含摩托），限摩单独存在会让摩托数据 UNION ALL 翻倍。互补豁免仅对 `_剔摩_` ↔ `_限摩_` 成对生效。门禁在 `daily.mjs`/`sync-vps.mjs`/`check-governance.mjs` 三处由 `scripts/lib/parquet-overlap-check.mjs` 共享拦截。

**拷贝到 ETL 入口**（daily.mjs 从 `数据管理/` 根目录扫描）：

```bash
cp "/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/<file1>.xlsx" \
   "/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/<file2>.xlsx" \
   数据管理/
```

多个增量 xlsx 可共存（如新基线 `20260101-20260608_01_签单清单_定稿.xlsx` + 旧增量 `20260607_01_签单清单.xlsx`），daily.mjs 会按日期合并，且新全量覆盖旧短窗时自动归档旧文件，**不要手动删除旧增量**。

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

- `reload` = `pm2 delete + pm2 start`（wrapper:126-132），用于**重读 `ecosystem.config.cjs` 中的 env**；有 1-3 秒停机窗口，每次都触发 bcrypt 等原生模块 cold load（参见 memory `project_vps_bcrypt_reload_landmine.md`）
- `restart` 零停机但**不重读 env**——只是热重启代码用 restart；改了 env 必须 reload
- deployer 用户无 sudo 免密，必须通过 `/usr/local/bin/deploy-chexian-api` 包装
- 重启后 PM2 `online` + uptime 从 0 重新计时即成功

## 3. 验证（双重）

**本地 Parquet**（8 域真实路径与日期列；路径不能猜，全部从这张表取）：

| 域 | parquet glob | 日期列 |
|----|-------------|--------|
| policy | `数据管理/warehouse/fact/policy/current/*.parquet` | `policy_date` |
| claims_detail | `数据管理/warehouse/fact/claims_detail/**/*.parquet` | `report_time` |
| cross_sell | `数据管理/warehouse/fact/cross_sell/latest.parquet`（停更冻结，存量服务） | `policy_date` |
| quotes_conversion | `数据管理/warehouse/fact/quotes_conversion/latest.parquet` | `quote_time` |
| renewal_tracker | `数据管理/warehouse/fact/renewal_tracker/latest.parquet` | — (派生域，按 quote/policy 对齐) |
| repair | `数据管理/warehouse/dim/repair/latest.parquet` | (dim 表，看 report_date) |
| customer_flow | `数据管理/warehouse/fact/customer_flow/latest.parquet`（停更冻结，存量服务） | `insurance_start_date`（含未来到期日，正常） |
| new_energy_claims | `数据管理/warehouse/fact/new_energy_claims/latest.parquet` | `report_time` |

一键 8 域校验脚本：

```bash
python3 - <<'PY'
import duckdb, glob
con = duckdb.connect()
for label, pat, col in [
    ('policy',            '数据管理/warehouse/fact/policy/current/*.parquet',           'policy_date'),
    ('claims_detail',     '数据管理/warehouse/fact/claims_detail/**/*.parquet',         'report_time'),
    ('cross_sell',        '数据管理/warehouse/fact/cross_sell/latest.parquet',          'policy_date'),
    ('quotes_conversion', '数据管理/warehouse/fact/quotes_conversion/latest.parquet',   'quote_time'),
    ('repair',            '数据管理/warehouse/dim/repair/latest.parquet',               None),
    ('customer_flow',     '数据管理/warehouse/fact/customer_flow/latest.parquet',       'insurance_start_date'),
    ('new_energy_claims', '数据管理/warehouse/fact/new_energy_claims/latest.parquet',   'report_time'),
    ('renewal_tracker',   '数据管理/warehouse/fact/renewal_tracker/latest.parquet',     None),
]:
    files = glob.glob(pat, recursive=True)
    if not files:
        print(f'{label:20} ❌ no parquet'); continue
    cnt = con.execute(f"SELECT COUNT(*) FROM read_parquet('{pat}', union_by_name=true)").fetchone()[0]
    if col:
        mx = con.execute(f"SELECT MAX({col}) FROM read_parquet('{pat}', union_by_name=true)").fetchone()[0]
        print(f'{label:20} files={len(files):3}  rows={cnt:>10,}  max({col})={mx}')
    else:
        print(f'{label:20} files={len(files):3}  rows={cnt:>10,}')
PY
```

**字段名速查**（常错）：
- 保单日期：`policy_date`（非 `保单起期`/`policy_start_date`）
- 赔案报案：`report_time`（非 `报案日期`）
- 保险起期：`insurance_start_date`
- 报价时点：`quote_time`
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

# 步骤 C：推送企微通知（v2.2.1 自动化，多文件报告走 --external-url 跳过 stage）
# 用专用 meta 文件让本报告独立成一张 smartsheet（首跑自动新建，之后追加行）
python3 数据管理/integrations/wecom_bot/push_html.py \
  --external-url "https://chexian.cretvalu.com/api/reports/diagnose-loss-development/$(date +%F)/preview-mvp.html" \
  --title "多年保单赔付发展报告 $(date +%F)" \
  --note "v2.1 主页 · 含 75 子页下钻 · cutoff $(date +%F)" \
  --meta 数据管理/integrations/wecom_bot/state/_loss_dev_meta.json \
  --name "chexian-api · 多年保单赔付发展报告"
# --external-url：跳过本地 stage，直接把链接写入企微智能表格「链接」列
# --meta：本报告独立 meta，与共享报告表（_html_push_meta.json）解耦，避免污染
# --name：首跑（meta 不存在）时用于建表的文档名；之后复用，--name 被忽略
# wecom-cli 鉴权失败（errcode 851003 "no authority"）须在企微 IP 白名单内出口跑（本地公网 IP 通常不在）
```

**验证清单**：

- [ ] cli.py 输出含 `[OK] 部署 URL: https://chexian.cretvalu.com/api/reports/...`
- [ ] curl 主页（带 admin cookie）返回 200 + HTML
- [ ] curl 子页（含 `drill/team/<hash>.html`）返回 200
- [ ] 浏览器打开主页 → 点维度值 → 跳转下钻子页 → 返回主页正常
- [ ] push_html.py --external-url 日志含 `[外链] 跳过 stage` + `[写入] 智能表格新行`，企微表格新增一行

## 3.6 企微（wecom）智能表格同步（精确命令）

> 唯一事实源 = `scripts/sync-and-reload.mjs:433-470` 的并行调度。日常推荐 `bun run release:daily`（=`sync-and-reload --wecom`）一气呵成。需手动单跑（避免再触发 ETL/reload）时用本节。

**三脚本参数互不相同，照抄即可**：

```bash
# 1) 三级机构续保追踪表（12 机构，update-only by record_id）
# 默认 = dry-run；execute 转正
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py            # dry-run（看 to_add/to_update/changed_premium_sum 计划）
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py --execute   # 真实推送
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py --execute --org 新都,资阳   # 只补几个机构

# 2) 5-7 月电销续保字段回填表（update-only 5 字段）
# 子命令必填；默认 = dry-run；execute 转正
python3 数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py sync           # dry-run
python3 数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py sync --execute # 真实
# 其他子命令：prime-state / inspect / seed-from-excel（首次/排障专用，见 wecom_smartsheet/README）

# 3) 邮政经代签单全量表（add-only）
# 用 --instance（不是 --config）；默认 = 真实推送；--dry-run 模拟
python3 数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py \
  --instance 数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml \
  --mode sync --dry-run   # 模拟（看 add_records_planned/new_dedup_vin_count）
python3 数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py \
  --instance 数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml \
  --mode sync             # 真实推送
```

**不重复 / 不遗漏判定**（dry-run 输出的关键字段）：
- 机构续保表 `preflight` 每行末尾 `合理性: ✓ to_add=0/X (0%)，state 状态健康` ✓ → 可直接 execute；若 `state.records_count ≠ source_rows` 或 `to_add` 占比 > 1% → 触发 [memory `feedback_wecom_no_row_duplication.md`] 红线，**先解 state 损坏再跑**
- may 表关注 `to_update` + `field_update_stats.field_counts`
- postal 表关注 `add_records_planned` / `new_dedup_vin_count` / `new_premium_sum`（add-only，state 中已有 VIN 不会再 add）

**并行执行**（三任务无依赖，可同时跑）：

```bash
python3 .../sync_org_renewal_from_xlsx.py --execute > /tmp/wecom_org.log 2>&1 &
python3 .../sync_may_renewal_fields.py sync --execute > /tmp/wecom_may.log 2>&1 &
python3 .../sync_filtered_policies.py --instance .../postal-policy-since-20260420.yaml --mode sync > /tmp/wecom_postal.log 2>&1 &
wait
# 三者退出码 0 + 各日志 grep -E 'errcode":\s*0|failed_count":\s*0' 全 0 即成功
```

## 4. 故障排查

| 症状 | 根因 | 修复 |
|------|------|------|
| rsync 单目录失败（红色 CRITICAL） | 并行 rsync 网络抖动 | 手动重跑 `node scripts/sync-vps.mjs` 或单独 `rsync -azv --delete -e ssh <local>/ chexian-vps-deploy:<remote>/` |
| PM2 `errored` 状态 | 进程崩溃 | 先 `describe` 看日志，再 `reload`（非 `restart`） |
| 本地 max 日期 ≠ 文件名日期 | 上游导出时点问题（非 ETL bug） | 例：`20210101-20260416_05_理赔明细.xlsx`（旧 `02_理赔明细_报案时间20260416.xlsx`）实际 max(report_time)=20260415 — 需跟用户确认 |
| governance `.last-sync-manifest.json` 不一致 | sync-vps 部分 critical 目录失败 → 未写 manifest | 先修 rsync 失败的单目录，再重跑 sync-vps |

## 5. 汇报模板

```
| 环节 | 结果 |
|------|------|
| 上游拉取 pull-bi-exports（VPS auto_loadbi） | ✅ 5/5 code · mtime=北京今天 · 省份核验一致 |
| daily.mjs ETL | ✅ <域列表> |
| rsync → VPS | ✅ <N> 目录 / 清单 <N> 文件 |
| PM2 reload | ✅ uptime <s>s |
| /health | ✅ 200 |
| 本地数据校验 | 保单 max=YYYY-MM-DD / 赔案 max=YYYY-MM-DD |
```

如日期与预期不符，标 ⚠️ 并说明可能原因，等用户确认。
