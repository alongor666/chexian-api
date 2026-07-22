---
paths: ["数据管理/**", "scripts/sync-vps.mjs", "scripts/**"]
---

# 数据管道与 VPS 规则

## VPS 分层数据架构（RED LINE - 2026-02-28 起强制执行）

> **背景**：VPS 4核4G，历史上原始 Parquet 在 VPS 聚合导致内存 800MB+、PM2 177次重启。

**黄金规则**：**禁止在 VPS 上查询原始 `PolicyFact` 构建新功能**（续保模块除外）

| 做什么 | 正确方式 |
|--------|----------|
| 新增仪表盘/趋势功能 | 在已有预聚合表（`DailyAggregated` / `PeriodAggregated` / `CrossSellDailyAgg`）上查询 |
| 新增分析维度 | 在 **Mac 本地** 用 `scripts/export-for-vps.mjs` 增加聚合维度 → 导出 → 推送 |
| 数据推送 VPS | 只推 `aggregated.parquet` + `renewal_slim.parquet`，禁止推原始数据 |
| 新增续保字段 | 修改 `renewal_slim.parquet` 导出定义，**不可**在查询时访问 PolicyFact 的其他字段 |

**续保 PolicyFact 最小字段集（不可扩展）**：
`policy_no`, `premium`, `salesman_name`, `org_level_3`, `customer_category`, `insurance_type`, `insurance_start_date`, `renewal_policy_no`

## 数据文件

| 文件 | 路径 | 用途 |
|------|------|------|
| 保单分片 | `数据管理/warehouse/fact/policy/current/*.parquet` | 主数据源（4 个分片） |
| 赔案明细 | `数据管理/warehouse/fact/claims_detail/claims_*.parquet` | 年度分区赔付数据源（ClaimsAgg 由服务端动态聚合） |
| 报价状态 | `数据管理/warehouse/fact/quotes/latest.parquet` | 报价数据 |
| 团队映射 | `数据管理/warehouse/dim/salesman_organization_mapping.json` | 业务员-团队-机构映射（回退） |
| 续保明细 | `数据管理/warehouse/fact/renewal/` | 续保数据 |

## 省份数据隔离（RED LINE - 2026-06-27 起，多省平台强制）

> 背景：平台已多省（四川 SC / 山西 SX）。同一 warehouse 目录混放多省 Parquet，裸 `*.parquet` glob 跨省混查且**静默不报错**。实证（2026-06-27 山西诊断 duckdb 直查）：裸 `current/*.parquet` 按 `branch_code` 聚合 = SC 261.6 万行 + SX 183.3 万行；同口径 2026 年至今净额，裸 glob 约 38.9 万件 / 32006 万元 vs SX 隔离 11.4 万件 / 9865 万元 —— **混查放大约 3.4 倍，且零报错**。

**权威隔离键 = `branch_code` 列**（ETL 按部署省份注入的常量列，值 `SC` / `SX`，由 `server/src/config/sql-federation-policy.ts` 的 `getDeploymentBranchCode()` 写入）。所有 Parquet 直查 / glob **必须** `WHERE branch_code = '<省份码>'`；文件名 glob 仅作缩小扫描范围的性能辅助，**不可单独依赖**（四川存在"无前缀 + `sichuan_`"两种文件名模式，glob 易漏）。

| 省份 | branch_code | 保单 glob（`fact/policy/current/`） | 赔案路径 |
|------|-------------|-------------------------------------|----------|
| 四川 SC | `'SC'` | `read_parquet(['[0-9]*.parquet','sichuan_*.parquet'])` | `fact/claims_detail/claims_*.parquet` |
| 山西 SX | `'SX'` | `read_parquet('SX_*.parquet')` | `validation/SX/claims_detail/claims_*.parquet` |

> ⚠️ DuckDB **不支持 brace 展开** `{a,b}`（实测 `IO Error: No files found`）；四川两类文件名必须用 `read_parquet([...])` **列表形式**，禁写 `{[0-9]*,sichuan_*}`。非数据文件（如 `schema-analysis.json`）天然不被 `*.parquet` glob 匹配。表中保单 glob 相对 `数据管理/warehouse/fact/policy/current/`、赔案相对 `数据管理/warehouse/`；直查须补全前缀（worktree 用主仓绝对路径）。

