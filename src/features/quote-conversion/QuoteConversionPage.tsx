import { useState } from 'react';
import { Tabs } from '../../shared/ui/Tabs';
import { cardStyles, colorClasses } from '../../shared/styles';
import { GlobalFilters } from './components/GlobalFilters';
import { KpiCards } from './components/KpiCards';
import { ConversionFunnel } from './components/ConversionFunnel';
import { DrilldownTable } from './components/DrilldownTable';
import { DimensionMatrix } from './components/DimensionMatrix';
import { PriceSensitivity } from './components/PriceSensitivity';
import { TimeTrend } from './components/TimeTrend';
import { useQuoteKpi, useQuoteFunnel } from './hooks/useQuoteConversion';
import type { QuoteFilters } from './types';

/** 筛选摘要文字 */
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
  return parts.length > 0 ? parts.join(' · ') : '全部数据';
}

const DEEP_DIVE_TABS = [
  { key: 'trend', label: '时间趋势' },
  { key: 'dimension', label: '维度矩阵' },
  { key: 'price', label: '价格分析' },
];

export function QuoteConversionPage() {
  const [filters, setFilters] = useState<QuoteFilters>({});
  const [deepDiveTab, setDeepDiveTab] = useState('trend');
  const kpi = useQuoteKpi(filters);
  const funnel = useQuoteFunnel(filters);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <div>
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          报价转化分析
        </h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          商业险报价 → 承保 ┃ {getFilterSummary(filters)}
        </p>
      </div>

      {/* ── 筛选器（折叠式） ── */}
      <GlobalFilters filters={filters} onChange={setFilters} />

      {/* ── Hero KPI ── */}
      <KpiCards data={kpi.data} isLoading={kpi.isLoading} />

      {/* ── Story: 漏斗 + 下钻表 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ConversionFunnel data={funnel.data} isLoading={funnel.isLoading} />
        <DrilldownTable filters={filters} />
      </div>

      {/* ── DeepDive: Tabs 切换 ── */}
      <div>
        <Tabs
          items={DEEP_DIVE_TABS}
          activeKey={deepDiveTab}
          onChange={setDeepDiveTab}
          variant="underline"
          size="small"
          className="mb-4"
        />

        {deepDiveTab === 'trend' && <TimeTrend filters={filters} />}
        {deepDiveTab === 'dimension' && <DimensionMatrix filters={filters} />}
        {deepDiveTab === 'price' && <PriceSensitivity filters={filters} />}
      </div>

      {/* ── 战略占位 ── */}
      <div className={`${cardStyles.base} p-4 bg-neutral-50 dark:bg-neutral-800/50 text-center`}>
        <span className={`text-xs ${colorClasses.text.neutralMuted}`}>
          市场渗透分析 — 即将上线（市场保有量 → 华安报价量 → 华安成交量）
        </span>
      </div>
    </div>
  );
}
