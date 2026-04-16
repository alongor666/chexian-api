/**
 * QuickFilterBar 公共工具函数
 *
 * 提供全局筛选 ↔ QuickFilters 双向转换 + 动态标题生成。
 */
import type { AdvancedFilterState } from '@/shared/types';
import type { QuickFilters, FuelCategory } from '@/shared/components/QuickFilterBar';

/** 车型标签映射 */
const VEHICLE_LABELS: Record<string, string> = {
  home_car: '家自车',
  truck_1t: '1T货车',
  truck_2_9t: '2-9T货车',
  motorcycle: '摩托车',
  truck_1_2t: '1-2T货车',
  rental: '出租租赁',
  dump: '自卸车',
  tractor: '牵引车',
  general: '普货车',
};

/** 燃料分类标签 */
const FUEL_LABELS: Record<FuelCategory, string> = {
  oil: '燃油',
  gas: '天然气',
  electric: '电动',
};

/**
 * 从 fuelCategory 派生 isNev（向后兼容）
 */
function fuelCategoryToIsNev(fc?: FuelCategory): boolean | undefined {
  if (fc === 'electric') return true;
  if (fc === 'oil' || fc === 'gas') return false;
  return undefined;
}

/**
 * 从全局筛选状态派生 QuickFilters（全局 → 快捷同步）
 */
export function deriveQuickFilters(filters: AdvancedFilterState): QuickFilters {
  // 从 is_nev 推导 fuelCategory（仅能区分电/非电，gas 需要 fuel_category 字段）
  let fuelCategory: FuelCategory | undefined;
  if (filters.fuel_category) {
    fuelCategory = filters.fuel_category;
  } else if (filters.is_nev === true) {
    fuelCategory = 'electric';
  } else if (filters.is_nev === false) {
    fuelCategory = 'oil';
  }

  return {
    vehicleType: filters.vehicle_quick_filter,
    enterpriseCar: filters.enterprise_car ?? undefined,
    fuelCategory,
    isNev: filters.is_nev ?? undefined,
    isNewCar: filters.is_new_car ?? undefined,
    renewalType: filters.is_renewal === true ? 'renewal'
               : filters.is_renewal === false ? 'transfer'
               : undefined,
    businessNature: filters.business_nature,
    isTransfer: filters.is_transfer ?? undefined,
    coverageCombination: filters.coverage_combination?.[0],
    insuranceType: filters.insurance_type === true ? 'compulsory'
                 : filters.insurance_type === false ? 'commercial'
                 : undefined,
  };
}

/**
 * 将 QuickFilters 变更写回全局筛选状态（快捷 → 全局同步）
 */
export function applyQuickFiltersToGlobal(
  prev: AdvancedFilterState,
  quick: QuickFilters,
): AdvancedFilterState {
  return {
    ...prev,
    vehicle_quick_filter: quick.vehicleType,
    enterprise_car: quick.enterpriseCar,
    fuel_category: quick.fuelCategory,
    is_nev: fuelCategoryToIsNev(quick.fuelCategory),
    is_new_car: quick.isNewCar,
    is_renewal: quick.renewalType === 'renewal' ? true
              : quick.renewalType === 'transfer' ? false
              : undefined,
    business_nature: quick.businessNature,
    is_transfer: quick.isTransfer,
    coverage_combination: quick.coverageCombination ? [quick.coverageCombination] : undefined,
    insurance_type: quick.insuranceType === 'compulsory' ? true
                  : quick.insuranceType === 'commercial' ? false
                  : undefined,
  };
}

/**
 * 根据 QuickFilters 生成筛选描述文本（用于动态标题）
 *
 * 返回示例："交强 家自车 电动 续保" 或 ""（无筛选时）
 * 页面自行拼接完整标题：`${label ? label + ' — ' : ''}${baseTitle}`
 */
export function buildFilterLabel(quickFilters: QuickFilters): string {
  const parts: string[] = [];
  if (quickFilters.insuranceType === 'compulsory') parts.push('交强');
  else if (quickFilters.insuranceType === 'commercial') parts.push('商业');
  if (quickFilters.coverageCombination) parts.push(quickFilters.coverageCombination);
  if (quickFilters.vehicleType) {
    parts.push(VEHICLE_LABELS[quickFilters.vehicleType] ?? quickFilters.vehicleType);
  }
  if (quickFilters.enterpriseCar) parts.push('企客');
  if (quickFilters.fuelCategory) {
    parts.push(FUEL_LABELS[quickFilters.fuelCategory]);
  }
  if (quickFilters.isNewCar === true) parts.push('新车');
  else if (quickFilters.isNewCar === false) parts.push('旧车');
  if (quickFilters.renewalType === 'renewal') parts.push('续保');
  else if (quickFilters.renewalType === 'transfer') parts.push('转保');
  if (quickFilters.businessNature === 'commercial') parts.push('营业');
  else if (quickFilters.businessNature === 'non_commercial') parts.push('非营');
  if (quickFilters.isTransfer === true) parts.push('过户');
  else if (quickFilters.isTransfer === false) parts.push('非过户');
  return parts.join(' ');
}
