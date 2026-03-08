import { memo, useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { cardStyles, textStyles, colors, cn } from '../../shared/styles';
import {
  classifyQuadrant,
  JIAOSAN_THRESHOLD,
  MAIN_FULL_THRESHOLD,
  QUADRANT_META,
  type QuadrantId,
} from './crossSellRateStatus';
import type { CrossSellRow } from './hooks/useCrossSellAnalysis';

interface QuadrantPoint {
  entity_name: string;
  main_full_rate: number;
  jiaosan_rate: number;
  weight_value: number;
  quadrant: QuadrantId;
  isHighWeight: boolean;
  isMisaligned: boolean;
}

interface CrossSellQuadrantViewProps {
  rows: CrossSellRow[];
  currentDimensionLabel: string;
}

const HIGH_WEIGHT_PERCENTILE = 0.75;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function buildChartOption(points: QuadrantPoint[]): EChartsOption {
  const maxWeight = Math.max(...points.map((p) => p.weight_value), 1);
  const minWeight = Math.min(...points.map((p) => p.weight_value), 0);

  const getSymbolSize = (weightValue: number, isHighWeight: boolean, isMisaligned: boolean): number => {
    if (maxWeight === minWeight) {
      return isHighWeight && isMisaligned ? 34 : 24;
    }
    const base = 14 + ((weightValue - minWeight) / (maxWeight - minWeight)) * 24;
    return isHighWeight && isMisaligned ? base + 10 : base;
  };

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        // params.data is the full data item: { value: [x, y], ...QuadrantPoint }
        const d = params.data as { value: number[] } & QuadrantPoint;
        const meta = QUADRANT_META[d.quadrant];
        return `
          <div style="padding: 6px 8px; line-height: 1.6;">
            <div style="font-weight: 600; margin-bottom: 6px;">${escapeHtml(d.entity_name)}</div>
            <div>主全推介率：${formatPercent(d.main_full_rate)}</div>
            <div>交三推介率：${formatPercent(d.jiaosan_rate)}</div>
            <div>车险件数：${formatCount(d.weight_value)}</div>
            <div style="margin-top: 6px;">${meta.label}</div>
          </div>
        `;
      },
    },
    legend: {
      top: 0,
      type: 'scroll',
      data: Object.values(QUADRANT_META).map((m) => m.label),
    },
    grid: {
      left: '7%',
      right: '7%',
      top: 64,
      bottom: 50,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: '主全推介率（达标线 75%）',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.neutral[200] } },
    },
    yAxis: {
      type: 'value',
      name: '交三推介率（达标线 60%）',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.neutral[200] } },
    },
    series: [
      ...([
        'dual_excellent',
        'main_weak_jiaosan_excellent',
        'main_excellent_jiaosan_weak',
        'dual_weak',
      ] as QuadrantId[]).map((quadrant) => {
        const meta = QUADRANT_META[quadrant];
        // Use { value: [x, y], ...extra } format so ECharts reads coordinates from value[]
        // while tooltip/symbolSize callbacks can access the full QuadrantPoint via params.data
        const seriesPoints = points
          .filter((p) => p.quadrant === quadrant)
          .map((p) => ({
            value: [p.main_full_rate, p.jiaosan_rate] as [number, number],
            ...p,
            itemStyle: p.isHighWeight && p.isMisaligned
              ? {
                borderColor: colors.neutral[900],
                borderWidth: 2,
                shadowBlur: 14,
                shadowColor: 'rgba(17, 24, 39, 0.32)',
              }
              : undefined,
          }));
        return {
          name: meta.label,
          type: 'scatter' as const,
          data: seriesPoints,
          symbolSize: (_val: number[], params: any) => {
            const d = params?.data as QuadrantPoint | undefined;
            if (!d) return 20;
            return getSymbolSize(d.weight_value, d.isHighWeight, d.isMisaligned);
          },
          itemStyle: {
            color: meta.color,
            opacity: quadrant === 'dual_weak' ? 0.96 : 0.75,
          },
          emphasis: {
            scale: true,
            itemStyle: {
              borderColor: colors.neutral[900],
              borderWidth: 2,
              shadowBlur: 16,
              shadowColor: 'rgba(31, 41, 55, 0.35)',
              opacity: 1,
            },
          },
          markLine: quadrant === 'dual_excellent'
            ? {
              silent: true,
              symbol: 'none',
              lineStyle: {
                color: colors.neutral[500],
                type: 'dashed' as const,
                width: 1.5,
              },
              data: [
                { xAxis: MAIN_FULL_THRESHOLD },
                { yAxis: JIAOSAN_THRESHOLD },
              ],
            }
            : undefined,
        };
      }),
    ],
  };
}

