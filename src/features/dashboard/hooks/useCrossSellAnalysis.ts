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

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { apiClient, ENABLE_BUNDLE_ROUTES } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';
import type { TrendGranularity } from './useCrossSellTrend';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import type { TopSalesmanRow } from './useCrossSellTopSalesman';
import { formatSalesmanName } from '../../../shared/utils/formatters';
import { queryKeys } from '../../../shared/api/query-keys';

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
  /** 时间维度汇总（供 KPI 看板复用） */
  timePeriodSummary: {
    maxDate: string | null;
    rows: Array<Record<string, unknown>>;
  };
  /** 趋势行数据（供趋势图复用） */
  trendRows: Array<{
    time_period: string;
    coverage_combination: string;
    rate: number;
    avg_premium: number;
    auto_count: number;
  }>;
  /** TOP20 业务员（主全 / 交三） */
  topSalesman: {
    zhuquanRows: TopSalesmanRow[];
    jiaosanRows: TopSalesmanRow[];
  };
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
  refresh: () => void;
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

// bundle 结果的标准结构类型
type BundleLikeResult = {
  summary: { maxDate: string | null; rows: Array<Record<string, unknown>> };
  trend: { rows: Array<Record<string, unknown>> };
  drilldown: {
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
  };
  topSalesman: {
    zhuquanRows: Array<Record<string, unknown>>;
    jiaosanRows: Array<Record<string, unknown>>;
  };
};

// select 转换后的标准数据结构
type TransformedData = {
  summary: CrossSellRow | null;
  rows: CrossSellRow[];
  timePeriodSummary: { maxDate: string | null; rows: Array<Record<string, unknown>> };
  trendRows: Array<{
    time_period: string;
    coverage_combination: string;
    rate: number;
    avg_premium: number;
    auto_count: number;
  }>;
  topSalesman: {
    zhuquanRows: TopSalesmanRow[];
    jiaosanRows: TopSalesmanRow[];
  };
};

const EMPTY_TRANSFORMED_DATA: TransformedData = {
  summary: null,
  rows: [],
  timePeriodSummary: { maxDate: null, rows: [] },
  trendRows: [],
  topSalesman: { zhuquanRows: [], jiaosanRows: [] },
};

