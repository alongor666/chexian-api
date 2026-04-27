/**
 * kpi-baseline Skill — 阶段 1
 *
 * 输出经营基线：保费、件数、赔款、赔付率、费用率、综合成本率。
 * 100% 复用 metric-registry 的 SQL 表达式（getMetricSql），不重新定义任何指标公式。
 *
 * 参考：server/src/sql/cost.ts 中的 CTE 结构（earned_days + policy_term）
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import { buildPeriodWhere, runSql } from '../adapters/query-adapter.js';
import { getMetricSql } from '../../config/metric-registry/index.js';

const InputSchema = z.object({
  period: PeriodSchema,
});

const ResultSchema = z.object({
  premium: z.number(),
  policyCount: z.number(),
  reportedClaims: z.number(),
  feeAmount: z.number(),
  earnedClaimRatio: z.number().nullable(),
  expenseRatio: z.number().nullable(),
  avgClaimAmount: z.number().nullable(),
  period: PeriodSchema,
});

type Result = z.infer<typeof ResultSchema>;

export const kpiBaselineSkill: Skill<typeof InputSchema, Result> = {
  id: 'kpi-baseline',
  name: '经营基线',
  version: '1.0.0',
  description: '输出当期保费、件数、赔款、赔付率、费用率等经营基础指标（口径 100% 来自 metric-registry）',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  async run(input, ctx) {
    const { whereWithDate, dateField } = buildPeriodWhere(input.period, ctx);

    // 复用注册表口径，绝不重写公式
    const earnedClaimRatioExpr = getMetricSql('earned_claim_ratio');
    const expenseRatioExpr = getMetricSql('expense_ratio');
    const avgClaimAmountExpr = getMetricSql('avg_claim_amount');

    // 与 cost.ts 一致的 CTE：补齐 earned_days + policy_term
    const sql = `
      WITH policy_exposure AS (
        SELECT
          *,
          DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_end_date AS DATE)) AS policy_term,
          GREATEST(
            0,
            LEAST(
              DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_end_date AS DATE)),
              DATEDIFF('day', CAST(insurance_start_date AS DATE), CURRENT_DATE)
            )
          ) AS earned_days
        FROM PolicyFact
        WHERE ${whereWithDate}
      )
      SELECT
        SUM(premium) AS premium,
        COUNT(*) AS policy_count,
        SUM(reported_claims) AS reported_claims,
        SUM(COALESCE(fee_amount, 0)) AS fee_amount,
        ${earnedClaimRatioExpr},
        ${expenseRatioExpr},
        ${avgClaimAmountExpr}
      FROM policy_exposure
    `;

    const rows = await runSql<Record<string, number | null>>(sql);
    const row = rows[0] ?? {};

    return {
      result: {
        premium: Number(row.premium ?? 0),
        policyCount: Number(row.policy_count ?? 0),
        reportedClaims: Number(row.reported_claims ?? 0),
        feeAmount: Number(row.fee_amount ?? 0),
        earnedClaimRatio: row.earned_claim_ratio === null || row.earned_claim_ratio === undefined ? null : Number(row.earned_claim_ratio),
        expenseRatio: row.expense_ratio === null || row.expense_ratio === undefined ? null : Number(row.expense_ratio),
        avgClaimAmount: row.avg_claim_amount === null || row.avg_claim_amount === undefined ? null : Number(row.avg_claim_amount),
        period: input.period,
      },
      evidence: [
        { metric: 'premium', value: Number(row.premium ?? 0), source: 'PolicyFact', note: 'SUM(premium) over period' },
        { metric: 'earned_claim_ratio', value: row.earned_claim_ratio ?? null, source: 'metric-registry:earned_claim_ratio', note: 'v2.0.0 闰年感知' },
      ],
      confidence: 1.0,
      warnings: [],
      assumptions: [
        `日期字段使用 ${dateField}`,
        `行级过滤: ${ctx.permissionFilter}`,
        `policy_term 与 earned_days 在 CTE 内现算（与 sql/cost.ts 一致）`,
      ],
      dataLineage: ['PolicyFact', 'metric-registry:earned_claim_ratio', 'metric-registry:expense_ratio', 'metric-registry:avg_claim_amount'],
      nextSuggestedSkills: ['cost-diagnosis'],
    };
  },
};