export const CrossSellQuadrantView = memo(function CrossSellQuadrantView({
  rows,
  currentDimensionLabel,
}: CrossSellQuadrantViewProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  const points = useMemo(() => {
    if (rows.length === 0) return [];
    const basePoints = rows.map((row) => ({
      entity_name: String(row.group_name ?? ''),
      main_full_rate: normalizeRate(Number(row.zhuquan_rate ?? 0)),
      jiaosan_rate: normalizeRate(Number(row.jiaosan_rate ?? 0)),
      weight_value: Math.max(0, Number(row.total_auto_count ?? 0)),
      quadrant: classifyQuadrant(
        normalizeRate(Number(row.zhuquan_rate ?? 0)),
        normalizeRate(Number(row.jiaosan_rate ?? 0))
      ),
    }));

    const threshold = quantile(basePoints.map((p) => p.weight_value), HIGH_WEIGHT_PERCENTILE);

    return basePoints.map((point) => ({
      ...point,
      isHighWeight: point.weight_value >= threshold,
      isMisaligned: point.quadrant !== 'dual_excellent',
    }));
  }, [rows]);

  const decisionSummary = useMemo(() => {
    if (points.length === 0) {
      return null;
    }

    const totalCount = points.length;
    const toMetric = (subset: QuadrantPoint[]) => ({
      count: subset.length,
      ratio: (subset.length / totalCount) * 100,
      autoCount: subset.reduce((sum, p) => sum + p.weight_value, 0),
      names: subset
        .slice()
        .sort((a, b) => b.weight_value - a.weight_value)
        .map((p) => p.entity_name)
        .filter(Boolean)
        .join('、'),
    });

    const dualWeak = toMetric(points.filter((p) => p.quadrant === 'dual_weak'));
    const mainWeak = toMetric(points.filter((p) => p.main_full_rate < MAIN_FULL_THRESHOLD));
    const jiaosanWeak = toMetric(points.filter((p) => p.jiaosan_rate < JIAOSAN_THRESHOLD));

    return {
      dualWeak,
      mainWeak,
      jiaosanWeak,
    };
  }, [points]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;

    if (points.length === 0) {
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无可用于四象限分析的数据', fill: colors.neutral[400], fontSize: 14 },
        },
      });
      return;
    }

    chart.setOption(buildChartOption(points), true);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [points]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <h3 className={cn(textStyles.titleSmall, 'font-semibold')}>
        主全 × 交三驾意险推介率分布图
      </h3>
      <div className="space-y-1">
        {decisionSummary ? (
          <>
            <p className={cn(textStyles.body, 'text-danger font-semibold')}>
              双差（主全&lt;75%，交三&lt;60%）：{decisionSummary.dualWeak.names || '无'}
              {decisionSummary.dualWeak.count > 0 ? `（${decisionSummary.dualWeak.count}个，${formatPercent(decisionSummary.dualWeak.ratio)}，车险件数 ${formatCount(decisionSummary.dualWeak.autoCount)}）` : ''}
            </p>
            <p className={cn(textStyles.body, 'text-danger font-semibold')}>
              主全差（主全&lt;75%）：{decisionSummary.mainWeak.names || '无'}
              {decisionSummary.mainWeak.count > 0 ? `（${decisionSummary.mainWeak.count}个，${formatPercent(decisionSummary.mainWeak.ratio)}，车险件数 ${formatCount(decisionSummary.mainWeak.autoCount)}）` : ''}
            </p>
            <p className={cn(textStyles.body, 'text-danger font-semibold')}>
              交三差（交三&lt;60%）：{decisionSummary.jiaosanWeak.names || '无'}
              {decisionSummary.jiaosanWeak.count > 0 ? `（${decisionSummary.jiaosanWeak.count}个，${formatPercent(decisionSummary.jiaosanWeak.ratio)}，车险件数 ${formatCount(decisionSummary.jiaosanWeak.autoCount)}）` : ''}
            </p>
          </>
        ) : (
          <p className={cn(textStyles.body, 'text-neutral-500')}>当前分组暂无可用于结构诊断的数据。</p>
        )}
        <p className={cn(textStyles.caption, 'text-neutral-500')}>
          当前分析维度：{currentDimensionLabel}；车险件数。
        </p>
      </div>
      <div ref={chartRef} className="h-[460px] w-full" />
    </section>
  );
});

export default CrossSellQuadrantView;
