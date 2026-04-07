/**
 * 快捷筛选栏
 *
 * 单行布局：车型芯片（互斥） + 新能源/燃油 + 维度 toggle（循环切换）
 */
import React from 'react';
import { cn } from '@/shared/styles';

/** 车型快捷筛选值 */
export type VehicleType = 'home_car' | 'truck_1t' | 'truck_2_9t' | 'motorcycle' | 'dump' | 'tractor' | 'general';

/** 续/转 */
export type RenewalType = 'renewal' | 'transfer';

export interface QuickFilters {
  vehicleType?: VehicleType;
  isNev?: boolean;
  isNewCar?: boolean;
  renewalType?: RenewalType;          // 续保 / 转保(非续非新)
  businessNature?: 'commercial' | 'non_commercial';
  isTransfer?: boolean;               // 过户/非过户
  coverageCombination?: string;       // '主全' | '交三' | '单交'
}

interface Props {
  filters: QuickFilters;
  onChange: (filters: QuickFilters) => void;
}

// ── 车型芯片 ──
const VEHICLE_CHIPS: { type: VehicleType; label: string }[] = [
  { type: 'home_car', label: '家自车' },
  { type: 'truck_1t', label: '1T货' },
  { type: 'truck_2_9t', label: '2-9T货' },
  { type: 'motorcycle', label: '摩托车' },
  { type: 'dump', label: 'X自卸' },
  { type: 'tractor', label: 'X牵引' },
  { type: 'general', label: 'X普货' },
];

// ── 循环 toggle ──
interface CycleToggleConfig {
  states: { value: any; label: string }[];
  key: keyof QuickFilters;
}

const TOGGLE_CONFIGS: CycleToggleConfig[] = [
  {
    key: 'isNev',
    states: [
      { value: undefined, label: '油/电' },
      { value: true, label: '电' },
      { value: false, label: '油' },
    ],
  },
  // separator injected in render
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
      { value: 'commercial', label: '营' },
      { value: 'non_commercial', label: '非' },
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
  {
    key: 'coverageCombination',
    states: [
      { value: undefined, label: '主全/交三/单交' },
      { value: '主全', label: '主全' },
      { value: '交三', label: '交三' },
      { value: '单交', label: '单交' },
    ],
  },
];

// 在 isNev 和 isNewCar 之间插入分隔符的索引
const SEPARATOR_AFTER_INDEX = 0;

const chipBase = 'px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors select-none';
const chipActive = 'bg-primary text-white';
const chipInactive = 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600';

const toggleBase = 'px-3 py-1 text-xs rounded-md cursor-pointer transition-colors select-none border';
const toggleActive = 'bg-primary text-white border-primary';
const toggleDefault = 'bg-neutral-50 text-neutral-400 border-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-500 dark:border-neutral-600 dark:hover:bg-neutral-700';

const Separator = () => <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-600 mx-1" />;

export const QuickFilterBar: React.FC<Props> = ({ filters, onChange }) => {
  const toggleVehicle = (type: VehicleType) => {
    onChange({
      ...filters,
      vehicleType: filters.vehicleType === type ? undefined : type,
    });
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
    return filters[config.key] !== undefined;
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 车型芯片 */}
        {VEHICLE_CHIPS.map(({ type, label }) => (
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

        {/* 维度 toggle */}
        {TOGGLE_CONFIGS.map((config, i) => (
          <React.Fragment key={config.key}>
            {i === 0 && <Separator />}
            {i === SEPARATOR_AFTER_INDEX + 1 && <Separator />}
            <button
              type="button"
              onClick={() => cycleToggle(config)}
              className={cn(toggleBase, isToggleActive(config) ? toggleActive : toggleDefault)}
              title={`点击切换: ${config.states.map((s) => s.label).join(' → ')}`}
            >
              {getToggleLabel(config)}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
