/**
 * risk-scoring 单元测试 — 阶段 4 PR-A
 *
 * 纯函数 + skill.run 全程不发起 SQL，因此无需 mock duckdb。
 */

import { describe, it, expect, vi } from 'vitest';

// risk-scoring 不发起 SQL，但传递依赖会拉到 duckdb 服务（segment-risk-scan.skill.ts → query-adapter）。
// 单元测试环境无 .node 二进制，hoist 一个轻量 mock 与 skill-schemas.test.ts 保持一致。
vi.mock('../../services/duckdb.js', () => ({
  duckdbService: {
    query: async () => [],
    cacheSize: 0,
  },
}));

const { riskScoringSkill, computeComponents, combineScore, classifyRecommendation } = await import(
  '../skills/risk-scoring.skill.js'
);
type SkillContext = import('../types.js').SkillContext;

const baseCtx: SkillContext = {
  userId: 'u1',
  username: 'admin',
  role: 'branch_admin',
  permissionFilter: '1=1',
  requestId: 'req-1',
  startedAt: Date.now(),
  now: new Date('2026-04-26T00:00:00Z'),
};

const sampleSegment = (override: Partial<{
  dimKey: string;
  totalPremium: number;
  earnedPremium: number | null;
  totalReportedClaims: number;
  rawEarnedClaimRatio: number | null;
  adjustedEarnedClaimRatio: number | null;
  credibility: number;
  policyCount: number;
  riskLevel: 'red' | 'yellow' | 'green';
}> = {}) => ({
  dimKey: override.dimKey ?? '营业货车 | 成都',
  dimValues: { customer_category: '营业货车', org_level_3: '成都' },
  policyCount: override.policyCount ?? 1000,
  totalPremium: override.totalPremium ?? 5_000_000,
  earnedPremium: override.earnedPremium ?? 4_000_000,
  totalReportedClaims: override.totalReportedClaims ?? 3_000_000,
  rawEarnedClaimRatio: override.rawEarnedClaimRatio ?? 75,
  credibility: override.credibility ?? 0.77,
  adjustedEarnedClaimRatio: override.adjustedEarnedClaimRatio ?? 70,
  riskLevel: override.riskLevel ?? 'red',
});

const sampleScan = (segments: ReturnType<typeof sampleSegment>[]) => ({
  dimensions: ['customer_category', 'org_level_3'] as ['customer_category', 'org_level_3'],
  cutoffDate: '2026-04-26',
  baselineEarnedClaimRatio: 55,
  totalSegments: segments.length,
  segments,
  topRiskSegments: segments.filter((s) => s.riskLevel === 'red'),
  redCount: segments.filter((s) => s.riskLevel === 'red').length,
  yellowCount: segments.filter((s) => s.riskLevel === 'yellow').length,
  greenCount: segments.filter((s) => s.riskLevel === 'green').length,
});

describe('computeComponents', () => {
  it('lossRatioComponent = adjusted/2，200% 截断', () => {
    const c = computeComponents(sampleSegment({ adjustedEarnedClaimRatio: 100 }), 10_000_000);
    expect(c.lossRatioComponent).toBe(50);

    const cap = computeComponents(sampleSegment({ adjustedEarnedClaimRatio: 250 }), 10_000_000);
    expect(cap.lossRatioComponent).toBe(100);

    const neg = computeComponents(sampleSegment({ adjustedEarnedClaimRatio: -10 }), 10_000_000);
    expect(neg.lossRatioComponent).toBe(0);
  });

  it('credibilityComponent = credibility × 100，clamp 到 [0, 100]', () => {
    expect(computeComponents(sampleSegment({ credibility: 0.5 }), 10_000_000).credibilityComponent).toBe(50);
    expect(computeComponents(sampleSegment({ credibility: 0 }), 10_000_000).credibilityComponent).toBe(0);
    expect(computeComponents(sampleSegment({ credibility: 1 }), 10_000_000).credibilityComponent).toBe(100);
  });

  it('concentrationComponent = premiumShare × 500，clamp 100；share=20% 即满分', () => {
    const c = computeComponents(sampleSegment({ totalPremium: 2_000_000 }), 10_000_000);
    expect(c.premiumShare).toBe(0.2);
    expect(c.concentrationComponent).toBe(100);

    const small = computeComponents(sampleSegment({ totalPremium: 100_000 }), 10_000_000);
    expect(small.premiumShare).toBe(0.01);
    expect(small.concentrationComponent).toBe(5);
  });

  it('totalPremiumSum=0 时 premiumShare=0', () => {
    const c = computeComponents(sampleSegment({ totalPremium: 0 }), 0);
    expect(c.premiumShare).toBe(0);
    expect(c.concentrationComponent).toBe(0);
  });
});

