/**
 * FilterContext — 易变筛选状态 Context
 *
 * 仅持有会随用户交互频繁变更的状态：筛选条件、折叠状态、可用业务员列表。
 * 稳定状态（筛选选项、团队映射、日期元数据）已迁移至 StableContext。
 *
 * `useGlobalFilters()` 合并两个 Context 的值，保持原有 11 字段接口不变，
 * 确保 48 个现有消费者无需修改。
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';
import { createLogger } from '../utils/logger';
import { getAvailableSalesmen, type OrgSalesmanCache } from '../../features/dashboard/orgSalesman';
import type { AdvancedFilterState, FilterOptions } from '../types/data';
import { useStableContext } from './StableContext';

const logger = createLogger('FilterContext');

/** 向后兼容接口：保持原有 11 个字段，所有消费者无需修改 */
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
  /** 业务员→团队名映射（用于动态标题） */
  salesmanTeamMap: Map<string, string>;
  /** 当前口径的最大日期 */
  maxDataDate?: string;
  /** 当前口径的可用年份 */
  availableYears?: number[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 初始化筛选器（加载数据后调用） */
  initializeFilters: () => Promise<void>;
}

/** 仅包含 FilterContext 自身持有的易变字段 */
interface FilterContextOwnValue {
  filters: AdvancedFilterState;
  setFilters: React.Dispatch<React.SetStateAction<AdvancedFilterState>>;
  isFilterCollapsed: boolean;
  toggleFilterCollapsed: () => void;
  availableSalesmen: string[];
}

const FilterContext = createContext<FilterContextOwnValue | null>(null);

/**
 * 向后兼容 hook：返回原有 11 字段接口（合并 FilterContext + StableContext）。
 * 所有 48 个现有消费者无需修改。
 */
export const useGlobalFilters = (): FilterContextValue => {
  const filterCtx = useContext(FilterContext);
  const stableCtx = useStableContext();

  if (!filterCtx) {
    throw new Error('useGlobalFilters must be used within a FilterProvider');
  }

  return {
    ...filterCtx,
    filterOptions: stableCtx.filterOptions,
    salesmanTeamMap: stableCtx.salesmanTeamMap,
    maxDataDate: stableCtx.maxDataDate,
    availableYears: stableCtx.availableYears,
    isLoading: stableCtx.isLoading,
    initializeFilters: stableCtx.initializeFilters,
  };
};

interface FilterProviderProps {
  children: ReactNode;
}

export const FilterProvider: React.FC<FilterProviderProps> = ({ children }) => {
  const stableCtx = useStableContext();
  const { filterOptions, _internal } = stableCtx;

  const [filters, setFilters] = useState<AdvancedFilterState>({
    date_criteria: 'policy_date',
    analysis_year: new Date().getFullYear(),
  });
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);
  const [orgSalesmanCache] = useState<OrgSalesmanCache>({});
  // 追踪是否已根据初始化结果同步过日期范围
  const [isFilterSynced, setIsFilterSynced] = useState(false);

  const toggleFilterCollapsed = useCallback(() => {
    setIsFilterCollapsed((prev) => !prev);
  }, []);

  // 监听 StableContext 初始化结果，同步初始日期范围到 filters
  useEffect(() => {
    if (_internal.latestInitResult && !isFilterSynced) {
      const { maxDate, dataYear } = _internal.latestInitResult;
      setFilters((prev) => ({
        ...prev,
        date_criteria: 'policy_date',
        analysis_year: dataYear,
        policy_date_start: `${dataYear}-01-01`,
        policy_date_end: maxDate,
      }));
      setIsFilterSynced(true);
      logger.info('FilterContext: 已同步初始日期范围, dataYear=', dataYear, 'maxDate=', maxDate);
    }
  }, [_internal.latestInitResult, isFilterSynced]);

  const availableSalesmen = useMemo(() => {
    const allSalesmen = (filterOptions.salesman_name || []).map((option) => option.value);
    return getAvailableSalesmen(filters.org_level_3, orgSalesmanCache, allSalesmen);
  }, [filterOptions.salesman_name, filters.org_level_3, orgSalesmanCache]);

  const value = useMemo<FilterContextOwnValue>(
    () => ({
      filters,
      setFilters,
      isFilterCollapsed,
      toggleFilterCollapsed,
      availableSalesmen,
    }),
    [filters, setFilters, isFilterCollapsed, toggleFilterCollapsed, availableSalesmen]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
};
