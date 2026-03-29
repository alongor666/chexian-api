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
import { textStyles, cn, buttonStyles, inputStyles } from '../../../shared/styles';
import type { FunnelFilters } from './types';

const DEFAULT_EXPIRY_START = '2026-01-01';
const DEFAULT_EXPIRY_END = '2026-05-31';

export const RenewalFunnelPanel: React.FC = () => {
  const [filters, setFilters] = useState<FunnelFilters>({
    expiryDateStart: DEFAULT_EXPIRY_START,
    expiryDateEnd: DEFAULT_EXPIRY_END,
  });

  const handleOrgClick = useCallback((orgName: string) => {
    setFilters(prev => ({ ...prev, orgName, teamName: undefined, salesmanName: undefined }));
  }, []);

  const handleTeamClick = useCallback((teamName: string) => {
    setFilters(prev => ({ ...prev, teamName, salesmanName: undefined }));
  }, []);

  const handleReset = useCallback(() => {
    setFilters({ expiryDateStart: DEFAULT_EXPIRY_START, expiryDateEnd: DEFAULT_EXPIRY_END });
  }, []);

  const handleBreadcrumbOrg = useCallback(() => {
    setFilters(prev => ({ ...prev, teamName: undefined, salesmanName: undefined }));
  }, []);

  return (
    <div className="space-y-4">
      {/* 到期日范围筛选 */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className={textStyles.caption}>到期日范围</label>
        <input
          type="date"
          value={filters.expiryDateStart ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, expiryDateStart: e.target.value }))}
          className={cn(inputStyles.base, inputStyles.default, 'w-auto')}
        />
        <span className={textStyles.caption}>至</span>
        <input
          type="date"
          value={filters.expiryDateEnd ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, expiryDateEnd: e.target.value }))}
          className={cn(inputStyles.base, inputStyles.default, 'w-auto')}
        />
      </div>

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
