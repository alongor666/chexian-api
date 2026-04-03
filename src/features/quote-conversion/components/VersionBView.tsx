import { useState } from 'react';
import { Tabs } from '../../../shared/ui/Tabs';
import { cardStyles, colorClasses, cn } from '../../../shared/styles';
import { useQuoteKpi, useQuoteFunnel } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';
import { SectionHeading, mergeFilters } from './shared';
import { ConversionFunnel } from './ConversionFunnel';
import { DimensionHeatmap } from './DimensionHeatmap';
import { DimensionMatrix } from './DimensionMatrix';
import { DiscountSummary } from './DiscountSummary';
import { DrilldownTable } from './DrilldownTable';
import { KpiCards } from './KpiCards';
import { MonthlyTrendSnapshot } from './MonthlyTrendSnapshot';
import { OrgHighlights } from './OrgHighlights';
import { PriceSensitivity } from './PriceSensitivity';
import { RankingHighlightsCard } from './RankingHighlightsCard';
import { RankingTable } from './RankingTable';
import { RenewalSwitchSummary } from './RenewalSwitchSummary';
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
          dimension="insurance_grade"
        />
        <RankingHighlightsCard
          title="转保 · 风险等级承保率"
          subtitle="对比转保报价在各车险分等级上的承保效率。"
          filters={mergeFilters(filters, { renewalType: '转保' })}
          dimension="insurance_grade"
        />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RankingHighlightsCard
          title="续保 · 客户类别"
          subtitle="看续保客户结构中的高转化类别。"
          filters={mergeFilters(filters, { renewalType: '续保' })}
          dimension="customer_category"
        />
        <RankingHighlightsCard
          title="转保 · 客户类别"
          subtitle="看转保客户结构中的高转化类别。"
          filters={mergeFilters(filters, { renewalType: '转保' })}
          dimension="customer_category"
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
          subtitle={'对应旧 HTML 的\u201c特殊车辆\u201d子图之一。'}
          filters={filters}
          dimension="is_nev"
        />
        <RankingHighlightsCard
          title="过户车承保率对比"
          subtitle={'对应旧 HTML 的\u201c特殊车辆\u201d子图之一。'}
          filters={filters}
          dimension="is_transfer"
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
          dimension="ncd_coefficient"
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
          <div className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', colorClasses.bg.primarySolid, colorClasses.text.primary)}>
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
