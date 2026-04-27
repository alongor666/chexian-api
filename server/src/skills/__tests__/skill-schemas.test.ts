/**
 * Skill 输入 schema 边界测试 — 阶段 2
 *
 * 不触碰 SQL 执行，仅验证 inputSchema 的接受/拒绝行为，捕获 zod 升级或 schema 调整带来的回归。
 */

import { describe, it, expect, vi } from 'vitest';

// Skill 文件顶层会 import duckdb 服务（@duckdb/node-api 原生模块），
// 单元测试环境下未加载原生 .node 二进制，需 hoist 一个轻量 mock。
vi.mock('../../services/duckdb.js', () => ({
  duckdbService: {
    query: async () => [],
    cacheSize: 0,
  },
}));

const { costDiagnosisSkill } = await import('../skills/cost-diagnosis.skill.js');
const { claimsDrilldownSkill } = await import('../skills/claims-drilldown.skill.js');
const { segmentRiskScanSkill } = await import('../skills/segment-risk-scan.skill.js');
const { riskScoringSkill } = await import('../skills/risk-scoring.skill.js');
const { pricingSimulationSkill } = await import('../skills/pricing-simulation.skill.js');
const { autoRiskControlWorkflow } = await import('../workflows/auto-risk-control.workflow.js');
const { listRedLineSkillIds, RED_LINE_WARNINGS } = await import('../red-line-policy.js');
const { listSkills } = await import('../registry.js');

describe('cost-diagnosis schema', () => {
  it('接受最小合法输入', () => {
    const out = costDiagnosisSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.dimension).toBe('customer_category');
      expect(out.data.redThreshold).toBe(70);
      expect(out.data.minPolicyCount).toBe(30);
    }
  });

  it('拒绝非法日期格式', () => {
    const out = costDiagnosisSkill.inputSchema.safeParse({
      period: { startDate: '2026/04/01', endDate: '2026-04-26' },
    });
    expect(out.success).toBe(false);
  });

  it('拒绝白名单外的 dimension', () => {
    const out = costDiagnosisSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
      dimension: 'plate_no',
    });
    expect(out.success).toBe(false);
  });
});

describe('claims-drilldown schema', () => {
  it('接受最小合法输入', () => {
    const out = claimsDrilldownSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.topOrgN).toBe(5);
      expect(out.data.topCauseN).toBe(5);
    }
  });

  it('支持 customerCategories / coverageCombinations 数组', () => {
    const out = claimsDrilldownSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
      customerCategories: ['营业货车'],
      coverageCombinations: ['主全'],
    });
    expect(out.success).toBe(true);
  });
});

describe('segment-risk-scan schema', () => {
  it('默认 2 维交叉', () => {
    const out = segmentRiskScanSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.dimensions).toEqual(['customer_category', 'org_level_3']);
      expect(out.data.credibilityK).toBe(300);
    }
  });

  it('拒绝非白名单维度（如 plate_no）', () => {
    const out = segmentRiskScanSkill.inputSchema.safeParse({
      period: { startDate: '2026-04-01', endDate: '2026-04-26' },
      dimensions: ['plate_no'],
    });
    expect(out.success).toBe(false);
  });

  it('接受 4 个白名单维度均合法', () => {
    const dims = ['customer_category', 'org_level_3', 'is_nev', 'tonnage_segment'];
    for (const d of dims) {
      const out = segmentRiskScanSkill.inputSchema.safeParse({
        period: { startDate: '2026-04-01', endDate: '2026-04-26' },
        dimensions: [d],
      });
      expect(out.success).toBe(true);
    }
  });

  it('credibilityK 边界：>=1, <=10000', () => {
    expect(
      segmentRiskScanSkill.inputSchema.safeParse({
        period: { startDate: '2026-04-01', endDate: '2026-04-26' },
        credibilityK: 0,
      }).success
    ).toBe(false);
    expect(
      segmentRiskScanSkill.inputSchema.safeParse({
        period: { startDate: '2026-04-01', endDate: '2026-04-26' },
        credibilityK: 10001,
      }).success
    ).toBe(false);
  });
});

