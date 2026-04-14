---
phase: "04"
plan: "02"
subsystem: "data-bootstrapper"
tags: ["refactor", "lazy-loading", "materialization", "duckdb", "routing"]
dependency_graph:
  requires: ["04-01"]
  provides: ["lazy-domain-registry", "bootstrapper-registry", "createDomainMiddleware"]
  affects:
    - "server/src/services/data-bootstrapper.ts"
    - "server/src/services/lazy-domain-registry.ts"
    - "server/src/services/bootstrapper-registry.ts"
    - "server/src/services/duckdb-materialization.ts"
    - "server/src/routes/query/shared.ts"
    - "server/src/routes/query/claims-detail.ts"
    - "server/src/routes/query/cross-sell.ts"
    - "server/src/routes/query/repair.ts"
    - "server/src/routes/query/quote-conversion.ts"
    - "server/src/routes/query/customer-flow.ts"
    - "server/src/routes/query/renewal-v2.ts"
    - "server/src/app.ts"
tech_stack:
  added: []
  patterns:
    - "lazy-initialization"
    - "promise-lock-concurrency"
    - "registry-pattern"
    - "middleware-factory"
key_files:
  created:
    - "server/src/services/lazy-domain-registry.ts"
    - "server/src/services/bootstrapper-registry.ts"
    - "server/src/services/__tests__/lazy-domain-registry.test.ts"
  modified:
    - "server/src/services/data-bootstrapper.ts"
    - "server/src/services/duckdb-materialization.ts"
    - "server/src/routes/query/shared.ts"
    - "server/src/routes/query/claims-detail.ts"
    - "server/src/routes/query/cross-sell.ts"
    - "server/src/routes/query/repair.ts"
    - "server/src/routes/query/quote-conversion.ts"
    - "server/src/routes/query/customer-flow.ts"
    - "server/src/routes/query/renewal-v2.ts"
    - "server/src/app.ts"
decisions:
  - "LazyDomainRegistry 提取为独立文件（lazy-domain-registry.ts），避免测试时 DuckDB 原生模块依赖链污染单元测试"
  - "bootstrapper 通过注册中心（bootstrapper-registry.ts）解耦，避免 app.ts↔shared.ts 循环依赖"
  - "ClaimsAgg loader 最终回退路径显式 ensureLoaded('ClaimsDetail')，防止 ClaimsDetail VIEW 未就绪时 SQL 失败"
  - "超时（15s）状态保持 loading（不转为 failed），下次请求仍可等待原 Promise 完成"
  - "旧 router.use() 探测中间件（SELECT 1 FROM VIEW LIMIT 1）全部替换为 createDomainMiddleware，消除重复模式"
  - "createCrossSellRealtimeView 从 createPolicyFactView 末尾移除，改由 CrossSell lazy-loader 加载后调用"
metrics:
  duration: "~45min"
  completed: "2026-04-14T06:05:00Z"
  tasks_completed: 3
  files_modified: 10
---

# Phase 04 Plan 02: MAT-01 惰性域架构 Summary

**一句话总结**：将 DataBootstrapper 的 8 个辅助域从启动时 eager 串行加载改为 LazyDomainRegistry 按需加载，含 15s 超时保护 + Promise 并发锁 + 集中式路由中间件工厂。

## 执行摘要

### Task 1 — LazyDomainRegistry + DataBootstrapper 重构（commit: a845ea7）

新建 `lazy-domain-registry.ts`（纯 JavaScript 类，无 DuckDB 依赖）：

- `register(name, loader)` — 仅记录 loader 闭包，不触发加载
- `ensureLoaded(name)` — 并发安全 Promise 锁（同域多并发只触发一次 loader）
- 超时机制：15s 后抛出 `statusCode=503` 错误，state 保持 `loading`（不转为 `failed`）
- 状态单向流转：`unloaded → loading → loaded/failed`

`data-bootstrapper.ts` 重构：
- Stage 7 CrossSell 预加载代码删除
- `loadAuxiliaryDomains()` → `registerLazyDomains()`（8 个域：ClaimsDetail/ClaimsAgg/CrossSell/RepairDim/BrandDim/CustomerFlow/RenewalUniverse/QuoteConversion）
- ClaimsAgg loader 最终回退路径：显式 `await this.lazyRegistry.ensureLoaded('ClaimsDetail')` 再调用 `createClaimsAggFromDetail()`
- 新增公共 API：`ensureDomainLoaded(domain)` + `getDomainState(domain)`
- 所有旧代理方法调用替换为 `domainLoaders.*` / `materialization.*` 直接调用

单元测试（4 个，全绿）：
- 首次 ensureLoaded 触发 loader，二次调用不重复执行
- 并发两次 ensureLoaded：loader 只调用一次
- loader 失败：state=failed，后续立即 throw 同一 error
- 加载超时：statusCode=503，state 保持 loading

### Task 2 — 解耦 PolicyFact/CrossSell + 集中式中间件（commit: 91c171f）

