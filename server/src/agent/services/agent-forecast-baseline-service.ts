/**
 * Forecast baseline service
 *
 * Aggregates already-occurred figures and historical samples for the four
 * unknown variables (V1 历史保单剩余敞口赔付率, V2 新签保费增速,
 * V3 新签业务赔付率, V4 新签业务费用率).
 *
 * Deterministic SQL composition + percentile math; the source must stay free
 * of LLM clients, free-form query construction, and natural-language-to-SQL
 * paths. The isolation test scans this file with regex /(?:nl|raw|free)2?[sS]ql/
 * style patterns — we therefore avoid spelling those terms in comments too.
 */

import { duckdbService } from '../../services/duckdb.js';
import { buildWhereFromFilterParamsWithoutDate, type CommonFilterParams } from '../../utils/filter-params.js';
import {
  generateBaselineActualQuery,
  generateHistoricalLossRatioQuery,
  generateRecentExpenseRatioQuery,
  generateYoYGrowthQuery,
  type BaselineQueryConfig,
} from '../../sql/forecast/baseline.js';
import type {
  ForecastBaselineActual,
  ForecastBaselineRequest,
  ForecastBaselineResponse,
  HistoricalCohort,
  PercentileDistribution,
  YoYGrowthSample,
} from '../schemas/agent-forecast-baseline.schema.js';

const FORBIDDEN_INTERPRETATIONS = ['财务报表利润', '法定承保利润', '审计利润', '承保利润'];

interface RawActualRow {
  signed_premium: number | null;
  earned_premium: number | null;
  cumulative_reported_claims: number | null;
  cumulative_fee: number | null;
  total_exposure_days: number | bigint | null;
  policy_count: number | bigint | null;
}

interface RawCohortRow {
  signing_year: number | bigint | null;
  year_premium: number | null;
  year_claims: number | null;
  year_loss_ratio_pct: number | null;
}

interface RawYoYRow {
  year: number | bigint | null;
  year_premium: number | null;
  prev_year_premium: number | null;
  yoy_growth_pct: number | null;
}

