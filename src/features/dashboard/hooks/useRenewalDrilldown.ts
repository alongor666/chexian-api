/**
 * 续保下钻分析 Hook
 *
 * 支持五层下钻：公司 → 机构 → 团队 → 业务员 → 险别组合
 * 通过面包屑导航回退到任意层级
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../../../shared/api/client';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { createLogger } from '../../../shared/utils/logger';

const logger = createLogger('useRenewalDrilldown');

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

export function useRenewalDrilldown(options: UseRenewalDrilldownOptions) {
  const { targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField = 'renewal_rate', sortOrder = 'desc' } = options;
  const { isDataLoaded } = useDataStatus();

  const [rows, setRows] = useState<DrilldownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([
    { level: 'company', label: '全公司' },
  ]);

  /** 当前层级 */
  const currentLevel = breadcrumb[breadcrumb.length - 1].level;
  /** 当前层级索引 */
  const currentLevelIndex = LEVEL_ORDER.indexOf(currentLevel);
  /** 下一层级（如果存在） */
  const nextLevel: DrilldownLevel | null =
    currentLevelIndex < LEVEL_ORDER.length - 1
      ? LEVEL_ORDER[currentLevelIndex + 1]
      : null;

  /** 从面包屑中提取筛选参数 */
  const getFiltersFromBreadcrumb = useCallback((bc: BreadcrumbItem[]) => {
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
  }, []);

  /** 获取数据 */
  const fetchData = useCallback(async (bc: BreadcrumbItem[]) => {
    if (!isDataLoaded) return;

    const currentItem = bc[bc.length - 1];
    // 下一层级作为 API 的 level 参数（即要展示的分组维度）
    const levelIndex = LEVEL_ORDER.indexOf(currentItem.level);
    const queryLevel = levelIndex < LEVEL_ORDER.length - 1
      ? LEVEL_ORDER[levelIndex + 1]
      : currentItem.level;

    const pathFilters = getFiltersFromBreadcrumb(bc);

    const params: Record<string, any> = {
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

    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.getRenewalDrilldown(params);
      setRows(Array.isArray(result) ? result : []);
    } catch (err) {
      logger.error('Failed to fetch renewal drilldown data', err);
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isDataLoaded, targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField, sortOrder, getFiltersFromBreadcrumb]);

  /** 下钻到下一层级 */
  const drillDown = useCallback((value: string) => {
    if (!nextLevel) return; // 已经是最底层
    setBreadcrumb(prev => {
      const newBc = [...prev, { level: nextLevel, label: value, value }];
      // 触发数据获取
      fetchData(newBc);
      return newBc;
    });
  }, [nextLevel, fetchData]);

  /** 导航到面包屑的某个位置 */
  const navigateTo = useCallback((index: number) => {
    setBreadcrumb(prev => {
      const newBc = prev.slice(0, index + 1);
      fetchData(newBc);
      return newBc;
    });
  }, [fetchData]);

  /** 重置到公司层级 */
  const reset = useCallback(() => {
    const initialBc: BreadcrumbItem[] = [{ level: 'company', label: '全公司' }];
    setBreadcrumb(initialBc);
    fetchData(initialBc);
  }, [fetchData]);

  // 初始加载 + 筛选条件变化时重新加载
  const prevOptionsRef = useRef('');
  useEffect(() => {
    const optionKey = `${targetYear}-${cutoffDate}-${bundleOnly}-${selfRenewalOnly}-${selectedDueMonth}-${sortField}-${sortOrder}-${isDataLoaded}`;
    if (optionKey !== prevOptionsRef.current) {
      prevOptionsRef.current = optionKey;
      fetchData(breadcrumb);
    }
  }, [targetYear, cutoffDate, bundleOnly, selfRenewalOnly, selectedDueMonth, sortField, sortOrder, isDataLoaded, fetchData, breadcrumb]);

  return {
    rows,
    loading,
    error,
    breadcrumb,
    currentLevel,
    nextLevel,
    canDrillDown: nextLevel !== null,
    drillDown,
    navigateTo,
    reset,
  };
}
