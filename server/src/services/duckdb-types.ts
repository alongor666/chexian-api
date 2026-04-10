/**
 * DuckDB 可查询接口
 *
 * 由 DuckDBService 实现，供拆分模块（materialization / domain-loaders）依赖注入使用。
 * 打破循环依赖：模块依赖接口而非具体类。
 */
export interface DuckDBQueryable {
  query<T = any>(sql: string, cacheTtlMs?: number): Promise<T[]>;
  getTableSchema(tableName: string): Promise<any[]>;
  hasRelation(relationName: string): Promise<boolean>;
  dropRelationIfExists(relationName: string): Promise<void>;
  invalidateCache(options?: { silent?: boolean }): void;
}
