# KPI route cache regression fix plan

## 审计结论

本轮只针对已观测到的 `/api/query/kpi` 性能回归，不扩散成通用性能工程。

自动化记忆补充证据：

- 2026-05-08 主工作区日志中，KPI warm hit p95 已是 0-1ms，cold miss 仍是尾部风险：`/api/query/kpi` miss `n=48, p95=1625ms, p99=1750ms`。
- 2026-05-10 主工作区日志中，`/api/query/kpi` 明显回归：`n=44, hit=0, miss=44, 5xx=20, p95=9475ms, p99=36959ms, max=36959ms`。
- 同一自动化记忆把最强根因候选锁定为 `_t` 等非语义 query 参数击穿 route cache，并把连接池调参列为 P0/P1 修复后的证据驱动事项。

当前代码事实：

- `server/src/routes/query/shared.ts` 的 `buildRouteCacheKey()` 会把 `req.query` 全量拼入 route cache key。
- `server/src/utils/filter-params.ts` 的 `commonFilterSchema` 会 strip 未知字段，因此 `_t`、`_`、`cacheBust`、`timestamp` 等字段可能改变缓存 key，但不改变 SQL 语义。
- `/api/query/kpi` 已接入 `withRouteCache('kpi', QUERY_CACHE.hotspotShort)`，并且底层 `duckdbService.query(sql, QUERY_CACHE.hotspotShort)` 也有 SQL 结果缓存。
- 当前 worktree 没有 `logs/audit.log`、`node_modules`、`server/node_modules`、`artifacts/perf`，这里只能完成代码修复和单元验证；回归是否消失必须在主工作区或 VPS 用真实日志与 benchmark 复验。

计划需要修正的点：

1. P0 正确，但实现不能用“只保留 commonFilterSchema 字段”的 allowlist，否则会误删 `groupBy`、`drillPath`、`granularity`、`timePeriod`、`segmentTag`、`growthMode`、`limit`、`perspective` 等路由级真实业务参数。
2. `_t` benchmark 不能只加一个静态 `_t=123` 路由。静态 `_t` 第二次仍会命中缓存，无法复现前端 cache-buster 每次变化导致的冷 miss。必须做“每次请求动态生成不同 `_t`”的场景。
3. “冷 miss p95 回到 1.6s”不能作为 P0 的直接验收。P0 解决的是非语义参数造成的重复冷 miss；真正单个冷 key 的 SQL 延迟不一定被 P0 降低。验收应拆成：cache-bust 重复请求变成 warm-hit 行为、KPI 5xx 清零、真实 cold miss 与历史基线可比。
4. P1 的 route-cache 层 singleflight 在当前 Express 中间件结构下改造面较大，需要捕获首个响应体并给等待请求 replay。优先改 `DuckDBService.query(sql, cacheTtlMs > 0)` 的 SQL-cache singleflight，更小、更可测，也直接阻断同一 KPI SQL 并发打爆 DuckDB。

## 修订目标

验收目标分三层：

- KPI 5xx 清零：benchmark 与 audit log 中 `/api/query/kpi` 不再出现 5xx。
- cache-buster 不击穿缓存：同一业务查询每次只变化 `_t`、`_`、`cacheBust`、`timestamp` 时，route cache key 一致；benchmark 中动态 `_t` 场景应接近 warm hit，而不是每次冷 miss。
- 冷 miss 有证据：真实 cold KPI p95 与历史同口径基线对比；若仍高于约 1.6s，需要继续定位 SQL、连接池或并发压力，不把 P0 误判为失败。

## P0：修 route cache key 非语义参数

修改文件：

- `server/src/routes/query/shared.ts`
- 新增 `server/src/routes/query/__tests__/shared-cache-key.test.ts`

实现要求：

