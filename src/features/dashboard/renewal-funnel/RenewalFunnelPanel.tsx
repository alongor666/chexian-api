/**
 * 续保漏斗分析 — 主面板
 *
 * 集成 Overview、Team、ActionList 三大 P0 组件
 * 交互：点击机构→展开团队，面包屑导航
 */

import React, { useState, useCallback } from 'react';
import { RenewalFunnelOverviewPanel } from './RenewalFunnelOverviewPanel';
import { RenewalFunnelTeamPanel } from './RenewalFunnelTeamPanel';
import { RenewalFunnelActionList } from './RenewalFunnelActionList';
import { textStyles, cn, buttonStyles } from '../../../shared/styles';
import type { FunnelFilters } from './types';

export const RenewalFunnelPanel: React.FC = () => {
  const [filters, setFilters] = useState<FunnelFilters>({});

  const handleOrgClick = useCallback((orgName: string) => {
    setFilters(prev => ({ ...prev, orgName, teamName: undefined, salesmanName: undefined }));
  }, []);

  const handleTeamClick = useCallback((teamName: string) => {
    setFilters(prev => ({ ...prev, teamName, salesmanName: undefined }));
  }, []);

  const handleReset = useCallback(() => {
    setFilters({});
  }, []);

  const handleBreadcrumbOrg = useCallback(() => {
    setFilters(prev => ({ ...prev, teamName: undefined, salesmanName: undefined }));
  }, []);

  return (
    <div className="space-y-4">
      {/* 面包屑导航 */}
      {(filters.orgName || filters.teamName) && (
        <nav className="flex items-center gap-1 text-sm">
          <button onClick={handleReset} className={textStyles.link}>
            全部机构
          </button>
          {filters.orgName && (
            <>
              <span className="text-neutral-400">/</span>
              {filters.teamName ? (
                <button onClick={handleBreadcrumbOrg} className={textStyles.link}>
                  {filters.orgName}
                </button>
              ) : (
                <span className="font-medium text-neutral-700">{filters.orgName}</span>
              )}
            </>
          )}
          {filters.teamName && (
            <>
              <span className="text-neutral-400">/</span>
              <span className="font-medium text-neutral-700">{filters.teamName}</span>
            </>
          )}
          <button
            onClick={handleReset}
            className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.ghost, 'ml-2')}
          >
            重置
          </button>
        </nav>
      )}

      {/* 漏斗总览 */}
      <RenewalFunnelOverviewPanel
        filters={filters}
        onOrgClick={handleOrgClick}
      />

      {/* 团队排行（选中机构时显示） */}
      <RenewalFunnelTeamPanel
        filters={filters}
        onTeamClick={handleTeamClick}
      />

      {/* 待跟进清单 */}
      <RenewalFunnelActionList filters={filters} />
    </div>
  );
};
