import { useCallback, useMemo, useState } from 'react';
import { createLogger } from '../../../shared/utils/logger';
import { buildOrgSalesmanCache, getAvailableSalesmen, type OrgSalesmanCache } from '../orgSalesman';
import type { AdvancedFilterState, FilterOptions, DateMetadata, DualDateMetadata } from '../../../shared/types/data';
import { getMetadataByCriteria } from '../../../shared/types/data';
import { apiClient } from '../../../shared/api/client';

const logger = createLogger('useFilterState');

export interface UseFilterStateResult {
  filters: AdvancedFilterState;
  setFilters: React.Dispatch<React.SetStateAction<AdvancedFilterState>>;
  filterOptions: FilterOptions;
  isFilterCollapsed: boolean;
  toggleFilterCollapsed: () => void;
  availableSalesmen: string[];
  loadFilterOptions: () => Promise<void>;
  loadDefaultPolicyMonth: (explicitMetadata?: DualDateMetadata) => Promise<void>;
  loadOrgSalesmanMapping: () => Promise<void>;
  dualDateMetadata?: DualDateMetadata;
  getCurrentMetadata: () => DateMetadata | undefined;
  maxDataDate?: string;
  availableYears?: number[];
  loadDataMetadata: () => Promise<DualDateMetadata | undefined>;
}

const getMonthRange = (monthKey: string): { start: string; end: string } => {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const paddedLastDay = String(lastDay).padStart(2, '0');
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${paddedLastDay}`,
  };
};

export const useFilterState = (): UseFilterStateResult => {
  const [filters, setFilters] = useState<AdvancedFilterState>({
    date_criteria: 'policy_date',
    analysis_year: new Date().getFullYear(),
  });
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});
  const [orgSalesmanCache, setOrgSalesmanCache] = useState<OrgSalesmanCache>({});

  const [dualDateMetadata, setDualDateMetadata] = useState<DualDateMetadata>();

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

  const loadDataMetadata = useCallback(async (): Promise<DualDateMetadata | undefined> => {
    try {
      logger.info('双口径元数据：开始加载');

      const today = new Date().toISOString().split('T')[0];
      const currentYear = new Date().getFullYear();

      const apiMetadata: DualDateMetadata = {
        policy: { maxDate: today, availableYears: [currentYear - 1, currentYear] },
        insurance: { maxDate: today, availableYears: [currentYear - 1, currentYear] },
      };

      setDualDateMetadata(apiMetadata);

      logger.info('双口径元数据：API 模式使用默认值', {
        maxDate: today,
        years: [currentYear - 1, currentYear],
      });
      return apiMetadata;
    } catch (err) {
      logger.error('双口径元数据：加载失败', err);

      const today = new Date().toISOString().split('T')[0];
      const currentYear = new Date().getFullYear();

      const fallbackMetadata: DualDateMetadata = {
        policy: { maxDate: today, availableYears: [currentYear] },
        insurance: { maxDate: today, availableYears: [currentYear] },
      };

      setDualDateMetadata(fallbackMetadata);

      logger.warn('双口径元数据：使用降级数据', {
        maxDate: today,
        year: currentYear,
      });
      return fallbackMetadata;
    }
  }, []);

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
      };

      setFilterOptions(options);
      logger.info('Filter options: loaded from API', {
        org_level_3: options.org_level_3?.length ?? 0,
        salesman_name: options.salesman_name?.length ?? 0,
        customer_category: options.customer_category?.length ?? 0,
        coverage_combination: options.coverage_combination?.length ?? 0,
      });
    } catch (err) {
      logger.error('Filter options: load failed', err);
    }
  }, []);

  const loadOrgSalesmanMapping = useCallback(async () => {
    try {
      logger.debug('OrgSalesman mapping: API 模式跳过，使用全量列表');
    } catch (err) {
      logger.error('OrgSalesman mapping: load failed', err);
    }
  }, []);

  const loadDefaultPolicyMonth = useCallback(async (explicitMetadata?: DualDateMetadata) => {
    try {
      const criteria = filters.date_criteria ?? 'policy_date';
      const currentMetadata = explicitMetadata
        ? getMetadataByCriteria(explicitMetadata, criteria)
        : getCurrentMetadata();

      if (currentMetadata && currentMetadata.availableYears.length > 0) {
        const currentYear = new Date().getFullYear();
        const defaultYear = currentMetadata.availableYears.includes(currentYear)
          ? currentYear
          : currentMetadata.availableYears[0];

        setFilters({
          date_criteria: filters.date_criteria ?? 'policy_date',
          analysis_year: defaultYear,
          policy_date_start: `${defaultYear}-01-01`,
          policy_date_end: currentMetadata.maxDate,
        });

        logger.info('默认日期范围已设置', {
          dateCriteria: filters.date_criteria ?? 'policy_date',
          defaultYear,
          maxDate: currentMetadata.maxDate,
          availableYears: currentMetadata.availableYears,
        });
        return;
      }

      // Fallback: use current date info
      const currentYear = new Date().getFullYear();
      const today = new Date().toISOString().split('T')[0];
      setFilters((prev) => ({
        ...prev,
        analysis_year: currentYear,
        policy_date_start: `${currentYear}-01-01`,
        policy_date_end: today,
      }));
    } catch (err) {
      logger.error('默认日期范围加载失败', err);
    }
  }, [getCurrentMetadata, filters.date_criteria]);

  const availableSalesmen = useMemo(() => {
    const allSalesmen = (filterOptions.salesman_name || []).map((option) => option.value);
    return getAvailableSalesmen(filters.org_level_3, orgSalesmanCache, allSalesmen);
  }, [filterOptions.salesman_name, filters.org_level_3, orgSalesmanCache]);

  return {
    filters,
    setFilters,
    filterOptions,
    isFilterCollapsed,
    toggleFilterCollapsed,
    availableSalesmen,
    loadFilterOptions,
    loadDefaultPolicyMonth,
    loadOrgSalesmanMapping,
    dualDateMetadata,
    getCurrentMetadata,
    maxDataDate,
    availableYears,
    loadDataMetadata,
  };
};
