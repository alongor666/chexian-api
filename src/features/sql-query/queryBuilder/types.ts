/**
 * SQL 查询构建器类型定义
 *
 * 定义可视化查询构建器的核心类型
 */

/**
 * 字段类型
 */
export type FieldType = 'dimension' | 'measure';

/**
 * 数据类型
 */
export type DataType = 'string' | 'number' | 'date' | 'boolean';

/**
 * 聚合函数
 */
export type AggregateFunction = 'SUM' | 'AVG' | 'COUNT' | 'COUNT_DISTINCT' | 'MIN' | 'MAX';

/**
 * 筛选操作符
 */
export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'IN'
  | 'NOT IN'
  | 'LIKE'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN';

/**
 * 排序方向
 */
export type SortDirection = 'ASC' | 'DESC';

/**
 * 字段定义
 */
export interface FieldDefinition {
  /** 字段标识（PolicyFact 视图中的列名） */
  field: string;
  /** 显示名称 */
  label: string;
  /** 字段类型 */
  type: FieldType;
  /** 数据类型 */
  dataType: DataType;
  /** 可用的聚合函数（仅度量字段） */
  aggregates?: AggregateFunction[];
  /** 默认聚合函数 */
  defaultAggregate?: AggregateFunction;
  /** 字段描述 */
  description?: string;
  /** 分组标签（用于 UI 分组显示） */
  group?: string;
}

/**
 * 选中的维度
 */
export interface SelectedDimension {
  /** 字段名 */
  field: string;
  /** 别名（可选） */
  alias?: string;
}

/**
 * 选中的度量
 */
export interface SelectedMeasure {
  /** 字段名 */
  field: string;
  /** 聚合函数 */
  aggregate: AggregateFunction;
  /** 别名 */
  alias: string;
}

/**
 * 筛选条件
 */
export interface FilterCondition {
  /** 唯一标识 */
  id: string;
  /** 字段名 */
  field: string;
  /** 操作符 */
  operator: FilterOperator;
  /** 值（单值或数组） */
  value: string | string[] | null;
  /** 第二个值（用于 BETWEEN） */
  value2?: string;
}

/**
 * 排序配置
 */
export interface SortConfig {
  /** 排序字段（可以是维度或度量别名） */
  field: string;
  /** 排序方向 */
  direction: SortDirection;
}

/**
 * 查询构建器状态
 */
export interface QueryBuilderState {
  /** 选中的维度 */
  dimensions: SelectedDimension[];
  /** 选中的度量 */
  measures: SelectedMeasure[];
  /** 筛选条件 */
  filters: FilterCondition[];
  /** 排序配置 */
  orderBy: SortConfig | null;
  /** 结果限制 */
  limit: number;
}

/**
 * 预设度量配置
 */
export interface PresetMeasure {
  /** 预设标识 */
  id: string;
  /** 显示名称 */
  label: string;
  /** 字段名 */
  field: string;
  /** 聚合函数 */
  aggregate: AggregateFunction;
  /** 生成的别名 */
  alias: string;
  /** 描述 */
  description?: string;
}

/**
 * 查询构建器动作
 */
export type QueryBuilderAction =
  | { type: 'ADD_DIMENSION'; field: string }
  | { type: 'REMOVE_DIMENSION'; field: string }
  | { type: 'ADD_MEASURE'; measure: SelectedMeasure }
  | { type: 'REMOVE_MEASURE'; alias: string }
  | { type: 'ADD_FILTER'; filter: FilterCondition }
  | { type: 'UPDATE_FILTER'; id: string; updates: Partial<FilterCondition> }
  | { type: 'REMOVE_FILTER'; id: string }
  | { type: 'SET_ORDER_BY'; orderBy: SortConfig | null }
  | { type: 'SET_LIMIT'; limit: number }
  | { type: 'RESET' }
  | { type: 'LOAD_STATE'; state: QueryBuilderState };
