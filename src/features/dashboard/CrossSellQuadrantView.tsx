import React, { memo, useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { cardStyles, textStyles, cn } from '../../shared/styles';
import type { CrossSellRow } from './hooks/useCrossSellAnalysis';

type QuadrantId = 'benchmark' | 'risk' | 'focus' | 'observe';

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

const MAIN_FULL_THRESHOLD = 75;
const JIAOSAN_THRESHOLD = 60;
const HIGH_WEIGHT_PERCENTILE = 0.75;

const QUADRANT_META: Record<QuadrantId, {
  label: string;
  color: string;
  judgment: string;
  suggestion: string;
}> = {
  benchmark: {
    label: '结构正确 · 推介达标（标杆区）',
    color: '#86B88A',
    judgment: '结构与推介表现一致，可作为同维度参照对象。',
    suggestion: '保持策略稳定，优先输出可复制做法。',
  },
  risk: {
    label: '结构偏差 · 推介表象好（风险区）',
    color: '#C6A777',
    judgment: '推介结果表面较好，但结构配比存在偏差。',
    suggestion: '复核结构分布，防止短期表现掩盖长期风险。',
  },
  focus: {
    label: '结构正确 · 推介不足（重点提升区）',
    color: '#E53935',
    judgment: '基础结构具备，但推介执行明显不足。',
    suggestion: '优先投放辅导与过程跟进，作为近期主攻对象。',
  },
  observe: {
    label: '结构偏差 · 推介不足（观察区）',
    color: '#8A95A6',
    judgment: '结构与推介均偏弱，短期投入产出不确定。',
    suggestion: '先控制投入节奏，结合阶段目标持续观察。',
  },
};

function classifyQuadrant(mainFullRate: number, jiaosanRate: number): QuadrantId {
  if (mainFullRate >= MAIN_FULL_THRESHOLD && jiaosanRate >= JIAOSAN_THRESHOLD) {
    return 'benchmark';
  }
  if (mainFullRate < MAIN_FULL_THRESHOLD && jiaosanRate >= JIAOSAN_THRESHOLD) {
    return 'risk';
  }
  if (mainFullRate >= MAIN_FULL_THRESHOLD && jiaosanRate < JIAOSAN_THRESHOLD) {
    return 'focus';
  }
  return 'observe';
}

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
        const point = params.data as QuadrantPoint;
        const meta = QUADRANT_META[point.quadrant];
        return `
          <div style="padding: 6px 8px; line-height: 1.6;">
            <div style="font-weight: 600; margin-bottom: 6px;">${escapeHtml(point.entity_name)}</div>
            <div>主全推介率：${formatPercent(point.main_full_rate)}</div>
            <div>交三推介率：${formatPercent(point.jiaosan_rate)}</div>
            <div>权重指标：${formatCount(point.weight_value)}</div>
            <div style="margin-top: 6px;"><strong>判断：</strong>${meta.judgment}</div>
            <div><strong>建议动作：</strong>${meta.suggestion}</div>
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
      splitLine: { lineStyle: { color: '#E8E8E8' } },
    },
    yAxis: {
      type: 'value',
      name: '交三推介率（达标线 60%）',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#E8E8E8' } },
    },
    series: [
      ...(['benchmark', 'risk', 'focus', 'observe'] as QuadrantId[]).map((quadrant) => {
        const meta = QUADRANT_META[quadrant];
        const seriesPoints = points
          .filter((p) => p.quadrant === quadrant)
          .map((p) => ({
            ...p,
            itemStyle: p.isHighWeight && p.isMisaligned
              ? {
                  borderColor: '#111827',
                  borderWidth: 2,
                  shadowBlur: 14,
                  shadowColor: 'rgba(17, 24, 39, 0.32)',
                }
              : undefined,
          }));
        return {
          name: meta.label,
          type: 'scatter',
          data: seriesPoints,
          symbolSize: (data: QuadrantPoint) =>
            getSymbolSize(data.weight_value, data.isHighWeight, data.isMisaligned),
          itemStyle: {
            color: meta.color,
            opacity: quadrant === 'focus' ? 0.96 : 0.72,
          },
          emphasis: {
            scale: true,
            itemStyle: {
              borderColor: '#1F2937',
              borderWidth: 2,
              shadowBlur: 16,
              shadowColor: 'rgba(31, 41, 55, 0.35)',
              opacity: 1,
            },
          },
          markLine: quadrant === 'benchmark'
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: {
                  color: '#6B7280',
                  type: 'dashed',
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
      isMisaligned: point.quadrant !== 'benchmark',
    }));
  }, [rows]);

  const decisionSummary = useMemo(() => {
    if (points.length === 0) {
      return null;
    }

    const highWeightRows = points.filter((p) => p.isHighWeight);
    const sample = highWeightRows.length > 0 ? highWeightRows : points;

    const quadrantStats = (['benchmark', 'risk', 'focus', 'observe'] as QuadrantId[]).map((quadrant) => {
      const subset = sample.filter((p) => p.quadrant === quadrant);
      return {
        quadrant,
        count: subset.length,
        weightSum: subset.reduce((sum, p) => sum + p.weight_value, 0),
      };
    });

    const dominant = quadrantStats.sort((a, b) => {
      if (b.weightSum !== a.weightSum) return b.weightSum - a.weightSum;
      return b.count - a.count;
    })[0];

    const baseCount = sample.length || 1;
    const ratio = (dominant.count / baseCount) * 100;

    return {
      label: QUADRANT_META[dominant.quadrant].label,
      count: dominant.count,
      ratio,
      totalHighWeight: baseCount,
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
          style: { text: '暂无可用于四象限分析的数据', fill: '#9CA3AF', fontSize: 14 },
        },
      });
      return;
    }

    chart.setOption(buildChartOption(points), true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
      <div className="space-y-1">
        {decisionSummary ? (
          <>
            <p className={cn(textStyles.body, 'text-danger font-semibold')}>
              ⚠️ 交叉销售当前首要问题：
              在当前分析维度下，【{decisionSummary.label}】类型的对象占比最高，
              涉及 {decisionSummary.count} 个对象，占高权重对象 {decisionSummary.ratio.toFixed(1)}%。
            </p>
            <p className={cn(textStyles.caption, 'text-neutral-500')}>
              关系说明：本视图直接复用当前分组表格的完整数据（事实主视图）进行结构判断，不新增接口、不复制数据。
            </p>
          </>
        ) : (
          <p className={cn(textStyles.body, 'text-neutral-500')}>当前分组暂无可用于结构诊断的数据。</p>
        )}
        <p className={cn(textStyles.caption, 'text-neutral-500')}>
          当前分析维度：{currentDimensionLabel}；权重指标：车险件数（用于体现管理影响权重）。
        </p>
      </div>
      <div ref={chartRef} className="h-[460px] w-full" />
    </section>
  );
});

export default CrossSellQuadrantView;
