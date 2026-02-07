/**
 * 节假日计算工具函数
 *
 * 提供节假日相关的日期判断和计算功能
 */

import { HOLIDAYS_2026, HOLIDAY_SET, HOLIDAYS_BY_NAME, Holiday } from './holidayData';

/**
 * 判断指定日期是否为节假日
 *
 * @param dateStr - 日期字符串 YYYY-MM-DD
 * @returns 是否为节假日
 */
export function isHoliday(dateStr: string): boolean {
  return HOLIDAY_SET.has(dateStr);
}

/**
 * 获取指定日期的节假日名称
 *
 * @param dateStr - 日期字符串 YYYY-MM-DD
 * @returns 节假日名称，非节假日返回 null
 */
export function getHolidayName(dateStr: string): string | null {
  const holiday = HOLIDAYS_2026.find((h) => h.date === dateStr);
  return holiday?.name ?? null;
}

/**
 * 获取日期范围内的所有节假日
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns 节假日列表
 */
export function getHolidaysInRange(startDate: string, endDate: string): Holiday[] {
  return HOLIDAYS_2026.filter((h) => h.date >= startDate && h.date <= endDate);
}

/**
 * 计算日期范围内的节假日天数
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns 节假日天数
 */
export function countHolidaysInRange(startDate: string, endDate: string): number {
  return getHolidaysInRange(startDate, endDate).length;
}

/**
 * 获取日期范围内的节假日日期字符串列表
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns 节假日日期字符串数组
 */
export function getHolidayDatesInRange(startDate: string, endDate: string): string[] {
  return getHolidaysInRange(startDate, endDate).map((h) => h.date);
}

/**
 * 获取日期范围内按节日名称分组的节假日
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns 按节日名称分组的日期映射
 */
export function getHolidaysGroupedByName(
  startDate: string,
  endDate: string
): Record<string, string[]> {
  const holidays = getHolidaysInRange(startDate, endDate);
  return holidays.reduce(
    (acc, holiday) => {
      if (!acc[holiday.name]) {
        acc[holiday.name] = [];
      }
      acc[holiday.name].push(holiday.date);
      return acc;
    },
    {} as Record<string, string[]>
  );
}

/**
 * 生成节假日 VALUES SQL 子句
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns SQL VALUES 子句字符串
 */
export function generateHolidayValuesSql(startDate: string, endDate: string): string {
  const dates = getHolidayDatesInRange(startDate, endDate);
  if (dates.length === 0) {
    // 返回一个不可能匹配的日期，避免 SQL 语法错误
    return "('1900-01-01')";
  }
  return dates.map((d) => `('${d}')`).join(', ');
}

/**
 * 获取日期范围内各节日的统计摘要
 *
 * @param startDate - 起始日期 YYYY-MM-DD
 * @param endDate - 结束日期 YYYY-MM-DD
 * @returns 节日统计摘要
 */
export function getHolidaySummary(
  startDate: string,
  endDate: string
): Array<{ name: string; days: number; dateRange: string }> {
  const grouped = getHolidaysGroupedByName(startDate, endDate);

  return Object.entries(grouped).map(([name, dates]) => {
    const sortedDates = dates.sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    return {
      name,
      days: dates.length,
      dateRange: firstDate === lastDate ? firstDate : `${firstDate} ~ ${lastDate}`,
    };
  });
}

// Re-export data for convenience
export { HOLIDAYS_2026, HOLIDAY_SET, HOLIDAYS_BY_NAME };
