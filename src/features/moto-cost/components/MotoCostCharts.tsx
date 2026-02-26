/**
 * 摩意模型 - 图表组件
 */
import React, { useMemo, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { cardStyles, textStyles, cn } from '@/shared/styles';
import type { MotoCostCalculation, AnalysisTab } from '../types';

interface MotoCostChartsProps {
  calculation: MotoCostCalculation;
  activeTab: AnalysisTab;
}

// 指标配置
const ABSOLUTE_INDICATORS = [
  { key: 'PREMIUM', label: '保费', color: '#1890ff' },
  { key: 'LOSS', label: '赔款', color: '#ff4d4f' },
  { key: 'HANDLING_FEE', label: '手续费', color: '#faad14' },
  { key: 'SALES_PROMOTION', label: '销推费用', color: '#722ed1' },
  { key: 'LABOR_COST', label: '人力成本', color: '#13c2c2' },
  { key: 'FIXED_COST', label: '固定成本', color: '#eb2f96' },
  { key: 'PROFIT', label: '利润', color: '#52c41a' },
];

const RATE_INDICATORS = [
  { key: 'TCR', label: '综合成本率', color: '#1890ff' },
  { key: 'LOSS_RATIO', label: '赔付率', color: '#ff4d4f' },
  { key: 'HANDLING_FEE_RATIO', label: '手续费率', color: '#faad14' },
  { key: 'SALES_PROMOTION_RATIO', label: '销推费用率', color: '#722ed1' },
  { key: 'LABOR_COST_RATIO', label: '人力成本率', color: '#13c2c2' },
];

export const MotoCostCharts: React.FC<MotoCostChartsProps> = ({ calculation, activeTab }) => {
  const absoluteChartRef = useRef<HTMLDivElement>(null);
  const rateChartRef = useRef<HTMLDivElement>(null);
  const absoluteChartInstance = useRef<echarts.ECharts | null>(null);
  const rateChartInstance = useRef<echarts.ECharts | null>(null);

  // 获取当前数据
  const currentData = useMemo(() => {
    switch (activeTab) {
      case 'car':
        return calculation.car;
      case 'moto':
        return calculation.moto;
      default:
        return calculation.combined;
    }
  }, [calculation, activeTab]);

  // 获取标题后缀
  const titleSuffix = useMemo(() => {
    switch (activeTab) {
      case 'car':
        return '（车险）';
      case 'moto':
        return '（摩意险）';
      default:
        return '';
    }
  }, [activeTab]);

  // 初始化和更新图表
  useEffect(() => {
    if (!absoluteChartRef.current || !rateChartRef.current) return;

    // 初始化图表实例
    if (!absoluteChartInstance.current) {
      absoluteChartInstance.current = echarts.init(absoluteChartRef.current);
    }
    if (!rateChartInstance.current) {
      rateChartInstance.current = echarts.init(rateChartRef.current);
    }

    // 绝对值瀑布图配置
    const absoluteOption: echarts.EChartsOption = {
      title: {
        text: `成本瀑布分析${titleSuffix}`,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600, color: '#262626' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>${data.marker} ${data.value?.toFixed(1) ?? '-'} 万元`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '50px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: ABSOLUTE_INDICATORS.map(i => i.label),
        axisLabel: { fontSize: 12, color: '#595959' },
        axisLine: { lineStyle: { color: '#d9d9d9' } },
      },
      yAxis: {
        type: 'value',
        name: '万元',
        nameTextStyle: { fontSize: 12, color: '#8c8c8c' },
        axisLabel: { fontSize: 12, color: '#595959' },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: [
        {
          type: 'bar',
          data: currentData.absolute.map((value, index) => ({
            value,
            itemStyle: {
              color: value >= 0 ? ABSOLUTE_INDICATORS[index].color : '#ff4d4f',
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: '50%',
          label: {
            show: true,
            position: 'top',
            formatter: (params: any) => params.value?.toFixed(1),
            fontSize: 11,
            color: '#595959',
          },
        },
      ],
    };

    // 比率图配置
    const rateOption: echarts.EChartsOption = {
      title: {
        text: `成本率分析${titleSuffix}`,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600, color: '#262626' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>${data.marker} ${(data.value * 100)?.toFixed(2) ?? '-'}%`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '50px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: RATE_INDICATORS.map(i => i.label),
        axisLabel: { fontSize: 12, color: '#595959' },
        axisLine: { lineStyle: { color: '#d9d9d9' } },
      },
      yAxis: {
        type: 'value',
        name: '%',
        nameTextStyle: { fontSize: 12, color: '#8c8c8c' },
        axisLabel: {
          fontSize: 12,
          color: '#595959',
          formatter: (value: number) => `${(value * 100).toFixed(0)}%`,
        },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: [
        {
          type: 'bar',
          data: currentData.rate.slice(0, RATE_INDICATORS.length).map((value, index) => ({
            value,
            itemStyle: {
              color: RATE_INDICATORS[index].color,
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: '50%',
          label: {
            show: true,
            position: 'top',
            formatter: (params: any) => `${((params.value as number) * 100).toFixed(1)}%`,
            fontSize: 11,
            color: '#595959',
          },
        },
      ],
    };

    absoluteChartInstance.current.setOption(absoluteOption);
    rateChartInstance.current.setOption(rateOption);

    // 响应式
    const handleResize = () => {
      absoluteChartInstance.current?.resize();
      rateChartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [currentData, titleSuffix]);

  // 清理
  useEffect(() => {
    return () => {
      absoluteChartInstance.current?.dispose();
      rateChartInstance.current?.dispose();
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className={cn(cardStyles.standard)} style={{ height: 400 }}>
        <div ref={absoluteChartRef} className="w-full h-full" />
      </div>
      <div className={cn(cardStyles.standard)} style={{ height: 400 }}>
        <div ref={rateChartRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default MotoCostCharts;
