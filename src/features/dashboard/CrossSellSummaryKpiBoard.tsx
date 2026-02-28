/**
 * 驾乘险推介率汇总 KPI 卡片组
 * Cross-Sell Summary KPI Board
 *
 * 使用表格格式展示：
 * - 非营业客车/货车：险别组合/指标 | 驾乘保费 | 车险件数 | 推介率 | 驾乘件均 | 车险件均
 * - 摩托车：险别组合/指标 | 推介率（只有单交）
 * - 环比状态：显示与上一周期的变化（当日vs昨日、当周vs上周、当月vs上月）
 */

import { memo, useMemo } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { textStyles, cardStyles, numericStyles, cn, colorClasses } from '@/shared/styles';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { useCrossSellTimePeriod, type SeatCoverageLevel, type VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { getRateClassByField, getAvgPremiumClassByCoverage } from './crossSellRateStatus';

export type TimePeriod = 'day' | 'week' | 'month' | 'year';

interface CrossSellSummaryKpiBoardProps {
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  filters: AdvancedFilterState;
  timePeriod: TimePeriod;
  prefetchedSummary?: {
    maxDate: string | null;
    rows: Array<Record<string, unknown>>;
  };
}



// 非营业客车/货车的行定义：险别组合
const COVERAGE_ROWS_FULL = [
  { key: '整体', label: '整体' },
  { key: '主全', label: '主全' },
  { key: '交三', label: '交三' },
  { key: '单交', label: '单交' },
] as const;

// 摩托车的行定义：只有单交
const COVERAGE_ROWS_MOTORCYCLE = [
  { key: '单交', label: '单交' },
] as const;

// 非营业客车/货车的列定义：指标
const METRIC_COLUMNS_FULL = [
  { key: 'premium', label: '驾乘保费' },
  { key: 'auto_count', label: '车险件数' },
  { key: 'driver_count', label: '驾乘险件数' },
  { key: 'rate', label: '推介率' },
  { key: 'avg_premium', label: '驾乘件均' },
  { key: 'auto_avg_premium', label: '车险件均' },
] as const;

// 摩托车的列定义：只有推介率
const METRIC_COLUMNS_MOTORCYCLE = [
  { key: 'rate', label: '推介率' },
] as const;

interface TimePeriodData {
  auto_count: number;
  driver_count: number;
  premium: number;
  rate: number;
  avg_premium: number;
  auto_avg_premium: number;
  // 上一周期数据
  prev_auto_count: number;
  prev_driver_count: number;
  prev_premium: number;
  prev_rate: number;
  prev_avg_premium: number;
  prev_auto_avg_premium: number;
}

function formatPremium(value: number): string {
  return formatDriverPremiumWan(value * 10000);
}

function getRateColorClass(coverageKey: string, value: number): string {
  if (coverageKey === '主全') {
    return getRateClassByField('zhuquan_rate', value);
  }
  if (coverageKey === '交三') {
    return getRateClassByField('jiaosan_rate', value);
  }
  return '';
}

/**
 * 计算环比变化（包含百分比）
 */
function calcChange(current: number, prev: number): {
  value: number;
  percent: number;
  status: 'up' | 'down' | 'flat';
} {
  const diff = current - prev;
  // 计算百分比变化（避免除零）
  const percentChange = prev !== 0 ? (diff / prev) * 100 : 0;

  // 判断状态（使用阈值避免浮点误差）
  if (Math.abs(diff) < 0.01 && Math.abs(percentChange) < 0.1) {
    return { value: 0, percent: 0, status: 'flat' };
  }
  return {
    value: diff,
    percent: percentChange,
    status: diff > 0 ? 'up' : 'down'
  };
}

/**
 * 格式化环比变化显示文本
 * - rate: 只显示百分比（如 +2.1%）
 * - 其他: 显示绝对值 + 百分比（如 +8.3, +7.1%）
 */
function formatChangeDisplay(change: { value: number; percent: number; status: 'up' | 'down' | 'flat' }, metricKey: string): string {
  const arrow = getChangeArrow(change.status);

  // 持平状态
  if (change.status === 'flat') {
    if (metricKey === 'rate') {
      return `${arrow} 0%`;
    }
    return `${arrow} 0, 0%`;
  }

  const sign = change.value >= 0 ? '+' : '';

  // 推介率：只显示百分比
  if (metricKey === 'rate') {
    return `${arrow} ${sign}${change.percent.toFixed(1)}%`;
  }

  // 其他指标：绝对值 + 百分比
  let absValue: string;
  if (metricKey === 'premium') {
    absValue = change.value.toFixed(1);
  } else {
    absValue = Math.round(change.value).toString();
  }

  return `${arrow} ${sign}${absValue}, ${sign}${change.percent.toFixed(1)}%`;
}

/**
 * 获取环比状态样式类
 */
function getChangeStatusClass(status: 'up' | 'down' | 'flat'): string {
  switch (status) {
    case 'up':
      return colorClasses.text.success;
    case 'down':
      return colorClasses.text.danger;
    case 'flat':
      return colorClasses.text.neutralMuted;
  }
}

/**
 * 获取环比箭头符号（垂直箭头）
 */
function getChangeArrow(status: 'up' | 'down' | 'flat'): string {
  switch (status) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'flat':
      return '—';
  }
}