**禁止**：
- ❌ 裸 `current/*.parquet` 不带 `WHERE branch_code` 过滤（混查静默错误）
- ❌ 硬编码单省 / 默认四川 —— 技能、脚本、直查必须按 `--province` 显式解析省份
- ❌ 仅靠文件名前缀省去 `WHERE branch_code`（前缀是性能辅助，非隔离保证）

**fail-closed（未来新省份）**：`--province` 只接受**已注册**省份（当前 SC / SX）；遇未知省份、缺 glob 映射、缺 `branch_code` 时**必须报错中止**，禁止静默回落 `'SC'`。

**生产代码层省份解析**（区别于本规则覆盖的"查询 / 技能 / 直查层"）：见 `开发文档/reviews/2026-06-27-多省硬编码审计/` 工程一「省份解析 fail-closed」路线图（规划中：建 `resolveBranchCode()` 替换全栈 23 处 `?? 'SC'` 静默默认，当前**尚未落地**；现存 `getDeploymentBranchCode()` 负责写入 `branch_code` 列）。

**山西已上线（2026-07-07 生产 cutover · RLS-on）**：SX 生产 API 已按 token branchCode RLS 分租户返回山西数据。本地口径验证仍可 duckdb 直查 `SX_*.parquet`；worktree 无 Parquet（gitignored），须用主仓绝对路径 `/Users/<user>/.../chexian-api/数据管理/warehouse/...`。

## 数据加载流程

```bash
# 本地开发
bun run dev:full  # 自动加载 policy/current/ + claims_detail + quotes + dim

# ETL 入口（必须显式指定域；⚠️ 无参会跌落 premium 单域 ETL，并非智能检测）
node 数据管理/daily.mjs premium|claims_detail|quotes|all   # 完整域清单见 daily.mjs 的 ALL_DOMAINS 常量

# 同步到 VPS（rsync policy/current/ + claims_detail/ + quotes/ + dim/）
node scripts/sync-vps.mjs
```

## VPS 数据加载路径

**服务器加载逻辑**（`server/src/services/duckdb.ts:loadMultipleParquet()`）：
- 固定读取 `policy/current/*.parquet`（3层分片架构产出的 4 个分片文件）
- 无 daily/ 检测，无旧模式回退
- 创建 3 路 LEFT JOIN 的 `raw_parquet` 视图（policy JOIN claims JOIN quotes）

**VPS 运行时目录**：
- `server/data/fact/policy/current/` — 保单分片
- `server/data/fact/claims_detail/` — 赔案明细（唯一赔付数据源）
- `server/data/fact/quotes/` — 报价
- `server/data/dim/salesman/` — 业务员维度
- `server/data/dim/plan/` — 计划维度

| 场景 | 正确做法 |
|------|---------|
| 新增日期数据（如新的 xlsx） | `node 数据管理/daily.mjs <域>` 转换 → `node scripts/sync-vps.mjs` 推送 → PM2 重启 |
| 验证数据是否可见 | `curl /api/filters/options` 检查 `availableYears` 和 `dateRange.max_date` |

**前端年份筛选器**：由后端 `GET /api/filters/options` 的 `availableYears`（`SELECT DISTINCT YEAR(policy_date)`）驱动，
不再硬编码。

## ETL 源文件管理规范（RED LINE）

### 源文件命名约定

所有源 Excel 统一前缀编号，放在 `数据管理/` 根目录：

| 编号 | 域 | 文件名模式 | 多文件 | 更新节奏 |
|------|-----|-----------|--------|---------|
| 01 | premium | `每日数据_*.xlsx` / `01_签单清单_*.xlsx` | 按日期分片 | 日/周增量 |
| 02 | claims_detail | `02_理赔明细_*.xlsx` | 按年段拆分，全部传入 | 日全量 |
| 03 | cross_sell | `03_交叉销售_*.xlsx` | 单文件 | 随源 |
| 04 | quotes | `04_报价清单*.xlsx` | 多文件合并 | 随源 |
| 05 | renewal | `05_续保清单_*.xlsx` | 单文件 | 随源 |
| 07 | repair | `07_维修资源*.xlsx` | 单文件 | 不定期 |
| 08 | customer_flow | `08_客户来源去向*.xlsx` | 单文件 | 随源 |

