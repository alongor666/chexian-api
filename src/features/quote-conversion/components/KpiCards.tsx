import { cardStyles, fontStyles, colorClasses, numericStyles, cn } from '../../../shared/styles';
import { formatCount, formatPremiumWan } from '../../../shared/utils/formatters';
import type { QuoteKpi } from '../types';

interface Props {
  data: QuoteKpi | undefined;
  isLoading: boolean;
}

export function KpiCards({ data, isLoading }: Props) {
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

  const renewalRate = data.renewal_quotes > 0
    ? (data.renewal_insured / data.renewal_quotes * 100).toFixed(1)
    : '0';
  const switchRate = data.switch_quotes > 0
    ? (data.switch_insured / data.switch_quotes * 100).toFixed(1)
    : '0';

  const conversionRate = data.conversion_rate ?? 0;
  const renewalPct = parseFloat(renewalRate);
  const switchPct = parseFloat(switchRate);
  const maxBarPct = Math.max(renewalPct, switchPct, 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Hero 大卡 — 转化率 */}
      <div className={cn(cardStyles.base, 'lg:col-span-2 p-5')}>
        <div className={`text-xs ${colorClasses.text.neutralMuted} mb-2`}>整体转化率</div>
        <div className={cn(numericStyles.kpiPrimary, 'text-4xl mb-4')}>
          {conversionRate}%
        </div>

        {/* 续保 vs 转保对比条 */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>续保</span>
            <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
              <div
                className="h-full bg-primary rounded transition-all duration-500"
                style={{ width: `${(renewalPct / maxBarPct) * 100}%` }}
              />
            </div>
            <span className={cn(fontStyles.tabular, 'text-sm font-semibold w-14 text-right')}>
              {renewalRate}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs w-8 ${colorClasses.text.neutralMuted}`}>转保</span>
            <div className="flex-1 h-5 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
              <div
                className="h-full bg-warning rounded transition-all duration-500"
                style={{ width: `${(switchPct / maxBarPct) * 100}%` }}
              />
            </div>
            <span className={cn(fontStyles.tabular, 'text-sm font-semibold w-14 text-right')}>
              {switchRate}%
            </span>
          </div>
        </div>

        <div className={`text-xs ${colorClasses.text.neutralMuted} mt-3`}>
          {formatCount(data.salesman_count)} 位业务员参与
        </div>
      </div>

      {/* 辅助 KPI 小卡 */}
      <div className="grid grid-cols-3 lg:grid-cols-1 gap-4">
        <div className={cn(cardStyles.base, 'p-4')}>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>报价总量</div>
          <div className={cn(numericStyles.kpiSecondary)}>{formatCount(data.total_quotes)}</div>
          <div className={`text-xs ${colorClasses.text.neutralMuted} mt-1`}>
            承保 {formatCount(data.total_insured)}
          </div>
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
