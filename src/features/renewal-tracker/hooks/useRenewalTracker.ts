/**
 * 续保追踪 API Hook（React Query）
 *
 * 同时接入主站 FilterProvider（非时间维度：机构/业务员/客户类别 + 快捷筛选），
 * 时间维度由 RenewalTrackerPage 本地 state 独立管理（expiry_date 语义）。
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import {
  CUSTOMER_CATEGORIES,
  CAT_NON_COMMERCIAL_PERSONAL,
  CAT_MOTORCYCLE,
  CAT_RENTAL,
  CAT_NON_COMMERCIAL_ENTERPRISE,
} from '../../../shared/config/customer-categories';
import type { TimeRange, RenewalTrackerResponse } from '../types';

/**
 * 车型 chip → 续保域 customer_category（从客户类别注册表派生，禁手写字符串）。
 * 续保域无 tonnage_segment / vehicle_model 列，仅客户类别可表达的 chip 在本页生效；
 * 吨位货车/自卸/牵引/普货与交/商 toggle 由 RenewalTrackerPage 的 hide props 隐藏。
 */
const VEHICLE_TO_CATEGORY: Record<string, readonly string[]> = {
  home_car: [CAT_NON_COMMERCIAL_PERSONAL],
  motorcycle: [CAT_MOTORCYCLE],
  rental: [CAT_RENTAL],
};

/**
 * 营/非 → 类别枚举展开：从注册表 11 类按前缀机械派生，
 * 与主站 LIKE '营业%' / LIKE '非营业%'（server filter-params.ts）语义逐字一致
 * （摩托车/特种车/挂车不带前缀，两边均不归入）。
 */
const BUSINESS_NATURE_CATEGORIES: Record<string, readonly string[]> = {
  commercial: CUSTOMER_CATEGORIES.filter((c) => c.startsWith('营业')),
  non_commercial: CUSTOMER_CATEGORIES.filter((c) => c.startsWith('非营业')),
};

/** 后端 renewal-tracker.ts 原生支持且语义直通的参数 */
const PASSTHROUGH_KEYS = [
  'orgNames', 'salesmanNames', 'customerCategories', 'coverageCombinations',
  'isNev', 'isNewCar', 'isTransfer', 'isRenewal',
] as const;

/**
 * 把全局筛选状态映射为 `/api/query/renewal-tracker` 的参数（CSV 或 boolean 字符串）。
 *
 * 治理计划 Task 1-C（BACKLOG f5b2a3）：经统一 buildFilterParams 取全量参数
 * （唯一事实源，新维度默认进入），再映射/裁剪到续保后端的受限参数集。
 * 历史教训：手挑字段漏读 vehicle_quick_filter/enterprise_car/business_nature/
 * insurance_type → queryKey 不变 → 不 refetch → chip 点了数据不动。
 *
 * 导出为纯函数以便单测（hook 仅做 context 接线）。
 */
export function buildRenewalTrackerParams(
  filters: Parameters<typeof buildFilterParams>[0]
): Record<string, string> {
  const full = buildFilterParams(filters);
  const out: Record<string, string> = {};

  // 1) 直通白名单（后端原生支持的参数）
  for (const k of PASSTHROUGH_KEYS) {
    // governance-allow: filter-params-mapping（值来自 buildFilterParams，仅按后端能力裁剪）
    if (full[k] !== undefined) out[k] = full[k];
  }

  // 2) fuelCategory → 续保域中文 fuelCategories。
  //    续保域 fuel_category 派生列只有 '油'/'电'（气车被归入"油"）——
  //    gas 防御性剥离，不映射成 '气'（会返回错误的空结果）；页面已隐藏"气"档（hideGas）
  if (full.fuelCategory === 'oil' || full.fuelCategory === 'electric') {
    // governance-allow: filter-params-mapping
    out.fuelCategories = full.fuelCategory === 'oil' ? '油' : '电';
  }

  // 3) 车型/企客/营非 → customerCategories。
  //    主站语义 = 每个激活来源是一个独立 AND 条件 → 多来源之间取交集；
  //    续保后端只有单一 IN 参数，故在前端把各来源集合逐个求交。
  //    特例（对齐主站 filter-params.ts home_car+企客联动）：家自车+企客 = 两类并集（单一条件）
  const chipSets: string[][] = [];
  if (full.vehicleQuickFilter === 'home_car' && full.enterpriseCar === 'true') {
    chipSets.push([CAT_NON_COMMERCIAL_PERSONAL, CAT_NON_COMMERCIAL_ENTERPRISE]);
  } else {
    if (full.vehicleQuickFilter && VEHICLE_TO_CATEGORY[full.vehicleQuickFilter]) {
      chipSets.push([...VEHICLE_TO_CATEGORY[full.vehicleQuickFilter]]);
    }
    if (full.enterpriseCar === 'true') {
      chipSets.push([CAT_NON_COMMERCIAL_ENTERPRISE]);
    }
  }
  if (full.businessNature && BUSINESS_NATURE_CATEGORIES[full.businessNature]) {
    chipSets.push([...BUSINESS_NATURE_CATEGORIES[full.businessNature]]);
  }
  if (chipSets.length > 0) {
    // 高级面板已选客户类别时，它也是一个 AND 条件，参与交集
    const selected = out.customerCategories ? out.customerCategories.split(',') : [];
    if (selected.length > 0) chipSets.push(selected);
    const merged = chipSets.reduce((acc, set) => acc.filter((c) => set.includes(c)));
    // 交集为空 = 主站会返回空结果（多个 AND 条件互斥）。禁止回退
    // （等于静默丢弃用户的部分选择，跨页口径漂移）；传不可能匹配的占位值复现"空结果"
    // governance-allow: filter-params-mapping
    out.customerCategories = merged.length > 0 ? merged.join(',') : '__none__';
  }

  return out;
}

/** 从 FilterProvider 读取全局筛选并映射为续保接口参数 */
function useNonTimeFilterParams(): Record<string, string> {
  const { filters } = useGlobalFilters();
  return buildRenewalTrackerParams(filters);
}

export function useRenewalTracker(timeRange: TimeRange | null) {
  const filterParams = useNonTimeFilterParams();

  return useQuery({
    queryKey: ['renewal-tracker', timeRange, filterParams],
    queryFn: () => {
      if (!timeRange) throw new Error('timeRange is required');
      return apiClient.getRenewalTracker({
        start: timeRange.start,
        end: timeRange.end,
        cutoff: timeRange.cutoff,
        ...filterParams,
      }) as Promise<RenewalTrackerResponse>;
    },
    enabled: !!timeRange,
  });
}
