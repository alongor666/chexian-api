/**
 * 未决赔案监控面板（重设计 v2）
 *
 * 信息架构（自上而下）：
 *   1. 叙事横幅       — 一句话结论 + 状态徽章 + 3 个 hero 指标
 *   2. 增强 KPI 卡片  — 状态色边、辅助文本上下文
 *   3. 智能洞察网格    — 4 张客户端派生的洞察卡（规则见 ./pending/insights.ts）
 *   4. 账龄水平条      — 件数 / 立案金额并排
 *   5. 机构排行 + 机构明细表  — 头部异常 + 完整字段
 *   6. 出险原因 / 理赔时效     — 保留原有字段
 *
 * 子组件位于 ./pending/，业务判定阈值与严重度规则集中在 ./pending/insights.ts。
 */
import React, { useEffect, useCallback, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import {
  cardStyles,
  colorClasses,
  cn,
  tableStyles,
} from '@/shared/styles';
import {
  formatCount,
  formatPercent,
  formatAverage,
} from '@/shared/utils/formatters';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';

import {
  HeroMetric,
  RiskBar,
  SectionHeader,
  StatusPill,
} from './pending/atoms';
import { AgingBarRow } from './pending/AgingBarRow';
import { InsightCard } from './pending/InsightCard';
import { KpiCard } from './pending/KpiCard';
import { OrgLeaderRow } from './pending/OrgLeaderRow';
import {
  THRESHOLDS,
  deriveInsights,
  isAgingMidBucket,
  overallSeverityFromRatio,
  severityForStayDays,
} from './pending/insights';
import type {
  AgingRow,
  CauseRow,
  CycleRow,
  OrgRow,
  OverviewRow,
  Severity,
} from './pending/types';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

/** 数据加载中占位 — 防止"正常 → 异常"视觉跳变 */
function NarrativeBannerSkeleton() {
  return (
    <div
      className={cn(
        cardStyles.standard,
        'relative overflow-hidden px-6 py-5',
        'bg-gradient-to-br from-white to-neutral-50',
        'dark:from-surface-1 dark:to-surface-2',
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px] space-y-3">
          <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-6 w-72 rounded bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-4 w-96 max-w-full rounded bg-neutral-100 dark:bg-surface-3 animate-pulse" />
        </div>
        <div className="h-16 w-80 rounded-xl bg-neutral-100 dark:bg-surface-2 animate-pulse" />
      </div>
    </div>
  );
}

export const PendingClaimsPanel: React.FC<Props> = ({ hook, params }) => {
  const { pendingOverview, pendingByOrg, pendingAging, causeAnalysis, claimCycle } = hook;

  const loadData = useCallback(() => {
    hook.fetchPendingData(params);
    hook.fetchCauseAndCycle(params);
  }, [hook.fetchPendingData, hook.fetchCauseAndCycle, params]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const overviewSrc = pendingOverview.data as OverviewRow[];
  const byOrgSrc = pendingByOrg.data as OrgRow[];
  const agingSrc = pendingAging.data as AgingRow[];
  const causeSrc = causeAnalysis.data as CauseRow[];
  const cycleSrc = claimCycle.data as CycleRow[];

  const settled = overviewSrc.find(r => r.claim_status === '已业务结案');
  const pending = overviewSrc.find(r => r.claim_status === '未业务结案');

  const ratioToSettled = useMemo(() => {
    const p = pending?.avg_reserve ?? 0;
    const s = settled?.avg_reserve ?? 0;
    return s > 0 ? p / s : 0;
  }, [pending, settled]);

  const overallSeverity: Severity = useMemo(
    () => overallSeverityFromRatio(ratioToSettled),
    [ratioToSettled],
  );

  const insights = useMemo(
    () => deriveInsights(pending, settled, byOrgSrc, agingSrc),
    [pending, settled, byOrgSrc, agingSrc],
  );

  const agingData = useMemo(() => {
    const totalCases = agingSrc.reduce((s, a) => s + (a.cases ?? 0), 0);
    const totalAmount = agingSrc.reduce((s, a) => s + (a.reserve_wan ?? 0), 0);
    return {
      rows: agingSrc.map(a => ({
        label: a.aging_bucket ?? '—',
        cases: a.cases ?? 0,
        amountWan: a.reserve_wan ?? 0,
        warn: isAgingMidBucket(a.aging_bucket),
      })),
      totalCases,
      totalAmount,
    };
  }, [agingSrc]);

  const sortedOrgs = useMemo(
    () => [...byOrgSrc].sort((a, b) => (b.avg_reserve ?? 0) - (a.avg_reserve ?? 0)),
    [byOrgSrc],
  );

  const isLoading = pendingOverview.loading || pendingAging.loading;
  // 加载结束就退出骨架，无未决数据时显示 0 件正常态（codex P2 #2）。
  // 之前用 `!isLoading && !!pending` 会让"全是已决、无未决"筛选场景永远卡在骨架。
  const hasData = !isLoading;
  const error = pendingOverview.error || pendingAging.error || pendingByOrg.error;

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  const pendingCases = pending?.cases ?? 0;
  const pendingReserveWan = pending?.reserve_wan ?? 0;
  const pendingAvg = pending?.avg_reserve ?? 0;

  const headline =
    overallSeverity === 'bad'
      ? '未决案均显著偏高，需立即核查'
      : overallSeverity === 'warn'
        ? '未决案均偏高，建议关注'
        : '未决赔案整体平稳';

  const summarySentence = `本期共 ${formatCount(pendingCases)} 件未决赔案，案均 ${formatCount(pendingAvg)} 元${
    ratioToSettled > 0 ? `，是已决案均的 ${ratioToSettled.toFixed(1)} 倍` : ''
  }。`;

  return (
    <div className="space-y-5">
      {/* 1. 叙事横幅 */}
      {hasData ? (
        <div
          className={cn(
            cardStyles.standard,
            'relative overflow-hidden px-6 py-5',
            'bg-gradient-to-br from-white to-neutral-50',
            'dark:from-surface-1 dark:to-surface-2',
          )}
        >
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <div className="flex items-center gap-3 mb-3">
                <StatusPill
                  severity={overallSeverity}
                  label={
                    overallSeverity === 'bad'
                      ? '异常'
                      : overallSeverity === 'warn'
                        ? '需关注'
                        : '正常'
                  }
                />
                <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
                  未决赔案监控
                </span>
              </div>
              <h2
                className={cn(
                  'text-xl font-bold tracking-tight leading-tight',
                  colorClasses.text.neutralBlack,
                )}
              >
                {headline}
              </h2>
              <p
                className={cn(
                  'text-sm mt-2 leading-relaxed',
                  colorClasses.text.neutralDark,
                )}
              >
                {summarySentence}
              </p>
            </div>
            <div
              className={cn(
                'flex items-center gap-5 px-5 py-3 rounded-xl border',
                'bg-white dark:bg-surface-2',
                colorClasses.border.neutral,
              )}
            >
              <HeroMetric
                label="未决"
                value={formatCount(pendingCases)}
                unit="件"
                severity={overallSeverity}
              />
              <span className="w-px h-10 bg-neutral-200 dark:bg-subtle" aria-hidden />
              <HeroMetric
                label="立案总额"
                value={formatCount(pendingReserveWan)}
                unit="万"
                severity={overallSeverity}
              />
              <span className="w-px h-10 bg-neutral-200 dark:bg-subtle" aria-hidden />
              <HeroMetric
                label="案均"
                value={formatCount(pendingAvg)}
                unit="元"
                severity={overallSeverity}
                badge={
                  ratioToSettled > 0
                    ? `${ratioToSettled.toFixed(1)}× 已决`
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      ) : (
        <NarrativeBannerSkeleton />
      )}

      {/* 2. KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="未决赔案"
          value={isLoading ? '…' : formatCount(pendingCases)}
          unit="件"
          sub={`人伤 ${formatCount(pending?.injury_cases ?? 0)} 件`}
          hint={pendingCases > 0 ? '需逐件复核大额未决' : undefined}
          severity={pendingCases > 10 ? 'warn' : 'good'}
        />
        <KpiCard
          label="未决立案总额"
          value={isLoading ? '…' : formatCount(pendingReserveWan)}
          unit="万"
          sub={`人伤占 ${formatCount(pending?.injury_reserve_wan ?? 0)} 万`}
          hint={
            pending?.reserve_wan && pending.reserve_wan > 0
              ? `人伤占比 ${formatPercent(
                  ((pending.injury_reserve_wan ?? 0) / pending.reserve_wan) * 100,
                )}`
              : undefined
          }
          severity={overallSeverity}
        />
        <KpiCard
          label="未决案均"
          value={isLoading ? '…' : formatCount(pendingAvg)}
          unit="元"
          sub={
            settled?.avg_reserve
              ? `已决案均 ${formatCount(settled.avg_reserve)} 元`
              : undefined
          }
          hint={
            ratioToSettled > 0
              ? `是已决案均的 ${ratioToSettled.toFixed(1)} 倍`
              : undefined
          }
          severity={overallSeverity}
        />
        <KpiCard
          label="已决赔案"
          value={isLoading ? '…' : formatCount(settled?.cases ?? 0)}
          unit="件"
          sub={`案均 ${formatCount(settled?.avg_reserve ?? 0)} 元`}
          hint="处置节奏参考基准"
          severity="good"
        />
      </div>

      {/* 3. 智能洞察 */}
      <section>
        <SectionHeader
          icon={Sparkles}
          title="智能洞察"
          sub="基于本期数据自动识别需关注的事项"
          rightExtra={
            <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
              {insights.length} 条洞察
            </span>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.map(ins => (
            <InsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      </section>

      {/* 4. 账龄 + 5. 机构排行 */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-3">
        <div className={cn(cardStyles.standard, 'p-5')}>
          <SectionHeader
            title="未决赔案账龄分布"
            sub="按账龄分桶查看件数与立案金额"
            inline
          />
          {pendingAging.loading ? (
            <div className="h-48 flex items-center justify-center">加载中…</div>
          ) : (
            <div className="space-y-4">
              {agingData.rows.map((row, i) => (
                <AgingBarRow
                  key={i}
                  label={row.label}
                  cases={row.cases}
                  amountWan={row.amountWan}
                  totalCases={agingData.totalCases}
                  totalAmount={agingData.totalAmount}
                  warn={row.warn}
                />
              ))}
            </div>
          )}
        </div>

        <div className={cn(cardStyles.standard, 'p-5')}>
          <SectionHeader
            title="机构排行"
            sub="按未决案均降序，关注头部异常"
            inline
          />
          {pendingByOrg.loading ? (
            <div>加载中…</div>
          ) : (
            <div className="space-y-2.5">
              {sortedOrgs.slice(0, 5).map((o, i) => (
                <OrgLeaderRow key={i} rank={i + 1} org={o} />
              ))}
              {sortedOrgs.length === 0 && (
                <div className={cn('text-sm', colorClasses.text.neutralMuted)}>
                  无机构数据
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 6. 机构完整表 */}
      <div className={cn(cardStyles.standard, 'p-5')}>
        <SectionHeader
          title="未决赔案机构分布"
          sub="完整明细，包含人伤件数与滞留天数"
          inline
        />
        {pendingByOrg.loading ? (
          <div>加载中…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableStyles.headerCell}>机构</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>赔案数</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>立案金额(万)</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>案均(元)</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>人伤件</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>平均滞留天</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>最长滞留天</th>
                  <th className={cn(tableStyles.headerCell, 'text-right w-24')}>风险</th>
                </tr>
              </thead>
              <tbody>
                {sortedOrgs.map((r, i) => {
                  const stayDays = r.max_pending_days ?? 0;
                  const stayClass =
                    stayDays > THRESHOLDS.maxStayDaysBad
                      ? colorClasses.text.danger
                      : stayDays > THRESHOLDS.maxStayDaysWarn
                        ? colorClasses.text.warning
                        : '';
                  return (
                    <tr key={i} className={tableStyles.row}>
                      <td className={cn(tableStyles.cell, 'font-semibold')}>
                        {r.org ?? ''}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.cases ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.reserve_wan ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.avg_reserve ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {r.injury_cases
                          ? formatCount(r.injury_cases)
                          : (
                            <span className={colorClasses.text.neutralMuted}>—</span>
                          )}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {r.avg_pending_days ?? '-'}
                      </td>
                      <td
                        className={cn(
                          tableStyles.cellNumeric,
                          stayClass,
                          'font-semibold',
                        )}
                      >
                        {r.max_pending_days ?? '-'}
                      </td>
                      <td className={cn(tableStyles.cell, 'text-right')}>
                        <RiskBar severity={severityForStayDays(r.max_pending_days)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. 出险原因 + 8. 理赔时效 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={cn(cardStyles.standard, 'p-5')}>
          <SectionHeader title="出险原因分析" sub="Top 10 出险原因" inline />
          {causeAnalysis.loading ? (
            <div>加载中…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableStyles.headerCell}>原因</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>立案(万)</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤占比</th>
                  </tr>
                </thead>
                <tbody>
                  {causeSrc.slice(0, 10).map((r, i) => (
                    <tr key={i} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{r.accident_cause ?? ''}</td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.cases ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.reserve_wan ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.avg_reserve ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatPercent(r.injury_pct ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={cn(cardStyles.standard, 'p-5')}>
          <SectionHeader title="理赔时效" sub="已结案赔案，单位：天" inline />
          {claimCycle.loading ? (
            <div>加载中…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
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
                  {cycleSrc.map((r, i) => (
                    <tr key={i} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{r.type ?? ''}</td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(r.cases ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.avg_report_days ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.avg_open_days ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.avg_settle_days ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.avg_pay_days ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.avg_total_days ?? 0)}
                      </td>
                      <td className={tableStyles.cellNumeric}>
                        {formatAverage(r.median_total_days ?? 0)}
                      </td>
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