### 多文件合并规则

同一域有多个源文件时（如 `02_理赔明细_报案时间21-24年.xlsx` + `02_理赔明细_报案时间20260413.xlsx`）：
- ETL 脚本用 `nargs='+'` 接收多个输入
- `daily.mjs` 传入所有匹配文件：`-i file1 file2`（非 `-i file1 -i file2`）
- 合并后打印日志，验证时间范围完整性

### 列结构变更协议

源文件列结构变更时（如新增/删除/重排列）：
1. 更新 ETL 脚本的 `CN_TO_EN` 映射，按新源列序排列
2. 验证 `REQUIRED_COLUMNS` 仍存在于新结构中
3. 运行 ETL + 检查输出 parquet 的列对齐和时间范围
4. 更新 `data-sources.json` 的 `field_count`

### 源文件唯一事实源

`数据管理/data-sources.json` 是数据域元数据的唯一注册表。新增/替换源文件后必须运行 ETL，由脚本自动更新 `row_count`、`last_updated`。

## claims_detail 存量更新铁律（RED LINE — 2026-06-08 满期赔付率对账事故）

**背景**：理赔金额是**动态**的——已决金额（`settled_amount`，已结案实际赔付）/ 未决金额（`pending_amount`，未结案估损）随理赔进展持续变化。若每日只喂"当日新报案增量"而不刷新历史在保赔案，旧赔案会停在首次抓取的快照 → 已报告赔款偏低 → **满期赔付率系统性偏低**，与公司报表对不上。

**事故复盘**：2026-06-08 用户报"满期赔付率不符合实际"。根因 = claims Parquet 停在 06-06 旧快照、未用最新全量源做存量更新（既非口径错、也非 ETL bug、也非日期断档）。用最新含历史全量源跑增量合并（CDC update）后（刷新 967 笔金额变更 + 478 新增赔案），系统口径（已结案取已决金额 + 未结案取未决金额）68.8% 立即对上公司 68.75%。详见 memory `project_lr_caliber_reconciliation`。

**铁律**：

1. **claims 源必须是"含历史的全量快照"，不是当日增量**。源文件命名 `02_理赔明细_报案时间<起>_<止>.xlsx`，报案时间跨度应覆盖全部在保年度（例：`2025-05-01 ~ 当日`）。只截"当日新报案"会漏掉历史赔案的金额刷新。
2. **增量合并（CDC update）是按赔案号的覆盖式更新（upsert），存量更新会生效**：`pipelines/claims_partition_manager.py` 的 `do_update` 按 `claim_no`（赔案号）覆盖旧行（新全量 `UNION ALL BY NAME` 旧分区中不在新源的赔案），并专门统计 `amount_changed`（金额变更数）。只要喂了最新全量源，旧赔案的已决/未决金额会被刷新到最新。
3. **去重保最新版本**：`pipelines/convert_claims_detail.py` 按赔案号 `keep='last'` 去重（增量保留、存量更新取最新版本），不丢赔款。
4. **发布节奏**：日常发布（`bun run release:daily`）须确保 claims 源是当日全量快照；长期只喂窄窗增量会让满期赔付率逐渐偏低且不易察觉。

**验证**：刷新后用 Parquet 直查满期赔付率，与公司报表对账（容忍 < 0.2 个百分点）。`duckdb -c "SELECT MAX(accident_time) FROM '数据管理/warehouse/fact/claims_detail/claims_*.parquet'"` 应跟上最新源的报案截止日；落后过多即提示需用全量源刷新。

> **代码兜底（已实现，B191e0f）**：`daily.mjs runClaimsDetail` Step 5.5 自动检查报案截止日落后当日天数，≥3 天（`CLAIMS_REPORT_LAG_WARN_DAYS`）即红字告警并提示用含历史的全量源刷新。判定逻辑抽至 `数据管理/lib/claims-freshness.mjs`（纯函数，`tests/claims-freshness.test.ts` 覆盖阈值边界三件套），取数由 `数据管理/pipelines/parquet_stats.mjs` 的 `getPartitionedMaxReportDate` 提供。落实"规则必须自动化执行（文档规则 ≠ 执行规则）"原则。

