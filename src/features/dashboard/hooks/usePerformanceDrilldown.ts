import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { isTruckCategory } from '@/shared/config/customer-categories';
import {
  applyPerformanceHeatmapSelectionToParams,
  type PerformanceHeatmapSelection,
} from '../utils/performanceHeatmapSelection';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceTimePeriod,
} from './usePerformanceSummary';

export type PerformanceDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'tonnage_segment'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

export interface PerformanceDrilldownStep {
  dimension: PerformanceDimension;
  value: string;
  label: string;
}

export interface PerformanceRow {
  group_name: string;
  premium: number;
  auto_count: number;
  plan_premium: number | null;
  achievement_rate: number | null;
  growth_rate: number | null;
  quadrant?: string;
  nev_rate: number;
  renewal_rate: number;
  transfer_business_rate: number;
  new_car_rate: number;
  transfer_rate: number;
}

export const PERFORMANCE_DIMENSION_LABELS: Record<PerformanceDimension, string> = {
  org_level_3: '三级机构',
  team: '销售团队',
  salesman: '业务员',
  customer_category: '客户类别',
  tonnage_segment: '吨位分段',
  is_new_car: '是否新车',
  is_transfer: '是否过户',
  is_nev: '是否新能源',
  is_telemarketing: '是否电销',
  is_renewal: '是否续保',
};

const ALL_DIMENSIONS: PerformanceDimension[] = [
  'org_level_3',
  'team',
  'salesman',
  'customer_category',
  'tonnage_segment',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'is_renewal',
];


function computeAvailableDimensions(
  drillPath: PerformanceDrilldownStep[],
  currentGroupBy: PerformanceDimension | null
): PerformanceDimension[] {
  const usedDimensions = new Set<PerformanceDimension>([
    ...drillPath.map((item) => item.dimension),
    ...(currentGroupBy ? [currentGroupBy] : []),
  ]);

  const hasTonnageInPath = drillPath.some((step) => step.dimension === 'tonnage_segment');
  if (hasTonnageInPath || currentGroupBy === 'tonnage_segment') {
    return [];
  }

  const selectedCustomerCategory = [...drillPath].reverse().find((step) => step.dimension === 'customer_category')?.value;
  const canUseTonnage = selectedCustomerCategory != null && isTruckCategory(selectedCustomerCategory);

  return ALL_DIMENSIONS.filter((dim) => {
    if (usedDimensions.has(dim)) return false;
    if (dim === 'tonnage_segment') return canUseTonnage;
    return true;
  });
}

interface UsePerformanceDrilldownProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  heatmapSelection?: PerformanceHeatmapSelection | null;
  prefetched?: {
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
  };
  enabled?: boolean;
}

interface UsePerformanceDrilldownReturn {
  summary: PerformanceRow | null;
  rows: PerformanceRow[];
  drillPath: PerformanceDrilldownStep[];
  currentGroupBy: PerformanceDimension | null;
  availableDimensions: PerformanceDimension[];
  selectDimension: (dimension: PerformanceDimension) => void;
  drillDown: (rowValue: string, nextDimension: PerformanceDimension) => void;
  drillFromRoot: (
    rootValue: string,
    nextDimension: PerformanceDimension,
    rootDimension?: PerformanceDimension
  ) => void;
  drillUp: (toIndex: number) => void;
  reset: () => void;
  loading: boolean;
  error: string | null;
  canGoToTop: boolean;
}

function mapRow(raw: Record<string, unknown>): PerformanceRow {
  return {
    group_name: String(raw.group_name ?? ''),
    premium: Number(raw.premium ?? 0),
    auto_count: Number(raw.auto_count ?? 0),
    plan_premium: raw.plan_premium == null ? null : Number(raw.plan_premium),
    achievement_rate: raw.achievement_rate == null ? null : Number(raw.achievement_rate),
    growth_rate: raw.growth_rate == null ? null : Number(raw.growth_rate),
    quadrant: raw.quadrant == null ? undefined : String(raw.quadrant),
    nev_rate: Number(raw.nev_rate ?? 0),
    renewal_rate: Number(raw.renewal_rate ?? 0),
    transfer_business_rate: Number(raw.transfer_business_rate ?? 0),
    new_car_rate: Number(raw.new_car_rate ?? 0),
    transfer_rate: Number(raw.transfer_rate ?? 0),
  };
}

