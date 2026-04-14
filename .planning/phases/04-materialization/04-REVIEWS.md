---
phase: 4
reviewers: [gemini, opencode]
reviewed_at: 2026-04-14T16:30:00+08:00
plans_reviewed: [04-01-PLAN.md, 04-02-PLAN.md]
skipped: [codex (empty output, exit code 2), claude (self, skipped for independence)]
---

# Cross-AI Plan Review — Phase 4

## Gemini Review

我已完成对 **Phase 4: Materialization Optimization** 两个阶段性计划（04-01 代码拆分与 04-02 懒加载实现）的深度评审。以下是基于项目架构、系统稳定性及性能目标的综合反馈：

### 1. 总体评价 (Summary)
这两个计划展现了极高的工程质量和对系统瓶颈的精准把握。**Plan 04-01** 通过激进的解耦策略解决了 `duckdb.ts` 的"上帝类"问题，为后续维护清除了结构性障碍；**Plan 04-02** 则直接触达性能核心，通过 `LazyDomainRegistry` 和 Promise 锁机制，在不牺牲接口一致性的前提下显著降低了启动负载。整体设计不仅满足了内存降低（70%→50%）和启动加速的目标，还通过"双波次"执行策略有效分散了重构风险，是一套成熟且具备高度可操作性的方案。

### 2. 方案亮点 (Strengths)
- **并发安全设计 (Concurrency Safety)**: 在懒加载中使用 Promise 锁（Task 1, D-10）是处理高并发请求触发初始加载的教科书级做法，有效避免了重复加载和连接池爆涨。
- **渐进式重构策略**: 先进行结构调整（Wave 1），再进行逻辑变更（Wave 2），这种分步实施最大限度保证了在重构过程中 `bun run test` 的持续可验证性。
- **关键路径剥离**: 将 `PolicyFact` 与 `CrossSellFact` 脱钩（D-09）是实现快速启动的"银弹"，彻底打破了域之间复杂的初始化依赖链。
- **测试前置与规范**: 计划中明确包含了新组件的单元测试（`lazy-domain-registry.test.ts`）以及对存量测试文件的修复，确保了重构后的代码质量。

### 3. 潜在隐患与风险 (Concerns)

*   **[MEDIUM] 错误传播的透明度**:
    *   在懒加载模式下，如果 `ensureDomainLoaded` 失败（如 Parquet 文件损坏或 OOM），错误将直接在 API 请求生命周期内爆发。需要确保 `LazyDomainRegistry` 能够捕获并返回清晰的业务错误（如 503 Service Unavailable），而非模糊的 500 错误，以便前端展示"数据初始化中/失败"的状态。
*   **[LOW] `duckdb.ts` 行数目标的"紧箍咒"**:
    *   追求 ≤100 行的目标（D-01）可能导致代码过度压缩，影响可读性。建议优先保证逻辑清晰，即使最终在 120-130 行左右也是巨大的进步，不应为了凑数而牺牲代码风格（如删除必要的注释）。
*   **[MEDIUM] 连接池竞争压力**:
    *   虽然有 Promise 锁防止重复加载，但加载大型 Parquet 文件（如 ClaimsDetail）是重 IO 和重计算任务，可能会长时间占用 DuckDB 连接。如果多个域同时触发懒加载，仍存在连接池短时耗尽的风险。
*   **[HIGH] 动态 JOIN 的性能损耗**:
    *   `PolicyFact` 脱钩后改用动态 JOIN（D-09）。对于大批量查询，动态 JOIN 的执行计划生成和执行开销可能略高于预生成的物化表。需监控交叉销售相关接口在懒加载触发后的响应时间是否符合 <500ms 的目标。

### 4. 改进建议 (Suggestions)

*   **引入加载状态监控**: 在 `LazyDomainRegistry` 中增加简单的日志或指标输出，记录各域从 `unloaded` 到 `loaded` 的耗时，这对于后续分析生产环境的"首跳延迟"至关重要。
*   **连接池优先级管理**: 考虑为懒加载任务（`ensureDomainLoaded`）提供一个专用的或高优先级的连接，或者在加载期间暂时增加连接池上限，防止初始化过程阻塞了其他已就绪域的查询。
*   **细化错误恢复机制**: `LazyDomainRegistry` 的状态转换应允许在特定条件下（如文件不存在修复后）重试，而非永久锁定在 `failed` 状态。
*   **优化 `duckdb.ts` 的导出方式**: 建议使用 `export * from './sub-modules'` 的聚合模式，这样既能保持主文件精简，又能让外部调用者通过单一入口访问，平衡 D-02 提到的 Breaking Change 影响。

### 5. 风险评估 (Risk Assessment)

**总体风险等级：MEDIUM**

