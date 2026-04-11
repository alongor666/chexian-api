# 架构优化交接文档

> 接手方：新会话。当前分支 `refactor/renewal-analysis-v2`。
> 撰写时间：2026-04-11

---

## 已完成（本会话）

### Quick Wins

| # | 改动 | 文件 | 验证状态 |
|---|------|------|---------|
| QW1 | CODE_INDEX + CLAUDE.md 计数纠偏（SQL 14→31，路由单体→拆分） | `开发文档/00_index/CODE_INDEX.md`, `CLAUDE.md` | governance #22 自动校验 |
| QW3 | governance #22：SQL 文件数 == INDEX 声明数 | `scripts/check-governance.mjs` | 31=31 通过 |
| QW6 | DataContext.tsx refreshFiles 闭包修复 | `src/shared/contexts/DataContext.tsx` | build 通过 |

### 方向 2：SQL 测试补强

| 文件 | 测试数 | 覆盖目标 |
|------|--------|---------|
| `server/src/sql/__tests__/cost.test.ts` | 64 | cost.ts 全 15 函数 + 类型 + 安全性 |
| `server/src/sql/__tests__/growth.test.ts` | 31 | YoY/MoM/YTD/Custom/DualMetric + 时间视图全覆盖 |
| `server/src/sql/__tests__/performance-analysis.test.ts` | 23 | Summary/PeriodBounds/Trend/Drilldown/TopSalesman |

总测试：76 文件 / 1028 通过（+76 新增）

### 方向 3：cost.ts 拆分

```
server/src/sql/cost.ts (996行) → barrel re-export (16行)
  ├── cost/shared.ts              (72行)  — 类型、常量、维度映射
  ├── cost/cost-ratios.ts         (302行) — 赔付率/费用率/综合/变动
  ├── cost/earned-premium.ts      (273行) — 滚动12月 + V3 包装器
  └── cost/earned-premium-detail.ts (296行) — 月度已赚 + 费用查询
```

调用方零改动：`server/src/routes/query/cost.ts` 和 `tests/realtime-aggregation-contract.test.ts` 的 import 路径不变。

### Code Review 结论

**APPROVE**。0 CRITICAL / 0 HIGH / 2 MEDIUM（已修复）/ 2 LOW（1 已修复，1 预存保留）。

---

## 未完成（按 ROI 排序，接手继续）

### 方向 2 补尾：更多 SQL 生成器测试

当前覆盖 3/31 文件。优先级排序（按行数 × 复杂度）：

| 优先级 | 文件 | 行数 | 现有测试 | 建议 |
|--------|------|------|---------|------|
| P0 | `trend.ts` | 561 | 0 | 趋势是核心页面，时间粒度多 |
| P0 | `coefficient.ts` | 494 | 0 | 系数监控业务价值高 |
| P1 | `claims-detail.ts` | 517 | 0 | 赔案域独立性强 |
| P1 | `cross-sell.ts` + 5 个子模块 | 共 1306 | 仅 drilldown-contract | 6 个文件共享域逻辑 |
| P2 | `comprehensive-analysis.ts` | 271 | 0 | 较简单 |
| P2 | `quote-conversion.ts` | 287 | 有 | 已有覆盖 |

### 方向 3 继续：更多长文件拆分

| 文件 | 行数 | 建议拆法 | 安全网 |
|------|------|---------|--------|
| `growth.ts` | 690 | `growth/{yoy,mom,ytd,custom,dual-metric}.ts` + barrel | 31 个测试 |
| `performance-analysis.ts` | 704 | 已有 `shared.ts` + `heatmap.ts`，拆 `summary/trend/drilldown/top-salesman` | 23 个测试 |
| `performance-analysis-shared.ts` | 545 | 辅助函数密度高，暂不拆 | — |
| `trend.ts` | 561 | 按时间粒度拆 | 需先补测试 |

**拆分模式**：参考 `cost.ts` → `cost/` 的 barrel re-export 模式，所有现有 import 零改动。

### 方向 4：指标注册表下沉到 SQL 层（长期）

**基线数据**（用于追踪进度）：
```bash
# 裸字段聚合总数（应趋近 0）
rg "SUM\(signed_premium" server/src/sql | wc -l   # → 当前基线值待测量
rg "SUM\(premium\)" server/src/sql | wc -l          # → 当前基线值待测量
```

`getMetricSql()` 当前仅在 4 处使用（`cost-ratios.ts` 是最佳实践样板）。目标：逐文件替换裸 SQL 聚合为注册表调用。

### 方向 5：loadMultipleParquet 增量缓存

位置：`server/src/services/duckdb.ts:391-420`

方案：
1. fingerprint = hash(路径集合 + mtime) → 相同则跳过 CREATE TABLE
2. 新增文件 → `INSERT INTO ... union_by_name=true`（增量）
3. QueryCache 按表粒度失效（非全量 invalidateCache）

风险：schema 漂移需强校验（union_by_name 会静默 NULL 填充新列）

### 方向 7：路由 handler 样板抽象

位置：`server/src/routes/query/*.ts`（20 个文件）

方案：抽取 `createQueryHandler({ schema, sqlBuilder, cacheKey })` 工厂函数，将 20 个路由从 ~50 行/个降至 ~10 行声明式注册。

**前提**：先审计 20 个路由，确认骨架重复 > 3 次再抽象。

---

## 治理状态

```
bun run build       → 零 TS 报错
bun run test        → 76 文件 / 1028 通过
bun run governance  → 22 项中 21 项通过
                      唯一失败：#21 数据漂移检测（预存，与优化无关）
```

## 不建议做的事

- ❌ GraphQL/tRPC 替换 REST — React Query + inflight 去重已到位
- ❌ DuckDB → ClickHouse — 单机 4G 未触天花板
- ❌ 一次性大拆 `growth.ts` 或 `performance-analysis.ts` — 必须先补测试再拆
- ❌ 35 个生成器全做 E2E — 契约测试 + curl 验证更合算

---

## 关键文件速查

| 用途 | 路径 |
|------|------|
| SQL 测试 | `server/src/sql/__tests__/*.test.ts`（8 个文件） |
| cost 拆分 | `server/src/sql/cost/`（4 个实现 + 1 个 barrel） |
| governance | `scripts/check-governance.mjs`（22 项检查） |
| 优化计划原文 | `.claude/plans/renewal-analysis-v2.md`（如果存在） |
| 本文档 | `.claude/plans/architecture-optimization-handoff.md` |
