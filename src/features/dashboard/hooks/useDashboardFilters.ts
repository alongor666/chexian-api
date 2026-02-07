import { useCallback, useState } from 'react';
import { buildSafeLikeClause } from '../../../shared/utils/security';
import type { FilterState } from '../../filters/FilterPanel';

export interface UseDashboardFiltersOptions {
  onError?: (message: string) => void;
}

export interface UseDashboardFiltersResult {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  buildWhereClause: () => string;
  applySalesmanFilter: (salesmanName: string) => void;
}

export const useDashboardFilters = (
  options: UseDashboardFiltersOptions = {}
): UseDashboardFiltersResult => {
  const { onError } = options;
  const [filters, setFilters] = useState<FilterState>({});

  const buildWhereClause = useCallback(() => {
    try {
      const parts = ['1=1'];

      const orgClause = buildSafeLikeClause('org_level_3', filters.org_level_3);
      if (orgClause) parts.push(orgClause);

      const nameClause = buildSafeLikeClause('salesman_name', filters.salesman_name);
      if (nameClause) parts.push(nameClause);

      return parts.join(' AND ');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (onError) {
        onError(message);
      }
      return '1=0';
    }
  }, [filters, onError]);

  const applySalesmanFilter = useCallback((salesmanName: string) => {
    setFilters((prev) => ({
      ...prev,
      salesman_name: salesmanName || undefined,
    }));
  }, []);

  return {
    filters,
    setFilters,
    buildWhereClause,
    applySalesmanFilter,
  };
};
