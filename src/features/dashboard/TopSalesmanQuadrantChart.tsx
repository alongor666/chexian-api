/**
 * TOP20 业务员推介率分布图（四象限）
 * Top Salesman Quadrant Chart
 */

import { memo, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChartContainer, buildEmptyChartOption } from '../../widgets/charts/EChartContainer';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { colors } from '@/shared/styles';
import { useTheme } from '@/shared/theme';
import type { TopSalesmanRow } from './hooks/useCrossSellTopSalesman';
import type { QuadrantCategory } from './CrossSellAIAnalysisPanel';
import type { EChartsParam } from '@/shared/types/echarts';

interface QuadrantStats {
    category: QuadrantCategory;
    count: number;
    names: string[];
}

interface TopSalesmanQuadrantChartProps {
    data: TopSalesmanRow[];
    coverage: '主全' | '交三';
    rateThreshold: number;
    avgPremiumThreshold: number;
}

export const TopSalesmanQuadrantChart = memo(function TopSalesmanQuadrantChart({
    data,
    rateThreshold,
    avgPremiumThreshold,
}: TopSalesmanQuadrantChartProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    // 基于固定阈值统计四象限
    const { quadrantStats } = useMemo(() => {
        if (data.length === 0) return { quadrantStats: [] };

        // 计算各象限统计
        const stats: Record<QuadrantCategory, { count: number; names: string[] }> = {
            dual_excellent: { count: 0, names: [] },
            rate_excellent_avg_weak: { count: 0, names: [] },
            rate_weak_avg_excellent: { count: 0, names: [] },
            dual_weak: { count: 0, names: [] },
        };

        data.forEach(item => {
            const rateGood = item.rate >= rateThreshold;
            const avgGood = item.avg_premium >= avgPremiumThreshold;

            let category: QuadrantCategory;
            if (rateGood && avgGood) {
                category = 'dual_excellent';
            } else if (rateGood && !avgGood) {
                category = 'rate_excellent_avg_weak';
            } else if (!rateGood && avgGood) {
                category = 'rate_weak_avg_excellent';
            } else {
                category = 'dual_weak';
            }

            stats[category].count++;
            stats[category].names.push(item.salesman_name);
        });

        const quadrantStats: QuadrantStats[] = [
            { category: 'dual_excellent', ...stats.dual_excellent },
            { category: 'rate_excellent_avg_weak', ...stats.rate_excellent_avg_weak },
            { category: 'rate_weak_avg_excellent', ...stats.rate_weak_avg_excellent },
            { category: 'dual_weak', ...stats.dual_weak },
        ];

        return { quadrantStats };
    }, [data, rateThreshold, avgPremiumThreshold]);

    const option = useMemo<EChartsOption>(() => {
        if (data.length === 0) {
            return buildEmptyChartOption('') as EChartsOption;
        }

        // 计算数据范围
        const rates = data.map(d => d.rate);
        const premiums = data.map(d => d.avg_premium);
        const minRate = Math.floor(Math.min(...rates, rateThreshold) * 0.9);
        const maxRate = Math.ceil(Math.max(...rates, rateThreshold) * 1.1);
        const minPremium = Math.floor(Math.min(...premiums, avgPremiumThreshold) * 0.9);
        const maxPremium = Math.ceil(Math.max(...premiums, avgPremiumThreshold) * 1.1);

        // 将数据映射为气泡图系列
        const scatterData = data.map(item => {
            const rate = Number(item.rate) || 0;
            const premium = Number(item.avg_premium) || 0;
            const sizeval = Math.sqrt(Number(item.driver_premium) || 0);

            // 根据推介率获取颜色
            const rateGood = rate >= rateThreshold;
            const avgGood = premium >= avgPremiumThreshold;

            let color: string;
            if (rateGood && avgGood) {
                color = colors.success.DEFAULT;
            } else if (rateGood && !avgGood) {
                color = colors.warning.DEFAULT;
            } else if (!rateGood && avgGood) {
                color = colors.warning.dark;
            } else {
                color = colors.danger.DEFAULT;
            }

            return {
                value: [rate, premium, sizeval, item.salesman_name, item.org_level_3, Number(item.driver_premium)],
                itemStyle: { color },
            };
        });

        return {
            grid: {
                left: '12%',
                right: '12%',
                top: '15%',
                bottom: '12%',
                containLabel: true,
            },
            tooltip: {
                trigger: 'item',
                formatter: (params: any) => {
                    const val = (params as EChartsParam).value as [number, number, number, string, string, number];
                    return `
            <div style="font-weight:600;margin-bottom:4px">${val[3]} (${val[4]})</div>
            <div>推介率: <span style="font-weight:600">${formatPercent(val[0])}</span></div>
            <div>驾意件均: <span style="font-weight:600">${formatCount(val[1])}</span></div>
            <div>驾意保费: <span style="font-weight:600">${formatDriverPremiumWan(val[5])} 万</span></div>
          `;
                },
                backgroundColor: isDark ? 'rgba(22, 22, 24, 0.96)' : 'rgba(255, 255, 255, 0.95)',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : colors.neutral[200],
                borderWidth: 1,
                textStyle: { color: isDark ? '#f0f0f0' : colors.neutral[800] },
            },
            xAxis: {
                type: 'value',
                splitLine: { show: false },
                name: '推介率',
                nameLocation: 'middle',
                nameGap: 30,
                nameTextStyle: { color: isDark ? '#a3a3a3' : colors.neutral[500] },
                min: minRate,
                max: maxRate,
                axisLabel: {
                    formatter: '{value}%',
                    color: isDark ? '#a3a3a3' : colors.neutral[500],
                },
                axisLine: { show: true, lineStyle: { color: isDark ? 'rgba(255,255,255,0.08)' : colors.neutral[200] } },
            },
            yAxis: {
                type: 'value',
                splitLine: { show: false },
                name: '驾意件均',
                nameLocation: 'middle',
                nameGap: 50,
                nameTextStyle: { color: isDark ? '#a3a3a3' : colors.neutral[500] },
                min: minPremium,
                max: maxPremium,
                axisLabel: {
                    formatter: '{value}',
                    color: isDark ? '#a3a3a3' : colors.neutral[500],
                },
                axisLine: { show: true, lineStyle: { color: isDark ? 'rgba(255,255,255,0.08)' : colors.neutral[200] } },
            },
            series: [
                {
                    type: 'scatter',
                    data: scatterData,
                    symbolSize: (val: any) => {
                        const size = val[2];
                        return Math.max(8, Math.min(50, size / 5));
                    },
                    markLine: {
                        silent: true,
                        lineStyle: {
                            type: 'dashed',
                            color: isDark ? 'rgba(255,255,255,0.2)' : colors.neutral[400],
                            width: 1,
                        },
                        data: [
                            {
                                xAxis: rateThreshold,
                                label: {
                                    formatter: `推介率阈值${formatPercent(rateThreshold)}`,
                                    position: 'end',
                                }
                            },
                            {
                                yAxis: avgPremiumThreshold,
                                label: {
                                    formatter: `件均阈值${formatCount(avgPremiumThreshold)}`,
                                    position: 'end',
                                }
                            }
                        ],
                    },
                    // 添加象限标签
                    markPoint: {
                        silent: true,
                        symbol: 'pin',
                        symbolSize: 0,
                        label: {
                            show: true,
                            position: 'inside',
                            formatter: (params: any) => {
                                return (params as EChartsParam).name as string;
                            },
                            color: isDark ? '#a3a3a3' : '#666',
                            fontSize: 10,
                        },
                        data: [
                            {
                                name: `★ 双优\n${quadrantStats.find(s => s.category === 'dual_excellent')?.count || 0}人`,
                                coord: [maxRate * 0.85, maxPremium * 0.9],
                            },
                            {
                                name: `◆ 推介差件均优\n${quadrantStats.find(s => s.category === 'rate_weak_avg_excellent')?.count || 0}人`,
                                coord: [minRate * 1.15, maxPremium * 0.9],
                            },
                            {
                                name: `◆ 推介优件均差\n${quadrantStats.find(s => s.category === 'rate_excellent_avg_weak')?.count || 0}人`,
                                coord: [maxRate * 0.85, minPremium * 1.1],
                            },
                            {
                                name: `○ 双差\n${quadrantStats.find(s => s.category === 'dual_weak')?.count || 0}人`,
                                coord: [minRate * 1.15, minPremium * 1.1],
                            },
                        ],
                    },
                },
            ],
        };
    }, [data, quadrantStats, rateThreshold, avgPremiumThreshold, isDark]);

    return <EChartContainer option={option} height="100%" className="w-full h-full" />;
});
