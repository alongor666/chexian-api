/**
 * EnhancedKpiCard 组件
 * 增强型 KPI 指标卡片，支持数值展示、环形图、占比条等多种展示形式
 *
 * 使用统一设计系统：
 * - 卡片样式：bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 shadow-sm
 * - 支持深色模式：dark:bg-neutral-800 dark:border-neutral-700
 * - 标题样式：text-sm font-medium text-neutral-600
 * - 数值样式：text-2xl font-bold text-neutral-900
 * - 数值字体：Avenir Next / Century Gothic（Futura/Avenir 风格）
 */
import React, { memo } from 'react';
import { colors } from '../../shared/styles';
import { formatCount, formatPercent, formatRate } from '../../shared/utils/formatters';

/**
 * 环形图数据项
 */
export interface DonutDataItem {
  /** 标签（如"过户"、"非过户"） */
  label: string;
  /** 数值 */
  value: number | bigint;
  /** 颜色（可选） */
  color?: string;
}

/**
 * EnhancedKpiCard 组件属性
 */
export interface EnhancedKpiCardProps {
  /** KPI标题 */
  title: string;
  /** KPI数值 */
  value?: number | string | bigint | null;
  /** 格式化函数 */
  formatter?: (val: number) => string;
  /** 加载状态 */
  loading?: boolean;
  /** 卡片类型：value=纯数值, donut=环形图, bar=占比条 */
  type?: 'value' | 'donut' | 'bar';
  /** 占比数据（type='donut'或'bar'时必填） */
  ratioData?: DonutDataItem[];
  /** 图表尺寸（默认60px） */
  chartSize?: number;
  /** 自定义类名 */
  className?: string;
}

/**
 * 默认颜色方案 - 使用设计系统中的颜色
 */
const DEFAULT_COLORS = [colors.primary.DEFAULT, colors.neutral[400]];

/**
 * 多段条形图颜色方案（最多支持 4 段）
 */
const SEGMENT_COLORS = [
  colors.primary.DEFAULT, // 蓝
  '#10B981',              // 翠绿
  '#F59E0B',              // 琥珀
  colors.neutral[400],    // 灰（兜底）
];

const normalizeNumeric = (value: number | bigint): number => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
};

/**
 * 迷你环形图组件（SVG 自绘，轻量级）
 */
const MiniDonutChart: React.FC<{
  data: DonutDataItem[];
  size: number;
}> = ({ data, size }) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  // 计算总值
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    // 无数据时显示空环
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 4}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill="#9ca3af"
        >
          0%
        </text>
      </svg>
    );
  }

  // 计算主要类别占比（第一个数据项）
  const mainRate = (normalizedData[0]?.value || 0) / total;
  const mainPercentage = formatRate(mainRate);

  // 环形图参数
  const radius = size / 2 - 6; // 半径
  const strokeWidth = 8; // 线宽
  const centerX = size / 2;
  const centerY = size / 2;

  // 计算环形路径（SVG circle stroke-dasharray 方式）
  const circumference = 2 * Math.PI * radius;
  const mainArcLength = circumference * mainRate;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* 背景环（次要类别） */}
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[1]?.color || DEFAULT_COLORS[1]}
        strokeWidth={strokeWidth}
      />

      {/* 主要类别环 */}
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[0]?.color || DEFAULT_COLORS[0]}
        strokeWidth={strokeWidth}
        strokeDasharray={`${mainArcLength} ${circumference}`}
        strokeDashoffset={circumference / 4} // 从顶部开始
        transform={`rotate(-90 ${centerX} ${centerY})`} // 旋转使起点在顶部
      />

      {/* 中心文本：主要占比 */}
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="14"
        fontWeight="600"
        fill="#1f2937"
        className="font-chart-number"
      >
        {mainPercentage}
      </text>
    </svg>
  );
};

/**
 * 图例组件
 */
const ChartLegend: React.FC<{ data: DonutDataItem[] }> = ({ data }) => {
  return (
    <div className="flex items-center justify-center gap-4 mt-2">
      {data.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: item.color || DEFAULT_COLORS[index] }}
          />
          <span className="text-xs text-neutral-600 dark:text-neutral-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
};

