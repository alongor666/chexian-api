/**
 * 营业货车分析数据 Hook（API-only 模式）
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../../../shared/api/client';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { createLogger } from '../../../shared/utils/logger';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { RoseChartDatum } from '../types';
import type { ViewPerspective } from '../../../shared/types';

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

/**
 * 营业货车分析数据 Hook
 */
export function useTruckAnalysis({
  filters,
  perspective,
  enabled = true,
}: UseTruckAnalysisProps): UseTruckAnalysisReturn {
  const { isDataLoaded } = useDataStatus();

  const [rosePremiumData, setRosePremiumData] = useState<RoseChartDatum[]>([]);
  const [roseCountData, setRoseCountData] = useState<RoseChartDatum[]>([]);
  const [tonnageByOrgData, setTonnageByOrgData] = useState<TruckByOrgData[]>([]);
  const [orgPremiumData, setOrgPremiumData] = useState<RoseChartDatum[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFromApi = useCallback(async () => {
    const params = {
      ...buildFilterParams(filters),
      queryType: 'all' as const,
      metric: perspective === 'count' ? 'count' : 'premium',
    };

    logger.debug('Fetching truck data from API', params);

    const result = await apiClient.getTruckAnalysis(params);

    if (result) {
      setRosePremiumData(result.rosePremium || []);
      setRoseCountData(result.roseCount || []);
      setTonnageByOrgData(result.tonnageByOrg || []);
      setOrgPremiumData(result.orgPremium || []);
    }
  }, [filters, perspective]);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      await fetchFromApi();
    } catch (err) {
      logger.error('Failed to load truck analysis data', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchFromApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    rosePremiumData,
    roseCountData,
    tonnageByOrgData,
    orgPremiumData,
    loading,
    error,
    refresh: fetchData,
  };
}
