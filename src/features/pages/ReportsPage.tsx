import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PremiumReportPanel } from '../premium-report';
import { MarketingReportPanel } from '../marketing-report';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { Tabs } from '../../shared/ui';
import type { FilterPresetName } from '../../shared/types/filters';

type ReportTab = 'premium' | 'marketing';

const tabItems = [
  { key: 'premium', label: '保费报表' },
  { key: 'marketing', label: '营销战报' },
];

const presetMap: Record<ReportTab, FilterPresetName> = {
  premium: 'report',
  marketing: 'marketingReport',
};

export const ReportsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ReportTab) || 'premium';
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);

  const handleTabChange = (key: string) => {
    const tab = key as ReportTab;
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <PageFilterPanel
      preset={presetMap[activeTab]}
      title="业务报表"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="space-y-4">
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={handleTabChange}
          variant="pills"
        />
        <div className="p-4">
          {activeTab === 'premium' && <PremiumReportPanel />}
          {activeTab === 'marketing' && <MarketingReportPanel />}
        </div>
      </div>
    </PageFilterPanel>
  );
};
