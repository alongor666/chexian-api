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

/** 需要单连接事务写能力的基础设施路径使用，避免扩大只读/查询型测试桩契约。 */
export interface DuckDBTransactionalQueryable extends DuckDBQueryable {
  transaction(statements: string[]): Promise<void>;
}
