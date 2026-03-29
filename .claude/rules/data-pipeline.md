---
paths: ["数据管理/**", "scripts/export-for-vps.mjs", "scripts/**"]
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
| 保单明细 | `数据管理/warehouse/fact/policy/车险保单综合明细表0214.parquet` | 主数据源 |
| 团队映射 | `数据管理/warehouse/dim/salesman_organization_mapping.json` | 业务员-团队-机构映射 |
| 续保明细 | `数据管理/warehouse/fact/renewal/` | 续保数据 |

## 数据加载流程

```bash
# 本地开发
bun run dev:full  # 自动加载 Parquet + JSON

# 生产同步（完整一键链路）
./数据管理/run.sh full \
  --source 历史数据.xlsx \
  --target 最新数据.xlsx \
  --output 数据管理/warehouse/fact/policy/车险保单综合明细表MMDD.parquet
# 自动执行：续保匹配 → Parquet 转换 → scp 上传 → PM2 重启 → 健康检查

# 仅本地转换，不同步 VPS
./数据管理/run.sh full ... --no-sync

# 单独同步已有 Parquet（不重新转换）
./deploy/sync-data.sh [文件路径]
```

## VPS 数据加载路径（domain-split 模式）

> **关键约束**：VPS 后端启动时**优先**从 `fact/policy/daily/*.parquet` 加载（domain-split 模式），
> `current/` 目录下的整合 parquet 文件**不会被使用**。

| 场景 | 正确做法 |
|------|---------|
| 新增日期数据（如新的 xlsx） | ETL 拆分到 `fact/policy/daily/YYYY-MM-DD.parquet` → 重启 PM2 |
| 补充历史年份（如 2021/2022） | 从 `current/` 按签单日期拆分到 `daily/` → 重启 PM2 |
| 验证数据是否可见 | `curl /api/filters/options` 检查 `availableYears` 和 `dateRange.max_date` |

**加载优先级**（`server/src/app.ts`）：
1. `fact/policy/daily/*.parquet`（domain-split，存在即用）
2. `current/*.parquet`（多文件兼容路径）
3. `server/data/*.parquet`（单文件回退路径）

**前端年份筛选器**：由后端 `GET /api/filters/options` 的 `availableYears`（`SELECT DISTINCT YEAR(policy_date)`）驱动，
不再硬编码。`daily/` 目录覆盖的年份 = 前端可选的年份。

## 数据知识协议

数据处理任务必读: [.claude/data-knowledge-protocol.md](../.claude/data-knowledge-protocol.md)

数据流字段变换规则: [数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md](../../数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md)
