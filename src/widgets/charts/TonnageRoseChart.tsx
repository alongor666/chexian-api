import React, { useMemo, useState } from 'react';
import { RoseChart } from './RoseChart';
import { TONNAGE_COLORS } from '../../shared/config/chartStyles';
import { formatCount, formatPremiumWan } from '../../shared/utils/formatters';
import { cardStyles, cn } from '../../shared/styles';

interface TonnageRoseChartProps {
  premiumData: { name: string; value: number }[];
  countData: { name: string; value: number }[];
  loading?: boolean;
  showTitle?: boolean;
  showContainer?: boolean;
}

/**
 * 吨位分段玫瑰图组件（支持指标切换）
 *
 * 功能：
 * - 支持保费和保单数两种指标切换
 * - 使用玫瑰图（Rose Chart）形式展示各吨位分段的占比
 * - 自动处理加载状态
 *
 * @example
 * ```tsx
 * <TonnageRoseChart
 *   premiumData={[{name: '1吨以下', value: 100000}, ...]}
 *   countData={[{name: '1吨以下', value: 50}, ...]}
 *   loading={false}
 * />
 * ```
 */
export const TonnageRoseChart: React.FC<TonnageRoseChartProps> = ({
  premiumData,
  countData,
  loading = false,
  showTitle = true,
  showContainer = true,
}) => {
  const [metric, setMetric] = useState<'premium' | 'count'>('premium');

  const data = useMemo(() => {
    const source = metric === 'premium' ? premiumData : countData;
    return source.map(item => ({
      ...item,
      itemStyle: {
        color: TONNAGE_COLORS[item.name] || '#8D98B3',
      },
    }));
  }, [metric, premiumData, countData]);
  const title = metric === 'premium' ? '吨位分段保费占比' : '吨位分段保单数量占比';
  const valueFormatter = metric === 'premium' ? formatPremiumWan : formatCount;

  const content = (
    <>
      {showTitle && (
        <h3 className="text-lg font-bold mb-4 text-center text-gray-800">{title}</h3>
      )}

      {/* 指标切换器 */}
      <div className="flex justify-center items-center space-x-4 mb-4">
        <span className="font-semibold text-sm text-gray-700">显示指标：</span>
        <div className="flex space-x-2">
          <button
            onClick={() => setMetric('premium')}
            className={`px-3 py-1 text-sm rounded transition-colors ${metric === 'premium'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
          >
            保费
          </button>
          <button
            onClick={() => setMetric('count')}
            className={`px-3 py-1 text-sm rounded transition-colors ${metric === 'count'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
          >
            保单数
          </button>
        </div>
      </div>

      <RoseChart
        title={title}
        data={data}
        loading={loading}
        showValueLabel={true}
        showTitle={false}
        withContainer={false}
        height={showTitle ? 320 : 360}
        valueFormatter={valueFormatter}
      />
    </>
  );

  if (!showContainer) {
    return <div>{content}</div>;
  }

  return <div className={cn(cardStyles.standard)}>{content}</div>;
};
