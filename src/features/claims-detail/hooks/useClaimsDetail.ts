import { useState, useCallback } from 'react';
import { apiClient } from '@/shared/api/client';

interface FetchState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

function createFetchState<T>(initial: T): FetchState<T> {
  return { data: initial, loading: false, error: null };
}

export function useClaimsDetail() {
  const [pendingOverview, setPendingOverview] = useState<FetchState<any[]>>(createFetchState([]));
  const [pendingByOrg, setPendingByOrg] = useState<FetchState<any[]>>(createFetchState([]));
  const [pendingAging, setPendingAging] = useState<FetchState<any[]>>(createFetchState([]));
  const [causeAnalysis, setCauseAnalysis] = useState<FetchState<any[]>>(createFetchState([]));
  const [claimCycle, setClaimCycle] = useState<FetchState<any[]>>(createFetchState([]));
  const [geoAccident, setGeoAccident] = useState<FetchState<any[]>>(createFetchState([]));
  const [geoPlate, setGeoPlate] = useState<FetchState<any[]>>(createFetchState([]));
  const [geoComparison, setGeoComparison] = useState<FetchState<any>>(createFetchState(null));
  const [frequencyYoy, setFrequencyYoy] = useState<FetchState<any[]>>(createFetchState([]));
  const [lossRatioDev, setLossRatioDev] = useState<FetchState<any[]> & { claimsCutoff: string | null }>(
    { ...createFetchState([]), claimsCutoff: null }
  );

  const fetchPendingData = useCallback(async (params?: Record<string, string>) => {
    setPendingOverview(prev => ({ ...prev, loading: true, error: null }));
    setPendingByOrg(prev => ({ ...prev, loading: true, error: null }));
    setPendingAging(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [overview, byOrg, aging] = await Promise.all([
        apiClient.getClaimsDetailPendingOverview(params),
        apiClient.getClaimsDetailPendingByOrg(params),
        apiClient.getClaimsDetailPendingAging(params),
      ]);
      setPendingOverview({ data: overview, loading: false, error: null });
      setPendingByOrg({ data: byOrg, loading: false, error: null });
      setPendingAging({ data: aging, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setPendingOverview(prev => ({ ...prev, loading: false, error: msg }));
      setPendingByOrg(prev => ({ ...prev, loading: false, error: msg }));
      setPendingAging(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const fetchCauseAndCycle = useCallback(async (params?: Record<string, string>) => {
    setCauseAnalysis(prev => ({ ...prev, loading: true, error: null }));
    setClaimCycle(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [cause, cycle] = await Promise.all([
        apiClient.getClaimsDetailCauseAnalysis(params),
        apiClient.getClaimsDetailClaimCycle(params),
      ]);
      setCauseAnalysis({ data: cause, loading: false, error: null });
      setClaimCycle({ data: cycle, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setCauseAnalysis(prev => ({ ...prev, loading: false, error: msg }));
      setClaimCycle(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const fetchGeoData = useCallback(async (params?: Record<string, string>) => {
    setGeoAccident(prev => ({ ...prev, loading: true, error: null }));
    setGeoPlate(prev => ({ ...prev, loading: true, error: null }));
    setGeoComparison(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [accident, plate, comparison] = await Promise.all([
        apiClient.getClaimsDetailGeoAccident(params),
        apiClient.getClaimsDetailGeoPlate(params),
        apiClient.getClaimsDetailGeoComparison(params),
      ]);
      setGeoAccident({ data: accident, loading: false, error: null });
      setGeoPlate({ data: plate, loading: false, error: null });
      setGeoComparison({ data: comparison, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setGeoAccident(prev => ({ ...prev, loading: false, error: msg }));
      setGeoPlate(prev => ({ ...prev, loading: false, error: msg }));
      setGeoComparison(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const fetchFrequencyYoy = useCallback(async (params?: Record<string, string>) => {
    setFrequencyYoy(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiClient.getClaimsDetailFrequencyYoy(params);
      setFrequencyYoy({ data, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setFrequencyYoy(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const fetchLossRatioDev = useCallback(async (params?: Record<string, string>) => {
    setLossRatioDev(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiClient.getClaimsDetailLossRatioDev(params);
      const claimsCutoff = data.length > 0 ? (data[0]?.claims_cutoff ?? null) : null;
      setLossRatioDev({ data, claimsCutoff, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setLossRatioDev(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  return {
    pendingOverview,
    pendingByOrg,
    pendingAging,
    causeAnalysis,
    claimCycle,
    geoAccident,
    geoPlate,
    geoComparison,
    frequencyYoy,
    lossRatioDev,
    fetchPendingData,
    fetchCauseAndCycle,
    fetchGeoData,
    fetchFrequencyYoy,
    fetchLossRatioDev,
  };
}
