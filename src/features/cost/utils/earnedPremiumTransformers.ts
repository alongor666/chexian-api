/**
 * 新口径已赚保费 — 数据转换与导出工具
 * 从 NewEarnedPremiumTable.tsx 拆出，保持原有逻辑不变。
 *
 * 包含：
 * - 精算三角内部数据类型（组件级中间态）
 * - 数据合并函数（merge2025PolicyData / merge2026PolicyData）
 * - 汇总表转换（transformSummaryData）
 * - 滚动12月对比转换（transformToRolling12MonthCompare）
 * - 精算三角导出（transform2025/2026TriangleForExport）
 * - 可选年度提取（getAvailableYears）
 */

import { formatPremiumWan, formatPercent } from '../../../shared/utils/formatters';
import type {
  Policy2025In2025Data,
  Policy2025In2026Data,
  Policy2026In2026Data,
  Policy2026In2027Data,
  NewEarnedPremiumSummaryData,
} from '../types/costTypes';

// ==================== 精算三角内部数据类型 ====================

/** 2025年保单精算三角行数据（合并25年和26年） */
export interface Policy2025TriangleRow {
  policy_month: number;
  premium: number;
  first_day_fee: number;
  // 25年各月已赚
  earned_25_01: number; earned_25_02: number; earned_25_03: number; earned_25_04: number;
  earned_25_05: number; earned_25_06: number; earned_25_07: number; earned_25_08: number;
  earned_25_09: number; earned_25_10: number; earned_25_11: number; earned_25_12: number;
  // 26年各月已赚
  earned_26_01: number; earned_26_02: number; earned_26_03: number; earned_26_04: number;
  earned_26_05: number; earned_26_06: number; earned_26_07: number; earned_26_08: number;
  earned_26_09: number; earned_26_10: number; earned_26_11: number; earned_26_12: number;
  // 最终已赚（满期）
  earned_total: number;
}

/** 2026年保单精算三角行数据（合并26年和27年） */
export interface Policy2026TriangleRow {
  policy_month: number;
  premium: number;
  first_day_fee: number;
  // 26年各月已赚
  earned_26_01: number; earned_26_02: number; earned_26_03: number; earned_26_04: number;
  earned_26_05: number; earned_26_06: number; earned_26_07: number; earned_26_08: number;
  earned_26_09: number; earned_26_10: number; earned_26_11: number; earned_26_12: number;
  // 27年各月已赚
  earned_27_01: number; earned_27_02: number; earned_27_03: number; earned_27_04: number;
  earned_27_05: number; earned_27_06: number; earned_27_07: number; earned_27_08: number;
  earned_27_09: number; earned_27_10: number; earned_27_11: number; earned_27_12: number;
  // 最终已赚（满期）
  earned_total: number;
}

/** 汇总表显示格式 */
export interface DisplaySummaryData {
  stat_month: string;
  rolling_12m_premium: string;
  earned_from_2025: string;
  earned_from_2026: string;
  total_earned_premium: string;
  earned_ratio: string;
}

/** 滚动12月对比表格数据 */
export interface Rolling12MonthCompareData {
  stat_month: string;           // 统计月（如 "26年1月"）
  window_range: string;         // 窗口范围（如 "25/2→26/1"）
  policy_2025_months: string;   // 25年保单参与月数（如 "11个月"）
  policy_2026_months: string;   // 26年保单参与月数（如 "1个月"）
  rolling_12m_premium: string;  // R12M保费(万)
  total_earned: string;         // R12M已赚(万)
  earned_ratio: string;         // 已赚率
}

/** 精算三角导出数据行类型 */
export interface ExportTriangleRow {
  [key: string]: string | number;
}

// ==================== 数据合并函数 ====================

/** 合并2025年保单数据为精算三角行 */
export function merge2025PolicyData(
  data2025In2025: Policy2025In2025Data[],
  data2025In2026: Policy2025In2026Data[]
): Policy2025TriangleRow[] {
  const result: Policy2025TriangleRow[] = [];

  for (let m = 1; m <= 12; m++) {
    const row2025 = data2025In2025.find(r => r.policy_month === m);
    const row2026 = data2025In2026.find(r => r.policy_month === m);

    if (!row2025) continue;

    result.push({
      policy_month: m,
      premium: row2025.premium,
      first_day_fee: row2025.first_day_fee,
      // 25年
      earned_25_01: row2025.earned_2025_01,
      earned_25_02: row2025.earned_2025_02,
      earned_25_03: row2025.earned_2025_03,
      earned_25_04: row2025.earned_2025_04,
      earned_25_05: row2025.earned_2025_05,
      earned_25_06: row2025.earned_2025_06,
      earned_25_07: row2025.earned_2025_07,
      earned_25_08: row2025.earned_2025_08,
      earned_25_09: row2025.earned_2025_09,
      earned_25_10: row2025.earned_2025_10,
      earned_25_11: row2025.earned_2025_11,
      earned_25_12: row2025.earned_2025_12,
      // 26年
      earned_26_01: row2026?.earned_2026_01 ?? 0,
      earned_26_02: row2026?.earned_2026_02 ?? 0,
      earned_26_03: row2026?.earned_2026_03 ?? 0,
      earned_26_04: row2026?.earned_2026_04 ?? 0,
      earned_26_05: row2026?.earned_2026_05 ?? 0,
      earned_26_06: row2026?.earned_2026_06 ?? 0,
      earned_26_07: row2026?.earned_2026_07 ?? 0,
      earned_26_08: row2026?.earned_2026_08 ?? 0,
      earned_26_09: row2026?.earned_2026_09 ?? 0,
      earned_26_10: row2026?.earned_2026_10 ?? 0,
      earned_26_11: row2026?.earned_2026_11 ?? 0,
      earned_26_12: row2026?.earned_2026_12 ?? 0,
      // 最终已赚 = 25年total + 26年total
      earned_total: row2025.earned_2025_total + (row2026?.earned_2026_total ?? 0),
    });
  }

  return result;
}

