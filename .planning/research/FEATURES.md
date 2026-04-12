# Feature Landscape: Performance Optimization for chexian-api

**Domain:** Analytics dashboard (React + Express + DuckDB, 3.8M-row insurance fact table)
**Researched:** 2026-04-12
**Overall Confidence:** HIGH — findings verified via DuckDB official docs, React ecosystem sources, and direct codebase audit

---

## Table Stakes

Features/techniques that users implicitly expect. Missing = performance stays bad in that dimension.

### Backend Query Layer

| Optimization | Why Expected | Complexity | Notes |
|---|---|---|---|
| CTE + Window Functions 替换 UNION ALL | `coefficient.ts` 当前生成 6 UNION ALL (成都/全省/org × n 周期)；DuckDB 窗口函数向量化执行，引擎单趟扫描同等数据可快 4-10x | Medium | DuckDB GROUPING SETS 有已知列裁剪 bug (ROLLUP/CUBE 子树 everything_referenced=true)，须用 PARTITION BY 窗口方案而非 GROUPING SETS；目标从 2-5s → <500ms |
| 惰性物化：非核心视图按需加载 | PolicyFact 380万行×53列在 2核4G VPS 上全量物化占 ~70% 内存；ClaimsDetail / CrossSellFact / CustomerFlow 在非对应页面时不应驻留内存 | Medium | 启动时只物化 PolicyFact；其他视图在首次路由命中时建立，LRU 超时（>1h 无访问）主动 DROP VIEW |
| Parquet 分区剪枝：按月分区 | DuckDB 读分区 Parquet 时可跳过不匹配 row group，趋势查询通常按月段过滤；当前 4 分片是地理+时间混合，无月粒度剪枝 | Low | 在 ETL 产出侧加 `PARTITIONED BY (year, month)`，或在物化层用 `WHERE insurance_start_date BETWEEN` 锁定月边界 |
| 快照失效精细化：按域分组指纹 | 当前任何 Parquet 文件变更触发全量 SHA256 重算（含 2021-2023 静态文件）；ETL 增量更新每天误触静态分片 | Low | 区分"静态分片"（修改时间 >365天）和"动态分片"（当年）；仅动态分片参与指纹计算；按 bundle 独立失效（dashboard-bundle 失效不应影响 performance-bundle） |

### 后端服务层拆分

| Optimization | Why Expected | Complexity | Notes |
|---|---|---|---|
| duckdb.ts 关注点分离 | 662行文件混合：连接池管理 + LRU 查询缓存 + SHA256 指纹 + 域加载 + 物化逻辑；单点故障 + 单元测试难 | High | 拆分目标：`duckdb-infra.ts`（连接池+缓存，已有部分）→ `duckdb-fingerprint.ts`（分域指纹）→ `duckdb-materialization.ts`（已有）→ `duckdb-query.ts`（执行+序列化）；每模块独立可测 |
| SQL 生成器拆分 | trend.ts(561行) / performance-analysis-shared.ts(545行) / claims-detail.ts(535行)；修改一个系数口径需在 500行文件里找到正确位置；回归 bug 风险高 | High | 按单一职责拆：`trend/monthly-aggregation.ts` + `trend/date-range.ts`；`coefficient/weekly-batch.ts` + `coefficient/formula.ts`；每模块 <200行，可独立单测 |

### 前端包体与加载

| Optimization | Why Expected | Complexity | Notes |
|---|---|---|---|
| ECharts 独立 chunk | 当前 vite.config.ts 已有 `vendor-echarts` 分组，但 echarts 本身约 900KB（未 tree-shake），首屏必须等待 | Low | 已有骨架，需验证是否开启 ECharts tree-shaking (`import { BarChart } from 'echarts/charts'` 按需引入)；目标该 chunk 降至 <400KB gzip |
| 路由级懒加载 | 20+ 页面（fee-analysis, moto-cost, quote-conversion, renewal-v2 等）；当前已用 React.lazy，但需确认无 eager import 泄漏 | Low | 扫描 `src/features/pages/` 所有 index.tsx，确认无顶层非 lazy import；每路由 chunk 独立，dashboard 不需要下载 claims-detail 代码 |
| 初始 bundle <200KB gzip | 行业基准；2025年 React 生态最佳实践；超过会有明显 TTFB 上升 | Low | 用 `rollup-plugin-visualizer` 建立基线测量；vendor-react + vendor-ui 通常可控 |

