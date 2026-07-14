/**
 * 销售队伍业绩（标保）API Hook
 *
 * 数据源：/api/query/sales-team-performance（admin-only）
 * 口径：修复后标保（sales_team_rules.sql，见 sales_portrait ADR-006）
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import type { SalesTeamDimension, SalesTeamPerformanceData } from '../types';

export interface SalesTeamPerformanceFilters {
  dimension: SalesTeamDimension;
  start?: string;
  end?: string;
}

export function useSalesTeamPerformance(filters: SalesTeamPerformanceFilters) {
  return useQuery({
    queryKey: ['sales-team-performance', filters],
    queryFn: () => {
      const params: Record<string, string> = { dimension: filters.dimension };
      if (filters.start) params.start = filters.start;
      if (filters.end) params.end = filters.end;
      return apiClient.getSalesTeamPerformance(params) as Promise<SalesTeamPerformanceData>;
    },
  });
}
