/**
 * 查询参数运行时全局策略。
 *
 * 路由自己的业务参数由 route-param-contracts.ts 管理；这里仅登记所有查询路由都可接受的
 * 横切参数，避免缓存层、RLS 层和严格参数中间件各自维护一份清单。
 */
export const NON_SEMANTIC_QUERY_PARAMS = [
  '_t', '_', 'cacheBust', 'cachebuster', 'timestamp',
] as const;

export const GLOBAL_REGISTERED_QUERY_PARAMS = [
  'targetBranch',
  ...NON_SEMANTIC_QUERY_PARAMS,
] as const;
