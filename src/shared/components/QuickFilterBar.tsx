/**
 * 快捷筛选栏
 *
 * 布局顺序：险类(交/商) → 主全/交三/单交 → 车型芯片(分组多选) → 油/气/电 → 其他 toggle
 * 全局共享组件，所有分析页面可用。
 */
import React from 'react';
import { cn } from '@/shared/styles';

/** 车型快捷筛选值 */
export type VehicleType = 'home_car' | 'truck_1t' | 'truck_2_9t' | 'motorcycle' | 'truck_1_2t' | 'rental' | 'dump' | 'tractor' | 'general';

/** 续/转 */
export type RenewalType = 'renewal' | 'transfer';

/** 燃料分类：油/气/电 */
export type FuelCategory = 'oil' | 'gas' | 'electric';

/** 险类筛选 */
export type InsuranceTypeFilter = 'compulsory' | 'commercial';

export interface QuickFilters {
  vehicleType?: VehicleType;
  enterpriseCar?: boolean;              // 企客（非营业企业客车），与家自车可同时选
  fuelCategory?: FuelCategory;          // 油/气/电（替代旧 isNev）
  isNev?: boolean;                      // 保留向后兼容，由 fuelCategory 派生
  isNewCar?: boolean;
  renewalType?: RenewalType;            // 续保 / 转保(非续非新)
  businessNature?: 'commercial' | 'non_commercial';
  isTransfer?: boolean;                 // 过户/非过户
  coverageCombination?: string;         // '主全' | '交三' | '单交'
  insuranceType?: InsuranceTypeFilter;  // 交强/商业
}

interface Props {
  filters: QuickFilters;
  onChange: (filters: QuickFilters) => void;
  /** 隐藏车型芯片行（如专项页营业货车 tab 已服务端固定车型） */
  hideVehicleType?: boolean;
  /** 隐藏气/油细分（数据域无 fuel_type 列时，如交叉销售页 CrossSellDailyAgg）；
   *  电仍可选（is_nev 列各域都有，与主站口径严格等价） */
  hideGasOil?: boolean;
  /** 隐藏依赖 vehicle_model 列的车型 chip（自卸/牵引/普货），如交叉销售页 */
  hideVehicleModelChips?: boolean;
  /** 仅隐藏"气"（数据域 fuel_category 派生列只有 油/电 时，如续保域——
   *  气车被归入"油"，点"气"会返回错误的空结果） */
  hideGas?: boolean;
  /** 隐藏整个货车组 chip（数据域无 tonnage_segment 与 vehicle_model 列时，如续保域） */
  hideTruckChips?: boolean;
  /** 隐藏险类 toggle（交/商）——数据域无险类维度时，如续保域（口径=交商同保整体） */
  hideInsuranceType?: boolean;
}

// ── 车型分组 ──
// 非营业客车组（组内可多选）
const CAR_GROUP_CHIPS: { type: VehicleType; label: string }[] = [
  { type: 'home_car', label: '家自车' },
];
// 企客独立标记（与家自车可同时选）
const ENTERPRISE_CAR_LABEL = '企客';

// 货车组（组内可多选）— 暂保持互斥，预留分组
const TRUCK_GROUP_CHIPS: { type: VehicleType; label: string }[] = [
  { type: 'truck_1t', label: '1T货' },
  { type: 'truck_2_9t', label: '2-9T货' },
  { type: 'truck_1_2t', label: '1-2T货' },
  { type: 'dump', label: 'X自卸' },
  { type: 'tractor', label: 'X牵引' },
  { type: 'general', label: 'X普货' },
];

// 独立互斥类型
const STANDALONE_CHIPS: { type: VehicleType; label: string }[] = [
  { type: 'motorcycle', label: '摩托车' },
  { type: 'rental', label: '租/网' },
];

// 货车类型集合（用于互斥判断）
const TRUCK_TYPES = new Set<VehicleType>(TRUCK_GROUP_CHIPS.map(c => c.type));
const CAR_TYPES = new Set<VehicleType>(CAR_GROUP_CHIPS.map(c => c.type));

// ── 循环 toggle ──
interface CycleToggleConfig {
  states: { value: any; label: string }[];
  key: keyof QuickFilters;
}

// 险类 toggle（交/商）
const INSURANCE_TYPE_TOGGLE: CycleToggleConfig = {
  key: 'insuranceType',
  states: [
    { value: undefined, label: '交/商' },
    { value: 'compulsory', label: '交强' },
    { value: 'commercial', label: '商业' },
  ],
};

