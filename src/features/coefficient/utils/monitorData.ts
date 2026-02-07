/**
 * 系数监控数据工具模块
 *
 * API 模式下，数据通过后端 API 获取，
 * 本地 DuckDB 查询函数已移除。
 * 保留类型导出以维持接口兼容性。
 */

import type { RegionGroup } from '../types';

export interface MonitorBaseRow {
  orgLevel3: string;
  regionGroup: RegionGroup;
  isNev: boolean;
  customerCategoryGroup: string;
  isNewCar: boolean | null;
  scenario: 'normal' | 'transfer';
  dayFactor?: number | null;
  weekFactor?: number | null;
  monthFactor?: number | null;
  yearFactor?: number | null;
  dayPremium?: number;
  weekPremium?: number;
  monthPremium?: number;
  yearPremium?: number;
  dayCount?: number;
  weekCount?: number;
  monthCount?: number;
  yearCount?: number;
}

export interface BatchQueryResult {
  orgResults: Map<string, MonitorBaseRow>;
  weekDataMap: Map<string, { week_factor: number | null; week_premium: number; week_count: number }>;
  provinceOverallResults: Map<string, MonitorBaseRow>;
  weekBatchRows: Array<unknown>;
}
