import { memo } from 'react';
import { SalesmanRankingTable } from '../../../widgets/tables/SalesmanRankingTable';
import type { SalesmanSummaryRow } from '../types';
import { cardStyles, textStyles, cn } from '../../../shared/styles';

interface TableSectionProps {
  allBusinessData: SalesmanSummaryRow[];
  qualityBusinessData: SalesmanSummaryRow[];
  loading: boolean;
  isInitialized: boolean;
  onExportAll: (format: 'csv' | 'excel') => void;
  onExportQuality: (format: 'csv' | 'excel') => void;
}

/**
 * 业务员明细表格区域组件
 *
 * 显示：
 * - 业务员明细 Top 100 数据表格
 * - 数据导出功能（CSV/Excel）
 */
export const TableSection = memo<TableSectionProps>(function TableSection({
  allBusinessData,
  qualityBusinessData,
  loading,
  isInitialized,
  onExportAll,
  onExportQuality,
}) {
  if (!isInitialized) {
    return (
      <div className={cn(cardStyles.spacious, textStyles.body, "text-center")}>
        <p className="text-lg">请先上传数据文件以查看业务员明细表</p>
      </div>
    );
  }

  const renderExportButtons = (onExport: (format: 'csv' | 'excel') => void, disabled: boolean) => (
    <>
      <button
        onClick={() => onExport('csv')}
        disabled={disabled}
        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-neutral-300 disabled:cursor-not-allowed"
      >
        导出 CSV
      </button>
      <button
        onClick={() => onExport('excel')}
        disabled={disabled}
        className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:bg-neutral-300 disabled:cursor-not-allowed"
      >
        导出 Excel
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SalesmanRankingTable
          title="全部业务 Top10"
          premiumLabel="总保费"
          data={allBusinessData}
          loading={loading}
          actions={renderExportButtons(onExportAll, allBusinessData.length === 0)}
        />
        <SalesmanRankingTable
          title="优质业务 Top10"
          premiumLabel="优质保费"
          data={qualityBusinessData}
          loading={loading}
          actions={renderExportButtons(onExportQuality, qualityBusinessData.length === 0)}
        />
      </div>
    </div>
  );
});
