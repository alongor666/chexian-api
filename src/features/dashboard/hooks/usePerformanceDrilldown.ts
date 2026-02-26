import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
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
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'is_renewal',
];

interface UsePerformanceDrilldownProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
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
  enabled = true,
}: UsePerformanceDrilldownProps): UsePerformanceDrilldownReturn {
  const { isOrgUser, userOrg, canGoToTop, getMinDrillUpIndex } = useRBAC();
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

  const [summary, setSummary] = useState<PerformanceRow | null>(null);
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [drillPath, setDrillPath] = useState<PerformanceDrilldownStep[]>(initialDrillPath);
  const [currentGroupBy, setCurrentGroupBy] = useState<PerformanceDimension | null>(initialGroupBy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(initialGroupBy);
  }, [initialDrillPath, initialGroupBy]);

  const usedDimensions = new Set<PerformanceDimension>([
    ...drillPath.map((item) => item.dimension),
    ...(currentGroupBy ? [currentGroupBy] : []),
  ]);
  const availableDimensions = ALL_DIMENSIONS.filter((dim) => !usedDimensions.has(dim));

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
      delete filterParams.customerCategories;
      const result = await apiClient.getPerformanceDrilldown({
        ...filterParams,
        drillPath: drillPath.map((item) => ({ dimension: item.dimension, value: item.value })),
        groupBy: currentGroupBy || undefined,
        segmentTag,
        timePeriod,
        growthMode,
      });

      if (fetchId !== fetchIdRef.current) return;
      setSummary(result.summary ? mapRow(result.summary as Record<string, unknown>) : null);
      setRows((result.rows || []).map((row) => mapRow(row as Record<string, unknown>)));
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [currentGroupBy, drillPath, enabled, filters, growthMode, isOrgUser, segmentTag, timePeriod, userOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  return {
    summary,
    rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
    selectDimension,
    drillDown,
    drillUp,
    reset,
    loading,
    error,
    canGoToTop,
  };
}
