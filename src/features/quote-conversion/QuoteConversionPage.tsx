import { useState } from 'react';
import { colorClasses } from '../../shared/styles';
import { GlobalFilters } from './components/GlobalFilters';
import { VersionBView } from './components/VersionBView';
import { DashboardAnchorNav } from '../../components/layout/DashboardAnchorNav';
import type { QuoteFilters } from './types';

export function QuoteConversionPage() {
  const [filters, setFilters] = useState<QuoteFilters>({});

  return (
    <div className="relative p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <DashboardAnchorNav
        sections={[
          { id: 'quote-filters', label: '筛选配置' },
          { id: 'quote-content', label: '分析内容' },
        ]}
      />
      <div id="quote-filters" className="space-y-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className={`text-lg font-bold ${colorClasses.text.neutralBlack}`}>
              旧车商业险报价转化分析
            </h1>
            <span className={`inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium ${colorClasses.text.warning}`}>
              开发阶段
            </span>
          </div>
          <p className={`mt-1 text-xs ${colorClasses.text.neutralMuted}`}>
            基于报价单据的<strong>承保率</strong>分析（单据级，每条报价单一行）。
            本页各类承保率/转化率均以报价单量为分母（承保件数 ÷ 报价件数），
            区别于「商业险续保追踪」页以应续件数为分母的报价率。
          </p>
        </div>
      </div>

      <GlobalFilters filters={filters} onChange={setFilters} />

      <div id="quote-content">
        <VersionBView filters={filters} />
      </div>
    </div>
  );
}
