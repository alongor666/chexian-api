/**
 * 续保总览 Tab — KPI 卡片 + 月度走势 + 机构排名
 */

import { useMemo, useCallback } from 'react';
import { cn, cardStyles, colorClasses, numericStyles, tableStyles, textStyles, getTrendColorClass } from '../../../shared/styles';
import { formatCount, formatCurrency, formatPercent } from '../../../shared/utils/formatters';
import { useRenewalV2Overview, useRenewalV2Trend, type RenewalV2Filters } from '../hooks/useRenewalV2';
import { useRegisterExport } from '../../../shared/export/ExportContext';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../../shared/utils/export';

interface Props {
  filters: RenewalV2Filters;
  /** 行点击下钻回调（传入 group_name） */
  onDrill?: (groupName: string) => void;
  /** 当前分组维度中文标签 */
  groupByLabel?: string;
}

export function RenewalOverviewTab({ filters, onDrill, groupByLabel = '机构' }: Props) {
  const { data: overviewData, isLoading: loadingOverview } = useRenewalV2Overview(filters);
  const { data: trendData, isLoading: loadingTrend } = useRenewalV2Trend(filters);

  const total = overviewData?.total;
  const grouped = overviewData?.grouped ?? [];

  const kpiCards = useMemo(() => {
    if (!total) return [];
    return [
      { label: '应续', value: formatCount(total.due_count), sub: `${formatCurrency(total.due_premium_wan)}万` },
      { label: '已续保', value: formatCount(total.renewed_count), sub: `续保率 ${total.renewal_rate ?? 0}%`, color: colorClasses.text.success },
      { label: '已报价', value: formatCount(total.quoted_count), sub: `覆盖率 ${total.quote_coverage_rate ?? 0}%`, color: colorClasses.text.primary },
      { label: '未报价', value: formatCount(total.not_quoted_count), sub: `${formatPercent((total.not_quoted_count ?? 0) / (total.due_count || 1) * 100)}`, color: colorClasses.text.danger },
    ];
  }, [total]);

  // ── 注册导出处理器 ──
  const handleExport = useCallback((format: 'csv' | 'xlsx') => {
    const rows = grouped.map((row: any) => ({
      机构: row.group_name ?? '-',
      应续件数: row.due_count ?? 0,
      已续保件数: row.renewed_count ?? 0,
      '续保率(%)': row.renewal_rate ?? 0,
      '报价覆盖率(%)': row.quote_coverage_rate ?? 0,
      '报价转化率(%)': row.quote_to_renewal_rate ?? 0,
      'P1+P2件数': (row.p1_count ?? 0) + (row.p2_count ?? 0),
    }));

    if (rows.length === 0) {
      alert('暂无数据可导出');
      return;
    }

    const ts = getTimestampForFilename();
    const filename = `续保总览_${ts}`;

    if (format === 'xlsx') {
      void exportToExcel(rows, filename, '续保总览');
    } else {
      exportArrayToCSV(rows, `${filename}.csv`);
    }
  }, [grouped]);

  useRegisterExport('续保总览', handleExport);

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
                    <td className={`${tableStyles.cellNumeric}`}>{formatCount(row.due_count)}</td>
                    <td className={`${tableStyles.cellNumeric}`}>{formatCount(row.renewed_count)}</td>
                    <td className={`${tableStyles.cellNumeric}`}>{formatCount(row.quoted_count)}</td>
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

      {/* 维度排名 */}
      {grouped.length > 0 && (
        <div className={cardStyles.standard}>
          <h3 className={textStyles.titleSmall}>按{groupByLabel}排名</h3>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableStyles.header}>
                  <th className={`${tableStyles.headerCell} text-left`}>{groupByLabel}</th>
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
                  <tr
                    key={row.group_name}
                    className={cn(
                      'border-b border-neutral-100',
                      onDrill && 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors',
                    )}
                    onClick={() => onDrill && row.group_name && onDrill(String(row.group_name))}
                  >
                    <td className={cn(tableStyles.cell, onDrill && colorClasses.text.primary)}>
                      {row.group_name ?? '-'}
                    </td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.due_count)}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.renewed_count)}</td>
                    <td className={`${tableStyles.cellNumeric} ${getTrendColorClass((row.renewal_rate ?? 0) - 50)}`}>
                      {row.renewal_rate ?? '-'}
                    </td>
                    <td className={tableStyles.cellNumeric}>{row.quote_coverage_rate ?? '-'}</td>
                    <td className={tableStyles.cellNumeric}>{row.quote_to_renewal_rate ?? '-'}</td>
                    <td className={`${tableStyles.cellNumeric} ${colorClasses.text.danger}`}>
                      {formatCount((row.p1_count ?? 0) + (row.p2_count ?? 0))}
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
