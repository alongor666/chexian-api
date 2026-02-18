/**
 * 车驾意推介率 - 时间维度汇总 Hook
 * Cross-Sell Time Period Summary Hook
 *
 * 提供当日/当周/当月/当年四个时间维度的推介率、件均保费、保费汇总数据
 */

import { useState, useCallback, useEffect } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';

export type VehicleCategory = 'passenger' | 'truck' | 'motorcycle';

export interface TimePeriodRow {
  label: string;
  day: number;
  week: number;
  month: number;
  year: number;
}

interface UseCrossSellTimePeriodProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  enabled?: boolean;
}

interface UseCrossSellTimePeriodReturn {
  maxDate: string | null;
  rateData: TimePeriodRow[];
  avgPremiumData: TimePeriodRow[];
  premiumData: TimePeriodRow[];
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
  enabled = true,
}: UseCrossSellTimePeriodProps): UseCrossSellTimePeriodReturn {
  const [maxDate, setMaxDate] = useState<string | null>(null);
  const [rateData, setRateData] = useState<TimePeriodRow[]>([]);
  const [avgPremiumData, setAvgPremiumData] = useState<TimePeriodRow[]>([]);
  const [premiumData, setPremiumData] = useState<TimePeriodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        ...buildFilterParams(filters),
        vehicleCategory,
      };

      const result = await apiClient.getCrossSellTimePeriod(params);

      if (result) {
        setMaxDate(result.maxDate || null);

        const rows = result.rows || [];

        // Build lookup by coverage_combination
        const rowMap = new Map<string, typeof rows[0]>();
        for (const row of rows) {
          rowMap.set(row.coverage_combination, row);
        }

        const buildRows = (
          getter: (row: typeof rows[0]) => { day: number; week: number; month: number; year: number }
        ): TimePeriodRow[] => {
          return LABEL_ORDER.map((key) => {
            const row = rowMap.get(key);
            if (!row) {
              return { label: LABEL_MAP[key] || key, day: 0, week: 0, month: 0, year: 0 };
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
            year: Number(r.year_rate ?? 0),
          }))
        );

        setAvgPremiumData(
          buildRows((r) => ({
            day: Number(r.day_avg_premium ?? 0) / 10000,
            week: Number(r.week_avg_premium ?? 0) / 10000,
            month: Number(r.month_avg_premium ?? 0) / 10000,
            year: Number(r.year_avg_premium ?? 0) / 10000,
          }))
        );

        setPremiumData(
          buildRows((r) => ({
            day: Number(r.day_premium ?? 0) / 10000,
            week: Number(r.week_premium ?? 0) / 10000,
            month: Number(r.month_premium ?? 0) / 10000,
            year: Number(r.year_premium ?? 0) / 10000,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, vehicleCategory, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    maxDate,
    rateData,
    avgPremiumData,
    premiumData,
    loading,
    error,
  };
}
