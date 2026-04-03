import { useMemo, useState } from 'react';
import { Tabs } from '../../../shared/ui/Tabs';
import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { formatCount, formatPercent, formatPremiumWan } from '../../../shared/utils/formatters';
import { useQuoteDrilldown, useQuoteFunnel, useQuoteKpi, useQuoteRanking, useQuoteTrend } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { ConversionFunnel } from './ConversionFunnel';
import { DimensionHeatmap } from './DimensionHeatmap';
import { DimensionMatrix } from './DimensionMatrix';
import { DrilldownTable } from './DrilldownTable';
import { KpiCards } from './KpiCards';
import { PriceSensitivity } from './PriceSensitivity';
import { RankingTable } from './RankingTable';
import { TimeTrend } from './TimeTrend';

interface Props {
  filters: QuoteFilters;
}

const VERSION_B_SECTIONS = [
  { key: 'overview', label: '总览' },
  { key: 'renewal-switch', label: '续/转保' },
  { key: 'org', label: '三级机构' },
  { key: 'profile', label: '险别/客户/等级' },
  { key: 'trend', label: '月度趋势' },
  { key: 'discount', label: '折扣/NCD' },
] as const;

type VersionBSectionKey = typeof VERSION_B_SECTIONS[number]['key'];

function mergeFilters(filters: QuoteFilters, overrides: Partial<QuoteFilters>): QuoteFilters {
  return { ...filters, ...overrides };
}

function getAveragePremiumWan(totalPremium: number | undefined, totalInsured: number | undefined): string {
  if (!totalPremium || !totalInsured) return '0.00';
  return (totalPremium / totalInsured / 10000).toFixed(2);
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <p className={`text-xs ${colorClasses.text.neutralMuted}`}>{subtitle}</p>
    </div>
  );
}

function InsightCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className={cn(cardStyles.base, 'p-4')}>
      <div className={`text-xs ${colorClasses.text.neutralMuted} mb-1`}>{title}</div>
      <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>{hint}</div>
    </div>
  );
}

