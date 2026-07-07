import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { TimeView } from './LineChart';
import { EChartContainer, buildEmptyChartOption } from './EChartContainer';
import { formatPercent, formatPremiumWan, formatWanDirect } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import { cardStyles, cn } from '../../shared/styles';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

interface QualityBusinessChartProps {
  title: string;
  data: {
    time_period: string;
    quality_premium: number;
    total_premium: number;
    quality_ratio: number;
  }[];
  loading?: boolean;
  height?: number;
  timeView: TimeView;
  startDate?: string;
  endDate?: string;
}

/**
 * 辅助函数：根据年和周序号计算该周的起始日期（同步 SQL 中的自然周逻辑）
 */
const getWeekStartDate = (year: number, week: number): Date => {
  const jan1 = new Date(year, 0, 1);
  const jan1DayOfWeek = jan1.getDay(); // 0 是周日
  // SQL 逻辑：第一周从 1月1日开始
  if (week === 1) return jan1;
  // 计算第一个周一
  const daysToFirstMonday = jan1DayOfWeek === 0 ? 1 : 8 - jan1DayOfWeek;
  // 第 n 周开始于：第一个周一 + (n-2) * 7 + 1
  return new Date(year, 0, daysToFirstMonday + (week - 2) * 7 + 1);
};

/**
 * 优质业务占比趋势图组件
 */
