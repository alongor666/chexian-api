/**
 * 系数监控数据格式化工具函数
 *
 * 遵循全局格式化规范（见 CLAUDE.md §2.5）：
 * - 自主系数：4位小数 → formatCoefficient
 * - 保费：万元为单位，整数 → formatPremiumWan
 */

import type { CSSProperties } from 'react';
import type { CoefficientRow } from '../hooks/useCoefficientMonitor';
import { formatCoefficient, formatCurrency } from '../../../shared/utils/formatters';
import { CAT_NON_COMMERCIAL_PERSONAL } from '../../../shared/config/customer-categories';

/**
 * 客户类别显示名称映射
 */
export const CUSTOMER_CATEGORY_LABELS: Record<string, string> = {
  non_commercial_personal: CAT_NON_COMMERCIAL_PERSONAL,
  all: '全部',
};

/**
 * 格式化系数值（4位小数）
 * 使用全局 formatCoefficient
 */
export const formatFactor = (val: number | null | undefined): string => {
  return formatCoefficient(val);
};

/**
 * 格式化比例（阈值差值，4位小数，带符号）
 */
export const formatRatio = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '-';
  if (!Number.isFinite(val)) return '-';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCoefficient(Math.abs(val))}`;
};

/**
 * 格式化缺口保费（万元，2位小数，带符号）
 * 缺口保费特殊：需要显示正负符号
 */
export const formatGapPremium = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '-';
  if (!Number.isFinite(val)) return '-';
  const wanYuan = val / 10000;
  const sign = wanYuan >= 0 ? '+' : '';
  return `${sign}${formatCurrency(Math.abs(wanYuan))}万`;
};

/**
 * 获取缺口保费样式
 */
export const getGapPremiumStyle = (val: number | null | undefined): CSSProperties => {
  if (val === null || val === undefined) return { color: '#999' };
  return val > 0
    ? { color: '#dc3545', fontWeight: 'bold' }
    : { color: '#28a745', fontWeight: 'bold' };
};

/**
 * 获取合规状态样式
 */
export const getComplianceStyle = (isCompliant: boolean | null): CSSProperties => {
  if (isCompliant === null) {
    return { color: '#999', fontStyle: 'italic' };
  }
  return isCompliant
    ? { color: '#28a745', fontWeight: 'bold' }
    : { color: '#dc3545', fontWeight: 'bold' };
};

/**
 * 获取行背景色（Tailwind 类名，支持 dark mode）
 */
export const getRowBackgroundClass = (row: CoefficientRow): string => {
  if (row.orgLevel3 === '成都') {
    return 'bg-amber-50 dark:bg-amber-900/20';
  }
  if (row.orgLevel3 === '全省') {
    return 'bg-sky-50 dark:bg-sky-900/20';
  }
  return 'bg-white dark:bg-neutral-800';
};

/**
 * 获取车辆维度显示文本
 */
export const getCarAgeLabel = (row: CoefficientRow): string => {
  if (row.scenario === 'transfer') {
    return '旧车转保';
  }
  if (row.isNewCar === null) {
    return '全部';
  }
  return row.isNewCar ? '新车' : '旧车';
};

/**
 * 格式化周期类型显示
 */
export const formatPeriodType = (periodType: string): string => {
  switch (periodType) {
    case 'general':
      return '一般(1-7等)';
    case 'special':
      return '特殊(1-14等)';
    default:
      return '月度';
  }
};
