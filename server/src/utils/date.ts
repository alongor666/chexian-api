/**
 * 通用日期工具函数
 *
 * 从 coefficient-period.ts 迁移而来，供 earned-premium.ts 等模块使用。
 */

/**
 * 格式化日期为 YYYY-MM-DD 字符串
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取月份的最后一天（0-indexed month）
 */
export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