export function usePerformanceDrilldown({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  heatmapSelection = null,
  prefetched,
  enabled = true,
}: UsePerformanceDrilldownProps): UsePerformanceDrilldownReturn {
  const { isOrgUser, userOrg, canGoToTop, getMinDrillUpIndex } = useRBAC();

  // UI 状态：下钻路径和分组维度（不属于缓存数据，保留 useState）
  const initialDrillPath = useMemo<PerformanceDrilldownStep[]>(() => {
    if (isOrgUser && userOrg) {
      return [{ dimension: 'org_level_3', value: userOrg, label: `三级机构: ${userOrg}` }];
    }
    return [];
  }, [isOrgUser, userOrg]);

  const initialGroupBy = useMemo<PerformanceDimension | null>(() => {
    if (isOrgUser) return 'salesman';
    return 'org_level_3';
  }, [isOrgUser]);

  const [drillPath, setDrillPath] = useState<PerformanceDrilldownStep[]>(initialDrillPath);
  const [currentGroupBy, setCurrentGroupBy] = useState<PerformanceDimension | null>(initialGroupBy);

  // 当角色/机构变更时同步重置下钻状态
  useEffect(() => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(initialGroupBy);
  }, [initialDrillPath, initialGroupBy]);

  // 构建 API 请求参数（drillPath/currentGroupBy 变化时 query key 自动失效）
  const apiParams = useMemo(() => {
    const filterParams = applyPerformanceHeatmapSelectionToParams(
      buildFilterParams(filters, { isOrgUser, userOrg }),
      heatmapSelection,
      timePeriod
    );
    delete filterParams.customerCategories;
    return {
      ...filterParams,
      drillPath: drillPath.map((item) => ({ dimension: item.dimension, value: item.value })),
      groupBy: currentGroupBy || undefined,
      segmentTag,
      timePeriod,
      growthMode,
    };
  }, [filters, isOrgUser, userOrg, heatmapSelection, timePeriod, drillPath, currentGroupBy, segmentTag, growthMode]);

  // useQuery 替代手动 fetch + fetchIdRef，自动处理竞态和缓存
  const { data: queryData, isLoading, error: queryError } = useQuery({
    queryKey: ['performance-drilldown', apiParams],
    queryFn: () => apiClient.performance.drilldown(apiParams),
    enabled: enabled && !prefetched,
    select: (result) => ({
      summary: result.summary ? mapRow(result.summary as Record<string, unknown>) : null,
      rows: (result.rows || []).map((row) => mapRow(row as Record<string, unknown>)),
    }),
  });

  // 合并预取数据与 query 数据：prefetched 存在时直接使用，否则使用 queryData
  const summary = prefetched
    ? (prefetched.summary ? mapRow(prefetched.summary) : null)
    : (queryData?.summary ?? null);
  const rows = prefetched
    ? (prefetched.rows || []).map((row) => mapRow(row))
    : (queryData?.rows ?? []);

  const availableDimensions = useMemo(
    () => computeAvailableDimensions(drillPath, currentGroupBy),
    [drillPath, currentGroupBy]
  );

  const selectDimension = useCallback((dimension: PerformanceDimension) => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(dimension);
  }, [initialDrillPath]);

  const drillDown = useCallback((rowValue: string, nextDimension: PerformanceDimension) => {
    if (!currentGroupBy) return;
    setDrillPath((prev) => ([
      ...prev,
      {
        dimension: currentGroupBy,
        value: rowValue,
        label: `${PERFORMANCE_DIMENSION_LABELS[currentGroupBy]}: ${rowValue}`,
      },
    ]));
    setCurrentGroupBy(nextDimension);
  }, [currentGroupBy]);

  const drillFromRoot = useCallback((
    rootValue: string,
    nextDimension: PerformanceDimension,
    rootDimension: PerformanceDimension = 'org_level_3'
  ) => {
    const normalizedRootValue = rootValue.trim();
    if (!normalizedRootValue) return;

    setDrillPath(() => {
      const basePath = initialDrillPath.length > 0 ? [...initialDrillPath] : [];
      const inInitialPath = basePath.some((step) => step.dimension === rootDimension && step.value === normalizedRootValue);
      if (!inInitialPath) {
        basePath.push({
          dimension: rootDimension,
          value: normalizedRootValue,
          label: `${PERFORMANCE_DIMENSION_LABELS[rootDimension]}: ${normalizedRootValue}`,
        });
      }
      return basePath;
    });
    setCurrentGroupBy(nextDimension);
  }, [initialDrillPath]);

  const drillUp = useCallback((toIndex: number) => {
    const minIndex = getMinDrillUpIndex(-1);
    if (toIndex <= minIndex) {
      setDrillPath(initialDrillPath);
      setCurrentGroupBy(initialGroupBy);
      return;
    }

    if (toIndex < drillPath.length && toIndex > minIndex) {
      const newPath = drillPath.slice(0, toIndex);
      const restoredGroupBy = drillPath[toIndex].dimension;
      setDrillPath(newPath);
      setCurrentGroupBy(restoredGroupBy);
    }
  }, [drillPath, getMinDrillUpIndex, initialDrillPath, initialGroupBy]);

  const reset = useCallback(() => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(initialGroupBy);
  }, [initialDrillPath, initialGroupBy]);

  const loading = prefetched ? false : isLoading;
  const error = prefetched
    ? null
    : (queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null);

  return {
    summary,
    rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
    selectDimension,
    drillDown,
    drillFromRoot,
    drillUp,
    reset,
    loading,
    error,
    canGoToTop,
  };
}
