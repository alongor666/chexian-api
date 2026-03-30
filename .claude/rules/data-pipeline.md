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
| 赔付明细 | `数据管理/warehouse/fact/claims/latest.parquet` | 赔付+费用 |
| 报价状态 | `数据管理/warehouse/fact/quotes/latest.parquet` | 报价数据 |
| 团队映射 | `数据管理/warehouse/dim/salesman_organization_mapping.json` | 业务员-团队-机构映射（回退） |
| 续保明细 | `数据管理/warehouse/fact/renewal/` | 续保数据 |

## 数据加载流程

```bash
# 本地开发
bun run dev:full  # 自动加载 policy/current/ + claims + quotes + dim

# ETL 入口（智能检测，无参数自动判断需更新的域）
node 数据管理/daily.mjs

# 强制指定域
node 数据管理/daily.mjs premium|claims|quotes|all

# 同步到 VPS（rsync policy/current/ + claims/ + quotes/ + dim/）
node scripts/sync-vps.mjs
```

## VPS 数据加载路径

**服务器加载逻辑**（`server/src/services/duckdb.ts:loadDomainParquet()`）：
- 固定读取 `policy/current/*.parquet`（3层分片架构产出的 4 个分片文件）
- 无 daily/ 检测，无旧模式回退
- 创建 3 路 LEFT JOIN 的 `raw_parquet` 视图（policy JOIN claims JOIN quotes）

**VPS 运行时目录**：
- `server/data/fact/policy/current/` — 保单分片
- `server/data/fact/claims/` — 赔付
- `server/data/fact/quotes/` — 报价
- `server/data/dim/salesman/` — 业务员维度
- `server/data/dim/plan/` — 计划维度

| 场景 | 正确做法 |
|------|---------|
| 新增日期数据（如新的 xlsx） | `node 数据管理/daily.mjs` 转换 → `node scripts/sync-vps.mjs` 推送 → PM2 重启 |
| 验证数据是否可见 | `curl /api/filters/options` 检查 `availableYears` 和 `dateRange.max_date` |

**前端年份筛选器**：由后端 `GET /api/filters/options` 的 `availableYears`（`SELECT DISTINCT YEAR(policy_date)`）驱动，
不再硬编码。

## 数据知识协议

数据处理任务必读: [.claude/data-knowledge-protocol.md](../.claude/data-knowledge-protocol.md)

数据流字段变换规则: [数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md](../../数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md)
