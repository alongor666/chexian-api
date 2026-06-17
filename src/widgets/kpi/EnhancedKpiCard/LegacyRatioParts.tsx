/**
 * EnhancedKpiCard — 旧 donut/bar 三件套（向后兼容）
 *
 * MiniDonutChart / ChartLegend / RatioBar：
 * standard 变体的 type='donut'/'bar' 分支沿用此处实现。
 * 全部 SVG 自绘，零 ECharts/canvas 依赖。
 */
import React from 'react';
import {
  colors,
  fontStyles,
  cn,
  colorClasses,
  textStyles,
} from '../../../shared/styles';
import { formatPercent, formatRate } from '../../../shared/utils/formatters';
import type { DonutDataItem } from './types';
import { DEFAULT_COLORS, SEGMENT_COLORS, normalizeNumeric } from './utils';

export const MiniDonutChart: React.FC<{ data: DonutDataItem[]; size: number }> = ({
  data,
  size,
}) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 4}
          fill="none"
          stroke={colors.neutral[200]}
          strokeWidth="8"
          className="dark:[stroke:var(--border-default)]"
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill={colors.neutral[400]}
          className="dark:[fill:#bfbfbf]"
        >
          0%
        </text>
      </svg>
    );
  }

  const mainRate = (normalizedData[0]?.value || 0) / total;
  const mainPercentage = formatRate(mainRate);
  const radius = size / 2 - 6;
  const strokeWidth = 8;
  const centerX = size / 2;
  const centerY = size / 2;
  const circumference = 2 * Math.PI * radius;
  const mainArcLength = circumference * mainRate;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[1]?.color || DEFAULT_COLORS[1]}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[0]?.color || DEFAULT_COLORS[0]}
        strokeWidth={strokeWidth}
        strokeDasharray={`${mainArcLength} ${circumference}`}
        strokeDashoffset={circumference / 4}
        transform={`rotate(-90 ${centerX} ${centerY})`}
      />
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="14"
        fontWeight="600"
        fill={colors.neutral[900]}
        className={cn(fontStyles.numeric, 'dark:[fill:#f5f5f5]')}
      >
        {mainPercentage}
      </text>
    </svg>
  );
};

export const ChartLegend: React.FC<{ data: DonutDataItem[] }> = ({ data }) => (
  <div className="flex items-center justify-center gap-4 mt-2">
    {data.map((item, index) => (
      <div key={index} className="flex items-center gap-1.5">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: item.color || DEFAULT_COLORS[index] }}
        />
        <span className={textStyles.caption}>{item.label}</span>
      </div>
    ))}
  </div>
);

export const RatioBar: React.FC<{ data: DonutDataItem[] }> = ({ data }) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="w-full">
        <div
          className={cn(
            'flex h-12 rounded-lg overflow-hidden items-center justify-center text-sm font-semibold border',
            colorClasses.border.neutral,
            colorClasses.bg.neutral,
            colorClasses.text.neutralMuted
          )}
        >
          暂无数据
        </div>
      </div>
    );
  }

  if (normalizedData.length >= 3) {
    return (
      <div className="w-full">
        <div className={cn('flex h-10 rounded-lg overflow-hidden border', colorClasses.border.neutral)}>
          {normalizedData.map((item, index) => {
            const rate = (item.value / total) * 100;
            const color =
              item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div
                key={index}
                className={cn(
                  'flex items-center justify-center text-xs font-bold text-white',
                  fontStyles.numeric
                )}
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
            const color =
              item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div key={index} className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className={cn(textStyles.caption, 'whitespace-nowrap')}>
                  {item.label} {Math.round(rate)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const primaryValue = normalizedData[0]?.value || 0;
  const secondaryValue = normalizedData[1]?.value || 0;
  const primaryRate = (primaryValue / total) * 100;
  const secondaryRate = (secondaryValue / total) * 100;
  return (
    <div className="w-full">
      <div className={cn('flex h-12 rounded-lg overflow-hidden border', colorClasses.border.neutral)}>
        <div
          className={cn(
            'flex items-center justify-center text-sm font-semibold text-white',
            fontStyles.numeric
          )}
          style={{
            width: `${primaryRate}%`,
            backgroundColor: normalizedData[0]?.color || DEFAULT_COLORS[0],
            minWidth: primaryRate > 0 ? '36px' : 0,
          }}
        >
          {primaryRate > 0 ? formatPercent(primaryRate) : ''}
        </div>
        <div
          className={cn(
            'flex items-center justify-center text-sm font-semibold',
            colorClasses.text.neutral,
            colorClasses.bg.neutralLight,
            fontStyles.numeric
          )}
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
