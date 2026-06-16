/**
 * 立方体灰度 5 路由白名单 — 单一事实源（SSOT）。
 *
 * 新增 cube 路由只改本文件，下游自动跟上：
 *   - scripts/check-governance.mjs `checkCubeShadowRouteCoverage` 读 SHADOW_KEYS
 *   - scripts/cube-burnin/lib/shadow-judge.mjs 读 SHADOW_KEYS
 *   - scripts/cube-burnin/lib/route-runner.mjs 读 CUBE_ROUTES
 *
 * 字段语义：
 *   key       — 路由短名，本地用于 burn-in CLI 日志
 *   path      — HTTP path（必须与 server/src/routes/query/*.ts 注册一致）
 *   shadowKey — 影子对账 stats key（必须与 routes/query/*.ts 的 runShadowCompare 第一参数一致）
 *
 * 历史：PR #651（governance）+ PR #652（burn-in）合并后抽出。同一白名单三处独立定义改为单源。
 */
export const CUBE_ROUTES = Object.freeze([
  { key: 'trend',    path: '/api/query/trend',            shadowKey: 'trend' },
  { key: 'growth',   path: '/api/query/growth',           shadowKey: 'growth' },
  { key: 'cost',     path: '/api/query/cost',             shadowKey: 'cost' },
  { key: 'kpi',      path: '/api/query/kpi',              shadowKey: 'kpi' },
  { key: 'salesman', path: '/api/query/salesman-ranking', shadowKey: 'salesman-ranking' },
]);

export const SHADOW_KEYS = Object.freeze(CUBE_ROUTES.map(r => r.shadowKey));
