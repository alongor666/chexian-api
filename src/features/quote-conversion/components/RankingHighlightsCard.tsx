import { useMemo } from 'react';
import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import { useQuoteRanking } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading } from './shared';

interface Props {
  title: string;
  subtitle: string;
  filters: QuoteFilters;
  dimension: string;
}

export function RankingHighlightsCard({ title, subtitle, filters, dimension }: Props) {
  const { data, isLoading } = useQuoteRanking(filters, dimension);
  const rows = useMemo(() => (data ?? []).slice(0, 5), [data]);

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading title={title} subtitle={subtitle} />
      {isLoading ? (
        <div className="space-y-2 mt-4">
          {[...Array(5)].map((_, index) => (
            <div key={index} className={cn('h-10 rounded animate-pulse', colorClasses.bg.neutral)} />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="space-y-3 mt-4">
          {rows.map((row) => (
            <div key={`${dimension}-${row.dim_value}`} className={cn('rounded-lg p-3 border', colorClasses.border.neutral)}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {row.dim_value ?? '-'}
                </div>
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatPercent(row.conversion_rate)}
                </div>
              </div>
              <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>
                报价 {formatCount(row.total_quotes)}，承保 {formatCount(row.total_insured)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cn('text-sm py-8 text-center', colorClasses.text.neutralMuted)}>暂无维度排行数据</div>
      )}
    </div>
  );
}
