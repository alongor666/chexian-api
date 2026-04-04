import { useState, useMemo } from 'react';
import { cardStyles, colorClasses, fontStyles, getHeatmapColor, toggleButtonStyles, cn } from '../../../shared/styles';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import { useQuoteHeatmap, useQuoteRanking } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
}

/** 全部 10 个维度，前 5 直接显示，后 5 在「更多」中 */
const ALL_DIMENSIONS = [
  { key: 'renewal_status', label: '续保/转保' },
  { key: 'insurance_grade', label: '风险等级' },
  { key: 'ncd_coefficient', label: 'NCD系数' },
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

  // 热力矩阵数据
  const { orgs, dimValues, matrix } = useMemo(() => {
    if (!heatData) return { orgs: [], dimValues: [], matrix: new Map<string, { rate: number; count: number }>() };
    const orgSet = new Set<string>();
    const dimSet = new Set<string>();
    const m = new Map<string, { rate: number; count: number }>();
    for (const row of heatData) {
      const org = row.org ?? '';
      const dim = String(row.dim_value ?? '');
      orgSet.add(org);
      dimSet.add(dim);
      m.set(`${org}|${dim}`, { rate: row.conversion_rate ?? 0, count: row.total_quotes ?? 0 });
    }
    return { orgs: Array.from(orgSet).sort(), dimValues: Array.from(dimSet).sort(), matrix: m };
  }, [heatData]);

  const isLoading = heatLoading || rankLoading;

  return (
    <div className={cardStyles.base}>
      {/* 维度选择器 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">维度矩阵</h3>
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
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left p-2 font-medium text-neutral-500">机构</th>
                  {dimValues.map(v => (
                    <th key={v} className="text-center p-2 font-medium text-neutral-500 whitespace-nowrap">{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.map(org => (
                  <tr key={org}>
                    <td className="p-2 font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{org}</td>
                    {dimValues.map(dim => {
                      const cell = matrix.get(`${org}|${dim}`);
                      if (!cell) return <td key={dim} className="p-2 text-center text-neutral-300">-</td>;
                      return (
                        <td key={dim} className="p-1">
                          <div className={cn('rounded-md p-2 text-center', getHeatmapColor(cell.rate))}>
                            <div className={cn('font-semibold', fontStyles.numeric)}>{cell.rate}%</div>
                            <div className="text-[10px] opacity-75">{formatCount(cell.count)}</div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 右侧：排行快照 (30%) */}
          <div className="flex-[3] min-w-[180px] border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-neutral-700 pt-4 lg:pt-0 lg:pl-4">
            <div className={cn('text-xs font-medium mb-2', colorClasses.text.neutralMuted)}>
              转化率排行
            </div>
            <div className="space-y-2">
              {(rankData ?? []).slice(0, 8).map((row, i) => {
                const maxRate = Math.max(...(rankData ?? []).map(r => r.conversion_rate), 1);
                const barPct = (row.conversion_rate / maxRate) * 100;
                return (
                  <div key={row.dim_value ?? i}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-neutral-700 dark:text-neutral-300 truncate mr-2">
                        {row.dim_value ?? '-'}
                      </span>
                      <span className={cn(fontStyles.numeric, 'font-semibold shrink-0')}>
                        {formatPercent(row.conversion_rate)}
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
