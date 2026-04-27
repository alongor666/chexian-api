/**
 * cost-diagnosis Skill — 阶段 2
 *
 * 输出"高赔付分组"诊断列表。
 * 100% 复用 sql/cost.ts 的 generateClaimRatioQuery / generateComprehensiveCostQuery —
 * 不重写任何指标公式，确保与 /api/query/cost 看板口径一致（CLAUDE.md §6 对账要求）。
 *
 * 维度选择：默认按 customer_category（与 .claude/commands/diagnose-* 主流程对齐）。
 * 风险阈值：earnedClaimRatio (满期赔付率)
 *   - red:    >= 70
 *   - yellow: 50 ~ 70
 *   - green:  < 50
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import { runSql } from '../adapters/query-adapter.js';
import {
  generateClaimRatioQuery,
  generateComprehensiveCostQuery,
  type CostDimension,
} from '../../sql/cost.js';

const DimensionSchema = z.enum([
  'customer_category',
  'org_level_3',
  'coverage_combination',
  'org_customer',
  'org_coverage',
]);

const InputSchema = z.object({
  period: PeriodSchema,
  dimension: DimensionSchema.default('customer_category'),
  /** 高赔付门槛（满期赔付率 %），>= 此值视为高风险，默认 70 */
  redThreshold: z.number().min(0).max(200).default(70),
  /** 中风险门槛（满期赔付率 %），默认 50 */
  yellowThreshold: z.number().min(0).max(200).default(50),
  /** Top N 高风险分组，默认 5 */
  topN: z.number().int().min(1).max(50).default(5),
  /** 最小保单数门槛，避免小样本噪音；默认 30 */
  minPolicyCount: z.number().int().min(0).default(30),
});

const RiskLevelSchema = z.enum(['red', 'yellow', 'green']);

const GroupSchema = z.object({
  dimKey: z.string(),
  policyCount: z.number(),
  totalPremium: z.number(),
  totalReportedClaims: z.number(),
  earnedPremium: z.number().nullable(),
  earnedClaimRatio: z.number().nullable(),
  earnedLossFrequency: z.number().nullable(),
  avgClaimAmount: z.number().nullable(),
  comprehensiveCostRatio: z.number().nullable(),
  expenseRatio: z.number().nullable(),
  riskLevel: RiskLevelSchema,
  premiumShare: z.number(),
});

const ResultSchema = z.object({
  dimension: DimensionSchema,
  cutoffDate: z.string(),
  totalGroups: z.number(),
  groups: z.array(GroupSchema),
  topRiskGroups: z.array(GroupSchema),
  redGroupCount: z.number(),
  yellowGroupCount: z.number(),
  greenGroupCount: z.number(),
  /** 整体加权满期赔付率（用 SUM 重算，禁止平均率） */
  overallEarnedClaimRatio: z.number().nullable(),
  overallComprehensiveCostRatio: z.number().nullable(),
});

type Result = z.infer<typeof ResultSchema>;
type Group = z.infer<typeof GroupSchema>;

interface ClaimRatioRow {
  dim_key: string | null;
  policy_count: number;
  total_premium: number;
  total_claim_cases: number;
  total_reported_claims: number;
  avg_claim_amount: number | null;
  earned_premium: number | null;
  total_exposure_days: number;
  avg_exposure_days: number;
  earned_claim_ratio: number | null;
  earned_loss_frequency: number | null;
}

interface CombinedCostRow {
  dim_key: string | null;
  policy_count: number;
  total_premium: number;
  total_reported_claims: number;
  total_fee: number;
  earned_premium: number | null;
  earned_claim_ratio: number | null;
  expense_ratio: number | null;
  comprehensive_cost_ratio: number | null;
}

function classifyRisk(
  earnedClaimRatio: number | null,
  redThreshold: number,
  yellowThreshold: number
): 'red' | 'yellow' | 'green' {
  if (earnedClaimRatio === null || Number.isNaN(earnedClaimRatio)) return 'green';
  if (earnedClaimRatio >= redThreshold) return 'red';
  if (earnedClaimRatio >= yellowThreshold) return 'yellow';
  return 'green';
}