// 险别组合 toggle（主全/交三/单交）
const COVERAGE_TOGGLE: CycleToggleConfig = {
  key: 'coverageCombination',
  states: [
    { value: undefined, label: '主全/交三/单交' },
    { value: '主全', label: '主全' },
    { value: '交三', label: '交三' },
    { value: '单交', label: '单交' },
  ],
};

// 油/气/电 toggle
const FUEL_CATEGORY_TOGGLE: CycleToggleConfig = {
  key: 'fuelCategory',
  states: [
    { value: undefined, label: '油/气/电' },
    { value: 'electric', label: '电' },
    { value: 'gas', label: '气' },
    { value: 'oil', label: '油' },
  ],
};

// hideGasOil 时的退化版：仅 全部 ↔ 电 两态（气/油依赖 fuel_type 列，部分数据域不可表达）
const FUEL_CATEGORY_TOGGLE_ELECTRIC_ONLY: CycleToggleConfig = {
  key: 'fuelCategory',
  states: [
    { value: undefined, label: '电/全部' },
    { value: 'electric', label: '电' },
  ],
};

// hideGas 时的退化版：全部 → 电 → 油（数据域 fuel_category 派生列无"气"值，如续保域）
const FUEL_CATEGORY_TOGGLE_NO_GAS: CycleToggleConfig = {
  key: 'fuelCategory',
  states: [
    { value: undefined, label: '油/电' },
    { value: 'electric', label: '电' },
    { value: 'oil', label: '油' },
  ],
};

// 依赖 vehicle_model 列的车型 chip（hideVehicleModelChips 时隐藏）
const VEHICLE_MODEL_CHIP_TYPES: ReadonlySet<VehicleType> = new Set(['dump', 'tractor', 'general']);

// 其他维度 toggle
const OTHER_TOGGLES: CycleToggleConfig[] = [
  {
    key: 'isNewCar',
    states: [
      { value: undefined, label: '新/旧' },
      { value: true, label: '新车' },
      { value: false, label: '旧车' },
    ],
  },
  {
    key: 'renewalType',
    states: [
      { value: undefined, label: '续/转' },
      { value: 'renewal', label: '续保' },
      { value: 'transfer', label: '转保' },
    ],
  },
  {
    key: 'businessNature',
    states: [
      { value: undefined, label: '营/非' },
      { value: 'commercial', label: '营业' },
      { value: 'non_commercial', label: '非营' },
    ],
  },
  {
    key: 'isTransfer',
    states: [
      { value: undefined, label: '过户/非' },
      { value: true, label: '过户' },
      { value: false, label: '非' },
    ],
  },
];

const chipBase = 'px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors select-none';
const chipActive = 'bg-primary text-white';
const chipInactive = 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600';

const toggleBase = 'px-3 py-1 text-xs rounded-md cursor-pointer transition-colors select-none border';
const toggleActive = 'bg-primary text-white border-primary';
const toggleDefault = 'bg-neutral-50 text-neutral-400 border-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-500 dark:border-neutral-600 dark:hover:bg-neutral-700';

const Separator = () => <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-600 mx-1" />;

// 2吨以上货车和出租租赁必定是营业
const COMMERCIAL_VEHICLE_TYPES: VehicleType[] = ['truck_2_9t', 'dump', 'tractor', 'general', 'rental'];

