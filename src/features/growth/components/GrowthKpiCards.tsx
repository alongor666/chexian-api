import React, { useMemo } from 'react';
import { GrowthData } from '../hooks/useGrowthAnalysis';
import { formatRate } from '../../../shared/utils/formatters';
import { cn, getTrendColorClass, colorClasses } from '../../../shared/styles';


interface GrowthKpiCardsProps {
  data: GrowthData[];
  cutoffDate: string;
  valueFormatter: (value: number | null | undefined) => string;
  unitLabel: string;
}

export const GrowthKpiCards: React.FC<GrowthKpiCardsProps> = ({
  data,
  cutoffDate,
  valueFormatter,
  unitLabel,
}) => {
  // 查找截止日期当天的数据
  const todayData = useMemo(() => {
    if (!data || data.length === 0) return null;

    // 尝试匹配截止日期
    const match = data.find(item => {
      if (!item.time_period) return false;
      let dateStr = '';
      const timePeriod: any = item.time_period;
      if (timePeriod instanceof Date) {
        const year = timePeriod.getFullYear();
        const month = String(timePeriod.getMonth() + 1).padStart(2, '0');
        const day = String(timePeriod.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      } else if (typeof item.time_period === 'number') {
        const date = new Date(item.time_period);
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          dateStr = `${year}-${month}-${day}`;
        }
      } else if (typeof item.time_period === 'string') {
        dateStr = (item.time_period ?? '').split('T')[0];
      }
      return dateStr === cutoffDate;
    });

    // 如果没找到匹配日期的，且数据量不大，默认取最后一条有效数据作为兜底
    if (!match && data.length > 0) {
      return data[data.length - 1];
    }
    return match;
  }, [data, cutoffDate]);

  if (!todayData) {
    return <div className={cn('p-4 text-center', colorClasses.text.neutralLight)}>暂无选中日期的KPI数据</div>;
  }

  // 辅助组件：趋势指示器
  const TrendIndicator = ({ value }: { value: number | null | undefined }) => {
    if (value == null) return <span className="text-neutral-400">-</span>;
    const isPositive = value > 0;
    const isZero = value === 0;
    const trendColorClass = getTrendColorClass(value, 'positive');

    return (
      <span className={cn('font-bold ml-1', trendColorClass)}>
        {isPositive ? '↑' : isZero ? '-' : '↓'} {formatRate(Math.abs(value))}
      </span>
    );
  };

  // 格式化日期：2025-01-08 -> 2025年01月08日
  const formattedDate = useMemo(() => {
    if (!cutoffDate) return '今日';
    const parts = cutoffDate.split('-');
    if (parts.length === 3) {
      return `${parts[0]}年${parts[1]}月${parts[2]}日`;
    }
    return cutoffDate;
  }, [cutoffDate]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* 1. 今日战况 (Daily) */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg p-4 shadow-sm border border-neutral-100 dark:border-subtle flex flex-col justify-between">
        <div>
          <div className="text-neutral-500 text-sm font-medium mb-1">{formattedDate}战况 (Daily)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{valueFormatter(todayData.current_value)}</span>
            <span className="text-sm text-neutral-500">{unitLabel}</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-neutral-50 dark:border-subtle flex justify-between items-center text-sm">
          <div>
            <span className="text-neutral-400 mr-1">同比</span>
            <TrendIndicator value={todayData.growth_rate} />
          </div>
          <div className="text-neutral-400">
            上年: {valueFormatter(todayData.previous_value)}
          </div>
        </div>
      </div>

      {/* 2. 本月进度 (MTD) */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg p-4 shadow-sm border border-neutral-100 dark:border-subtle flex flex-col justify-between">
        <div>
          <div className="text-neutral-500 text-sm font-medium mb-1">本月进度 (MTD)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{valueFormatter(todayData.period_total_current)}</span>
            <span className="text-sm text-neutral-500">{unitLabel}</span>
          </div>
        </div>

        <div className="mt-3">
          {/* 进度条模拟：以前一年同期为基准，或者简单显示占比 */}
          <div className="flex justify-between text-xs mb-1">
            <span className="text-neutral-500">当月累计增速</span>
            <TrendIndicator value={todayData.period_growth_rate} />
          </div>
          <div className="w-full bg-neutral-100 dark:bg-white/8 rounded-full h-1.5">
            {/* 这里的进度条如果没目标，就没法画准确百分比。
                暂且用 (今年/去年) 的比例来示意，最大100%，超过变色 */}
            <div
              className={`h-1.5 rounded-full ${todayData.period_total_current && todayData.period_total_previous && todayData.period_total_current >= todayData.period_total_previous ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, ((todayData.period_total_current || 0) / (todayData.period_total_previous || 1)) * 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between items-center text-sm mt-2 pt-1 border-t border-neutral-50 dark:border-subtle">
            <div className="text-neutral-400">上年同期: {valueFormatter(todayData.period_total_previous)}</div>
          </div>
        </div>
      </div>

      {/* 3. 全年累计 (YTD) */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg p-4 shadow-sm border border-neutral-100 dark:border-subtle flex flex-col justify-between">
        <div>
          <div className="text-neutral-500 text-sm font-medium mb-1">全年累计 (YTD)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{valueFormatter(todayData.ytd_total_current)}</span>
            <span className="text-sm text-neutral-500">{unitLabel}</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-neutral-50 dark:border-subtle">
          <div className="flex justify-between items-center mb-1">
            <span className="text-neutral-400 text-sm">同比增速</span>
            <TrendIndicator value={todayData.ytd_growth_rate} />
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-neutral-400">规模缺口</span>
            <span
              className={cn(
                'font-medium',
                // 规模缺口默认视为正向指标：增加更优
                getTrendColorClass(
                  (todayData.ytd_total_current || 0) - (todayData.ytd_total_previous || 0),
                  'positive'
                )
              )}
            >
              {(todayData.ytd_total_current || 0) - (todayData.ytd_total_previous || 0) >= 0 ? '+' : ''}
              {valueFormatter((todayData.ytd_total_current || 0) - (todayData.ytd_total_previous || 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
