/**
 * 保费报表数据Hook
 *
 * 通过后端 API 获取保费报表数据
 * - 机构保费报表数据
 * - 业务员保费报表数据
 * - 汇总统计数据
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../../../shared/api/client';
import { createLogger } from '../../../shared/utils/logger';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import {
  calculateSummary,
  sortData,
  normalizeOrgReportRow,
  normalizeSalesmanReportRow,
} from '../utils/premiumReportCalc';

const logger = createLogger('usePremiumReport');
import type {
  OrgPremiumReportRow,
  SalesmanPremiumReportRow,
  PremiumReportFilters,
  PremiumReportData,
  SortState,
} from '../types/premiumReport';

interface UsePremiumReportReturn extends PremiumReportData {
  /** 加载数据 */
  loadData: (filters: PremiumReportFilters) => Promise<void>;
  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 机构报表排序 */
  orgReportSort: SortState;
  /** 业务员报表排序 */
  salesmanReportSort: SortState;
  /** 设置机构报表排序 */
  setOrgReportSort: (sort: SortState) => void;
  /** 设置业务员报表排序 */
  setSalesmanReportSort: (sort: SortState) => void;
  /** 排序后的机构报表数据 */
  sortedOrgReport: OrgPremiumReportRow[];
  /** 排序后的业务员报表数据 */
  sortedSalesmanReport: SalesmanPremiumReportRow[];
  /** 当前筛选条件 */
  currentFilters: PremiumReportFilters | null;
}

/**
 * 保费报表数据Hook
 */
export function usePremiumReport(): UsePremiumReportReturn {
  const { isOrgUser, userOrg } = useRBAC();

  // 数据状态
  const [state, setState] = useState<PremiumReportData>({
    orgReport: [],
    salesmanReport: [],
    summary: {
      totalPremium: 0,
      totalPolicies: 0,
      orgCount: 0,
      salesmanCount: 0,
      avgPremium: 0,
    },
    isLoading: false,
    error: null,
  });

  // 筛选条件
  const [currentFilters, setCurrentFilters] = useState<PremiumReportFilters | null>(null);

  // 排序状态
  const [orgReportSort, setOrgReportSort] = useState<SortState>({
    column: '车险保费',
    direction: 'desc',
  });

  const [salesmanReportSort, setSalesmanReportSort] = useState<SortState>({
    column: '车险保费',
    direction: 'desc',
  });

  /**
   * 加载机构保费报表数据
   */
  const loadOrgReport = useCallback(
    async (filters: PremiumReportFilters): Promise<OrgPremiumReportRow[]> => {
      logger.debug('Loading org report from API', filters);

      const params: Record<string, any> = {
        ...(filters.additionalParams || {}),
        reportType: 'org',
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
      };
      if (isOrgUser && userOrg) {
        params.orgNames = userOrg;
      } else if (filters.org_level_3 && filters.org_level_3.length > 0) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.premium.report(params);

      return (result || []).map(normalizeOrgReportRow);
    },
    [isOrgUser, userOrg]
  );

  /**
   * 加载业务员保费报表数据
   */
  const loadSalesmanReport = useCallback(
    async (filters: PremiumReportFilters): Promise<SalesmanPremiumReportRow[]> => {
      logger.debug('Loading salesman report from API', filters);

      const params: Record<string, any> = {
        ...(filters.additionalParams || {}),
        reportType: 'salesman',
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
        planYear: filters.year,
      };
      if (isOrgUser && userOrg) {
        params.orgNames = userOrg;
      } else if (filters.org_level_3 && filters.org_level_3.length > 0) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.premium.report(params);

      return (result || []).map(normalizeSalesmanReportRow);
    },
    [isOrgUser, userOrg]
  );

  /**
   * 加载数据
   */
  const loadData = useCallback(
    async (filters: PremiumReportFilters) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      setCurrentFilters(filters);

      try {
        // 并行加载两个表的数据
        const [orgReport, salesmanReport] = await Promise.all([
          loadOrgReport(filters),
          loadSalesmanReport(filters),
        ]);

        // 计算汇总数据
        const summary = calculateSummary(orgReport, salesmanReport);

        setState({
          orgReport,
          salesmanReport,
          summary,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [loadOrgReport, loadSalesmanReport]
  );

  /**
   * 刷新数据
   */
  const refresh = useCallback(async () => {
    if (currentFilters) {
      await loadData(currentFilters);
    }
  }, [currentFilters, loadData]);

  // 排序后的数据
  const sortedOrgReport = sortData(state.orgReport, orgReportSort);
  const sortedSalesmanReport = sortData(state.salesmanReport, salesmanReportSort);

  return {
    ...state,
    loadData,
    refresh,
    orgReportSort,
    salesmanReportSort,
    setOrgReportSort,
    setSalesmanReportSort,
    sortedOrgReport,
    sortedSalesmanReport,
    currentFilters,
  };
}
