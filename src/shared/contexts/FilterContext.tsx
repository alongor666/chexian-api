import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { createLogger } from '../utils/logger';
import { getAvailableSalesmen, type OrgSalesmanCache } from '../../features/dashboard/orgSalesman';
import type { AdvancedFilterState, FilterOptions, DateMetadata, DualDateMetadata } from '../types/data';
import { getMetadataByCriteria } from '../types/data';
import { formatSalesmanName } from '../utils/formatters';
import { useDataStatus } from './DataContext';
import { apiClient } from '../api/client';

const logger = createLogger('FilterContext');

interface FilterContextValue {
  /** 当前筛选器状态 */
  filters: AdvancedFilterState;
  /** 更新筛选器状态 */
  setFilters: React.Dispatch<React.SetStateAction<AdvancedFilterState>>;
  /** 筛选选项（机构、业务员、客户类别等） */
  filterOptions: FilterOptions;
  /** 筛选面板是否折叠 */
  isFilterCollapsed: boolean;
  /** 切换筛选面板折叠状态 */
  toggleFilterCollapsed: () => void;
  /** 可用的业务员列表（基于已选机构过滤） */
  availableSalesmen: string[];
  /** 当前口径的最大日期 */
  maxDataDate?: string;
  /** 当前口径的可用年份 */
  availableYears?: number[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 初始化筛选器（加载数据后调用） */
  initializeFilters: () => Promise<void>;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export const useGlobalFilters = (): FilterContextValue => {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useGlobalFilters must be used within a FilterProvider');
  }
  return context;
};

interface FilterProviderProps {
  children: ReactNode;
}

export const FilterProvider: React.FC<FilterProviderProps> = ({ children }) => {
  const { isDataLoaded } = useDataStatus();

  const [filters, setFilters] = useState<AdvancedFilterState>({
    date_criteria: 'policy_date',
    analysis_year: new Date().getFullYear(),
  });
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});
  const [orgSalesmanCache] = useState<OrgSalesmanCache>({});
  const [dualDateMetadata, setDualDateMetadata] = useState<DualDateMetadata>();
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const toggleFilterCollapsed = useCallback(() => {
    setIsFilterCollapsed((prev) => !prev);
  }, []);

  const getCurrentMetadata = useCallback((): DateMetadata | undefined => {
    if (!dualDateMetadata) return undefined;
    const criteria = filters.date_criteria ?? 'policy_date';
    return getMetadataByCriteria(dualDateMetadata, criteria);
  }, [dualDateMetadata, filters.date_criteria]);

  const maxDataDate = getCurrentMetadata()?.maxDate;
  const availableYears = getCurrentMetadata()?.availableYears;



  // API 模式：从后端获取筛选选项
  const loadFilterOptions = useCallback(async () => {
    try {
      logger.info('Filter options: loading from API');
      const apiOptions = await apiClient.getFilterOptions();

      const options: FilterOptions = {
        org_level_3: (apiOptions.orgs || []).map((value: string) => ({
          value,
          count: 0,
        })),
        salesman_name: (apiOptions.salesmen || []).map((value: string) => ({
          value,
          label: formatSalesmanName(value), // add label to FilterOption if not exists or override display
          count: 0,
        })),
        customer_category: (apiOptions.customerCategories || []).map((value: string) => ({
          value,
          count: 0,
        })),
        coverage_combination: (apiOptions.coverageCombinations || []).map((value: string) => ({
          value,
          count: 0,
        })),
        insurance_grade: (apiOptions.insuranceGrades || []).map((item) => ({
          value: item.value,
          count: item.count,
        })),
        small_truck_score: (apiOptions.smallTruckScores || []).map((item) => ({
          value: item.value,
          count: item.count,
        })),
        large_truck_score: (apiOptions.largeTruckScores || []).map((item) => ({
          value: item.value,
          count: item.count,
        })),
      };

      setFilterOptions(options);

      // Update max date from API
      const today = new Date().toISOString().split('T')[0];
      const maxDate = (apiOptions.dateRange && apiOptions.dateRange.max_date) ? apiOptions.dateRange.max_date.split(' ')[0] : today;
      const dataYear = new Date(maxDate).getFullYear();

      // 优先使用 API 返回的实际可用年份（从数据中动态查询），回退到 [dataYear-1, dataYear]
      const yearsFromApi = (apiOptions.availableYears && apiOptions.availableYears.length > 0)
        ? apiOptions.availableYears
        : [dataYear - 1, dataYear];

      const apiMetadata: DualDateMetadata = {
        policy: { maxDate: maxDate, availableYears: yearsFromApi },
        insurance: { maxDate: maxDate, availableYears: yearsFromApi },
      };
      setDualDateMetadata(apiMetadata);

      logger.info('Filter options: loaded from API, maxDate=', maxDate);
      return { options, maxDate, dataYear };
    } catch (err) {
      logger.error('Filter options: load failed', err);
      return null;
    }
  }, []);

  // 初始化筛选器
  const initializeFilters = useCallback(async () => {
    if (isInitialized) return;
    if (!isDataLoaded) {
      logger.debug('筛选器初始化跳过：数据未加载');
      return;
    }

    setIsLoading(true);
    try {
      const result = await loadFilterOptions();

      if (result) {
        setFilters(prev => ({
          ...prev,
          date_criteria: 'policy_date',
          analysis_year: result.dataYear,
          policy_date_start: `${result.dataYear}-01-01`,
          policy_date_end: result.maxDate,
        }));
      }

      setIsInitialized(true);
      logger.info('筛选器初始化完成（API 模式）');
    } catch (err) {
      logger.error('筛选器初始化失败', err);
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized, isDataLoaded, loadFilterOptions]);

  useEffect(() => {
    if (isDataLoaded && !isInitialized && !isLoading) {
      initializeFilters();
    }
  }, [isDataLoaded, isInitialized, isLoading, initializeFilters]);

  const availableSalesmen = useMemo(() => {
    const allSalesmen = (filterOptions.salesman_name || []).map((option) => option.value);
    return getAvailableSalesmen(filters.org_level_3, orgSalesmanCache, allSalesmen);
  }, [filterOptions.salesman_name, filters.org_level_3, orgSalesmanCache]);

  const value = useMemo<FilterContextValue>(
    () => ({
      filters,
      setFilters,
      filterOptions,
      isFilterCollapsed,
      toggleFilterCollapsed,
      availableSalesmen,
      maxDataDate,
      availableYears,
      isLoading,
      initializeFilters,
    }),
    [
      filters,
      setFilters,
      filterOptions,
      isFilterCollapsed,
      toggleFilterCollapsed,
      availableSalesmen,
      maxDataDate,
      availableYears,
      isLoading,
      initializeFilters,
    ]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
};
