/**
 * 保费达成下钻 Hook
 *
 * 管理保费达成分析的数据加载与下钻导航：
 * - KPI 卡片数据
 * - 达成率分布数据
 * - 分层下钻数据（公司 → 机构 → 团队 → 业务员 → 客户类别 → 险别）
 * - 面包屑导航（drill down / drill up）
 */

import { useState, useCallback } from 'react';
import { apiClient, isRequestAbortError } from '../../../shared/api/client';
import { createLogger } from '../../../shared/utils/logger';
import type {
  PlanDrilldownLevel,
  PlanDrilldownRow,
  PlanKpiData,
  PlanDistributionRow,
  DrillPathStep,
  SortState,
} from '../types/premiumReport';
import {
  buildFiltersFromPath,
  computeDrillDownTarget,
  computeDrillUpDisplayLevel,
  makeDrillStepLabel,
} from '../utils/premiumPlanDrill';

const logger = createLogger('usePremiumPlan');

interface UsePremiumPlanReturn {
  /** 下钻表格数据 */
  drilldownData: PlanDrilldownRow[];
  /** KPI 卡片数据 */
  kpiData: PlanKpiData | null;
  /** 达成率分布数据 */
  distributionData: PlanDistributionRow[];
  /** 面包屑路径 */
  drillPath: DrillPathStep[];
  /** 当前层级 */
  currentLevel: PlanDrilldownLevel;
  /** 排序状态 */
  sortState: SortState;
  /** 设置排序 */
  setSortState: (sort: SortState) => void;
  /** 加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 初始加载（公司整体级别） */
  loadInitial: (planYear?: number) => Promise<void>;
  /** 下钻到下一层 */
  drillDown: (groupName: string) => Promise<void>;
  /** 返回上一层 */
  drillUp: () => Promise<void>;
  /** 重置到顶层 */
  resetDrill: () => Promise<void>;
  /** 当前计划年度 */
  planYear: number;
}

/**
 * 保费达成下钻 Hook
 */