**评估理由：**
*   **技术复杂度 (Medium)**: 懒加载逻辑涉及异步竞争锁和 DuckDB 状态管理，属于系统底层改动，容错空间小。
*   **架构收益 (High)**: 计划成功后将彻底解决项目启动慢和内存占用高的长期痛点，对系统稳定性有质的提升。
*   **回滚难度 (Low)**: 计划中包含完整的测试覆盖，且 04-01 不改动业务逻辑，04-02 的变更点集中在中间件和注册器，一旦发现严重问题，回滚到 eager 模式的成本较低。

**结论：建议立即按计划执行。** 请在执行过程中特别关注 `routes/data.ts` 的调用链适配，确保所有管理端操作（如手动触发全量刷新）依然能正确触发所有懒加载域的更新。

---

## OpenCode Review

### Plan 04-01: MAT-02 duckdb.ts Decomposition

**Summary:** Solid decomposition plan that correctly targets the 17 proxy methods as the primary reduction lever. The research is thorough — 666 lines, 17 proxies, only 3 external callers of proxy methods. Wave-1-first ordering is the right call (pure structural refactor, zero behavior change).

**Strengths:**
- Correct identifies that 28 files import duckdb.ts but only 3 (data.ts + 2 test files) use proxy methods — blast radius is tiny
- Reuses existing `DuckDBQueryable` interface pattern — no new coupling mechanism needed
- `duckdb-parquet-loader.ts` extraction is the single biggest win (102 lines of fingerprint caching + incremental logic is genuinely complex)

**Concerns:**
- **MEDIUM:** Plan says "≤110 lines" but research says "~130 lines remain" after extraction. The 20-line gap needs a concrete resolution — which methods get inlined or compressed?
- **MEDIUM:** `routes/data.ts` calls 4 proxy methods (`loadMultipleParquet`, `loadParquet`, `createPolicyFactView`, `dropAllDerivedTables`), not 3 as stated. `createPolicyFactView` import from `duckdb-materialization.ts` passes `this` (DuckDBService) as first arg — this coupling survives the refactor and must be documented
- **LOW:** `loadMultipleParquet` is listed as both "move to parquet-loader" (Task 1) and "keep delegate in main class" (Task 2 Step 2). Clarify: does duckdb.ts re-export it or proxy it?

**Suggestions:**
- Decide upfront: `loadMultipleParquet` stays in duckdb.ts (it uses private `getConnection/releaseConnection` + calls private `computeParquetFingerprint`) — the parquet-loader should export `computeParquetFingerprint` as a standalone, and duckdb.ts keeps the orchestration. Or: refactor ConnectionPool to be externally accessible (it already is — `this.pool` is a public property)
- The `DuckDBQueryable` interface should be updated to include `loadParquet` since `data-bootstrapper.ts` needs it after removing `BootstrapDuckDB`
- Consider whether `DERIVED_RELATIONS` re-export in duckdb.ts should stay or move to duckdb-materialization (test files import it from duckdb.ts)

**Risk Assessment:** **LOW** — Pure structural refactor, well-scoped blast radius (3 call sites), full test coverage exists for affected paths.

---

### Plan 04-02: MAT-01 Lazy Loading

**Summary:** The lazy-loading architecture with Promise-lock is sound for a single-server deployment. The domain registry state machine (unloaded → loading → loaded/failed) correctly handles concurrent access. The CrossSell decoupling plan resolves the real startup blocker identified in research.

**Strengths:**
- Promise-lock pattern is the right concurrency primitive — avoids double-loading without external state
- 8 lazy domains match the 7 auxiliary domains + ClaimsAgg cascade exactly — nothing missed
- One-way state transition (no loaded→unloaded) eliminates entire classes of race conditions
- "First request blocks and waits" decision (D-08) is pragmatic — avoids frontend changes entirely

