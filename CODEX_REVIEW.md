# 分支代码审查报告（`main...HEAD`）

## 1. 审查范围与方法
- 对比范围：`main...HEAD`（分支：`codex-review-mar3`）
- 重点文件：
  - 后端：`server/src/services/duckdb.ts`、`server/src/app.ts`、`server/src/routes/query.ts`、`server/src/routes/data.ts`
  - 前端：`src/shared/contexts/DataContext.tsx`、`src/features/auth/*Guard*.tsx`、`src/features/auth/LoginPage.tsx`、`src/features/home/DataImportPage.tsx`、`src/shared/utils/redirect-state.ts`
  - 脚本：`scripts/benchmark-key-routes*.mjs`
  - 测试：新增 `tests/realtime-aggregation-contract.test.ts`、`tests/redirect-state.test.ts`、`tests/route-redirect-guards.test.tsx`、`tests/e2e/04-subpage-no-refresh.spec.ts`
- 实际验证：
  - `bun run test --run`：54 文件、743 测试全部通过
  - `bun run build`：通过

## 2. 总体结论
当前分支在“重定向状态统一”和“测试补齐”方面有进展，但存在**阻塞合并的架构/性能风险**：将服务改为全实时查询后，已移除 VPS 预聚合路径，和仓库既有的 VPS 分层架构原则冲突，且缺乏等价性能验证与内存门禁收紧。**不建议直接合并到生产环境。**

---

## 3. 主要问题（按严重级别排序）

### [Critical] 全实时改造移除了 VPS 预聚合路径，存在生产内存与可用性回归风险
- 证据：
  - `server/src/app.ts:121` 固定启用 realtime-only 启动路径
  - `server/src/services/duckdb.ts:470-517` `createPolicyFactView()` 改为全环境从原始 Parquet 构建
  - `server/src/services/duckdb.ts:524-549` 新增 `PolicyFactRealtime` 物化（额外数据副本）
  - `server/src/services/duckdb.ts:559-667` `CrossSellDailyAgg` 改为实时视图（不再是预聚合表）
  - `server/src/routes/query.ts:554`、`server/src/routes/query.ts:721` 关键路由统一回到 `PolicyFact` 查询
- 风险：
  - VPS 上热点路由将从“查预聚合”退化为“查行级 + 运行时聚合”，高并发时更容易触发高内存、慢查询、5xx。
  - `PolicyFactRealtime` 物化增加内存占用峰值，放大 OOM 风险。
- 建议：
  - 恢复 `VPS_MODE` 分支（VPS 查预聚合，本地可保留实时模式）。
  - 若坚持实时化，必须补齐等价压测与内存证据（至少覆盖 cross-sell/performance/dashboard 热点路由）。

### [High] 压测门禁默认 RSS 阈值过宽，无法拦截真实 VPS 风险
- 证据：
  - `scripts/benchmark-key-routes.mjs:427` 默认 `maxRssMb=1229`
  - `scripts/benchmark-key-routes-soak.mjs:208` 默认 `maxRssMb=1229`
- 风险：
  - 在 2核4G VPS 约束下，该阈值会让明显超标的内存回归仍然“门禁通过”，失去预警意义。
- 建议：
  - 将默认阈值收紧到生产目标值（例如 600MB），并在 CI 中强制 `strictGate=true`。

### [Medium] `cross-sell` 的 `maxDate` 来源与统计口径不一致，可能导致前端展示日期偏差
- 证据：
  - `server/src/routes/query.ts:1511-1515`、`server/src/routes/query.ts:1895-1897` 改为从 `PolicyFact` 取 `maxDate`
  - 但 `CrossSellDailyAgg` 口径额外约束 `dedup_key IS NOT NULL`（`server/src/services/duckdb.ts:609-614`, `:643`）
- 风险：
  - 当最新日期数据在 `PolicyFact` 存在但被 `CrossSellDailyAgg` 口径过滤时，`maxDate` 会晚于实际统计结果日期，造成 UI“截至日期”与图表不一致。
- 建议：
  - `maxDate` 查询应复用与结果同一口径（同源表/同过滤条件）。

### [Medium] 新增调试日志包含账号与来源路径，存在信息暴露面
- 证据：
  - `src/features/auth/LoginPage.tsx:129` 记录 `username` 与 `targetPath`
  - `src/features/auth/AuthGuard.tsx:40`、`src/components/layout/DataGuard.tsx:40`、`src/features/auth/RouteAccessGuard.tsx:30` 记录 `fromPath`
- 风险：
  - 日志采集到集中平台后，可能暴露账号标识与业务页面路径/查询参数。
- 建议：
  - 账号字段脱敏（hash/掩码），`fromPath` 至少去掉 querystring；生产环境默认关闭该级别日志。

### [Medium] 测试覆盖主要验证“SQL 指向 PolicyFact”，未覆盖实时化核心风险
- 证据：
  - `tests/realtime-aggregation-contract.test.ts` 仅校验 SQL 字符串 `contain/not contain`
  - 新增 `tests/e2e/04-subpage-no-refresh.spec.ts` 为导航流程验证，不覆盖性能/内存/口径等价
- 风险：
  - 当前测试可以保证“走实时路径”，但不能保证“结果正确且性能可接受”。
- 建议：
  - 增加以下回归测试：
    - 预聚合 vs 实时聚合结果一致性（同筛选条件的数值对齐）
    - 热点接口性能基线断言（P95/P99/5xx）
    - VPS 内存峰值门禁（RSS 上限）

---

## 4. 代码质量与最佳实践观察
- 正向：
  - `src/shared/utils/redirect-state.ts` 把 `fromPath` 状态契约统一，兼容历史 state 结构，降低重定向竞态。
  - `DataContext` 引入 loading counter，改善并发请求时的加载状态一致性。
- 需改进：
  - 本次关键变更（实时化替代预聚合）缺少“等价验证证据”随 PR 一并提交（尤其是性能和内存）。

## 5. 安全审查结论
- 未发现新的明显 SQL 注入风险（本次变更未放宽 SQL 输入边界）。
- 主要安全关注点为日志信息暴露（见上文 Medium）。

## 6. 测试覆盖结论
- 已执行并通过：
  - `bun run test --run`（全量）
  - `bun run build`
- 覆盖缺口：
  - 未看到针对“实时化后 VPS 可用性”对应的自动化验证（内存、5xx、慢查询门禁）。

## 7. 合并建议
- 结论：**暂不建议合并到生产分支**。
- 最低整改清单：
  1. 恢复/保留 VPS 预聚合路径，或提交充分的实时化等价压测证据。
  2. 收紧压测脚本默认 RSS 阈值并纳入 CI 强制门禁。
  3. 修复 `cross-sell maxDate` 口径一致性。
  4. 调整日志脱敏策略。
