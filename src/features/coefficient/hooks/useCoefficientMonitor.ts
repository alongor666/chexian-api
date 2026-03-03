/**
 * 商车自主定价系数监控 - 数据获取 Hook（API 模式）
 *
 * 功能：
 * - 获取各维度的系数数据（当天/当周/当月/当年）
 * - 应用阈值配置计算合规状态
 * - 支持成都、全省、各机构三层展示
 * - 通过后端 API 获取数据
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/query-keys';
import type { CoefficientRow, PeriodGroupData, UseCoefficientMonitorOptions, UseCoefficientMonitorResult } from '../types';

const logger = createLogger('useCoefficientMonitor');

/**
 * 商车自主定价系数监控 Hook（React Query 模式）
 */
export function useCoefficientMonitor({
  dateField,
  cutoffDate,
  analysisYear,
  enabled = true,
  additionalFilterParams = {},
}: UseCoefficientMonitorOptions): UseCoefficientMonitorResult {
  const queryClient = useQueryClient();

  const endDateStr = cutoffDate.toISOString().split('T')[0];
  const startDateStr = `${analysisYear}-01-01`;

  const params: Record<string, unknown> = {
    ...additionalFilterParams,
    queryType: 'batch',
    dateField,
    startDate: startDateStr,
    endDate: endDateStr,
    cutoffDate: endDateStr,
    analysisYear: String(analysisYear),
  };

  const { data: queryData, isLoading, error } = useQuery({
    queryKey: queryKeys.coefficient(params),
    queryFn: async () => {
      logger.info('系数监控 API 查询执行');
      const response = await apiClient.getCoefficientData(params);
      logger.info('系数监控 API 查询成功');
      return response;
    },
    enabled,
    select: (response) => {
      const responseData = response && typeof response === 'object'
        ? response as Record<string, unknown>
        : {};
      return {
        data: Array.isArray(responseData.data)
          ? responseData.data as CoefficientRow[]
          : Array.isArray(response)
            ? response as CoefficientRow[]
            : [] as CoefficientRow[],
        periodGroups: Array.isArray(responseData.periodGroups)
          ? responseData.periodGroups as PeriodGroupData[]
          : [] as PeriodGroupData[],
        provinceTop: Array.isArray(responseData.provinceTop)
          ? responseData.provinceTop as CoefficientRow[]
          : [] as CoefficientRow[],
        chengduTop: Array.isArray(responseData.chengduTop)
          ? responseData.chengduTop as CoefficientRow[]
          : [] as CoefficientRow[],
      };
    },
  });

  const refresh = () => {
    logger.info('系数监控手动刷新');
    void queryClient.invalidateQueries({ queryKey: queryKeys.coefficient(params) });
  };

  return {
    data: queryData?.data ?? [],
    periodGroups: queryData?.periodGroups ?? [],
    provinceTop: queryData?.provinceTop ?? [],
    chengduTop: queryData?.chengduTop ?? [],
    loading: isLoading,
    error: error instanceof Error ? error : error != null ? new Error(String(error)) : null,
    refresh,
  };
}

export type { CoefficientRow, PeriodGroupData, UseCoefficientMonitorOptions, UseCoefficientMonitorResult } from '../types';
