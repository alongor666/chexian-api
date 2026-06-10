/**
 * 承保地理分布数据获取 Hook
 *
 * 管理省/市两级数据获取、地图级别状态、loading/error。
 */

import { useState, useCallback } from 'react';
import { apiClient } from '@/shared/api/client';

export interface PolicyGeoRow {
  province: string;
  city?: string;
  vehicle_count: number;
  premium_wan: number;
  avg_premium: number;
  vehicle_pct: number;
  premium_pct: number;
}

interface GeoState {
  data: PolicyGeoRow[];
  loading: boolean;
  error: string | null;
}

const INIT_STATE: GeoState = { data: [], loading: false, error: null };

export function usePolicyGeo() {
  const [provinceData, setProvinceData] = useState<GeoState>(INIT_STATE);
  const [cityData, setCityData] = useState<GeoState>(INIT_STATE);

  const fetchProvinceData = useCallback(async (params?: Record<string, string>) => {
    setProvinceData(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiClient.geo.province(params);
      setProvinceData({ data: data ?? [], loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setProvinceData(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const fetchCityData = useCallback(async (province?: string, params?: Record<string, string>) => {
    setCityData(prev => ({ ...prev, loading: true, error: null }));
    try {
      const mergedParams = { ...params, ...(province ? { province } : {}) };
      const data = await apiClient.geo.city(mergedParams);
      setCityData({ data: data ?? [], loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询失败';
      setCityData(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  return {
    provinceData,
    cityData,
    fetchProvinceData,
    fetchCityData,
  };
}
