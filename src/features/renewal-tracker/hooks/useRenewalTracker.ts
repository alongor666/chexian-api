/**
 * 续保追踪 API Hook（React Query）
 *
 * 同时接入主站 FilterProvider（非时间维度：机构/业务员/客户类别 + 快捷筛选），
 * 时间维度由 RenewalTrackerPage 本地 state 独立管理（expiry_date 语义）。
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import type { TimeRange, RenewalTrackerResponse } from '../types';

/**
 * 从 FilterProvider 的 AdvancedFilterState 里读取非时间维度的值，
 * 返回可直接喂给 `/api/query/renewal-tracker` 的参数（CSV 或 boolean 字符串）。
 */
function useNonTimeFilterParams(): Record<string, string> {
  const { filters } = useGlobalFilters();
  const out: Record<string, string> = {};

  // 基础 3 维度（字符串多选）
  if (filters.org_level_3 && filters.org_level_3.length > 0) {
    out.orgNames = filters.org_level_3.join(',');
  }
  if (filters.salesman_name && filters.salesman_name.length > 0) {
    out.salesmanNames = filters.salesman_name.join(',');
  }
  if (filters.customer_category && filters.customer_category.length > 0) {
    out.customerCategories = filters.customer_category.join(',');
  }

  // 快捷筛选：险别组合
  if (filters.coverage_combination && filters.coverage_combination.length > 0) {
    out.coverageCombinations = filters.coverage_combination.join(',');
  }

  // 快捷筛选：能源类型（本期 is_nev → oil/electric，gas 未覆盖）
  if (filters.fuel_category) {
    // AdvancedFilterState.fuel_category 是 'oil' | 'gas' | 'electric'
    // RenewalTrackerFact.fuel_category 已派生为 '油' / '电' 中文
    const map: Record<string, string> = { oil: '油', electric: '电', gas: '气' };
    const value = map[filters.fuel_category];
    if (value) out.fuelCategories = value;
  }

  // 布尔开关（QuickFilterBar 直接写入）
  if (typeof filters.is_nev === 'boolean') out.isNev = String(filters.is_nev);
  if (typeof filters.is_new_car === 'boolean') out.isNewCar = String(filters.is_new_car);
  if (typeof filters.is_transfer === 'boolean') out.isTransfer = String(filters.is_transfer);
  if (typeof filters.is_renewal === 'boolean') out.isRenewal = String(filters.is_renewal);

  return out;
}

export function useRenewalTracker(timeRange: TimeRange | null) {
  const filterParams = useNonTimeFilterParams();

  return useQuery({
    queryKey: ['renewal-tracker', timeRange, filterParams],
    queryFn: () => {
      if (!timeRange) throw new Error('timeRange is required');
      return apiClient.getRenewalTracker({
        start: timeRange.start,
        end: timeRange.end,
        cutoff: timeRange.cutoff,
        ...filterParams,
      }) as Promise<RenewalTrackerResponse>;
    },
    enabled: !!timeRange,
  });
}
