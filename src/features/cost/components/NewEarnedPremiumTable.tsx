/**
 * 新口径已赚保费分析表格（V4版本 - 精算三角视图）
 * New Earned Premium Analysis Table V4 - Actuarial Triangle View
 *
 * 核心改进：
 * - 2025年保单：合并为单个精算三角表（起保月 × 统计月）
 * - 2026年保单：合并为单个精算三角表（起保月 × 统计月）
 * - 汇总统计：滚动12个月统计
 *
 * 精算三角特征：
 * - 统计月列：25-1 到 25-12，26-1 到 26-12
 * - 0值灰色显示，聚焦三角区域
 * - 首日费用已并入起保月的已赚字段
 */

import React, { useMemo, useState, useCallback } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import { formatPremiumWan, formatPercent } from '../../../shared/utils/formatters';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../../shared/utils/export';
import {
  tableStyles,
  textStyles,
  buttonStyles,
  cardStyles,
  badgeStyles,
  colorClasses,
  cn,
} from '../../../shared/styles';
import type {
  Policy2025In2025Data,
  Policy2025In2026Data,
  Policy2026In2026Data,
  Policy2026In2027Data,
  NewEarnedPremiumSummaryData,
} from '../types/costTypes';

interface NewEarnedPremiumTableProps {
  /** 2025年保单在2025年的已赚数据 */
  policy2025In2025Data: Policy2025In2025Data[];
  /** 2025年保单在2026年的已赚数据 */
  policy2025In2026Data: Policy2025In2026Data[];
  /** 2026年保单在2026年的已赚数据 */
  policy2026In2026Data: Policy2026In2026Data[];
  /** 2026年保单在2027年的已赚数据 */
  policy2026In2027Data: Policy2026In2027Data[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  loading?: boolean;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
}

/** 主标签页类型 */
type MainTab = '2025' | '2026' | 'summary' | 'rolling12';

/** 月份标签 */
const MONTH_LABELS: Record<number, string> = {
  1: '1月', 2: '2月', 3: '3月', 4: '4月',
  5: '5月', 6: '6月', 7: '7月', 8: '8月',
  9: '9月', 10: '10月', 11: '11月', 12: '12月',
};

// ==================== 精算三角数据类型 ====================

/** 2025年保单精算三角行数据（合并25年和26年） */
interface Policy2025TriangleRow {
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
interface Policy2026TriangleRow {
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
interface DisplaySummaryData {
  stat_month: string;
  rolling_12m_premium: string;
  earned_from_2025: string;
  earned_from_2026: string;
  total_earned_premium: string;
  earned_ratio: string;
}

/** 滚动12月对比表格数据 */
interface Rolling12MonthCompareData {
  stat_month: string;           // 统计月（如 "26年1月"）
  window_range: string;         // 窗口范围（如 "25/2→26/1"）
  policy_2025_months: string;   // 25年保单参与月数（如 "11个月"）
  policy_2026_months: string;   // 26年保单参与月数（如 "1个月"）
  rolling_12m_premium: string;  // R12M保费(万)
  total_earned: string;         // R12M已赚(万)
  earned_ratio: string;         // 已赚率
}

// ==================== 数据合并函数 ====================

/** 合并2025年保单数据为精算三角行 */
function merge2025PolicyData(
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
function merge2026PolicyData(
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

function transformSummaryData(data: NewEarnedPremiumSummaryData[]): DisplaySummaryData[] {
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
function transformToRolling12MonthCompare(
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
function getAvailableYears(data: NewEarnedPremiumSummaryData[]): number[] {
  const years = new Set<number>();
  data.forEach((row) => {
    const year = parseInt((row.stat_month ?? '').split('-')[0]);
    years.add(year);
  });
  return Array.from(years).sort();
}

// ==================== 精算三角导出函数 ====================

/** 导出数据行类型 */
interface ExportTriangleRow {
  [key: string]: string | number;
}

/**
 * 将2025年保单精算三角数据转换为导出格式
 */
function transform2025TriangleForExport(data: Policy2025TriangleRow[]): ExportTriangleRow[] {
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
function transform2026TriangleForExport(data: Policy2026TriangleRow[]): ExportTriangleRow[] {
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

// ==================== 精算三角表格样式 ====================

/** 判断是否在三角区域外（起保月之前的统计月） */
function isOutsideTriangle(policyMonth: number, statYear: number, statMonth: number, baseYear: number): boolean {
  // 对于2025年保单（baseYear=2025）：
  // - 25年统计月：statMonth < policyMonth 时为三角外
  // - 26年统计月：起保月在25年，26年所有月份都在三角内
  if (statYear === baseYear) {
    return statMonth < policyMonth;
  }
  return false;
}

// ==================== 精算三角表格组件 ====================

/** 2025年保单精算三角表格 */
const Policy2025TriangleTable: React.FC<{
  data: Policy2025TriangleRow[];
  loading?: boolean;
}> = ({ data, loading }) => {
  if (loading) {
    return <div className={cn('p-8 text-center', colorClasses.text.neutralMuted)}>加载中...</div>;
  }

  // 表头：起保月、保费、首日费用、25-1~25-12、26-1~26-12、最终已赚
  const headers = [
    { key: 'policy_month', label: '起保月', width: 56 },
    { key: 'premium', label: '保费', width: 72 },
    { key: 'first_day_fee', label: '首日', width: 56 },
    // 25年各月
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_25_${String(i + 1).padStart(2, '0')}`, label: `25-${i + 1}`, width: 52 })),
    // 26年各月
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_26_${String(i + 1).padStart(2, '0')}`, label: `26-${i + 1}`, width: 52 })),
    { key: 'earned_total', label: '满期', width: 72 },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse" style={{ minWidth: '1400px' }}>
        <thead>
          <tr className={cn(colorClasses.bg.neutral, 'border-b', colorClasses.border.neutral)}>
            {headers.map((h) => (
              <th
                key={h.key}
                style={{ width: h.width, minWidth: h.width }}
                className={cn('px-1 py-2 text-center font-medium whitespace-nowrap', colorClasses.text.neutral)}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const policyMonth = row.policy_month;
            return (
              <tr key={policyMonth} className="border-b border-neutral-100 hover:bg-blue-50/30">
                {/* 起保月 */}
                <td className={cn('px-1 py-1.5 text-center font-medium', colorClasses.text.neutralDark)}>
                  {MONTH_LABELS[policyMonth]}
                </td>
                {/* 保费 */}
                <td className={cn('px-1 py-1.5 text-right font-tabular', colorClasses.text.neutralBlack)}>
                  {formatPremiumWan(row.premium)}
                </td>
                {/* 首日费用 */}
                <td className={cn('px-1 py-1.5 text-right font-tabular', colorClasses.text.primary)}>
                  {formatPremiumWan(row.first_day_fee)}
                </td>
                {/* 25年各月 */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_25_${String(m).padStart(2, '0')}` as keyof Policy2025TriangleRow;
                  const value = row[key] as number;
                  const isOutside = isOutsideTriangle(policyMonth, 2025, m, 2025);
                  const isZero = value === 0 || isOutside;
                  // 起保月的单元格用特殊背景色（首日费用+时间分摊）
                  const isStartMonth = m === policyMonth;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right font-tabular',
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack,
                        isStartMonth && !isZero && 'bg-emerald-50 font-medium text-emerald-700'
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 26年各月 */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_26_${String(m).padStart(2, '0')}` as keyof Policy2025TriangleRow;
                  const value = row[key] as number;
                  const isZero = value === 0;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right font-tabular',
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 最终已赚 */}
                <td className="px-1 py-1.5 text-right font-tabular font-semibold text-indigo-700 bg-indigo-50/50">
                  {formatPremiumWan(row.earned_total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** 2026年保单精算三角表格 */
const Policy2026TriangleTable: React.FC<{
  data: Policy2026TriangleRow[];
  loading?: boolean;
}> = ({ data, loading }) => {
  if (loading) {
    return <div className={cn('p-8 text-center', colorClasses.text.neutralMuted)}>加载中...</div>;
  }

  // 表头：起保月、保费、首日费用、26-1~26-12、27-1~27-12、最终已赚
  const headers = [
    { key: 'policy_month', label: '起保月', width: 56 },
    { key: 'premium', label: '保费', width: 72 },
    { key: 'first_day_fee', label: '首日', width: 56 },
    // 26年各月
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_26_${String(i + 1).padStart(2, '0')}`, label: `26-${i + 1}`, width: 52 })),
    // 27年各月
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_27_${String(i + 1).padStart(2, '0')}`, label: `27-${i + 1}`, width: 52 })),
    { key: 'earned_total', label: '满期', width: 72 },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse" style={{ minWidth: '1400px' }}>
        <thead>
          <tr className={cn(colorClasses.bg.neutral, 'border-b', colorClasses.border.neutral)}>
            {headers.map((h) => (
              <th
                key={h.key}
                style={{ width: h.width, minWidth: h.width }}
                className={cn('px-1 py-2 text-center font-medium whitespace-nowrap', colorClasses.text.neutral)}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const policyMonth = row.policy_month;
            return (
              <tr key={policyMonth} className="border-b border-neutral-100 hover:bg-blue-50/30">
                {/* 起保月 */}
                <td className={cn('px-1 py-1.5 text-center font-medium', colorClasses.text.neutralDark)}>
                  {MONTH_LABELS[policyMonth]}
                </td>
                {/* 保费 */}
                <td className={cn('px-1 py-1.5 text-right font-tabular', colorClasses.text.neutralBlack)}>
                  {formatPremiumWan(row.premium)}
                </td>
                {/* 首日费用 */}
                <td className={cn('px-1 py-1.5 text-right font-tabular', colorClasses.text.primary)}>
                  {formatPremiumWan(row.first_day_fee)}
                </td>
                {/* 26年各月 */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_26_${String(m).padStart(2, '0')}` as keyof Policy2026TriangleRow;
                  const value = row[key] as number;
                  const isOutside = isOutsideTriangle(policyMonth, 2026, m, 2026);
                  const isZero = value === 0 || isOutside;
                  // 起保月的单元格用特殊背景色（首日费用+时间分摊）
                  const isStartMonth = m === policyMonth;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right font-tabular',
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack,
                        isStartMonth && !isZero && 'bg-emerald-50 font-medium text-emerald-700'
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 27年各月 */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_27_${String(m).padStart(2, '0')}` as keyof Policy2026TriangleRow;
                  const value = row[key] as number;
                  const isZero = value === 0;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right font-tabular',
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 最终已赚 */}
                <td className="px-1 py-1.5 text-right font-tabular font-semibold text-indigo-700 bg-indigo-50/50">
                  {formatPremiumWan(row.earned_total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ==================== 主组件 ====================

/**
 * 新口径已赚保费分析表格组件（V4版本 - 精算三角视图）
 */
export const NewEarnedPremiumTable: React.FC<NewEarnedPremiumTableProps> = ({
  policy2025In2025Data,
  policy2025In2026Data,
  policy2026In2026Data,
  policy2026In2027Data,
  summaryData,
  loading = false,
  onExportCSV,
  onExportExcel,
}) => {
  // 主标签页状态
  const [mainTab, setMainTab] = useState<MainTab>('2025');

  // 滚动12月对比表格的年度筛选状态
  const availableYears = useMemo(() => getAvailableYears(summaryData), [summaryData]);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const years = getAvailableYears(summaryData);
    return years.length > 0 ? years[years.length - 1] : 2026; // 默认选择最新年度
  });

  // ==================== 数据合并 ====================

  const policy2025TriangleData = useMemo(
    () => merge2025PolicyData(policy2025In2025Data, policy2025In2026Data),
    [policy2025In2025Data, policy2025In2026Data]
  );

  const policy2026TriangleData = useMemo(
    () => merge2026PolicyData(policy2026In2026Data, policy2026In2027Data),
    [policy2026In2026Data, policy2026In2027Data]
  );

  const displaySummaryData = useMemo(
    () => transformSummaryData(summaryData),
    [summaryData]
  );

  // 滚动12月对比表格数据
  const rolling12MonthCompareData = useMemo(
    () => transformToRolling12MonthCompare(summaryData, selectedYear),
    [summaryData, selectedYear]
  );

  // 汇总表列配置
  const columnsSummary: Column<DisplaySummaryData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计年月', width: 110 },
      { key: 'rolling_12m_premium', header: '滚动12月保费(万)', width: 140, align: 'right' },
      { key: 'earned_from_2025', header: '25保单已赚(万)', width: 130, align: 'right' },
      { key: 'earned_from_2026', header: '26保单已赚(万)', width: 130, align: 'right' },
      { key: 'total_earned_premium', header: '合计已赚(万)', width: 120, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    []
  );

  // 滚动12月对比表格列配置
  const columnsRolling12: Column<Rolling12MonthCompareData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计月', width: 100 },
      { key: 'window_range', header: '窗口范围', width: 120 },
      { key: 'policy_2025_months', header: `${selectedYear - 1}年保单`, width: 100, align: 'center' },
      { key: 'policy_2026_months', header: `${selectedYear}年保单`, width: 100, align: 'center' },
      { key: 'rolling_12m_premium', header: 'R12M保费(万)', width: 130, align: 'right' },
      { key: 'total_earned', header: 'R12M已赚(万)', width: 130, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    [selectedYear]
  );

  // ==================== 精算三角导出处理 ====================

  const handleExport2025CSV = useCallback(() => {
    if (policy2025TriangleData.length === 0) return;
    const exportData = transform2025TriangleForExport(policy2025TriangleData);
    const filename = `2025年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [policy2025TriangleData]);

  const handleExport2025Excel = useCallback(async () => {
    if (policy2025TriangleData.length === 0) return;
    const exportData = transform2025TriangleForExport(policy2025TriangleData);
    const filename = `2025年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, '2025精算三角');
  }, [policy2025TriangleData]);

  const handleExport2026CSV = useCallback(() => {
    if (policy2026TriangleData.length === 0) return;
    const exportData = transform2026TriangleForExport(policy2026TriangleData);
    const filename = `2026年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [policy2026TriangleData]);

  const handleExport2026Excel = useCallback(async () => {
    if (policy2026TriangleData.length === 0) return;
    const exportData = transform2026TriangleForExport(policy2026TriangleData);
    const filename = `2026年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, '2026精算三角');
  }, [policy2026TriangleData]);

  // ==================== 空状态检查 ====================

  if (
    !loading &&
    policy2025In2025Data.length === 0 &&
    policy2025In2026Data.length === 0 &&
    policy2026In2026Data.length === 0 &&
    policy2026In2027Data.length === 0 &&
    summaryData.length === 0
  ) {
    return (
      <div className={cn(cardStyles.spacious, 'text-center', textStyles.caption)}>
        暂无数据
      </div>
    );
  }

  // ==================== 渲染表格内容 ====================

  const renderTableContent = () => {
    // 2025年保单精算三角
    if (mainTab === '2025') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2025年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className="inline-block w-3 h-3 bg-emerald-50 border border-emerald-200 mr-1 align-middle"></span>
                <span className="text-emerald-700 font-medium">起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExport2025CSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={policy2025TriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExport2025Excel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={policy2025TriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {policy2025TriangleData.length} 条记录</span>
            </div>
          </div>
          <Policy2025TriangleTable data={policy2025TriangleData} loading={loading} />
        </div>
      );
    }

    // 2026年保单精算三角
    if (mainTab === '2026') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2026年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className="inline-block w-3 h-3 bg-emerald-50 border border-emerald-200 mr-1 align-middle"></span>
                <span className="text-emerald-700 font-medium">起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExport2026CSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={policy2026TriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExport2026Excel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={policy2026TriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {policy2026TriangleData.length} 条记录</span>
            </div>
          </div>
          <Policy2026TriangleTable data={policy2026TriangleData} loading={loading} />
        </div>
      );
    }

    // 汇总统计
    if (mainTab === 'summary') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2026年各月末已赚保费汇总（滚动12个月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                已赚率 = 合计已赚保费 / 滚动12个月保费（起保日期口径）
              </p>
            </div>
            <span className={textStyles.caption}>共 {summaryData.length} 条记录</span>
          </div>
          <VirtualTable<DisplaySummaryData>
            columns={columnsSummary}
            data={displaySummaryData}
            loading={loading}
            height={Math.max(200, displaySummaryData.length * 40 + 60)}
            rowHeight={40}
          />
        </div>
      );
    }

    // 滚动12个月已赚保费对比表
    return (
      <div className={tableStyles.container}>
        <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
          <div>
            <h3 className={textStyles.titleSmall}>
              滚动12个月已赚保费（{selectedYear}年各月末统计）
            </h3>
            <p className={cn(textStyles.caption, 'mt-1')}>
              窗口范围：统计月往前推12个月 | 保单参与月数：窗口内起保的月份数
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 年度筛选器 */}
            <div className="flex items-center gap-2">
              <span className={textStyles.caption}>统计年度:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md border',
                  colorClasses.border.neutral,
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
                )}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}年
                  </option>
                ))}
              </select>
            </div>
            <span className={textStyles.caption}>共 {rolling12MonthCompareData.length} 条记录</span>
          </div>
        </div>
        <VirtualTable<Rolling12MonthCompareData>
          columns={columnsRolling12}
          data={rolling12MonthCompareData}
          loading={loading}
          height={Math.max(200, rolling12MonthCompareData.length * 40 + 60)}
          rowHeight={40}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 主标签页切换 + 导出按钮 */}
      <div className={cardStyles.standard}>
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <button
              onClick={() => setMainTab('2025')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === '2025' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              2025年保单
            </button>
            <button
              onClick={() => setMainTab('2026')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === '2026' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              2026年保单
            </button>
            <button
              onClick={() => setMainTab('summary')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'summary' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              汇总统计
            </button>
            <button
              onClick={() => setMainTab('rolling12')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'rolling12' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              滚动12月
            </button>
          </div>

          {/* 导出按钮 */}
          {(onExportCSV || onExportExcel) && (
            <div className="flex gap-2">
              {onExportCSV && (
                <button
                  onClick={onExportCSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                >
                  导出CSV
                </button>
              )}
              {onExportExcel && (
                <button
                  onClick={onExportExcel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                >
                  导出Excel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 说明提示 */}
      <div className={cn(badgeStyles.primary, 'block rounded-lg p-4 border border-primary-border')}>
        <h4 className={cn(textStyles.label, 'text-primary-dark mb-2')}>新口径已赚保费说明</h4>
        <ul className={cn(textStyles.body, 'text-primary-700 space-y-1 list-disc list-inside')}>
          <li>
            <strong className={textStyles.emphasis}>首日费用</strong>已并入<strong className={textStyles.emphasis}>起保月</strong>的已赚字段（绿色高亮）
          </li>
          <li>
            滚动12个月统计时，窗口内的首日费用<strong className={textStyles.emphasis}>自动计入</strong>已赚保费，窗口外则自动排除
          </li>
          <li>
            精算三角：行=起保月(1-12月)，列=统计月(25-1到26-12)，<span className={colorClasses.text.neutralMuted}>灰色0</span>=起保前（三角外）
          </li>
          <li>
            <strong className={textStyles.emphasis}>最终已赚</strong> = 首日费用 + 全部时间分摊 ≈ 保费 × (1 - F×(1-α))
          </li>
          <li>险类系数 α：交强险 = 0.82，商业险 = 0.94；F = 费用率</li>
        </ul>
      </div>

      {/* 表格内容 */}
      {renderTableContent()}
    </div>
  );
};

export default NewEarnedPremiumTable;
