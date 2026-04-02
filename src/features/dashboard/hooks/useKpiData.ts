import { useQuery } from '@tanstack/react-query';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import { queryKeys } from '../../../shared/api/query-keys';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { KpiDetailResult } from '../../../shared/types/kpi';

export type { KpiDetailResult };

const logger = createLogger('useKpiData');

/**
 * KPI 基础数据类型
 */
export interface KpiData {
  latest_policy_date?: string | null;
  vehicle_plan_wan?: number | null;
  vehicle_premium?: number | bigint;
  vehicle_achievement_rate?: number | null;
  vehicle_growth_rate?: number | null;
  variable_cost_rate?: number | null;
  bundle_renewal_rate?: number | null;
  driver_premium?: number | bigint;
  driver_achievement_rate?: number | null;
  driver_growth_rate?: number | null;
  total_premium?: number | bigint;
  policy_count?: number | bigint;
  transfer_rate?: number;
  telesales_rate?: number;
  per_capita_premium?: number | bigint;
  per_vehicle_premium?: number | bigint;
  renewal_rate?: number;
  commercial_rate?: number;
  nev_rate?: number;
  new_car_rate?: number;
}

/**
 * useKpiData Hook 参数
 */
export interface UseKpiDataOptions {
  filters: AdvancedFilterState;
  prefetched?: {
    kpi: KpiData;
    kpiDetail: KpiDetailResult | null;
  };
  enabled?: boolean;
}

/**
 * useKpiData Hook 返回值
 */
export interface UseKpiDataResult {
  kpiData: KpiData;
  kpiDetails: KpiDetailResult | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * KPI 数据获取 Hook（React Query 模式）
 */
export const useKpiData = ({
  filters,
  prefetched,
  enabled = true,
}: UseKpiDataOptions): UseKpiDataResult => {
  const { isOrgUser, userOrg } = useRBAC();
  const params = buildFilterParams(filters, { isOrgUser, userOrg });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.kpi(params),
    queryFn: async () => {
      logger.info('KPI API 查询执行', params);

      const [kpiResponse, kpiDetailResponse] = await Promise.all([
        apiClient.getKpi(params),
        apiClient.getKpiDetail(params),
      ]);

      const kpi: KpiData = {
        latest_policy_date: kpiResponse.latest_policy_date,
        vehicle_plan_wan: kpiResponse.vehicle_plan_wan,
        vehicle_premium: kpiResponse.vehicle_premium,
        vehicle_achievement_rate: kpiResponse.vehicle_achievement_rate,
        vehicle_growth_rate: kpiResponse.vehicle_growth_rate,
        variable_cost_rate: kpiResponse.variable_cost_rate,
        bundle_renewal_rate: kpiResponse.bundle_renewal_rate,
        driver_premium: kpiResponse.driver_premium,
        driver_achievement_rate: kpiResponse.driver_achievement_rate,
        driver_growth_rate: kpiResponse.driver_growth_rate,
        total_premium: kpiResponse.total_premium,
        policy_count: kpiResponse.policy_count,
        transfer_rate: kpiResponse.transfer_rate,
        telesales_rate: kpiResponse.telesales_rate,
        per_capita_premium: kpiResponse.per_capita_premium,
        per_vehicle_premium: kpiResponse.per_vehicle_premium,
        renewal_rate: kpiResponse.renewal_rate,
        commercial_rate: kpiResponse.commercial_rate,
        nev_rate: kpiResponse.nev_rate,
        new_car_rate: kpiResponse.new_car_rate,
      };

      const kpiDetail: KpiDetailResult = {
        total_premium: kpiDetailResponse.total_premium,
        policy_count: kpiDetailResponse.policy_count,
        per_capita_premium: kpiDetailResponse.per_capita_premium,
        transfer_count: kpiDetailResponse.transfer_count,
        non_transfer_count: kpiDetailResponse.non_transfer_count,
        telesales_count: kpiDetailResponse.telesales_count,
        non_telesales_count: kpiDetailResponse.non_telesales_count,
        renewal_count: kpiDetailResponse.renewal_count,
        non_renewal_count: kpiDetailResponse.non_renewal_count,
        commercial_premium: kpiDetailResponse.commercial_premium,
        non_commercial_premium: kpiDetailResponse.non_commercial_premium,
        nev_count: kpiDetailResponse.nev_count,
        non_nev_count: kpiDetailResponse.non_nev_count,
        new_car_count: kpiDetailResponse.new_car_count,
        non_new_car_count: kpiDetailResponse.non_new_car_count,
        quality_business_count: kpiDetailResponse.quality_business_count,
        non_quality_business_count: kpiDetailResponse.non_quality_business_count,
        grade_ab_count: kpiDetailResponse.grade_ab_count,
        grade_cd_count: kpiDetailResponse.grade_cd_count,
        grade_efg_count: kpiDetailResponse.grade_efg_count,
        coverage_danjiao_count: kpiDetailResponse.coverage_danjiao_count,
        coverage_jiaosan_count: kpiDetailResponse.coverage_jiaosan_count,
        coverage_zhuquan_count: kpiDetailResponse.coverage_zhuquan_count,
        coverage_other_count: kpiDetailResponse.coverage_other_count,
        vehicle_truck_count: kpiDetailResponse.vehicle_truck_count,
        vehicle_bus_count: kpiDetailResponse.vehicle_bus_count,
        vehicle_motorcycle_count: kpiDetailResponse.vehicle_motorcycle_count,
        vehicle_other_count: kpiDetailResponse.vehicle_other_count,
        same_city_premium: kpiDetailResponse.same_city_premium,
        remote_premium: kpiDetailResponse.remote_premium,
      };

      logger.info('KPI API 查询成功');
      return { kpi, kpiDetail };
    },
    enabled: enabled && !prefetched,
  });

  const kpiData = prefetched?.kpi ?? data?.kpi ?? {};
  const kpiDetails = prefetched?.kpiDetail ?? data?.kpiDetail ?? null;

  return {
    kpiData,
    kpiDetails,
    loading: prefetched ? false : isLoading,
    error: prefetched ? null : (error instanceof Error ? error : null),
    refresh: () => { void refetch(); },
  };
};
