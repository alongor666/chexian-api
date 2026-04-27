/**
 * risk-scoring Skill — 阶段 4 PR-A
 *
 * 把 segment-risk-scan 的输出结果（每个维度交叉的 raw + adjusted 赔付率 + credibility）
 * 转换为「可决策」的复合风险评分 + 推荐档位（stop / raise / monitor / ok）。
 *
 * 设计原则（与 CLAUDE.md §0 / §10 / .claude/rules/sql-generators.md 对齐）：
 * - **纯确定性**：不调用 LLM，不发起 SQL。只对 segment-risk-scan 输出做内存计算
 * - **复用上游公式**：rawEarnedClaimRatio / adjustedEarnedClaimRatio / credibility 全部直接读取，
 *   不重写任何赔付率公式。上游已 100% 复用 metric-registry:earned_claim_ratio
 * - **要求审批**：requiresApproval=true。本评分仅作为分析参考，不直接驱动核保动作（红线已登记）
 * - **输入只接 segment-risk-scan 输出**：禁止接受 LLM 生成的 segment 列表，避免幻觉污染口径
 *
 * 红线：red-line-policy.ts:22-24 已预登记
 *   "本评分基于规则模型，未经精算建模与业务字典确认"
 * runner 会在末尾自动注入。
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import {
  SegmentRiskScanResultSchema,
  SegmentRiskScanSegmentSchema,
} from './segment-risk-scan.skill.js';

// ──────────────────────────────────────────────────────────────────────────
// 输入：segment-risk-scan 的 result + 评分参数
// ──────────────────────────────────────────────────────────────────────────

const RecommendationSchema = z.enum(['stop_underwriting', 'raise_rate', 'monitor', 'ok']);
type Recommendation = z.infer<typeof RecommendationSchema>;

/** 复合评分权重，三项之和不强制为 1（计算时归一化） */
const WeightsSchema = z.object({
  /** 满期赔付率权重（推荐占主导） */
  lossRatio: z.number().min(0).max(1).default(0.7),
  /** credibility 权重（数据可信度） */
  credibility: z.number().min(0).max(1).default(0.15),
  /** 保费集中度权重（大 segment 优先处理） */
  concentration: z.number().min(0).max(1).default(0.15),
});

const DEFAULT_WEIGHTS = { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 } as const;

const RecommendationThresholdsSchema = z
  .object({
    /** score ≥ 此值 → stop_underwriting，默认 80 */
    stop: z.number().min(0).max(100).default(80),
    /** score ≥ 此值 → raise_rate，默认 60 */
    raise: z.number().min(0).max(100).default(60),
    /** score ≥ 此值 → monitor，默认 40 */
    monitor: z.number().min(0).max(100).default(40),
  })
  .refine((t) => t.stop > t.raise && t.raise > t.monitor, {
    message: 'thresholds 必须严格递减：stop > raise > monitor',
  });

const DEFAULT_THRESHOLDS = { stop: 80, raise: 60, monitor: 40 } as const;

const InputSchema = z.object({
  /** 来自 segment-risk-scan 的 result 字段（workflow 自动透传） */
  scan: SegmentRiskScanResultSchema,
  /** 显式重申 period（用于审计 / 报告头），与 scan.cutoffDate 不必一致但建议一致 */
  period: PeriodSchema.optional(),
  // 注意：嵌套 object 的 .default({}) 在 zod 4 不会向内传递默认值。
  // 必须显式给完整对象，下游通过 .parse 时仍会单独校验各字段范围。
  weights: WeightsSchema.default(DEFAULT_WEIGHTS),
  thresholds: RecommendationThresholdsSchema.default(DEFAULT_THRESHOLDS),
  /**
   * credibility 下限：低于此值的 segment 推荐档位会被强制下调 1 级
   * （避免对小样本下达「停止承保」的激进建议）。默认 0.3
   */
  credibilityFloor: z.number().min(0).max(1).default(0.3),
});

// ──────────────────────────────────────────────────────────────────────────
// 输出
// ──────────────────────────────────────────────────────────────────────────

const ScoredSegmentSchema = z.object({
  dimKey: z.string(),
  dimValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  policyCount: z.number(),
  totalPremium: z.number(),
  earnedPremium: z.number().nullable(),
  totalReportedClaims: z.number(),
  rawEarnedClaimRatio: z.number().nullable(),
  adjustedEarnedClaimRatio: z.number().nullable(),
  credibility: z.number(),
  premiumShare: z.number(),
  components: z.object({
    lossRatioComponent: z.number(),
    credibilityComponent: z.number(),
    concentrationComponent: z.number(),
  }),
  riskScore: z.number().min(0).max(100),
  recommendation: RecommendationSchema,
  /** 是否因 credibility < floor 被降档 */
  credibilityDowngraded: z.boolean(),
});

type ScoredSegment = z.infer<typeof ScoredSegmentSchema>;

