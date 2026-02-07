/**
 * 实用类型工具
 *
 * 提供常用的 TypeScript 类型工具，增强代码类型安全
 */

// ========== 基础类型工具 ==========

/**
 * 深度只读类型
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? T[P] extends Function
      ? T[P]
      : DeepReadonly<T[P]>
    : T[P];
};

/**
 * 深度可选类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends Function
      ? T[P]
      : DeepPartial<T[P]>
    : T[P];
};

/**
 * 必需的键
 */
export type RequiredKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * 非空值类型
 */
export type NonNullable<T> = T extends null | undefined ? never : T;

/**
 * 提取数组元素类型
 */
export type ArrayElement<T> = T extends readonly (infer E)[] ? E : never;

// ========== 结果类型 ==========

/**
 * 成功结果
 */
export interface Success<T> {
  readonly success: true;
  readonly data: T;
}

/**
 * 失败结果
 */
export interface Failure<E = Error> {
  readonly success: false;
  readonly error: E;
}

/**
 * 结果类型（类似 Rust 的 Result）
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * 创建成功结果
 */
export const success = <T>(data: T): Success<T> => ({
  success: true,
  data,
});

/**
 * 创建失败结果
 */
export const failure = <E = Error>(error: E): Failure<E> => ({
  success: false,
  error,
});

/**
 * 检查是否为成功结果
 */
export const isSuccess = <T, E>(result: Result<T, E>): result is Success<T> => {
  return result.success === true;
};

/**
 * 检查是否为失败结果
 */
export const isFailure = <T, E>(result: Result<T, E>): result is Failure<E> => {
  return result.success === false;
};

// ========== 异步结果类型 ==========

/**
 * 异步状态
 */
export type AsyncState<T, E = Error> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: E };

/**
 * 创建空闲状态
 */
export const idle = <T, E = Error>(): AsyncState<T, E> => ({ status: 'idle' });

/**
 * 创建加载状态
 */
export const loading = <T, E = Error>(): AsyncState<T, E> => ({ status: 'loading' });

/**
 * 创建成功状态
 */
export const asyncSuccess = <T, E = Error>(data: T): AsyncState<T, E> => ({
  status: 'success',
  data,
});

/**
 * 创建错误状态
 */
export const asyncError = <T, E = Error>(error: E): AsyncState<T, E> => ({
  status: 'error',
  error,
});

// ========== 筛选器类型 ==========

/**
 * 筛选器类型字面量
 */
export type FilterType = 'date' | 'org' | 'salesman' | 'customer' | 'insurance' | 'nev';

/**
 * 日期范围类型
 */
export interface DateInterval {
  readonly start: Date;
  readonly end: Date;
}

/**
 * 险种类型
 */
export type InsuranceType = '交强险' | '商业险' | '驾意险';

/**
 * 筛选值类型映射
 */
export type FilterValueMap = {
  date: DateInterval;
  org: readonly string[];
  salesman: readonly string[];
  customer: readonly string[];
  insurance: readonly InsuranceType[];
  nev: boolean;
};

/**
 * 类型安全的筛选器
 */
export interface TypedFilter<T extends FilterType = FilterType> {
  readonly type: T;
  readonly value: FilterValueMap[T];
}

// ========== 表格列类型 ==========

/**
 * 列对齐方式
 */
export type ColumnAlign = 'left' | 'center' | 'right';

/**
 * 列配置
 */
export interface ColumnConfig<T> {
  readonly key: keyof T;
  readonly title: string;
  readonly width?: number | string;
  readonly align?: ColumnAlign;
  readonly sortable?: boolean;
  readonly render?: (value: T[keyof T], row: T, index: number) => React.ReactNode;
}

// ========== 分页类型 ==========

/**
 * 分页参数
 */
export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * 创建分页结果
 */
export const createPaginatedResult = <T>(
  data: readonly T[],
  total: number,
  params: PaginationParams
): PaginatedResult<T> => ({
  data,
  total,
  page: params.page,
  pageSize: params.pageSize,
  totalPages: Math.ceil(total / params.pageSize),
});

// ========== 排序类型 ==========

/**
 * 排序方向
 */
export type SortDirection = 'asc' | 'desc';

/**
 * 排序配置
 */
export interface SortConfig<T> {
  readonly field: keyof T;
  readonly direction: SortDirection;
}

// ========== 类型守卫工具 ==========

/**
 * 检查值是否为指定类型
 */
export const isOfType = <T>(
  value: unknown,
  check: (v: unknown) => boolean
): value is T => {
  return check(value);
};

/**
 * 检查是否为非空字符串
 */
export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

/**
 * 检查是否为有效数字
 */
export const isValidNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

/**
 * 检查是否为非空数组
 */
export const isNonEmptyArray = <T>(value: unknown): value is T[] => {
  return Array.isArray(value) && value.length > 0;
};

/**
 * 检查是否为有效日期
 */
export const isValidDate = (value: unknown): value is Date => {
  return value instanceof Date && !isNaN(value.getTime());
};

// ========== 对象类型工具 ==========

/**
 * 获取对象的键类型
 */
export type KeysOf<T> = keyof T;

/**
 * 获取对象的值类型
 */
export type ValuesOf<T> = T[keyof T];

/**
 * 安全的对象键数组
 */
export const typedKeys = <T extends object>(obj: T): (keyof T)[] => {
  return Object.keys(obj) as (keyof T)[];
};

/**
 * 安全的对象值数组
 */
export const typedValues = <T extends object>(obj: T): T[keyof T][] => {
  return Object.values(obj) as T[keyof T][];
};

/**
 * 安全的对象条目数组
 */
export const typedEntries = <T extends object>(obj: T): [keyof T, T[keyof T]][] => {
  return Object.entries(obj) as [keyof T, T[keyof T]][];
};
