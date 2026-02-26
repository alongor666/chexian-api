/**
 * 摩意模型 - 图表组件
 * 实现原版的瀑布图效果
 */
import React, { useMemo, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { cardStyles, cn } from '@/shared/styles';
import type { MotoCostCalculation, AnalysisTab } from '../types';

interface MotoCostChartsProps {
  calculation: MotoCostCalculation;
  activeTab: AnalysisTab;
}

// 指标配置 - 带固定颜色
const ABSOLUTE_INDICATORS = [
  { key: 'PREMIUM', label: '保费', color: '#1890ff' },
  { key: 'LOSS', label: '赔款', color: '#ff4d4f' },
  { key: 'HANDLING_FEE', label: '手续费', color: '#faad14' },
  { key: 'SALES_PROMOTION', label: '销推费用', color: '#722ed1' },
  { key: 'LABOR_COST', label: '人力成本', color: '#13c2c2' },
  { key: 'FIXED_COST', label: '固定成本', color: '#eb2f96' },
  { key: 'PROFIT', label: '利润', color: null }, // 动态计算
];

const RATE_INDICATORS = [
  { key: 'TCR', label: '综合成本率', color: '#1890ff' },
  { key: 'LOSS_RATIO', label: '赔付率', color: '#ff4d4f' },
  { key: 'HANDLING_FEE_RATIO', label: '手续费率', color: '#faad14' },
  { key: 'SALES_PROMOTION_RATIO', label: '销推费用率', color: '#722ed1' },
  { key: 'LABOR_COST_RATIO', label: '人力成本率', color: '#13c2c2' },
  { key: 'FIXED_COST_RATIO', label: '固定成本率', color: '#eb2f96' },
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

  // 创建绝对值瀑布图配置
  const createAbsoluteChartOption = useMemo(() => {
    const values = currentData.absolute;
    const helpers = new Array(values.length).fill(0);

    // 瀑布图逻辑：保费和利润作为基准点（helper=0），成本从上一点递减
    let currentHeight = 0;
    const totalKeys = ['PREMIUM', 'PROFIT'];

    for (let i = 0; i < values.length; i++) {
      const key = ABSOLUTE_INDICATORS[i].key;
      if (totalKeys.includes(key)) {
        helpers[i] = 0;
        currentHeight = values[i];
      } else {
        // 成本项：从上一点减去
        helpers[i] = currentHeight - values[i];
        currentHeight = helpers[i];
      }
    }

    const seriesData = values.map((value, idx) => {
      const config = ABSOLUTE_INDICATORS[idx];
      // 利润使用动态颜色（正数绿色，负数红色）
      const color = config.key === 'PROFIT'
        ? (value >= 0 ? '#52c41a' : '#ff4d4f')
        : config.color;
      return {
        value,
        itemStyle: { color, borderRadius: [5, 5, 0, 0] },
        label: { color: '#262626' },
      };
    });

    return {
      backgroundColor: 'transparent',
      title: {
        text: `成本瀑布分析${titleSuffix}`,
        left: 'center',
        top: '5%',
        textStyle: { color: '#262626', fontSize: 16, fontWeight: 600 },
      },
      grid: { left: '3%', right: '5%', bottom: '15%', top: '20%', containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#fff',
        borderColor: '#e8e8e8',
        textStyle: { color: '#262626' },
        formatter: (params: any) => {
          const data = params[1]; // 数值系列
          if (!data) return '';
          return `${data.name}<br/>${data.marker} ${data.value?.toFixed(1)} 万元`;
        },
      },
      xAxis: {
        type: 'category',
        data: ABSOLUTE_INDICATORS.map(i => i.label),
        axisLine: { lineStyle: { color: '#d9d9d9' } },
        axisTick: { show: false },
        axisLabel: { color: '#595959', fontSize: 12, fontWeight: 500 },
      },
      yAxis: { show: false },
      series: [
        {
          name: '辅助',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: 'transparent' },
          emphasis: { itemStyle: { color: 'transparent' } },
          data: helpers,
          animation: false,
          label: { show: false },
        },
        {
          name: '数值',
          type: 'bar',
          stack: 'total',
          barWidth: '50%',
          data: seriesData,
          label: {
            show: true,
            position: 'top',
            fontSize: 12,
            fontWeight: 600,
            distance: 8,
            formatter: (params: any) => `${params.value?.toFixed(1)}`,
          },
        },
      ],
    };
  }, [currentData, titleSuffix]);

  // 创建比率瀑布图配置
  const createRateChartOption = useMemo(() => {
    const values = currentData.rate.map(v => v * 100); // 转为百分比
    const helpers = new Array(values.length).fill(0);

    // 瀑布图逻辑：TCR 作为基准点
    let currentHeight = 100;

    for (let i = 0; i < values.length; i++) {
      const key = RATE_INDICATORS[i].key;
      if (key === 'TCR') {
        helpers[i] = 0;
        currentHeight = values[i];
      } else {
        helpers[i] = currentHeight - values[i];
        currentHeight = helpers[i];
      }
    }

    const seriesData = values.map((value, idx) => {
      const config = RATE_INDICATORS[idx];
      // TCR 使用动态颜色（<=100% 绿色，>100% 红色）
      const color = config.key === 'TCR'
        ? (value <= 100 ? '#52c41a' : '#ff4d4f')
        : config.color;
      return {
        value,
        itemStyle: { color, borderRadius: [5, 5, 0, 0] },
        label: { color: '#262626' },
      };
    });

    return {
      backgroundColor: 'transparent',
      title: {
        text: `成本率瀑布分析${titleSuffix}`,
        left: 'center',
        top: '5%',
        textStyle: { color: '#262626', fontSize: 16, fontWeight: 600 },
      },
      grid: { left: '3%', right: '5%', bottom: '15%', top: '20%', containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#fff',
        borderColor: '#e8e8e8',
        textStyle: { color: '#262626' },
        formatter: (params: any) => {
          const data = params[1];
          if (!data) return '';
          return `${data.name}<br/>${data.marker} ${data.value?.toFixed(1)}%`;
        },
      },
      xAxis: {
        type: 'category',
        data: RATE_INDICATORS.map(i => i.label),
        axisLine: { lineStyle: { color: '#d9d9d9' } },
        axisTick: { show: false },
        axisLabel: { color: '#595959', fontSize: 12, fontWeight: 500 },
      },
      yAxis: { show: false },
      series: [
        {
          name: '辅助',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: 'transparent' },
          emphasis: { itemStyle: { color: 'transparent' } },
          data: helpers,
          animation: false,
          label: { show: false },
        },
        {
          name: '数值',
          type: 'bar',
          stack: 'total',
          barWidth: '50%',
          data: seriesData,
          label: {
            show: true,
            position: 'top',
            fontSize: 12,
            fontWeight: 600,
            distance: 8,
            formatter: (params: any) => `${params.value?.toFixed(1)}%`,
          },
        },
      ],
    };
  }, [currentData, titleSuffix]);

  // 初始化和更新图表
  useEffect(() => {
    if (!absoluteChartRef.current || !rateChartRef.current) return;

    if (!absoluteChartInstance.current) {
      absoluteChartInstance.current = echarts.init(absoluteChartRef.current);
    }
    if (!rateChartInstance.current) {
      rateChartInstance.current = echarts.init(rateChartRef.current);
    }

    absoluteChartInstance.current.setOption(createAbsoluteChartOption, true);
    rateChartInstance.current.setOption(createRateChartOption, true);

    // 响应式
    const handleResize = () => {
      absoluteChartInstance.current?.resize();
      rateChartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [createAbsoluteChartOption, createRateChartOption]);

  // 清理
  useEffect(() => {
    return () => {
      absoluteChartInstance.current?.dispose();
      rateChartInstance.current?.dispose();
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className={cn(cardStyles.standard)} style={{ height: 420 }}>
        <div ref={absoluteChartRef} className="w-full h-full" />
      </div>
      <div className={cn(cardStyles.standard)} style={{ height: 420 }}>
        <div ref={rateChartRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default MotoCostCharts;
