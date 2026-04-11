/**
 * 转化漏斗 Tab — 三级漏斗 + 流失归因
 */

import { cardStyles, colorClasses, numericStyles, tableStyles, textStyles } from '../../../shared/styles';
import { formatCurrency, formatPercent } from '../../../shared/utils/formatters';
import { useRenewalV2Funnel, type RenewalV2Filters } from '../hooks/useRenewalV2';

const STAGE_LABELS: Record<string, string> = {
  renewed: '已续保',
  quoted_not_renewed: '报价未续',
  not_quoted: '未报价',
};

const STAGE_COLORS: Record<string, string> = {
  renewed: colorClasses.text.success,
  quoted_not_renewed: colorClasses.text.warning,
  not_quoted: colorClasses.text.danger,
};

interface Props {
  filters: RenewalV2Filters;
}

export function RenewalFunnelTab({ filters }: Props) {
  const { data, isLoading } = useRenewalV2Funnel(filters);

  const funnel = data?.funnel ?? [];
  const lossReason = data?.lossReason ?? [];
  const totalDue = funnel.reduce((sum: number, r: any) => sum + (r.count ?? 0), 0);

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-400">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 漏斗概览卡片 */}
      <div className="grid grid-cols-3 gap-3">
        {funnel.map((row: any) => {
          const stage = row.funnel_stage ?? '';
          const pct = totalDue > 0 ? (row.count / totalDue * 100) : 0;
          return (
            <div key={stage} className={cardStyles.compact}>
              <div className={textStyles.caption}>{STAGE_LABELS[stage] ?? stage}</div>
              <div className={`${numericStyles.kpiSecondary} ${STAGE_COLORS[stage] ?? ''}`}>
                {formatCurrency(row.count)}
              </div>
              <div className={textStyles.caption}>
                {formatPercent(pct)} | {formatCurrency(row.premium_wan)}万
              </div>
            </div>
          );
        })}
      </div>

      {/* 漏斗进度条 */}
      {totalDue > 0 && (
        <div className={cardStyles.standard}>
          <h3 className={textStyles.titleSmall}>漏斗分布</h3>
          <div className="flex h-8 rounded-lg overflow-hidden mt-3">
            {funnel.map((row: any) => {
              const pct = row.count / totalDue * 100;
              const bg = row.funnel_stage === 'renewed' ? 'bg-success'
                : row.funnel_stage === 'quoted_not_renewed' ? 'bg-warning'
                : 'bg-danger';
              return (
                <div
                  key={row.funnel_stage}
                  className={`${bg} flex items-center justify-center text-xs text-white font-medium`}
                  style={{ width: `${pct}%` }}
                  title={`${STAGE_LABELS[row.funnel_stage] ?? ''}: ${formatPercent(pct)}`}
                >
                  {pct >= 8 ? formatPercent(pct) : ''}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 流失归因 */}
      {lossReason.length > 0 && (
        <div className={cardStyles.standard}>
          <h3 className={textStyles.titleSmall}>流失归因（按机构）</h3>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableStyles.header}>
                  <th className={`${tableStyles.headerCell} text-left`}>机构</th>
                  <th className={`${tableStyles.headerCell} text-right`}>应续</th>
                  <th className={`${tableStyles.headerCell} text-right`}>未报价</th>
                  <th className={`${tableStyles.headerCell} text-right`}>报价未续</th>
                  <th className={`${tableStyles.headerCell} text-right`}>已续保</th>
                  <th className={`${tableStyles.headerCell} text-right`}>续保率(%)</th>
                </tr>
              </thead>
              <tbody>
                {lossReason.map((row: any) => (
                  <tr key={row.group_name} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.group_name ?? '-'}</td>
                    <td className={tableStyles.cellNumeric}>{formatCurrency(row.due_count)}</td>
                    <td className={`${tableStyles.cellNumeric} ${colorClasses.text.danger}`}>
                      {formatCurrency(row.not_quoted_count)}
                    </td>
                    <td className={`${tableStyles.cellNumeric} ${colorClasses.text.warning}`}>
                      {formatCurrency(row.quoted_not_renewed_count)}
                    </td>
                    <td className={`${tableStyles.cellNumeric} ${colorClasses.text.success}`}>
                      {formatCurrency(row.renewed_count)}
                    </td>
                    <td className={tableStyles.cellNumeric}>{row.renewal_rate ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
