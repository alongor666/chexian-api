/**
 * 增量导入类型定义
 *
 * 支持增量数据加载，避免全量替换
 */

/**
 * 数据变更类型
 */
export enum DataChangeType {
  INSERT = 'INSERT',    // 新增数据
  UPDATE = 'UPDATE',    // 更新数据
  DELETE = 'DELETE',    // 删除数据
  REPLACE = 'REPLACE',  // 替换数据（全量）
}

/**
 * 数据变更记录
 */
export interface DataChange {
  /** 变更类型 */
  type: DataChangeType;
  /** 主键值（用于标识记录） */
  primaryKey: string;
  /** 变更前的数据（UPDATE/DELETE时） */
  oldData?: Record<string, any>;
  /** 变更后的数据（INSERT/UPDATE时） */
  newData?: Record<string, any>;
  /** 变更时间戳 */
  timestamp: number;
}

/**
 * 增量加载结果
 */
export interface IncrementalLoadResult {
  /** 是否成功 */
  success: boolean;
  /** 变更记录 */
  changes: DataChange[];
  /** 新增记录数 */
  insertCount: number;
  /** 更新记录数 */
  updateCount: number;
  /** 删除记录数 */
  deleteCount: number;
  /** 替换记录数（全量） */
  replaceCount: number;
  /** 处理耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 增量加载配置
 */
export interface IncrementalLoadConfig {
  /** 主键字段名 */
  primaryKeyField: string;
  /** 比较字段（用于检测变更，如update_time） */
  compareFields?: string[];
  /** 批量处理大小 */
  batchSize?: number;
  /** 是否启用去重（基于主键） */
  enableDeduplication?: boolean;
  /** 变更检测阈值（毫秒，用于判断数据是否变化） */
  changeThreshold?: number;
}

/**
 * 数据快照（用于比较变更）
 */
export interface DataSnapshot {
  /** 快照时间戳 */
  timestamp: number;
  /** 数据行数 */
  rowCount: number;
  /** 主键集合 */
  primaryKeys: Set<string>;
  /** 数据哈希（可选，用于快速比较） */
  hash?: string;
}

/**
 * 增量加载状态
 */
export interface IncrementalLoadState {
  /** 当前数据版本 */
  version: number;
  /** 最后加载时间 */
  lastLoadTime: number;
  /** 总记录数 */
  totalRecords: number;
  /** 最后快照 */
  lastSnapshot: DataSnapshot;
  /** 是否有待处理的变更 */
  hasPendingChanges: boolean;
}
