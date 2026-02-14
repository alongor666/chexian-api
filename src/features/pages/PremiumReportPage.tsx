import React from 'react';
import { PremiumReportPanel } from '../premium-report';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const PremiumReportPage: React.FC = () => {
  return (
    <PageFilterPanel preset="report">
      <div className="p-4">
        <PremiumReportPanel />
      </div>
    </PageFilterPanel>
  );
};
