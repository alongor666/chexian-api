import { useMemo } from 'react';
import { cardStyles, colorClasses, fontStyles, funnelLevelColors, cn } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import type { FunnelRow } from '../types';

interface Props {
  data: FunnelRow[] | undefined;
  isLoading: boolean;
}

const LEVELS = ['l1_total', 'l2_valid', 'l3_quality', 'l4_insured'] as const;
const LEVEL_LABELS = ['报价总量', '有效报价', '优质报价', '承保'] as const;

/** 单列垂直瀑布漏斗 */
function FunnelWaterfall({ title, row }: { title: string; row: FunnelRow }) {
  const max = row.l1_total || 1;

  return (
    <div className="flex-1 min-w-0">
      <h4 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3 text-center">{title}</h4>
      <div className="space-y-1">
        {LEVELS.map((key, i) => {
          const val = (row[key] as number) ?? 0;
          const pct = max > 0 ? (val / max * 100) : 0;
          const prevVal = i > 0 ? ((row[LEVELS[i - 1]] as number) ?? 0) : val;
          const passRate = prevVal > 0 ? (val / prevVal * 100).toFixed(1) : '0';
          const lossCount = i > 0 ? prevVal - val : 0;

          return (
            <div key={key}>
              {/* 漏损标注 */}
              {i > 0 && (
                <div className="flex items-center justify-center gap-1 py-0.5">
                  <div className="w-px h-3 bg-neutral-300 dark:bg-neutral-600" />
                  <span className={cn('text-[10px]', colorClasses.text.neutralMuted)}>
                    ↓ {passRate}% 通过 · 流失 {formatCount(lossCount)}
                  </span>
                  <div className="w-px h-3 bg-neutral-300 dark:bg-neutral-600" />
                </div>
              )}

              {/* 漏斗层 */}
              <div className="relative">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={colorClasses.text.neutralMuted}>
                    {LEVEL_LABELS[i]}
                    <span className="ml-1 opacity-60">(%)</span>
                  </span>
                  <span className={fontStyles.numeric}>
                    {formatCount(val)}
                    <span className={cn('ml-1', colorClasses.text.neutralMuted)}>
                      ({pct.toFixed(1)})
                    </span>
                  </span>
                </div>
                <div className="h-6 bg-neutral-100 dark:bg-neutral-800 rounded-md overflow-hidden">
                  <div
                    className={cn('h-full rounded-md transition-all duration-500', funnelLevelColors[i])}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 总转化率 */}
      <div
        className="mt-3 text-center"
        title="报价承保转化率 = 承保件数 ÷ 报价总量（单据级，分母为报价单量；区别于「商业险续保追踪」页以应续件数为分母的报价率）"
      >
        <span className={cn('text-lg font-bold', colorClasses.text.primary)}>
          {max > 0 ? ((row.l4_insured ?? 0) / max * 100).toFixed(1) : '0'}
        </span>
        <span className={cn('text-xs ml-1', colorClasses.text.neutralMuted)}>总转化率 (%)</span>
      </div>
    </div>
  );
}

export function ConversionFunnel({ data, isLoading }: Props) {
  const { renewalRow, switchRow } = useMemo(() => {
    if (!data) return { renewalRow: null, switchRow: null };
    return {
      renewalRow: data.find(r => r.renewal_type === '续保') ?? null,
      switchRow: data.find(r => r.renewal_type === '转保') ?? null,
    };
  }, [data]);

  if (isLoading) {
    return <div className={cn(cardStyles.base, 'animate-pulse h-80')} />;
  }

  return (
    <div className={cn(cardStyles.base, 'min-h-[280px] max-h-[480px] overflow-y-auto')}>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-4">转化漏斗</h3>
      {!renewalRow && !switchRow ? (
        <div className={cn('h-40 flex items-center justify-center', colorClasses.text.neutralMuted, 'text-sm')}>
          暂无漏斗数据
        </div>
      ) : (
        <div className="flex gap-6">
          {renewalRow && <FunnelWaterfall title="续保" row={renewalRow} />}
          <div className="w-px bg-neutral-200 dark:bg-neutral-700 self-stretch shrink-0" />
          {switchRow && <FunnelWaterfall title="转保" row={switchRow} />}
        </div>
      )}
    </div>
  );
}