- 在 `buildRouteCacheKey()` 中增加非语义 query 参数 denylist：`_t`、`_`、`cacheBust`、`cachebuster`、`timestamp`。
- 保持 denylist 方式，不改成业务字段 allowlist，避免误删各 route 的真实筛选参数。
- 保留 `routeName`、`req.permissionFilter`、完整语义 query、`getDataVersion()`。
- 对数组值继续稳定序列化，query key 排序保持确定性。
- 不改变 `commonFilterSchema` 的业务解析口径。

必须新增单测：

- 两个 KPI 请求只差 `_t` 时，`buildRouteCacheKey()` 结果一致。
- `_`、`cacheBust`、`timestamp` 同样被忽略。
- `startDate`、`endDate`、`dateField`、`orgNames`、`salesmanNames` 不同，key 必须不同。
- `permissionFilter` 不同，key 必须不同。
- `groupBy`、`drillPath`、`granularity` 等 route-specific 业务参数必须保留进 key。
- `dataVersion` 变化时 key 必须不同。

验证命令：

```bash
bun test --run server/src/routes/query/__tests__/shared-cache-key.test.ts
```

## P1：对可缓存 SQL 增加 in-flight coalescing

修改文件：

- `server/src/services/duckdb.ts`
- `server/src/services/__tests__/duckdb-query-cache.test.ts`

实现要求：

- 只对 `cacheTtlMs > 0` 的 SQL 启用 singleflight，`cacheTtlMs = 0` 保持每次执行。
- key 使用完整 SQL 字符串；权限条件和筛选条件已体现在 SQL 内，不另造语义 key。
- 流程为：先查 QueryCache；未命中再查 `inflightQueries`；已有同 SQL promise 则等待；没有则创建 promise 执行 DuckDB。
- 成功后写入 QueryCache；失败后必须 `delete inflightQueries[key]`，不能缓存失败。
- `finally` 清理 in-flight 状态，避免 promise 残留。

必须新增单测：

- 20 个并发相同 SQL 且 `cacheTtlMs > 0` 的查询，只触发 1 次底层 `runAndReadAll`。
- 失败的 in-flight 查询不会污染后续请求；下一次相同 SQL 会重新执行。
- `cacheTtlMs = 0` 的相同 SQL 并发不被合并。

说明：

- 这一步优先放在 SQL cache 层，而不是 route-cache 层，是因为当前 `withRouteCache()` 是 Express 中间件拦截 `res.json()` 的结构。route-cache singleflight 需要首个请求捕获完整响应并给等待请求 replay，改造面大于本轮 KPI 回归所需。
- 若 P0 + SQL singleflight 后 benchmark 仍显示 route 层非 SQL 工作重复消耗，再单独评估 route-cache replay 型 singleflight。

验证命令：

```bash
bun test --run server/src/services/__tests__/duckdb-query-cache.test.ts
```

## P1：补 benchmark 真实退化场景

修改文件：

- `scripts/benchmark-key-routes.mjs`
- 必要时修改 `scripts/benchmark-key-routes-soak.mjs`

实现要求：

- 在 key routes 中加入普通 KPI 场景：
  `/api/query/kpi?dateField=policy_date&startDate=${yearStart}&endDate=${today}`
- 加入动态 cache-buster KPI 场景：同一业务查询每次请求动态生成不同 `_t`，例如 `_t=${Date.now()}-${i}`。
- benchmark 结果中保留 scenario label，至少区分 `kpi` 与 `kpi-cache-bust-dynamic`，避免两个结果都只显示 `/api/query/kpi`。
- 输出仍写入 `artifacts/perf/`，并保留 cold/warm p95、p99、失败数、状态码分布、RSS、baseline comparison。
- 对 cache-bust 场景，P0 后预期是 warm iterations 接近 warm hit；P0 前预期是每次动态 `_t` 都接近 cold miss。

验证命令：

```bash
bun run benchmark:key-routes -- --base-url http://127.0.0.1:3000 --username "$BENCH_USERNAME" --password "$BENCH_PASSWORD"
```

## P2：连接池参数仅做证据驱动调优

暂不修改：