function transformBundleResult(result: BundleLikeResult): TransformedData {
  return {
    summary: result.drilldown.summary ? mapRow(result.drilldown.summary) : null,
    rows: (result.drilldown.rows || []).map(mapRow),
    trendRows: (result.trend.rows || []).map((row) => ({
      time_period: String(row.time_period ?? ''),
      coverage_combination: String(row.coverage_combination ?? ''),
      rate: Number(row.rate ?? 0),
      avg_premium: Number(row.avg_premium ?? 0),
      auto_count: Number(row.auto_count ?? 0),
    })),
    timePeriodSummary: {
      maxDate: result.summary.maxDate ?? null,
      rows: result.summary.rows || [],
    },
    topSalesman: {
      zhuquanRows: (result.topSalesman.zhuquanRows || []).map((row) => ({
        salesman_name: formatSalesmanName(String(row.salesman_name ?? '')),
        org_level_3: String(row.org_level_3 ?? ''),
        driver_premium: Number(row.driver_premium ?? 0),
        auto_count: Number(row.auto_count ?? 0),
        rate: Number(row.rate ?? 0),
        avg_premium: Number(row.avg_premium ?? 0),
      })),
      jiaosanRows: (result.topSalesman.jiaosanRows || []).map((row) => ({
        salesman_name: formatSalesmanName(String(row.salesman_name ?? '')),
        org_level_3: String(row.org_level_3 ?? ''),
        driver_premium: Number(row.driver_premium ?? 0),
        auto_count: Number(row.auto_count ?? 0),
        rate: Number(row.rate ?? 0),
        avg_premium: Number(row.avg_premium ?? 0),
      })),
    },
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
  const bundleEnabled = ENABLE_BUNDLE_ROUTES;

  // UI 状态：下钻路径和分组维度（保留 useState，属于交互状态）
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

  const [drillPath, setDrillPath] = useState<DrilldownStep[]>(initialDrillPath);
  const [currentGroupBy, setCurrentGroupBy] = useState<CrossSellDimension | null>(initialGroupBy);

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

  // 构建基础 API 参数（drillPath/currentGroupBy 变化时 queryKey 自动失效触发重新请求）
  const baseParams = useMemo(() => {
    const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
    return {
      ...filterParams,
      drillPath: drillPath.map(s => ({ dimension: s.dimension, value: s.value })),
      groupBy: currentGroupBy || undefined,
      ...(vehicleCategory ? { vehicleCategory } : {}),
      ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
      ...(timePeriod ? { timePeriod, granularity: timePeriod } : {}),
    };
  }, [filters, isOrgUser, userOrg, drillPath, currentGroupBy, vehicleCategory, seatCoverageLevel, timePeriod]);

  // legacy 并行请求降级函数（queryFn 外部定义，保持引用稳定）
  const fetchLegacyBundleLikeData = useCallback(async (): Promise<BundleLikeResult> => {
    const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
    const apiDrillPath = drillPath.map(s => ({ dimension: s.dimension, value: s.value }));
    const legacyBaseParams = {
      ...filterParams,
      drillPath: apiDrillPath,
      groupBy: currentGroupBy || undefined,
      ...(vehicleCategory ? { vehicleCategory } : {}),
      ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
      ...(timePeriod ? { timePeriod, granularity: timePeriod } : {}),
    };
    const trendParams: Record<string, string> = {
      ...filterParams,
      ...(vehicleCategory ? { vehicleCategory } : {}),
      ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
      ...(timePeriod ? { granularity: timePeriod } : {}),
    };
    const summaryParams: Record<string, string> = {
      ...filterParams,
      ...(vehicleCategory ? { vehicleCategory } : {}),
      ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
    };
    const topSalesmanParams: Record<string, string> = {
      ...filterParams,
      ...(vehicleCategory ? { vehicleCategory } : {}),
      ...(seatCoverageLevel ? { seatCoverageLevel } : {}),
      ...(timePeriod ? { timePeriod } : {}),
    };

    const [analysis, summaryResp, trendResp, zhuquanResp, jiaosanResp] = await Promise.all([
      apiClient.getCrossSellAnalysis(legacyBaseParams),
      apiClient.getCrossSellTimePeriod(summaryParams),
      apiClient.getCrossSellTrend(trendParams),
      apiClient.getCrossSellTopSalesman({ ...topSalesmanParams, coverage: '主全' }),
      apiClient.getCrossSellTopSalesman({ ...topSalesmanParams, coverage: '交三' }),
    ]);

    return {
      summary: {
        maxDate: summaryResp.maxDate ? String(summaryResp.maxDate) : null,
        rows: summaryResp.rows || [],
      },
      trend: {
        rows: trendResp.rows || [],
      },
      drilldown: {
        summary: analysis.summary ?? null,
        rows: analysis.rows || [],
      },
      topSalesman: {
        zhuquanRows: zhuquanResp.rows || [],
        jiaosanRows: jiaosanResp.rows || [],
      },
    };
  }, [filters, isOrgUser, userOrg, drillPath, currentGroupBy, vehicleCategory, seatCoverageLevel, timePeriod]);

  // queryFn：bundle/legacy 降级逻辑封装在此，useQuery 自动处理竞态
  const queryFn = useCallback(async (): Promise<BundleLikeResult> => {
    if (bundleEnabled) {
      try {
        return await apiClient.getCrossSellBundle(baseParams);
      } catch {
        return await fetchLegacyBundleLikeData();
      }
    }
    return await fetchLegacyBundleLikeData();
  }, [bundleEnabled, baseParams, fetchLegacyBundleLikeData]);

  const { data: queryData, isLoading, error: queryError, refetch } = useQuery({
    queryKey: queryKeys.crossSellBundle(baseParams as Record<string, unknown>),
    queryFn,
    enabled,
    select: transformBundleResult,
  });

  const resolvedData = queryData ?? EMPTY_TRANSFORMED_DATA;

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

  const loading = isLoading;
  const error = queryError
    ? (queryError instanceof Error ? queryError.message : String(queryError))
    : null;

  return {
    summary: resolvedData.summary,
    rows: resolvedData.rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
    timePeriodSummary: resolvedData.timePeriodSummary,
    trendRows: resolvedData.trendRows,
    topSalesman: resolvedData.topSalesman,
    selectDimension,
    drillDown,
    drillUp,
    reset,
    loading,
    error,
    refresh: refetch,
    canGoToTop,
  };
}
