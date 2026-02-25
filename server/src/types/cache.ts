/**
 * 查询缓存系统 - 类型定义
 *
 * 用于优化重复查询性能，减少后端 DuckDB 重复查询次数
 */

/**
 * 缓存条目
 */
export interface CacheEntry<V> {
  /** 缓存值 */
  value: V;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 最后访问时间（毫秒时间戳） */
  accessedAt: number;
  /** 访问次数（用于LRU淘汰） */
  accessCount: number;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 当前缓存条目数 */
  size: number;
  /** 最大缓存条目数 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率（0-1） */
  hitRate: number;
  /** 总内存占用（估算，字节） */
  memoryUsage: number;
}

/**
 * 缓存配置选项
 */
export interface CacheOptions {
  /** 最大缓存条目数（默认100） */
  maxSize?: number;
  /** 条目过期时间（毫秒，默认5分钟） */
  ttl?: number;
  /** 是否启用统计（默认true） */
  enableStats?: boolean;
  /** 是否启用调试日志（默认false） */
  debug?: boolean;
}

/**
 * 缓存键生成器
 */
export type CacheKeyGenerator<T> = (params: T) => string;

/**
 * 序列化参数（用于生成缓存键）
 */
export type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Serializable[]
  | { [key: string]: Serializable };

/**
 * SQL查询缓存键
 */
export interface SQLCacheKey {
  /** SQL语句（标准化后，移除多余空格） */
  sql: string;
  /** 查询参数（如果有） */
  params?: Record<string, Serializable>;
}

/**
 * 查询缓存条目特定类型（Arrow.Table或JSON数据）
 */
export type QueryCacheEntry = CacheEntry<{
  /** Arrow Table数据或JSON */
  data: any;
  /** 行数 */
  rowCount: number;
}>;
