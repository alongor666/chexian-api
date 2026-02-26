/**
 * TOP20 业务员推介率四象限图
 * Top Salesman Quadrant Chart
 */

import { memo, useEffect, useRef, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { colors } from '@/shared/styles';
import { classifyQuadrant, QUADRANT_META } from './crossSellRateStatus';
import type { TopSalesmanRow } from './hooks/useCrossSellTopSalesman';

interface TopSalesmanQuadrantChartProps {
    data: TopSalesmanRow[];
    coverage: '主全' | '交三';
}

export const TopSalesmanQuadrantChart = memo(function TopSalesmanQuadrantChart({
    data,
    coverage,
}: TopSalesmanQuadrantChartProps) {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

    // 计算四象限分界线（均值）
    const { avgRate, avgPremiumPrice } = useMemo(() => {
        if (data.length === 0) return { avgRate: 0, avgPremiumPrice: 0 };
        let totalRate = 0;
        let totalAvgPremium = 0;
        data.forEach(d => {
            totalRate += Number(d.rate) || 0;
            totalAvgPremium += Number(d.avg_premium) || 0;
        });
        return {
            avgRate: totalRate / data.length,
            avgPremiumPrice: totalAvgPremium / data.length,
        };
    }, [data]);

    useEffect(() => {
        if (!chartRef.current) return;
        if (!chartInstanceRef.current) {
            chartInstanceRef.current = echarts.init(chartRef.current);
        }
        const chart = chartInstanceRef.current;

        if (data.length === 0) {
            chart.clear();
            return;
        }

        // 将数据映射为气泡图系列
        // [x:推介率, y:件均保费, size:驾乘险保费, 业务员, 三级机构]
        const scatterData = data.map(item => {
            const rate = Number(item.rate) || 0;
            const premium = Number(item.avg_premium) || 0;
            const sizeval = Math.sqrt(Number(item.driver_premium) || 0);

            // 主全或交三根据当前面板分别传两个参数去获取红橙黄绿的划分
            const q = classifyQuadrant(
                coverage === '主全' ? rate : 100,
                coverage === '交三' ? rate : 100
            );

            return {
                value: [rate, premium, sizeval, item.salesman_name, item.org_level_3, Number(item.driver_premium)],
                itemStyle: {
                    color: QUADRANT_META[q].color,
                }
            };
        });

        const option: EChartsOption = {
            grid: {
                left: '5%',
                right: '5%',
                top: '6%',
                bottom: '8%',
                containLabel: true,
            },
            tooltip: {
                trigger: 'item',
                formatter: (params: any) => {
                    const val = params.value;
                    return `
            <div style="font-weight:600;margin-bottom:4px">${val[3]} (${val[4]})</div>
            <div>推介率: <span style="font-weight:600">${formatPercent(val[0])}</span></div>
            <div>件均保费: <span style="font-weight:600">${formatCount(val[1])}</span></div>
            <div>驾乘保费: <span style="font-weight:600">${(val[5] / 10000).toFixed(1)} 万</span></div>
          `;
                },
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                borderColor: colors.neutral[200],
                borderWidth: 1,
                textStyle: { color: colors.neutral[800] },
            },
            xAxis: {
                type: 'value',
                name: '推介率',
                nameLocation: 'middle',
                nameGap: 25,
                axisLabel: {
                    formatter: '{value}%',
                    color: colors.neutral[500],
                },
                splitLine: {
                    lineStyle: { type: 'dashed', color: colors.neutral[100] },
                },
                axisLine: { show: true, lineStyle: { color: colors.neutral[200] } },
            },
            yAxis: {
                type: 'value',
                name: '件均保费',
                nameLocation: 'middle',
                nameGap: 40,
                axisLabel: {
                    formatter: '{value}',
                    color: colors.neutral[500],
                },
                splitLine: {
                    lineStyle: { type: 'dashed', color: colors.neutral[100] },
                },
                axisLine: { show: true, lineStyle: { color: colors.neutral[200] } },
            },
            series: [
                {
                    type: 'scatter',
                    data: scatterData,
                    symbolSize: (val: any) => {
                        // 归一化气泡大小，避免过大或过小
                        const size = val[2];
                        // 这里假定 size 是经过开方后的数值，做简单的等比例放大，具体系数可调
                        return Math.max(8, Math.min(60, size / 5));
                    },
                    markLine: {
                        silent: true,
                        lineStyle: {
                            type: 'solid',
                            color: colors.neutral[300],
                            width: 1,
                        },
                        data: [
                            { xAxis: avgRate },
                            { yAxis: avgPremiumPrice }
                        ],
                        label: {
                            formatter: '', // 取消标记线文字
                        }
                    }
                },
            ],
        };

        chart.setOption(option, true);

        const handleResize = () => chart.resize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [data, avgRate, avgPremiumPrice, coverage]);

    useEffect(() => {
        return () => {
            chartInstanceRef.current?.dispose();
            chartInstanceRef.current = null;
        };
    }, []);

    return <div ref={chartRef} className="w-full h-full" />;
});