export const QuickFilterBar: React.FC<Props> = ({
  filters, onChange,
  hideVehicleType, hideGasOil, hideVehicleModelChips, hideGas, hideTruckChips, hideInsuranceType,
}) => {
  const visibleTruckChips = hideTruckChips
    ? []
    : hideVehicleModelChips
      ? TRUCK_GROUP_CHIPS.filter((c) => !VEHICLE_MODEL_CHIP_TYPES.has(c.type))
      : TRUCK_GROUP_CHIPS;
  const fuelToggleConfig = hideGasOil
    ? FUEL_CATEGORY_TOGGLE_ELECTRIC_ONLY
    : hideGas
      ? FUEL_CATEGORY_TOGGLE_NO_GAS
      : FUEL_CATEGORY_TOGGLE;

  /**
   * 车型芯片点击逻辑：
   * - 非营业客车组（家自车）+ 企客：组内可多选，选中时清除其他大类
   * - 货车组：组内互斥（保持原行为），选中时清除客车组
   * - 独立类型（摩托车、租/网）：互斥，清除所有其他
   */
  const toggleVehicle = (type: VehicleType) => {
    const isDeselecting = filters.vehicleType === type;
    const isCommercialLinked = COMMERCIAL_VEHICLE_TYPES.includes(type);

    if (isDeselecting) {
      // 取消选中
      onChange({
        ...filters,
        vehicleType: undefined,
        ...(isCommercialLinked ? { businessNature: undefined } : {}),
      });
      return;
    }

    // 选中新类型
    if (CAR_TYPES.has(type)) {
      // 选客车组：保留企客，清除货车
      onChange({
        ...filters,
        vehicleType: type,
        // enterpriseCar 保留（同组可共存）
      });
    } else if (TRUCK_TYPES.has(type)) {
      // 选货车组：清除客车组+企客
      onChange({
        ...filters,
        vehicleType: type,
        enterpriseCar: undefined,
        ...(isCommercialLinked ? { businessNature: 'commercial' as const } : {}),
      });
    } else {
      // 独立类型（摩托车、租/网）：清除所有
      onChange({
        ...filters,
        vehicleType: type,
        enterpriseCar: undefined,
        ...(isCommercialLinked ? { businessNature: 'commercial' as const } : {}),
      });
    }
  };

  const toggleEnterpriseCar = () => {
    const isDeselecting = filters.enterpriseCar;
    if (isDeselecting) {
      onChange({ ...filters, enterpriseCar: undefined });
    } else {
      // 选中企客：如果当前选了非客车类型，清除它
      const currentIsCarGroup = filters.vehicleType && CAR_TYPES.has(filters.vehicleType);
      const currentIsNone = !filters.vehicleType;
      onChange({
        ...filters,
        enterpriseCar: true,
        // 如果当前是货车/摩托/租赁，清除
        ...(!currentIsCarGroup && !currentIsNone ? { vehicleType: undefined } : {}),
      });
    }
  };

  const cycleToggle = (config: CycleToggleConfig) => {
    const currentValue = filters[config.key];
    const currentIdx = config.states.findIndex((s) => s.value === currentValue);
    const nextIdx = (currentIdx + 1) % config.states.length;
    onChange({
      ...filters,
      [config.key]: config.states[nextIdx].value,
    });
  };

  const getToggleLabel = (config: CycleToggleConfig) => {
    const currentValue = filters[config.key];
    const state = config.states.find((s) => s.value === currentValue);
    return state?.label ?? config.states[0].label;
  };

  const isToggleActive = (config: CycleToggleConfig) => {
    const value = filters[config.key];
    // 不在可选状态集内的残留值（如其他页设置的 gas 进入 hideGasOil 页面）
    // 显示为未激活——与后端对该维度的防御性剥离行为一致（本页不生效）
    return value !== undefined && config.states.some((s) => s.value === value);
  };

  const renderToggle = (config: CycleToggleConfig) => (
    <button
      key={config.key}
      type="button"
      onClick={() => cycleToggle(config)}
      className={cn(toggleBase, isToggleActive(config) ? toggleActive : toggleDefault)}
      title={`点击切换: ${config.states.map((s) => s.label).join(' → ')}`}
    >
      {getToggleLabel(config)}
    </button>
  );

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 1. 险类 toggle：交/商 */}
        {!hideInsuranceType && renderToggle(INSURANCE_TYPE_TOGGLE)}

        {/* 2. 险别组合：主全/交三/单交 */}
        {renderToggle(COVERAGE_TOGGLE)}

        <Separator />

        {/* 3. 车型芯片 */}
        {!hideVehicleType && (
          <>
            {/* 非营业客车组 */}
            {CAR_GROUP_CHIPS.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleVehicle(type)}
                className={cn(chipBase, filters.vehicleType === type ? chipActive : chipInactive)}
                aria-pressed={filters.vehicleType === type}
              >
                {label}
              </button>
            ))}
            {/* 企客（与家自车可同时选） */}
            <button
              type="button"
              onClick={toggleEnterpriseCar}
              className={cn(chipBase, filters.enterpriseCar ? chipActive : chipInactive)}
              aria-pressed={!!filters.enterpriseCar}
            >
              {ENTERPRISE_CAR_LABEL}
            </button>

            {/* 货车组 */}
            {visibleTruckChips.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleVehicle(type)}
                className={cn(chipBase, filters.vehicleType === type ? chipActive : chipInactive)}
                aria-pressed={filters.vehicleType === type}
              >
                {label}
              </button>
            ))}

            {/* 独立类型 */}
            {STANDALONE_CHIPS.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleVehicle(type)}
                className={cn(chipBase, filters.vehicleType === type ? chipActive : chipInactive)}
                aria-pressed={filters.vehicleType === type}
              >
                {label}
              </button>
            ))}
          </>
        )}

        <Separator />

        {/* 4. 油/气/电 */}
        {renderToggle(fuelToggleConfig)}

        {/* 5. 其他维度 toggle */}
        {OTHER_TOGGLES.map((config) => renderToggle(config))}
      </div>
    </div>
  );
};
