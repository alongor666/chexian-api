import { useMemo } from 'react';
import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import { useQuoteTrend } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading } from './shared';

interface Props {
  filters: QuoteFilters;
}

export function MonthlyTrendSnapshot({ filters }: Props) {
  const { data, isLoading } = useQuoteTrend(filters, 'month');

  const rows = useMemo(() => {
    if (!data || data.length === 0) return [];

    const bucketMap = new Map<string, {
      quotes: number;
      insured: number;
      renewalRate: number;
      switchRate: number;
    }>();

    for (const row of data) {
      const existing = bucketMap.get(row.time_bucket) ?? {
        quotes: 0,
        insured: 0,
        renewalRate: 0,
        switchRate: 0,
      };
      const updated = {
        quotes: existing.quotes + (row.total_quotes ?? 0),
        insured: existing.insured + (row.total_insured ?? 0),
        renewalRate: row.renewal_type === '续保' ? (row.underwriting_rate ?? 0) : existing.renewalRate,
        switchRate: row.renewal_type === '转保' ? (row.underwriting_rate ?? 0) : existing.switchRate,
      };
      bucketMap.set(row.time_bucket, updated);
    }

    return Array.from(bucketMap.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 6)
      .map(([timeBucket, value]) => ({
        timeBucket,
        ...value,
        conversionRate: value.quotes > 0 ? (value.insured / value.quotes) * 100 : 0,
      }));
  }, [data]);

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading
        title="月度趋势快照"
        subtitle="按月回看报价量、整体承保率，以及续保/转保两条线的近 6 期表现。"
      />
      {isLoading ? (
        <div className="space-y-2 mt-4">
          {[...Array(6)].map((_, index) => (
            <div key={index} className={cn('h-9 rounded animate-pulse', colorClasses.bg.neutral)} />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs">
            <thead>
              <tr className={cn('border-b', colorClasses.border.neutral)}>
                <th className={`text-left py-2 font-medium ${colorClasses.text.neutralLight}`}>月份</th>
                <th className={`text-right py-2 font-medium ${colorClasses.text.neutralLight}`}>报价量</th>
                <th className={`text-right py-2 font-medium ${colorClasses.text.neutralLight}`}>整体承保率</th>
                <th className={`text-right py-2 font-medium ${colorClasses.text.neutralLight}`}>续保率</th>
                <th className={`text-right py-2 font-medium ${colorClasses.text.neutralLight}`}>转保率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.timeBucket} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 text-neutral-900 dark:text-neutral-100">{row.timeBucket}</td>
                  <td className={`py-2 text-right ${colorClasses.text.neutralDark}`}>{formatCount(row.quotes)}</td>
                  <td className={`py-2 text-right ${colorClasses.text.neutralDark}`}>{formatPercent(row.conversionRate)}</td>
                  <td className={`py-2 text-right ${colorClasses.text.neutralDark}`}>{formatPercent(row.renewalRate)}</td>
                  <td className={`py-2 text-right ${colorClasses.text.neutralDark}`}>{formatPercent(row.switchRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={cn('text-sm py-8 text-center', colorClasses.text.neutralMuted)}>暂无月度趋势数据</div>
      )}
    </div>
  );
}