function RenewalSwitchSummary({
  filters,
  title = '续保 vs 转保 概览',
  subtitle = '对照查看报价量、承保量、承保率与件均保费。',
}: {
  filters: QuoteFilters;
  title?: string;
  subtitle?: string;
}) {
  const renewal = useQuoteKpi(mergeFilters(filters, { renewalType: '续保' }));
  const switched = useQuoteKpi(mergeFilters(filters, { renewalType: '转保' }));
  const isLoading = renewal.isLoading || switched.isLoading;

  return (
    <div className={cn(cardStyles.base, 'p-5 space-y-4')}>
      <SectionHeading title={title} subtitle={subtitle} />
      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="h-36 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          <div className="h-36 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[
            { label: '续保', data: renewal.data, tone: 'bg-blue-50 dark:bg-blue-950/30' },
            { label: '转保', data: switched.data, tone: 'bg-amber-50 dark:bg-amber-950/20' },
          ].map((item) => {
            const data = item.data;
            const conversionRate = data?.conversion_rate ?? 0;
            const totalQuotes = data?.total_quotes ?? 0;
            const totalInsured = data?.total_insured ?? 0;
            const insuredPremium = data?.insured_premium ?? 0;

            return (
              <div key={item.label} className={cn('rounded-xl p-4 border border-neutral-200 dark:border-neutral-700', item.tone)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.label}</div>
                    <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>
                      报价 {formatCount(totalQuotes)}，承保 {formatCount(totalInsured)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatPercent(conversionRate)}
                    </div>
                    <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>承保率</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 p-3">
                    <div className={`text-xs ${colorClasses.text.neutralMuted}`}>承保保费</div>
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatPremiumWan(insuredPremium)}万
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 p-3">
                    <div className={`text-xs ${colorClasses.text.neutralMuted}`}>件均保费</div>
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {getAveragePremiumWan(insuredPremium, totalInsured)}万
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RankingHighlightsCard({
  title,
  subtitle,
  filters,
  dimension,
}: {
  title: string;
  subtitle: string;
  filters: QuoteFilters;
  dimension: string;
}) {
  const { data, isLoading } = useQuoteRanking(filters, dimension);
  const rows = useMemo(() => (data ?? []).slice(0, 5), [data]);

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading title={title} subtitle={subtitle} />
      {isLoading ? (
        <div className="space-y-2 mt-4">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="h-10 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="space-y-3 mt-4">
          {rows.map((row) => (
            <div key={`${dimension}-${row.dim_value}`} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {row.dim_value ?? '-'}
                </div>
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatPercent(row.conversion_rate)}
                </div>
              </div>
              <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>
                报价 {formatCount(row.total_quotes)}，承保 {formatCount(row.total_insured)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cn('text-sm py-8 text-center', colorClasses.text.neutralMuted)}>暂无维度排行数据</div>
      )}
    </div>
  );
}

function OrgHighlights({ filters }: { filters: QuoteFilters }) {
  const { data, isLoading } = useQuoteDrilldown(filters, 'org');

  const highlights = useMemo(() => {
    if (!data || data.length === 0) return [];

    const topByQuotes = [...data].sort((a, b) => b.total_quotes - a.total_quotes)[0];
    const topByConversion = [...data].sort((a, b) => b.conversion_rate - a.conversion_rate)[0];
    const topByRenewal = [...data].sort(
      (a, b) => (b.renewal_rate - b.switch_rate) - (a.renewal_rate - a.switch_rate)
    )[0];

    return [
      {
        title: '报价量最高机构',
        value: topByQuotes?.group_name ?? '-',
        hint: `报价 ${formatCount(topByQuotes?.total_quotes ?? 0)}，承保 ${formatCount(topByQuotes?.total_insured ?? 0)}`,
      },
      {
        title: '承保率最高机构',
        value: topByConversion?.group_name ?? '-',
        hint: `承保率 ${formatPercent(topByConversion?.conversion_rate ?? 0)}`,
      },
      {
        title: '续保优势最强机构',
        value: topByRenewal?.group_name ?? '-',
        hint: `续保率 ${formatPercent(topByRenewal?.renewal_rate ?? 0)}，转保率 ${formatPercent(topByRenewal?.switch_rate ?? 0)}`,
      },
    ];
  }, [data]);

  return (
    <div className="space-y-3">
      <SectionHeading
        title="机构快照"
        subtitle="保留旧专题里“机构量级、承保效率、续转结构”三种观察方式，先用现有下钻能力做稳定落地。"
      />
      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-28 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {highlights.map((item) => (
            <InsightCard key={item.title} title={item.title} value={item.value} hint={item.hint} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthlyTrendSnapshot({ filters }: { filters: QuoteFilters }) {
  const { data, isLoading } = useQuoteTrend(filters, 'month');

  const rows = useMemo(() => {
    if (!data || data.length === 0) return [];

    const bucketMap = new Map<string, {
      quotes: number;
      insured: number;
      renewalRate: number;
      switchRate: number;
    }>();

    for (const row of data) {
      const existing = bucketMap.get(row.time_bucket) ?? {
        quotes: 0,
        insured: 0,
        renewalRate: 0,
        switchRate: 0,
      };
      existing.quotes += row.total_quotes ?? 0;
      existing.insured += row.total_insured ?? 0;
      if (row.renewal_type === '续保') existing.renewalRate = row.conversion_rate ?? 0;
      if (row.renewal_type === '转保') existing.switchRate = row.conversion_rate ?? 0;
      bucketMap.set(row.time_bucket, existing);
    }

    return Array.from(bucketMap.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 6)
      .map(([timeBucket, value]) => ({
        timeBucket,
        ...value,
        conversionRate: value.quotes > 0 ? (value.insured / value.quotes) * 100 : 0,
      }));
  }, [data]);

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading
        title="月度趋势快照"
        subtitle="按月回看报价量、整体承保率，以及续保/转保两条线的近 6 期表现。"
      />
      {isLoading ? (
        <div className="space-y-2 mt-4">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="h-9 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="text-left py-2 font-medium text-neutral-500">月份</th>
                <th className="text-right py-2 font-medium text-neutral-500">报价量</th>
                <th className="text-right py-2 font-medium text-neutral-500">整体承保率</th>
                <th className="text-right py-2 font-medium text-neutral-500">续保率</th>
                <th className="text-right py-2 font-medium text-neutral-500">转保率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.timeBucket} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 text-neutral-900 dark:text-neutral-100">{row.timeBucket}</td>
                  <td className="py-2 text-right text-neutral-700 dark:text-neutral-300">{formatCount(row.quotes)}</td>
                  <td className="py-2 text-right text-neutral-700 dark:text-neutral-300">{formatPercent(row.conversionRate)}</td>
                  <td className="py-2 text-right text-neutral-700 dark:text-neutral-300">{formatPercent(row.renewalRate)}</td>
                  <td className="py-2 text-right text-neutral-700 dark:text-neutral-300">{formatPercent(row.switchRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={cn('text-sm py-8 text-center', colorClasses.text.neutralMuted)}>暂无月度趋势数据</div>
      )}
    </div>
  );
}

function DiscountSummary({ filters }: { filters: QuoteFilters }) {
  const { data, isLoading } = useQuoteKpi(filters);
  const renewalRate = (data?.renewal_quotes ?? 0) > 0
    ? ((data?.renewal_insured ?? 0) / (data?.renewal_quotes ?? 0)) * 100
    : 0;
  const switchRate = (data?.switch_quotes ?? 0) > 0
    ? ((data?.switch_insured ?? 0) / (data?.switch_quotes ?? 0)) * 100
    : 0;

  return (
    <div className={cn(cardStyles.base, 'p-5')}>
      <SectionHeading
        title="折扣快照"
        subtitle="把折扣分析与 NCD 观察放在同一个专题里，补回旧 HTML 的细节视角。"
      />
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-24 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <InsightCard
            title="平均折扣率"
            value={`${((data?.avg_discount_rate ?? 0) * 100).toFixed(1)}%`}
            hint="基于折前/折后保费计算。"
          />
          <InsightCard
            title="承保保费"
            value={`${formatPremiumWan(data?.insured_premium ?? 0)}万`}
            hint={`承保件数 ${formatCount(data?.total_insured ?? 0)}`}
          />
          <InsightCard
            title="续/转承保率差"
            value={`${(renewalRate - switchRate).toFixed(1)}%`}
            hint="帮助判断折扣与续转结构是否同步变化。"
          />
        </div>
      )}
    </div>
  );
}

function OverviewSection({ filters }: { filters: QuoteFilters }) {
  const kpi = useQuoteKpi(filters);
  const funnel = useQuoteFunnel(filters);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="整体转化漏斗"
        subtitle="对应旧 HTML 的总览页，先保留旧车 KPI、报价到承保漏斗，以及综合维度矩阵。"
      />
      <KpiCards data={kpi.data} isLoading={kpi.isLoading} variant="oldCar" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ConversionFunnel data={funnel.data} isLoading={funnel.isLoading} />
        <div className={cn(cardStyles.base, 'p-5')}>
          <SectionHeading
            title="综合概览"
            subtitle="保留旧专题里的综合概览入口，把险别、客户、等级与特殊车辆统一收拢到维度矩阵里。"
          />
          <div className="mt-4">
            <DimensionMatrix filters={filters} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RenewalSwitchSection({ filters }: { filters: QuoteFilters }) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="续保 vs 转保 多维分析"
        subtitle="把旧专题里的续/转保对比重新拆成概览、风险等级与客户类别三层观察。"
      />
      <RenewalSwitchSummary filters={filters} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RankingHighlightsCard
          title="续保 · 风险等级承保率"
          subtitle="观察续保报价在各车险分等级上的承保效率。"
          filters={mergeFilters(filters, { renewalType: '续保' })}
          dimension="车险分等级"
        />
        <RankingHighlightsCard
          title="转保 · 风险等级承保率"
          subtitle="对比转保报价在各车险分等级上的承保效率。"
          filters={mergeFilters(filters, { renewalType: '转保' })}
          dimension="车险分等级"
        />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RankingHighlightsCard
          title="续保 · 客户类别"
          subtitle="看续保客户结构中的高转化类别。"
          filters={mergeFilters(filters, { renewalType: '续保' })}
          dimension="客户类别"
        />
        <RankingHighlightsCard
          title="转保 · 客户类别"
          subtitle="看转保客户结构中的高转化类别。"
          filters={mergeFilters(filters, { renewalType: '转保' })}
          dimension="客户类别"
        />
      </div>
    </div>
  );
}

function OrgSection({ filters }: { filters: QuoteFilters }) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="三级机构分析"
        subtitle="保留机构专题的三类重点：机构快照、机构热力矩阵、机构到团队到业务员的连续下钻。"
      />
      <OrgHighlights filters={filters} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DimensionHeatmap filters={filters} />
        <DrilldownTable filters={filters} />
      </div>
    </div>
  );
}

function ProfileSection({ filters }: { filters: QuoteFilters }) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="险别/客户/等级"
        subtitle="把险别组合、客户类别、车险分等级与特殊车辆重新收拢到一个专题面板。"
      />
      <DimensionMatrix filters={filters} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RankingHighlightsCard
          title="新能源车承保率对比"
          subtitle="对应旧 HTML 的“特殊车辆”子图之一。"
          filters={filters}
          dimension="是否新能源车"
        />
        <RankingHighlightsCard
          title="过户车承保率对比"
          subtitle="对应旧 HTML 的“特殊车辆”子图之一。"
          filters={filters}
          dimension="是否过户车"
        />
      </div>
      <RankingTable filters={filters} />
    </div>
  );
}

function TrendSection({ filters }: { filters: QuoteFilters }) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="月度趋势"
        subtitle="保留按月观察报价量、承保率与续/转走势的主骨架，并补一个月度快照表。"
      />
      <TimeTrend filters={filters} defaultGranularity="month" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <MonthlyTrendSnapshot filters={filters} />
        <RenewalSwitchSummary
          filters={filters}
          title="续/转保费快照"
          subtitle="作为月度趋势旁路视角，补足旧专题中的件均保费观察。"
        />
      </div>
    </div>
  );
}

function DiscountSection({ filters }: { filters: QuoteFilters }) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="折扣分析"
        subtitle="复用现有价格敏感度分析，外加 NCD 系数分布与折扣快照，形成折扣/NCD 专题。"
      />
      <PriceSensitivity filters={filters} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RankingHighlightsCard
          title="NCD系数分布"
          subtitle="对应旧 HTML 的 NCD 系数分布专题。"
          filters={filters}
          dimension="NCD系数"
        />
        <DiscountSummary filters={filters} />
      </div>
    </div>
  );
}

export function VersionBView({ filters }: Props) {
  const [section, setSection] = useState<VersionBSectionKey>('overview');
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== '').length;

  return (
    <div className="space-y-5">
      <div className={cn(cardStyles.base, 'p-5')}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              版本 B · 旧车专题版
            </h2>
            <p className={`text-xs ${colorClasses.text.neutralMuted}`}>
              以旧 HTML 的 6 个分析专题为骨架迁回 React 页面，当前已继承 {activeFilterCount} 个共享筛选条件。
            </p>
          </div>
          <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
            六专题视角
          </div>
        </div>
      </div>

      <Tabs
        items={[...VERSION_B_SECTIONS]}
        activeKey={section}
        onChange={(next) => setSection(next as VersionBSectionKey)}
        variant="underline"
        size="small"
      />

      {section === 'overview' && <OverviewSection filters={filters} />}
      {section === 'renewal-switch' && <RenewalSwitchSection filters={filters} />}
      {section === 'org' && <OrgSection filters={filters} />}
      {section === 'profile' && <ProfileSection filters={filters} />}
      {section === 'trend' && <TrendSection filters={filters} />}
      {section === 'discount' && <DiscountSection filters={filters} />}
    </div>
  );
}
