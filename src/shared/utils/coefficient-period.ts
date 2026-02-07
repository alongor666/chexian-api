/**
 * 商车自主定价系数监控 - 时间周期计算工具
 *
 * 周期类型说明：
 * 1. 一般周期（general）：1-7日、8-14日、15-21日、22日-月末
 * 2. 特殊周期（special）：1-14日、15日-月末（适用于成都+新能源+非营业个人客车+旧车）
 * 3. 月度周期（monthly）：1日-月末（适用于全省聚合行）
 */

import type { RegionType, CustomerCategoryType } from '../config/coefficient-thresholds';

// 周期类型
export type PeriodType = 'general' | 'special' | 'monthly';

// 日期范围
export interface DateRange {
  start: Date;
  end: Date;
}

// 格式化日期为 YYYY-MM-DD
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取月份的最后一天
 */
export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 判断周期类型
 *
 * 规则：
 * - 全省行：使用月度周期
 * - 成都 + 新能源 + 非营业个人客车 + 旧车：使用特殊周期
 * - 其他：使用一般周期
 *
 * @param region 地域
 * @param nev 是否新能源
 * @param customerCategory 客户类别
 * @param newCar 是否新车
 * @param isProvinceAggregate 是否全省聚合行
 */
export function getPeriodType(
  region: RegionType | 'province_aggregate',
  nev: boolean,
  customerCategory: CustomerCategoryType,
  newCar: boolean | null,
  isProvinceAggregate: boolean = false
): PeriodType {
  // 全省聚合行使用月度周期
  if (isProvinceAggregate || region === 'province_aggregate') {
    return 'monthly';
  }

  // 成都 + 新能源 + 非营业个人客车 + 旧车 使用特殊周期
  if (
    region === 'chengdu' &&
    nev === true &&
    customerCategory === 'non_commercial_personal' &&
    newCar === false
  ) {
    return 'special';
  }

  // 其他使用一般周期
  return 'general';
}

/**
 * 计算当周的日期范围
 *
 * @param cutoffDate 截止日期
 * @param periodType 周期类型
 */
export function getWeekPeriod(cutoffDate: Date, periodType: PeriodType): DateRange {
  const day = cutoffDate.getDate();
  const year = cutoffDate.getFullYear();
  const month = cutoffDate.getMonth();
  const lastDay = getLastDayOfMonth(year, month);

  switch (periodType) {
    case 'monthly':
      // 月度周期：整月
      return {
        start: new Date(year, month, 1),
        end: new Date(year, month, lastDay),
      };

    case 'special':
      // 特殊周期：1-14, 15-月末
      if (day <= 14) {
        return {
          start: new Date(year, month, 1),
          end: new Date(year, month, 14),
        };
      } else {
        return {
          start: new Date(year, month, 15),
          end: new Date(year, month, lastDay),
        };
      }

    case 'general':
    default:
      // 一般周期：1-7, 8-14, 15-21, 22-月末
      if (day <= 7) {
        return {
          start: new Date(year, month, 1),
          end: new Date(year, month, 7),
        };
      } else if (day <= 14) {
        return {
          start: new Date(year, month, 8),
          end: new Date(year, month, 14),
        };
      } else if (day <= 21) {
        return {
          start: new Date(year, month, 15),
          end: new Date(year, month, 21),
        };
      } else {
        return {
          start: new Date(year, month, 22),
          end: new Date(year, month, lastDay),
        };
      }
  }
}

/**
 * 计算当月的日期范围
 */
export function getMonthPeriod(cutoffDate: Date): DateRange {
  const year = cutoffDate.getFullYear();
  const month = cutoffDate.getMonth();
  const lastDay = getLastDayOfMonth(year, month);

  return {
    start: new Date(year, month, 1),
    end: new Date(year, month, lastDay),
  };
}

/**
 * 计算当年的日期范围（1月1日到截止日）
 */
export function getYearPeriod(cutoffDate: Date, analysisYear: number): DateRange {
  return {
    start: new Date(analysisYear, 0, 1),
    end: cutoffDate,
  };
}

/**
 * 计算当天的日期范围
 */
export function getDayPeriod(cutoffDate: Date): DateRange {
  return {
    start: cutoffDate,
    end: cutoffDate,
  };
}

/**
 * 获取周期的显示名称
 */
export function getPeriodLabel(periodType: PeriodType, dateRange: DateRange): string {
  const startDay = dateRange.start.getDate();
  const endDay = dateRange.end.getDate();
  const month = dateRange.start.getMonth() + 1;

  switch (periodType) {
    case 'monthly':
      return `${month}月全月`;
    case 'special':
      if (startDay === 1 && endDay === 14) {
        return `${month}月上半月(1-14日)`;
      } else {
        return `${month}月下半月(15-${endDay}日)`;
      }
    case 'general':
    default:
      return `${month}月${startDay}-${endDay}日`;
  }
}

/**
 * 生成日期范围的 SQL WHERE 条件
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 */
export function generateDateRangeSql(dateField: string, dateRange: DateRange): string {
  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);
  return `${dateField} >= '${startStr}' AND ${dateField} <= '${endStr}'`;
}

/**
 * 计算所有时间周期的日期范围
 *
 * @param cutoffDate 截止日期
 * @param analysisYear 分析年度
 * @param periodType 周期类型
 */
export function getAllPeriodRanges(
  cutoffDate: Date,
  analysisYear: number,
  periodType: PeriodType
): {
  day: DateRange;
  week: DateRange;
  month: DateRange;
  year: DateRange;
} {
  return {
    day: getDayPeriod(cutoffDate),
    week: getWeekPeriod(cutoffDate, periodType),
    month: getMonthPeriod(cutoffDate),
    year: getYearPeriod(cutoffDate, analysisYear),
  };
}
