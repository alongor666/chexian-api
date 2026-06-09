/**
 * 报价转化分析 API Hooks
 *
 * 使用项目统一的 apiClient（自动处理 token、请求合并、超时）
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import type { QuoteFilters, QuoteKpi, FunnelRow, DrilldownRow, HeatmapRow, PriceRow, TrendRow, RankingRow, DrillLevel } from '../types';

function filtersToParams(f: QuoteFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.dateStart) p.dateStart = f.dateStart;
  if (f.dateEnd) p.dateEnd = f.dateEnd;
  if (f.renewalType) p.renewalType = f.renewalType;
  if (f.orgName) p.orgName = f.orgName;
  if (f.teamName) p.teamName = f.teamName;
  if (f.salesmanNo) p.salesmanNo = f.salesmanNo;
  if (f.customerCategory) p.customerCategory = f.customerCategory;
  if (f.insuranceCombo) p.insuranceCombo = f.insuranceCombo;
  if (f.isTelemarketing) p.isTelemarketing = f.isTelemarketing;
  if (f.isNewEnergy) p.isNewEnergy = f.isNewEnergy;
  if (f.isTransferred) p.isTransferred = f.isTransferred;
  if (f.riskGrade) p.riskGrade = f.riskGrade;
  if (f.ncdMin !== undefined && f.ncdMin !== '') p.ncdMin = f.ncdMin;
  if (f.ncdMax !== undefined && f.ncdMax !== '') p.ncdMax = f.ncdMax;
  return p;
}

export function useQuoteKpi(filters: QuoteFilters) {
  return useQuery({
    queryKey: ['quote-conversion', 'kpi', filters],
    queryFn: () => apiClient.quoteConversion.kpi(filtersToParams(filters)) as Promise<QuoteKpi>,
  });
}

export function useQuoteFunnel(filters: QuoteFilters) {
  return useQuery({
    queryKey: ['quote-conversion', 'funnel', filters],
    queryFn: () => apiClient.quoteConversion.funnel(filtersToParams(filters)) as Promise<FunnelRow[]>,
  });
}

export function useQuoteDrilldown(filters: QuoteFilters, level: DrillLevel) {
  return useQuery({
    queryKey: ['quote-conversion', 'drilldown', filters, level],
    queryFn: () => apiClient.quoteConversion.drilldown({ ...filtersToParams(filters), level }) as Promise<DrilldownRow[]>,
  });
}

export function useQuoteHeatmap(filters: QuoteFilters, colDimension: string) {
  return useQuery({
    queryKey: ['quote-conversion', 'heatmap', filters, colDimension],
    queryFn: () => apiClient.quoteConversion.heatmap({ ...filtersToParams(filters), colDimension }) as Promise<HeatmapRow[]>,
  });
}

export function useQuotePrice(filters: QuoteFilters) {
  return useQuery({
    queryKey: ['quote-conversion', 'price', filters],
    queryFn: () => apiClient.quoteConversion.price(filtersToParams(filters)) as Promise<PriceRow[]>,
  });
}

export function useQuoteTrend(filters: QuoteFilters, granularity: 'day' | 'week' | 'month' = 'week') {
  return useQuery({
    queryKey: ['quote-conversion', 'trend', filters, granularity],
    queryFn: () => apiClient.quoteConversion.trend({ ...filtersToParams(filters), granularity }) as Promise<TrendRow[]>,
  });
}

export { filtersToParams };

export function useQuoteRanking(filters: QuoteFilters, dimension: string) {
  return useQuery({
    queryKey: ['quote-conversion', 'ranking', filters, dimension],
    queryFn: () => apiClient.quoteConversion.ranking({ ...filtersToParams(filters), dimension }) as Promise<RankingRow[]>,
  });
}
