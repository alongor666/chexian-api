/**
 * 车驾意推介率分析 Hook（层层下钻版）
 * Cross-Sell Recommendation Rate Analysis Hook (Hierarchical Drilldown)
 *
 * 支持层层下钻：
 *   Level 0: 四川分公司汇总 → 用户选维度
 *   Level 1: 按选定维度分组 → 点击行继续下钻
 *   Level N: 累积过滤 + 新维度分组
 *
 * 每层可停止、可上钻（面包屑导航）
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';
import type { TrendGranularity } from './useCrossSellTrend';
import { useRBAC } from '../../../shared/hooks/useRBAC';

/** 可选的下钻维度（不含 summary） */
export type CrossSellDimension =
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

/** 所有可用维度 */
export const ALL_DIMENSIONS: CrossSellDimension[] = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
];

/** 下钻路径中的一步 */
export interface DrilldownStep {
  dimension: CrossSellDimension;
  value: string;
  label: string; // 面包屑显示：如 "三级机构: 天府"
}

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
  vehicleCategory?: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  timePeriod?: TrendGranularity;
  enabled?: boolean;
}

export interface UseCrossSellAnalysisReturn {
  /** 当前过滤条件下的汇总行 */
  summary: CrossSellRow | null;
  /** 当前分组的数据行 */
  rows: CrossSellRow[];
  /** 下钻路径栈 */
  drillPath: DrilldownStep[];
  /** 当前分组维度（null = 仅汇总，未下钻） */
  currentGroupBy: CrossSellDimension | null;
  /** 当前可选的下钻维度（排除已使用的） */
  availableDimensions: CrossSellDimension[];
  /** 首次选择维度（从汇总进入下钻） */
  selectDimension: (dimension: CrossSellDimension) => void;
  /** 下钻到某个行：将当前行加入过滤，选择新维度分组 */
  drillDown: (rowValue: string, nextDimension: CrossSellDimension) => void;
  /** 上钻到指定层级（面包屑点击，-1 = 回顶层） */
  drillUp: (toIndex: number) => void;
  /** 重置到顶层 */
  reset: () => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 是否允许回到顶层（全公司） */
  canGoToTop: boolean;
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
  vehicleCategory,
  seatCoverageLevel,
  timePeriod,
  enabled = true,
}: UseCrossSellAnalysisProps): UseCrossSellAnalysisReturn {
  const { isOrgUser, userOrg, canGoToTop, getMinDrillUpIndex } = useRBAC();

  // 角色基础默认初始状态
  const initialDrillPath: DrilldownStep[] = useMemo(() => {
    if (isOrgUser && userOrg) {
      return [{ dimension: 'org_level_3', value: userOrg, label: `三级机构: ${userOrg}` }];
    }
    return [];
  }, [isOrgUser, userOrg]);

  const initialGroupBy: CrossSellDimension | null = useMemo(() => {
    if (isOrgUser) return 'salesman';
    return 'org_level_3'; // 管理员默认看机构分布
  }, [isOrgUser]);

  const [summary, setSummary] = useState<CrossSellRow | null>(null);
  const [rows, setRows] = useState<CrossSellRow[]>([]);
  const [drillPath, setDrillPath] = useState<DrilldownStep[]>(initialDrillPath);
  const [currentGroupBy, setCurrentGroupBy] = useState<CrossSellDimension | null>(initialGroupBy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当用户加载完成/变更时，重置回对应的角色的默认视图
  useEffect(() => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(initialGroupBy);
  }, [initialDrillPath, initialGroupBy]);

  // 计算已使用维度和可用维度
  const usedDimensions = new Set<CrossSellDimension>([
    ...drillPath.map(s => s.dimension),
    ...(currentGroupBy ? [currentGroupBy] : []),
  ]);
  const availableDimensions = ALL_DIMENSIONS.filter(d => !usedDimensions.has(d));

  // 防止 race condition
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
      const apiDrillPath = drillPath.map(s => ({
        dimension: s.dimension,
        value: s.value,
      }));

      const result = await apiClient.getCrossSellAnalysis({
        ...filterParams,
        drillPath: apiDrillPath,
        groupBy: currentGroupBy || undefined,
        ...(vehicleCategory ? { vehicleCategory } : {}),
        ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
        ...(timePeriod ? { timePeriod } : {}),
      });

      // 防止旧请求覆盖新数据
      if (fetchId !== fetchIdRef.current) return;

      if (result) {
        setSummary(result.summary ? mapRow(result.summary) : null);
        setRows((result.rows || []).map(mapRow));
      }
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [filters, drillPath, currentGroupBy, vehicleCategory, seatCoverageLevel, timePeriod, enabled]);

  // 依赖变化时自动请求
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** 首次选择维度（从汇总 → 分组视图） */
  const selectDimension = useCallback((dimension: CrossSellDimension) => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(dimension);
  }, [initialDrillPath]);

  /** 下钻：点击行 → 添加过滤 → 选择新维度 */
  const drillDown = useCallback((rowValue: string, nextDimension: CrossSellDimension) => {
    if (!currentGroupBy) return;

    const newStep: DrilldownStep = {
      dimension: currentGroupBy,
      value: rowValue,
      label: `${DIMENSION_LABELS[currentGroupBy]}: ${rowValue}`,
    };

    setDrillPath(prev => [...prev, newStep]);
    setCurrentGroupBy(nextDimension);
  }, [currentGroupBy]);

  /** 上钻到指定层级 */
  const drillUp = useCallback((toIndex: number) => {
    // Determine minimum depth: admin is -1, org user is 0 (the org level)
    const minIndex = getMinDrillUpIndex(-1);

    if (toIndex <= minIndex) {
      setDrillPath(initialDrillPath);
      setCurrentGroupBy(initialGroupBy);
      return;
    }

    if (toIndex < drillPath.length && toIndex > minIndex) {
      // 回到 drillPath[toIndex] 这一层的分组视图
      const newPath = drillPath.slice(0, toIndex);
      const restoredGroupBy = drillPath[toIndex].dimension;
      setDrillPath(newPath);
      setCurrentGroupBy(restoredGroupBy);
    }
  }, [drillPath, initialDrillPath, initialGroupBy, getMinDrillUpIndex]);

  /** 重置到顶层 */
  const reset = useCallback(() => {
    setDrillPath(initialDrillPath);
    setCurrentGroupBy(initialGroupBy);
  }, [initialDrillPath, initialGroupBy]);

  return {
    summary,
    rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
    selectDimension,
    drillDown,
    drillUp,
    reset,
    loading,
    error,
    refresh: fetchData,
    canGoToTop,
  };
}