## Excel 多 sheet 加载规范（RED LINE — governance #24 强制）

Excel 因行数上限（~104 万行）拆分为多个 sheet 时，续表数据必须被完整读取。

**规则**：`pipelines/convert_*.py` 和 `quote_etl.py` **禁止裸 `pd.read_excel()`**，必须使用共享函数：

```python
from pipelines.etl_validation import load_excel_all_sheets
df = load_excel_all_sheets(input_file, dtype=STR_FORCE_COLS, required_columns=REQUIRED_COLUMNS)
```

**函数行为**：
- 单 sheet → 直接返回（零开销）
- 多 sheet → 自动识别有表头 sheet / 无表头续表 → concat 合并
- 打印合并日志（sheet 数 + 总行数）

**例外**：`transform.py` 使用自有的 `load_target_excel()`（历史原因，功能等价）。`compare_excel.py` 是对比工具，不适用。

## 数据知识协议

数据处理任务必读: [.claude/data-knowledge-protocol.md](../.claude/data-knowledge-protocol.md)

数据流字段变换规则: [数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md](../../数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md)

## 上游源头拉取（VPS auto_loadbi manifest 契约 — 2026-07-04 起替代 iCloud 手动源）

上游五张表（01签单/02报价/03维修资源/04厂牌明细/05理赔）由 VPS `myvps:/root/workspace/auto_loadbi/exports/` 每日定时导出；**唯一稳定契约 = 该目录 `latest-manifest.json`**（按 `code` 取当前份的 `path`，文件名日期后缀每天变，禁止硬编文件名）。上游侧完整交接文档随 rsync 落地在 `数据管理/inbox/README-for-etl.md`。

**入口**：`node scripts/pull-bi-exports.mjs`（`bun run release:daily` 已内置为 Stage 0；`--skip-pull` 跳过）。纯函数层 `数据管理/lib/bi-export-pull.mjs`（vitest：`tests/bi-export-pull.test.ts`）。

| 护栏 | 规则 |
|------|------|
| 断线兜底 | manifest 缺任一 code / mtime 不是**北京时间**今天 / 本地字节≠manifest / sizeMB 低于下限（疑似空表）→ 告警中止，**禁止默默用旧数据**（`--force` 仅应急） |
| 时区陷阱 | manifest `mtime` 是真 UTC；本机时钟不一定在北京时区，新鲜度判定必须换算 Asia/Shanghai（`beijingDayOf`），禁止本地 Date 日期直比 |
| 省份错配 | 文件名 `shanxi_`/`sichuan_` 前缀 = 导出脚本 PROVINCE 配置标签，**不自动跟登录账号**；分发前抽样 01 签单保单号前缀（SSOT = fields.json `branch_code.derivation.mapping`）内容核验，与前缀声明不一致即中止（`--skip-verify-province` 仅应急） |
| 省份路由 | `shanxi_*` → `staging/SX/`；`sichuan_*`/无前缀（含 04 厂牌全国口径）→ `数据管理/` 根；目标目录由 `branchSourceDir` 派生，不另造路由 |
| 覆盖归档 | 分发时对同品类被新长窗覆盖的旧范围 xlsx 归档到目标目录 `.xlsx-archive/<日期>/`（防 multi_file_merge 域源堆积）；不同品类不互斥，02 报价单日文件逐日累积 |
| 出表时机（2026-07-18 起双批） | 早批 01 签单 + 05 理赔约北京 **07:35** 两省就绪；晚批 02 报价 + 03 维修（+ 04 厂牌，每周日更新）约 **11:50** 两省就绪。按批拉取（`--batch early\|late`）只校验本批 code，过早拉会被该批新鲜度校验拦下（符合断线告警契约）。不带 `--batch` = 全量拉取（要求 5 张全新鲜，适合 12:00 后手动补全）。SSOT：`数据管理/lib/release-batches.mjs` |

BI 导出 xlsx 的 dimension 元数据损坏（openpyxl read_only 读到 max_row=1），任何对这些源文件的抽样/读取必须走 pandas `read_excel`。

## 全自动日常发布 watcher（launchd + auto-release-daily — 2026-07-04）

