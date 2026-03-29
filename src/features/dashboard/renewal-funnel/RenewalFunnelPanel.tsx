/**
 * 续保漏斗分析 — 主面板
 *
 * 集成 Overview、Team、ActionList、Salesman 四大组件
 * 交互：点击机构→展开团队→展开业务员，面包屑导航
 * 支持：年视图/月视图、客户类别视图
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { RenewalFunnelOverviewPanel } from './RenewalFunnelOverviewPanel';
import { RenewalFunnelTeamPanel } from './RenewalFunnelTeamPanel';
import { RenewalFunnelActionList } from './RenewalFunnelActionList';
import { useRenewalFunnelMetadata, useRenewalFunnelSalesman } from './hooks/useRenewalFunnel';
import { textStyles, cn, buttonStyles, inputStyles, cardStyles, tableStyles, fontStyles, colorClasses } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import type { FunnelFilters } from './types';

const DEFAULT_EXPIRY_START = '2026-01-01';

export const RenewalFunnelPanel: React.FC = () => {
  const { data: metadata } = useRenewalFunnelMetadata();

  const [viewMode, setViewMode] = useState<'year' | 'month'>('year');
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>();
  const [groupBy, setGroupBy] = useState<'org' | 'category' | 'renewalMode'>('org');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedRenewalMode, setSelectedRenewalMode] = useState<string | undefined>();

  // 计算到期日范围
  const expiryDateEnd = metadata?.maxExpiryDate ?? '2026-05-31';

  const [filters, setFilters] = useState<FunnelFilters>({
    expiryDateStart: DEFAULT_EXPIRY_START,
    expiryDateEnd,
  });

  // metadata 加载后更新 expiryDateEnd 默认值
  useEffect(() => {
    if (metadata?.maxExpiryDate) {
      setFilters(prev => {
        // 仅当还是初始默认值时更新
        if (prev.expiryDateEnd === '2026-05-31' || !prev.expiryDateEnd) {
          return { ...prev, expiryDateEnd: metadata.maxExpiryDate };
        }
        return prev;
      });
    }
  }, [metadata?.maxExpiryDate]);

  // 月视图：选中月份时覆盖日期范围
  useEffect(() => {
    if (viewMode === 'month' && selectedMonth) {
      const [y, m] = selectedMonth.split('-').map(Number);
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      setFilters(prev => ({ ...prev, expiryDateStart: start, expiryDateEnd: end }));
    } else if (viewMode === 'year') {
      setFilters(prev => ({
        ...prev,
        expiryDateStart: DEFAULT_EXPIRY_START,
        expiryDateEnd: metadata?.maxExpiryDate ?? '2026-05-31',
      }));
    }
  }, [viewMode, selectedMonth, metadata?.maxExpiryDate]);

  // groupBy 同步到 filters
  const effectiveFilters = useMemo<FunnelFilters>(() => ({
    ...filters,
    groupBy: groupBy === 'org' ? undefined : groupBy,
    category: groupBy === 'category' ? selectedCategory : undefined,
    renewalMode: selectedRenewalMode,
  }), [filters, groupBy, selectedCategory, selectedRenewalMode]);

  // 可用月份列表
  const availableMonths = useMemo(() => {
    if (metadata?.availableMonths?.length) return metadata.availableMonths;
    // fallback: 从起止日期生成
    const start = DEFAULT_EXPIRY_START;
    const end = metadata?.maxExpiryDate ?? '2026-05-31';
    const months: string[] = [];
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let cy = sy, cm = sm;
    while (cy < ey || (cy === ey && cm <= em)) {
      months.push(`${cy}-${String(cm).padStart(2, '0')}`);
      cm++;
      if (cm > 12) { cm = 1; cy++; }
    }
    return months;
  }, [metadata]);

  const handleOrgClick = useCallback((orgName: string) => {
    setFilters(prev => ({ ...prev, orgName, teamName: undefined, salesmanName: undefined }));
    setGroupBy('org');
  }, []);

  const handleCategoryClick = useCallback((category: string) => {
    setSelectedCategory(category);
  }, []);

  const handleTeamClick = useCallback((teamName: string) => {
    setFilters(prev => ({ ...prev, teamName, salesmanName: undefined }));
  }, []);

  const handleRenewalModeClick = useCallback((mode: string) => {
    setSelectedRenewalMode(mode);
  }, []);

  const handleReset = useCallback(() => {
    setFilters(prev => ({
      expiryDateStart: prev.expiryDateStart,
      expiryDateEnd: prev.expiryDateEnd,
    }));
    setGroupBy('org');
    setSelectedCategory(undefined);
    setSelectedRenewalMode(undefined);
  }, []);

  const handleBreadcrumbOrg = useCallback(() => {
    setFilters(prev => ({ ...prev, teamName: undefined, salesmanName: undefined }));
  }, []);

  return (
    <div className="space-y-4">
      {/* 筛选器行 */}
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

        {/* 分隔线 */}
        <span className="w-px h-6 bg-neutral-200" />

        {/* 视图模式切换 */}
        <button
          onClick={() => { setViewMode('year'); setSelectedMonth(undefined); }}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            viewMode === 'year' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          年视图
        </button>
        <button
          onClick={() => setViewMode('month')}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            viewMode === 'month' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          月视图
        </button>

        {/* 分隔线 */}
        <span className="w-px h-6 bg-neutral-200" />

        {/* 分组视角 */}
        <button
          onClick={() => { setGroupBy('org'); setSelectedCategory(undefined); }}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            groupBy === 'org' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          机构
        </button>
        <button
          onClick={() => { setGroupBy('category'); }}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            groupBy === 'category' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          客户类别
        </button>
        <button
          onClick={() => { setGroupBy('renewalMode'); }}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            groupBy === 'renewalMode' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          续保模式
        </button>

        {/* 分隔线 */}
        <span className="w-px h-6 bg-neutral-200" />

        {/* 续保模式筛选 */}
        <button
          onClick={() => setSelectedRenewalMode(undefined)}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            !selectedRenewalMode ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          全部
        </button>
        <button
          onClick={() => setSelectedRenewalMode('自留')}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            selectedRenewalMode === '自留' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          自留
        </button>
        <button
          onClick={() => setSelectedRenewalMode('兜底')}
          className={cn(
            buttonStyles.base, buttonStyles.sizeSmall,
            selectedRenewalMode === '兜底' ? buttonStyles.primary : buttonStyles.secondary
          )}
        >
          兜底
        </button>
      </div>

      {/* 月视图 — 月份按钮组 */}
      {viewMode === 'month' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={textStyles.caption}>到期月份</span>
          {availableMonths.map(m => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={cn(
                buttonStyles.base, buttonStyles.sizeSmall,
                selectedMonth === m ? buttonStyles.primary : buttonStyles.secondary
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* 客户类别 — 类别按钮组 */}
      {groupBy === 'category' && metadata?.categories && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={textStyles.caption}>客户类别</span>
          <button
            onClick={() => setSelectedCategory(undefined)}
            className={cn(
              buttonStyles.base, buttonStyles.sizeSmall,
              !selectedCategory ? buttonStyles.primary : buttonStyles.secondary
            )}
          >
            全部
          </button>
          {metadata.categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                buttonStyles.base, buttonStyles.sizeSmall,
                selectedCategory === cat ? buttonStyles.primary : buttonStyles.secondary
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 面包屑导航 */}
      {(filters.orgName || filters.teamName || (groupBy === 'category' && selectedCategory) || (groupBy === 'renewalMode')) && (
        <nav className="flex items-center gap-1 text-sm">
          <button onClick={handleReset} className={textStyles.link}>
            {groupBy === 'category' ? '全部类别' : groupBy === 'renewalMode' ? '全部模式' : '全部机构'}
          </button>
          {groupBy === 'category' && selectedCategory && (
            <>
              <span className="text-neutral-400">/</span>
              <span className="font-medium text-neutral-700">{selectedCategory}</span>
            </>
          )}
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
        filters={effectiveFilters}
        onOrgClick={handleOrgClick}
        onCategoryClick={handleCategoryClick}
        onRenewalModeClick={handleRenewalModeClick}
      />

      {/* 团队排行（选中机构时显示） */}
      <RenewalFunnelTeamPanel
        filters={effectiveFilters}
        onTeamClick={handleTeamClick}
      />

      {/* 业务员排行（选中团队时显示） */}
      {effectiveFilters.teamName && (
        <SalesmanRankPanel filters={effectiveFilters} />
      )}

      {/* 待跟进清单 */}
      <RenewalFunnelActionList filters={effectiveFilters} />
    </div>
  );
};

/** 业务员排行面板（内联简单组件） */
const SalesmanRankPanel: React.FC<{ filters: FunnelFilters }> = ({ filters }) => {
  const { data, isLoading } = useRenewalFunnelSalesman(filters);

  return (
    <div className={cardStyles.standard}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={textStyles.titleSmall}>
          {filters.teamName} — 业务员续保排行
        </h3>
        <span className={textStyles.caption}>
          {(data ?? []).length} 位业务员
        </span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-neutral-100 rounded" />
          ))}
        </div>
      ) : (data ?? []).length === 0 ? (
        <p className={textStyles.caption}>暂无数据</p>
      ) : (
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>业务员</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>应续</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>已报价</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>已续保</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>续保率</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>自留</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>自留率</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>竞争单</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? [])
                .sort((a, b) => (b.renewal_rate ?? 0) - (a.renewal_rate ?? 0))
                .map(row => (
                  <tr key={row.salesman_name} className={tableStyles.row}>
                    <td className={tableStyles.cell}>{row.salesman_name || '未分配'}</td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {formatCount(row.total_due ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {formatCount(row.total_quoted ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {formatCount(row.total_renewed ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      <RateCell value={row.renewal_rate ?? 0} />
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {formatCount(row.self_retained_count ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {(row.self_retention_rate ?? 0).toFixed(1)}%
                    </td>
                    <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                      {(row.competitive_count ?? 0) > 0 && (
                        <span className={colorClasses.text.warning}>{row.competitive_count}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const RateCell: React.FC<{ value: number }> = ({ value }) => {
  const colorClass =
    value >= 60 ? colorClasses.text.success
    : value >= 45 ? colorClasses.text.warning
    : colorClasses.text.danger;
  return <span className={cn(colorClass, 'font-semibold')}>{value.toFixed(1)}%</span>;
};