---

## Differentiators

不是强制要求，但实现后体验显著提升。

| Optimization | Value Proposition | Complexity | Notes |
|---|---|---|---|
| 分域快照构建（增量） | 目前 `snapshot:build` 重建所有 bundle；若只改了保费数据，只需重建 dashboard-bundle 和 performance-bundle；CI 时间从全量降至按需 | Medium | 在 `build-snapshots.mjs` 增加 `--bundle` 参数（已有）+ `--only-stale` 跳过指纹未变 bundle；需配合分域指纹 |
| ECharts 实例复用（resize 防抖） | 分析页面 tab 切换/窗口 resize 触发图表销毁+重建，数据密集页面有明显闪烁 | Low | `echarts-for-react` 已管理实例生命周期；关键是包裹 option 在 `useMemo`，并在 resize 时用 `chart.resize()` 而非重建 |
| DuckDB 查询执行监控精细化 | 当前 `>3s` 慢查询日志；改为区间统计（p50/p95/p99 + 按端点分组）便于定向优化 | Low | 在 `duckdb-query.ts` 维护一个轻量 in-memory 计数器（无需外部工具）；每小时日志输出，governance check 验证日志格式 |
| React Query 分级 staleTime | 不同数据域有不同新鲜度需求：KPI（5min）/ 趋势图（10min）/ 筛选器选项（60min）；当前统一配置 staleTime 导致高频重取 | Low | 按 query key 前缀设置：`['kpi', ...]` → 5min，`['filters', ...]` → 60min；Service Worker 活跃时已是 Infinity，仅影响 dev/HTTP 环境 |
| 启动时并行加载维度表 | 当前 `data-bootstrapper.ts` 顺序加载：salesman → plan → brand → repair；每张维度表 ~100ms，串行 4x = ~400ms 不必要延迟 | Low | `Promise.all([loadSalesman(), loadPlan(), loadBrand(), loadRepair()])` 并行加载 4 张维度表 |
| PolicyFact 列剪枝物化 | 当前 PolicyFact VIEW 包含 53 列，大量查询只需其中 10-20 列；列式存储的 DuckDB 读列有代价，但超宽视图仍有 projection overhead | Medium | 分析各 SQL 生成器实际 SELECT 字段，抽取核心列集合（20列）建 PolicyFact_Core 轻量视图，重业务路由换绑 |

---

## Anti-Features

明确不做、会伤害项目的事情。

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| 全量 `React.memo` 包裹 | React 19 Compiler 已自动推断 memoization；手动到处加 memo 引入 stale closure 风险 + 增加 review 认知负担；memoization 比较开销对轻组件反而更慢 | 只在 ECharts option 对象上用 `useMemo`（图表库依赖引用相等性），其余让 Compiler 处理 |
| 引入 Redis/外部缓存 | 2核4G VPS 已内存紧张；Redis 增加运维复杂度；当前 LRU 查询缓存（in-memory）+ 快照 JSON 文件已满足需求 | 优化现有快照层粒度，LRU 命中率透明化（日志暴露） |
| DuckDB → 其他数据库迁移 | 3.8M 行分析查询场景 DuckDB 是最优选；切换引擎重写所有 SQL 生成器风险极高；PROJECT.md 已明确 Out of Scope | 在 DuckDB 上榨干性能：窗口函数 + Parquet 分区 + 惰性物化 |
| VPS 硬件升级（软件优化前） | 软件层估算尚有 40-60% 性能可挖（SQL N+1/内存减负/前端 bundle）；硬件升级掩盖问题不解决根因 | 先完成软件优化量化基线，再评估是否需硬件 |
| 前端全局状态 Redux/Zustand | FilterContext 已经 Context 方案；增加状态库引入新 bundle chunk 和学习成本；当前规模不需要 | 优化 FilterContext 避免不必要全树重渲染（提取 selector hook，拆细 context） |
| GROUPING SETS / ROLLUP 替换 UNION ALL | 直觉上是"正确"方向，但 DuckDB 现有已知 bug：ROLLUP/CUBE/GROUPING SETS 子树禁用所有列裁剪，对宽 Parquet 查询更慢 | 用 `PARTITION BY` 窗口函数方案；或仅在窄列查询（手动 SELECT 字段）才考虑 GROUPING SETS |
| 过度拆分 SQL 生成器（微模块化） | 每个函数一个文件导致 import 图爆炸；难以追踪数据流；测试跨模块 mock 复杂度上升 | 按业务域分组（coefficient/, trend/, claims-detail/），每组 2-4 个文件，单文件 <200行 |
| 快照 TTL 过短（<30s） | 快照层价值在于吸收并发请求波峰；TTL <30s 则每分钟重算快照，消耗 DuckDB 计算资源 | 保持快照 max-age=60s，用分域失效保证数据时效；ETL 后主动触发对应 bundle 重建 |

