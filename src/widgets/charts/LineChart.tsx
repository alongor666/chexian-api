import React, { useEffect, useRef } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatRate, formatCount } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import { getYearChartColor } from '../../shared/styles';
import { cardStyles, cn } from '../../shared/styles';

/** 时间视图类型（原 shared/sql/trend 导出） */
export type TimeView = 'daily' | 'weekly' | 'monthly';

interface LineChartProps {
  title: string;
  data: {
    time_period: string;
    org_level_3: string;
    premium: number;
    next_month_ratio: number;
  }[];
  loading?: boolean;
  height?: number;
  timeView: TimeView;
  startDate?: string;
  endDate?: string;
  // V2.0: 支持动态Y轴标签
  yAxisLabel?: string;
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
 * 折线图组件 - 显示保费趋势
 * V2.0: 支持动态Y轴标签（保费/商业险件数/交强险件数）
 */
export const LineChart: React.FC<LineChartProps> = ({
  title,
  data,
  loading = false,
  height = 400,
  timeView,
  startDate,
  endDate,
  yAxisLabel = '保费（万元）', // V2.0: 默认为保费标签
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const chart = chartInstance.current;
    if (!chart) return;

    if (loading) {
      chart.showLoading();
      return;
    }

    chart.hideLoading();

    if (data.length === 0) {
      chart.setOption({
        title: { text: title, left: 'center' },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      });
      return;
    }

    // 判断日期跨度是否超过 183 天
    const isLongRange = (() => {
      if (!startDate || !endDate) return false;
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
      return diffDays > 183;
    })();

    // 年份颜色由设计系统统一管理（getYearChartColor）

    // Group data by org and year
    const orgYearData = new Map<string, Map<string, {
      time_periods: string[];
      premiums: number[];
      ratios: number[];
    }>>();

    data.forEach(row => {
      const org = row.org_level_3 ?? '未知机构';
      const timePeriod = row.time_period ?? '';
      const year = timePeriod.includes('-') ? timePeriod.split('-')[0] : '2025';

      if (!orgYearData.has(org)) {
        orgYearData.set(org, new Map());
      }

      const yearMap = orgYearData.get(org)!;
      if (!yearMap.has(year)) {
        yearMap.set(year, { time_periods: [], premiums: [], ratios: [] });
      }

      const orgYearInfo = yearMap.get(year)!;
      orgYearInfo.time_periods.push(timePeriod);
      orgYearInfo.premiums.push(row.premium ?? 0);
      orgYearInfo.ratios.push(row.next_month_ratio ?? 0);
    });

    const allTimePeriods = Array.from(new Set(data.map(d => d.time_period ?? '').filter(Boolean))).sort();

    const premiumSeries: SeriesOption[] = [];
    const ratioSeries: SeriesOption[] = [];

    Array.from(orgYearData.entries()).forEach(([org, yearMap], orgIndex) => {
      Array.from(yearMap.entries()).forEach(([year, orgYearInfo]) => {
        const color = getYearChartColor(year);

        // Build O(1) lookup maps — avoids O(n²) indexOf inside allTimePeriods.map()
        const premiumByPeriod = new Map(
          orgYearInfo.time_periods.map((tp, i) => [tp, orgYearInfo.premiums[i]])
        );
        const ratioByPeriod = new Map(
          orgYearInfo.time_periods.map((tp, i) => [tp, orgYearInfo.ratios[i]])
        );

        premiumSeries.push({
          name: `${org} (${year}年)`,
          type: 'line',
          data: allTimePeriods.map(tp => premiumByPeriod.get(tp) ?? null),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 0,
          itemStyle: { color: color },
          lineStyle: { color: color, width: 2 },
        });

        if (orgIndex < 3) {
          ratioSeries.push({
            name: `${org} (${year}年)（次月起保占比）`,
            type: 'line',
            data: allTimePeriods.map(tp => ratioByPeriod.get(tp) ?? null),
            smooth: true,
            symbol: 'diamond',
            symbolSize: 6,
            yAxisIndex: 1,
            itemStyle: { color: color },
            lineStyle: { color: color, width: 2, type: 'dashed' },
          });
        }
      });
    });

    const option: EChartsOption = {
      title: {
        text: title,
        left: 'center',
        textStyle: {
          fontSize: 16,
          fontWeight: 'bold',
          fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif'
        }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          let result = `<div style="font-weight:bold">${safeParams[0].axisValue}</div>`;
          safeParams.forEach((param) => {
            const seriesName = String(param.seriesName ?? '');
            const isRatio = seriesName.includes('占比');
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            const formattedVal = isRatio ? formatRate(rawValue) : formatPremiumWan(rawValue);
            result += `<div style="display:flex;align-items:center;margin-top:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${param.color};margin-right:5px"></span><span>${param.seriesName}: <strong>${formattedVal}</strong></span></div>`;
          });
          return result;
        },
      },
      legend: { type: 'scroll', bottom: 0, data: [...premiumSeries.map(s => s.name), ...ratioSeries.map(s => s.name)] as any },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, show: false },
      xAxis: {
        type: 'category',
        data: allTimePeriods,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: {
          show: true,
          alignWithLabel: true,
          interval: (index: number, value: string) => {
            if (timeView === 'weekly') {
              if (!isLongRange || index === 0) return true;
              const [y, w] = value.split('-W').map(Number);
              const [pY, pW] = allTimePeriods[index - 1].split('-W').map(Number);
              return getWeekStartDate(y, w).getMonth() !== getWeekStartDate(pY, pW).getMonth();
            }
            if (timeView === 'daily') {
              const d = new Date(value);
              return d.getDate() === 1 || (d.getMonth() === 11 && d.getDate() === 31);
            }
            return true;
          }
        },
        splitLine: { show: false },
        axisLabel: {
          rotate: 0,
          interval: 0,
          fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif',
          formatter: (value: string, index: number) => {
            if (!value) return value;

            if (timeView === 'weekly') {
              const [yearStr, weekStr] = value.split('-W');
              const year = parseInt(yearStr);
              const week = parseInt(weekStr);

              // 长跨度抽稀：只显示每月第一周
              if (isLongRange && index > 0) {
                const currentWeekStart = getWeekStartDate(year, week);
                const prevValue = allTimePeriods[index - 1];
                const [pY, pW] = prevValue.split('-W').map(Number);
                const prevWeekStart = getWeekStartDate(pY, pW);
                if (currentWeekStart.getMonth() === prevWeekStart.getMonth()) {
                  return '';
                }
              }

              // 只有第一个点显示年份
              if (index === 0) return value;
              return `W${weekStr}`;
            }

            if (timeView === 'monthly') {
              const parts = value.split('-');
              return parts.length >= 2 ? `${parseInt(parts[1])}月` : value;
            }

            if (timeView === 'daily') {
              const date = new Date(`${value}T00:00:00`);
              const monthNum = date.getMonth() + 1;
              const dayNum = date.getDate();
              if (dayNum === 1) return `${monthNum}月1日`;
              if (monthNum === 12 && dayNum === 31) return '12月31日';
              return '';
            }

            return value;
          },
        },
      },
      yAxis: [
        {
          type: 'value',
          name: yAxisLabel, // V2.0: 使用动态Y轴标签
          position: 'left',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          // V2.0: 根据Y轴标签选择格式化器
          axisLabel: {
            fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif',
            formatter: yAxisLabel.includes('件数')
              ? (value: number) => formatCount(value)
              : formatPremiumWan
          },
        },
        {
          type: 'value',
          name: '占比',
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif',
            formatter: formatRate
          },
        },
      ],
      series: [...premiumSeries, ...ratioSeries],
      dataZoom: [{ type: 'slider', start: 0, end: 100, height: 20, bottom: 40 }, { type: 'inside' }],
    };

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [data, loading, title, timeView, startDate, endDate, yAxisLabel]); // V2.0: 添加yAxisLabel依赖

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  return (
    <div className={cn(cardStyles.standard)}>
      <div ref={chartRef} style={{ height: `${height}px`, width: '100%' }} />
    </div>
  );
};
