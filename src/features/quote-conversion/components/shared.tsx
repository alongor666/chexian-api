import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import type { QuoteFilters } from '../types';

export function mergeFilters(filters: QuoteFilters, overrides: Partial<QuoteFilters>): QuoteFilters {
  return { ...filters, ...overrides };
}

export function computeAveragePremiumWan(totalPremium: number | undefined, totalInsured: number | undefined): string {
  if (!totalPremium || !totalInsured) return '0.00';
  return (totalPremium / totalInsured / 10000).toFixed(2);
}

export function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <p className={`text-xs ${colorClasses.text.neutralMuted}`}>{subtitle}</p>
    </div>
  );
}

export function InsightCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className={cn(cardStyles.base, 'p-4')}>
      <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>{title}</div>
      <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>{hint}</div>
    </div>
  );
}