export const QualityBusinessChart: React.FC<QualityBusinessChartProps> = ({
  title,
  data,
  loading = false,
  height = 400,
  timeView,
  startDate,
  endDate,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo<EChartsOption>(() => {
    if (data.length === 0) {
      return {
        ...(buildEmptyChartOption('暂无数据') as EChartsOption),
        title: { text: title, left: 'center' },
      };
    }

    // 判断日期跨度是否超过 183 天
    const isLongRange = (() => {
      if (!startDate || !endDate) return false;
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
      return diffDays > 183;
    })();

    const theme = getChartTheme(isDark);

    // Extract data
    const timePeriods = data.map(d => d.time_period);
    const qualityPremiums = data.map(d => d.quality_premium);
    const otherPremiums = data.map(d => Math.max(0, d.total_premium - d.quality_premium));
    const qualityRatios = data.map(d => d.quality_ratio * 100);
    const showEdgeLabels = timeView === 'daily' && timePeriods.length < 32;
    // 紧凑模式：矮图（如仪表盘次级小图 180px）下隐藏密集点标签 / 滑块 / 图例，避免重叠糊成一团
    const compact = (height ?? 400) < 240;

    // Prepare MarkPoints for Daily View
    const markPointData: Array<Record<string, unknown>> = [];
    if (timeView === 'daily') {
      const monthlyStats: Record<string, { min: { val: number; idx: number }; max: { val: number; idx: number } }> = {};
      data.forEach((d, idx) => {
        const month = (d.time_period ?? '').substring(0, 7);
        const ratio = d.quality_ratio * 100;
        if (!monthlyStats[month]) {
          monthlyStats[month] = { min: { val: ratio, idx }, max: { val: ratio, idx } };
        } else {
          if (ratio < monthlyStats[month].min.val) monthlyStats[month].min = { val: ratio, idx };
          if (ratio > monthlyStats[month].max.val) monthlyStats[month].max = { val: ratio, idx };
        }
      });
      Object.values(monthlyStats).forEach(stat => {
        markPointData.push({
          name: '月最低', coord: [stat.min.idx, stat.min.val], value: formatPercent(stat.min.val),
          itemStyle: { color: '#5470C6' }, label: { position: 'bottom', color: '#333', fontSize: 10 }
        });
        markPointData.push({
          name: '月最高', coord: [stat.max.idx, stat.max.val], value: formatPercent(stat.max.val),
          itemStyle: { color: '#EE6666' }, label: { position: 'top', color: '#333', fontSize: 10 }
        });
      });
    }

    return {
      title: { text: title, left: 'center' },
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const timePeriod = safeParams[0]?.axisValue || '';
          let result = `<div style="font-weight: bold; margin-bottom: 4px;">${timePeriod}</div>`;
          let totalVal = 0;
          safeParams.forEach((param) => {
            const value = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            if (param.seriesName === '优质业务' || param.seriesName === '其他业务') totalVal += value;
            if (param.seriesName === '优质业务占比') {
              result += `<div style="display: flex; align-items: center; margin: 2px 0;"><span style="display: inline-block; width: 10px; height: 10px; background: ${param.color}; margin-right: 5px; border-radius: 50%;"></span><span>${param.seriesName}: ${formatPercent(value)}</span></div>`;
            } else {
              result += `<div style="display: flex; align-items: center; margin: 2px 0;"><span style="display: inline-block; width: 10px; height: 10px; background: ${param.color}; margin-right: 5px; border-radius: 50%;"></span><span>${param.seriesName}: ${formatPremiumWan(value)}万</span></div>`;
            }
          });
          result += `<hr style="margin: 4px 0; border: 0; border-top: 1px solid #eee;" /><div style="display: flex; justify-content: space-between;"><span>总保费:</span><b>${formatPremiumWan(totalVal)}万</b></div>`;
          return result;
        },
      },
      legend: { show: !compact, data: ['优质业务', '其他业务', '优质业务占比'], top: 30, textStyle: { color: theme.chartTextStyles.legend.color } },
      grid: { left: '3%', right: '4%', bottom: compact ? '8%' : '15%', top: compact ? '8%' : 60, containLabel: true },
      xAxis: {
        type: 'category',
        data: timePeriods,
        axisLabel: {
          ...theme.xAxisConfig.axisLabel,
          rotate: 0,
          // 矮图（次级小图）抽稀 X 标签到 ~6 个，避免周标签挤成一条
          interval: compact ? Math.max(1, Math.ceil(timePeriods.length / 6)) : 0,
          formatter: (value: string, index: number) => {
            if (timeView === 'weekly') {
              const [yearStr, weekStr] = value.split('-W');
              const year = parseInt(yearStr);
              const week = parseInt(weekStr);

              // 长跨度抽稀：只显示每月第一周
              if (isLongRange && index > 0) {
                const currentWeekStart = getWeekStartDate(year, week);
                const prevValue = timePeriods[index - 1];
                const [pY, pW] = prevValue.split('-W').map(Number);
                const prevWeekStart = getWeekStartDate(pY, pW);
                // 如果当前周与上一周月份相同，则不显示标签
                if (currentWeekStart.getMonth() === prevWeekStart.getMonth()) {
                  return '';
                }
              }

              // 只有第一个点显示年份
              if (index === 0) return value;
              return `W${weekStr}`;
            }

            if (timeView === 'daily') {
              if (showEdgeLabels) {
                if (index === 0 || index === timePeriods.length - 1) {
                  const [, month, day] = value.split('-').map(Number);
                  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                }
                return '';
              }

              const date = new Date(value);
              const month = date.getMonth() + 1;
              const day = date.getDate();
              if (day === 1) return `${month}月1日`;
              if (month === 12 && day === 31) return '12月31日';
              return '';
            }
            return value;
          },
        },
        splitLine: { show: false },
        axisTick: {
          alignWithLabel: true,
          interval: (index: number, value: string) => {
            if (timeView === 'weekly') {
              if (!isLongRange) return true;
              if (index === 0) return true;
              const [y, w] = value.split('-W').map(Number);
              const [pY, pW] = timePeriods[index - 1].split('-W').map(Number);
              return getWeekStartDate(y, w).getMonth() !== getWeekStartDate(pY, pW).getMonth();
            }
            if (timeView === 'daily') {
              if (showEdgeLabels) {
                return index === 0 || index === timePeriods.length - 1;
              }
              const d = new Date(value);
              return d.getDate() === 1 || (d.getMonth() === 11 && d.getDate() === 31);
            }
            return true;
          }
        }
      },
      yAxis: [
        {
          type: 'value',
          name: '保费（万元）',
          position: 'left',
          splitLine: { show: false },
          axisLabel: { ...theme.yAxisConfig.axisLabel, formatter: (value: number) => formatPremiumWan(value) },
        },
        {
          type: 'value',
          name: '占比（%）',
          position: 'right',
          splitLine: { show: false },
          min: 0,
          max: 100,
          axisLabel: { ...theme.yAxisConfig.axisLabel, formatter: (value: number) => formatPercent(value) },
        },
      ],
      series: [
        {
          name: '优质业务',
          type: 'bar',
          stack: 'total',
          yAxisIndex: 0,
          data: qualityPremiums,
          itemStyle: { color: '#059669' },
          label: {
            show: timeView !== 'daily' && !compact,
            position: 'inside',
            formatter: (params: any) => {
              const safeParams = params as EChartsParam;
              const val = Number((safeParams.value as any) ?? 0) / 10000;
              return val > 0 ? formatWanDirect(val) : '';
            },
            color: '#fff',
            fontSize: 10
          }
        },
        {
          name: '其他业务',
          type: 'bar',
          stack: 'total',
          yAxisIndex: 0,
          data: otherPremiums,
          itemStyle: { color: '#E5E7EB' },
          label: { show: false }
        },
        {
          name: '优质业务占比',
          type: 'line',
          yAxisIndex: 1,
          data: qualityRatios,
          smooth: true,
          itemStyle: { color: '#F59E0B' },
          lineStyle: { width: compact ? 2 : 3 },
          label: {
            show: !compact,
            position: 'top',
            formatter: (params: any) => {
              const safeParams = params as EChartsParam;
              const rawValue =
                typeof safeParams.value === 'number'
                  ? safeParams.value
                  : Number((safeParams.value as any) ?? 0);
              return formatPercent(rawValue);
            },
            color: '#F59E0B'
          },
          markPoint: timeView === 'daily' ? {
            data: markPointData as any,
            symbol: 'circle',
            symbolSize: 6,
            label: { show: true, formatter: '{c}' }
          } : undefined
        },
      ],
      dataZoom: compact
        ? [{ type: 'inside', start: 0, end: 100 }]
        : [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 20 },
          ],
    };
  }, [data, title, height, timeView, startDate, endDate, isDark]);

  return (
    <div className={cn(cardStyles.standard)}>
      <EChartContainer option={option} loading={loading} height={height} />
    </div>
  );
};
