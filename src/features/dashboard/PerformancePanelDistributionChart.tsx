// 从 PerformanceAnalysisPanel.tsx 抽出的内部分布图（b331 拆分·行为零变更）。
// 业绩分析分布图唯一实现（漂移双胞胎 performance/PerformanceDistributionChart.tsx 已随 21c578 去重删除）。
import { useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '@/shared/utils/echarts';
import { useTheme } from '@/shared/theme';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, colors, textStyles } from '@/shared/styles';
import type { PerformanceRow } from './hooks/usePerformanceDrilldown';
import {
  classifyPerformanceQuadrant,
  getQuadrantLabel,
  PERFORMANCE_ACHIEVEMENT_THRESHOLD,
  PERFORMANCE_GROWTH_THRESHOLD,
  PERFORMANCE_QUADRANT_META,
} from './performanceStatus';
import { safeNumber } from './performancePanel.shared';

export function DistributionChart({
  rows,
  loading,
  error,
}: {
  rows: PerformanceRow[];
  loading: boolean;
  error: string | null;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const { resolvedTheme } = useTheme();

  const points = useMemo(() => {
    const filtered = rows.filter((row) => row.achievement_rate !== null && row.growth_rate !== null);
    const maxCount = Math.max(...filtered.map((item) => safeNumber(item.auto_count)), 1);

    return filtered.map((row) => {
      const achievement = safeNumber(row.achievement_rate);
      const growth = safeNumber(row.growth_rate);
      const autoCount = Math.max(0, safeNumber(row.auto_count));
      const quadrant = classifyPerformanceQuadrant(achievement, growth);
      const symbolSize = 12 + (autoCount / maxCount) * 18;
      const color = quadrant === 'unknown'
        ? colors.neutral[400]
        : PERFORMANCE_QUADRANT_META[quadrant].color;

      return {
        name: row.display_name ?? row.group_name, // 散点/tooltip 显示短名+冲突后缀；group_name 带工号仅作 key
        value: [achievement, growth, autoCount],
        quadrant,
        itemStyle: {
          color,
          opacity: 0.86,
        },
        symbolSize,
      };
    });
  }, [rows]);

  const axisRange = useMemo(() => {
    if (points.length === 0) {
      return { xMin: 80, xMax: 120, yMin: -5, yMax: 20 };
    }
    const xs = points.map((p) => Number(p.value[0] || 0));
    const ys = points.map((p) => Number(p.value[1] || 0));
    return {
      xMin: Math.min(80, Math.floor(Math.min(...xs) - 5)),
      xMax: Math.max(120, Math.ceil(Math.max(...xs) + 5)),
      yMin: Math.min(-5, Math.floor(Math.min(...ys) - 2)),
      yMax: Math.max(20, Math.ceil(Math.max(...ys) + 2)),
    };
  }, [points]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;
    if (loading) return;

    if (error) {
      chart.clear();
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: `加载失败: ${error}`,
            fill: colors.danger.DEFAULT,
            fontSize: 13,
          },
        },
      });
      return;
    }

    if (points.length === 0) {
      chart.clear();
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: '暂无达成率/增长率分布数据',
            fill: colors.neutral[400],
            fontSize: 13,
          },
        },
      });
      return;
    }

    const bucket = {
      high_growth_high_achievement: points.filter((item) => item.quadrant === 'high_growth_high_achievement'),
      high_growth_low_achievement: points.filter((item) => item.quadrant === 'high_growth_low_achievement'),
      low_growth_high_achievement: points.filter((item) => item.quadrant === 'low_growth_high_achievement'),
      low_growth_low_achievement: points.filter((item) => item.quadrant === 'low_growth_low_achievement'),
    };

    const scatterSymbolSize = (_value: unknown, params: any) => {
      const data = params?.data;
      if (typeof data?.symbolSize === 'number') return data.symbolSize;
      return 16;
    };

    const isDark = resolvedTheme === 'dark';
    const textColor = isDark ? '#f0f0f0' : '#333';
    const subTextColor = isDark ? '#a3a3a3' : '#666';

    const option: EChartsOption = {
      textStyle: { color: textColor },
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const value = params?.value || [0, 0, 0];
          const achievement = Number(value[0] || 0);
          const growth = Number(value[1] || 0);
          const count = Number(value[2] || 0);
          const quadrant = params?.data?.quadrant;
          const quadrantLabel = typeof quadrant === 'string' ? getQuadrantLabel(quadrant as any) : '-';
          return [
            `<div style="font-size:12px;line-height:1.6;">`,
            `<div style="font-weight:600;">${params?.name || ''}</div>`,
            `<div>达成率：${formatPercent(achievement)}</div>`,
            `<div>增长率：${formatPercent(growth)}</div>`,
            `<div>车险件数：${formatCount(count)}</div>`,
            `<div>象限：${quadrantLabel}</div>`,
            `</div>`,
          ].join('');
        },
      },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { color: subTextColor },
        data: ['高增长高达成（优秀）', '高增长低达成（异常）', '低增长高达成（预警）', '低增长低达成（危险）'],
      },
      grid: {
        left: '7%',
        right: '6%',
        top: 54,
        bottom: 46,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: '达成率',
        nameTextStyle: { color: subTextColor },
        min: axisRange.xMin,
        max: axisRange.xMax,
        axisLabel: { formatter: '{value}%', color: subTextColor },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: '增长率',
        nameTextStyle: { color: subTextColor },
        min: axisRange.yMin,
        max: axisRange.yMax,
        axisLabel: { formatter: '{value}%', color: subTextColor },
        splitLine: { show: false },
      },
      series: [
        {
          name: '背景',
          type: 'scatter',
          data: [],
          symbolSize: scatterSymbolSize,
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.08 },
            data: [
              [
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: PERFORMANCE_GROWTH_THRESHOLD, itemStyle: { color: colors.success.DEFAULT } },
                { xAxis: axisRange.xMax, yAxis: axisRange.yMax },
              ],
              [
                { xAxis: axisRange.xMin, yAxis: PERFORMANCE_GROWTH_THRESHOLD, itemStyle: { color: colors.warning.DEFAULT } },
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: axisRange.yMax },
              ],
              [
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: axisRange.yMin, itemStyle: { color: '#fa8c16' } },
                { xAxis: axisRange.xMax, yAxis: PERFORMANCE_GROWTH_THRESHOLD },
              ],
              [
                { xAxis: axisRange.xMin, yAxis: axisRange.yMin, itemStyle: { color: colors.danger.DEFAULT } },
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: PERFORMANCE_GROWTH_THRESHOLD },
              ],
            ],
          },
        },
        {
          name: '高增长高达成（优秀）',
          type: 'scatter',
          data: bucket.high_growth_high_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '高增长低达成（异常）',
          type: 'scatter',
          data: bucket.high_growth_low_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '低增长高达成（预警）',
          type: 'scatter',
          data: bucket.low_growth_high_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '低增长低达成（危险）',
          type: 'scatter',
          data: bucket.low_growth_low_achievement,
          symbolSize: scatterSymbolSize,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed',
              color: colors.neutral[500],
              width: 1,
            },
            data: [
              { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD },
              { yAxis: PERFORMANCE_GROWTH_THRESHOLD },
            ],
          },
        },
      ],
    };

    chart.setOption(option, true);
  }, [axisRange, error, loading, points, resolvedTheme]);

  // ResizeObserver 仅需挂载时注册一次。此前与 setOption 同处一个 effect，
  // 导致每次数据/主题变化都 disconnect + 重建 observer（无谓 DOM 操作）。
  // resize 回调按调用时读取实例 ref，与图表 init 的时序无关。
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const resizeObserver = new ResizeObserver(() => {
      chartInstanceRef.current?.resize();
    });
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <h3 className={textStyles.titleSmall}>达成率+增长率分布图</h3>
      <div className={cn(textStyles.caption, colorClasses.text.neutralLight)}>
        分界线：达成率 {PERFORMANCE_ACHIEVEMENT_THRESHOLD}% / 增长率 {PERFORMANCE_GROWTH_THRESHOLD}%。
      </div>
      <div ref={chartRef} className="h-[360px] w-full" />
    </section>
  );
}
