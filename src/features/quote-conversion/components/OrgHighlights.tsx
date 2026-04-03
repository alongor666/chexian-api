import { useMemo } from 'react';
import { colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import { useQuoteDrilldown } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading, InsightCard } from './shared';

interface Props {
  filters: QuoteFilters;
}

export function OrgHighlights({ filters }: Props) {
  const { data, isLoading } = useQuoteDrilldown(filters, 'org');

  const highlights = useMemo(() => {
    if (!data || data.length === 0) return [];

    const topByQuotes = [...data].sort((a, b) => b.total_quotes - a.total_quotes)[0];
    const topByConversion = [...data].sort((a, b) => b.conversion_rate - a.conversion_rate)[0];
    const topByRenewal = [...data].sort(
      (a, b) => (b.renewal_rate - b.switch_rate) - (a.renewal_rate - a.switch_rate)
    )[0];

    return [
      {
        title: '报价量最高机构',
        value: topByQuotes?.group_name ?? '-',
        hint: `报价 ${formatCount(topByQuotes?.total_quotes ?? 0)}，承保 ${formatCount(topByQuotes?.total_insured ?? 0)}`,
      },
      {
        title: '承保率最高机构',
        value: topByConversion?.group_name ?? '-',
        hint: `承保率 ${formatPercent(topByConversion?.conversion_rate ?? 0)}`,
      },
      {
        title: '续保优势最强机构',
        value: topByRenewal?.group_name ?? '-',
        hint: `续保率 ${formatPercent(topByRenewal?.renewal_rate ?? 0)}，转保率 ${formatPercent(topByRenewal?.switch_rate ?? 0)}`,
      },
    ];
  }, [data]);

  return (
    <div className="space-y-3">
      <SectionHeading
        title="机构快照"
        subtitle={'保留旧专题里\u201c机构量级、承保效率、续转结构\u201d三种观察方式，先用现有下钻能力做稳定落地。'}
      />
      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, index) => (
            <div key={index} className={cn('h-28 rounded-lg animate-pulse', colorClasses.bg.neutral)} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {highlights.map((item) => (
            <InsightCard key={item.title} title={item.title} value={item.value} hint={item.hint} />
          ))}
        </div>
      )}
    </div>
  );
}
