/**
 * 未决赔案监控面板
 *
 * 包含：KPI 概览卡 + 机构分布表 + 账龄分布图 + 出险原因表 + 理赔时效
 */
import React, { useEffect, useCallback } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, tableStyles } from '@/shared/styles';
import { formatCount, formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={cn(cardStyles.standard, 'p-4 text-center')}>
      <div className={colorClasses.text.neutralMuted}>{label}</div>
      <div className={cn(fontStyles.kpi, 'mt-1')}>{value}</div>
      {sub && <div className={cn(colorClasses.text.neutralMuted, 'text-xs mt-1')}>{sub}</div>}
    </div>
  );
}

export const PendingClaimsPanel: React.FC<Props> = ({ hook, params }) => {
  const { pendingOverview, pendingByOrg, pendingAging, causeAnalysis, claimCycle } = hook;

  const loadData = useCallback(() => {
    hook.fetchPendingData(params);
    hook.fetchCauseAndCycle(params);
  }, [hook.fetchPendingData, hook.fetchCauseAndCycle, params]);

  useEffect(() => { loadData(); }, [loadData]);

  // 解析概览数据
  const settled = pendingOverview.data.find((r: any) => r.claim_status === '已业务结案');
  const pending = pendingOverview.data.find((r: any) => r.claim_status === '未业务结案');

  // 账龄分布图表
  const agingOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: pendingAging.data.map((r: any) => r.aging_bucket ?? '') },
    yAxis: [
      { type: 'value' as const, name: '件数', splitLine: { show: false } },
      { type: 'value' as const, name: '立案金额(万)', splitLine: { show: false } },
    ],
    series: [
      { name: '赔案件数', type: 'bar' as const, data: pendingAging.data.map((r: any) => r.cases ?? 0), itemStyle: { color: '#5470c6' } },
      { name: '立案金额(万)', type: 'bar' as const, yAxisIndex: 1, data: pendingAging.data.map((r: any) => r.reserve_wan ?? 0), itemStyle: { color: '#ee6666' } },
    ],
    legend: { data: ['赔案件数', '立案金额(万)'] },
    grid: { left: 60, right: 60, bottom: 30 },
  };

  const isLoading = pendingOverview.loading || pendingAging.loading;
  const error = pendingOverview.error || pendingAging.error;

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-6">
      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="未决赔案"
          value={isLoading ? '...' : formatCount(pending?.cases ?? 0)}
          sub={`人伤 ${formatCount(pending?.injury_cases ?? 0)} 件`}
        />
        <KpiCard
          label="未决立案总额"
          value={isLoading ? '...' : `${formatPremiumWan((pending?.reserve_wan ?? 0) * 10000)}万`}
          sub={`人伤占 ${formatPremiumWan((pending?.injury_reserve_wan ?? 0) * 10000)}万`}
        />
        <KpiCard
          label="未决案均"
          value={isLoading ? '...' : `${formatCount(pending?.avg_reserve ?? 0)}元`}
          sub={`是已决的 ${pending && settled ? (pending.avg_reserve / (settled.avg_reserve || 1)).toFixed(1) : '-'}倍`}
        />
        <KpiCard
          label="已决赔案"
          value={isLoading ? '...' : formatCount(settled?.cases ?? 0)}
          sub={`案均 ${formatCount(settled?.avg_reserve ?? 0)}元`}
        />
      </div>

      {/* 账龄分布 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <h3 className="font-medium mb-3">未决赔案账龄分布</h3>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">加载中...</div>
        ) : (
          <ReactEChartsCore echarts={echarts} option={agingOption} style={{ height: 280 }} />
        )}
      </div>

      {/* 机构分布表 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <h3 className="font-medium mb-3">未决赔案机构分布</h3>
        {pendingByOrg.loading ? (
          <div>加载中...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableStyles.container}>
              <thead>
                <tr>
                  <th className={tableStyles.headerCell}>机构</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>赔案数</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>立案金额(万)</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>人伤件</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>平均滞留天</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>最长滞留天</th>
                </tr>
              </thead>
              <tbody>
                {pendingByOrg.data.map((r: any, i: number) => (
                  <tr key={i} className={tableStyles.row}>
                    <td className={tableStyles.cell}>{r.org ?? ''}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.cases ?? 0)}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.reserve_wan ?? 0)}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.avg_reserve ?? 0)}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.injury_cases ?? 0)}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_pending_days ?? '-'}</td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric, r.max_pending_days > 365 ? colorClasses.text.danger : '')}>{r.max_pending_days ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 出险原因 + 理赔时效并排 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 出险原因 */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <h3 className="font-medium mb-3">出险原因分析</h3>
          {causeAnalysis.loading ? (
            <div>加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableStyles.container}>
                <thead>
                  <tr>
                    <th className={tableStyles.headerCell}>原因</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>立案金额(万)</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤占比</th>
                  </tr>
                </thead>
                <tbody>
                  {causeAnalysis.data.slice(0, 10).map((r: any, i: number) => (
                    <tr key={i} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{r.accident_cause ?? ''}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.reserve_wan ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.avg_reserve ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatPercent(r.injury_pct ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 理赔时效 */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <h3 className="font-medium mb-3">理赔时效（已结案，单位：天）</h3>
          {claimCycle.loading ? (
            <div>加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableStyles.container}>
                <thead>
                  <tr>
                    <th className={tableStyles.headerCell}>类型</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>报案</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>立案</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>结案</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>支付</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>全流程</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>中位数</th>
                  </tr>
                </thead>
                <tbody>
                  {claimCycle.data.map((r: any, i: number) => (
                    <tr key={i} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{r.type ?? ''}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_report_days ?? '-'}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_open_days ?? '-'}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_settle_days ?? '-'}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_pay_days ?? '-'}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_total_days ?? '-'}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.median_total_days ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