export const RiskScoringResultSchema = z.object({
  cutoffDate: z.string(),
  totalScored: z.number(),
  scoredSegments: z.array(ScoredSegmentSchema),
  topActionRequired: z.array(ScoredSegmentSchema),
  summary: z.object({
    stopCount: z.number(),
    raiseCount: z.number(),
    monitorCount: z.number(),
    okCount: z.number(),
    credibilityDowngradedCount: z.number(),
  }),
  weights: WeightsSchema,
  thresholds: RecommendationThresholdsSchema,
});

type Result = z.infer<typeof RiskScoringResultSchema>;
type Segment = z.infer<typeof SegmentRiskScanSegmentSchema>;

// ──────────────────────────────────────────────────────────────────────────
// 评分核心逻辑（纯函数，便于单元测试）
// ──────────────────────────────────────────────────────────────────────────

interface ScoringConfig {
  weights: z.infer<typeof WeightsSchema>;
  thresholds: z.infer<typeof RecommendationThresholdsSchema>;
  credibilityFloor: number;
}

/**
 * 把单个 segment 的三组件原始值映射到 0-100 量表
 *
 * - lossRatioComponent: adjustedEarnedClaimRatio 直接映射（200% 截断 → 100 分），等同 ratio/2
 *   选择"线性 + 截断"而非对数：高赔付段（200%+）已是核保红线，不需要更高分辨率
 * - credibilityComponent: credibility × 100，反映信号强度（不是「越大越坏」，而是 weight 已由
 *   InputSchema.weights 控制，组件值仅做归一化）
 * - concentrationComponent: premiumShare × 5 截断到 100（即 share=20% → 100），优先级提示
 *
 * 三组件加权和 = score（已归一化到 0-100）
 */
export function computeComponents(
  seg: Segment,
  totalPremiumSum: number,
): { lossRatioComponent: number; credibilityComponent: number; concentrationComponent: number; premiumShare: number } {
  const adjusted = seg.adjustedEarnedClaimRatio ?? 0;
  const lossRatioComponent = Math.min(Math.max(adjusted, 0), 200) / 2;

  const credibilityComponent = Math.min(Math.max(seg.credibility, 0), 1) * 100;

  const premiumShare = totalPremiumSum > 0 ? seg.totalPremium / totalPremiumSum : 0;
  const concentrationComponent = Math.min(Math.max(premiumShare * 100 * 5, 0), 100);

  return {
    lossRatioComponent: Number(lossRatioComponent.toFixed(2)),
    credibilityComponent: Number(credibilityComponent.toFixed(2)),
    concentrationComponent: Number(concentrationComponent.toFixed(2)),
    premiumShare: Number(premiumShare.toFixed(4)),
  };
}

export function combineScore(
  components: { lossRatioComponent: number; credibilityComponent: number; concentrationComponent: number },
  weights: z.infer<typeof WeightsSchema>,
): number {
  const sumW = weights.lossRatio + weights.credibility + weights.concentration;
  if (sumW <= 0) return 0;
  const weighted =
    weights.lossRatio * components.lossRatioComponent +
    weights.credibility * components.credibilityComponent +
    weights.concentration * components.concentrationComponent;
  return Math.round(weighted / sumW);
}

export function classifyRecommendation(
  score: number,
  credibility: number,
  cfg: ScoringConfig,
): { recommendation: Recommendation; downgraded: boolean } {
  let raw: Recommendation;
  if (score >= cfg.thresholds.stop) raw = 'stop_underwriting';
  else if (score >= cfg.thresholds.raise) raw = 'raise_rate';
  else if (score >= cfg.thresholds.monitor) raw = 'monitor';
  else raw = 'ok';

  // credibility 太低 → 降档一级（小样本不下达激进建议）
  if (credibility < cfg.credibilityFloor && raw !== 'ok') {
    const TIER_ORDER: Recommendation[] = ['ok', 'monitor', 'raise_rate', 'stop_underwriting'];
    const idx = TIER_ORDER.indexOf(raw);
    const downgradedTier = TIER_ORDER[Math.max(idx - 1, 0)];
    return { recommendation: downgradedTier, downgraded: true };
  }
  return { recommendation: raw, downgraded: false };
}

// ──────────────────────────────────────────────────────────────────────────
// Skill
// ──────────────────────────────────────────────────────────────────────────

