/**
 * 车驾意推介率 - 时间维度汇总 Hook
 * Cross-Sell Time Period Summary Hook
 *
 * 提供当日/当周/当月/当年四个时间维度的推介率、件均保费、保费汇总数据
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';

export type VehicleCategory = 'passenger' | 'truck' | 'motorcycle';
export type SeatCoverageLevel = 'eq_1w' | 'gte_2w' | 'lt_1w';

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
  week_auto_count: number;
  week_driver_count: number;
  week_premium: number;
  week_rate: number;
  week_avg_premium: number;
  month_auto_count: number;
  month_driver_count: number;
  month_premium: number;
  month_rate: number;
  month_avg_premium: number;
  quarter_auto_count: number;
  quarter_driver_count: number;
  quarter_premium: number;
  quarter_rate: number;
  quarter_avg_premium: number;
  year_auto_count: number;
  year_driver_count: number;
  year_premium: number;
  year_rate: number;
  year_avg_premium: number;
  // 上一周期数据（环比）
  prev_day_auto_count: number;
  prev_day_driver_count: number;
  prev_day_premium: number;
  prev_day_rate: number;
  prev_day_avg_premium: number;
  prev_week_auto_count: number;
  prev_week_driver_count: number;
  prev_week_premium: number;
  prev_week_rate: number;
  prev_week_avg_premium: number;
  prev_month_auto_count: number;
  prev_month_driver_count: number;
  prev_month_premium: number;
  prev_month_rate: number;
  prev_month_avg_premium: number;
  prev_quarter_auto_count: number;
  prev_quarter_driver_count: number;
  prev_quarter_premium: number;
  prev_quarter_rate: number;
  prev_quarter_avg_premium: number;
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
  const [maxDate, setMaxDate] = useState<string | null>(null);
  const [rateData, setRateData] = useState<TimePeriodRow[]>([]);
  const [avgPremiumData, setAvgPremiumData] = useState<TimePeriodRow[]>([]);
  const [premiumData, setPremiumData] = useState<TimePeriodRow[]>([]);
  const [rawData, setRawData] = useState<TimePeriodRawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        ...buildFilterParams(filters, { isOrgUser, userOrg }),
        vehicleCategory,
      };
      if (seatCoverageLevel) {
        params.seatCoverageLevel = seatCoverageLevel;
      }

      const result = await apiClient.getCrossSellTimePeriod(params);
      if (fetchId !== fetchIdRef.current) return;

      if (result) {
        setMaxDate(result.maxDate || null);

        const rows = result.rows || [];

        // 保存原始数据
        setRawData(rows as TimePeriodRawRow[]);

        // Build lookup by coverage_combination
        const rowMap = new Map<string, typeof rows[0]>();
        for (const row of rows) {
          rowMap.set(row.coverage_combination, row);
        }

        const buildRows = (
          getter: (row: typeof rows[0]) => { day: number; week: number; month: number; quarter: number; year: number }
        ): TimePeriodRow[] => {
          return LABEL_ORDER.map((key) => {
            const row = rowMap.get(key);
            if (!row) {
              return { label: LABEL_MAP[key] || key, day: 0, week: 0, month: 0, quarter: 0, year: 0 };
            }
            const values = getter(row);
            return { label: LABEL_MAP[key] || key, ...values };
          });
        };

        setRateData(
          buildRows((r) => ({
            day: Number(r.day_rate ?? 0),
            week: Number(r.week_rate ?? 0),
            month: Number(r.month_rate ?? 0),
            quarter: Number(r.quarter_rate ?? 0),
            year: Number(r.year_rate ?? 0),
          }))
        );

        setAvgPremiumData(
          buildRows((r) => ({
            day: Number(r.day_avg_premium ?? 0),
            week: Number(r.week_avg_premium ?? 0),
            month: Number(r.month_avg_premium ?? 0),
            quarter: Number(r.quarter_avg_premium ?? 0),
            year: Number(r.year_avg_premium ?? 0),
          }))
        );

        setPremiumData(
          buildRows((r) => ({
            day: Number(r.day_premium ?? 0) / 10000,
            week: Number(r.week_premium ?? 0) / 10000,
            month: Number(r.month_premium ?? 0) / 10000,
            quarter: Number(r.quarter_premium ?? 0) / 10000,
            year: Number(r.year_premium ?? 0) / 10000,
          }))
        );
      }
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [filters, vehicleCategory, seatCoverageLevel, enabled, isOrgUser, userOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    maxDate,
    rateData,
    avgPremiumData,
    premiumData,
    rawData,
    loading,
    error,
  };
}
