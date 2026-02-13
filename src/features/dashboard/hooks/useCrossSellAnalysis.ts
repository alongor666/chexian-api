/**
 * 车驾意推介率分析 Hook
 * Cross-Sell Recommendation Rate Analysis Hook
 *
 * 第一层：四川分公司汇总
 * 下钻：按用户选择的维度展开明细
 */

import { useState, useCallback, useEffect } from 'react';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';

/** 下钻维度 */
export type CrossSellDimension =
  | 'summary'
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

/** 维度中文标签 */
export const DIMENSION_LABELS: Record<CrossSellDimension, string> = {
  summary: '公司汇总',
  org_level_3: '三级机构',
  team: '销售团队',
  salesman: '业务员',
  customer_category: '客户类别',
  is_new_car: '是否新车',
  is_transfer: '是否过户',
  is_nev: '是否新能源',
  is_telemarketing: '是否电销',
  is_renewal: '是否续保',
};

/** 可选的下钻维度列表（排除 summary；team 需要 SalesmanPlanFact 表，暂不可用） */
export const DRILLDOWN_DIMENSIONS: CrossSellDimension[] = [
  'org_level_3', 'salesman', 'customer_category',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
];

/** 单行数据结构 */
export interface CrossSellRow {
  group_name: string;
  total_auto_count: number;
  total_driver_count: number;
  danjiao_auto_count: number;
  danjiao_driver_count: number;
  danjiao_rate: number;
  jiaosan_auto_count: number;
  jiaosan_driver_count: number;
  jiaosan_rate: number;
  zhuquan_auto_count: number;
  zhuquan_driver_count: number;
  zhuquan_rate: number;
  total_rate: number;
}

interface UseCrossSellAnalysisProps {
  filters: AdvancedFilterState;
  enabled?: boolean;
}

interface UseCrossSellAnalysisReturn {
  /** 四川分公司汇总行 */
  summary: CrossSellRow | null;
  /** 下钻明细行 */
  rows: CrossSellRow[];
  /** 当前下钻维度 */
  dimension: CrossSellDimension;
  /** 切换下钻维度 */
  setDimension: (dim: CrossSellDimension) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function mapRow(raw: Record<string, unknown>): CrossSellRow {
  return {
    group_name: String(raw.group_name ?? ''),
    total_auto_count: Number(raw.total_auto_count ?? 0),
    total_driver_count: Number(raw.total_driver_count ?? 0),
    danjiao_auto_count: Number(raw.danjiao_auto_count ?? 0),
    danjiao_driver_count: Number(raw.danjiao_driver_count ?? 0),
    danjiao_rate: Number(raw.danjiao_rate ?? 0),
    jiaosan_auto_count: Number(raw.jiaosan_auto_count ?? 0),
    jiaosan_driver_count: Number(raw.jiaosan_driver_count ?? 0),
    jiaosan_rate: Number(raw.jiaosan_rate ?? 0),
    zhuquan_auto_count: Number(raw.zhuquan_auto_count ?? 0),
    zhuquan_driver_count: Number(raw.zhuquan_driver_count ?? 0),
    zhuquan_rate: Number(raw.zhuquan_rate ?? 0),
    total_rate: Number(raw.total_rate ?? 0),
  };
}

export function useCrossSellAnalysis({
  filters,
  enabled = true,
}: UseCrossSellAnalysisProps): UseCrossSellAnalysisReturn {
  const [summary, setSummary] = useState<CrossSellRow | null>(null);
  const [rows, setRows] = useState<CrossSellRow[]>([]);
  const [dimension, setDimension] = useState<CrossSellDimension>('org_level_3');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        ...buildFilterParams(filters),
        dimension,
      };

      const result = await apiClient.getCrossSellAnalysis(params);

      if (result) {
        setSummary(result.summary ? mapRow(result.summary) : null);
        setRows((result.rows || []).map(mapRow));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, dimension, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    summary,
    rows,
    dimension,
    setDimension,
    loading,
    error,
    refresh: fetchData,
  };
}