export function usePremiumPlan(): UsePremiumPlanReturn {
  const [drilldownData, setDrilldownData] = useState<PlanDrilldownRow[]>([]);
  const [kpiData, setKpiData] = useState<PlanKpiData | null>(null);
  const [distributionData, setDistributionData] = useState<PlanDistributionRow[]>([]);
  const [drillPath, setDrillPath] = useState<DrillPathStep[]>([
    { level: 'company', label: '分公司整体' },
  ]);
  const [sortState, setSortState] = useState<SortState>({
    column: 'actual_vehicle',
    direction: 'desc',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planYear, setPlanYear] = useState(2026);

  /** 当前层级 = 面包屑最后一步 */
  const currentLevel = drillPath[drillPath.length - 1].level;

  /**
   * 加载面板所有数据（合并端点：1 次请求返回 children + summary + distribution）
   *
   * v2 改进：原来 3 次串/并行 API 调用，现在 1 次。
   * 后端并发执行三条 SQL（均读 achievement_cache），前端只等一个 RTT。
   */
  const loadAllData = useCallback(async (
    level: PlanDrilldownLevel,
    path: DrillPathStep[],
    year: number,
    sort: SortState,
  ) => {
    setIsLoading(true);
    setError(null);

    const filters = buildFiltersFromPath(path);

    try {
      const { children, summary, distribution } = await apiClient.premium.achievement({
        planYear: year,
        level,
        sortField: sort.column,
        sortOrder: sort.direction,
        ...filters,
      });

      setDrilldownData(
        (children || []).map((row: Record<string, unknown>) => ({
          group_name: String(row.group_name || ''),
          parent_name: row.parent_name ? String(row.parent_name) : undefined,
          org_name: row.org_name ? String(row.org_name) : undefined,
          plan_year: Number(row.plan_year || year),
          plan_vehicle: row.plan_vehicle != null ? Number(row.plan_vehicle) : null,
          plan_total: row.plan_total != null ? Number(row.plan_total) : null,
          actual_vehicle: Number(row.actual_vehicle || 0),
          actual_total: Number(row.actual_total || 0),
          rate_vehicle: row.rate_vehicle != null ? Number(row.rate_vehicle) : null,
          rate_total: row.rate_total != null ? Number(row.rate_total) : null,
          salesman_count: Number(row.salesman_count || 0),
          prev_year_premium: Number(row.prev_year_premium || 0),
          yoy_growth_rate: row.yoy_growth_rate != null ? Number(row.yoy_growth_rate) : null,
          year_2025_actual: Number(row.year_2025_actual || 0),
          plan_growth_rate: row.plan_growth_rate != null ? Number(row.plan_growth_rate) : null,
          rank_category: row.rank_category as 'top' | 'bottom' | null | undefined,
        }))
      );

      if (summary) {
        const k = summary as Record<string, unknown>;
        setKpiData({
          total_plan_vehicle: k.total_plan_vehicle != null ? Number(k.total_plan_vehicle) : null,
          total_plan_total: k.total_plan_total != null ? Number(k.total_plan_total) : null,
          total_actual_vehicle: Number(k.total_actual_vehicle || 0),
          total_actual_total: Number(k.total_actual_total || 0),
          avg_rate_vehicle: k.avg_rate_vehicle != null ? Number(k.avg_rate_vehicle) : null,
          avg_rate_total: k.avg_rate_total != null ? Number(k.avg_rate_total) : null,
          total_salesman_count: Number(k.total_salesman_count || 0),
        });
      }

      setDistributionData(
        (distribution || []).map((row: Record<string, unknown>) => ({
          rate_range: String(row.rate_range || ''),
          count: Number(row.count || 0),
          percentage: Number(row.percentage || 0),
        }))
      );

      logger.debug('Premium plan data loaded (merged API)', { level, rows: (children || []).length });
    } catch (err) {
      if (isRequestAbortError(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logger.error('Failed to load premium plan data', { level, error: message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** 初始加载 */
  const loadInitial = useCallback(async (year: number = 2026) => {
    setPlanYear(year);
    const initialPath: DrillPathStep[] = [{ level: 'company', label: '分公司整体' }];
    setDrillPath(initialPath);
    await loadAllData('org', initialPath, year, sortState);
  }, [loadAllData, sortState]);

  /** 下钻到下一层 */
  const drillDown = useCallback(async (groupName: string) => {
    // 当前显示的数据 level 是 currentLevel 的下一层；点击行后再下一层
    const target = computeDrillDownTarget(currentLevel);
    if (!target) return; // 已到最底层
    const { nextLevel, filterLevel } = target;

    const newStep: DrillPathStep = {
      level: filterLevel,
      label: makeDrillStepLabel(filterLevel, groupName),
      value: groupName,
    };

    const newPath = [...drillPath, newStep];
    setDrillPath(newPath);
    await loadAllData(nextLevel, newPath, planYear, sortState);
  }, [currentLevel, drillPath, planYear, sortState, loadAllData]);

  /** 返回上一层 */
  const drillUp = useCallback(async () => {
    if (drillPath.length <= 1) return;

    const newPath = drillPath.slice(0, -1);
    setDrillPath(newPath);

    // 当前显示的层级 = 上一步路径最后一步的 level 的下一层
    const parentLevel = newPath[newPath.length - 1].level;
    const displayLevel = computeDrillUpDisplayLevel(parentLevel);

    await loadAllData(displayLevel, newPath, planYear, sortState);
  }, [drillPath, planYear, sortState, loadAllData]);

  /** 重置到顶层 */
  const resetDrill = useCallback(async () => {
    const initialPath: DrillPathStep[] = [{ level: 'company', label: '分公司整体' }];
    setDrillPath(initialPath);
    await loadAllData('org', initialPath, planYear, sortState);
  }, [planYear, sortState, loadAllData]);

  return {
    drilldownData,
    kpiData,
    distributionData,
    drillPath,
    currentLevel,
    sortState,
    setSortState,
    isLoading,
    error,
    loadInitial,
    drillDown,
    drillUp,
    resetDrill,
    planYear,
  };
}