/** 合并2026年保单数据为精算三角行 */
export function merge2026PolicyData(
  data2026In2026: Policy2026In2026Data[],
  data2026In2027: Policy2026In2027Data[]
): Policy2026TriangleRow[] {
  const result: Policy2026TriangleRow[] = [];

  for (let m = 1; m <= 12; m++) {
    const row2026 = data2026In2026.find(r => r.policy_month === m);
    const row2027 = data2026In2027.find(r => r.policy_month === m);

    if (!row2026) continue;

    result.push({
      policy_month: m,
      premium: row2026.premium,
      first_day_fee: row2026.first_day_fee,
      // 26年
      earned_26_01: row2026.earned_2026_01,
      earned_26_02: row2026.earned_2026_02,
      earned_26_03: row2026.earned_2026_03,
      earned_26_04: row2026.earned_2026_04,
      earned_26_05: row2026.earned_2026_05,
      earned_26_06: row2026.earned_2026_06,
      earned_26_07: row2026.earned_2026_07,
      earned_26_08: row2026.earned_2026_08,
      earned_26_09: row2026.earned_2026_09,
      earned_26_10: row2026.earned_2026_10,
      earned_26_11: row2026.earned_2026_11,
      earned_26_12: row2026.earned_2026_12,
      // 27年
      earned_27_01: row2027?.earned_2027_01 ?? 0,
      earned_27_02: row2027?.earned_2027_02 ?? 0,
      earned_27_03: row2027?.earned_2027_03 ?? 0,
      earned_27_04: row2027?.earned_2027_04 ?? 0,
      earned_27_05: row2027?.earned_2027_05 ?? 0,
      earned_27_06: row2027?.earned_2027_06 ?? 0,
      earned_27_07: row2027?.earned_2027_07 ?? 0,
      earned_27_08: row2027?.earned_2027_08 ?? 0,
      earned_27_09: row2027?.earned_2027_09 ?? 0,
      earned_27_10: row2027?.earned_2027_10 ?? 0,
      earned_27_11: row2027?.earned_2027_11 ?? 0,
      earned_27_12: row2027?.earned_2027_12 ?? 0,
      // 最终已赚 = 26年total + 27年total
      earned_total: row2026.earned_2026_total + (row2027?.earned_2027_total ?? 0),
    });
  }

  return result;
}

/** 汇总数据转换为显示格式 */
export function transformSummaryData(data: NewEarnedPremiumSummaryData[]): DisplaySummaryData[] {
  return data.map((row) => {
    const [year, month] = (row.stat_month ?? '').split('-');
    const shortYear = year.slice(-2);
    const monthLabel = `${month.replace(/^0/, '')}月`;
    return {
      stat_month: `${shortYear}年${monthLabel}`,
      rolling_12m_premium: formatPremiumWan(row.rolling_12m_premium),
      earned_from_2025: formatPremiumWan(row.earned_from_2025),
      earned_from_2026: formatPremiumWan(row.earned_from_2026),
      total_earned_premium: formatPremiumWan(row.total_earned_premium),
      earned_ratio: formatPercent(row.earned_ratio, 1),
    };
  });
}

/**
 * 转换汇总数据为滚动12月对比表格格式
 * 根据统计月计算窗口范围和保单参与月数
 */
