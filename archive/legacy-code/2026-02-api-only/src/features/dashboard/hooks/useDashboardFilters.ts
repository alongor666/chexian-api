import { useCallback, useState } from 'react';
import { buildSafeLikeClause } from '../../../shared/utils/security';
import type { FilterState } from '../../filters/FilterPanel';
import { useRBAC } from '../../../shared/hooks/useRBAC';

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
  const { isOrgUser, userOrg } = useRBAC();

  // Intercept and strongly apply user role boundaries to the raw state
  const effectiveFilters = isOrgUser ? { ...filters, org_level_3: userOrg } : filters;

  const buildWhereClause = useCallback(() => {
    try {
      const parts = ['1=1'];

      // Extract from the enforced filters
      const orgsToQuery = effectiveFilters.org_level_3;

      // Handle the case where orgsToQuery is an array of strings (the new format from AdvancedFilterPanel)
      // or a raw string (from older setups).
      if (Array.isArray(orgsToQuery) && orgsToQuery.length > 0) {
        // Safe mapping
        const orgClauses = orgsToQuery
          .filter(Boolean)
          .map(o => `org_level_3 LIKE '%${o.replace(/'/g, "''")}%'`);
        if (orgClauses.length > 0) {
          parts.push(`(${orgClauses.join(' OR ')})`);
        }
      } else if (typeof orgsToQuery === 'string') {
        const orgClause = buildSafeLikeClause('org_level_3', orgsToQuery);
        if (orgClause) parts.push(orgClause);
      }

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
  }, [effectiveFilters.org_level_3, filters.salesman_name, onError]);

  const applySalesmanFilter = useCallback((salesmanName: string) => {
    setFilters((prev) => ({
      ...prev,
      salesman_name: salesmanName || undefined,
    }));
  }, []);

  return {
    filters: effectiveFilters,
    setFilters,
    buildWhereClause,
    applySalesmanFilter,
  };
};
