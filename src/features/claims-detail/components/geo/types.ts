/**
 * 地理风险热力图面板专用类型
 *
 * Severity 引自 shared/severity，与 Tab 1 同源。
 */
export type { Severity } from '../shared/severity';
import type { Severity } from '../shared/severity';

/** geoAccident SQL 返回行 — 出险地（city = 风险落点） */
export interface GeoAccidentRow {
  province?: string;
  city?: string;
  cases?: number;
  reserve_wan?: number;
  avg_reserve?: number;
  injury_cases?: number;
  injury_pct?: number;
  avg_cycle_days?: number;
}

/** geoPlate SQL 返回行 — 车牌归属地（plate_city = 风险源头） */
export interface GeoPlateRow {
  plate_city?: string;
  cases?: number;
  reserve_wan?: number;
  avg_reserve?: number;
  injury_cases?: number;
  injury_pct?: number;
}

/** geoComparison SQL 返回 — 单行汇总（非分组），异地 vs 本地对比 */
export interface GeoComparisonRow {
  total_cases?: number;
  cross_region_cases?: number;
  cross_region_pct?: number;
  cross_region_avg_reserve?: number;
  local_avg_reserve?: number;
}

/** frequencyYoy 季度行 */
export interface FrequencyYoyRow {
  year?: number;
  quarter?: number;
  claim_count?: number;
  injury_count?: number;
  reserve_wan?: number;
  policy_count?: number;
  freq_per_1000?: number;
  injury_pct?: number;
}

/** Geo 智能洞察卡片数据形态 */
export interface GeoInsight {
  id: 'cross-region' | 'plate-concentration' | 'frequency-trend' | 'top-province';
  severity: Severity;
  iconKey: 'alert' | 'pin' | 'trend' | 'building';
  title: string;
  body: string;
  metricValue: string;
  metricLabel: string;
}