export function transformToRolling12MonthCompare(
  data: NewEarnedPremiumSummaryData[],
  selectedYear: number
): Rolling12MonthCompareData[] {
  return data
    .filter((row) => {
      const year = parseInt((row.stat_month ?? '').split('-')[0]);
      return year === selectedYear;
    })
    .map((row) => {
      const [yearStr, monthStr] = (row.stat_month ?? '').split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const shortYear = yearStr.slice(-2);
      const prevYear = year - 1;
      const shortPrevYear = String(prevYear).slice(-2);

      // 计算窗口范围：[prevYear年(month+1)月, year年month月]
      // 例如：统计月26年3月 → 窗口 [25/4, 26/3]
      const windowStartMonth = month + 1;
      let windowRange: string;
      let policy2025Months: number;
      let policy2026Months: number;

      if (windowStartMonth <= 12) {
        // 窗口跨两年
        windowRange = `${shortPrevYear}/${windowStartMonth}→${shortYear}/${month}`;
        policy2025Months = 12 - month; // 25年参与月数 = 12 - statMonth
        policy2026Months = month;      // 26年参与月数 = statMonth
      } else {
        // 窗口在同一年（statMonth=12时，窗口=[26/1, 26/12]）
        windowRange = `${shortYear}/1→${shortYear}/${month}`;
        policy2025Months = 0;          // 25年无参与
        policy2026Months = 12;         // 26年全年参与
      }

      return {
        stat_month: `${shortYear}年${month}月`,
        window_range: windowRange,
        policy_2025_months: policy2025Months > 0 ? `${policy2025Months}个月` : '-',
        policy_2026_months: `${policy2026Months}个月`,
        rolling_12m_premium: formatPremiumWan(row.rolling_12m_premium),
        total_earned: formatPremiumWan(row.total_earned_premium),
        earned_ratio: formatPercent(row.earned_ratio, 1),
      };
    });
}

/**
 * 从汇总数据中提取可选的年度列表
 */
export function getAvailableYears(data: NewEarnedPremiumSummaryData[]): number[] {
  const years = new Set<number>();
  data.forEach((row) => {
    const year = parseInt((row.stat_month ?? '').split('-')[0]);
    years.add(year);
  });
  return Array.from(years).sort();
}

// ==================== 精算三角导出函数 ====================

/**
 * 将2025年保单精算三角数据转换为导出格式
 */
export function transform2025TriangleForExport(data: Policy2025TriangleRow[]): ExportTriangleRow[] {
  return data.map((row) => ({
    '起保月': `${row.policy_month}月`,
    '保费': Math.round(row.premium),
    '首日': Math.round(row.first_day_fee),
    '25年1月': Math.round(row.earned_25_01),
    '25年2月': Math.round(row.earned_25_02),
    '25年3月': Math.round(row.earned_25_03),
    '25年4月': Math.round(row.earned_25_04),
    '25年5月': Math.round(row.earned_25_05),
    '25年6月': Math.round(row.earned_25_06),
    '25年7月': Math.round(row.earned_25_07),
    '25年8月': Math.round(row.earned_25_08),
    '25年9月': Math.round(row.earned_25_09),
    '25年10月': Math.round(row.earned_25_10),
    '25年11月': Math.round(row.earned_25_11),
    '25年12月': Math.round(row.earned_25_12),
    '26年1月': Math.round(row.earned_26_01),
    '26年2月': Math.round(row.earned_26_02),
    '26年3月': Math.round(row.earned_26_03),
    '26年4月': Math.round(row.earned_26_04),
    '26年5月': Math.round(row.earned_26_05),
    '26年6月': Math.round(row.earned_26_06),
    '26年7月': Math.round(row.earned_26_07),
    '26年8月': Math.round(row.earned_26_08),
    '26年9月': Math.round(row.earned_26_09),
    '26年10月': Math.round(row.earned_26_10),
    '26年11月': Math.round(row.earned_26_11),
    '26年12月': Math.round(row.earned_26_12),
    '满期': Math.round(row.earned_total),
  }));
}

/**
 * 将2026年保单精算三角数据转换为导出格式
 */
export function transform2026TriangleForExport(data: Policy2026TriangleRow[]): ExportTriangleRow[] {
  return data.map((row) => ({
    '起保月': `${row.policy_month}月`,
    '保费': Math.round(row.premium),
    '首日': Math.round(row.first_day_fee),
    '26年1月': Math.round(row.earned_26_01),
    '26年2月': Math.round(row.earned_26_02),
    '26年3月': Math.round(row.earned_26_03),
    '26年4月': Math.round(row.earned_26_04),
    '26年5月': Math.round(row.earned_26_05),
    '26年6月': Math.round(row.earned_26_06),
    '26年7月': Math.round(row.earned_26_07),
    '26年8月': Math.round(row.earned_26_08),
    '26年9月': Math.round(row.earned_26_09),
    '26年10月': Math.round(row.earned_26_10),
    '26年11月': Math.round(row.earned_26_11),
    '26年12月': Math.round(row.earned_26_12),
    '27年1月': Math.round(row.earned_27_01),
    '27年2月': Math.round(row.earned_27_02),
    '27年3月': Math.round(row.earned_27_03),
    '27年4月': Math.round(row.earned_27_04),
    '27年5月': Math.round(row.earned_27_05),
    '27年6月': Math.round(row.earned_27_06),
    '27年7月': Math.round(row.earned_27_07),
    '27年8月': Math.round(row.earned_27_08),
    '27年9月': Math.round(row.earned_27_09),
    '27年10月': Math.round(row.earned_27_10),
    '27年11月': Math.round(row.earned_27_11),
    '27年12月': Math.round(row.earned_27_12),
    '满期': Math.round(row.earned_total),
  }));
}
