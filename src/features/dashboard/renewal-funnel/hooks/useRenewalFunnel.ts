/**
 * 续保漏斗数据 Hook
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/query-keys';
import type { FunnelFilters, FunnelOverviewRow, FunnelTrendRow, FunnelTeamRow, FunnelSalesmanRow, FunnelActionRow, FunnelMatrixRow } from '../types';

function toParams(filters: FunnelFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.orgName) params.orgName = filters.orgName;
  if (filters.teamName) params.teamName = filters.teamName;
  if (filters.salesmanName) params.salesmanName = filters.salesmanName;
  if (filters.month) params.month = filters.month;
  if (filters.maturityFilter) params.maturityFilter = filters.maturityFilter;
  if (filters.daysRange !== undefined) params.daysRange = String(filters.daysRange);
  if (filters.expiryDateStart) params.expiryDateStart = filters.expiryDateStart;
  if (filters.expiryDateEnd) params.expiryDateEnd = filters.expiryDateEnd;
  return params;
}

export function useRenewalFunnelOverview(filters: FunnelFilters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalFunnelOverview(params),
    queryFn: () => apiClient.getRenewalFunnelOverview(params),
    select: (data) => data as FunnelOverviewRow[],
    staleTime: 5 * 60 * 1000,
  });
}

export function useRenewalFunnelTrend(filters: FunnelFilters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalFunnelTrend(params),
    queryFn: () => apiClient.getRenewalFunnelTrend(params),
    select: (data) => data as FunnelTrendRow[],
    staleTime: 5 * 60 * 1000,
  });
}

export function useRenewalFunnelTeam(filters: FunnelFilters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalFunnelTeam(params),
    queryFn: () => apiClient.getRenewalFunnelTeam(params),
    select: (data) => data as FunnelTeamRow[],
    staleTime: 5 * 60 * 1000,
    enabled: !!filters.orgName,
  });
}

export function useRenewalFunnelSalesman(filters: FunnelFilters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalFunnelSalesman(params),
    queryFn: () => apiClient.getRenewalFunnelSalesman(params),
    select: (data) => data as FunnelSalesmanRow[],
    staleTime: 5 * 60 * 1000,
    enabled: !!filters.orgName,
  });
}

export function useRenewalFunnelActionList(
  filters: FunnelFilters = {},
  pagination?: { page: number; pageSize: number },
) {
  const params = toParams(filters);
  if (pagination) {
    params.page = String(pagination.page);
    params.pageSize = String(pagination.pageSize);
  }
  return useQuery({
    queryKey: queryKeys.renewalFunnelActionList(params),
    queryFn: () => apiClient.getRenewalFunnelActionList(params),
    select: (data) => data as FunnelActionRow[],
    staleTime: 5 * 60 * 1000,
  });
}

export function useRenewalFunnelMatrix(filters: FunnelFilters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalFunnelMatrix(params),
    queryFn: () => apiClient.getRenewalFunnelMatrix(params),
    select: (data) => data as FunnelMatrixRow[],
    staleTime: 5 * 60 * 1000,
  });
}