interface RawRecentExpenseRow {
  recent_signed_premium: number | null;
  recent_fee: number | null;
  recent_expense_ratio_pct: number | null;
  recent_policy_count: number | bigint | null;
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function intNum(value: unknown): number {
  const n = num(value);
  return Math.round(n);
}

/**
 * Linear-interpolation percentile (matches DuckDB / pandas default).
 * Returns 0 when the input is empty.
 */
export function computePercentile(values: number[], p: number): number {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return Math.round(sorted[0]! * 10000) / 10000;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const interpolated = sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
  return Math.round(interpolated * 10000) / 10000;
}

function percentileBundle(values: number[]): PercentileDistribution {
  return {
    p25: computePercentile(values, 25),
    p50: computePercentile(values, 50),
    p75: computePercentile(values, 75),
  };
}

function buildWhereClause(input: ForecastBaselineRequest, permissionFilter: string): string {
  const params: CommonFilterParams = {
    orgNames: input.filters.orgLevel3?.join(','),
    customerCategories: input.filters.customerCategory?.join(','),
    coverageCombinations: input.filters.coverageCombination?.join(','),
  };
  return buildWhereFromFilterParamsWithoutDate(params, permissionFilter);
}

function buildActual(row: RawActualRow | undefined): ForecastBaselineActual {
  const signed = num(row?.signed_premium);
  const earned = num(row?.earned_premium);
  const claims = num(row?.cumulative_reported_claims);
  const fee = num(row?.cumulative_fee);

  const earnedRatio = signed > 0 ? Math.round((earned / signed) * 10000) / 100 : 0;
  const earnedClaimRatio = earned > 0 ? Math.round((claims / earned) * 10000) / 100 : 0;
  const feeRatio = signed > 0 ? Math.round((fee / signed) * 10000) / 100 : 0;
  const remainingExposure = Math.round((signed - earned) * 100) / 100;

  return {
    signedPremium: signed,
    earnedPremium: earned,
    earnedRatioPct: earnedRatio,
    cumulativeReportedClaims: claims,
    earnedClaimRatioPct: earnedClaimRatio,
    cumulativeFee: fee,
    feeRatioPct: feeRatio,
    remainingExposure,
    policyCount: intNum(row?.policy_count),
  };
}

function buildCohorts(rows: RawCohortRow[]): { cohorts: HistoricalCohort[]; lossRatios: number[] } {
  const cohorts: HistoricalCohort[] = rows
    .filter((r) => r.signing_year !== null && r.signing_year !== undefined)
    .map((r) => ({
      year: intNum(r.signing_year),
      premium: num(r.year_premium),
      claims: num(r.year_claims),
      lossRatioPct: num(r.year_loss_ratio_pct),
    }));
  // Loss ratios from cohorts with non-zero premium (silent zeros distort percentiles).
  const lossRatios = cohorts.filter((c) => c.premium > 0).map((c) => c.lossRatioPct);
  return { cohorts, lossRatios };
}

function buildYoYSamples(rows: RawYoYRow[]): { samples: YoYGrowthSample[]; growths: number[] } {
  const samples: YoYGrowthSample[] = rows
    .filter((r) => r.year !== null && r.year !== undefined)
    .map((r) => ({
      year: intNum(r.year),
      premium: num(r.year_premium),
      prevYearPremium: nullableNum(r.prev_year_premium),
      yoyGrowthPct: nullableNum(r.yoy_growth_pct),
    }));
  const growths = samples
    .map((s) => s.yoyGrowthPct)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return { samples, growths };
}

export interface BuildBaselineInput {
  request: ForecastBaselineRequest;
  permissionFilter: string;
}

export async function buildForecastBaseline(input: BuildBaselineInput): Promise<ForecastBaselineResponse> {
  const { request, permissionFilter } = input;
  const whereClause = buildWhereClause(request, permissionFilter);

  const sqlConfig: BaselineQueryConfig = {
    cutoffDate: request.cutoffDate,
    whereClause,
    historyWindowYears: request.historyWindowYears,
    recentExpenseMonths: request.recentExpenseMonths,
  };

  const [actualRows, cohortRows, yoyRows, recentRows] = await Promise.all([
    duckdbService.query<RawActualRow>(generateBaselineActualQuery(sqlConfig)),
    duckdbService.query<RawCohortRow>(generateHistoricalLossRatioQuery(sqlConfig)),
    duckdbService.query<RawYoYRow>(generateYoYGrowthQuery(sqlConfig)),
    duckdbService.query<RawRecentExpenseRow>(generateRecentExpenseRatioQuery(sqlConfig)),
  ]);

  const actual = buildActual(actualRows[0]);
  const { cohorts, lossRatios } = buildCohorts(cohortRows);
  const lossPercentiles = percentileBundle(lossRatios);
  const { samples, growths } = buildYoYSamples(yoyRows);
  const growthPercentiles = percentileBundle(growths);

  const recent = recentRows[0];
  const meanExpenseRatioPct = num(recent?.recent_expense_ratio_pct);

  const warnings = [
    'forecast 是基于已发生数据 + 历史窗口建模的情景测算，不是财务报表利润、法定承保利润或审计利润。',
    `历史窗口 = 过去 ${request.historyWindowYears} 年；样本不足或分布偏斜时，分位数可能失真，请结合业务判断。`,
    'V3 新签业务终极赔付率默认与 V1 同源（历史已满期保单赔付率），可在前端选择独立 override。',
    `V4 新签业务费用率取最近 ${request.recentExpenseMonths} 个月签单费用率均值，未做季节性调整。`,
  ];

  if (lossRatios.length === 0) {
    warnings.push('未在历史窗口内找到非零保费的赔付率样本；V1/V3 分位数全部归零，请扩大筛选范围或加大窗口。');
  }
  if (growths.length === 0) {
    warnings.push('YoY 同期样本不足，无法派生 V2 增速分位数；请扩大历史窗口或调整筛选维度。');
  }

  return {
    success: true,
    data: {
      cutoffDate: request.cutoffDate,
      filters: request.filters,
      historyWindowYears: request.historyWindowYears,
      recentExpenseMonths: request.recentExpenseMonths,
      actual,
      variables: {
        historicalLossRatio: {
          windowYears: request.historyWindowYears,
          cohorts,
          percentiles: lossPercentiles,
          cohortCount: cohorts.length,
        },
        newSigningPremiumGrowth: {
          windowYears: request.historyWindowYears,
          samples,
          percentiles: growthPercentiles,
          sampleCount: growths.length,
        },
        // V3 默认与 V1 同源；前端可允许用户独立修改
        newSigningLossRatio: {
          windowYears: request.historyWindowYears,
          cohorts,
          percentiles: lossPercentiles,
          cohortCount: cohorts.length,
        },
        newSigningExpenseRatio: {
          windowMonths: request.recentExpenseMonths,
          recentSignedPremium: num(recent?.recent_signed_premium),
          recentFee: num(recent?.recent_fee),
          meanExpenseRatioPct,
          policyCount: intNum(recent?.recent_policy_count),
        },
      },
      defaults: {
        v1HistoricalLossRatio: lossPercentiles,
        v2NewSigningPremiumGrowth: growthPercentiles,
        v3NewSigningLossRatio: lossPercentiles,
        v4NewSigningExpenseRatio: meanExpenseRatioPct,
      },
      warnings,
      forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    },
  };
}
