import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent, formatPremiumWan } from '../../../shared/utils/formatters';
import { useQuoteKpi } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading, mergeFilters, computeAveragePremiumWan } from './shared';

interface Props {
  filters: QuoteFilters;
  title?: string;
  subtitle?: string;
}

export function RenewalSwitchSummary({
  filters,
  title = '续保 vs 转保 概览',
  subtitle = '对照查看报价量、承保量、承保率与件均保费。',
}: Props) {
  const renewal = useQuoteKpi(mergeFilters(filters, { renewalType: '续保' }));
  const switched = useQuoteKpi(mergeFilters(filters, { renewalType: '转保' }));
  const isLoading = renewal.isLoading || switched.isLoading;

  return (
    <div className={cn(cardStyles.base, 'p-5 space-y-4')}>
      <SectionHeading title={title} subtitle={subtitle} />
      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className={cn('h-36 rounded-lg animate-pulse', colorClasses.bg.neutral)} />
          <div className={cn('h-36 rounded-lg animate-pulse', colorClasses.bg.neutral)} />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[
            { label: '续保', data: renewal.data, tone: cn(colorClasses.bg.primary) },
            { label: '转保', data: switched.data, tone: cn(colorClasses.bg.warning) },
          ].map((item) => {
            const data = item.data;
            const conversionRate = data?.conversion_rate ?? 0;
            const totalQuotes = data?.total_quotes ?? 0;
            const totalInsured = data?.total_insured ?? 0;
            const insuredPremium = data?.insured_premium ?? 0;

            return (
              <div key={item.label} className={cn('rounded-xl p-4', colorClasses.border.neutral, 'border', item.tone)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.label}</div>
                    <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>
                      报价 {formatCount(totalQuotes)}，承保 {formatCount(totalInsured)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatPercent(conversionRate)}
                    </div>
                    <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>承保率</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 p-3">
                    <div className={`text-xs ${colorClasses.text.neutralMuted}`}>承保保费</div>
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatPremiumWan(insuredPremium)}万
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 p-3">
                    <div className={`text-xs ${colorClasses.text.neutralMuted}`}>件均保费</div>
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {computeAveragePremiumWan(insuredPremium, totalInsured)}万
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
