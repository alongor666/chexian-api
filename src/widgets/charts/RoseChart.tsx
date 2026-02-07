import React, { useMemo, useState, useEffect, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import { CHART_TEXT_STYLES, TONNAGE_COLORS } from '../../shared/config/chartStyles';
import { echarts } from '../../shared/utils/echarts';
import type { EChartsParam } from '../../shared/types/echarts';

interface RoseChartDatum {
  name: string;
  value: number;
}

interface RoseChartProps {
  data: RoseChartDatum[];
  title?: string;
  loading?: boolean;
  showValueLabel?: boolean;
  showTitle?: boolean;
  height?: number;
  withContainer?: boolean;
  valueFormatter?: (value: number) => string;
}

/**
 * 聚合小扇区数据（<5%）为"其他"类别
 * @param data 原始数据
 * @param threshold 聚合阈值（默认5%）
 * @param minSectorsForAggregation 启用聚合的最小扇区数（默认20）
 */
const aggregateSmallSectors = (
  data: RoseChartDatum[],
  threshold: number = 5,
  minSectorsForAggregation: number = 20
): { aggregatedData: RoseChartDatum[]; smallSectors: RoseChartDatum[] } => {
  // 扇区数量不足时不聚合
  if (data.length <= minSectorsForAggregation) {
    return { aggregatedData: data, smallSectors: [] };
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const smallSectors: RoseChartDatum[] = [];
  const largeSectors: RoseChartDatum[] = [];

  data.forEach((item) => {
    const percent = (item.value / total) * 100;
    if (percent < threshold) {
      smallSectors.push(item);
    } else {
      largeSectors.push(item);
    }
  });

  // 如果没有小扇区，返回原始数据
  if (smallSectors.length === 0) {
    return { aggregatedData: data, smallSectors: [] };
  }

  // 创建"其他"聚合项
  const othersValue = smallSectors.reduce((sum, item) => sum + item.value, 0);
  const othersItem: RoseChartDatum = {
    name: `其他 (${smallSectors.length}项)`,
    value: othersValue,
  };

  return {
    aggregatedData: [...largeSectors, othersItem],
    smallSectors,
  };
};

export const RoseChart: React.FC<RoseChartProps> = ({
  data,
  title,
  loading,
  showValueLabel = true,
  showTitle = true,
  height = 320,
  withContainer = true,
  valueFormatter,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600); // 默认宽度

  // 响应式：监听容器宽度变化
  useEffect(() => {
    if (!withContainer || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setContainerWidth(width);
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [withContainer]);

  const option = useMemo(() => {
    const formatValue = valueFormatter || formatPremiumWan;

    // 聚合小扇区
    const { aggregatedData, smallSectors } = aggregateSmallSectors(data);

    // ===== 响应式配置 =====
    const isSmallScreen = containerWidth < 400;

    // 1. 响应式字体大小
    const baseFontSize = CHART_TEXT_STYLES.label.fontSize;
    const dataBasedFontSize = aggregatedData.length > 10 ? Math.max(10, baseFontSize - 2) : baseFontSize;
    const responsiveFontSize = isSmallScreen ? Math.max(9, dataBasedFontSize - 1) : dataBasedFontSize;

    // 2. 响应式图表半径（小屏幕时缩小）
    const radius = isSmallScreen ? ['30%', '60%'] : ['20%', '70%'];

    // 3. 响应式中心位置（小屏幕时下移）
    const centerY = showTitle ? (isSmallScreen ? '48%' : '45%') : '50%';

    // 4. 响应式引线长度（小屏幕时缩短）
    const labelLength = isSmallScreen ? 5 : 10;
    const labelLength2 = isSmallScreen ? 8 : 15;

    const labelFormatter = (params: EChartsParam) => {
      if (!showValueLabel) return params.name;
      const percent = formatRate(params.percent ?? 0);
      // 小扇区（<5%）只显示名称，不显示百分比，避免拥挤
      if ((params.percent ?? 0) < 5) {
        return params.name;
      }
      return `${params.name}\n${percent}`;
    };

    const tooltipFormatter = (params: EChartsParam) => {
      const rawValue = typeof params.value === 'number' ? params.value : Number(params.value ?? 0);
      const valueText = formatValue(rawValue);
      const percentText = formatRate(params.percent ?? 0);

      // 如果是"其他"聚合项，显示详细列表
      if (params.name?.startsWith('其他') && smallSectors.length > 0) {
        const details = smallSectors
          .map((item) => {
            const itemValue = formatValue(item.value);
            const itemPercent = formatRate((item.value / data.reduce((s, d) => s + d.value, 0)) * 100);
            return `  • ${item.name}: ${itemValue} (${itemPercent})`;
          })
          .join('<br/>');
        return `${params.name}<br/>${valueText} (${percentText})<br/><br/>包含项：<br/>${details}`;
      }

      return `${params.name}: ${valueText} (${percentText})`;
    };

    return {
      title: showTitle && title ? { text: title, left: 'center', textStyle: { fontSize: isSmallScreen ? 14 : 16 } } : undefined,
      tooltip: { trigger: 'item', formatter: tooltipFormatter },
      legend: {
        bottom: 0,
        type: 'scroll',
        textStyle: {
          ...CHART_TEXT_STYLES.legend,
          fontSize: isSmallScreen ? 10 : 12,
        },
      },
      series: [
        {
          name: title,
          type: 'pie',
          roseType: 'radius',
          radius,
          center: ['50%', centerY],
          label: {
            show: true,
            formatter: labelFormatter,
            color: CHART_TEXT_STYLES.label.color,
            fontSize: responsiveFontSize,
            // 防重叠配置
            overflow: 'truncate',
            ellipsis: '...',
          },
          labelLine: {
            show: true,
            length: labelLength,
            length2: labelLength2,
            smooth: 0.2,
            lineStyle: {
              width: 1,
              color: '#999',
            },
          },
          // 小扇区标签布局优化
          labelLayout: () => ({
            hideOverlap: true, // 自动隐藏重叠标签
          }),
          data: aggregatedData.map(item => ({
            ...item,
            itemStyle: {
              // "其他"项使用灰色，其他项使用配置颜色
              color: item.name.startsWith('其他') ? '#9CA3AF' : (TONNAGE_COLORS[item.name] || undefined),
            },
          })),
        },
      ],
    };
  }, [data, title, showValueLabel, showTitle, valueFormatter, containerWidth]);

  if (loading) {
    return (
      <div className={`${withContainer ? 'bg-white p-4 rounded shadow' : ''} h-64 flex items-center justify-center bg-gray-50`}>
        Loading Chart...
      </div>
    );
  }

  const chart = (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      notMerge={true}
    />
  );

  if (!withContainer) {
    return chart;
  }

  return <div ref={containerRef} className="bg-white p-4 rounded shadow h-full">{chart}</div>;
};
