import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent, formatPremiumWan } from '../../../shared/utils/formatters';
import { useQuoteKpi } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading, InsightCard } from './shared';

interface Props {
  filters: QuoteFilters;
}

export function DiscountSummary({ filters }: Props) {
  const { data, isLoading } = useQuoteKpi(filters);
  const renewalRate = (data?.renewal_quotes ?? 0) > 0
    ? ((data?.renewal_insured ?? 0) / (data?.renewal_quotes ?? 0)) * 100
    : 0;
  const switchRate = (data?.switch_quotes ?? 0) > 0
    ? ((data?.switch_insured ?? 0) / (data?.switch_quotes ?? 0)) * 100
    : 0;

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading
        title="折扣快照"
        subtitle="把折扣分析与 NCD 观察放在同一个专题里，补回旧 HTML 的细节视角。"
      />
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {[...Array(3)].map((_, index) => (
            <div key={index} className={cn('h-24 rounded-lg animate-pulse', colorClasses.bg.neutral)} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <InsightCard
            title="平均折扣率"
            value={formatPercent((data?.avg_discount_rate ?? 0) * 100)}
            hint="基于折前/折后保费计算。"
          />
          <InsightCard
            title="承保保费"
            value={`${formatPremiumWan(data?.insured_premium ?? 0)}万`}
            hint={`承保件数 ${formatCount(data?.total_insured ?? 0)}`}
          />
          <InsightCard
            title="续/转承保率差"
            value={formatPercent(renewalRate - switchRate)}
            hint="帮助判断折扣与续转结构是否同步变化。"
          />
        </div>
      )}
    </div>
  );
}
