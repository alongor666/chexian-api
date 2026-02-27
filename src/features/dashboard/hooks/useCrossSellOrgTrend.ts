/**
 * 机构推介率走势 Hook
 *
 * 返回最近90天按日分组的车险件数/驾意件数/推介率
 * 支持险种组合（交三/主全/单交/整体）和机构（orgLevel3）切换
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { VehicleCategory } from './useCrossSellTimePeriod';

export type CoverageCombinationFilter = '整体' | '交三' | '主全' | '单交';

export interface OrgTrendPoint {
  date: string;
  auto_count: number;
  driver_count: number;
  rate: number;
  avg_premium: number;
}

interface UseCrossSellOrgTrendProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  coverageCombination: CoverageCombinationFilter;
  /** 图表内部选中的具体机构（覆盖 globalFilters 的 org 过滤） */
  selectedOrg: string | null;
  /**
   * 区域机构列表（null=全省不限制机构，[]/undefined=不额外覆盖）
   * 仅在 selectedOrg 为空时生效
   */
  regionOrgNames?: string[] | null;
  enabled?: boolean;
}

interface UseCrossSellOrgTrendReturn {
  rows: OrgTrendPoint[];
  loading: boolean;
  error: string | null;
}

export function useCrossSellOrgTrend({
  filters,
  vehicleCategory,
  coverageCombination,
  selectedOrg,
  regionOrgNames,
  enabled = true,
}: UseCrossSellOrgTrendProps): UseCrossSellOrgTrendReturn {
  const { isOrgUser, userOrg } = useRBAC();
  const [rows, setRows] = useState<OrgTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const baseParams = buildFilterParams(filters, { isOrgUser, userOrg });

      // 图表内部机构覆盖 globalFilters 的 org 过滤
      if (selectedOrg) {
        delete baseParams.orgNames;
        baseParams.orgLevel3 = selectedOrg;
      } else if (regionOrgNames === null) {
        // 全省：清空机构限制，按权限返回全部机构
        delete baseParams.orgNames;
        delete baseParams.orgLevel3;
      } else if (Array.isArray(regionOrgNames) && regionOrgNames.length > 0) {
        // 同城/异地：强制注入对应机构集合
        baseParams.orgNames = regionOrgNames.join(',');
        delete baseParams.orgLevel3;
      }

      const params: Record<string, string> = {
        ...baseParams,
        vehicleCategory,
        coverageCombination,
        days: '90',
      };

      const result = await apiClient.getCrossSellOrgTrend(params);
      if (fetchId !== fetchIdRef.current) return;

      setRows(
        (result?.rows || []).map((r) => ({
          date: String(r.date ?? ''),
          auto_count: Number(r.auto_count ?? 0),
          driver_count: Number(r.driver_count ?? 0),
          rate: Number(r.rate ?? 0),
          avg_premium: Number(r.avg_premium ?? 0),
        }))
      );
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [filters, vehicleCategory, coverageCombination, selectedOrg, regionOrgNames, enabled, isOrgUser, userOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, loading, error };
}
