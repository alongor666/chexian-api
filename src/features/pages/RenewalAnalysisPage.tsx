/**
 * 续保分析页面（V2）— 4 Tab 宿主
 *
 * Tab 1: 续保总览 (KPI + 月度走势 + 排名)
 * Tab 2: 转化漏斗 (三级漏斗 + 流失归因)
 * Tab 3: 竞争格局 (流失去向 + 转入来源)
 * Tab 4: 行动看板 (待办清单 + 分页)
 */

import { useState, useMemo, lazy, Suspense } from 'react';
import { textStyles } from '../../shared/styles';
import type { RenewalV2Filters } from '../renewal-v2/hooks/useRenewalV2';

const RenewalOverviewTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalOverviewTab').then(m => ({ default: m.RenewalOverviewTab }))
);
const RenewalFunnelTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalFunnelTab').then(m => ({ default: m.RenewalFunnelTab }))
);
const RenewalCompetitionTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalCompetitionTab').then(m => ({ default: m.RenewalCompetitionTab }))
);
const RenewalActionTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalActionTab').then(m => ({ default: m.RenewalActionTab }))
);

const TABS = [
  { key: 'overview', label: '续保总览' },
  { key: 'funnel', label: '转化漏斗' },
  { key: 'competition', label: '竞争格局' },
  { key: 'action', label: '行动看板' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function RenewalAnalysisPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [orgFilter, setOrgFilter] = useState('');

  const filters: RenewalV2Filters = useMemo(() => ({
    ...(orgFilter ? { orgName: orgFilter } : {}),
  }), [orgFilter]);

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className={textStyles.titleLarge}>续保分析</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="按机构筛选..."
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-neutral-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <Suspense fallback={<div className="p-8 text-center text-neutral-400">加载中...</div>}>
        {activeTab === 'overview' && <RenewalOverviewTab filters={filters} />}
        {activeTab === 'funnel' && <RenewalFunnelTab filters={filters} />}
        {activeTab === 'competition' && <RenewalCompetitionTab filters={filters} />}
        {activeTab === 'action' && <RenewalActionTab filters={filters} />}
      </Suspense>
    </div>
  );
}
