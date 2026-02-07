import React, { useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { AXIS_SPLIT_LINE, CHART_TEXT_STYLES, GRID_CONFIG, X_AXIS_CONFIG } from '../../shared/config/chartStyles';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';

interface TonnageByOrgData {
  org_level_3: string;
  tonnage_segment: string;
  premium: number;
  premium_ratio: number;
}

interface TonnageByOrgDualYChartProps {
  data: TonnageByOrgData[];
  loading?: boolean;
  title?: string;
}

/**
 * 吨位分段分析图（可切换吨位）
 *
 * 功能：
 * - 通过下拉选择器选择某一个吨位分段
 * - X轴：该吨位分段下的所有三级机构
 * - 左Y轴：每个机构的保费（柱状图）
 * - 右Y轴：每个机构在该吨位分段中的占比（折线图）
 *
 * @example
 * ```tsx
 * <TonnageByOrgDualYChart
 *   data={[
 *     {org_level_3: '机构A', tonnage_segment: '1吨以下', premium: 100000, premium_ratio: 0.25},
 *     ...
 *   ]}
 *   loading={false}
 * />
 * ```
 */
export const TonnageByOrgDualYChart: React.FC<TonnageByOrgDualYChartProps> = ({
  data,
  loading = false,
  title = '吨位分段分析',
}) => {
  // 提取所有吨位分段列表
  const tonnageList = useMemo(() => {
    const tonnages = new Set<string>();
    data.forEach(row => tonnages.add(row.tonnage_segment));
    return Array.from(tonnages).sort();
  }, [data]);

  // 默认选择第一个吨位分段
  const [selectedTonnage, setSelectedTonnage] = useState<string>(tonnageList[0] || '');

  // 根据选中的吨位分段筛选数据
  const filteredData = useMemo(() => {
    return data.filter(row => row.tonnage_segment === selectedTonnage);
  }, [data, selectedTonnage]);

  const option = useMemo(() => {
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

    // X轴：机构名称
    const xAxisData = sortedData.map(row => row.org_level_3);
    // 柱状图数据：保费
    const barData = sortedData.map(row => row.premium);
    // 折线图数据：占比
    const lineData = sortedData.map(row => row.premium_ratio);

    const chartOption: EChartsOption = {
      title: {
        text: `${title} - ${selectedTonnage}`,
        left: 'center',
        textStyle: CHART_TEXT_STYLES.title,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const org = safeParams[0].name;
          let result = `<div style="font-weight:bold">${org}</div>`;

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
        textStyle: CHART_TEXT_STYLES.staticLabel,
      },
      grid: GRID_CONFIG,
      xAxis: {
        ...X_AXIS_CONFIG,
        data: xAxisData,
        axisLabel: {
          ...X_AXIS_CONFIG.axisLabel,
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
            ...CHART_TEXT_STYLES.axisLabel,
          },
        },
        {
          type: 'value',
          name: '占比（%）',
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          nameTextStyle: CHART_TEXT_STYLES.axisName,
          splitLine: { show: false },
          axisLabel: {
            formatter: formatRate,
            ...CHART_TEXT_STYLES.axisLabel,
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
  }, [filteredData, title, selectedTonnage]);

  if (loading) {
    return <div className="h-96 flex items-center justify-center bg-gray-50">加载中...</div>;
  }

  return (
    <div className="bg-white p-4 rounded shadow">
      {/* 吨位分段选择器 */}
      <div className="flex justify-center items-center space-x-4 mb-4">
        <span className="font-semibold text-sm text-gray-700">选择吨位分段：</span>
        <select
          value={selectedTonnage}
          onChange={(e) => setSelectedTonnage(e.target.value)}
          className="px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {tonnageList.map(tonnage => (
            <option key={tonnage} value={tonnage}>{tonnage}</option>
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
