/**
 * 续保下钻分析 Hook (V2 — 自由维度)
 *
 * 支持任意维度组合下钻，用户可选择下一个分组维度。
 * 通过 drillPath + groupBy 向后端传参，DrilldownCell 弹窗选择维度。
 *
 * 向后兼容：RBAC 机构用户自动注入 org_level_3 到 drillPath。
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { formatSalesmanName, formatTeamName } from '../../../shared/utils/formatters';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import { queryKeys } from '../../../shared/api/query-keys';
import {
  RENEWAL_DIMENSIONS,
  DIMENSION_LABELS,
  getConditionalDimensions,
  type RenewalDrillDimension,
} from '../../../shared/config/drilldown-dimensions';

/** 下钻路径步骤 */
export interface DrillStep {
  dimension: RenewalDrillDimension;
  value: string;
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

/** 映射 API 行数据：清理姓名格式 */
function mapDrilldownRows(result: unknown, groupBy: string): DrilldownRow[] {
  return (Array.isArray(result) ? result : []).map((row: Record<string, unknown>) => {
    const groupName = String(row.group_name ?? '');
    return {
      ...row,
      group_name:
        groupBy === 'team' ? formatTeamName(groupName) :
        groupBy === 'salesman' ? formatSalesmanName(groupName) :
        groupName,
    } as DrilldownRow;
  });
}

/** 根据 drillPath 计算剩余可选维度 */
function computeAvailableDimensions(
  drillPath: DrillStep[],
  currentGroupBy: RenewalDrillDimension | null,
): RenewalDrillDimension[] {
  const usedDimensions = new Set<string>(drillPath.map((s) => s.dimension));
  if (currentGroupBy) usedDimensions.add(currentGroupBy);

  // 条件维度（如 insurance_grade）
  const conditionalExtras = getConditionalDimensions(drillPath);

  const base = RENEWAL_DIMENSIONS.filter((d) => !usedDimensions.has(d));
  const extras = conditionalExtras.filter(
    (d) => !usedDimensions.has(d) && !base.includes(d as RenewalDrillDimension),
  );

  return [...base, ...extras] as RenewalDrillDimension[];
}

export function useRenewalDrilldown(options: UseRenewalDrilldownOptions) {
  const {
    targetYear, cutoffDate, bundleOnly, selfRenewalOnly,
    selectedDueMonth, sortField = 'renewal_rate', sortOrder = 'desc',
  } = options;
  const { isDataLoaded } = useDataStatus();
  const { isOrgUser, userOrg } = useRBAC();

  // ── 状态：drillPath + 当前分组维度 ──
  const [drillPath, setDrillPath] = useState<DrillStep[]>(() => {
    // 机构用户自动锚定到其机构
    if (isOrgUser && userOrg) {
      return [{ dimension: 'org_level_3' as RenewalDrillDimension, value: userOrg }];
    }
    return [];
  });

  const [currentGroupBy, setCurrentGroupBy] = useState<RenewalDrillDimension>('org_level_3');

  // 可选维度（排除已用维度）
  const availableDimensions = useMemo(
    () => computeAvailableDimensions(drillPath, currentGroupBy),
    [drillPath, currentGroupBy],
  );

  // ── 构建面包屑（用于 DrilldownBreadcrumb 展示） ──
  const breadcrumb = useMemo(() => {
    return drillPath.map((step) => ({
      label: step.value,
      dimension: step.dimension,
      value: step.value,
    }));
  }, [drillPath]);

  // ── API 请求参数 ──
  const apiParams = useMemo(() => ({
    targetYear,
    groupBy: currentGroupBy,
    drillPath: JSON.stringify(drillPath),
    selfRenewalOnly: selfRenewalOnly ? 'true' : undefined,
    bundleOnly: bundleOnly ? 'true' : undefined,
    dueMonth: selectedDueMonth || undefined,
    cutoffDate,
    sortField,
    sortOrder,
  }), [targetYear, currentGroupBy, drillPath, selfRenewalOnly, bundleOnly, selectedDueMonth, cutoffDate, sortField, sortOrder]);

  // ── 查询 ──
  const { data: rows = [], isLoading, error: queryError } = useQuery({
    queryKey: queryKeys.renewalDrilldown(apiParams),
    queryFn: () => apiClient.getRenewalDrilldown(apiParams as Record<string, any>),
    enabled: isDataLoaded,
    select: (result) => mapDrilldownRows(result, currentGroupBy),
  });

  /** 下钻：选择某行的值 + 下一个分组维度 */
  const drillDown = useCallback((value: string, nextDimension: RenewalDrillDimension) => {
    setDrillPath((prev) => [...prev, { dimension: currentGroupBy, value }]);
    setCurrentGroupBy(nextDimension);
  }, [currentGroupBy]);

  /** 面包屑导航：回到某一步 */
  const navigateTo = useCallback((index: number) => {
    if (index < 0) {
      // 回到最顶层
      const initialPath = isOrgUser && userOrg
        ? [{ dimension: 'org_level_3' as RenewalDrillDimension, value: userOrg }]
        : [];
      setDrillPath(initialPath);
      setCurrentGroupBy('org_level_3');
      return;
    }
    // 保留 [0..index] 的路径，当前 groupBy 设为 index+1 步的维度（如果存在）
    const newPath = drillPath.slice(0, index + 1);
    // 回退到 index 位置后，恢复该步之后的分组维度
    const nextGroupBy = index + 1 < drillPath.length
      ? drillPath[index + 1].dimension
      : currentGroupBy;
    setDrillPath(newPath);
    setCurrentGroupBy(nextGroupBy);
  }, [drillPath, currentGroupBy, isOrgUser, userOrg]);

  /** 重置到初始状态 */
  const reset = useCallback(() => {
    const initialPath = isOrgUser && userOrg
      ? [{ dimension: 'org_level_3' as RenewalDrillDimension, value: userOrg }]
      : [];
    setDrillPath(initialPath);
    setCurrentGroupBy('org_level_3');
  }, [isOrgUser, userOrg]);

  return {
    rows,
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null,
    breadcrumb,
    drillPath,
    currentGroupBy,
    availableDimensions,
    canDrillDown: availableDimensions.length > 0,
    drillDown,
    navigateTo,
    reset,
    canGoToTop: !isOrgUser,
    dimensionLabels: DIMENSION_LABELS,
  };
}