describe('combineScore', () => {
  it('weights 全为 0 时返回 0', () => {
    const score = combineScore(
      { lossRatioComponent: 100, credibilityComponent: 100, concentrationComponent: 100 },
      { lossRatio: 0, credibility: 0, concentration: 0 },
    );
    expect(score).toBe(0);
  });

  it('归一化：weights 之和 ≠ 1 不影响结果（按比例归一）', () => {
    const scoreA = combineScore(
      { lossRatioComponent: 100, credibilityComponent: 0, concentrationComponent: 0 },
      { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
    );
    const scoreB = combineScore(
      { lossRatioComponent: 100, credibilityComponent: 0, concentrationComponent: 0 },
      { lossRatio: 7, credibility: 1.5, concentration: 1.5 },
    );
    expect(scoreA).toBe(scoreB);
  });

  it('全 100 → 100', () => {
    const score = combineScore(
      { lossRatioComponent: 100, credibilityComponent: 100, concentrationComponent: 100 },
      { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
    );
    expect(score).toBe(100);
  });
});

describe('classifyRecommendation', () => {
  const cfg = {
    weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
    thresholds: { stop: 80, raise: 60, monitor: 40 },
    credibilityFloor: 0.3,
  };

  it('档位边界严格匹配', () => {
    expect(classifyRecommendation(80, 0.8, cfg).recommendation).toBe('stop_underwriting');
    expect(classifyRecommendation(79, 0.8, cfg).recommendation).toBe('raise_rate');
    expect(classifyRecommendation(60, 0.8, cfg).recommendation).toBe('raise_rate');
    expect(classifyRecommendation(59, 0.8, cfg).recommendation).toBe('monitor');
    expect(classifyRecommendation(40, 0.8, cfg).recommendation).toBe('monitor');
    expect(classifyRecommendation(39, 0.8, cfg).recommendation).toBe('ok');
  });

  it('credibility < floor → 推荐档位下调一级', () => {
    const r = classifyRecommendation(85, 0.2, cfg);
    expect(r.recommendation).toBe('raise_rate');
    expect(r.downgraded).toBe(true);

    const r2 = classifyRecommendation(45, 0.2, cfg);
    expect(r2.recommendation).toBe('ok');
    expect(r2.downgraded).toBe(true);
  });

  it('credibility < floor 且原档位 ok → 不再降档', () => {
    const r = classifyRecommendation(20, 0.1, cfg);
    expect(r.recommendation).toBe('ok');
    expect(r.downgraded).toBe(false);
  });
});

describe('riskScoringSkill.run', () => {
  it('空 segment 列表 → confidence=0.2 + warning', async () => {
    const { result } = (await riskScoringSkill.run(
      { scan: sampleScan([]), weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 }, thresholds: { stop: 80, raise: 60, monitor: 40 }, credibilityFloor: 0.3 },
      baseCtx,
    )) as any;
    expect(result.totalScored).toBe(0);
    expect(result.summary.stopCount).toBe(0);
  });

  it('高赔付 + 高 credibility → stop_underwriting', async () => {
    const seg = sampleSegment({
      adjustedEarnedClaimRatio: 180,
      credibility: 0.9,
      totalPremium: 5_000_000,
    });
    const out = (await riskScoringSkill.run(
      {
        scan: sampleScan([seg]),
        weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
        thresholds: { stop: 80, raise: 60, monitor: 40 },
        credibilityFloor: 0.3,
      },
      baseCtx,
    )) as any;
    expect(out.result.scoredSegments[0].recommendation).toBe('stop_underwriting');
    expect(out.result.summary.stopCount).toBe(1);
    expect(out.nextSuggestedSkills).toContain('pricing-simulation');
  });

  it('低赔付 → ok 不会建议 pricing-simulation', async () => {
    const seg = sampleSegment({ adjustedEarnedClaimRatio: 30, credibility: 0.9, riskLevel: 'green' });
    const out = (await riskScoringSkill.run(
      {
        scan: sampleScan([seg]),
        weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
        thresholds: { stop: 80, raise: 60, monitor: 40 },
        credibilityFloor: 0.3,
      },
      baseCtx,
    )) as any;
    expect(out.result.summary.okCount).toBe(1);
    expect(out.nextSuggestedSkills).toEqual([]);
  });

  it('credibility 降档 warning 准确', async () => {
    const seg = sampleSegment({ adjustedEarnedClaimRatio: 180, credibility: 0.1 });
    const out = (await riskScoringSkill.run(
      {
        scan: sampleScan([seg]),
        weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
        thresholds: { stop: 80, raise: 60, monitor: 40 },
        credibilityFloor: 0.3,
      },
      baseCtx,
    )) as any;
    expect(out.result.summary.credibilityDowngradedCount).toBe(1);
    expect(out.warnings.some((w: string) => w.includes('credibility'))).toBe(true);
  });
});

describe('riskScoringSkill 元数据', () => {
  it('deterministic=true，requiresApproval=true', () => {
    expect(riskScoringSkill.deterministic).toBe(true);
    expect(riskScoringSkill.requiresApproval).toBe(true);
  });

  it('id 与 red-line-policy 登记一致', () => {
    expect(riskScoringSkill.id).toBe('risk-scoring');
  });
});