把「等上游出表 → 主仓跑发布」交给机器：**launchd 每 15 分钟拉起
`scripts/auto-release-daily.mjs`**（无常驻进程）。**2026-07-18 起为双批**（早批 01+05 / 晚批
02+03+04，见文末「双批发布拆分」小节）：一个 tick 内依次处理两批，各自窗口（早批默认
07:40~20:00 / 晚批 12:00~20:00）内 `ssh` 只读远程 `latest-manifest.json` 判本批就绪
（`evaluateRemoteManifest(requiredCodes=本批 code)`：本批 code 齐全 + mtime=北京今天 +
sizeMB 兜空表，**不 rsync**），就绪即 `node scripts/sync-and-reload.mjs --batch <id>`（其
Stage 0 pull-bi-exports `--batch` 再做本批 rsync + 字节比对 + 省份内容核验，双层校验）。

| 命令 | 用途 |
|------|------|
| `bun run auto-release:install` | 安装 launchd 定时器（**必须主仓跑**，worktree 内 fail-closed 拒绝） |
| `bun run auto-release:status` | 当天状态 + launchd 安装态 + 最近日志 |
| `bun run auto-release:once` | 忽略窗口手动探测一次，就绪即发布（`--dry-run` 只判不发） |
| `node scripts/auto-release-daily.mjs --uninstall-launchd` | 卸载 |

**状态机**（`数据管理/lib/auto-release-decision.mjs` 纯函数，`tests/auto-release-decision.test.ts` 锁定）：
幂等键为「批次 × 天」（`selectBatchState`/`mergeBatchState`，早批 `released` 不会让晚批被跳过）；
某批当天 `released` → 该批全天幂等跳过；`failed` 窗口内重试至上限（默认 6 次/批）后停手等人工；
窗口结束仍未成功 → 标记 `missed` **告警**（日志 + macOS 通知 + 飞书机器人推「AI 赋能车险
经营」群 `lark-cli --as bot` + 可选企微群机器人 `AUTO_RELEASE_WEBHOOK_URL`），当天不再自动
尝试——**宁可不发布也不静默用旧数据**。2026-07-08 起默认开启飞书推送：此前只有本地日志/桌面
通知，人不在电脑前会错过 missed 告警（07-07 launchd 掉线 + SSH 探测失败当天实证）。
状态/日志落 `数据管理/logs/auto-release-state.json` 与 `auto-release.log`（gitignored）。

**窗口/重试上限调宽 + 告警升级（2026-07-12）**：复盘 `auto-release.log`（07-08~07-12）
发现原窗口 10:35~14:00 + 重试上限 2 次，往往在 11:40 前就把重试次数耗尽，即便根因（治理闸
拦截 / VPS SSH 瞬时抖动）当天几小时内就被人工修复，也要等人手动 `--once` 补跑才追上，导致
首页「短中长期对照」报告卡连续 2~3 天显示"数据未更新"——报告生成（Stage 1.5）其实每天都
成功跑了，真正卡住的是同一条链路里更晚的治理闸/VPS 同步反复失败，报告和数据被一起拖住。
现调宽为 10:35~20:00 + 6 次重试，让瞬时故障有更多机会在窗口内自愈。同时新增
`consecutiveMissedDays`（`computeConsecutiveMissedDays`）——单日故障只告警一次容易被忽略
（07-08/07-09 均是如此悄悄拖过去的），一旦拖过第 2 个自然日仍未成功，告警标题/正文自动
升级为「🚨🚨🚨 已连续 N 天未自动发布」，措辞更强烈，不再和日常噪声同等力度。

环境变量（2026-07-18 双批起窗口按批设）：`AUTO_RELEASE_EARLY_WINDOW_START/END`（默认 07:40/20:00）·
`AUTO_RELEASE_LATE_WINDOW_START/END`（默认 12:00/20:00）——旧的全局 `AUTO_RELEASE_WINDOW_START/END`
双批时代已失效（两批窗口不同，单值无法表达）· `AUTO_RELEASE_MAX_ATTEMPTS`（默认 6，单批当日上限）·
`AUTO_RELEASE_LARK_CHAT_ID`（飞书目标群，默认「AI 赋能车险经营」）·
`AUTO_RELEASE_INTERVAL_SEC`（安装时生效）· 复用 `PULL_BI_SSH_ALIAS/PULL_BI_REMOTE_DIR`。

