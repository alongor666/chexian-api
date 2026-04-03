import { useState } from 'react';
import { Tabs } from '../../../shared/ui/Tabs';
import { cardStyles, colorClasses } from '../../../shared/styles';
import { ConversionFunnel } from './ConversionFunnel';
import { DrilldownTable } from './DrilldownTable';
import { DimensionMatrix } from './DimensionMatrix';
import { PriceSensitivity } from './PriceSensitivity';
import { TimeTrend } from './TimeTrend';
import { KpiCards } from './KpiCards';
import { useQuoteKpi, useQuoteFunnel } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
}

function getFilterSummary(filters: QuoteFilters): string {
  const parts: string[] = [];
  if (filters.orgName) parts.push(filters.orgName);
  if (filters.renewalType) parts.push(filters.renewalType);
  if (filters.customerCategory) parts.push(filters.customerCategory);
  if (filters.dateStart && filters.dateEnd) {
    parts.push(`${filters.dateStart.slice(0, 7)} ~ ${filters.dateEnd.slice(0, 7)}`);
  } else if (filters.dateStart) {
    parts.push(`${filters.dateStart} 起`);
  }
  return parts.length > 0 ? parts.join(' · ') : '全部旧车商业险报价';
}

const DEEP_DIVE_TABS = [
  { key: 'trend', label: '时间趋势' },
  { key: 'dimension', label: '维度矩阵' },
  { key: 'price', label: '价格分析' },
];

export function VersionAView({ filters }: Props) {
  const [deepDiveTab, setDeepDiveTab] = useState('trend');
  const kpi = useQuoteKpi(filters);
  const funnel = useQuoteFunnel(filters);

  return (
    <>
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          版本 A · 旧车商业险报价转化总览
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          聚焦旧车商业险报价、承保与续转结构变化 ┃ {getFilterSummary(filters)}
        </p>
      </div>

      <KpiCards data={kpi.data} isLoading={kpi.isLoading} variant="oldCar" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ConversionFunnel data={funnel.data} isLoading={funnel.isLoading} />
        <DrilldownTable filters={filters} />
      </div>

      <div>
        <Tabs
          items={DEEP_DIVE_TABS}
          activeKey={deepDiveTab}
          onChange={setDeepDiveTab}
          variant="underline"
          size="small"
          className="mb-4"
        />

        {deepDiveTab === 'trend' && <TimeTrend filters={filters} defaultGranularity="month" />}
        {deepDiveTab === 'dimension' && <DimensionMatrix filters={filters} />}
        {deepDiveTab === 'price' && <PriceSensitivity filters={filters} />}
      </div>

      <div className={`${cardStyles.base} p-4 bg-neutral-50 dark:bg-neutral-800/50 text-center`}>
        <span className={`text-xs ${colorClasses.text.neutralMuted}`}>
          旧车专题深挖视角将逐步补齐，当前优先提供总览、漏斗与趋势能力。
        </span>
      </div>
    </>
  );
}