export const CrossSellSummaryKpiBoard = memo(function CrossSellSummaryKpiBoard({
  vehicleCategory,
  seatCoverageLevel,
  filters,
  timePeriod,
  prefetchedSummary,
}: CrossSellSummaryKpiBoardProps) {
  const summaryQuery = useCrossSellTimePeriod({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    enabled: !prefetchedSummary,
  });
  const maxDate = prefetchedSummary?.maxDate ?? summaryQuery.maxDate;
  const rawData = (prefetchedSummary?.rows as any[] | undefined) ?? summaryQuery.rawData;
  const loading = prefetchedSummary ? false : summaryQuery.loading;
  const error = prefetchedSummary ? null : summaryQuery.error;

  // 判断是否为摩托车
  const isMotorcycle = vehicleCategory === 'motorcycle';

  // 根据车辆类别选择行和列
  const coverageRows = isMotorcycle ? COVERAGE_ROWS_MOTORCYCLE : COVERAGE_ROWS_FULL;
  const metricColumns = isMotorcycle ? METRIC_COLUMNS_MOTORCYCLE : METRIC_COLUMNS_FULL;

  // 根据选择的时间维度获取数据
  const dataByCoverage = useMemo(() => {
    if (!rawData || rawData.length === 0) return new Map<string, TimePeriodData>();

    const map = new Map<string, TimePeriodData>();
    for (const row of rawData) {
      const prefix = timePeriod;
      const rowAny = row as unknown as Record<string, unknown>;

      // 当年不需要环比数据
      const showPrev = timePeriod !== 'year';
      const prevPrefix = showPrev ? `prev_${prefix}` : '';

      map.set(row.coverage_combination, {
        auto_count: Number(rowAny[`${prefix}_auto_count`] ?? 0),
        driver_count: Number(rowAny[`${prefix}_driver_count`] ?? 0),
        premium: Number(rowAny[`${prefix}_premium`] ?? 0) / 10000,
        rate: Number(rowAny[`${prefix}_rate`] ?? 0),
        avg_premium: Number(rowAny[`${prefix}_avg_premium`] ?? 0),
        auto_avg_premium: Number(rowAny[`${prefix}_auto_avg_premium`] ?? 0),
        // 上一周期数据
        prev_auto_count: showPrev ? Number(rowAny[`${prevPrefix}_auto_count`] ?? 0) : 0,
        prev_driver_count: showPrev ? Number(rowAny[`${prevPrefix}_driver_count`] ?? 0) : 0,
        prev_premium: showPrev ? Number(rowAny[`${prevPrefix}_premium`] ?? 0) / 10000 : 0,
        prev_rate: showPrev ? Number(rowAny[`${prevPrefix}_rate`] ?? 0) : 0,
        prev_avg_premium: showPrev ? Number(rowAny[`${prevPrefix}_avg_premium`] ?? 0) : 0,
        prev_auto_avg_premium: showPrev ? Number(rowAny[`${prevPrefix}_auto_avg_premium`] ?? 0) : 0,
      });
    }
    return map;
  }, [rawData, timePeriod]);

  // 获取单元格显示内容（包含环比状态）
  const getCellContent = (
    metricKey: string,
    coverageKey: string
  ): { text: string; colorClass: string; change?: { value: number; percent: number; status: 'up' | 'down' | 'flat' } } => {
    const data = dataByCoverage.get(coverageKey);

    if (loading) {
      return { text: '--', colorClass: '' };
    }

    // 当年不显示环比
    const showChange = timePeriod !== 'year';

    switch (metricKey) {
      case 'premium': {
        const change = showChange ? calcChange(data?.premium ?? 0, data?.prev_premium ?? 0) : undefined;
        return {
          text: formatPremium(data?.premium ?? 0),
          colorClass: '',
          change
        };
      }
      case 'auto_count': {
        const change = showChange ? calcChange(data?.auto_count ?? 0, data?.prev_auto_count ?? 0) : undefined;
        return {
          text: formatCount(data?.auto_count ?? 0),
          colorClass: '',
          change
        };
      }
      case 'driver_count': {
        const change = showChange ? calcChange(data?.driver_count ?? 0, data?.prev_driver_count ?? 0) : undefined;
        return {
          text: formatCount(data?.driver_count ?? 0),
          colorClass: '',
          change
        };
      }
      case 'rate': {
        const rate = data?.rate ?? 0;
        const change = showChange ? calcChange(rate, data?.prev_rate ?? 0) : undefined;
        return {
          text: formatPercent(rate),
          colorClass: getRateColorClass(coverageKey, rate),
          change
        };
      }
      case 'avg_premium': {
        const avg_premium = data?.avg_premium ?? 0;
        const change = showChange ? calcChange(avg_premium, data?.prev_avg_premium ?? 0) : undefined;
        return {
          text: `${formatCount(avg_premium)}元`,
          colorClass: getAvgPremiumClassByCoverage(coverageKey, avg_premium),
          change
        };
      }
      case 'auto_avg_premium': {
        const auto_avg_premium = data?.auto_avg_premium ?? 0;
        const change = showChange ? calcChange(auto_avg_premium, data?.prev_auto_avg_premium ?? 0) : undefined;
        return {
          text: `${formatCount(auto_avg_premium)}元`,
          colorClass: '',
          change
        };
      }
      default:
        return { text: '-', colorClass: '' };
    }
  };

  if (error) {
    return (
      <div className="bg-danger-bg border border-danger-border rounded-xl p-4">
        <p className="text-danger text-sm">加载失败: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 时间选择器 + 数据截止日期 */}
      <div className="flex items-center justify-end">
        {maxDate && (
          <p className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
            数据截至: {maxDate} (保费单位: 万元)
          </p>
        )}
      </div>

      {/* 数据表格 */}
      <div className={cn(cardStyles.interactive, 'overflow-hidden')}>
        <table className="w-full">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className={cn('py-3 px-4 text-left font-medium w-28', colorClasses.text.neutralLight)}>
                险别组合/指标
              </th>
              {metricColumns.map((col) => (
                <th
                  key={col.key}
                  className={cn('py-3 px-4 text-left font-medium', colorClasses.text.neutralLight)}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverageRows.map((row, idx) => (
              <tr
                key={row.key}
                className={cn(
                  'border-b border-neutral-100 last:border-b-0',
                  idx % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'
                )}
              >
                {/* 险别组合名称 */}
                <td className="py-4 px-4">
                  <span className={cn(textStyles.body, 'font-medium', colorClasses.text.neutralDark)}>
                    {row.label}
                  </span>
                </td>
                {/* 指标数值 + 环比状态 */}
                {metricColumns.map((col) => {
                  const { text, colorClass, change } = getCellContent(col.key, row.key);
                  return (
                    <td key={col.key} className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            numericStyles.kpiPrimary,
                            '!text-[15px]',
                            colorClass || colorClasses.text.neutralBlack
                          )}
                        >
                          {text}
                        </span>
                        {change && (
                          <span
                            className={cn(
                              'text-sm leading-tight whitespace-nowrap',
                              getChangeStatusClass(change.status)
                            )}
                          >
                            {formatChangeDisplay(change, col.key)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 验证公式说明 - 摩托车不显示 */}
      {!isMotorcycle && (
        <div className={cn(textStyles.caption, colorClasses.text.neutralMuted, 'italic')}>
          💡 验证公式：驾乘保费 ≈ 车险件数 × 推介率 × 驾乘件均
        </div>
      )}
    </div>
  );
});

export default CrossSellSummaryKpiBoard;