⚠️ Mac 睡眠时 launchd 不触发（唤醒后下个周期补上）；白天常合盖可 `sudo pmset repeat
wakeorpoweron MTWRFSU 07:30:00` 类定时唤醒覆盖早批窗口（watcher 不代改电源设置）。

### 修订（2026-07-05）：可选表分层 + 补导分发 + --allow-stale

- **04 厂牌 = 可选表**（用户拍板：低频维表"很少增量"）：缺席 / 不新鲜 / 体积异常 → 告警 +
  跳过分发该文件（本地保留旧维表继续服务），**不阻塞**发布，也不拦 watcher 就绪判定
  （SSOT：`bi-export-pull.mjs OPTIONAL_REPORT_CODES`；硬闸 = 01/02/03/05）。实证：07-05 上游
  04 骤降 4.1MB（前日 39MB），若作硬闸会拦住当天所有核心事实表。
- **契约外补导分发**（pull 脚本 [4b] 段）：manifest 只登记「当前份」，上游补导历史窗口的文件
  （实证：07-05 批量补导 `shanxi_20260624~0702_02_报价清单`）随 rsync 在 inbox 但不在 reports——
  凡符合报表命名模式（剥省前缀后 `YYYYMMDD[-YYYYMMDD]_0X_*.xlsx`，X∈1..5）且非当前份者一并
  按同规则分发（`planBackfillFiles`）。排除集 = manifest **全部**当前份（含被剔除的异常 04，防侧门混入）。
- **`--allow-stale <codes>`**：显式豁免指定硬闸 code 的「mtime 非今天」（应急：上游当天没导但
  旧份有效仍要发布，如 07-05 的 02）。仅豁免新鲜度——字节不一致 / 体积骤降不受影响；
  **watcher 自动路径不透传**，断线闸长期不松。

## SX 保单数据自动晋升（2026-07-09 起，修复"晋升从未自动化"缺口）

**背景**：山西（SX）保费 ETL 产物先落隔离目录 `数据管理/warehouse/validation/SX/`，须经
`scripts/release/sx-promote.mjs --apply --rls-confirmed` 手动「晋升」到 `数据管理/warehouse/
fact/policy/current/SX/`（生产真正会同步的目录）才对外可见。此前该脚本**从未接入**
`release:daily`/`auto-release-daily.mjs` 任何自动化链路（`grep -rn "sx-promote" package.json
scripts/*.mjs scripts/release/*.mjs` 除脚本自身零引用）——2026-07-09 实证：上游山西数据已导出
到 07-08、本地 ETL 也已转换进 `validation/SX/`，但因无人手动跑晋升脚本，生产端 SX 保单数据
滞后 2 天且**零告警**，靠人工排查才发现补救。

**修复**：`node scripts/sync-vps.mjs` 每次运行时，若检测到本地存在 `validation/SX/` 目录，
会经 `runSxAutoPromote()`（`scripts/sync-vps.mjs`）自动完成「核实 → 晋升」：

1. **真实核实，非静态声明**：SSH 到生产 VPS，`curl` 已扩展的 `GET /internal/data-fingerprint`
   端点（新增 `data.security.branchRlsEnabled`，来自 `dbEnv.BRANCH_RLS_ENABLED === 'true'` 的
   服务端运行时取值——与 `permission.ts` RLS 判定用**同一严格字符串比较**，不是又一套口径）。
   刻意**不是**把 `--rls-confirmed` 硬编码进自动化调用变成橡皮图章：查到 `true` 才放行，查到
   `false`（真实核实为关闭）或查询失败（网络/端点异常）**一律拒绝晋升**。
2. **判定**：`数据管理/lib/sx-promote-gate.mjs` 的 `evaluateSxAutoPromoteReadiness()`（纯函数，
   `tests/sx-promote-gate.test.ts` 覆盖 skip/promote/block 三态）——本地无 `validation/SX/`
   （纯 SC 部署）→ `skip`，零行为变化；核实通过 → `promote`；核实为 `false` 或查询失败 →
   `block`，安全默认拒绝（fail-closed，宁可不晋升也不能在 RLS 状态不明时晋升新数据）。