export const riskScoringSkill: Skill<typeof InputSchema, Result> = {
  id: 'risk-scoring',
  name: '风险评分',
  version: '1.0.0',
  description:
    '基于 segment-risk-scan 输出的 adjustedEarnedClaimRatio + credibility + premiumShare，' +
    '计算复合风险评分并给出推荐档位（stop_underwriting / raise_rate / monitor / ok）。' +
    '纯确定性内存计算，不调用 LLM/SQL。',
  inputSchema: InputSchema,
  outputResultSchema: RiskScoringResultSchema,
  deterministic: true,
  requiresApproval: true,
  async run(input, ctx) {
    const cfg: ScoringConfig = {
      weights: input.weights,
      thresholds: input.thresholds,
      credibilityFloor: input.credibilityFloor,
    };

    const segments = input.scan.segments;
    const totalPremiumSum = segments.reduce((sum, s) => sum + (s.totalPremium ?? 0), 0);

    const scoredSegments: ScoredSegment[] = segments.map((seg) => {
      const components = computeComponents(seg, totalPremiumSum);
      const score = combineScore(
        {
          lossRatioComponent: components.lossRatioComponent,
          credibilityComponent: components.credibilityComponent,
          concentrationComponent: components.concentrationComponent,
        },
        input.weights,
      );
      const { recommendation, downgraded } = classifyRecommendation(score, seg.credibility, cfg);

      return {
        dimKey: seg.dimKey,
        dimValues: seg.dimValues,
        policyCount: seg.policyCount,
        totalPremium: seg.totalPremium,
        earnedPremium: seg.earnedPremium,
        totalReportedClaims: seg.totalReportedClaims,
        rawEarnedClaimRatio: seg.rawEarnedClaimRatio,
        adjustedEarnedClaimRatio: seg.adjustedEarnedClaimRatio,
        credibility: seg.credibility,
        premiumShare: components.premiumShare,
        components: {
          lossRatioComponent: components.lossRatioComponent,
          credibilityComponent: components.credibilityComponent,
          concentrationComponent: components.concentrationComponent,
        },
        riskScore: score,
        recommendation,
        credibilityDowngraded: downgraded,
      };
    });

    // 排序：score 降序，再按 totalPremium 降序
    const sorted = [...scoredSegments].sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return b.totalPremium - a.totalPremium;
    });

    const stopCount = sorted.filter((s) => s.recommendation === 'stop_underwriting').length;
    const raiseCount = sorted.filter((s) => s.recommendation === 'raise_rate').length;
    const monitorCount = sorted.filter((s) => s.recommendation === 'monitor').length;
    const okCount = sorted.filter((s) => s.recommendation === 'ok').length;
    const credibilityDowngradedCount = sorted.filter((s) => s.credibilityDowngraded).length;

    const topActionRequired = sorted.filter((s) => s.recommendation !== 'ok');

    const warnings: string[] = [];
    if (segments.length === 0) {
      warnings.push('上游 segment-risk-scan 未输出任何 segment，评分跳过');
    }
    if (credibilityDowngradedCount > 0) {
      warnings.push(
        `${credibilityDowngradedCount} 个 segment 因 credibility < ${input.credibilityFloor} 被强制降档（小样本噪音抑制）`,
      );
    }
    if (input.weights.lossRatio + input.weights.credibility + input.weights.concentration === 0) {
      warnings.push('weights 全为 0，所有 score 输出为 0；请检查权重配置');
    }

    return {
      result: {
        cutoffDate: input.scan.cutoffDate,
        totalScored: sorted.length,
        scoredSegments: sorted,
        topActionRequired,
        summary: { stopCount, raiseCount, monitorCount, okCount, credibilityDowngradedCount },
        weights: input.weights,
        thresholds: input.thresholds,
      },
      evidence: [
        {
          metric: 'baseline_earned_claim_ratio',
          value: input.scan.baselineEarnedClaimRatio,
          source: 'segment-risk-scan.scan.baselineEarnedClaimRatio',
          note: '上游 segment-risk-scan 已用 metric-registry:earned_claim_ratio 加权重算',
        },
        {
          metric: 'top_action_count',
          value: topActionRequired.length,
          source: 'risk-scoring',
          note: `推荐档位 != 'ok' 的 segment 数量（含降档后）`,
        },
        {
          metric: 'stop_underwriting_count',
          value: stopCount,
          source: 'risk-scoring',
          note: `score ≥ ${input.thresholds.stop}（默认 80）且 credibility ≥ ${input.credibilityFloor}`,
        },
      ],
      confidence: segments.length === 0 ? 0.2 : 1.0,
      warnings,
      assumptions: [
        `lossRatioComponent = min(adjustedEarnedClaimRatio, 200) / 2（线性，200% 截断）`,
        `credibilityComponent = credibility × 100`,
        `concentrationComponent = min(premiumShare × 500, 100)（share=20% 即满分）`,
        `score = (Σ wᵢ × componentᵢ) / Σ wᵢ，weights=${JSON.stringify(input.weights)}`,
        `档位阈值 stop/raise/monitor=${input.thresholds.stop}/${input.thresholds.raise}/${input.thresholds.monitor}`,
        `credibility < ${input.credibilityFloor} 的 segment 推荐档位强制下调 1 级`,
        `行级过滤上游已生效：${ctx.permissionFilter}`,
      ],
      dataLineage: [
        'upstream:segment-risk-scan',
        'metric-registry:earned_claim_ratio (via segment-risk-scan)',
        'metric-registry:earned_premium (via segment-risk-scan)',
        'red-line-policy:risk-scoring',
      ],
      nextSuggestedSkills: topActionRequired.length > 0 ? ['pricing-simulation'] : [],
    };
  },
};
