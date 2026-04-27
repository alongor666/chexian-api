/**
 * pricing-simulation 单元测试 — 阶段 4 PR-A
 *
 * 全程纯函数，无 SQL，无 LLM，无 DB mock。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/duckdb.js', () => ({
  duckdbService: {
    query: async () => [],
    cacheSize: 0,
  },
}));

const { pricingSimulationSkill, simulateSegment } = await import('../skills/pricing-simulation.skill.js');
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

const sampleScored = (override: Partial<{
  recommendation: 'stop_underwriting' | 'raise_rate' | 'monitor' | 'ok';
  totalPremium: number;
  earnedPremium: number | null;
  totalReportedClaims: number;
  adjustedEarnedClaimRatio: number | null;
  riskScore: number;
  credibility: number;
}> = {}) => ({
  dimKey: '营业货车 | 成都',
  dimValues: { customer_category: '营业货车', org_level_3: '成都' },
  policyCount: 1000,
  totalPremium: override.totalPremium ?? 5_000_000,
  earnedPremium: override.earnedPremium ?? 4_000_000,
  totalReportedClaims: override.totalReportedClaims ?? 3_000_000,
  rawEarnedClaimRatio: 75,
  adjustedEarnedClaimRatio: override.adjustedEarnedClaimRatio ?? 75,
  credibility: override.credibility ?? 0.8,
  premiumShare: 0.5,
  components: { lossRatioComponent: 38, credibilityComponent: 80, concentrationComponent: 100 },
  riskScore: override.riskScore ?? 70,
  recommendation: override.recommendation ?? 'raise_rate',
  credibilityDowngraded: false,
});

const sampleScoring = (segments: ReturnType<typeof sampleScored>[]) => ({
  cutoffDate: '2026-04-26',
  totalScored: segments.length,
  scoredSegments: segments,
  topActionRequired: segments.filter((s) => s.recommendation !== 'ok'),
  summary: {
    stopCount: segments.filter((s) => s.recommendation === 'stop_underwriting').length,
    raiseCount: segments.filter((s) => s.recommendation === 'raise_rate').length,
    monitorCount: segments.filter((s) => s.recommendation === 'monitor').length,
    okCount: segments.filter((s) => s.recommendation === 'ok').length,
    credibilityDowngradedCount: 0,
  },
  weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
  thresholds: { stop: 80, raise: 60, monitor: 40 },
});

describe('simulateSegment', () => {
  it('+20% 涨费：premiumAfter / lossRatioAfter 重算正确', () => {
    const out = simulateSegment(
      {
        dimKey: 'k',
        dimValues: {},
        recommendation: 'raise_rate',
        riskScore: 70,
        policyCount: 100,
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
        adjustedEarnedClaimRatio: 75,
      },
      0.2,
      1.0,
    );
    expect(out.premiumAfter).toBe(1200);
    expect(out.premiumDelta).toBe(200);
    expect(out.premiumDeltaPct).toBe(20);
    expect(out.earnedPremiumAfter).toBe(960);
    // 600 / 960 × 100 = 62.5
    expect(out.lossRatioAfter).toBe(62.5);
    expect(out.lossRatioAfterUncomputable).toBe(false);
  });

  it('rateDelta=-1（停止承保）：premiumAfter=0，lossRatioAfter 不可计算', () => {
    const out = simulateSegment(
      {
        dimKey: 'k',
        dimValues: {},
        recommendation: 'stop_underwriting',
        riskScore: 95,
        policyCount: 100,
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
        adjustedEarnedClaimRatio: 75,
      },
      -1.0,
      1.0,
    );
    expect(out.premiumAfter).toBe(0);
    expect(out.earnedPremiumAfter).toBe(0);
    expect(out.lossRatioAfter).toBeNull();
    expect(out.lossRatioAfterUncomputable).toBe(true);
  });

  it('earnedPremium=null 透传，lossRatioAfter 不可计算', () => {
    const out = simulateSegment(
      {
        dimKey: 'k',
        dimValues: {},
        recommendation: 'monitor',
        riskScore: 45,
        policyCount: 100,
        totalPremium: 1000,
        earnedPremium: null,
        totalReportedClaims: 0,
        adjustedEarnedClaimRatio: null,
      },
      0.05,
      1.0,
    );
    expect(out.earnedPremiumBefore).toBeNull();
    expect(out.earnedPremiumAfter).toBeNull();
    expect(out.lossRatioAfterUncomputable).toBe(true);
  });

  it('expectedClaimsRetention=0.9 → expectedClaimsAfter 缩放', () => {
    const out = simulateSegment(
      {
        dimKey: 'k',
        dimValues: {},
        recommendation: 'raise_rate',
        riskScore: 70,
        policyCount: 100,
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
        adjustedEarnedClaimRatio: 75,
      },
      0.2,
      0.9,
    );
    expect(out.expectedClaimsAfter).toBe(540);
    // 540 / 960 × 100 = 56.25
    expect(out.lossRatioAfter).toBe(56.25);
  });
});

describe('pricingSimulationSkill.run', () => {
  it('空 segment → confidence=0.2 + 0 totals', async () => {
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring([]),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 1.0,
      },
      baseCtx,
    )) as any;
    expect(out.result.totalSegments).toBe(0);
    expect(out.result.totals.premiumBefore).toBe(0);
    expect(out.confidence).toBe(0.2);
  });

  it('weighted lossRatio 重算（绝对值聚合，禁止平均率）', async () => {
    const segs = [
      sampleScored({
        recommendation: 'raise_rate',
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
      }),
      sampleScored({
        recommendation: 'monitor',
        totalPremium: 500,
        earnedPremium: 400,
        totalReportedClaims: 100,
      }),
    ];
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring(segs),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 1.0,
      },
      baseCtx,
    )) as any;
    // before: (600+100)/(800+400) × 100 = 58.33
    expect(out.result.totals.weightedLossRatioBefore).toBeCloseTo(58.33, 1);
    // after: (600+100)/(800×1.2 + 400×1.05) × 100 = 700/1380 × 100 ≈ 50.72
    expect(out.result.totals.weightedLossRatioAfter).toBeCloseTo(50.72, 1);
    expect(out.result.totals.weightedLossRatioBasisSegmentCount).toBe(2);
    expect(out.result.totals.weightedLossRatioExcludedSegmentCount).toBe(0);
  });

  it('混合停止承保段时只在可计算分段上聚合 weighted lossRatio（codex P1 回归）', async () => {
    // 旧实现 bug: 把 stop 段的赔款 600 算进分子，但分母只剩 monitor 段的 420，
    // 导致 weightedLossRatioAfter ≈ (600+100) / (0+420) × 100 ≈ 166.67（虚高）
    // 修复后只对可计算分段聚合：两段都被排除/保留必须同进同出
    const segs = [
      sampleScored({
        recommendation: 'stop_underwriting',
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
      }),
      sampleScored({
        recommendation: 'monitor',
        totalPremium: 500,
        earnedPremium: 400,
        totalReportedClaims: 100,
      }),
    ];
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring(segs),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 1.0,
      },
      baseCtx,
    )) as any;
    // 只剩 monitor 段（stop 段 lossRatioAfterUncomputable=true 被排除）
    // before: 100 / 400 × 100 = 25
    // after:  100 / (400×1.05) × 100 = 100/420 × 100 ≈ 23.81
    expect(out.result.totals.weightedLossRatioBefore).toBeCloseTo(25, 1);
    expect(out.result.totals.weightedLossRatioAfter).toBeCloseTo(23.81, 1);
    expect(out.result.totals.weightedLossRatioBasisSegmentCount).toBe(1);
    expect(out.result.totals.weightedLossRatioExcludedSegmentCount).toBe(1);
    // 总量字段仍包含全部分段（stop=1000×0=0 + monitor=500×1.05=525）
    expect(out.result.totals.premiumBefore).toBe(1500);
    expect(out.result.totals.premiumAfter).toBe(525);
    // 显式 warning
    expect(out.warnings.some((w: string) => w.includes('系统性放大'))).toBe(true);
  });

  it('全部分段不可计算时 weightedLossRatio* 为 null', async () => {
    const segs = [
      sampleScored({
        recommendation: 'stop_underwriting',
        totalPremium: 1000,
        earnedPremium: 800,
        totalReportedClaims: 600,
      }),
    ];
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring(segs),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 1.0,
      },
      baseCtx,
    )) as any;
    expect(out.result.totals.weightedLossRatioBefore).toBeNull();
    expect(out.result.totals.weightedLossRatioAfter).toBeNull();
    expect(out.result.totals.weightedLossRatioBasisSegmentCount).toBe(0);
    expect(out.result.totals.weightedLossRatioExcludedSegmentCount).toBe(1);
  });

  it('confidence=0.6（强假设 → 不取 1.0）', async () => {
    const segs = [sampleScored({ recommendation: 'monitor' })];
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring(segs),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 1.0,
      },
      baseCtx,
    )) as any;
    expect(out.confidence).toBe(0.6);
  });

  it('expectedClaimsRetention !== 1.0 → 显式 warning', async () => {
    const segs = [sampleScored({ recommendation: 'raise_rate' })];
    const out = (await pricingSimulationSkill.run(
      {
        scoring: sampleScoring(segs),
        rateDeltaByRecommendation: {
          stop_underwriting: -1.0,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0.0,
        },
        expectedClaimsRetention: 0.9,
      },
      baseCtx,
    )) as any;
    expect(out.warnings.some((w: string) => w.includes('expectedClaimsRetention=0.9'))).toBe(true);
  });
});

describe('pricingSimulationSkill 元数据', () => {
  it('deterministic=true，requiresApproval=true', () => {
    expect(pricingSimulationSkill.deterministic).toBe(true);
    expect(pricingSimulationSkill.requiresApproval).toBe(true);
  });

  it('id 与 red-line-policy 登记一致', () => {
    expect(pricingSimulationSkill.id).toBe('pricing-simulation');
  });
});
