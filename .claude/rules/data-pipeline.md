---
paths: ["数据管理/**", "scripts/sync-vps.mjs", "scripts/**"]
---

# 数据管道与 VPS 规则

## VPS 分层数据架构（RED LINE - 2026-02-28 起强制执行）

> **背景**：VPS 2核4G，历史上原始 Parquet 在 VPS 聚合导致内存 800MB+、PM2 177次重启。

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
| 赔案明细 | `数据管理/warehouse/fact/claims_detail/latest.parquet` | 唯一赔付数据源（ClaimsAgg 由服务端动态聚合） |
| 报价状态 | `数据管理/warehouse/fact/quotes/latest.parquet` | 报价数据 |
| 团队映射 | `数据管理/warehouse/dim/salesman_organization_mapping.json` | 业务员-团队-机构映射（回退） |
| 续保明细 | `数据管理/warehouse/fact/renewal/` | 续保数据 |

## 数据加载流程

```bash
# 本地开发
bun run dev:full  # 自动加载 policy/current/ + claims_detail + quotes + dim

# ETL 入口（智能检测，无参数自动判断需更新的域）
node 数据管理/daily.mjs

# 强制指定域
node 数据管理/daily.mjs premium|claims_detail|quotes|all

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
| 新增日期数据（如新的 xlsx） | `node 数据管理/daily.mjs` 转换 → `node scripts/sync-vps.mjs` 推送 → PM2 重启 |
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
