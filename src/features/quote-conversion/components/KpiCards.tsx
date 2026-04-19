import { cardStyles, fontStyles, colorClasses, numericStyles, cn } from '../../../shared/styles';
import { formatCount, formatPremiumWan } from '../../../shared/utils/formatters';
import type { QuoteKpi } from '../types';

interface Props {
  data: QuoteKpi | undefined;
  isLoading: boolean;
  variant?: 'default' | 'oldCar';
}

function computePercent(numerator: number, denominator: number): string {
  if (!denominator) return '0.0';
  return ((numerator / denominator) * 100).toFixed(1);
}

function computeRatio(left: number, right: number): string {
  if (!right) return '0.0';
  return (left / right).toFixed(1);
}

function computeAveragePremiumWan(totalPremium: number, totalCount: number): string {
  if (!totalCount) return '0.00';
  return formatPremiumWan(totalPremium / totalCount);
}

export function KpiCards({ data, isLoading, variant = 'default' }: Props) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${cardStyles.base} animate-pulse h-40 lg:col-span-2`} />
        <div className="grid grid-cols-3 lg:grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`${cardStyles.base} animate-pulse h-20`} />
          ))}
        </div>
      </div>
    );
  }

  const renewalRate = computePercent(data.renewal_insured, data.renewal_quotes);
  const switchRate = computePercent(data.switch_insured, data.switch_quotes);
  const conversionRate = data.underwriting_rate ?? 0;
  const renewalPct = parseFloat(renewalRate);
  const switchPct = parseFloat(switchRate);
  const maxBarPct = Math.max(renewalPct, switchPct, 1);

  if (variant === 'oldCar') {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={cn(cardStyles.base, 'xl:col-span-2 p-5')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className={`text-xs ${colorClasses.text.neutralMuted} mb-2`}>续转承保率</div>
              <div className={cn(numericStyles.kpiPrimary, 'mb-2')}>{conversionRate}%</div>
              <div className={`text-xs ${colorClasses.text.neutralMuted}`}>
                总报价件数 {formatCount(data.total_quotes)}，承保件数 {formatCount(data.total_insured)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 min-w-[260px]">
              <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3">
                <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>续保承保率</div>
                <div className={cn(numericStyles.kpiSecondary)}>{renewalRate}%</div>
              </div>
              <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3">
                <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>转保承保率</div>
                <div className={cn(numericStyles.kpiSecondary)}>{switchRate}%</div>
              </div>
            </div>
          </div>

          <div className="space-y-2 mt-4">
            <div className="flex items-center gap-3">
              <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>续保</span>
              <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                <div
                  className="h-full bg-primary rounded transition-all duration-500"
                  style={{ width: `${(renewalPct / maxBarPct) * 100}%` }}
                />
              </div>
              <span className={cn(fontStyles.numeric, 'text-sm font-semibold w-14 text-right')}>{renewalRate}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>转保</span>
              <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                <div
                  className="h-full bg-warning rounded transition-all duration-500"
                  style={{ width: `${(switchPct / maxBarPct) * 100}%` }}
                />
              </div>
              <span className={cn(fontStyles.numeric, 'text-sm font-semibold w-14 text-right')}>{switchRate}%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-1 gap-4">
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>续/转承保率比</div>
            <div className={cn(numericStyles.kpiSecondary)}>{computeRatio(renewalPct, switchPct)}</div>
          </div>
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>续保件均保费</div>
            <div className={cn(numericStyles.kpiSecondary)}>
              {computeAveragePremiumWan(data.renewal_insured_premium ?? 0, data.renewal_insured)}万
            </div>
          </div>
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>承保保费</div>
            <div className={cn(numericStyles.kpiSecondary)}>{formatPremiumWan(data.insured_premium)}万</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={cn(cardStyles.base, 'lg:col-span-2 p-5')}>
        <div className={`text-xs ${colorClasses.text.neutralMuted} mb-2`}>整体转化率</div>
        <div className={cn(numericStyles.kpiPrimary, 'mb-4')}>{conversionRate}%</div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>续保</span>
            <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
              <div
                className="h-full bg-primary rounded transition-all duration-500"
                style={{ width: `${(renewalPct / maxBarPct) * 100}%` }}
              />
            </div>
            <span className={cn(fontStyles.numeric, 'text-sm font-semibold w-14 text-right')}>{renewalRate}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>转保</span>
            <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
              <div
                className="h-full bg-warning rounded transition-all duration-500"
                style={{ width: `${(switchPct / maxBarPct) * 100}%` }}
              />
            </div>
            <span className={cn(fontStyles.numeric, 'text-sm font-semibold w-14 text-right')}>{switchRate}%</span>
          </div>
        </div>

        <div className={`text-xs ${colorClasses.text.neutralMuted} mt-3`}>
          {formatCount(data.salesman_count)} 位业务员参与
        </div>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-1 gap-4">
        <div className={cn(cardStyles.base, 'p-4')}>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>报价总量</div>
          <div className={cn(numericStyles.kpiSecondary)}>{formatCount(data.total_quotes)}</div>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mt-1`}>承保 {formatCount(data.total_insured)}</div>
        </div>
        <div className={cn(cardStyles.base, 'p-4')}>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>承保保费</div>
          <div className={cn(numericStyles.kpiSecondary)}>{formatPremiumWan(data.insured_premium)}万</div>
        </div>
        <div className={cn(cardStyles.base, 'p-4')}>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>平均折扣率</div>
          <div className={cn(numericStyles.kpiSecondary)}>
            {((data.avg_discount_rate ?? 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
