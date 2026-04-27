/**
 * pricing-simulation Skill — 阶段 4 PR-A
 *
 * 把 risk-scoring 的输出（每个 segment 的推荐档位）映射为「rate adjustment 模拟」：
 *   - 按 recommendation → rateDelta 字典查表
 *   - 假设保单组合不变 + 赔款不变（关键假设，违反 CLAUDE.md §10「定价系数 ≠ 赔付因果」）
 *   - 计算 premiumAfter = premiumBefore × (1 + rateDelta)
 *   - 计算 lossRatioAfter = totalReportedClaims × expectedClaimsRetention / earnedPremiumAfter × 100
 *
 * 设计原则（与 CLAUDE.md §0 / §10 / .claude/rules/sql-generators.md 对齐）：
 * - **纯确定性**：不调用 LLM，不发起 SQL
 * - **复用上游结构**：rate 变更前的赔付率 = 上游 adjustedEarnedClaimRatio，绝不重写
 *   赔付率公式（lossRatioAfter 的计算口径与 metric-registry:earned_claim_ratio 一致：
 *   分子=已报告赔款，分母=满期保费）
 * - **要求审批**：requiresApproval=true。本结果是模拟器，不构成定价建议（红线已登记）
 * - **输入只接 risk-scoring 输出**：禁止接受 LLM 直接生成的 segment + recommendation 列表
 *
 * 红线：red-line-policy.ts:25-29 已预登记
 *   - "未纳入客户流失弹性模型，保费影响可能偏乐观"
 *   - "lossRatioAfter 假设客群结构不变，违反 CLAUDE.md §10「定价系数 ≠ 赔付因果」"
 *   - "本结果不构成定价建议，仅供分析参考"
 * runner 会在末尾自动注入。
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { RiskScoringResultSchema } from './risk-scoring.skill.js';

// ──────────────────────────────────────────────────────────────────────────
// 输入
// ──────────────────────────────────────────────────────────────────────────

const RecommendationSchema = z.enum(['stop_underwriting', 'raise_rate', 'monitor', 'ok']);

const RateDeltaMapSchema = z.object({
  /** 停止承保 → 默认 -1.0（保费归零，纯模拟） */
  stop_underwriting: z.number().min(-1).max(2).default(-1.0),
  /** 涨费 → 默认 +20% */
  raise_rate: z.number().min(-1).max(2).default(0.2),
  /** 监控 → 默认 +5% */
  monitor: z.number().min(-1).max(2).default(0.05),
  /** 不动 → 默认 0% */
  ok: z.number().min(-1).max(2).default(0.0),
});

const DEFAULT_RATE_DELTA = {
  stop_underwriting: -1.0,
  raise_rate: 0.2,
  monitor: 0.05,
  ok: 0.0,
} as const;

const InputSchema = z.object({
  /** 来自 risk-scoring 的 result 字段（workflow 自动透传） */
  scoring: RiskScoringResultSchema,
  /** 各推荐档位对应的费率调整幅度（小数：0.2 = +20%）。嵌套 object 必须给完整默认值。 */
  rateDeltaByRecommendation: RateDeltaMapSchema.default(DEFAULT_RATE_DELTA),
  /**
   * 赔款留存假设：1.0 = 调费后赔款总量不变（最保守），< 1.0 = 调费后赔款下降（如 0.95）。
   * 默认 1.0。这是关键假设，红线 warning 已强制注入。
   */
  expectedClaimsRetention: z.number().min(0).max(2).default(1.0),
});

// ──────────────────────────────────────────────────────────────────────────
// 输出
// ──────────────────────────────────────────────────────────────────────────

const SimulatedSegmentSchema = z.object({
  dimKey: z.string(),
  dimValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  recommendation: RecommendationSchema,
  riskScore: z.number(),
  rateDelta: z.number(),
  policyCount: z.number(),
  premiumBefore: z.number(),
  premiumAfter: z.number(),
  premiumDelta: z.number(),
  premiumDeltaPct: z.number(),
  earnedPremiumBefore: z.number().nullable(),
  earnedPremiumAfter: z.number().nullable(),
  totalReportedClaims: z.number(),
  expectedClaimsAfter: z.number(),
  lossRatioBefore: z.number().nullable(),
  lossRatioAfter: z.number().nullable(),
  /** 是否因 premiumAfter=0 / earnedPremiumBefore=null 等导致 lossRatioAfter 不可计算 */
  lossRatioAfterUncomputable: z.boolean(),
});

