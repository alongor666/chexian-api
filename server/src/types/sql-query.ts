/**
 * SQL 查询功能类型定义
 *
 * 用于交互式 SQL 查询功能的 TypeScript 类型
 */

// Apache Arrow dependency removed — query results are now plain JSON objects

/**
 * 查询模板分类
 */
export type QueryCategory = 'KPI' | '分析' | '趋势' | '示例' | '增长分析' | '达成分析' | '续保分析';

/**
 * 参数类型
 */
export type ParameterType = 'date' | 'daterange' | 'select' | 'multiselect' | 'number' | 'text';

/**
 * 查询参数验证规则
 */
export interface ParameterValidation {
  /** 最小值（数字类型） */
  min?: number;
  /** 最大值（数字类型） */
  max?: number;
  /** 正则表达式（文本类型） */
  pattern?: string;
  /** 错误提示信息 */
  message?: string;
}

/**
 * 动态选项配置（用于 select/multiselect 类型）
 */
export interface DynamicOptionsConfig {
  /** 查询 SQL（必须包含聚合，返回 DISTINCT 值） */
  query: string;
  /** 值列名 */
  valueColumn: string;
  /** 标签列名（可选，默认同 valueColumn） */
  labelColumn?: string;
  /** 是否缓存结果 */
  cache?: boolean;
}

/**
 * 查询参数定义
 */
export interface QueryParameter {
  /** 参数名（SQL 占位符） */
  name: string;
  /** UI 显示标签 */
  label: string;
  /** 参数类型 */
  type: ParameterType;
  /** 是否必填 */
  required: boolean;
  /** 默认值 */
  defaultValue?: any;

  /** 是否继承全局筛选器（默认 true） */
  inheritsGlobalFilter?: boolean;
  /** 对应的全局筛选器字段（用于防重复筛选） */
  globalFilterKey?: string;
  /** 覆盖全局筛选时的警告提示 */
  overrideWarning?: string;

  /** 静态选项（select/multiselect 类型） */
  options?: Array<{ label: string; value: string | number }>;
  /** 动态选项配置（select/multiselect 类型） */
  dynamicOptions?: DynamicOptionsConfig;

  /** 验证规则 */
  validation?: ParameterValidation;

  /** 帮助文本 */
  helpText?: string;
}

/**
 * 查询模板数据结构
 */
export interface QueryTemplate {
  /** 模板唯一标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 分类 */
  category: QueryCategory;
  /** SQL 查询语句（支持字符串模板或函数） */
  sql: string | ((params: Record<string, any>, globalFilters?: any) => string);
  /** 参数定义列表 */
  parameters?: QueryParameter[];
}

/**
 * SQL 验证结果
 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 错误信息（验证失败时） */
  error?: string;
  /** 警告信息（可选） */
  warnings?: string[];
}

/**
 * 查询执行状态
 */
export type QueryStatus = 'idle' | 'running' | 'success' | 'error';

/**
 * 查询结果数据结构
 */
export interface QueryResult {
  /** 查询结果数据（JSON 对象数组） */
  data: Record<string, any>[] | null;
  /** 行数 */
  rowCount: number;
  /** 列数 */
  columnCount: number;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 执行状态 */
  status: QueryStatus;
  /** 错误信息 */
  error?: string;
  /** 执行的 SQL 语句 */
  sql: string;
  /** 执行时间戳 */
  timestamp: number;
}

/**
 * 查询历史记录项
 */
export interface QueryHistoryItem {
  /** 历史记录 ID */
  id: string;
  /** SQL 语句 */
  sql: string;
  /** 执行时间戳 */
  timestamp: number;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 行数 */
  rowCount: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 分页配置
 */
export interface PaginationConfig {
  /** 当前页码（从 1 开始） */
  currentPage: number;
  /** 每页行数 */
  pageSize: number;
  /** 总行数 */
  totalRows: number;
  /** 总页数 */
  totalPages: number;
}

/**
 * 导出格式
 */
export type ExportFormat = 'CSV' | 'Excel';

/**
 * 查询执行器配置
 */
export interface QueryExecutorConfig {
  /** 查询超时时间（毫秒） */
  timeout?: number;
  /** 最大结果行数 */
  maxRows?: number;
}