---

## Feature Dependencies

```
快照失效精细化（分域指纹）
  → 必须先于 分域快照构建（增量）
  （没有分域指纹，增量构建无法判断哪个 bundle 过期）

duckdb.ts 关注点分离
  → 必须先于 查询监控精细化
  （拆出 duckdb-query.ts 后才有干净的切入点插入 p95 计时）

惰性物化（按需加载）
  → 前提：ClaimsDetail/CrossSellFact 路由有明确的初始化钩子
  → 影响：启动后首次访问对应页面有 500-2000ms 额外物化延迟（可接受，用 loading UI 覆盖）

ECharts tree-shaking
  → 前提：echarts-for-react 支持按需导入（v3.0+ 已支持）
  → 影响：需要把所有 ChartComponent 的 echarts 导入方式从 `import echarts` 改为按图表类型引入

React Query 分级 staleTime
  → 无前置依赖，独立可实施
  → 前提：梳理所有 useQuery 的 key 格式（已有 shared.ts buildRouteCacheKey）

SQL 生成器拆分
  → 无前置依赖，但必须先有回归测试覆盖（SQL 快照测试）
  → 拆分后立即跑 Parquet 直查对比验证
```

---

## MVP Recommendation

基于当前已有快照层 + Service Worker 的基础，下一阶段优先序：

**P0 — 立即实施（1-2 天，效果最大）：**
1. CTE + 窗口函数替换 coefficient.ts 的 UNION ALL（2-5s → <500ms，最直接的用户感知改善）
2. 快照分域指纹精细化（消除静态 Parquet 误触；ETL 增量后不再全量重算）

**P1 — 第二优先级（3-5 天，架构改善）：**
3. 惰性物化非核心视图（VPS 内存从 ~70% 降至估计 <50%）
4. duckdb.ts 关注点拆分（降低后续一切修改的风险）
5. ECharts tree-shaking 验证 + vendor chunk 大小基线建立

**P2 — 延后（有基线数据后再做）：**
6. SQL 生成器拆分（代码质量改善，需先有回归测试覆盖）
7. Parquet 月粒度分区（ETL 层改动，需与 B239-B241 8域拆分协调）
8. React Query 分级 staleTime（dev 环境体验优化，生产影响较小）

**暂不做（明确推迟）：**
- 前端 bundle 全面审计（先获取基线数据，目前未知是否存在问题）
- PolicyFact 列剪枝（需先量化各路由实际 SELECT 列集合）

---

## Sources

- [DuckDB Window Functions official docs + 2025 optimization blog](https://duckdb.org/2025/02/14/window-flying)
- [DuckDB GROUPING SETS column pruning bug (GitHub Gist)](https://github.com/duckdb/duckdb/issues/2378)
- [DuckDB Parquet partition pruning tips](https://duckdb.org/docs/current/data/parquet/tips)
- [DuckDB Memory Management official blog 2024](https://duckdb.org/2024/07/09/memory-management)
- [Vite manual chunks + vendor splitting 2025](https://soledadpenades.com/posts/2025/use-manual-chunks-with-vite-to-facilitate-dependency-caching/)
- [React 19 Compiler: useMemo/useCallback 2025 state](https://isitdev.com/react-19-compiler-usememo-usecallback-2025/)
- [ECharts large dataset optimization](https://www.mintlify.com/apache/echarts/examples/large-datasets)
- [TanStack Query cache invalidation strategies](https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation)
- [Granular cache invalidation (Headless CMS pattern, applicable to snapshot layer)](https://focusreactive.com/granular-cache-invalidation-for-headless-cms/)
- [DuckDB GROUPING SETS docs](https://duckdb.org/docs/current/sql/query_syntax/grouping_sets)
