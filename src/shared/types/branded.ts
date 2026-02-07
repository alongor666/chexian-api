/**
 * 品牌类型定义
 *
 * 使用品牌类型（Branded Types）增强类型安全，
 * 防止类型混淆错误（如将金额当作百分比使用）
 */

// ========== 品牌类型基础 ==========

/**
 * 品牌类型工具类型
 * 用于创建名义类型（Nominal Type）
 */
declare const __brand: unique symbol;
type Brand<B> = { [__brand]: B };

/**
 * 创建品牌类型
 */
export type Branded<T, B> = T & Brand<B>;

// ========== 数值品牌类型 ==========

/**
 * 金额类型（元）
 * 用于表示货币金额，非负数
 */
export type Money = Branded<number, 'Money'>;

/**
 * 正整数类型
 * 用于表示数量（如保单数）
 */
export type PositiveInteger = Branded<number, 'PositiveInteger'>;

/**
 * 百分比类型（0-100）
 * 用于表示比率（如赔付率、费用率）
 */
export type Percentage = Branded<number, 'Percentage'>;

/**
 * 比率类型（0-1）
 * 用于表示小数比率
 */
export type Ratio = Branded<number, 'Ratio'>;

/**
 * 非负数类型
 */
export type NonNegative = Branded<number, 'NonNegative'>;

// ========== 类型守卫 ==========

/**
 * 检查是否为有效金额
 */
export const isMoney = (value: number): value is Money => {
  return Number.isFinite(value) && value >= 0;
};

/**
 * 检查是否为正整数
 */
export const isPositiveInteger = (value: number): value is PositiveInteger => {
  return Number.isInteger(value) && value > 0;
};

/**
 * 检查是否为百分比（0-100）
 */
export const isPercentage = (value: number): value is Percentage => {
  return Number.isFinite(value) && value >= 0 && value <= 100;
};

/**
 * 检查是否为比率（0-1）
 */
export const isRatio = (value: number): value is Ratio => {
  return Number.isFinite(value) && value >= 0 && value <= 1;
};

/**
 * 检查是否为非负数
 */
export const isNonNegative = (value: number): value is NonNegative => {
  return Number.isFinite(value) && value >= 0;
};

// ========== 类型转换工具 ==========

/**
 * 创建金额值（带验证）
 */
export const asMoney = (value: number): Money => {
  if (!isMoney(value)) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return value;
};

/**
 * 创建正整数值（带验证）
 */
export const asPositiveInteger = (value: number): PositiveInteger => {
  if (!isPositiveInteger(value)) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return value;
};

/**
 * 创建百分比值（带验证）
 */
export const asPercentage = (value: number): Percentage => {
  if (!isPercentage(value)) {
    throw new Error(`Invalid percentage: ${value}`);
  }
  return value;
};

/**
 * 创建比率值（带验证）
 */
export const asRatio = (value: number): Ratio => {
  if (!isRatio(value)) {
    throw new Error(`Invalid ratio: ${value}`);
  }
  return value;
};

/**
 * 安全创建金额值（返回 null 而不是抛出错误）
 */
export const tryAsMoney = (value: number): Money | null => {
  return isMoney(value) ? value : null;
};

/**
 * 安全创建百分比值（返回 null 而不是抛出错误）
 */
export const tryAsPercentage = (value: number): Percentage | null => {
  return isPercentage(value) ? value : null;
};

// ========== 数值转换 ==========

/**
 * 比率转百分比
 */
export const ratioToPercentage = (ratio: Ratio): Percentage => {
  return (ratio * 100) as Percentage;
};

/**
 * 百分比转比率
 */
export const percentageToRatio = (percentage: Percentage): Ratio => {
  return (percentage / 100) as Ratio;
};

// ========== 字符串品牌类型 ==========

/**
 * 保单号类型
 */
export type PolicyNumber = Branded<string, 'PolicyNumber'>;

/**
 * 机构代码类型
 */
export type OrgCode = Branded<string, 'OrgCode'>;

/**
 * 车牌号类型
 */
export type LicensePlate = Branded<string, 'LicensePlate'>;

/**
 * 检查是否为有效保单号
 */
export const isPolicyNumber = (value: string): value is PolicyNumber => {
  return typeof value === 'string' && value.length > 0;
};

/**
 * 检查是否为有效机构代码
 */
export const isOrgCode = (value: string): value is OrgCode => {
  return typeof value === 'string' && value.length > 0;
};

// ========== 日期品牌类型 ==========

/**
 * ISO 日期字符串类型（YYYY-MM-DD）
 */
export type ISODateString = Branded<string, 'ISODateString'>;

/**
 * 检查是否为有效 ISO 日期字符串
 */
export const isISODateString = (value: string): value is ISODateString => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(value)) return false;
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  // 验证日期组件匹配（排除如 2024-02-30 被解析为 2024-03-01 的情况）
  const [year, month, day] = value.split('-').map(Number);
  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
};

/**
 * 创建 ISO 日期字符串
 */
export const asISODateString = (value: string): ISODateString => {
  if (!isISODateString(value)) {
    throw new Error(`Invalid ISO date string: ${value}`);
  }
  return value;
};

/**
 * 从 Date 对象创建 ISO 日期字符串
 */
export const dateToISOString = (date: Date): ISODateString => {
  return date.toISOString().split('T')[0] as ISODateString;
};
