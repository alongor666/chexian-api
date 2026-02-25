/**
 * 续保分析数据 Hook（API-only 模式）
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../../../shared/api/client';
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

  const [detailData, setDetailData] = useState<RenewalDetailRow[]>([]);
  const [availableMonths, setAvailableMonths] = useState<number[]>([]);
  const [latestPolicyDate, setLatestPolicyDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCheckedAvailability, setHasCheckedAvailability] = useState(false);

  const fetchFromApi = useCallback(async () => {
    // 续保分析：排除日期范围（使用 targetYear/Month 替代），但保留机构等筛选
    const renewalFilters: AdvancedFilterState = {
      ...filters,
      policy_date_start: undefined,
      policy_date_end: undefined,
    };
    const params = {
      ...buildFilterParams(renewalFilters, { isOrgUser, userOrg }),
      queryType: 'full' as const,
      targetYear: effectiveYear,
      targetMonth: selectedMonth,
    };

    logger.debug('Fetching renewal data from API', params);

    const result = await apiClient.getRenewalAnalysis(params);

    if (result) {
      const mappedData = (result.detailData || []).map((row: Record<string, unknown>) => ({
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
      }));

      setDetailData(mappedData);
      setAvailableMonths(result.availableMonths || []);
      setLatestPolicyDate(result.latestPolicyDate || null);
      setHasCheckedAvailability(true);
    }
  }, [filters, perspective, effectiveYear, selectedMonth]);

  const checkAvailableMonths = useCallback(async () => {
    // In API mode, available months are fetched together with data
  }, []);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      await fetchFromApi();
    } catch (err) {
      logger.error('续保明细表格查询失败', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchFromApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    detailData,
    availableMonths,
    latestPolicyDate,
    loading,
    error,
    hasCheckedAvailability,
    refresh: fetchData,
    checkAvailableMonths,
  };
}
