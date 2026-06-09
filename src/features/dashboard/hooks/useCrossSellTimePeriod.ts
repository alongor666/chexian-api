/**
 * 车驾意推介率 - 时间维度汇总 Hook
 * Cross-Sell Time Period Summary Hook
 *
 * 提供当日/当周/当月/当年四个时间维度的推介率、驾意件均、驾意保费汇总数据
 */

import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { queryKeys } from '@/shared/api/query-keys';

export type VehicleCategory = 'all' | 'passenger' | 'truck' | 'motorcycle';
export type SeatCoverageLevel = 'all' | 'eq_1w' | 'gte_2w' | 'lt_1w';

export interface TimePeriodRow {
  label: string;
  day: number;
  week: number;
  month: number;
  quarter: number;
  year: number;
}

interface UseCrossSellTimePeriodProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  enabled?: boolean;
}

interface TimePeriodRawRow {
  coverage_combination: string;
  day_auto_count: number;
  day_driver_count: number;
  day_premium: number;
  day_rate: number;
  day_avg_premium: number;
  day_auto_avg_premium: number;
  week_auto_count: number;
  week_driver_count: number;
  week_premium: number;
  week_rate: number;
  week_avg_premium: number;
  week_auto_avg_premium: number;
  month_auto_count: number;
  month_driver_count: number;
  month_premium: number;
  month_rate: number;
  month_avg_premium: number;
  month_auto_avg_premium: number;
  quarter_auto_count: number;
  quarter_driver_count: number;
  quarter_premium: number;
  quarter_rate: number;
  quarter_avg_premium: number;
  quarter_auto_avg_premium: number;
  year_auto_count: number;
  year_driver_count: number;
  year_premium: number;
  year_rate: number;
  year_avg_premium: number;
  year_auto_avg_premium: number;
  // 上一周期数据（环比）
  prev_day_auto_count: number;
  prev_day_driver_count: number;
  prev_day_premium: number;
  prev_day_rate: number;
  prev_day_avg_premium: number;
  prev_day_auto_avg_premium: number;
  prev_week_auto_count: number;
  prev_week_driver_count: number;
  prev_week_premium: number;
  prev_week_rate: number;
  prev_week_avg_premium: number;
  prev_week_auto_avg_premium: number;
  prev_month_auto_count: number;
  prev_month_driver_count: number;
  prev_month_premium: number;
  prev_month_rate: number;
  prev_month_avg_premium: number;
  prev_month_auto_avg_premium: number;
  prev_quarter_auto_count: number;
  prev_quarter_driver_count: number;
  prev_quarter_premium: number;
  prev_quarter_rate: number;
  prev_quarter_avg_premium: number;
  prev_quarter_auto_avg_premium: number;
}

interface UseCrossSellTimePeriodReturn {
  maxDate: string | null;
  rateData: TimePeriodRow[];
  avgPremiumData: TimePeriodRow[];
  premiumData: TimePeriodRow[];
  rawData: TimePeriodRawRow[];
  loading: boolean;
  error: string | null;
}

const LABEL_MAP: Record<string, string> = {
  '整体': '整体',
  '主全': '主全',
  '交三': '交三',
  '单交': '单交',
};

const LABEL_ORDER = ['整体', '主全', '交三', '单交'];

export function useCrossSellTimePeriod({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  enabled = true,
}: UseCrossSellTimePeriodProps): UseCrossSellTimePeriodReturn {
  const { isOrgUser, userOrg } = useRBAC();

  const params: Record<string, string> = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    vehicleCategory,
  };
  if (seatCoverageLevel) {
    params.seatCoverageLevel = seatCoverageLevel;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.crossSellTimePeriod(params),
    queryFn: () => apiClient.crossSell.timePeriod(params),
    enabled,
    select: (result) => {
      if (!result) {
        return {
          maxDate: null,
          rateData: [] as TimePeriodRow[],
          avgPremiumData: [] as TimePeriodRow[],
          premiumData: [] as TimePeriodRow[],
          rawData: [] as TimePeriodRawRow[],
        };
      }

      const rows = result.rows || [];
      const rawData = rows as TimePeriodRawRow[];

      // Build lookup by coverage_combination
      const rowMap = new Map<string, typeof rows[0]>();
      for (const row of rows) {
        rowMap.set(row.coverage_combination, row);
      }

      const buildRows = (
        getter: (row: typeof rows[0]) => { day: number; week: number; month: number; quarter: number; year: number }
      ): TimePeriodRow[] =>
        LABEL_ORDER.map((key) => {
          const row = rowMap.get(key);
          if (!row) {
            return { label: LABEL_MAP[key] || key, day: 0, week: 0, month: 0, quarter: 0, year: 0 };
          }
          const values = getter(row);
          return { label: LABEL_MAP[key] || key, ...values };
        });

      const rateData = buildRows((r) => ({
        day: Number(r.day_rate ?? 0),
        week: Number(r.week_rate ?? 0),
        month: Number(r.month_rate ?? 0),
        quarter: Number(r.quarter_rate ?? 0),
        year: Number(r.year_rate ?? 0),
      }));

      const avgPremiumData = buildRows((r) => ({
        day: Number(r.day_avg_premium ?? 0),
        week: Number(r.week_avg_premium ?? 0),
        month: Number(r.month_avg_premium ?? 0),
        quarter: Number(r.quarter_avg_premium ?? 0),
        year: Number(r.year_avg_premium ?? 0),
      }));

      const premiumData = buildRows((r) => ({
        day: Number(r.day_premium ?? 0) / 10000,
        week: Number(r.week_premium ?? 0) / 10000,
        month: Number(r.month_premium ?? 0) / 10000,
        quarter: Number(r.quarter_premium ?? 0) / 10000,
        year: Number(r.year_premium ?? 0) / 10000,
      }));

      return {
        maxDate: result.maxDate || null,
        rateData,
        avgPremiumData,
        premiumData,
        rawData,
      };
    },
  });

  return {
    maxDate: data?.maxDate ?? null,
    rateData: data?.rateData ?? [],
    avgPremiumData: data?.avgPremiumData ?? [],
    premiumData: data?.premiumData ?? [],
    rawData: data?.rawData ?? [],
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}
