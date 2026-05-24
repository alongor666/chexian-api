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

  const renderTable = (_title: string, data: FlowRow[] | undefined) => (
    <div className={cardStyles.base}>
      <h3 className={textStyles.titleSmall}>
        流失去向 TOP20
        <span className={cn(textStyles.caption, 'ml-2')}>
          （按车架号去重，流向哪家竞争公司）
        </span>
      </h3>
      <div className={tableStyles.container}>
        <table className="w-full">
          <thead className={tableStyles.header}>
            <tr>
              <th className={cn(tableStyles.headerCell, 'w-8')}>#</th>
              <th className={tableStyles.headerCell}>保险公司</th>
              <th className={cn(tableStyles.headerCell, 'text-right')}>车辆数</th>
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
          { label: '车辆数', value: formatCount(summary?.total_policies ?? 0) },
          { label: '已填流失去向', value: formatCount(summary?.has_next ?? 0) },
          { label: '流失到竞品', value: formatCount(summary?.outflow_count ?? 0), color: colorClasses.text.danger },
          { label: '未填流失去向', value: formatCount((summary?.total_policies ?? 0) - (summary?.has_next ?? 0)) },
        ].map(kpi => (
          <div key={kpi.label} className={cardStyles.compact}>
            <div className={textStyles.caption}>{kpi.label}</div>
            <div className={cn(textStyles.titleLarge, 'mt-1', kpi.color)}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {renderTable('流失去向', outflow)}

      {/* 月度趋势 */}
      <div className={cardStyles.base}>
        <h3 className={textStyles.titleSmall}>月度流失趋势</h3>
        <div className={tableStyles.container}>
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>月份</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>车辆数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>流失</th>
              </tr>
            </thead>
            <tbody>
              {(trend ?? []).map(row => {
                return (
                  <tr key={row.month} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.month}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.total_policies)}</td>
                    <td className={cn(tableStyles.cellNumeric, colorClasses.text.danger)}>{formatCount(row.outflow_count)}</td>
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