type SimulatedSegment = z.infer<typeof SimulatedSegmentSchema>;

export const PricingSimulationResultSchema = z.object({
  cutoffDate: z.string(),
  totalSegments: z.number(),
  segments: z.array(SimulatedSegmentSchema),
  rateDeltaByRecommendation: RateDeltaMapSchema,
  expectedClaimsRetention: z.number(),
  totals: z.object({
    premiumBefore: z.number(),
    premiumAfter: z.number(),
    premiumDelta: z.number(),
    premiumDeltaPct: z.number(),
    earnedPremiumBefore: z.number(),
    earnedPremiumAfter: z.number(),
    totalReportedClaims: z.number(),
    expectedClaimsAfter: z.number(),
    /**
     * weighted loss ratio 仅在「分子/分母同源」的可计算分段子集上聚合：
     * - 排除 lossRatioAfterUncomputable=true 的分段（如 stop_underwriting → premiumAfter=0）
     * - 排除 earnedPremiumBefore 为 null 的分段
     * 这样 before/after 对比基于同一组分段，禁止混入"不可计算"分段虚高总体率。
     */
    weightedLossRatioBefore: z.number().nullable(),
    weightedLossRatioAfter: z.number().nullable(),
    /** 参与 weightedLossRatio* 聚合的分段数 */
    weightedLossRatioBasisSegmentCount: z.number(),
    /** 因 uncomputable / earnedPremiumBefore=null 被排除的分段数 */
    weightedLossRatioExcludedSegmentCount: z.number(),
  }),
});

type Result = z.infer<typeof PricingSimulationResultSchema>;

// ──────────────────────────────────────────────────────────────────────────
// 模拟核心逻辑（纯函数）
// ──────────────────────────────────────────────────────────────────────────

