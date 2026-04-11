/**
 * 续保宇宙 V2 数据 Hooks
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/query-keys';

export interface DrillStep {
  dimension: string;
  value: string;
}

export interface RenewalV2Filters {
  orgName?: string;
  salesmanName?: string;
  customerCategory?: string;
  expiryMonth?: number;
  expiryDateStart?: string;
  expiryDateEnd?: string;
  funnelStage?: string;
  actionPriority?: string;
  groupBy?: string;
  isNev?: boolean;
  isNewCar?: boolean;
  /** 下钻路径：[{dimension, value}, ...] → 序列化为 JSON 传给后端 */
  drillPath?: DrillStep[];
  page?: number;
  pageSize?: number;
}

function toParams(filters: RenewalV2Filters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.orgName) params.orgName = filters.orgName;
  if (filters.salesmanName) params.salesmanName = filters.salesmanName;
  if (filters.customerCategory) params.customerCategory = filters.customerCategory;
  if (filters.expiryMonth != null) params.expiryMonth = String(filters.expiryMonth);
  if (filters.expiryDateStart) params.expiryDateStart = filters.expiryDateStart;
  if (filters.expiryDateEnd) params.expiryDateEnd = filters.expiryDateEnd;
  if (filters.funnelStage) params.funnelStage = filters.funnelStage;
  if (filters.actionPriority) params.actionPriority = filters.actionPriority;
  if (filters.groupBy) params.groupBy = filters.groupBy;
  if (filters.drillPath && filters.drillPath.length > 0) {
    params.drillPath = JSON.stringify(filters.drillPath);
  }
  if (filters.page != null) params.page = String(filters.page);
  if (filters.pageSize != null) params.pageSize = String(filters.pageSize);
  return params;
}

const STALE_5M = 5 * 60 * 1000;

export function useRenewalV2Overview(filters: RenewalV2Filters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalV2Overview(params),
    queryFn: () => apiClient.getRenewalV2Overview(params),
    staleTime: STALE_5M,
  });
}

export function useRenewalV2Trend(filters: RenewalV2Filters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalV2Trend(params),
    queryFn: () => apiClient.getRenewalV2Trend(params),
    staleTime: STALE_5M,
  });
}

export function useRenewalV2Funnel(filters: RenewalV2Filters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalV2Funnel(params),
    queryFn: () => apiClient.getRenewalV2Funnel(params),
    staleTime: STALE_5M,
  });
}

export function useRenewalV2Competition(filters: RenewalV2Filters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalV2Competition(params),
    queryFn: () => apiClient.getRenewalV2Competition(params),
    staleTime: STALE_5M,
  });
}

export function useRenewalV2Action(filters: RenewalV2Filters = {}) {
  const params = toParams(filters);
  return useQuery({
    queryKey: queryKeys.renewalV2Action(params),
    queryFn: () => apiClient.getRenewalV2Action(params),
    staleTime: STALE_5M,
  });
}

export function useRenewalV2Metadata() {
  return useQuery({
    queryKey: queryKeys.renewalV2Metadata(),
    queryFn: () => apiClient.getRenewalV2Metadata(),
    staleTime: 10 * 60 * 1000, // metadata 更少变化，10 分钟缓存
  });
}

export function usePatrolReport(domain: string) {
  return useQuery({
    queryKey: queryKeys.patrolReport(domain),
    queryFn: () => apiClient.getPatrolReport(domain),
    staleTime: STALE_5M,
  });
}

export function usePatrolNarrative(domain: string) {
  return useQuery({
    queryKey: ['patrol-narrative', domain] as const,
    queryFn: () => apiClient.getPatrolNarrative(domain),
    staleTime: STALE_5M,
    retry: false, // 报告可能不存在，404 不重试
  });
}
