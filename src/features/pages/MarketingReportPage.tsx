import React from 'react';
import { MarketingReportPanel } from '../marketing-report';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const MarketingReportPage: React.FC = () => {
  return (
    <PageFilterPanel preset="marketingReport" title="营销战报">
      <div className="p-4">
        <MarketingReportPanel />
      </div>
    </PageFilterPanel>
  );
};
