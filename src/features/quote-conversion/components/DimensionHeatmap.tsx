import { useState } from 'react';
import { cardStyles, toggleButtonStyles } from '../../../shared/styles';
import { useQuoteHeatmap } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { QuoteHeatmapMatrixTable } from './QuoteHeatmapMatrixTable';

interface Props {
  filters: QuoteFilters;
}

const DIMENSIONS = [
  { key: 'renewal_status', label: '续保/转保' },
  { key: 'insurance_grade', label: '风险等级' },
  { key: 'commercial_ncd', label: '商业险NCD' },
  { key: 'coverage_combination', label: '险别组合' },
  { key: 'customer_category', label: '客户类别' },
  { key: 'is_nev', label: '新能源' },
  { key: 'traffic_risk_grade', label: '交通评分' },
] as const;

// 热力色映射已迁移到 src/shared/styles/index.ts → getHeatmapColor()
// 矩阵构建与表格渲染收拢到 QuoteHeatmapMatrixTable（与 DimensionMatrix 共用）

export function DimensionHeatmap({ filters }: Props) {
  const [selectedDim, setSelectedDim] = useState<string>('renewal_status');
  const { data, isLoading } = useQuoteHeatmap(filters, selectedDim);

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
          title="报价承保转化率 = 承保件数 ÷ 报价件数（单据级，分母为报价单量）"
        >维度热力图 · 报价承保转化率 (%)</h3>
        <div className="flex gap-1 flex-wrap">
          {DIMENSIONS.map(d => (
            <button
              key={d.key}
              onClick={() => setSelectedDim(d.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                selectedDim === d.key ? toggleButtonStyles.active : toggleButtonStyles.inactive
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-48 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : (
        <div className="overflow-x-auto">
          <QuoteHeatmapMatrixTable data={data} />
        </div>
      )}
    </div>
  );
}
