import { memo } from 'react';
import { RoseChart } from '../../../widgets/charts/RoseChart';
import type { RoseChartDatum } from '../types';
import { cardStyles, textStyles, cn } from '../../../shared/styles';

interface RoseChartsSectionProps {
  customerCategoryData: RoseChartDatum[];
  coverageCombinationData: RoseChartDatum[];
  terminalSourceData: RoseChartDatum[];
  isInitialized: boolean;
  loading: {
    customerCategory: boolean;
    coverageCombination: boolean;
    terminalSource: boolean;
  };
}

/**
 * 玫瑰图分析区域组件
 *
 * 显示：
 * - 客户类别占比
 * - 险别组合占比
 * - 终端来源占比
 */
export const RoseChartsSection = memo<RoseChartsSectionProps>(function RoseChartsSection({
  customerCategoryData,
  coverageCombinationData,
  terminalSourceData,
  isInitialized,
  loading,
}) {
  if (!isInitialized) {
    return (
      <div className={cn(cardStyles.spacious, textStyles.body, "text-center")}>
        <p className="text-lg">请先上传数据文件以查看占比分析</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">占比分析</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RoseChart
          title="客户类别占比"
          data={customerCategoryData}
          loading={loading.customerCategory}
        />
        <RoseChart
          title="险别组合占比"
          data={coverageCombinationData}
          loading={loading.coverageCombination}
        />
        <RoseChart
          title="终端来源占比"
          data={terminalSourceData}
          loading={loading.terminalSource}
          showValueLabel={false}
        />
      </div>
    </div>
  );
});