export function simulateSegment(
  seg: {
    dimKey: string;
    dimValues: Record<string, string | number | boolean | null>;
    recommendation: SimulatedSegment['recommendation'];
    riskScore: number;
    policyCount: number;
    totalPremium: number;
    earnedPremium: number | null;
    totalReportedClaims: number;
    adjustedEarnedClaimRatio: number | null;
  },
  rateDelta: number,
  expectedClaimsRetention: number,
): SimulatedSegment {
  const premiumBefore = seg.totalPremium;
  const premiumAfter = Number((premiumBefore * (1 + rateDelta)).toFixed(2));
  const premiumDelta = Number((premiumAfter - premiumBefore).toFixed(2));
  const premiumDeltaPct = premiumBefore > 0 ? Number(((premiumDelta / premiumBefore) * 100).toFixed(2)) : 0;

  const earnedPremiumBefore = seg.earnedPremium;
  const earnedPremiumAfter =
    earnedPremiumBefore === null ? null : Number((earnedPremiumBefore * (1 + rateDelta)).toFixed(2));

  const expectedClaimsAfter = Number((seg.totalReportedClaims * expectedClaimsRetention).toFixed(2));

  const lossRatioBefore = seg.adjustedEarnedClaimRatio;

  let lossRatioAfter: number | null = null;
  let lossRatioAfterUncomputable = false;
  if (earnedPremiumAfter !== null && earnedPremiumAfter > 0) {
    lossRatioAfter = Number(((expectedClaimsAfter / earnedPremiumAfter) * 100).toFixed(2));
  } else {
    lossRatioAfterUncomputable = true;
  }

  return {
    dimKey: seg.dimKey,
    dimValues: seg.dimValues,
    recommendation: seg.recommendation,
    riskScore: seg.riskScore,
    rateDelta,
    policyCount: seg.policyCount,
    premiumBefore,
    premiumAfter,
    premiumDelta,
    premiumDeltaPct,
    earnedPremiumBefore,
    earnedPremiumAfter,
    totalReportedClaims: seg.totalReportedClaims,
    expectedClaimsAfter,
    lossRatioBefore,
    lossRatioAfter,
    lossRatioAfterUncomputable,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Skill
// ──────────────────────────────────────────────────────────────────────────

export const pricingSimulationSkill: Skill<typeof InputSchema, Result> = {
  id: 'pricing-simulation',
  name: '定价模拟',
  version: '1.0.0',
  description:
    '基于 risk-scoring 输出的推荐档位，按 rateDeltaByRecommendation 字典模拟费率调整，' +
    '输出 premiumAfter / lossRatioAfter / 总量影响。纯确定性内存计算，不调用 LLM/SQL。',
  inputSchema: InputSchema,
  outputResultSchema: PricingSimulationResultSchema,
  deterministic: true,
  requiresApproval: true,
  async run(input, _ctx) {
    const rateDeltaMap = input.rateDeltaByRecommendation;
    const retention = input.expectedClaimsRetention;

    const segments: SimulatedSegment[] = input.scoring.scoredSegments.map((s) => {
      const rateDelta = rateDeltaMap[s.recommendation];
      return simulateSegment(
        {
          dimKey: s.dimKey,
          dimValues: s.dimValues,
          recommendation: s.recommendation,
          riskScore: s.riskScore,
          policyCount: s.policyCount,
          totalPremium: s.totalPremium,
          earnedPremium: s.earnedPremium,
          totalReportedClaims: s.totalReportedClaims,
          adjustedEarnedClaimRatio: s.adjustedEarnedClaimRatio,
        },
        rateDelta,
        retention,
      );
    });

    // 总量聚合（绝对值聚合后重算率，遵守 CLAUDE.md §10 「率值禁加权平均」）
    const premiumBefore = segments.reduce((sum, s) => sum + s.premiumBefore, 0);
    const premiumAfter = segments.reduce((sum, s) => sum + s.premiumAfter, 0);
    const premiumDelta = Number((premiumAfter - premiumBefore).toFixed(2));
    const premiumDeltaPct =
      premiumBefore > 0 ? Number(((premiumDelta / premiumBefore) * 100).toFixed(2)) : 0;

    const earnedPremiumBefore = segments.reduce((sum, s) => sum + (s.earnedPremiumBefore ?? 0), 0);
    const earnedPremiumAfter = segments.reduce((sum, s) => sum + (s.earnedPremiumAfter ?? 0), 0);
    const totalReportedClaims = segments.reduce((sum, s) => sum + s.totalReportedClaims, 0);
    const expectedClaimsAfter = Number((totalReportedClaims * retention).toFixed(2));

    // weightedLossRatio* 必须基于「分子/分母同源」的可计算子集（codex P1 修复）：
    // 旧实现把 stop_underwriting 段 (premiumAfter=0) 的赔款混入分子，但分母只剩
    // 非停止段的 earnedPremiumAfter，导致总后赔付率被系统性放大，误导定价判断。
    // 现仅在「lossRatioAfter 可计算 且 earnedPremiumBefore 非空」的子集上同步聚合。
    const lossRatioBasisSegments = segments.filter(
      (s) => !s.lossRatioAfterUncomputable && s.earnedPremiumBefore !== null && s.earnedPremiumAfter !== null,
    );
    const weightedLossRatioBasisSegmentCount = lossRatioBasisSegments.length;
    const weightedLossRatioExcludedSegmentCount = segments.length - lossRatioBasisSegments.length;
    const basisEarnedPremiumBefore = lossRatioBasisSegments.reduce(
      (sum, s) => sum + (s.earnedPremiumBefore ?? 0),
      0,
    );
    const basisEarnedPremiumAfter = lossRatioBasisSegments.reduce(
      (sum, s) => sum + (s.earnedPremiumAfter ?? 0),
      0,
    );
    const basisReportedClaims = lossRatioBasisSegments.reduce((sum, s) => sum + s.totalReportedClaims, 0);
    const basisExpectedClaimsAfter = basisReportedClaims * retention;

    const weightedLossRatioBefore =
      weightedLossRatioBasisSegmentCount > 0 && basisEarnedPremiumBefore > 0
        ? Number(((basisReportedClaims / basisEarnedPremiumBefore) * 100).toFixed(2))
        : null;
    const weightedLossRatioAfter =
      weightedLossRatioBasisSegmentCount > 0 && basisEarnedPremiumAfter > 0
        ? Number(((basisExpectedClaimsAfter / basisEarnedPremiumAfter) * 100).toFixed(2))
        : null;

    const warnings: string[] = [];
    if (segments.length === 0) {
      warnings.push('上游 risk-scoring 未输出任何 scoredSegment，模拟跳过');
    }
    const uncomputable = segments.filter((s) => s.lossRatioAfterUncomputable).length;
    if (uncomputable > 0) {
      warnings.push(
        `${uncomputable} 个 segment 因 premiumAfter=0（停止承保）或 earnedPremiumBefore 为空，lossRatioAfter 不可计算`,
      );
    }
    if (weightedLossRatioExcludedSegmentCount > 0) {
      warnings.push(
        `weightedLossRatioBefore/After 仅基于 ${weightedLossRatioBasisSegmentCount} 个分子/分母同源的可计算分段；` +
          `${weightedLossRatioExcludedSegmentCount} 个分段（含停止承保 / earnedPremium 缺失）已从总体率聚合中排除，` +
          `避免分子分母不同源造成总体赔付率系统性放大`,
      );
    }
    if (retention !== 1.0) {
      warnings.push(
        `expectedClaimsRetention=${retention}（≠1.0），赔款总量被调整，结果偏离「赔款不变」假设`,
      );
    }

    return {
      result: {
        cutoffDate: input.scoring.cutoffDate,
        totalSegments: segments.length,
        segments,
        rateDeltaByRecommendation: rateDeltaMap,
        expectedClaimsRetention: retention,
        totals: {
          premiumBefore: Number(premiumBefore.toFixed(2)),
          premiumAfter: Number(premiumAfter.toFixed(2)),
          premiumDelta,
          premiumDeltaPct,
          earnedPremiumBefore: Number(earnedPremiumBefore.toFixed(2)),
          earnedPremiumAfter: Number(earnedPremiumAfter.toFixed(2)),
          totalReportedClaims: Number(totalReportedClaims.toFixed(2)),
          expectedClaimsAfter,
          weightedLossRatioBefore,
          weightedLossRatioAfter,
          weightedLossRatioBasisSegmentCount,
          weightedLossRatioExcludedSegmentCount,
        },
      },
      evidence: [
        {
          metric: 'premium_delta',
          value: premiumDelta,
          source: 'pricing-simulation',
          note: `Σ premiumAfter - Σ premiumBefore（基于 rateDeltaMap 模拟）`,
        },
        {
          metric: 'weighted_loss_ratio_before',
          value: weightedLossRatioBefore,
          source: 'metric-registry:earned_claim_ratio (重算)',
          note: `Σ reported_claims / Σ earned_premium × 100（口径一致），仅基于 ${weightedLossRatioBasisSegmentCount} 个可计算分段`,
        },
        {
          metric: 'weighted_loss_ratio_after',
          value: weightedLossRatioAfter,
          source: 'pricing-simulation',
          note:
            `Σ (reported_claims × retention) / Σ earned_premium_after × 100，retention=${retention}；` +
            `仅基于 ${weightedLossRatioBasisSegmentCount} 个可计算分段（${weightedLossRatioExcludedSegmentCount} 个排除）`,
        },
      ],
      confidence: segments.length === 0 ? 0.2 : 0.6, // 假设强 → confidence 不取 1.0
      warnings,
      assumptions: [
        `rateDeltaByRecommendation=${JSON.stringify(rateDeltaMap)}`,
        `expectedClaimsRetention=${retention}（赔款总量保持因子）`,
        `premiumAfter = premiumBefore × (1 + rateDelta)`,
        `earnedPremiumAfter = earnedPremiumBefore × (1 + rateDelta)（按比例缩放）`,
        `lossRatioAfter = (reportedClaims × retention) / earnedPremiumAfter × 100`,
        '客群结构 / 续保率 / 件均不变（红线 warning 已强制注入）',
      ],
      dataLineage: [
        'upstream:risk-scoring',
        'upstream:segment-risk-scan (via risk-scoring)',
        'metric-registry:earned_claim_ratio (口径一致：分子赔款 / 分母满期保费)',
        'red-line-policy:pricing-simulation',
      ],
      nextSuggestedSkills: [],
    };
  },
};
