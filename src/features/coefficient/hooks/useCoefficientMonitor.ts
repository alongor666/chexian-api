/**
 * 商车自主定价系数监控 - 数据获取 Hook（API 模式）
 *
 * 功能：
 * - 获取各维度的系数数据（当天/当周/当月/当年）
 * - 应用阈值配置计算合规状态
 * - 支持成都、全省、各机构三层展示
 * - 通过后端 API 获取数据
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import type { CoefficientRow, PeriodGroupData, UseCoefficientMonitorOptions, UseCoefficientMonitorResult } from '../types';

const logger = createLogger('useCoefficientMonitor');

/**
 * 商车自主定价系数监控 Hook（API 模式）
 */
export function useCoefficientMonitor({
  dateField,
  cutoffDate,
  analysisYear,
  enabled = true,
  additionalWhere = '1=1',
}: UseCoefficientMonitorOptions): UseCoefficientMonitorResult {
  const [data, setData] = useState<CoefficientRow[]>([]);
  const [periodGroups, setPeriodGroups] = useState<PeriodGroupData[]>([]);
  const [provinceTop, setProvinceTop] = useState<CoefficientRow[]>([]);
  const [chengduTop, setChengduTop] = useState<CoefficientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  /**
   * 从 API 获取系数数据
   */
  const fetchFromApi = useCallback(async (requestId: number) => {
    try {
      logger.info('系数监控 API 查询执行');

      // 将 cutoffDate/analysisYear 转换为后端期望的 startDate/endDate
      const endDateStr = cutoffDate.toISOString().split('T')[0];
      const startDateStr = `${analysisYear}-01-01`;

      const response = await apiClient.getCoefficientData({
        queryType: 'batch',
        dateField,
        startDate: startDateStr,
        endDate: endDateStr,
        cutoffDate: endDateStr,
        analysisYear,
      });

      if (requestId !== requestIdRef.current) return;

      if (response && typeof response === 'object') {
        const responseData = response as Record<string, unknown>;

        if (Array.isArray(responseData.data)) {
          setData(responseData.data as CoefficientRow[]);
        } else if (Array.isArray(response)) {
          setData(response as CoefficientRow[]);
        }

        if (Array.isArray(responseData.periodGroups)) {
          setPeriodGroups(responseData.periodGroups as PeriodGroupData[]);
        }

        if (Array.isArray(responseData.provinceTop)) {
          setProvinceTop(responseData.provinceTop as CoefficientRow[]);
        }

        if (Array.isArray(responseData.chengduTop)) {
          setChengduTop(responseData.chengduTop as CoefficientRow[]);
        }
      }

      logger.info('系数监控 API 查询成功');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      throw err;
    }
  }, [dateField, cutoffDate, analysisYear, additionalWhere]);

  /**
   * 主数据获取函数
   */
  const fetchData = useCallback(async () => {
    if (!enabled) {
      logger.debug('系数监控查询未启用');
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      await fetchFromApi(currentRequestId);
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        logger.error('系数 API 查询失败', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, fetchFromApi]);

  // 自动刷新
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    periodGroups,
    provinceTop,
    chengduTop,
    loading,
    error,
    refresh: fetchData,
  };
}

export type { CoefficientRow, PeriodGroupData, UseCoefficientMonitorOptions, UseCoefficientMonitorResult } from '../types';
