/**
 * segment-risk-scan Skill — 阶段 2（含实验性 credibility 修正）
 *
 * 维度交叉风险扫描：默认 2 维交叉（用户决策），输出每个交叉组合的：
 *   - raw earnedClaimRatio
 *   - credibility = n / (n + K)（K 默认 300，统计学经验公式，未经业务字典确认）
 *   - adjustedEarnedClaimRatio = baseline * (1 - credibility) + raw * credibility
 *   - riskLevel
 *
 * ⚠️ 红线警告：credibility / adjustedEarnedClaimRatio 公式由 red-line-policy.ts 强制注入
 *    "未经业务字典确认" warning（CLAUDE.md §10）。
 *
 * 维度白名单（防止 SQL 注入 + 业务字典对齐）：
 *   customer_category, org_level_3, coverage_combination, is_nev, tonnage_segment, business_type
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import { runSql } from '../adapters/query-adapter.js';
import { buildPolicyDedupCTE } from '../../sql/shared/policy-dedup.js';
import { getMetricSql } from '../../config/metric-registry/index.js';

const ALLOWED_DIMENSIONS = [
  'customer_category',
  'org_level_3',
  'coverage_combination',
  'is_nev',
  'tonnage_segment',
  'business_type',
] as const;

const DimensionSchema = z.enum(ALLOWED_DIMENSIONS);

const InputSchema = z.object({
  period: PeriodSchema,
  /**
   * 默认 2 维交叉（用户决策）；若只传 1 个则降级为单维度扫描，
   * 若传 3 个会被截断为前 2 个并产生 warning
   */
  dimensions: z
    .array(DimensionSchema)
    .min(1)
    .max(3)
    .default(['customer_category', 'org_level_3']),
  /** Credibility 经验常数 K，默认 300（n/(n+300)） */
  credibilityK: z.number().int().min(1).max(10000).default(300),
  /** 最小保单数门槛，默认 10 */
  minPolicyCount: z.number().int().min(0).default(10),
  /** Top N 高风险 segment，默认 20 */
  topN: z.number().int().min(1).max(200).default(20),
  /** 高风险 adjustedEarnedClaimRatio 阈值（%），默认 70 */
  redThreshold: z.number().min(0).max(200).default(70),
  /** 中风险阈值，默认 50 */
  yellowThreshold: z.number().min(0).max(200).default(50),
});

const RiskLevelSchema = z.enum(['red', 'yellow', 'green']);

const SegmentSchema = z.object({
  dimKey: z.string(),
  dimValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  policyCount: z.number(),
  totalPremium: z.number(),
  earnedPremium: z.number().nullable(),
  totalReportedClaims: z.number(),
  rawEarnedClaimRatio: z.number().nullable(),
  credibility: z.number().min(0).max(1),
  adjustedEarnedClaimRatio: z.number().nullable(),
  riskLevel: RiskLevelSchema,
});

const ResultSchema = z.object({
  dimensions: z.array(DimensionSchema),
  cutoffDate: z.string(),
  baselineEarnedClaimRatio: z.number().nullable(),
  totalSegments: z.number(),
  segments: z.array(SegmentSchema),
  topRiskSegments: z.array(SegmentSchema),
  redCount: z.number(),
  yellowCount: z.number(),
  greenCount: z.number(),
});

type Result = z.infer<typeof ResultSchema>;
type Segment = z.infer<typeof SegmentSchema>;

interface SegmentRow {
  dim_key: string | null;
  policy_count: number;
  total_premium: number;
  earned_premium: number | null;
  total_reported_claims: number;
  earned_claim_ratio: number | null;
  [k: string]: unknown;
}

function classifyRisk(
  adjusted: number | null,
  redThreshold: number,
  yellowThreshold: number
): 'red' | 'yellow' | 'green' {
  if (adjusted === null || Number.isNaN(adjusted)) return 'green';
  if (adjusted >= redThreshold) return 'red';
  if (adjusted >= yellowThreshold) return 'yellow';
  return 'green';
}

