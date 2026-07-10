import { useState } from 'react';
import { cardStyles, colorClasses, fontStyles, toggleButtonStyles, cn } from '../../../shared/styles';
import { formatPercent } from '../../../shared/utils/formatters';
import { useQuoteHeatmap, useQuoteRanking } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { QuoteHeatmapMatrixTable } from './QuoteHeatmapMatrixTable';

interface Props {
  filters: QuoteFilters;
}

/** 全部 10 个维度，前 5 直接显示，后 5 在「更多」中 */
const ALL_DIMENSIONS = [
  { key: 'renewal_status', label: '续保/转保' },
  { key: 'insurance_grade', label: '风险等级' },
  { key: 'commercial_ncd', label: '商业险NCD' },
  { key: 'customer_category', label: '客户类别' },
  { key: 'traffic_risk_grade', label: '交通评分' },
  // ── 更多 ──
  { key: 'coverage_combination', label: '险别组合' },
  { key: 'is_nev', label: '新能源' },
  { key: 'is_telemarketing', label: '电销' },
  { key: 'is_transfer', label: '过户车' },
  { key: 'tonnage_segment', label: '货车吨位' },
] as const;

const PRIMARY_COUNT = 5;

export function DimensionMatrix({ filters }: Props) {
  const [selectedDim, setSelectedDim] = useState<string>('renewal_status');
  const [showMore, setShowMore] = useState(false);
  const { data: heatData, isLoading: heatLoading } = useQuoteHeatmap(filters, selectedDim);
  const { data: rankData, isLoading: rankLoading } = useQuoteRanking(filters, selectedDim);

  const visibleDims = showMore ? ALL_DIMENSIONS : ALL_DIMENSIONS.slice(0, PRIMARY_COUNT);

  const isLoading = heatLoading || rankLoading;

  return (
    <div className={cardStyles.base}>
      {/* 维度选择器 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
          title="报价承保转化率 = 承保件数 ÷ 报价件数（单据级，分母为报价单量）"
        >维度矩阵 · 报价承保转化率 (%)</h3>
        <div className="flex gap-1 flex-wrap items-center">
          {visibleDims.map(d => (
            <button
              key={d.key}
              onClick={() => setSelectedDim(d.key)}
              className={cn(
                'px-2 py-1 text-xs rounded-md transition-colors',
                selectedDim === d.key ? toggleButtonStyles.active : toggleButtonStyles.inactive,
              )}
            >
              {d.label}
            </button>
          ))}
          {ALL_DIMENSIONS.length > PRIMARY_COUNT && (
            <button
              onClick={() => setShowMore(p => !p)}
              className={cn(
                'px-2 py-1 text-xs rounded-md transition-colors',
                colorClasses.text.primary,
                'hover:bg-primary-bg dark:hover:bg-primary-900/20',
              )}
            >
              {showMore ? '收起' : `更多 (${ALL_DIMENSIONS.length - PRIMARY_COUNT})`}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-48 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* 左侧：热力矩阵 (70%) */}
          <div className="flex-[7] min-w-0 overflow-x-auto">
            <QuoteHeatmapMatrixTable data={heatData} />
          </div>

          {/* 右侧：排行快照 (30%) */}
          <div className="flex-[3] min-w-[180px] border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-neutral-700 pt-4 lg:pt-0 lg:pl-4">
            <div className={cn('text-xs font-medium mb-2', colorClasses.text.neutralMuted)}>
              转化率排行
            </div>
            <div className="space-y-2">
              {(rankData ?? []).slice(0, 8).map((row, i) => {
                const maxRate = Math.max(...(rankData ?? []).map(r => r.underwriting_rate), 1);
                const barPct = (row.underwriting_rate / maxRate) * 100;
                return (
                  <div key={row.dim_value ?? i}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-neutral-700 dark:text-neutral-300 truncate mr-2">
                        {row.dim_value ?? '-'}
                      </span>
                      <span className={cn(fontStyles.numeric, 'font-semibold shrink-0')}>
                        {formatPercent(row.underwriting_rate)}
                      </span>
                    </div>
                    <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-primary rounded transition-all duration-300"
                        style={{ width: `${Math.max(barPct, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {(!rankData || rankData.length === 0) && (
                <div className={cn('text-xs py-4 text-center', colorClasses.text.neutralMuted)}>暂无数据</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