function buildPolicyWhere(
  startDate: string,
  endDate: string,
  permissionFilter: string,
  dateField: 'policy_date' | 'insurance_start_date'
): string {
  // sql/cost.ts 的 generators 把 whereClause 拼到 PolicyFact 的 WHERE 子句中。
  // 这里把日期 + 行级过滤一并交付，让生成器内部不需要感知 period。
  const escStart = startDate.replace(/'/g, "''");
  const escEnd = endDate.replace(/'/g, "''");
  const perm = permissionFilter || '1=1';
  return `CAST(${dateField} AS DATE) >= DATE '${escStart}' AND CAST(${dateField} AS DATE) <= DATE '${escEnd}' AND (${perm})`;
}

export const costDiagnosisSkill: Skill<typeof InputSchema, Result> = {
  id: 'cost-diagnosis',
  name: '成本诊断',
  version: '1.0.0',
  description: '基于满期赔付率与综合成本率的高赔付分组诊断（按客户类别 / 机构 / 险别组合）',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  lazyDomains: ['ClaimsAgg'],
  async run(input, ctx) {
    const cutoffDate = input.period.endDate;
    const dateField: 'policy_date' | 'insurance_start_date' = 'policy_date';
    const whereClause = buildPolicyWhere(
      input.period.startDate,
      input.period.endDate,
      ctx.permissionFilter,
      dateField
    );

    const claimSql = generateClaimRatioQuery({
      dimension: input.dimension as CostDimension,
      cutoffDate,
      whereClause,
    });
    const comprehensiveSql = generateComprehensiveCostQuery({
      dimension: input.dimension as CostDimension,
      cutoffDate,
      whereClause,
    });

    const [claimRows, combinedRows] = await Promise.all([
      runSql<ClaimRatioRow>(claimSql),
      runSql<CombinedCostRow>(comprehensiveSql),
    ]);

    // 用 dimKey 关联两套口径
    const combinedMap = new Map<string, CombinedCostRow>();
    for (const row of combinedRows) {
      const key = (row.dim_key ?? '未知').toString();
      combinedMap.set(key, row);
    }

    const validRows = claimRows.filter((r) => Number(r.policy_count ?? 0) >= input.minPolicyCount);
    const totalPremiumSum = validRows.reduce((sum, r) => sum + Number(r.total_premium ?? 0), 0) || 0;

    const groups: Group[] = validRows.map((r) => {
      const key = (r.dim_key ?? '未知').toString();
      const combined = combinedMap.get(key);
      const earnedClaimRatio = r.earned_claim_ratio === null || r.earned_claim_ratio === undefined ? null : Number(r.earned_claim_ratio);
      const totalPremium = Number(r.total_premium ?? 0);
      return {
        dimKey: key,
        policyCount: Number(r.policy_count ?? 0),
        totalPremium,
        totalReportedClaims: Number(r.total_reported_claims ?? 0),
        earnedPremium: r.earned_premium === null || r.earned_premium === undefined ? null : Number(r.earned_premium),
        earnedClaimRatio,
        earnedLossFrequency: r.earned_loss_frequency === null || r.earned_loss_frequency === undefined ? null : Number(r.earned_loss_frequency),
        avgClaimAmount: r.avg_claim_amount === null || r.avg_claim_amount === undefined ? null : Number(r.avg_claim_amount),
        comprehensiveCostRatio: combined?.comprehensive_cost_ratio === null || combined?.comprehensive_cost_ratio === undefined ? null : Number(combined.comprehensive_cost_ratio),
        expenseRatio: combined?.expense_ratio === null || combined?.expense_ratio === undefined ? null : Number(combined.expense_ratio),
        riskLevel: classifyRisk(earnedClaimRatio, input.redThreshold, input.yellowThreshold),
        premiumShare: totalPremiumSum > 0 ? Number((totalPremium / totalPremiumSum).toFixed(4)) : 0,
      };
    });

    // 按风险 + 保费降序排序
    const RISK_ORDER: Record<Group['riskLevel'], number> = { red: 0, yellow: 1, green: 2 };
    const sorted = [...groups].sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) return RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
      return b.totalPremium - a.totalPremium;
    });

    const topRiskGroups = sorted.filter((g) => g.riskLevel === 'red').slice(0, input.topN);
    if (topRiskGroups.length < input.topN) {
      const filler = sorted.filter((g) => g.riskLevel === 'yellow').slice(0, input.topN - topRiskGroups.length);
      topRiskGroups.push(...filler);
    }

    // 整体加权（绝对值聚合后重算，禁止平均率）
    const totalEarnedPremium = validRows.reduce((sum, r) => sum + Number(r.earned_premium ?? 0), 0);
    const totalReportedClaims = validRows.reduce((sum, r) => sum + Number(r.total_reported_claims ?? 0), 0);
    const overallEarnedClaimRatio = totalEarnedPremium > 0
      ? Number(((totalReportedClaims / totalEarnedPremium) * 100).toFixed(2))
      : null;
    const totalFee = combinedRows.reduce((sum, r) => sum + Number(r.total_fee ?? 0), 0);
    const overallComprehensiveCostRatio = totalEarnedPremium > 0
      ? Number((((totalReportedClaims + totalFee) / totalEarnedPremium) * 100).toFixed(2))
      : null;

    const redGroupCount = groups.filter((g) => g.riskLevel === 'red').length;
    const yellowGroupCount = groups.filter((g) => g.riskLevel === 'yellow').length;
    const greenGroupCount = groups.filter((g) => g.riskLevel === 'green').length;

    const warnings: string[] = [];
    if (groups.length === 0) {
      warnings.push(`所有分组均未达到 minPolicyCount=${input.minPolicyCount}，请放宽阈值或扩大 period`);
    }
    const filteredOut = claimRows.length - validRows.length;
    if (filteredOut > 0) {
      warnings.push(`${filteredOut} 个分组因保单数 < ${input.minPolicyCount} 被过滤（小样本噪音抑制）`);
    }

    return {
      result: {
        dimension: input.dimension,
        cutoffDate,
        totalGroups: groups.length,
        groups: sorted,
        topRiskGroups,
        redGroupCount,
        yellowGroupCount,
        greenGroupCount,
        overallEarnedClaimRatio,
        overallComprehensiveCostRatio,
      },
      evidence: [
        { metric: 'overall_earned_claim_ratio', value: overallEarnedClaimRatio, source: 'metric-registry:earned_claim_ratio', note: '加权重算（SUM 后比，非平均率）' },
        { metric: 'red_group_count', value: redGroupCount, source: 'cost-diagnosis', note: `阈值 ${input.redThreshold}` },
      ],
      confidence: groups.length === 0 ? 0.2 : 1.0,
      warnings,
      assumptions: [
        `cutoffDate=${cutoffDate}，与 period.endDate 一致`,
        `dateField=${dateField}，行级过滤=${ctx.permissionFilter}`,
        `dimension=${input.dimension}，红线阈值=${input.redThreshold}，黄线阈值=${input.yellowThreshold}`,
        `小样本过滤：minPolicyCount=${input.minPolicyCount}`,
      ],
      dataLineage: [
        'PolicyFact',
        'ClaimsAgg',
        'metric-registry:earned_claim_ratio',
        'metric-registry:earned_premium',
        'metric-registry:earned_loss_frequency',
        'metric-registry:avg_claim_amount',
        'metric-registry:expense_ratio',
        'sql/cost/cost-ratios.ts',
      ],
      nextSuggestedSkills: redGroupCount > 0 ? ['claims-drilldown', 'segment-risk-scan'] : ['segment-risk-scan'],
    };
  },
};
