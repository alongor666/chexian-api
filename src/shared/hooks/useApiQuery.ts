/**
 * API 查询 Hook
 * API Query Hooks
 *
 * 封装后端 API 调用的 React Hooks
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient, KpiData, TrendData } from '../api/client';
import { createLogger } from '../utils/logger';

const logger = createLogger('useApiQuery');

/**
 * 通用查询 Hook 选项
 */
interface UseQueryOptions {
  /** 是否启用查询 */
  enabled?: boolean;
  /** 自动刷新间隔（毫秒） */
  refetchInterval?: number;
}

/**
 * KPI 查询 Hook
 */
export function useKpiQuery(
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<KpiData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getKpi(filters);
      // 只处理最新请求的结果
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('KPI 查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, filters]);

  // 初始加载和 filters 变化时重新查询
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 趋势查询 Hook
 */
export function useTrendQuery(
  granularity: 'day' | 'week' | 'month' = 'day',
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<TrendData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getTrend(granularity, filters);
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('趋势查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, granularity, filters]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 业务员排名查询 Hook
 */
export function useSalesmanRankingQuery(
  limit: number = 20,
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getSalesmanRanking(limit, filters);
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('业务员排名查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, limit, filters]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 货车分析查询 Hook
 */
export function useTruckAnalysisQuery(
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getTruckAnalysis(filters);
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('货车分析查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, filters]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 系数监控查询 Hook
 */
export function useCoefficientQuery(
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getCoefficientData(filters);
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('系数监控查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, filters]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 成本分析查询 Hook
 */
export function useCostAnalysisQuery(
  filters?: Record<string, any>,
  options: UseQueryOptions = {}
) {
  const { enabled = true } = options;
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getCostAnalysis(filters);
      if (currentRequestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        const message = err instanceof Error ? err.message : '查询失败';
        setError(message);
        logger.error('成本分析查询失败', err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, filters]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * 筛选器选项查询 Hook
 */
export function useFilterOptionsQuery(options: UseQueryOptions = {}) {
  const { enabled = true } = options;
  const [data, setData] = useState<{
    orgs: string[];
    salesmen: string[];
    customerCategories: string[];
    coverageCombinations: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !apiClient.isAuthenticated()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.getFilterOptions();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '查询失败';
      setError(message);
      logger.error('筛选器选项查询失败', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
