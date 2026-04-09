import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { cardStyles, textStyles, colorClasses, tableStyles } from '@/shared/styles';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { cn } from '@/shared/styles';

interface FlowSummary {
  total_policies: number;
  inflow_count: number;
  outflow_count: number;
  self_renewal_count: number;
  has_previous: number;
  has_next: number;
}

interface FlowRow {
  insurer: string;
  policy_count: number;
  share_pct: number;
}

interface FlowTrend {
  month: string;
  total_policies: number;
  inflow_count: number;
  outflow_count: number;
}

export const CustomerFlowPage: React.FC = () => {
  const [year, setYear] = useState<string>('');
  const params = useMemo((): Record<string, string> | undefined => year ? { year } : undefined, [year]);

  const { data: summary } = useQuery({
    queryKey: ['customer-flow-summary', params],
    queryFn: () => apiClient.getCustomerFlowSummary(params) as Promise<FlowSummary>,
  });
  const { data: inflow } = useQuery({
    queryKey: ['customer-flow-inflow', params],
    queryFn: () => apiClient.getCustomerFlowInflow(params) as Promise<FlowRow[]>,
  });
  const { data: outflow } = useQuery({
    queryKey: ['customer-flow-outflow', params],
    queryFn: () => apiClient.getCustomerFlowOutflow(params) as Promise<FlowRow[]>,
  });
  const { data: trend } = useQuery({
    queryKey: ['customer-flow-trend', params],
    queryFn: () => apiClient.getCustomerFlowTrend(params) as Promise<FlowTrend[]>,
  });
  const { data: metadata } = useQuery({
    queryKey: ['customer-flow-metadata'],
    queryFn: () => apiClient.getCustomerFlowMetadata() as Promise<{ years: number[]; total_rows: number }>,
  });

  const renderTable = (_title: string, data: FlowRow[] | undefined, direction: 'inflow' | 'outflow') => (
    <div className={cardStyles.base}>
      <h3 className={textStyles.titleSmall}>
        {direction === 'inflow' ? '转入来源 TOP20' : '流失去向 TOP20'}
        <span className={cn(textStyles.caption, 'ml-2')}>
          {direction === 'inflow' ? '（从哪家公司转入华安）' : '（流向哪家竞争公司）'}
        </span>
      </h3>
      <div className={tableStyles.container}>
        <table className="w-full">
          <thead className={tableStyles.header}>
            <tr>
              <th className={cn(tableStyles.headerCell, 'w-8')}>#</th>
              <th className={tableStyles.headerCell}>保险公司</th>
              <th className={cn(tableStyles.headerCell, 'text-right')}>保单数</th>
              <th className={cn(tableStyles.headerCell, 'text-right')}>占比(%)</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row, i) => (
              <tr key={row.insurer} className="border-b border-neutral-100">
                <td className={tableStyles.cell}>{i + 1}</td>
                <td className={tableStyles.cell}>{row.insurer}</td>
                <td className={tableStyles.cellNumeric}>{formatCount(row.policy_count)}</td>
                <td className={tableStyles.cellNumeric}>{formatPercent(row.share_pct)}</td>
              </tr>
            ))}
            {(!data || data.length === 0) && (
              <tr><td colSpan={4} className={cn(tableStyles.cell, 'text-center py-6')}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 标题 + 年份筛选 */}
      <div className="flex items-center justify-between">
        <h2 className={textStyles.titleMedium}>客户来源去向分析</h2>
        <select
          className="border border-neutral-200 rounded px-3 py-1.5 text-sm"
          value={year}
          onChange={e => setYear(e.target.value)}
        >
          <option value="">全部年份</option>
          {(metadata?.years ?? []).map(y => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '总保单数', value: formatCount(summary?.total_policies ?? 0) },
          { label: '转入（非华安→华安）', value: formatCount(summary?.inflow_count ?? 0), color: colorClasses.text.success },
          { label: '流失（华安→竞品）', value: formatCount(summary?.outflow_count ?? 0), color: colorClasses.text.danger },
          { label: '自续保（华安→华安）', value: formatCount(summary?.self_renewal_count ?? 0) },
        ].map(kpi => (
          <div key={kpi.label} className={cardStyles.compact}>
            <div className={textStyles.caption}>{kpi.label}</div>
            <div className={cn(textStyles.titleLarge, 'mt-1', kpi.color)}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* 转入 + 流失并列 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderTable('转入来源', inflow, 'inflow')}
        {renderTable('流失去向', outflow, 'outflow')}
      </div>

      {/* 月度趋势 */}
      <div className={cardStyles.base}>
        <h3 className={textStyles.titleSmall}>月度转入/流失趋势</h3>
        <div className={tableStyles.container}>
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>月份</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>总保单</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>转入</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>流失</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>净流入</th>
              </tr>
            </thead>
            <tbody>
              {(trend ?? []).map(row => {
                const net = row.inflow_count - row.outflow_count;
                return (
                  <tr key={row.month} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.month}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.total_policies)}</td>
                    <td className={cn(tableStyles.cellNumeric, colorClasses.text.success)}>{formatCount(row.inflow_count)}</td>
                    <td className={cn(tableStyles.cellNumeric, colorClasses.text.danger)}>{formatCount(row.outflow_count)}</td>
                    <td className={cn(tableStyles.cellNumeric, net >= 0 ? colorClasses.text.success : colorClasses.text.danger)}>
                      {net >= 0 ? '+' : ''}{formatCount(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