export const segmentRiskScanSkill: Skill<typeof InputSchema, Result> = {
  id: 'segment-risk-scan',
  name: '维度交叉风险扫描',
  version: '1.0.0',
  description: '默认 2 维交叉的风险扫描；输出 raw + credibility 修正后的赔付率（实验性公式）',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  lazyDomains: ['ClaimsAgg'],
  async run(input, ctx) {
    // 维度处理：截断 + 去重
    const rawDims = input.dimensions;
    const dims = Array.from(new Set(rawDims)).slice(0, 2);
    const truncated = rawDims.length > 2;

    // 白名单已在 zod schema 限定，这里不再硬编码
    const cutoffDate = input.period.endDate;
    const dateField: 'policy_date' = 'policy_date';
    const startEsc = input.period.startDate.replace(/'/g, "''");
    const endEsc = input.period.endDate.replace(/'/g, "''");
    const perm = ctx.permissionFilter || '1=1';
    const whereClause = `CAST(${dateField} AS DATE) >= DATE '${startEsc}' AND CAST(${dateField} AS DATE) <= DATE '${endEsc}' AND (${perm})`;

    // 1) 整体 baseline（不分组，用于 credibility 收缩中心）
    const baselineCTE = buildPolicyDedupCTE('policy_dedup', { whereClause });
    const baselineSql = `
      WITH ${baselineCTE},
      pe AS (
        SELECT
          p.policy_no,
          p.premium,
          p.insurance_start_date AS start_date,
          DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
          LEAST(
            GREATEST(
              DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate.replace(/'/g, "''")}'),
              0
            ),
            DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
          ) AS earned_days,
          COALESCE(c.reported_claims, 0) AS reported_claims
        FROM policy_dedup p
        LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
      )
      SELECT
        CAST(COUNT(*) AS INTEGER) AS policy_count,
        ROUND(SUM(reported_claims), 2) AS total_reported_claims,
        ${getMetricSql('earned_premium')},
        ${getMetricSql('earned_claim_ratio')}
      FROM pe
    `;

    // 2) 维度交叉聚合
    const dimsSelect = dims.map((d) => `p.${d}`).join(', ');
    const dimsGroupBy = dims.join(', ');
    const dimKeyExpr = dims.map((d) => `COALESCE(CAST(${d} AS VARCHAR), '未知')`).join(" || ' | ' || ");
    const segmentCTE = buildPolicyDedupCTE('policy_dedup', { whereClause, extraFields: dims as string[] });
    const segmentSql = `
      WITH ${segmentCTE},
      pe AS (
        SELECT
          p.policy_no,
          ${dimsSelect},
          p.premium,
          p.insurance_start_date AS start_date,
          DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
          LEAST(
            GREATEST(
              DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate.replace(/'/g, "''")}'),
              0
            ),
            DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
          ) AS earned_days,
          COALESCE(c.reported_claims, 0) AS reported_claims
        FROM policy_dedup p
        LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
      )
      SELECT
        ${dimKeyExpr} AS dim_key,
        ${dims.map((d) => `${d}`).join(', ')},
        CAST(COUNT(*) AS INTEGER) AS policy_count,
        ROUND(SUM(premium), 2) AS total_premium,
        ROUND(SUM(reported_claims), 2) AS total_reported_claims,
        ${getMetricSql('earned_premium')},
        ${getMetricSql('earned_claim_ratio')}
      FROM pe
      GROUP BY ${dimsGroupBy}
      ORDER BY SUM(premium) DESC
    `;

    const [baselineRows, segmentRows] = await Promise.all([
      runSql<SegmentRow>(baselineSql),
      runSql<SegmentRow>(segmentSql),
    ]);

    const baseline = baselineRows[0];
    const baselineEarnedClaimRatio = baseline?.earned_claim_ratio === null || baseline?.earned_claim_ratio === undefined
      ? null
      : Number(baseline.earned_claim_ratio);

    const validRows = segmentRows.filter((r) => Number(r.policy_count ?? 0) >= input.minPolicyCount);

    const segments: Segment[] = validRows.map((r) => {
      const policyCount = Number(r.policy_count ?? 0);
      const credibility = policyCount / (policyCount + input.credibilityK);
      const raw = r.earned_claim_ratio === null || r.earned_claim_ratio === undefined ? null : Number(r.earned_claim_ratio);

      let adjusted: number | null = null;
      if (raw !== null && baselineEarnedClaimRatio !== null) {
        adjusted = Number((baselineEarnedClaimRatio * (1 - credibility) + raw * credibility).toFixed(2));
      } else if (raw !== null) {
        adjusted = raw;
      }

      const dimValues: Record<string, string | number | boolean | null> = {};
      for (const d of dims) {
        const v = (r as Record<string, unknown>)[d];
        if (v === null || v === undefined) {
          dimValues[d] = null;
        } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
          dimValues[d] = v;
        } else {
          dimValues[d] = String(v);
        }
      }

      return {
        dimKey: (r.dim_key ?? '未知').toString(),
        dimValues,
        policyCount,
        totalPremium: Number(r.total_premium ?? 0),
        earnedPremium: r.earned_premium === null || r.earned_premium === undefined ? null : Number(r.earned_premium),
        totalReportedClaims: Number(r.total_reported_claims ?? 0),
        rawEarnedClaimRatio: raw,
        credibility: Number(credibility.toFixed(4)),
        adjustedEarnedClaimRatio: adjusted,
        riskLevel: classifyRisk(adjusted, input.redThreshold, input.yellowThreshold),
      };
    });

    // 排序：风险 + adjusted 降序
    const RISK_ORDER: Record<Segment['riskLevel'], number> = { red: 0, yellow: 1, green: 2 };
    const sorted = [...segments].sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) return RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
      return (b.adjustedEarnedClaimRatio ?? -1) - (a.adjustedEarnedClaimRatio ?? -1);
    });

    const topRiskSegments = sorted.slice(0, input.topN);
    const redCount = segments.filter((s) => s.riskLevel === 'red').length;
    const yellowCount = segments.filter((s) => s.riskLevel === 'yellow').length;
    const greenCount = segments.filter((s) => s.riskLevel === 'green').length;

    const warnings: string[] = [];
    if (truncated) {
      warnings.push(`dimensions 仅支持 2 维交叉，已截断为 ${dims.join(' × ')}`);
    }
    if (segments.length === 0) {
      warnings.push(`所有 segment 均未达到 minPolicyCount=${input.minPolicyCount}`);
    }
    const filteredOut = segmentRows.length - validRows.length;
    if (filteredOut > 0) {
      warnings.push(`${filteredOut} 个 segment 因保单数 < ${input.minPolicyCount} 被过滤`);
    }

    return {
      result: {
        dimensions: dims,
        cutoffDate,
        baselineEarnedClaimRatio,
        totalSegments: segments.length,
        segments: sorted,
        topRiskSegments,
        redCount,
        yellowCount,
        greenCount,
      },
      evidence: [
        { metric: 'baseline_earned_claim_ratio', value: baselineEarnedClaimRatio, source: 'metric-registry:earned_claim_ratio', note: '加权重算（SUM 后比）' },
        { metric: 'red_segment_count', value: redCount, source: 'segment-risk-scan', note: `阈值 adjusted >= ${input.redThreshold}` },
      ],
      confidence: segments.length === 0 ? 0.2 : 1.0,
      warnings,
      assumptions: [
        `dimensions=${dims.join(' × ')}（默认 2 维交叉）`,
        `credibilityK=${input.credibilityK}，公式 n/(n+K)`,
        'adjusted = baseline × (1 - credibility) + raw × credibility',
        `minPolicyCount=${input.minPolicyCount}（小样本噪音抑制）`,
        `行级过滤: ${ctx.permissionFilter}`,
      ],
      dataLineage: [
        'PolicyFact',
        'ClaimsAgg',
        'sql/shared/policy-dedup.ts:buildPolicyDedupCTE',
        'metric-registry:earned_premium',
        'metric-registry:earned_claim_ratio',
      ],
      nextSuggestedSkills: redCount > 0 ? ['claims-drilldown'] : [],
    };
  },
};
