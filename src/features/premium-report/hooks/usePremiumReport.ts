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

const logger = createLogger('usePremiumReport');
import type {
  OrgPremiumReportRow,
  SalesmanPremiumReportRow,
  PremiumReportFilters,
  PremiumReportData,
  PremiumReportSummary,
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
   * 计算汇总数据
   */
  const calculateSummary = useCallback(
    (orgReport: OrgPremiumReportRow[], salesmanReport: SalesmanPremiumReportRow[]): PremiumReportSummary => {
      const totalPremium = orgReport.reduce((sum, row) => sum + row.车险保费, 0);
      const totalPolicies = orgReport.reduce((sum, row) => sum + row.车险件数, 0);
      const orgCount = orgReport.length;
      const salesmanCount = new Set(salesmanReport.map((row) => row.salesman_name)).size;
      const avgPremium = orgCount > 0 ? totalPremium / orgCount : 0;

      return {
        totalPremium: Math.round(totalPremium * 100) / 100,
        totalPolicies,
        orgCount,
        salesmanCount,
        avgPremium: Math.round(avgPremium * 100) / 100,
      };
    },
    []
  );

  /**
   * 加载机构保费报表数据
   */
  const loadOrgReport = useCallback(
    async (filters: PremiumReportFilters): Promise<OrgPremiumReportRow[]> => {
      logger.debug('Loading org report from API', filters);

      const params: Record<string, any> = {
        reportType: 'org',
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
      };
      if (filters.org_level_3 && filters.org_level_3.length > 0) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.getPremiumReport(params);

      return (result || []).map((row: Record<string, unknown>) => ({
        org_level_3: String(row.org_level_3 || ''),
        车险保费: Number(row['车险保费'] || 0),
        商业险保费: Number(row['商业险保费'] || 0),
        交强险保费: Number(row['交强险保费'] || 0),
        车险件数: Number(row['车险件数'] || 0),
        商业险件数: Number(row['商业险件数'] || 0),
        交强险件数: Number(row['交强险件数'] || 0),
        人均保费: Number(row['人均保费'] || 0),
        业务员数: Number(row['业务员数'] || 0),
        同比增长率: row['同比增长率'] != null ? Number(row['同比增长率']) : null,
      }));
    },
    []
  );

  /**
   * 加载业务员保费报表数据
   */
  const loadSalesmanReport = useCallback(
    async (filters: PremiumReportFilters): Promise<SalesmanPremiumReportRow[]> => {
      logger.debug('Loading salesman report from API', filters);

      const params: Record<string, any> = {
        reportType: 'salesman',
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
        planYear: filters.year,
      };
      if (filters.org_level_3 && filters.org_level_3.length > 0) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.getPremiumReport(params);

      return (result || []).map((row: Record<string, unknown>) => ({
        salesman_name: String(row.salesman_name || ''),
        org_level_3: String(row.org_level_3 || ''),
        team_name: String(row.team_name || ''),
        车险保费: Number(row['车险保费'] || 0),
        商业险保费: Number(row['商业险保费'] || 0),
        交强险保费: Number(row['交强险保费'] || 0),
        车险件数: Number(row['车险件数'] || 0),
        商业险件数: Number(row['商业险件数'] || 0),
        交强险件数: Number(row['交强险件数'] || 0),
        续保率: Number(row['续保率'] || 0),
        非过户率: Number(row['非过户率'] || 0),
      }));
    },
    []
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
    [loadOrgReport, loadSalesmanReport, calculateSummary]
  );

  /**
   * 刷新数据
   */
  const refresh = useCallback(async () => {
    if (currentFilters) {
      await loadData(currentFilters);
    }
  }, [currentFilters, loadData]);

  /**
   * 排序函数
   */
  const sortData = <T extends Record<string, unknown>>(
    data: T[],
    sort: SortState
  ): T[] => {
    if (!sort.column) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sort.column];
      const bValue = b[sort.column];

      // 处理 null/undefined
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sort.direction === 'asc' ? -1 : 1;
      if (bValue == null) return sort.direction === 'asc' ? 1 : -1;

      // 数字比较
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sort.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      // 字符串比较
      const aStr = String(aValue);
      const bStr = String(bValue);
      return sort.direction === 'asc'
        ? aStr.localeCompare(bStr, 'zh-CN')
        : bStr.localeCompare(aStr, 'zh-CN');
    });
  };

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
