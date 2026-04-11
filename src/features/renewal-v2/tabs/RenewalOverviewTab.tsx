/**
 * 续保总览 Tab — KPI 卡片 + 月度走势 + 机构排名
 */

import { useMemo } from 'react';
import { cardStyles, colorClasses, numericStyles, tableStyles, textStyles, getTrendColorClass } from '../../../shared/styles';
import { formatCurrency, formatPercent } from '../../../shared/utils/formatters';
import { useRenewalV2Overview, useRenewalV2Trend, type RenewalV2Filters } from '../hooks/useRenewalV2';

interface Props {
  filters: RenewalV2Filters;
}

export function RenewalOverviewTab({ filters }: Props) {
  const { data: overviewData, isLoading: loadingOverview } = useRenewalV2Overview(filters);
  const { data: trendData, isLoading: loadingTrend } = useRenewalV2Trend(filters);

  const total = overviewData?.total;
  const grouped = overviewData?.grouped ?? [];

  const kpiCards = useMemo(() => {
    if (!total) return [];
    return [
      { label: '应续', value: formatCurrency(total.due_count), sub: `${formatCurrency(total.due_premium_wan)}万` },
      { label: '已续保', value: formatCurrency(total.renewed_count), sub: `续保率 ${total.renewal_rate ?? 0}%`, color: colorClasses.text.success },
      { label: '已报价', value: formatCurrency(total.quoted_count), sub: `覆盖率 ${total.quote_coverage_rate ?? 0}%`, color: colorClasses.text.primary },
      { label: '未报价', value: formatCurrency(total.not_quoted_count), sub: `${formatPercent((total.not_quoted_count ?? 0) / (total.due_count || 1) * 100)}`, color: colorClasses.text.danger },
    ];
  }, [total]);

  if (loadingOverview && loadingTrend) {
    return <div className="p-8 text-center text-neutral-400">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className={cardStyles.compact}>
            <div className={textStyles.caption}>{kpi.label}</div>
            <div className={`${numericStyles.kpiSecondary} ${kpi.color ?? ''}`}>{kpi.value}</div>
            <div className={`${textStyles.caption} mt-1`}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* 月度到期走势 */}
      {trendData && trendData.length > 0 && (
        <div className={cardStyles.standard}>
          <h3 className={textStyles.titleSmall}>月度到期走势</h3>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableStyles.header}>
                  <th className={`${tableStyles.headerCell} text-left`}>到期月</th>
                  <th className={`${tableStyles.headerCell} text-right`}>应续</th>
                  <th className={`${tableStyles.headerCell} text-right`}>已续保</th>
                  <th className={`${tableStyles.headerCell} text-right`}>已报价</th>
                  <th className={`${tableStyles.headerCell} text-right`}>续保率(%)</th>
                  <th className={`${tableStyles.headerCell} text-right`}>报价覆盖率(%)</th>
                </tr>
              </thead>
              <tbody>
                {(trendData as any[]).map((row: any) => (
                  <tr key={row.expiry_month} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.expiry_month}月</td>
                    <td className={`${tableStyles.cellNumeric}`}>{formatCurrency(row.due_count)}</td>
                    <td className={`${tableStyles.cellNumeric}`}>{formatCurrency(row.renewed_count)}</td>
                    <td className={`${tableStyles.cellNumeric}`}>{formatCurrency(row.quoted_count)}</td>
                    <td className={`${tableStyles.cellNumeric} ${getTrendColorClass(row.renewal_rate - 50)}`}>
                      {row.renewal_rate ?? '-'}
                    </td>
                    <td className={`${tableStyles.cellNumeric}`}>{row.quote_coverage_rate ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 机构排名 */}
      {grouped.length > 0 && (
        <div className={cardStyles.standard}>
          <h3 className={textStyles.titleSmall}>机构排名</h3>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableStyles.header}>
                  <th className={`${tableStyles.headerCell} text-left`}>机构</th>
                  <th className={`${tableStyles.headerCell} text-right`}>应续</th>
                  <th className={`${tableStyles.headerCell} text-right`}>已续保</th>
                  <th className={`${tableStyles.headerCell} text-right`}>续保率(%)</th>
                  <th className={`${tableStyles.headerCell} text-right`}>报价覆盖(%)</th>
                  <th className={`${tableStyles.headerCell} text-right`}>报价转化(%)</th>
                  <th className={`${tableStyles.headerCell} text-right`}>P1+P2</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((row: any) => (
                  <tr key={row.group_name} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.group_name ?? '-'}</td>
                    <td className={tableStyles.cellNumeric}>{formatCurrency(row.due_count)}</td>
                    <td className={tableStyles.cellNumeric}>{formatCurrency(row.renewed_count)}</td>
                    <td className={`${tableStyles.cellNumeric} ${getTrendColorClass((row.renewal_rate ?? 0) - 50)}`}>
                      {row.renewal_rate ?? '-'}
                    </td>
                    <td className={tableStyles.cellNumeric}>{row.quote_coverage_rate ?? '-'}</td>
                    <td className={tableStyles.cellNumeric}>{row.quote_to_renewal_rate ?? '-'}</td>
                    <td className={`${tableStyles.cellNumeric} ${colorClasses.text.danger}`}>
                      {formatCurrency((row.p1_count ?? 0) + (row.p2_count ?? 0))}
                    </td>
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