3. **拒绝即响亮失败，且是整批中止而非局部跳过**：`block` 时 `sync-vps.mjs` 在 `runStandardMode()`
   （真正执行 SC/claims/quotes/dim 等全部域 rsync 的函数）**之前**以非零退出码中止——准确语义是
   「fail-safe：不会用陈旧/未核实数据覆盖生产」，**不是**「fail-independent：SC 与其余域本次照常
   同步」。SX 核实的瞬时抖动（SSH 超时等）会让**这一次运行**里 SC/claims/quotes/dim 全部不被同步，
   需要 operator 用 `--domain` 单独重试补上非 SX 域。这与既有的完整性闸门（`assertLocalNotStale
   VsVps`）行为模式一致，不是本机制独有的缺陷；`auto-release-daily.mjs` 既有 2 次重试 + missed
   告警机制吸收偶发网络抖动，不需要另建告警通道，但排查时不要误以为"SX 出问题那次 SC 仍照常发布了"。
4. **自动化通过后**，`sync-vps.mjs` 代为调用 `sx-promote.mjs --apply --auto-verified-rls
   --rls-verification-note "<核实详情>"`（新增旗标，与人工 `--rls-confirmed` 二选一即可通过
   P2-10 闸；`--auto-verified-rls` 必须配合非空 note，落盘进 `.sx-promote-manifest.json` 的
   `rlsVerification` 字段供审计追溯，区分"人工声明"与"自动化实时核实"两种来源）。

**不变的部分**：`sx-promote.mjs` 的安全内核（sha256 校验 / branch_code 断言 /
staging-then-rename 原子性 / leftover preflight）完全未动；人工 `--rls-confirmed` 路径完全
保留，可独立命令行调用（应急 / 首次 cutover / 调试）。详见 `scripts/release/sx-promote.mjs`
文件头「自动化接入」章节。

**单测**：`tests/sx-promote-gate.test.ts`（纯判定函数三态）+
`scripts/__tests__/sync-vps-sx-auto-promote.test.mjs`（`runSxAutoPromote()` 编排逻辑，
依赖注入 mock RLS 查询与晋升子进程，不连真实网络/生产）。

## 双批发布拆分（2026-07-18 起，上游 BI 导出改双批调度）

**背景**：上游华安 BI 导出（VPS auto_loadbi）从「五张表一次出齐」改为两批出表：
- **早批**：01 签单 + 05 理赔，北京约 07:00~07:35 两省就绪
- **晚批**：02 报价 + 03 维修 + 04 厂牌，北京约 11:50 就绪（04 每周日更新，非周日 mtime 停在上周日）

故本项目每日发布/ETL 从「一次 `release:daily` 跑全部域」拆成早批 + 晚批两次发布。

**唯一事实源**：`数据管理/lib/release-batches.mjs`（`RELEASE_BATCHES`）——批次 → code 子集 / ETL 域 /
触发窗口 / 报告·企微编排。watcher、pull-bi-exports、sync-and-reload 都从此读，禁止各自硬编码。

| 批次 | 上游 code | SC ETL 域 | SX 分省域 | 触发窗口(北京) | 报告 | 企微 | reload |
|------|-----------|-----------|-----------|----------------|------|------|--------|
| early | 01 签单 / 05 理赔 | premium, claims_detail | premium, claims_detail | 07:40~20:00 | ✓ | ✓ | ✓ |
| late | 02 报价 / 03 维修 / 04 厂牌(可选) | quotes, cross_sell, brand, repair, customer_flow, new_energy_claims, renewal_tracker | quotes, repair, renewal_tracker | 12:00~20:00 | ✓ | ✗ | ✓ |

