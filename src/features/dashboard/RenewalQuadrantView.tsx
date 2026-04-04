import { memo, useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { cardStyles, textStyles, cn } from '../../shared/styles';
import type { DrilldownRow } from './hooks/useRenewalDrilldown';

type QuadrantId = 'benchmark' | 'risk' | 'focus' | 'observe';

interface QuadrantPoint {
    entity_name: string;
    quote_rate: number;
    renewal_rate: number;
    weight_value: number;
    quadrant: QuadrantId;
    isHighWeight: boolean;
    isMisaligned: boolean;
}

interface RenewalQuadrantViewProps {
    rows: DrilldownRow[];
    currentDimensionLabel: string;
}

const QUOTE_THRESHOLD = 80;
const RENEWAL_THRESHOLD = 40;
const HIGH_WEIGHT_PERCENTILE = 0.75;

const QUADRANT_META: Record<QuadrantId, {
    label: string;
    color: string;
    judgment: string;
    suggestion: string;
}> = {
    benchmark: {
        label: '过程达标 · 结果优异（标杆区）',
        color: '#86B88A',
        judgment: '报价动作执行到位，且续保转化结果优异，可作为业务标杆。',
        suggestion: '保持当前工作节奏，复盘并输出成功转化经验。',
    },
    risk: {
        label: '过程不足 · 结果表象好（风险区）',
        color: '#C6A777',
        judgment: '虽然续保率达标，但基础报价动作不足，可能依赖个别大客户自然续留。',
        suggestion: '强化日常报价动作管理，提高漏斗基数，降低业绩波动风险。',
    },
    focus: {
        label: '过程达标 · 结果欠佳（重点提升区）',
        color: '#E53935',
        judgment: '报价动作执行充分，但最终转化率未达标，存在“雷声大雨点小”问题。',
        suggestion: '重点干预从报价到出单的转化环节，提供话术辅导和政策支持。',
    },
    observe: {
        label: '过程不足 · 结果欠佳（观察区）',
        color: '#8A95A6',
        judgment: '过程指标和结果指标双双落后，业务推进意愿或能力存在明显短板。',
        suggestion: '需进行专项督导，从基础触达和报价动作开始重新建立工作习惯。',
    },
};

function classifyQuadrant(quoteRate: number, renewalRate: number): QuadrantId {
    if (quoteRate >= QUOTE_THRESHOLD && renewalRate >= RENEWAL_THRESHOLD) {
        return 'benchmark';
    }
    if (quoteRate < QUOTE_THRESHOLD && renewalRate >= RENEWAL_THRESHOLD) {
        return 'risk';
    }
    if (quoteRate >= QUOTE_THRESHOLD && renewalRate < RENEWAL_THRESHOLD) {
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
    // 考虑到个别情况可能大于 100%，此处放宽限制，但为了图表美观，一般最大值自动适应
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
                const d = params.data as { value: number[] } & QuadrantPoint;
                const meta = QUADRANT_META[d.quadrant];
                return `
          <div style="padding: 6px 8px; line-height: 1.6;">
            <div style="font-weight: 600; margin-bottom: 6px;">${escapeHtml(d.entity_name)}</div>
            <div>报价率：${formatPercent(d.quote_rate)}</div>
            <div>续保率：${formatPercent(d.renewal_rate)}</div>
            <div>应续件数：${formatCount(d.weight_value)}件</div>
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
            name: `报价率（达标线 ${QUOTE_THRESHOLD}%）`,
            min: 0,
            max: (value) => Math.max(100, Math.ceil(value.max / 10) * 10), // X轴最大值自适应，但最小为100
            axisLabel: { formatter: '{value}%' },
            splitLine: { show: false },
        },
        yAxis: {
            type: 'value',
            name: `续保率（达标线 ${RENEWAL_THRESHOLD}%）`,
            min: 0,
            max: (value) => Math.max(100, Math.ceil(value.max / 10) * 10), // Y轴最大值自适应
            axisLabel: { formatter: '{value}%' },
            splitLine: { show: false },
        },
        series: [
            ...(['benchmark', 'risk', 'focus', 'observe'] as QuadrantId[]).map((quadrant) => {
                const meta = QUADRANT_META[quadrant];
                const seriesPoints = points
                    .filter((p) => p.quadrant === quadrant)
                    .map((p) => ({
                        value: [p.quote_rate, p.renewal_rate] as [number, number],
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
                    type: 'scatter' as const,
                    data: seriesPoints,
                    symbolSize: (_val: number[], params: any) => {
                        const d = params?.data as QuadrantPoint | undefined;
                        if (!d) return 20;
                        return getSymbolSize(d.weight_value, d.isHighWeight, d.isMisaligned);
                    },
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
                                type: 'dashed' as const,
                                width: 1.5,
                            },
                            data: [
                                { xAxis: QUOTE_THRESHOLD },
                                { yAxis: RENEWAL_THRESHOLD },
                            ],
                        }
                        : undefined,
                };
            }),
        ],
    };
}

export const RenewalQuadrantView = memo(function RenewalQuadrantView({
    rows,
    currentDimensionLabel,
}: RenewalQuadrantViewProps) {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

    const points = useMemo(() => {
        if (rows.length === 0) return [];
        const basePoints = rows.map((row) => {
            const qRate = normalizeRate(Number(row.quote_rate ?? 0) * 100);
            const rRate = normalizeRate(Number(row.renewal_rate ?? 0) * 100);
            return {
                entity_name: String(row.group_name ?? ''),
                quote_rate: qRate,
                renewal_rate: rRate,
                weight_value: Math.max(0, Number(row.due_count ?? 0)),
                quadrant: classifyQuadrant(qRate, rRate),
            };
        });

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
            <div className="space-y-1">
                {decisionSummary ? (
                    <>
                        <p className={cn(textStyles.body, 'text-danger font-semibold')}>
                            ⚠️ 续保转化当前首要问题：
                            在当前分析维度下，【{decisionSummary.label}】类型的对象占比最高，
                            涉及 {decisionSummary.count} 个对象，占高权重对象 {formatPercent(decisionSummary.ratio)}。
                        </p>
                        <p className={cn(textStyles.caption, 'text-neutral-500')}>
                            关系说明：本视图基于当前表格的完整数据进行散点分布诊断，不涉及新数据接口。
                        </p>
                    </>
                ) : (
                    <p className={cn(textStyles.body, 'text-neutral-500')}>当前分组暂无可用于结构诊断的数据。</p>
                )}
                <p className={cn(textStyles.caption, 'text-neutral-500')}>
                    当前分析层级：{currentDimensionLabel}；权重指标：应续件数（用于体现管理影响权重，圆点越大表示业务体量越大）。
                </p>
            </div>
            <div ref={chartRef} className="h-[460px] w-full" />
        </section>
    );
});

export default RenewalQuadrantView;
