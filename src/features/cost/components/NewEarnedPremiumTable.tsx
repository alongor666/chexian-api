/**
 * 新口径已赚保费分析表格（V4版本 - 精算三角视图）
 * New Earned Premium Analysis Table V4 - Actuarial Triangle View
 *
 * 核心改进：
 * - 上一保单年度（Y-1）：合并为单个精算三角表（起保月 × 统计月）
 * - 锚定年保单（Y）：合并为单个精算三角表（起保月 × 统计月）
 * - 汇总统计：滚动12个月统计
 *
 * 精算三角特征：
 * - 统计月列：起保年 1-12 月 + 次年 1-12 月（绝对年份由 anchorYear 推导）
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
  fontStyles,
  cn,
} from '../../../shared/styles';
import type {
  SameYearEarnedRow,
  CrossYearEarnedRow,
  NewEarnedPremiumSummaryData,
} from '../types/costTypes';
import { getEarnedMonthValue } from '../types/new-earned-premium';

interface NewEarnedPremiumTableProps {
  /** 锚定年 Y（后端解析的分析年度） */
  anchorYear: number;
  /** Y-1 年保单在 Y-1 年的已赚数据 */
  policyPrevInPrevData: SameYearEarnedRow[];
  /** Y-1 年保单在 Y 年的已赚数据 */
  policyPrevInCurrData: CrossYearEarnedRow[];
  /** Y 年保单在 Y 年的已赚数据 */
  policyCurrInCurrData: SameYearEarnedRow[];
  /** Y 年保单在 Y+1 年的已赚数据 */
  policyCurrInNextData: CrossYearEarnedRow[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  loading?: boolean;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
}

/** 主标签页类型（prev = Y-1 年保单，curr = Y 年保单） */
type MainTab = 'prev' | 'curr' | 'summary' | 'rolling12';

/** 月份标签 */
const MONTH_LABELS: Record<number, string> = {
  1: '1月', 2: '2月', 3: '3月', 4: '4月',
  5: '5月', 6: '6月', 7: '7月', 8: '8月',
  9: '9月', 10: '10月', 11: '11月', 12: '12月',
};

// ==================== 精算三角数据类型 ====================

/**
 * 保单精算三角行数据（起保年 + 次年两段各 12 个月，按月序数组存储）
 * 绝对年份由渲染层的 baseYear 推导，行结构与具体年份解耦。
 */
interface PolicyTriangleRow {
  policy_month: number;
  premium: number;
  first_day_fee: number;
  /** 起保年 1-12 月当月已赚（含首日费用并入起保月） */
  firstYearEarned: number[];
  /** 次年 1-12 月当月已赚（仅时间分摊增量） */
  secondYearEarned: number[];
  // 最终已赚（满期）
  earned_total: number;
}

/** 汇总表显示格式 */
interface DisplaySummaryData {
  stat_month: string;
  rolling_12m_premium: string;
  earned_from_prev: string;
  earned_from_curr: string;
  total_earned_premium: string;
  earned_ratio: string;
}

/** 滚动12月对比表格数据 */
interface Rolling12MonthCompareData {
  stat_month: string;           // 统计月（如 "26年1月"）
  window_range: string;         // 窗口范围（如 "25/2→26/1"）
  policy_prev_months: string;   // 上一年保单参与月数（如 "11个月"）
  policy_curr_months: string;   // 统计年保单参与月数（如 "1个月"）
  rolling_12m_premium: string;  // R12M保费(万)
  total_earned: string;         // R12M已赚(万)
  earned_ratio: string;         // 已赚率
}

// ==================== 数据合并函数 ====================

const TRIANGLE_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * 合并某保单年度的「同年已赚 + 次年已赚」为精算三角行。
 * 两个保单年度（Y-1 / Y）结构完全一致，统一走本函数。
 */