- `server/src/config/env.ts` 的 `DUCKDB_MAX_CONNECTIONS`
- `server/src/services/duckdb-infra.ts` 的 `ACQUIRE_TIMEOUT_MS`
- `server/src/services/duckdb-infra.ts` 的 `MAX_WAIT_QUEUE`

只有同时满足以下条件才进入调参：

- P0、P1 后仍有 acquire timeout 或 queue full。
- soak 报告显示 RSS 距离上限有余量。
- `logs/audit.log` 仍显示 `/api/query/kpi` 或 dashboard bundle 有 2s 级失败。

调参方式：

- VPS 对比 `DUCKDB_MAX_CONNECTIONS=8` 与 `DUCKDB_MAX_CONNECTIONS=10`。
- 只在有排队超时证据时评估 `ACQUIRE_TIMEOUT_MS=3000` 或 `5000`。
- 同时观察 p95、p99、5xx、RSS、pool waiting，不看单次请求。

## 实施顺序

1. 新增 `shared-cache-key.test.ts`，先复现 `_t` 分裂问题。
2. 实现 `buildRouteCacheKey()` denylist 过滤。
3. 跑 shared cache key 单测。
4. 新增 DuckDB SQL-cache singleflight 测试，先复现并发相同 SQL 重复执行。
5. 实现 `DuckDBService.query()` in-flight coalescing。
6. 跑 `duckdb-query-cache.test.ts`。
7. 修改 benchmark 脚本，加入普通 KPI 与动态 `_t` KPI 场景。
8. 在具备依赖、数据和日志的主工作区或 VPS 跑 benchmark，保存 `artifacts/perf/` 报告。
9. 对比 `logs/audit.log`：重点看 `/api/query/kpi` 的 cache hit、5xx、p95、p99、acquire timeout。

## 最小验收命令

```bash
bun test --run server/src/routes/query/__tests__/shared-cache-key.test.ts
bun test --run server/src/services/__tests__/duckdb-query-cache.test.ts
bun run build
bun run benchmark:key-routes -- --base-url http://127.0.0.1:3000 --username "$BENCH_USERNAME" --password "$BENCH_PASSWORD"
```

若当前 worktree 缺少 `node_modules`、真实数据或 `logs/audit.log`，只在这里完成代码级验证；性能验收必须切到主工作区或 VPS。

## 执行记录

2026-05-11 专项分支 `codex/kpi-cache-regression-fix` 已完成代码级落地：

- `buildRouteCacheKey()` 已忽略 `_t`、`_`、`cacheBust`、`cachebuster`、`timestamp`，并保留真实业务 query、权限过滤和 dataVersion。
- `DuckDBService.query()` 已对 `cacheTtlMs > 0` 的同 SQL in-flight 请求做合并；失败会清理 in-flight；cache invalidation 跨越 in-flight 查询时不会把旧结果写回 SQL cache。
- `benchmark-key-routes.mjs` 和 `benchmark-key-routes-soak.mjs` 已加入普通 KPI 与动态 `_t` KPI 场景，并在报告中输出 scenario label。

已验证：

```bash
bun test --run server/src/routes/query/__tests__/shared-cache-key.test.ts server/src/services/__tests__/duckdb-query-coalescing.test.ts server/src/services/__tests__/duckdb-query-cache.test.ts
node --check scripts/benchmark-key-routes.mjs && node --check scripts/benchmark-key-routes-soak.mjs
cd server && bun run build
bun run typecheck
bun run build
```

剩余性能验收：

- 在主工作区或 VPS 启动真实服务后运行 `bun run benchmark:key-routes -- --base-url http://127.0.0.1:3000 --username "$BENCH_USERNAME" --password "$BENCH_PASSWORD"`。
- 对比 `artifacts/perf/` 报告与 `logs/audit.log`，重点确认 `/api/query/kpi` 动态 `_t` 场景不再产生重复冷 miss，5xx 清零，p95/p99 回到可接受区间。
