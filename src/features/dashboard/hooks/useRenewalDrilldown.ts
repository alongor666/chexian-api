/**
 * 续保下钻分析 Hook
 *
 * 支持五层下钻：公司 → 机构 → 团队 → 业务员 → 险别组合
 * 通过面包屑导航回退到任意层级
 *
 * 数据请求由 React Query 管理，breadcrumb 变化自动触发重新查询。
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { formatSalesmanName, formatTeamName } from '../../../shared/utils/formatters';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import { queryKeys } from '../../../shared/api/query-keys';

/** 下钻层级顺序 */
const LEVEL_ORDER = ['company', 'org', 'team', 'salesman', 'coverage'] as const;
type DrilldownLevel = typeof LEVEL_ORDER[number];

/** 面包屑项 */
export interface BreadcrumbItem {
  level: DrilldownLevel;
  label: string;
  /** 该层选中的值（用于向后端传递筛选参数） */
  value?: string;
}

/** 下钻行数据 */
export interface DrilldownRow {
  group_name: string;
  parent_name: string;
  level_type: string;
  due_count: number;
  renewed_count: number;
  quoted_count: number;
  due_premium: number;
  renewed_premium: number;
  quoted_premium: number;
  renewal_rate: number;
  quote_rate: number;
  renewal_premium_rate: number;
  quote_premium_rate: number;
  rank_asc: number;
  rank_desc: number;
}

interface UseRenewalDrilldownOptions {
  targetYear: number;
  cutoffDate?: string;
  bundleOnly: boolean;
  selfRenewalOnly: boolean;
  selectedDueMonth: number | null;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

/** 从面包屑中提取筛选参数 */
function getFiltersFromBreadcrumb(bc: BreadcrumbItem[]): Record<string, string | undefined> {
  const filters: Record<string, string | undefined> = {};
  for (const item of bc) {
    if (!item.value) continue;
    switch (item.level) {
      case 'company':
        break; // 公司级无筛选
      case 'org':
        filters.orgFilter = item.value;
        break;
      case 'team':
        filters.teamFilter = item.value;
        break;
      case 'salesman':
        filters.salesmanFilter = item.value;
        break;
    }
  }
  return filters;
}

/** 构建 API 请求参数 */
function buildDrilldownParams(
  bc: BreadcrumbItem[],
  options: UseRenewalDrilldownOptions,
): Record<string, unknown> {
  const { targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField = 'renewal_rate', sortOrder = 'desc' } = options;
  const currentItem = bc[bc.length - 1];
  const levelIndex = LEVEL_ORDER.indexOf(currentItem.level);
  const queryLevel = levelIndex < LEVEL_ORDER.length - 1
    ? LEVEL_ORDER[levelIndex + 1]
    : currentItem.level;

  const pathFilters = getFiltersFromBreadcrumb(bc);

  return {
    targetYear,
    level: queryLevel,
    ...pathFilters,
    selfRenewalOnly: selfRenewalOnly ? 'true' : undefined,
    bundleOnly: bundleOnly ? 'true' : undefined,
    dueMonth: selectedDueMonth || undefined,
    cutoffDate,
    sortField,
    sortOrder,
  };
}

/** 映射 API 行数据 */
function mapDrilldownRows(result: unknown, queryLevel: string): DrilldownRow[] {
  return (Array.isArray(result) ? result : []).map((row: Record<string, unknown>) => {
    const groupName = String(row.group_name ?? '');
    const parentName = String(row.parent_name ?? '');

    return {
      ...row,
      group_name: queryLevel === 'team' ? formatTeamName(groupName) : queryLevel === 'salesman' ? formatSalesmanName(groupName) : groupName,
      parent_name: queryLevel === 'coverage' ? formatSalesmanName(parentName) : parentName,
    } as DrilldownRow;
  });
}

export function useRenewalDrilldown(options: UseRenewalDrilldownOptions) {
  const { targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField = 'renewal_rate', sortOrder = 'desc' } = options;
  const { isDataLoaded } = useDataStatus();
  const { isOrgUser, userOrg, getMinDrillUpIndex } = useRBAC();

  const initialBreadcrumb: BreadcrumbItem[] = useMemo(() => {
    if (isOrgUser && userOrg) {
      return [
        { level: 'company', label: '全公司' },
        { level: 'org', label: userOrg, value: userOrg }
      ];
    }
    return [{ level: 'company', label: '全公司' }];
  }, [isOrgUser, userOrg]);

  // UI 导航状态：面包屑（保留 useState，不属于服务端缓存数据）
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>(initialBreadcrumb);

  // 当用户身份变化时，重置
  useEffect(() => {
    setBreadcrumb(initialBreadcrumb);
  }, [initialBreadcrumb]);

  /** 当前层级 */
  const currentLevel = breadcrumb[breadcrumb.length - 1].level;
  /** 当前层级索引 */
  const currentLevelIndex = LEVEL_ORDER.indexOf(currentLevel);
  /** 下一层级（如果存在） */
  const nextLevel: DrilldownLevel | null =
    currentLevelIndex < LEVEL_ORDER.length - 1
      ? LEVEL_ORDER[currentLevelIndex + 1]
      : null;

  // 构建请求参数（breadcrumb + options 变化时 query key 自动失效）
  const apiParams = useMemo(
    () => buildDrilldownParams(breadcrumb, options),
    [breadcrumb, targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField, sortOrder],
  );

  // 当前查询层级（用于行数据映射）
  const queryLevel = useMemo(() => {
    const levelIndex = LEVEL_ORDER.indexOf(currentLevel);
    return levelIndex < LEVEL_ORDER.length - 1
      ? LEVEL_ORDER[levelIndex + 1]
      : currentLevel;
  }, [currentLevel]);

  // useQuery 替代手动 fetchData + prevOptionsRef，自动处理竞态和缓存
  const { data: rows = [], isLoading, error: queryError } = useQuery({
    queryKey: queryKeys.renewalDrilldown(apiParams),
    queryFn: () => apiClient.getRenewalDrilldown(apiParams as Record<string, any>),
    enabled: isDataLoaded,
    select: (result) => mapDrilldownRows(result, queryLevel),
  });

  /** 下钻到下一层级 */
  const drillDown = useCallback((value: string) => {
    if (!nextLevel) return;
    setBreadcrumb(prev => [...prev, { level: nextLevel, label: value, value }]);
  }, [nextLevel]);

  /** 导航到面包屑的某个位置 */
  const navigateTo = useCallback((index: number) => {
    const safeMinIndex = getMinDrillUpIndex(0);
    if (index < safeMinIndex) return;
    setBreadcrumb(prev => prev.slice(0, index + 1));
  }, [getMinDrillUpIndex]);

  /** 重置到公司层级 */
  const reset = useCallback(() => {
    setBreadcrumb(initialBreadcrumb);
  }, [initialBreadcrumb]);

  return {
    rows,
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null,
    breadcrumb,
    currentLevel,
    nextLevel,
    canDrillDown: nextLevel !== null,
    drillDown,
    navigateTo,
    reset,
    canGoToTop: !isOrgUser,
  };
}
