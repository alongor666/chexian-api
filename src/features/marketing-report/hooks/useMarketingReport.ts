/**
 * 营销战报数据Hook
 *
 * 通过后端 API 获取营销战报数据
 * - 机构战报数据
 * - 业务员明细数据
 * - 节假日统计信息
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../../../shared/api/client';
import { getHolidaySummary, countHolidaysInRange, getHolidayDatesInRange } from '../utils/holidayUtils';
import { createLogger } from '../../../shared/utils/logger';

const logger = createLogger('useMarketingReport');
import type {
  OrganizationReportRow,
  SalesmanDetailRow,
  MarketingReportFilters,
  MarketingReportData,
  SortState,
} from '../types/marketingReport';

interface UseMarketingReportOptions {
  /** 是否自动加载数据 */
  autoLoad?: boolean;
}

interface UseMarketingReportReturn extends MarketingReportData {
  /** 加载数据 */
  loadData: (filters: MarketingReportFilters) => Promise<void>;
  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 机构战报排序 */
  orgReportSort: SortState;
  /** 业务员明细排序 */
  salesmanDetailSort: SortState;
  /** 设置机构战报排序 */
  setOrgReportSort: (sort: SortState) => void;
  /** 设置业务员明细排序 */
  setSalesmanDetailSort: (sort: SortState) => void;
  /** 排序后的机构战报数据 */
  sortedOrgReport: OrganizationReportRow[];
  /** 排序后的业务员明细数据 */
  sortedSalesmanDetail: SalesmanDetailRow[];
  /** 当前筛选条件 */
  currentFilters: MarketingReportFilters | null;
}

/**
 * 营销战报数据Hook
 */
export function useMarketingReport(
  options: UseMarketingReportOptions = {}
): UseMarketingReportReturn {
  const { autoLoad = false } = options;

  // 数据状态
  const [state, setState] = useState<MarketingReportData>({
    orgReport: [],
    salesmanDetail: [],
    holidayStats: {
      totalDays: 0,
      holidays: [],
    },
    isLoading: false,
    error: null,
  });

  // 筛选条件
  const [currentFilters, setCurrentFilters] = useState<MarketingReportFilters | null>(null);

  // 排序状态
  const [orgReportSort, setOrgReportSort] = useState<SortState>({
    column: '车险保费',
    direction: 'desc',
  });

  const [salesmanDetailSort, setSalesmanDetailSort] = useState<SortState>({
    column: '假日车险签单天数',
    direction: 'desc',
  });

  /**
   * 加载机构战报数据
   */
  const loadOrgReport = useCallback(
    async (filters: MarketingReportFilters): Promise<OrganizationReportRow[]> => {
      logger.debug('Loading org report from API', filters);

      const holidayDates = getHolidayDatesInRange(filters.startDate, filters.endDate);

      const params: Record<string, any> = {
        ...(filters.additionalParams || {}),
        reportType: 'org',
        holidayDates: holidayDates.join(','),
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
      };
      if (filters.org_level_3?.length) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.getMarketingReport(params);

      if (result && Array.isArray(result)) {
        return result.map((row: Record<string, unknown>) => ({
          org_level_3: String(row.org_level_3 || ''),
          车险保费: Number(row['车险保费'] || 0),
          商业险保费: Number(row['商业险保费'] || 0),
          车险开单率: Number(row['车险开单率'] || 0),
          商业险开单率: Number(row['商业险开单率'] || 0),
          总业务员数: Number(row['总业务员数'] || 0),
          车险出单人数: Number(row['车险出单人数'] || 0),
          商业险出单人数: Number(row['商业险出单人数'] || 0),
        }));
      }

      return [];
    },
    []
  );

  /**
   * 加载业务员明细数据
   */
  const loadSalesmanDetail = useCallback(
    async (filters: MarketingReportFilters): Promise<SalesmanDetailRow[]> => {
      logger.debug('Loading salesman detail from API', filters);

      const holidayDates = getHolidayDatesInRange(filters.startDate, filters.endDate);

      const params: Record<string, any> = {
        ...(filters.additionalParams || {}),
        reportType: 'salesman',
        holidayDates: holidayDates.join(','),
        dateField: filters.dateField,
        startDate: filters.startDate,
        endDate: filters.endDate,
      };
      if (filters.org_level_3?.length) {
        params.orgNames = filters.org_level_3.join(',');
      }

      const result = await apiClient.getMarketingReport(params);

      return (result || []).map((row: Record<string, unknown>) => ({
        salesman_name: String(row.salesman_name || ''),
        org_level_3: String(row.org_level_3 || ''),
        team_name: String(row.team_name || ''),
        假日车险签单天数: Number(row['假日车险签单天数'] || 0),
        假日天数: Number(row['假日天数'] || 0),
        假日车险签单比例: Number(row['假日车险签单比例'] || 0),
        假日商业险签单天数: Number(row['假日商业险签单天数'] || 0),
        假日商业险签单比例: Number(row['假日商业险签单比例'] || 0),
      }));
    },
    []
  );

  /**
   * 加载数据
   */
  const loadData = useCallback(
    async (filters: MarketingReportFilters) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      setCurrentFilters(filters);

      // 获取节假日统计
      const holidays = getHolidaySummary(filters.startDate, filters.endDate);
      const totalDays = countHolidaysInRange(filters.startDate, filters.endDate);

      // 分别加载两个表的数据，允许部分失败
      let orgReport: OrganizationReportRow[] = [];
      let salesmanDetail: SalesmanDetailRow[] = [];
      const errors: string[] = [];

      // 加载机构战报
      try {
        orgReport = await loadOrgReport(filters);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '机构战报加载失败';
        errors.push(`机构战报: ${msg}`);
      }

      // 加载业务员明细
      try {
        salesmanDetail = await loadSalesmanDetail(filters);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '业务员明细加载失败';
        errors.push(`业务员明细: ${msg}`);
      }

      setState({
        orgReport,
        salesmanDetail,
        holidayStats: {
          totalDays,
          holidays,
        },
        isLoading: false,
        error: errors.length > 0 ? errors.join('\n') : null,
      });
    },
    [loadOrgReport, loadSalesmanDetail]
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
  const sortedSalesmanDetail = sortData(state.salesmanDetail, salesmanDetailSort);

  // 自动加载（如果启用）
  useEffect(() => {
    if (autoLoad && currentFilters) {
      loadData(currentFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  return {
    ...state,
    loadData,
    refresh,
    orgReportSort,
    salesmanDetailSort,
    setOrgReportSort,
    setSalesmanDetailSort,
    sortedOrgReport,
    sortedSalesmanDetail,
    currentFilters,
  };
}
