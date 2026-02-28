import React from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, cn, colorClasses, textStyles, comprehensiveTheme } from '@/shared/styles';

interface ComprehensiveChartCardProps {
  title: string;
  option: EChartsOption;
  loading: boolean;
  error: string | null;
  height?: number;
}

export const ComprehensiveChartCard: React.FC<ComprehensiveChartCardProps> = ({
  title,
  option,
  loading,
  error,
  height = 320,
}) => {
  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <h3 className={textStyles.titleSmall}>{title}</h3>
      {error ? (
        <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {error}</p>
      ) : loading ? (
        <div className={cn('flex items-center justify-center', textStyles.caption)} style={{ height }}>
          <div
            className="animate-spin rounded-full h-6 w-6 border-2 border-transparent mr-2"
            style={{
              borderTopColor: comprehensiveTheme.palette.splitLine,
              borderBottomColor: comprehensiveTheme.palette.premium,
            }}
          />
          <span>加载中...</span>
        </div>
      ) : (
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height, width: '100%' }}
          notMerge
          lazyUpdate
        />
      )}
    </section>
  );
};
