/**
 * 费用分布横向柱状图（ECharts）
 * X轴：保费(万)，Y轴：费率档位，按保费降序
 */

import React, { useRef, useEffect } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { FeeRuleTierData, FeeInsuranceTypeTab } from '../types/feeAnalysisTypes';
import { formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
import { useTheme } from '@/shared/theme';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  data: FeeRuleTierData[];
  activeTab: FeeInsuranceTypeTab;
}

export const FeeDistributionChart: React.FC<Props> = ({ data, activeTab }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const filtered = data
    .filter((r) => {
      if (r.fee_rule_id === 'OUT_OF_SCOPE') return false;
      if (activeTab === 'cti') return r.insurance_type_label === '交强险';
      if (activeTab === 'com') return r.insurance_type_label === '商业险';
      return true;
    })
    .sort((a, b) => b.total_premium - a.total_premium)
    .slice(0, 15); // 最多展示15档

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }
    const chart = chartRef.current;

    if (filtered.length === 0) {
      chart.clear();
      return;
    }

    const yLabels = filtered.map((r) =>
      r.fee_rate !== null ? `${formatPercent(r.fee_rate)} ${(r.fee_rule_name ?? '').split('-').slice(-1)[0]}` : r.fee_rule_name
    );
    const premiumValues = filtered.map((r) => parseFloat(formatPremiumWan(r.total_premium)));
    const feeValues = filtered.map((r) =>
      r.expected_fee !== null ? parseFloat(formatPremiumWan(r.expected_fee)) : 0
    );

    const option: echarts.EChartsCoreOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const row = filtered[params[0].dataIndex];
          return [
            `<b>${row.fee_rule_name}</b>`,
            `费率：${row.fee_rate !== null ? formatPercent(row.fee_rate) : 'N/A'}`,
            `件数：${row.policy_count.toLocaleString()}`,
            `保费：${formatPremiumWan(row.total_premium)}万`,
            `预计费用：${row.expected_fee !== null ? formatPremiumWan(row.expected_fee) + '万' : '—'}`,
          ].join('<br/>');
        },
      },
      grid: { left: '2%', right: '4%', top: '2%', bottom: '2%', containLabel: true },
      xAxis: {
        type: 'value',
        name: '万元',
        nameTextStyle: { color: isDark ? '#a3a3a3' : '#9ca3af', fontSize: 11 },
        axisLabel: { color: isDark ? '#a3a3a3' : '#9ca3af', fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        axisLabel: { color: isDark ? '#d1d5db' : '#374151', fontSize: 11, width: 160, overflow: 'truncate' },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          name: '保费(万)',
          type: 'bar',
          data: premiumValues,
          barMaxWidth: 20,
          itemStyle: { color: '#3b82f6', borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: 'right',
            formatter: (p: any) => `${p.value}万`,
            fontSize: 11,
            color: isDark ? '#d1d5db' : '#374151',
          },
        },
        {
          name: '预计费用(万)',
          type: 'bar',
          data: feeValues,
          barMaxWidth: 20,
          itemStyle: { color: '#10b981', borderRadius: [0, 3, 3, 0] },
        },
      ],
    };

    chart.setOption(option, { notMerge: true });
  }, [filtered, isDark]);

  useEffect(() => {
    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ height: '400px', width: '100%' }} />;
};
