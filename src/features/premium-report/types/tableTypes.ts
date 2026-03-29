/**
 * 通用表格类型定义（从 marketing-report 迁移）
 */

/**
 * 表格排序状态
 */
export interface SortState {
  /** 排序列名 */
  column: string;
  /** 排序方向 */
  direction: 'asc' | 'desc';
}

/**
 * 表格列定义
 */
export interface TableColumn<T> {
  /** 列键名 */
  key: keyof T;
  /** 表头文本 */
  header: string;
  /** 列宽度 */
  width?: number;
  /** 格式化函数 */
  format?: (value: T[keyof T]) => string;
  /** 是否可排序 */
  sortable?: boolean;
  /** 文本对齐方式 */
  align?: 'left' | 'center' | 'right';
}
