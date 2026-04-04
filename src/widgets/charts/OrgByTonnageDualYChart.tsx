import React, { useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { AXIS_SPLIT_LINE, GRID_CONFIG, getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';
import { colorClasses } from '../../shared/styles';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';

interface OrgByTonnageData {
  tonnage_segment: string;
  org_level_3: string;
  premium: number;
  premium_ratio: number;
}

interface OrgByTonnageDualYChartProps {
  data: OrgByTonnageData[];
  loading?: boolean;
  title?: string;
}

/**
 * 三级机构分析图（可切换机构）
 *
 * 功能：
 * - 通过下拉选择器选择某一个三级机构
 * - X轴：该机构下的所有吨位分段
 * - 左Y轴：每个吨位分段的保费（柱状图）
 * - 右Y轴：每个吨位分段在该机构中的占比（折线图）
 *
 * @example
 * ```tsx
 * <OrgByTonnageDualYChart
 *   data={[
 *     {tonnage_segment: '1吨以下', org_level_3: '机构A', premium: 100000, premium_ratio: 0.25},
 *     ...
 *   ]}
 *   loading={false}
 * />
 * ```
 */
export const OrgByTonnageDualYChart: React.FC<OrgByTonnageDualYChartProps> = ({
  data,
  loading = false,
  title = '三级机构分析',
}) => {
  // 提取所有机构列表
  const orgList = useMemo(() => {
    const orgs = new Set<string>();
    data.forEach(row => orgs.add(row.org_level_3));
    return Array.from(orgs).sort();
  }, [data]);

  // 默认选择第一个机构
  const [selectedOrg, setSelectedOrg] = useState<string>(orgList[0] || '');

  // 根据选中的机构筛选数据
  const filteredData = useMemo(() => {
    return data.filter(row => row.org_level_3 === selectedOrg);
  }, [data, selectedOrg]);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const theme = getChartTheme(isDark);
    if (!filteredData || filteredData.length === 0) {
      return {
        title: { text: title, left: 'center' },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      };
    }

    // 按保费降序排序
    const sortedData = [...filteredData].sort((a, b) => b.premium - a.premium);

    // X轴：吨位分段
    const xAxisData = sortedData.map(row => row.tonnage_segment);
    // 柱状图数据：保费
    const barData = sortedData.map(row => row.premium);
    // 折线图数据：占比
    const lineData = sortedData.map(row => row.premium_ratio);

    const chartOption: EChartsOption = {
      title: {
        text: `${title} - ${selectedOrg}`,
        left: 'center',
        textStyle: theme.chartTextStyles.title,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const tonnage = safeParams[0].name;
          let result = `<div style="font-weight:bold">${tonnage}</div>`;

          safeParams.forEach((param) => {
            const seriesName = String(param.seriesName ?? '');
            const isRatio = seriesName.includes('占比');
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            const formattedVal = isRatio ? formatRate(rawValue) : formatPremiumWan(rawValue);
            result += `<div style="display:flex;align-items:center;margin-top:4px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${param.color};margin-right:5px"></span>
              <span>${param.seriesName}: <strong>${formattedVal}</strong></span>
            </div>`;
          });
          return result;
        },
      },
      legend: {
        bottom: 0,
        data: ['保费', '占比'],
        textStyle: theme.chartTextStyles.staticLabel,
      },
      grid: GRID_CONFIG,
      xAxis: {
        ...theme.xAxisConfig,
        data: xAxisData,
        axisLabel: {
          ...theme.xAxisConfig.axisLabel,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '保费',
          position: 'left',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: AXIS_SPLIT_LINE,
          axisLabel: {
            formatter: formatPremiumWan,
            ...theme.chartTextStyles.axisLabel,
          },
        },
        {
          type: 'value',
          name: '占比（%）',
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          nameTextStyle: theme.chartTextStyles.axisName,
          splitLine: { show: false },
          axisLabel: {
            formatter: formatRate,
            ...theme.chartTextStyles.axisLabel,
          },
        },
      ],
      series: [
        {
          name: '保费',
          type: 'bar',
          data: barData,
          yAxisIndex: 0,
          itemStyle: { color: '#5470C6' },
          label: {
            show: false,
          },
        },
        {
          name: '占比',
          type: 'line',
          data: lineData,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { type: 'dashed', width: 2 },
          itemStyle: { color: '#EE6666' },
        },
      ],
    };

    return chartOption;
  }, [filteredData, title, selectedOrg, isDark]);

  if (loading) {
    return <div className={`h-96 flex items-center justify-center ${colorClasses.bg.neutral}`}>加载中...</div>;
  }

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow">
      {/* 机构选择器 */}
      <div className="flex justify-center items-center space-x-4 mb-4">
        <span className={`font-semibold text-sm ${colorClasses.text.neutral}`}>选择三级机构：</span>
        <select
          value={selectedOrg}
          onChange={(e) => setSelectedOrg(e.target.value)}
          className={`px-3 py-1 text-sm border ${colorClasses.border.neutral} rounded focus:outline-none focus:ring-2 focus:ring-primary-400`}
        >
          {orgList.map(org => (
            <option key={org} value={org}>{org}</option>
          ))}
        </select>
      </div>

      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '400px', width: '100%' }}
        notMerge={true}
      />
    </div>
  );
};
