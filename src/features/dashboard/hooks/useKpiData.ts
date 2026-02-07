import { useState, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { parseWhereClause } from '../../../shared/utils/sql-parser';

const logger = createLogger('useKpiData');

/**
 * KPI 详细数据（用于环形图展示）
 */
export interface KpiDetailResult {
  total_premium: number | bigint;
  policy_count: number | bigint;
  per_capita_premium: number | bigint;
  transfer_count: number | bigint;
  non_transfer_count: number | bigint;
  telesales_count: number | bigint;
  non_telesales_count: number | bigint;
  renewal_count: number | bigint;
  non_renewal_count: number | bigint;
  commercial_premium: number | bigint;
  non_commercial_premium: number | bigint;
  nev_count: number | bigint;
  non_nev_count: number | bigint;
  new_car_count: number | bigint;
  non_new_car_count: number | bigint;
}

/**
 * KPI 基础数据类型
 */
export interface KpiData {
  total_premium?: number | bigint;
  policy_count?: number | bigint;
  transfer_rate?: number;
  telesales_rate?: number;
  per_capita_premium?: number | bigint;
  renewal_rate?: number;
  commercial_rate?: number;
  nev_rate?: number;
  new_car_rate?: number;
}

/**
 * useKpiData Hook 参数
 */
export interface UseKpiDataOptions {
  whereClause: string;
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
 * KPI 数据获取 Hook（API-only 模式）
 */
export const useKpiData = ({
  whereClause,
  enabled = true,
}: UseKpiDataOptions): UseKpiDataResult => {
  const [kpiData, setKpiData] = useState<KpiData>({});
  const [kpiDetails, setKpiDetails] = useState<KpiDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const fetchFromApi = useCallback(async (requestId: number) => {
    try {
      logger.info('KPI API 查询执行', { whereClause: whereClause.substring(0, 100) });

      const params = parseWhereClause(whereClause);
      logger.debug('解析后的参数', params);

      const [kpiResponse, kpiDetailResponse] = await Promise.all([
        apiClient.getKpi(params),
        apiClient.getKpiDetail(params),
      ]);

      if (requestId !== requestIdRef.current) return;

      setKpiData({
        total_premium: kpiResponse.total_premium,
        policy_count: kpiResponse.policy_count,
        transfer_rate: kpiResponse.transfer_rate,
        telesales_rate: kpiResponse.telesales_rate,
        per_capita_premium: kpiResponse.per_capita_premium,
        renewal_rate: kpiResponse.renewal_rate,
        commercial_rate: kpiResponse.commercial_rate,
        nev_rate: kpiResponse.nev_rate,
        new_car_rate: kpiResponse.new_car_rate,
      });

      setKpiDetails({
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
      });

      logger.info('KPI API 查询成功');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      throw err;
    }
  }, [whereClause]);

  const fetchKpiData = useCallback(async () => {
    if (!enabled) {
      logger.debug('KPI 查询未启用');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      await fetchFromApi(requestId);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logger.error('KPI API 查询错误:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, fetchFromApi]);

  useEffect(() => {
    void fetchKpiData();
  }, [fetchKpiData]);

  return {
    kpiData,
    kpiDetails,
    loading,
    error,
    refresh: fetchKpiData,
  };
};