- `duckdb-materialization.ts`：从 `createPolicyFactView` 末尾移除 `createCrossSellRealtimeView` 调用（函数定义本身保留），PolicyFact 物化路径不再依赖 CrossSellFact
- 新建 `bootstrapper-registry.ts`：全局注册中心（`registerBootstrapper` / `getBootstrapper`），解决 `app.ts → shared.ts → app.ts` 循环依赖
- `app.ts`：`startServer()` 中在 bootstrap 前调用 `registerBootstrapper(bootstrapper)`
- `shared.ts`：新增 `createDomainMiddleware(...domains)` 工厂函数，超时 503 / 失败 500 / bootstrapper 未初始化时直接 next()

### Task 3 — 6 条路由注入中间件（commit: 38d91d0）

替换 6 个路由文件的旧式探测中间件（`SELECT 1 FROM VIEW LIMIT 1`）为 `createDomainMiddleware` 调用：

| 路由文件 | 注入域 | 原中间件 |
|----------|--------|---------|
| claims-detail.ts | ClaimsDetail + ClaimsAgg | 有（SELECT 1 探测） |
| cross-sell.ts | CrossSell + ClaimsAgg | 无 |
| repair.ts | RepairDim | 有（SELECT 1 探测） |
| quote-conversion.ts | QuoteConversion | 有（SELECT 1 探测） |
| customer-flow.ts | CustomerFlow | 有（SELECT 1 探测） |
| renewal-v2.ts | RenewalUniverse | 有（SELECT 1 探测） |

## 验证结果

```
bun run build    → 零 TS 错误（✓ built in 12.34s）
bun run test     → 1347 个测试全部通过（新增 4 个）
bun run governance → 23/23 检查通过
```

## 惰性域清单

| 域名 | Loader 文件路径发现 | 说明 |
|------|-------------------|------|
| ClaimsDetail | getClaimsDetailPaths() | 254k 行，最大惰性域 |
| ClaimsAgg | 三路：bulk → agg parquet → ClaimsDetail 聚合 | 最终回退需先确保 ClaimsDetail 加载 |
| CrossSell | getCrossSellPaths() | 加载后调用 createCrossSellRealtimeView |
| RepairDim | getRepairDimPaths() | 1.3MB |
| BrandDim | getBrandDimPaths() | 13MB，最慢加载域 |
| CustomerFlow | getCustomerFlowPaths() | 客户来源去向 |
| RenewalUniverse | getRenewalUniversePaths() | 续保分析 |
| QuoteConversion | getQuoteConversionPaths() | 报价转化 |

## LazyDomainRegistry 实现参数

- 文件：`server/src/services/lazy-domain-registry.ts`（68 行）
- 超时常量：`LAZY_LOAD_TIMEOUT_MS = 15_000`
- 超时错误码：`err.statusCode = 503`
- 失败错误码：无 statusCode（Express 默认 500）

## 性能基准记录

- 首次响应（含惰性加载）：待 VPS 部署后验证
- 二次响应（纯查询）：目标 <500ms（动态 JOIN 基准）
- 启动内存：目标从 ~70% 降至 ~50%（Stage 7 + 8 个辅助域不再预加载）

*注：本 worktree 无 Parquet 数据文件，无法本地启动验证，待 VPS 部署后记录实际数值。*

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - 架构偏差] LazyDomainRegistry 提取为独立文件**

- **Found during:** Task 1 TDD 红色阶段
- **Issue:** 测试文件若从 `data-bootstrapper.ts` 导入 `LazyDomainRegistry`，会触发 `@duckdb/node-api` 原生模块加载链，在 vitest 环境中 crash（Cannot find module @duckdb/node-api）
- **Fix:** 将 `LazyDomainRegistry` 提取到独立文件 `lazy-domain-registry.ts`（无任何外部依赖），测试从此文件直接导入
- **Files modified:** `lazy-domain-registry.ts`（新建）、`data-bootstrapper.ts`（改为 import）、`lazy-domain-registry.test.ts`（import 路径更新）
- **Commit:** a845ea7

**2. [Rule 2 - 循环依赖防护] bootstrapper-registry.ts 注册中心**

- **Found during:** Task 2 实现 createDomainMiddleware 时
- **Issue:** `shared.ts → app.ts → query.ts → shared.ts` 存在循环依赖，无法在 shared.ts 直接 import bootstrapper
- **Fix:** 新建 `bootstrapper-registry.ts` 隔离单例，app.ts 启动时注入，shared.ts 取用，无循环
- **Files modified:** `bootstrapper-registry.ts`（新建）、`app.ts`（注入调用）、`shared.ts`（从 registry 取用）
- **Commit:** 91c171f

## Known Stubs

无。所有 8 个惰性域均已正确注册 loader 闭包，路由中间件链完整。

## Threat Flags

无新增网络端点。现有端点的行为变化（惰性加载 503 响应）已在 STRIDE 威胁注册表中覆盖（T-04-08、T-04-09、T-04-11）。

## Self-Check: PASSED

- [x] `server/src/services/lazy-domain-registry.ts` — 存在
- [x] `server/src/services/bootstrapper-registry.ts` — 存在
- [x] `server/src/services/__tests__/lazy-domain-registry.test.ts` — 存在
- [x] commit a845ea7 — 存在
- [x] commit 91c171f — 存在
- [x] commit 38d91d0 — 存在
- [x] `bun run build` — 通过（零错误）
- [x] `bun run test` — 1347 个测试全部通过
- [x] `bun run governance` — 23/23 通过
