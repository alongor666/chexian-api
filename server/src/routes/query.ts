/**
 * 查询路由 — 薄代理层
 *
 * 原 2789 行已拆分为 server/src/routes/query/ 下 13 个模块：
 *   shared.ts / kpi.ts / trend.ts / truck.ts / growth.ts / coefficient.ts
 *   cost.ts / comprehensive.ts / renewal.ts / cross-sell.ts / salesman.ts
 *   report.ts / premium-plan.ts / performance.ts / bundles.ts / index.ts
 *
 * 此文件仅做 re-export，保持对外接口不变。
 * 完整原文备份：query.legacy.ts
 */

export { default } from './query/index.js';
export { buildRouteCacheKey, fetchDashboardBundleData } from './query/index.js';
