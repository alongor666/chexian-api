/**
 * 续保追踪 API Hook（React Query）
 *
 * 同时接入主站 FilterProvider（仅使用非时间维度：机构/业务员/客户类别），
 * 时间维度由 RenewalTrackerPage 本地 state 独立管理（expiry_date 语义）。
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import type { TimeRange, RenewalTrackerResponse } from '../types';

/**
 * 从 FilterProvider 的 AdvancedFilterState 里读取非时间维度的多选值，
 * 返回可直接喂给 `/api/query/renewal-tracker` 的 CSV 参数。
 */
function useNonTimeFilterParams(): {
  orgNames?: string;
  salesmanNames?: string;
  customerCategories?: string;
} {
  const { filters } = useGlobalFilters();
  const out: Record<string, string> = {};
  if (filters.org_level_3 && filters.org_level_3.length > 0) {
    out.orgNames = filters.org_level_3.join(',');
  }
  if (filters.salesman_name && filters.salesman_name.length > 0) {
    out.salesmanNames = filters.salesman_name.join(',');
  }
  if (filters.customer_category && filters.customer_category.length > 0) {
    out.customerCategories = filters.customer_category.join(',');
  }
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