> ⚠️ **企微 2026-07-22 起从晚批移到早批**（用户决策，`[policy-override]`）：5 张企微表中 3 张签单类
> （四川邮政/山西邮政/任卫军台账）读 policy(premium，早批产出) → 移早批后上午即更新鲜；2 张续保类
> （机构续保/电销5-7月续保）读晚批域 renewal_tracker+quotes → 早批推送时读到的是**前一天晚批**快照
> （混新鲜度，已知取舍）。SSOT = `release-batches.mjs`（EARLY.runWecom=true / LATE.runWecom=false）。
> **续保 2 表到期停推**：2026-08-01 起 5-7 月应续保单全部到期，故 `MAY_JUL_RENEWAL_WECOM_LAST_DAY
> ='2026-07-31'` 日期闸令这 2 表在北京 07-31（含）后自动停推（不删表、不报错）；签单 3 表无 cutoff 继续。
> **企微失败非阻断但不静默（PR #1158 评审 F1 两轮）**：企微失败不抛错（否则 watcher 把本批标
> failed → 晚批 fail-closed 连坐拒发 + 早批 ETL/reload 整链重跑），但发布进程以**专用退出码 86**
> （`WECOM_FAILURE_EXIT_CODE`）结束——退出码契约：0=全成功、86=核心发布成功仅企微失败、其他=核心
> 失败。手动入口（`bun run release:daily`）shell 可见失败；watcher 经 `interpretReleaseExit` 对 86
> 标批次 released 并**独立**告警（文案 `buildWecomFailureAlert`，明细来自标记文件
> `数据管理/logs/wecom-sync-alert.json`，绑定 run_id 防陈旧/并发误读）。独立重试
> `node scripts/wecom-sync.mjs`（只跑企微，不重跑 ETL/reload）。编排真实执行体 + 契约 SSOT =
> `scripts/lib/wecom-sync-tasks.mjs`（`runWecomStage` 注入 runner 可测），回归测试
> `tests/wecom-sync-tasks.test.ts` 锁定（7-31/8-1/UTC 边界 + 失败注入退出码 86 + 晚批不连坐 + 告警文案）。

**关键设计**：
- **幂等键 = 批次 × 天**：状态文件 `auto-release-state.json` 升级为 `{beijingDay, batches:{early:{…},late:{…}}}`
  （`selectBatchState`/`mergeBatchState`，`auto-release-decision.mjs`）。早批标 `released` 不会让晚批被幂等跳过。
  旧扁平 schema 向后兼容（当作早批延续读一次）。
- **就绪判定按批**：`evaluateRemoteManifest(requiredCodes=本批 code)`——早批只看 01/05，晚批只看 02/03/04；
  02/03 未就绪不拦早批，01/05 未就绪不拦晚批。
- **03 维修硬闸只挂晚批**：03 属晚批 hardCodes，早批不含 03，故早批不会因 03 未就绪卡死。
- **04 厂牌可选表语义不变**：晚批 `optionalCodes=['04']`——周一至周六 mtime 停在上周日 → 告警 + 跳过分发
  （保留本地旧维表），不报错、不拦就绪；仅周日 mtime=当天时分发（`bi-export-pull.mjs OPTIONAL_REPORT_CODES`）。
- **renewal_tracker 派生域**依赖 policy（早批产出）+ quotes（晚批）+ salesman，排晚批最后。
- **企微编排移早批 + 续保表到期停推**（2026-07-22，见上表下方 ⚠️ 注）：早批 runWecom=true / 晚批 false；
  续保 2 表由 `MAY_JUL_RENEWAL_WECOM_LAST_DAY` 日期闸在 2026-07-31（北京，含）后自动退役。

**入口**：
- watcher 自动：`node scripts/auto-release-daily.mjs`（一 tick 处理两批）；手动单批 `--once --batch early|late`。
- 手动发布单批：`node scripts/sync-and-reload.mjs --batch early|late`。
- 手动拉取单批源：`node scripts/pull-bi-exports.mjs --batch early|late`。
- 全量兜底（12:00 后，要求 5 张全新鲜）：`bun run release:daily`（= `sync-and-reload --wecom`，不带 `--batch`）。

**单测**：`tests/release-batches.test.ts`（SSOT + `buildBatchEtlCommands`）·
`tests/auto-release-decision.test.ts`（`selectBatchState`/`mergeBatchState` + 批次隔离）·
`tests/bi-export-pull.test.ts`（`evaluateRemoteManifest`/`evaluateManifestReports` code 子集）。

> ⚠️ 上游 `数据管理/inbox/README-for-etl.md` 由 VPS 导出脚本 rsync 落地（gitignored、upstream 拥有），
> 其出表时机描述须在 VPS 侧同步更新，不在本仓改（改了会被下次 rsync 覆盖）。