function mergeTriangleData(
  sameYearData: SameYearEarnedRow[],
  nextYearData: CrossYearEarnedRow[]
): PolicyTriangleRow[] {
  const result: PolicyTriangleRow[] = [];

  for (const m of TRIANGLE_MONTHS) {
    const sameRow = sameYearData.find((r) => r.policy_month === m);
    const nextRow = nextYearData.find((r) => r.policy_month === m);

    if (!sameRow) continue;

    result.push({
      policy_month: m,
      premium: sameRow.premium,
      first_day_fee: sameRow.first_day_fee,
      firstYearEarned: TRIANGLE_MONTHS.map((mm) => getEarnedMonthValue(sameRow, mm)),
      secondYearEarned: TRIANGLE_MONTHS.map((mm) => (nextRow ? getEarnedMonthValue(nextRow, mm) : 0)),
      // 最终已赚 = 起保年 total + 次年 total
      earned_total: sameRow.earned_total + (nextRow?.earned_total ?? 0),
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
      earned_from_prev: formatPremiumWan(row.earned_from_prev),
      earned_from_curr: formatPremiumWan(row.earned_from_curr),
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
      let policyPrevMonths: number;
      let policyCurrMonths: number;

      if (windowStartMonth <= 12) {
        // 窗口跨两年
        windowRange = `${shortPrevYear}/${windowStartMonth}→${shortYear}/${month}`;
        policyPrevMonths = 12 - month; // 上一年参与月数 = 12 - statMonth
        policyCurrMonths = month;      // 统计年参与月数 = statMonth
      } else {
        // 窗口在同一年（statMonth=12时，窗口=[Y/1, Y/12]）
        windowRange = `${shortYear}/1→${shortYear}/${month}`;
        policyPrevMonths = 0;          // 上一年无参与
        policyCurrMonths = 12;         // 统计年全年参与
      }

      return {
        stat_month: `${shortYear}年${month}月`,
        window_range: windowRange,
        policy_prev_months: policyPrevMonths > 0 ? `${policyPrevMonths}个月` : '-',
        policy_curr_months: `${policyCurrMonths}个月`,
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
 * 将保单精算三角数据转换为导出格式（列头年份由起保年 baseYear 派生）
 */
function transformTriangleForExport(data: PolicyTriangleRow[], baseYear: number): ExportTriangleRow[] {
  const y1 = baseYear % 100;
  const y2 = (baseYear + 1) % 100;
  return data.map((row) => {
    const exportRow: ExportTriangleRow = {
      '起保月': `${row.policy_month}月`,
      '保费': Math.round(row.premium),
      '首日': Math.round(row.first_day_fee),
    };
    TRIANGLE_MONTHS.forEach((m, i) => {
      exportRow[`${y1}年${m}月`] = Math.round(row.firstYearEarned[i]);
    });
    TRIANGLE_MONTHS.forEach((m, i) => {
      exportRow[`${y2}年${m}月`] = Math.round(row.secondYearEarned[i]);
    });
    exportRow['满期'] = Math.round(row.earned_total);
    return exportRow;
  });
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

/**
 * 保单精算三角表格（通用）
 *
 * 2025/2026 两张表结构完全相同，仅「起保年份前缀」（baseYear / baseYear+1）
 * 与 isOutsideTriangle 的 baseYear 参数不同，故合并为单一泛型组件，
 * 由 baseYear prop 派生两个年度列前缀。
 */
const PolicyTriangleTable: React.FC<{
  data: PolicyTriangleRow[];
  loading?: boolean;
  /** 起保年份（Y-1 / Y），决定三角的两个年度列前缀 */
  baseYear: number;
}> = ({ data, loading, baseYear }) => {
  if (loading) {
    return <div className={cn('p-8 text-center', colorClasses.text.neutralMuted)}>加载中...</div>;
  }

  const y1 = baseYear % 100;        // 起保年两位数
  const y2 = (baseYear + 1) % 100;  // 次年两位数

  // 表头：起保月、保费、首日费用、起保年各月、次年各月、最终已赚
  const headers = [
    { key: 'policy_month', label: '起保月', width: 56 },
    { key: 'premium', label: '保费', width: 72 },
    { key: 'first_day_fee', label: '首日', width: 56 },
    ...TRIANGLE_MONTHS.map((m) => ({ key: `y1_${m}`, label: `${y1}-${m}`, width: 52 })),
    ...TRIANGLE_MONTHS.map((m) => ({ key: `y2_${m}`, label: `${y2}-${m}`, width: 52 })),
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
              <tr key={policyMonth} className="border-b border-neutral-100 hover:bg-primary-bg/30">
                {/* 起保月 */}
                <td className={cn('px-1 py-1.5 text-center font-medium', colorClasses.text.neutralDark)}>
                  {MONTH_LABELS[policyMonth]}
                </td>
                {/* 保费 */}
                <td className={cn('px-1 py-1.5 text-right', fontStyles.numeric, colorClasses.text.neutralBlack)}>
                  {formatPremiumWan(row.premium)}
                </td>
                {/* 首日费用 */}
                <td className={cn('px-1 py-1.5 text-right', fontStyles.numeric, colorClasses.text.primary)}>
                  {formatPremiumWan(row.first_day_fee)}
                </td>
                {/* 起保年各月（受三角约束） */}
                {TRIANGLE_MONTHS.map((m, i) => {
                  const value = row.firstYearEarned[i];
                  const isOutside = isOutsideTriangle(policyMonth, baseYear, m, baseYear);
                  const isZero = value === 0 || isOutside;
                  // 起保月的单元格用特殊背景色（首日费用+时间分摊）
                  const isStartMonth = m === policyMonth;
                  return (
                    <td
                      key={`y1_${m}`}
                      className={cn(
                        'px-1 py-1.5 text-right', fontStyles.numeric,
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack,
                        isStartMonth && !isZero && `${colorClasses.bg.success} font-medium ${colorClasses.text.success}`
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 次年各月 */}
                {TRIANGLE_MONTHS.map((m, i) => {
                  const value = row.secondYearEarned[i];
                  const isZero = value === 0;
                  return (
                    <td
                      key={`y2_${m}`}
                      className={cn(
                        'px-1 py-1.5 text-right', fontStyles.numeric,
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 最终已赚 */}
                <td className={cn('px-1 py-1.5 text-right font-semibold bg-indigo-bg', fontStyles.numeric, colorClasses.text.indigo)}>
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
  anchorYear,
  policyPrevInPrevData,
  policyPrevInCurrData,
  policyCurrInCurrData,
  policyCurrInNextData,
  summaryData,
  loading = false,
  onExportCSV,
  onExportExcel,
}) => {
  const prevYear = anchorYear - 1;

  // 主标签页状态
  const [mainTab, setMainTab] = useState<MainTab>('prev');

  // 滚动12月对比表格的年度筛选状态
  const availableYears = useMemo(() => getAvailableYears(summaryData), [summaryData]);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const years = getAvailableYears(summaryData);
    return years.length > 0 ? years[years.length - 1] : anchorYear; // 默认选择最新年度
  });

  // ==================== 数据合并 ====================

  const prevPolicyTriangleData = useMemo(
    () => mergeTriangleData(policyPrevInPrevData, policyPrevInCurrData),
    [policyPrevInPrevData, policyPrevInCurrData]
  );

  const currPolicyTriangleData = useMemo(
    () => mergeTriangleData(policyCurrInCurrData, policyCurrInNextData),
    [policyCurrInCurrData, policyCurrInNextData]
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
      { key: 'earned_from_prev', header: `${prevYear % 100}保单已赚(万)`, width: 130, align: 'right' },
      { key: 'earned_from_curr', header: `${anchorYear % 100}保单已赚(万)`, width: 130, align: 'right' },
      { key: 'total_earned_premium', header: '合计已赚(万)', width: 120, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    [prevYear, anchorYear]
  );

  // 滚动12月对比表格列配置
  const columnsRolling12: Column<Rolling12MonthCompareData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计月', width: 100 },
      { key: 'window_range', header: '窗口范围', width: 120 },
      { key: 'policy_prev_months', header: `${selectedYear - 1}年保单`, width: 100, align: 'center' },
      { key: 'policy_curr_months', header: `${selectedYear}年保单`, width: 100, align: 'center' },
      { key: 'rolling_12m_premium', header: 'R12M保费(万)', width: 130, align: 'right' },
      { key: 'total_earned', header: 'R12M已赚(万)', width: 130, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    [selectedYear]
  );

  // ==================== 精算三角导出处理 ====================

  const handleExportPrevCSV = useCallback(() => {
    if (prevPolicyTriangleData.length === 0) return;
    const exportData = transformTriangleForExport(prevPolicyTriangleData, prevYear);
    const filename = `${prevYear}年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [prevPolicyTriangleData, prevYear]);

  const handleExportPrevExcel = useCallback(async () => {
    if (prevPolicyTriangleData.length === 0) return;
    const exportData = transformTriangleForExport(prevPolicyTriangleData, prevYear);
    const filename = `${prevYear}年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, `${prevYear}精算三角`);
  }, [prevPolicyTriangleData, prevYear]);

  const handleExportCurrCSV = useCallback(() => {
    if (currPolicyTriangleData.length === 0) return;
    const exportData = transformTriangleForExport(currPolicyTriangleData, anchorYear);
    const filename = `${anchorYear}年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [currPolicyTriangleData, anchorYear]);

  const handleExportCurrExcel = useCallback(async () => {
    if (currPolicyTriangleData.length === 0) return;
    const exportData = transformTriangleForExport(currPolicyTriangleData, anchorYear);
    const filename = `${anchorYear}年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, `${anchorYear}精算三角`);
  }, [currPolicyTriangleData, anchorYear]);

  // ==================== 空状态检查 ====================

  if (
    !loading &&
    policyPrevInPrevData.length === 0 &&
    policyPrevInCurrData.length === 0 &&
    policyCurrInCurrData.length === 0 &&
    policyCurrInNextData.length === 0 &&
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
    // 上一保单年度（Y-1）精算三角
    if (mainTab === 'prev') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                {prevYear}年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className={cn('inline-block w-3 h-3 mr-1 align-middle', colorClasses.bg.success, colorClasses.border.success, 'border')}></span>
                <span className={cn('font-medium', colorClasses.text.success)}>起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExportPrevCSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={prevPolicyTriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExportPrevExcel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={prevPolicyTriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {prevPolicyTriangleData.length} 条记录</span>
            </div>
          </div>
          <PolicyTriangleTable baseYear={prevYear} data={prevPolicyTriangleData} loading={loading} />
        </div>
      );
    }

    // 锚定年（Y）保单精算三角
    if (mainTab === 'curr') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                {anchorYear}年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className={cn('inline-block w-3 h-3 mr-1 align-middle', colorClasses.bg.success, colorClasses.border.success, 'border')}></span>
                <span className={cn('font-medium', colorClasses.text.success)}>起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExportCurrCSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={currPolicyTriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExportCurrExcel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={currPolicyTriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {currPolicyTriangleData.length} 条记录</span>
            </div>
          </div>
          <PolicyTriangleTable baseYear={anchorYear} data={currPolicyTriangleData} loading={loading} />
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
                {anchorYear}年各月末已赚保费汇总（滚动12个月）
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
              onClick={() => setMainTab('prev')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'prev' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              {prevYear}年保单
            </button>
            <button
              onClick={() => setMainTab('curr')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'curr' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              {anchorYear}年保单
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
            精算三角：行=起保月(1-12月)，列=统计月({prevYear % 100}-1到{anchorYear % 100}-12)，<span className={colorClasses.text.neutralMuted}>灰色0</span>=起保前（三角外）
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