describe('auto-risk-control workflow shape', () => {
  it('节点 ID 唯一', () => {
    const ids = autoRiskControlWorkflow.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('阶段 4 PR-B：8 节点流（5 步前置 + risk-scoring + approval + pricing-simulation）', () => {
    const ids = autoRiskControlWorkflow.nodes.map((n) => n.id);
    expect(ids).toEqual([
      'data-health',
      'kpi-baseline',
      'cost-diagnosis',
      'claims-drilldown',
      'segment-risk-scan',
      'risk-scoring',
      'risk-control-approval',
      'pricing-simulation',
    ]);
  });

  it('data-health 节点配置 onFailure=stop（数据 fail → 后续无意义）', () => {
    const node = autoRiskControlWorkflow.nodes.find((n) => n.id === 'data-health');
    expect(node?.type).toBe('sequential');
    if (node?.type === 'sequential') {
      expect(node.onFailure).toBe('stop');
    }
  });

  it('risk-scoring / pricing-simulation 节点 onFailure=stop（审批前后任何失败禁止下游执行）', () => {
    const scoring = autoRiskControlWorkflow.nodes.find((n) => n.id === 'risk-scoring');
    const pricing = autoRiskControlWorkflow.nodes.find((n) => n.id === 'pricing-simulation');
    expect(scoring?.type).toBe('sequential');
    expect(pricing?.type).toBe('sequential');
    if (scoring?.type === 'sequential') expect(scoring.onFailure).toBe('stop');
    if (pricing?.type === 'sequential') expect(pricing.onFailure).toBe('stop');
  });

  it('risk-control-approval 是 approval 节点，approverRoles=[branch_admin]', () => {
    const node = autoRiskControlWorkflow.nodes.find((n) => n.id === 'risk-control-approval');
    expect(node?.type).toBe('approval');
    if (node?.type === 'approval') {
      expect(node.approverRoles).toEqual(['branch_admin']);
    }
  });
});

describe('risk-scoring schema', () => {
  const minimalScan = {
    dimensions: ['customer_category', 'org_level_3'],
    cutoffDate: '2026-04-26',
    baselineEarnedClaimRatio: 55,
    totalSegments: 0,
    segments: [],
    topRiskSegments: [],
    redCount: 0,
    yellowCount: 0,
    greenCount: 0,
  };

  it('接受最小合法输入：仅 scan', () => {
    const out = riskScoringSkill.inputSchema.safeParse({ scan: minimalScan });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.weights.lossRatio).toBe(0.7);
      expect(out.data.thresholds.stop).toBe(80);
      expect(out.data.credibilityFloor).toBe(0.3);
    }
  });

  it('拒绝 thresholds 非严格递减', () => {
    const out = riskScoringSkill.inputSchema.safeParse({
      scan: minimalScan,
      thresholds: { stop: 50, raise: 60, monitor: 40 },
    });
    expect(out.success).toBe(false);
  });

  it('拒绝 weights 越界', () => {
    const out = riskScoringSkill.inputSchema.safeParse({
      scan: minimalScan,
      weights: { lossRatio: 1.5, credibility: 0.1, concentration: 0.1 },
    });
    expect(out.success).toBe(false);
  });
});

describe('pricing-simulation schema', () => {
  const minimalScoring = {
    cutoffDate: '2026-04-26',
    totalScored: 0,
    scoredSegments: [],
    topActionRequired: [],
    summary: {
      stopCount: 0,
      raiseCount: 0,
      monitorCount: 0,
      okCount: 0,
      credibilityDowngradedCount: 0,
    },
    weights: { lossRatio: 0.7, credibility: 0.15, concentration: 0.15 },
    thresholds: { stop: 80, raise: 60, monitor: 40 },
  };

  it('接受最小合法输入：仅 scoring', () => {
    const out = pricingSimulationSkill.inputSchema.safeParse({ scoring: minimalScoring });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.rateDeltaByRecommendation.stop_underwriting).toBe(-1.0);
      expect(out.data.rateDeltaByRecommendation.raise_rate).toBe(0.2);
      expect(out.data.expectedClaimsRetention).toBe(1.0);
    }
  });

  it('拒绝 rateDelta 越界（< -1 或 > 2）', () => {
    expect(
      pricingSimulationSkill.inputSchema.safeParse({
        scoring: minimalScoring,
        rateDeltaByRecommendation: {
          stop_underwriting: -1.5,
          raise_rate: 0.2,
          monitor: 0.05,
          ok: 0,
        },
      }).success,
    ).toBe(false);

    expect(
      pricingSimulationSkill.inputSchema.safeParse({
        scoring: minimalScoring,
        rateDeltaByRecommendation: {
          stop_underwriting: -1,
          raise_rate: 3,
          monitor: 0.05,
          ok: 0,
        },
      }).success,
    ).toBe(false);
  });
});

describe('listSkills() 暴露 requiresApproval 元数据', () => {
  it('阶段 4 PR-A 新增 skill 标记 requiresApproval=true', () => {
    const skills = listSkills();
    const riskScoring = skills.find((s) => s.id === 'risk-scoring');
    const pricingSim = skills.find((s) => s.id === 'pricing-simulation');
    expect(riskScoring?.requiresApproval).toBe(true);
    expect(pricingSim?.requiresApproval).toBe(true);
  });

  it('阶段 1-3 既有 skill 默认 requiresApproval=false', () => {
    const skills = listSkills();
    for (const id of ['data-health', 'kpi-baseline', 'cost-diagnosis', 'claims-drilldown', 'segment-risk-scan', 'report-template']) {
      expect(skills.find((s) => s.id === id)?.requiresApproval).toBe(false);
    }
  });
});

describe('red-line policy 覆盖', () => {
  it('阶段 2 唯一红线 Skill 是 segment-risk-scan', () => {
    expect(RED_LINE_WARNINGS['segment-risk-scan']).toBeDefined();
  });

  it('阶段 4 预留 Skill 已登记，便于后续启用', () => {
    expect(listRedLineSkillIds()).toEqual(
      expect.arrayContaining([
        'segment-risk-scan',
        'risk-scoring',
        'pricing-simulation',
        'underwriting-recommendation',
      ])
    );
  });
});
