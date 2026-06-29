/**
 * Agent 诊断查询的统一缓存策略。
 *
 * 背景：各 Agent 诊断服务此前直接 `duckdbService.query(sql)` 调用，第二参
 * cacheTtlMs 缺省为 0 → 旁路了 duckdb.ts 内置 queryCache，在 4核4G VPS 上
 * 重复诊断（相同筛选参数）会反复重算整套聚合 SQL。
 *
 * 安全性：queryCache 以**完整 SQL 字符串**为 key（不同筛选参数自然产生不同
 * key），且在 ETL 数据刷新时由 `duckdbService.invalidateCache()` 的
 * queryCacheEpoch 自增整体失效。因此对 Agent 聚合查询施加 TTL **不会读到陈旧
 * 数据**——同一参数在两次 ETL 之间本就应返回相同结果。
 *
 * TTL 取值与 `routes/query/shared.ts` 的 `QUERY_CACHE.hotspotLong`（重查询档，
 * 4 小时）对齐，但常量定义在 agent 服务层，避免 service → routes 的反向依赖。
 */
export const AGENT_QUERY_CACHE_TTL_MS = 14_400_000; // 4 小时

/** duckdbService 的最小只读视图：仅暴露带默认 TTL 的 query */
export interface AgentDuckdb {
  query<T = unknown>(sql: string, ttlMs?: number): Promise<T[]>;
}

/**
 * 获取带默认缓存 TTL 的 duckdb 查询入口。
 *
 * Agent 服务用 `const duckdbService = await getAgentDuckdb();` 替代原先的
 * `const { duckdbService } = await import('../../services/duckdb.js');`，
 * 之后所有 `.query<T>(sql)` 调用自动带上 AGENT_QUERY_CACHE_TTL_MS，
 * 无需逐个调用点传 TTL。需覆盖时仍可显式传第二参。
 */
export async function getAgentDuckdb(): Promise<AgentDuckdb> {
  const { duckdbService } = await import('../../services/duckdb.js');
  return {
    query: <T = unknown>(sql: string, ttlMs: number = AGENT_QUERY_CACHE_TTL_MS): Promise<T[]> =>
      duckdbService.query<T>(sql, ttlMs),
  };
}
