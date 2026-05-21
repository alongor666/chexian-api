/**
 * 赔付率发展三角形面板专用类型
 *
 * Severity 引自 shared/severity，与 Tab 1/2 同源。
 * cohort 同源契约：所有指标值（loss_ratio_pct / incident_rate_pct / avg_claim /
 * coverage_pct）来自同一条 SQL `generateLossRatioDevelopmentQuery`，
 * 由同一个 `policies` CTE + `calendar_window` CTE 派生，
 * 严格满足 `.claude/data-knowledge-protocol.md` 的 cohort 同源铁律。
 */
export type { Severity } from '../shared/severity';
import type { Severity } from '../shared/severity';

export type LossRatioMetric = 'loss_ratio_pct' | 'incident_rate_pct' | 'avg_claim';

/** generateLossRatioDevelopmentQuery 返回行的字段集 */
export interface LossRatioDevRow {
  cohort_year?: number;
  dev_month?: number;
  total_policies?: number;
  total_premium_wan?: number;
  dev_policies?: number;
  earned_premium?: number;
  claim_count?: number;
  total_reserve?: number;
  loss_ratio_pct?: number;
  incident_rate_pct?: number;
  avg_claim?: number;
  coverage_pct?: number;
  claims_cutoff?: string;
}

/** 按年份聚合后的 cohort 视图（前端派生） */
export interface CohortData {
  policyCount: number;
  premiumWan: number;
  maxDev: number;
  months: Record<number, LossRatioDevRow>;
}

/** 智能洞察 — 卡片 / 信息条二选一 */
export interface LossRatioInsight {
  id: string;
  /** card 进入 grid（异常 / 趋势 / 异常尖峰），note 折成横排小条（同期对比 / 数据不足） */
  kind: 'card' | 'note';
  severity: Severity;
  iconKey:
    | 'alert'        // 阈值告警（赔付率倒挂 / 出险率超红线）
    | 'flame'        // 高位告警（赔付率偏高 / 出险率偏高）
    | 'trendUp'      // 上行趋势（恶化）
    | 'trendDown'    // 下行趋势（改善）
    | 'shockwave'    // 高位震荡
    | 'zap'          // 异常尖峰
    | 'compare'      // 同期对比
    | 'info';        // 数据不足
  title: string;
  body: string;
  metricValue: string;
  metricLabel: string;
}

/** 叙事横幅派生数据 */
export interface HeadlineData {
  severity: Severity;
  tagLabel: string;
  headline: string;
  summary: string;
  /** 单 hero metric — 当前最新 cohort × 当前选中指标 */
  hero: HeadlineHero | null;
}

export interface HeadlineHero {
  label: string;
  value: string;
  unit: string;
  severity: Severity;
  /** 同期对比徽章，无可比 cohort 时为 undefined */
  badge?: string;
}
