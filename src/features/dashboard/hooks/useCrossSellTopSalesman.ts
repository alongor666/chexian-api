/**
 * 车驾意推介率 - TOP20 业务员分析 Hook
 * Cross-Sell Top Salesman Hook
 *
 * 提供按主全或交三维度的 TOP20 推介率数据
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { formatSalesmanName } from '@/shared/utils/formatters';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';
import type { TopSalesmanCoverage } from '../../../../server/src/sql/cross-sell-top-salesman';

export interface TopSalesmanRow {
    salesman_name: string;
    org_level_3: string;
    driver_premium: number;
    auto_count: number;
    rate: number;
    avg_premium: number;
}

interface UseCrossSellTopSalesmanProps {
    filters: AdvancedFilterState;
    vehicleCategory: VehicleCategory;
    seatCoverageLevel?: SeatCoverageLevel;
    coverage: TopSalesmanCoverage;
    timePeriod: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    enabled?: boolean;
}

interface UseCrossSellTopSalesmanReturn {
    data: TopSalesmanRow[];
    loading: boolean;
    error: string | null;
}

export function useCrossSellTopSalesman({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    coverage,
    timePeriod,
    enabled = true,
}: UseCrossSellTopSalesmanProps): UseCrossSellTopSalesmanReturn {
    const { isOrgUser, userOrg } = useRBAC();
    const [data, setData] = useState<TopSalesmanRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchIdRef = useRef(0);

    const fetchData = useCallback(async () => {
        if (!enabled) return;

        const fetchId = ++fetchIdRef.current;
        setLoading(true);
        setError(null);

        try {
            const params: Record<string, string> = {
                ...buildFilterParams(filters, { isOrgUser, userOrg }),
                vehicleCategory,
                coverage,
                timePeriod,
            };
            if (seatCoverageLevel) {
                params.seatCoverageLevel = seatCoverageLevel;
            }

            const result = await apiClient.getCrossSellTopSalesman(params);
            if (fetchId !== fetchIdRef.current) return;

            if (result && result.rows) {
                // 后端保费已经是元，这里视需要是否转为万元，根据要求表格通常保留元或者直接显示
                // 从需求上看，如果是驾乘保费可以保留一位小数，我们在组件渲染中处理格式化
                setData(result.rows.map(row => {
                    return {
                        ...row,
                        salesman_name: formatSalesmanName(String(row.salesman_name || '')),
                        driver_premium: Number(row.driver_premium) || 0,
                        auto_count: Number(row.auto_count) || 0,
                        rate: Number(row.rate) || 0,
                        avg_premium: Number(row.avg_premium) || 0,
                    };
                }));
            }
        } catch (err) {
            if (fetchId !== fetchIdRef.current) return;
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (fetchId === fetchIdRef.current) {
                setLoading(false);
            }
        }
    }, [filters, vehicleCategory, seatCoverageLevel, coverage, timePeriod, enabled, isOrgUser, userOrg]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return {
        data,
        loading,
        error,
    };
}