**Concerns:**
- **HIGH:** ClaimsAgg 3-tier fallback chain is registered as a single lazy domain but has 3 distinct trigger files (ClaimsDetail, ClaimsBulk, ClaimsAgg parquet). If ClaimsDetail loads but ClaimsAgg fallback fails, the domain is marked `failed` — but ClaimsDetail is actually usable. The fallback chain needs per-step state tracking or ClaimsDetail and ClaimsAgg must be separate domains
- **HIGH:** `ensureDomainLoaded('ClaimsAgg')` is registered in both `claims-detail.ts` and `cross-sell.ts`. Cross-sell queries JOIN ClaimsAgg with CrossSellFact — if CrossSell loads first and triggers `ensureDomainLoaded('ClaimsAgg')`, and later ClaimsDetail loads and tries the same, the Promise lock handles it. BUT: `createClaimsAggFromDetail()` (the final fallback) requires `ClaimsDetail` VIEW to exist. If CrossSell triggers ClaimsAgg loading *before* ClaimsDetail is loaded, and the primary/fallback parquets don't exist, `createClaimsAggFromDetail()` will fail because ClaimsDetail VIEW doesn't exist yet. **CrossSell and ClaimsDetail have an implicit load-order dependency through ClaimsAgg.**
- **MEDIUM:** 6 route middleware injections means 6 files change. But `routes/query/shared.ts` is the re-export hub — could a single middleware there intercept *all* query routes? This would reduce the blast radius from 6 files to 1 and guarantee no future route forgets to add lazy-loading
- **MEDIUM:** No circuit-breaker or timeout specified. If a lazy domain takes 60s to load (BrandDim is 13MB), the first user request blocks for 60s with no indication. Consider: lazy-load timeout + 503 response vs. blocking. The success criteria say "reasonable loading time" but this isn't defined
- **LOW:** Error information disclosure (T-04-08) is flagged but the threat model says "accept." If lazy loading fails, the error returned to the user should distinguish between "domain still loading" (409/503) and "domain failed to load" (500). The plan doesn't specify response codes

**Suggestions:**
1. **Resolve ClaimsAgg dependency chain explicitly**: Either (a) split ClaimsDetail and ClaimsAgg into separate lazy domains with ClaimsDetail as a prerequisite, or (b) have `createClaimsAggFromDetail()` lazily ensure ClaimsDetail is loaded first, or (c) remove `createClaimsAggFromDetail()` from the CrossSell route's lazy registration (cross-sell.ts only needs ClaimsAgg if it exists, queries should handle missing ClaimsAgg gracefully)
2. **Centralize middleware in shared.ts**: Add `ensureDomainLoaded` as a query-route-level concern in `routes/query/shared.ts` rather than per-route. Map route paths to required domains in a config object. This eliminates the risk of adding a new route that forgets lazy-loading
3. **Add timeout to lazy loading**: Set a 15s timeout on the Promise lock. If exceeded, return 503 with `{ error: 'Domain {name} is loading, please retry' }`. This protects against slow first-requests blocking the connection pool
4. **Consider a health/readiness endpoint**: Add lazy domain load status to the health check so monitoring can distinguish "still loading" from "loaded" from "failed"

**Risk Assessment:** **MEDIUM** — The ClaimsAgg cross-dependency between ClaimsDetail and CrossSell is a real production risk that could cause first-request failures. The lazy-loading pattern itself is sound, but the domain dependency graph needs explicit mapping before implementation.

---

## Consensus Summary

### Agreed Strengths
- **渐进式双波次策略**（Gemini + OpenCode）：先结构拆分（04-01，无行为变更），再叠加惰性加载（04-02，行为变更），是最稳妥的重构路径
- **Promise 锁并发安全**（Gemini + OpenCode）：教科书级的并发处理模式，避免双重加载和连接池爆涨
- **CrossSell 解耦是关键路径**（Gemini + OpenCode）：打破 PolicyFact ↔ CrossSellFact 的初始化依赖链是实现快速启动的核心
- **测试覆盖完整**（Gemini + OpenCode）：新增 lazy-domain-registry 测试 + 存量测试修复，重构安全性有保障

### Agreed Concerns

| 严重度 | 关注点 | 提出方 |
|--------|--------|--------|
| **HIGH** | ClaimsAgg 三路回退链的依赖顺序问题：CrossSell 触发 ClaimsAgg → createClaimsAggFromDetail() → 需要 ClaimsDetail 但可能还没加载 | OpenCode（详细分析） |
| **HIGH** | PolicyFact 解耦后动态 JOIN 对交叉销售查询的性能影响 | Gemini |
| **MEDIUM** | 连接池竞争：多个大域同时懒加载时连接耗尽风险 | Gemini + OpenCode |
| **MEDIUM** | 懒加载超时未定义（BrandDim 13MB 首次加载可能 60s+） | OpenCode |
| **MEDIUM** | duckdb.ts 行数目标（≤100/110）可能过于激进，实际约 130 行 | Gemini + OpenCode |
| **MEDIUM** | 错误传播透明度不足：503 vs 500 未区分 | Gemini + OpenCode |

### Divergent Views

| 议题 | Gemini | OpenCode |
|------|--------|----------|
| 04-01 风险评级 | MEDIUM（整体评估） | LOW（纯结构重构） |
| 中间件注入方式 | 未提及集中化方案 | 建议集中到 shared.ts 减少 6 文件变更 |
| 错误恢复 | 建议允许 failed→retry 重试 | 接受 failed 永久锁定（单向状态机） |
| loadMultipleParquet 归属 | 未讨论 | 指出 Task 1 和 Task 2 描述矛盾 |

---

*Phase: 04-materialization*
*Reviewed: 2026-04-14 by Gemini + OpenCode (Codex skipped — empty output)*
