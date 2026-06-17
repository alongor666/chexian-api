/**
 * EnhancedKpiCard — 内部工具与颜色常量
 *
 * 从原 EnhancedKpiCard.tsx 迁出的 4 个内部 helper / 常量，
 * 不对外 export（仅供同目录子组件 import）。
 */
import { colors } from '../../../shared/styles';
import { TONE_VAR, type StatusTone } from '@/shared/utils/kpiStatus';

/** 默认颜色（保留兼容 — 旧 donut/bar 类型沿用） */
export const DEFAULT_COLORS = [colors.primary.DEFAULT, colors.neutral[400]];

/** 多段条形图默认配色 */
export const SEGMENT_COLORS = [
  colors.primary.DEFAULT,
  '#10B981',
  '#F59E0B',
  colors.neutral[400],
];

/** tone → ECharts 色值（用于 SVG fill/stroke） */
export function toneColor(tone: StatusTone): string {
  return TONE_VAR.solid[tone] ?? colors.primary.DEFAULT;
}

/** bigint → number 归一化（保留对 number 输入的恒等映射） */
export const normalizeNumeric = (value: number | bigint): number =>
  typeof value === 'bigint' ? Number(value) : value;
