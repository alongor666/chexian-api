/**
 * StableContext — 稳定状态 Context
 *
 * 持有筛选选项和初始化逻辑（仅在应用启动时加载一次）。
 * 与 FilterContext（易变状态：筛选条件、折叠状态）分离，
 * 避免筛选条件变更时触发稳定状态消费者重渲染。
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { createLogger } from '../utils/logger';
import type { FilterOptions, DualDateMetadata } from '../types/data';
import { formatSalesmanName } from '../utils/formatters';
import { useDataStatus } from './DataContext';
import { apiClient } from '../api/client';

const logger = createLogger('StableContext');

export interface StableContextValue {
  /** 筛选选项（机构、业务员、客户类别等），从 API 加载一次 */
  filterOptions: FilterOptions;
  /** 业务员→团队名映射（用于动态标题），从 API 加载一次 */
  salesmanTeamMap: Map<string, string>;
  /** 当前口径的最大日期（基于 policy_date 口径） */
  maxDataDate?: string;
  /** 当前口径的可用年份 */
  availableYears?: number[];
  /** 是否正在加载筛选选项 */
  isLoading: boolean;
  /** 初始化筛选器（由外部触发或 effect 自动执行） */
  initializeFilters: () => Promise<void>;
  /**
   * 内部供 FilterProvider 使用的初始化结果。
   * 当 StableProvider 完成初始化后，FilterProvider 监听此值以同步初始日期范围。
   */
  _internal: {
    latestInitResult: { maxDate: string; dataYear: number } | null;
    isInitialized: boolean;
  };
}

const StableContext = createContext<StableContextValue | null>(null);

/**
 * 仅消费稳定状态时使用此 Hook（不会因筛选条件变更重渲染）。
 * 常规消费者请继续使用 `useGlobalFilters()`（保持向后兼容）。
 */
export const useStableContext = (): StableContextValue => {
  const context = useContext(StableContext);
  if (!context) {
    throw new Error('useStableContext must be used within a StableProvider');
  }
  return context;
};

interface StableProviderProps {
  children: ReactNode;
}

export const StableProvider: React.FC<StableProviderProps> = ({ children }) => {
  const { isDataLoaded } = useDataStatus();

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});
  const [salesmanTeamMap, setSalesmanTeamMap] = useState<Map<string, string>>(new Map());
  const [dualDateMetadata, setDualDateMetadata] = useState<DualDateMetadata>();
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [latestInitResult, setLatestInitResult] = useState<{
    maxDate: string;
    dataYear: number;
  } | null>(null);

  // maxDataDate 和 availableYears 直接取 policy 口径（默认口径）
  // 注：两个口径（policy_date / insurance_start_date）在当前实现中使用相同的日期范围
  const maxDataDate = dualDateMetadata?.policy.maxDate;
  const availableYears = dualDateMetadata?.policy.availableYears;

  // 从 API 加载筛选选项
  const loadFilterOptions = useCallback(async () => {
    try {
      logger.info('StableContext: 从 API 加载筛选选项');
      const apiOptions = await apiClient.getFilterOptions();

      const options: FilterOptions = {
        org_level_3: (apiOptions.orgs || []).map((value: string) => ({
          value,
          count: 0,
        })),
        salesman_name: (apiOptions.salesmen || []).map((value: string) => ({
          value,
          label: formatSalesmanName(value),
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
      };

      setFilterOptions(options);

      // 构建业务员→团队映射
      const teamMap = new Map<string, string>();
      (apiOptions.salesmenWithTeam || []).forEach((item) => {
        if (item.salesman_name && item.team_name && item.team_name !== '未归属团队') {
          teamMap.set(item.salesman_name, item.team_name);
        }
      });
      setSalesmanTeamMap(teamMap);

      // 计算日期元数据
      const today = new Date().toISOString().split('T')[0];
      const maxDate =
        apiOptions.dateRange && apiOptions.dateRange.max_date
          ? apiOptions.dateRange.max_date.slice(0, 10)
          : today;
      const dataYear = new Date(maxDate).getFullYear();

      const yearsFromApi =
        apiOptions.availableYears && apiOptions.availableYears.length > 0
          ? apiOptions.availableYears
          : [dataYear - 1, dataYear];

      const apiMetadata: DualDateMetadata = {
        policy: { maxDate, availableYears: yearsFromApi },
        insurance: { maxDate, availableYears: yearsFromApi },
      };
      setDualDateMetadata(apiMetadata);

      logger.info('StableContext: 筛选选项加载完成, maxDate=', maxDate);
      return { maxDate, dataYear };
    } catch (err) {
      logger.error('StableContext: 筛选选项加载失败', err);
      return null;
    }
  }, []);

  // 初始化筛选器（幂等：已初始化则跳过）
  const initializeFilters = useCallback(async () => {
    if (isInitialized) return;
    if (!isDataLoaded) {
      logger.debug('StableContext: 初始化跳过，数据未加载');
      return;
    }

    setIsLoading(true);
    try {
      const result = await loadFilterOptions();
      if (result) {
        setLatestInitResult(result);
      }
      setIsInitialized(true);
      logger.info('StableContext: 初始化完成');
    } catch (err) {
      logger.error('StableContext: 初始化失败', err);
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized, isDataLoaded, loadFilterOptions]);

  // 数据加载完成后自动初始化
  useEffect(() => {
    if (isDataLoaded && !isInitialized && !isLoading) {
      initializeFilters();
    }
  }, [isDataLoaded, isInitialized, isLoading, initializeFilters]);

  const value: StableContextValue = {
    filterOptions,
    salesmanTeamMap,
    maxDataDate,
    availableYears,
    isLoading,
    initializeFilters,
    _internal: {
      latestInitResult,
      isInitialized,
    },
  };

  return <StableContext.Provider value={value}>{children}</StableContext.Provider>;
};
