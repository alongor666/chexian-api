/**
 * 双Y轴对比图表组件
 *
 * 用于同时展示保费和件数的对比分析：
 * - 左Y轴：保费（柱状图，当期vs基期）
 * - 右Y轴：件数（折线图，当期vs基期）
 *
 * @module DualYAxisComparisonChart
 * @author @claude
 * @since 2026-01-14
 */

import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { AXIS_SPLIT_LINE, CHART_TEXT_STYLES, GRID_CONFIG, X_AXIS_CONFIG } from '../../shared/config/chartStyles';
import { colorClasses } from '../../shared/styles';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatCount } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';

/** 双指标对比数据结构 */
export interface DualMetricComparisonData {
  /** 维度键（机构名/业务员名） */
  dim_key: string;
  /** 当期保费 */
  current_premium: number;
  /** 基期保费 */
  previous_premium: number;
  /** 当期件数 */
  current_count: number;
  /** 基期件数 */
  previous_count: number;
  /** 保费增长率 */
  premium_growth_rate?: number | null;
  /** 件数增长率 */
  count_growth_rate?: number | null;
}

interface DualYAxisComparisonChartProps {
  /** 对比数据 */
  data: DualMetricComparisonData[];
  /** 加载状态 */
  loading?: boolean;
  /** 图表标题 */
  title?: string;
  /** 图表高度 */
  height?: string | number;
  /** 当期标签 */
  currentLabel?: string;
  /** 基期标签 */
  previousLabel?: string;
}

/** 颜色配置 */
const COLORS = {
  currentPremium: '#5470C6',   // 当期保费 - 蓝色
  previousPremium: '#91CC75',  // 基期保费 - 绿色
  currentCount: '#EE6666',     // 当期件数 - 红色
  previousCount: '#FAC858',    // 基期件数 - 黄色
};

/**
 * 双Y轴对比图表
 */
export const DualYAxisComparisonChart: React.FC<DualYAxisComparisonChartProps> = ({
  data,
  loading = false,
  title = '保费与件数对比分析',
  height = 400,
  currentLabel = '当期',
  previousLabel = '基期',
}) => {
  const option = useMemo((): EChartsOption => {
    if (!data || data.length === 0) {
      return {
        title: { text: title, left: 'center', textStyle: CHART_TEXT_STYLES.title },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      };
    }

    // 按当期保费降序排序，取Top 15
    const sortedData = [...data]
      .sort((a, b) => b.current_premium - a.current_premium)
      .slice(0, 15);

    // X轴数据
    const xAxisData = sortedData.map(d => d.dim_key);

    // 保费数据（柱状图）
    const currentPremiumData = sortedData.map(d => d.current_premium);
    const previousPremiumData = sortedData.map(d => d.previous_premium);

    // 件数数据（折线图）
    const currentCountData = sortedData.map(d => d.current_count);
    const previousCountData = sortedData.map(d => d.previous_count);

    return {
      title: {
        text: title,
        left: 'center',
        textStyle: CHART_TEXT_STYLES.title,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';

          const dimKey = safeParams[0].name;
          let result = `<div style="font-weight:bold;margin-bottom:8px">${dimKey}</div>`;

          // 分组显示
          const premiumItems: string[] = [];
          const countItems: string[] = [];

          safeParams.forEach((param) => {
            const seriesName = String(param.seriesName ?? '');
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);

            const isPremium = seriesName.includes('保费');
            const formattedVal = isPremium ? formatPremiumWan(rawValue) : formatCount(rawValue);

            const item = `<div style="display:flex;align-items:center;margin-top:2px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${param.color};margin-right:5px"></span>
              <span>${seriesName}: <strong>${formattedVal}</strong></span>
            </div>`;

            if (isPremium) {
              premiumItems.push(item);
            } else {
              countItems.push(item);
            }
          });

          if (premiumItems.length > 0) {
            result += `<div style="margin-bottom:4px"><div style="color:#666;font-size:11px">保费</div>${premiumItems.join('')}</div>`;
          }
          if (countItems.length > 0) {
            result += `<div><div style="color:#666;font-size:11px">件数</div>${countItems.join('')}</div>`;
          }

          return result;
        },
      },
      legend: {
        bottom: 0,
        data: [
          `${currentLabel}保费`,
          `${previousLabel}保费`,
          `${currentLabel}件数`,
          `${previousLabel}件数`,
        ],
        textStyle: CHART_TEXT_STYLES.staticLabel,
      },
      grid: {
        ...GRID_CONFIG,
        bottom: 60, // 为图例留出空间
      },
      xAxis: {
        ...X_AXIS_CONFIG,
        data: xAxisData,
        axisLabel: {
          ...X_AXIS_CONFIG.axisLabel,
          rotate: 0,  // 统一水平显示
          interval: 0,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '保费（万元）',
          position: 'left',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: AXIS_SPLIT_LINE,
          nameTextStyle: CHART_TEXT_STYLES.axisName,
          axisLabel: {
            formatter: (value: number) => formatPremiumWan(value),
            ...CHART_TEXT_STYLES.axisLabel,
          },
        },
        {
          type: 'value',
          name: '件数',
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          nameTextStyle: CHART_TEXT_STYLES.axisName,
          axisLabel: {
            formatter: (value: number) => formatCount(value),
            ...CHART_TEXT_STYLES.axisLabel,
          },
        },
      ],
      series: [
        // 保费柱状图（当期）
        {
          name: `${currentLabel}保费`,
          type: 'bar',
          yAxisIndex: 0,
          data: currentPremiumData,
          itemStyle: { color: COLORS.currentPremium },
          barMaxWidth: 30,
        },
        // 保费柱状图（基期）
        {
          name: `${previousLabel}保费`,
          type: 'bar',
          yAxisIndex: 0,
          data: previousPremiumData,
          itemStyle: { color: COLORS.previousPremium },
          barMaxWidth: 30,
        },
        // 件数折线图（当期）
        {
          name: `${currentLabel}件数`,
          type: 'line',
          yAxisIndex: 1,
          data: currentCountData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2 },
          itemStyle: { color: COLORS.currentCount },
        },
        // 件数折线图（基期）
        {
          name: `${previousLabel}件数`,
          type: 'line',
          yAxisIndex: 1,
          data: previousCountData,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          lineStyle: { width: 2, type: 'dashed' },
          itemStyle: { color: COLORS.previousCount },
        },
      ],
    };
  }, [data, title, currentLabel, previousLabel]);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center ${colorClasses.bg.neutral} rounded`}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        <div className={colorClasses.text.neutralMuted}>加载中...</div>
      </div>
    );
  }

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}
      notMerge={true}
    />
  );
};

export default DualYAxisComparisonChart;
