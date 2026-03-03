/**
 * 营业货车分析数据 Hook（API-only 模式）
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/query-keys';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { createLogger } from '../../../shared/utils/logger';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { RoseChartDatum } from '../types';
import type { ViewPerspective } from '../../../shared/types';
import { useRBAC } from '../../../shared/hooks/useRBAC';

const logger = createLogger('useTruckAnalysis');

interface TruckByOrgData {
  org_level_3: string;
  tonnage_segment: string;
  premium: number;
  premium_ratio: number;
}

interface UseTruckAnalysisProps {
  filters: AdvancedFilterState;
  perspective: ViewPerspective;
  enabled?: boolean;
}

interface UseTruckAnalysisReturn {
  rosePremiumData: RoseChartDatum[];
  roseCountData: RoseChartDatum[];
  tonnageByOrgData: TruckByOrgData[];
  orgPremiumData: RoseChartDatum[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface TruckAnalysisSelected {
  rosePremiumData: RoseChartDatum[];
  roseCountData: RoseChartDatum[];
  tonnageByOrgData: TruckByOrgData[];
  orgPremiumData: RoseChartDatum[];
}

/**
 * 营业货车分析数据 Hook
 */
export function useTruckAnalysis({
  filters,
  perspective,
  enabled = true,
}: UseTruckAnalysisProps): UseTruckAnalysisReturn {
  const { isDataLoaded } = useDataStatus();
  const { isOrgUser, userOrg } = useRBAC();
  const queryClient = useQueryClient();

  const params = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    queryType: 'all' as const,
    metric: perspective === 'policy_count' ? 'count' : 'premium',
  };

  logger.debug('useTruckAnalysis params', params);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.truckAnalysis(params),
    queryFn: () => apiClient.getTruckAnalysis(params),
    enabled: enabled && isDataLoaded,
    select: (result): TruckAnalysisSelected => ({
      rosePremiumData: result?.rosePremium ?? [],
      roseCountData: result?.roseCount ?? [],
      tonnageByOrgData: result?.tonnageByOrg ?? [],
      orgPremiumData: result?.orgPremium ?? [],
    }),
  });

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.truckAnalysis(params) });

  return {
    rosePremiumData: data?.rosePremiumData ?? [],
    roseCountData: data?.roseCountData ?? [],
    tonnageByOrgData: data?.tonnageByOrgData ?? [],
    orgPremiumData: data?.orgPremiumData ?? [],
    loading: isLoading,
    error: error instanceof Error ? error.message : error != null ? String(error) : null,
    refresh,
  };
}
