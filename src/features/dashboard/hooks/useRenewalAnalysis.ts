/**
 * 续保分析数据 Hook（React Query 模式）
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/query-keys';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { createLogger } from '../../../shared/utils/logger';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { ViewPerspective } from '../../../shared/types';
import { useRBAC } from '../../../shared/hooks/useRBAC';

const logger = createLogger('useRenewalAnalysis');

interface RenewalDetailRow {
  month_day: string;
  daily_due_count: number;
  daily_renewed_count: number;
  daily_renewal_rate: number;
  month_to_date_due_count: number;
  month_to_date_renewed_count: number;
  monthly_renewal_rate: number;
  year_to_date_due_count: number;
  year_to_date_renewed_count: number;
  yearly_renewal_rate: number;
}

interface UseRenewalAnalysisProps {
  filters: AdvancedFilterState;
  perspective: ViewPerspective;
  selectedMonth: number;
  targetYear?: number;
  enabled?: boolean;
}

interface UseRenewalAnalysisReturn {
  detailData: RenewalDetailRow[];
  availableMonths: number[];
  latestPolicyDate: string | null;
  loading: boolean;
  error: string | null;
  hasCheckedAvailability: boolean;
  refresh: () => Promise<void>;
  checkAvailableMonths: () => Promise<void>;
}

interface RenewalApiResult {
  detailData: RenewalDetailRow[];
  availableMonths: number[];
  latestPolicyDate: string | null;
}

/**
 * 格式化月日
 */
function formatMonthDay(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  }
  return String(value);
}

/**
 * 续保分析数据 Hook
 */
export function useRenewalAnalysis({
  filters,
  perspective,
  selectedMonth,
  targetYear,
  enabled = true,
}: UseRenewalAnalysisProps): UseRenewalAnalysisReturn {
  const effectiveYear = targetYear ?? filters.analysis_year ?? new Date().getFullYear();
  const { isOrgUser, userOrg } = useRBAC();
  const queryClient = useQueryClient();

  // 续保分析排除日期范围，保留机构等筛选
  const renewalFilters: AdvancedFilterState = {
    ...filters,
    policy_date_start: undefined,
    policy_date_end: undefined,
  };

  const params: Record<string, unknown> = {
    ...buildFilterParams(renewalFilters, { isOrgUser, userOrg }),
    queryType: 'full' as const,
    targetYear: effectiveYear,
    targetMonth: selectedMonth,
    // perspective 作为 cache key 的一部分，但不传给 API
    _perspective: perspective,
  };

  const { data, isLoading, error: queryError } = useQuery<RenewalApiResult>({
    queryKey: queryKeys.renewalAnalysis(params),
    queryFn: async () => {
      logger.debug('Fetching renewal data from API', params);

      const result = await apiClient.getRenewalAnalysis({
        ...buildFilterParams(renewalFilters, { isOrgUser, userOrg }),
        queryType: 'full' as const,
        targetYear: effectiveYear,
        targetMonth: selectedMonth,
      });

      const detailData: RenewalDetailRow[] = (result?.detailData ?? []).map(
        (row: Record<string, unknown>) => ({
          month_day: formatMonthDay(row.month_day),
          daily_due_count: Number(row.daily_due_count ?? 0),
          daily_renewed_count: Number(row.daily_renewed_count ?? 0),
          daily_renewal_rate: Number(row.daily_renewal_rate ?? 0),
          month_to_date_due_count: Number(row.month_to_date_due_count ?? 0),
          month_to_date_renewed_count: Number(row.month_to_date_renewed_count ?? 0),
          monthly_renewal_rate: Number(row.monthly_renewal_rate ?? 0),
          year_to_date_due_count: Number(row.year_to_date_due_count ?? 0),
          year_to_date_renewed_count: Number(row.year_to_date_renewed_count ?? 0),
          yearly_renewal_rate: Number(row.yearly_renewal_rate ?? 0),
        }),
      );

      return {
        detailData,
        availableMonths: result?.availableMonths ?? [],
        latestPolicyDate: result?.latestPolicyDate ?? null,
      };
    },
    enabled,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.renewalAnalysis(params),
    });
  }, [queryClient, params]);

  // noop — available months are fetched together with data
  const checkAvailableMonths = useCallback(async () => {}, []);

  return {
    detailData: data?.detailData ?? [],
    availableMonths: data?.availableMonths ?? [],
    latestPolicyDate: data?.latestPolicyDate ?? null,
    loading: isLoading,
    error: queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null,
    hasCheckedAvailability: !isLoading && data !== undefined,
    refresh,
    checkAvailableMonths,
  };
}