const RatioBar: React.FC<{ data: DonutDataItem[] }> = ({ data }) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="w-full">
        <div className="flex h-12 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 items-center justify-center text-sm font-semibold text-neutral-400 dark:text-neutral-500">
          暂无数据
        </div>
      </div>
    );
  }

  // 多段条形图（3项及以上）
  if (normalizedData.length >= 3) {
    return (
      <div className="w-full">
        <div className="flex h-10 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700">
          {normalizedData.map((item, index) => {
            const rate = (item.value / total) * 100;
            const color = item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div
                key={index}
                className="flex items-center justify-center text-xs font-bold text-white font-chart-number"
                style={{
                  width: `${rate}%`,
                  backgroundColor: color,
                  minWidth: rate > 0 ? '24px' : 0,
                }}
              >
                {rate >= 8 ? `${Math.round(rate)}%` : ''}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-around mt-2">
          {normalizedData.map((item, index) => {
            const rate = (item.value / total) * 100;
            const color = item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div key={index} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                  {item.label} {Math.round(rate)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 2段条形图（原有逻辑）
  const primaryValue = normalizedData[0]?.value || 0;
  const secondaryValue = normalizedData[1]?.value || 0;
  const primaryRate = (primaryValue / total) * 100;
  const secondaryRate = (secondaryValue / total) * 100;
  return (
    <div className="w-full">
      <div className="flex h-12 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700">
        <div
          className="flex items-center justify-center text-sm font-semibold text-white font-chart-number"
          style={{
            width: `${primaryRate}%`,
            backgroundColor: normalizedData[0]?.color || DEFAULT_COLORS[0],
            minWidth: primaryRate > 0 ? '36px' : 0,
          }}
        >
          {primaryRate > 0 ? formatPercent(primaryRate) : ''}
        </div>
        <div
          className="flex items-center justify-center text-sm font-semibold text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-700 font-chart-number"
          style={{
            width: `${secondaryRate}%`,
            minWidth: secondaryRate > 0 ? '36px' : 0,
          }}
        >
          {secondaryRate > 0 ? formatPercent(secondaryRate) : ''}
        </div>
      </div>
    </div>
  );
};

/**
 * 增强型 KPI 卡片组件
 *
 * 支持两种类型:
 * 1. value: 纯数值展示（默认）
 * 2. donut: 数值 + 迷你环形图 + 图例
 *
 * 用于业绩看板的KPI指标展示，占比类指标使用环形图可视化。
 */
export const EnhancedKpiCard = memo<EnhancedKpiCardProps>(function EnhancedKpiCard({
  title,
  value,
  formatter,
  loading = false,
  type = 'value',
  ratioData = [],
  chartSize = 60,
}) {
  // 格式化数值
  const formattedValue = React.useMemo(() => {
    if (loading) return '--';
    if (value === null || value === undefined) return '--';
    if (typeof value === 'string') return value;
    if (typeof value === 'bigint') {
      if (formatter) return formatter(Number(value));
      return formatCount(value);
    }
    if (formatter) return formatter(value);
    return formatCount(value);
  }, [value, formatter, loading]);

  const normalizedRatioData = React.useMemo(
    () => ratioData.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [ratioData]
  );

  // 计算次要类别占比（用于左侧显示）
  const secondaryRate = React.useMemo(() => {
    if (type !== 'donut' || normalizedRatioData.length < 2) return null;
    const total = normalizedRatioData.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return '0.0%';
    const rate = (normalizedRatioData[1].value / total) * 100;
    return formatPercent(rate);
  }, [type, normalizedRatioData]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm">
        <div className="animate-pulse">
          <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-24 mb-3"></div>
          <div className="h-8 bg-neutral-200 dark:bg-neutral-800 rounded w-32"></div>
        </div>
      </div>
    );
  }

  // 数值类型卡片
  if (type === 'value') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2">{title}</div>
        <div className="text-[28px] font-bold tracking-tight text-neutral-900 dark:text-white font-kpi leading-none mt-1">
          {formattedValue}
        </div>
      </div>
    );
  }

  if (type === 'bar') {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-4">{title}</div>
        <RatioBar data={normalizedRatioData} />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-3">{title}</div>

      <div className="flex items-center justify-between mb-3 mt-1">
        <div className="flex flex-col">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{normalizedRatioData[1]?.label || '其他'}</div>
          <div className="text-[22px] tracking-tight font-bold text-neutral-800 dark:text-neutral-200 font-kpi leading-none">
            {secondaryRate}
          </div>
        </div>

        <div className="flex-shrink-0">
          <MiniDonutChart data={normalizedRatioData} size={chartSize} />
        </div>
      </div>

      <ChartLegend data={normalizedRatioData} />
    </div>
  );
});

export default EnhancedKpiCard;
