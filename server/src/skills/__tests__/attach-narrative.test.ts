/**
 * attach-narrative skill 测试 — 阶段 4 PR-C
 *
 * 关键边界：
 * - LLM 失败 → narrative 降级，但 citations + redLineWarnings 仍输出
 * - LLM 输出含数字篡改 → citations 仍来自 evidence（不被 LLM 篡改）
 * - redLineWarnings 聚合上游所有 step.warnings 去重
 * - sql-guard 命中 → blockedBySqlGuard=true，narrative 替换为占位文本
 * - scope 过滤：risk / pricing / full 切换覆盖范围
 *
 * 不触碰真实 DuckDB / SQL；用 vi.mock 替换 LLM provider。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  attachNarrativeSkill,
  filterStepsByScope,
  extractCitations,
  aggregateWarnings,
  buildUserContent,
  type StepSummary,
} from '../skills/attach-narrative.skill.js';
import { applyRedLinePolicy } from '../red-line-policy.js';
import type { SkillContext, SkillResult } from '../types.js';

const ctx: SkillContext = {
  userId: 'u1',
  username: 'u1',
  role: 'analyst',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
};

const sampleSteps: StepSummary[] = [
  {
    nodeId: 'data-health',
    skillId: 'data-health',
    status: 'success',
    warnings: ['数据延迟 3 天'],
    evidence: [{ metric: 'data_freshness_days', value: 3, source: 'data-health.summary' }],
  },
  {
    nodeId: 'segment-risk-scan',
    skillId: 'segment-risk-scan',
    status: 'success',
    warnings: ['credibility 修正基于统计学经验公式 n/(n+300)，未经业务字典确认，仅作分析参考'],
    evidence: [
      { metric: 'baseline_earned_claim_ratio', value: 55.2, source: 'segment-risk-scan' },
      { metric: 'top_segment_premium_share', value: 0.35, source: 'segment-risk-scan' },
    ],
  },
  {
    nodeId: 'risk-scoring',
    skillId: 'risk-scoring',
    status: 'success',
    warnings: ['本评分基于规则模型，未经精算建模与业务字典确认'],
    evidence: [
      { metric: 'top_action_count', value: 4, source: 'risk-scoring' },
      { metric: 'stop_underwriting_count', value: 1, source: 'risk-scoring' },
    ],
  },
  {
    nodeId: 'pricing-simulation',
    skillId: 'pricing-simulation',
    status: 'success',
    warnings: [
      '本评分基于规则模型，未经精算建模与业务字典确认', // 重复，应去重
      '未纳入客户流失弹性模型，保费影响可能偏乐观',
      '本结果不构成定价建议，仅供分析参考',
    ],
    evidence: [
      { metric: 'expected_premium_change_pct', value: -7.4, source: 'pricing-simulation' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

describe('filterStepsByScope', () => {
  it('full → 保留全部 step', () => {
    expect(filterStepsByScope(sampleSteps, 'full')).toHaveLength(sampleSteps.length);
  });
  it('risk → 截断到 risk-scoring（含）', () => {
    const r = filterStepsByScope(sampleSteps, 'risk');
    expect(r.map((s) => s.nodeId)).toEqual(['data-health', 'segment-risk-scan', 'risk-scoring']);
  });
  it('pricing → 仅 pricing-simulation', () => {
    const r = filterStepsByScope(sampleSteps, 'pricing');
    expect(r.map((s) => s.nodeId)).toEqual(['pricing-simulation']);
  });
});

describe('extractCitations', () => {
  it('从 evidence 抽出 metric/source/nodeId（去重）', () => {
    const c = extractCitations(sampleSteps);
    expect(c).toContainEqual({
      nodeId: 'risk-scoring',
      metric: 'top_action_count',
      source: 'risk-scoring',
      note: undefined,
    });
    // 重复 metric 同 source 同 nodeId 应去重
    const dup: StepSummary[] = [
      { ...sampleSteps[2], evidence: [...sampleSteps[2].evidence, ...sampleSteps[2].evidence] },
    ];
    expect(extractCitations(dup)).toHaveLength(2);
  });
  it('evidence.metric 为空时跳过', () => {
    const noMetric: StepSummary[] = [
      { nodeId: 'x', skillId: 'x', status: 'success', warnings: [], evidence: [{ source: 'x.foo' }] },
    ];
    expect(extractCitations(noMetric)).toHaveLength(0);
  });
});

describe('aggregateWarnings', () => {
  it('聚合所有 step warnings 并去重', () => {
    const w = aggregateWarnings(sampleSteps);
    expect(w).toContain('数据延迟 3 天');
    expect(w).toContain('未纳入客户流失弹性模型，保费影响可能偏乐观');
    // 重复的红线 warning 只出现一次
    expect(w.filter((x) => x === '本评分基于规则模型，未经精算建模与业务字典确认')).toHaveLength(1);
  });
});

describe('buildUserContent', () => {
  it('包含步骤摘要 + 红线警示段', () => {
    const txt = buildUserContent(sampleSteps, ['本评分基于规则模型，未经精算建模与业务字典确认'], 'wf-x');
    expect(txt).toContain('【工作流】wf-x');
    expect(txt).toContain('segment-risk-scan');
    expect(txt).toContain('【红线警示，必须在叙述中保留】');
    expect(txt).toContain('本评分基于规则模型');
    expect(txt).toContain('top_action_count = 4');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Skill.run — LLM 替身路径
// ──────────────────────────────────────────────────────────────────────────

describe('attachNarrativeSkill.run — LLM 集成', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetLlmProviderCache } = await import('../adapters/llm/index.js');
    resetLlmProviderCache();
    delete process.env.LLM_NARRATIVE_PROVIDER;
  });

  it('mock provider 默认路径 → 返回 narrative + citations + redLineWarnings 完整', async () => {
    process.env.LLM_NARRATIVE_PROVIDER = 'mock';
    const { resetLlmProviderCache } = await import('../adapters/llm/index.js');
    resetLlmProviderCache();
    const { attachNarrativeSkill: skill } = await import('../skills/attach-narrative.skill.js');

    const out = await skill.run(
      {
        workflowId: 'wf-test',
        scope: 'full',
        steps: sampleSteps,
      } as any,
      ctx,
    );
    expect(out.result.narrative).toMatch(/mock/);
    expect(out.result.scope).toBe('full');
    expect(out.result.citations.length).toBeGreaterThan(0);
    // citations 必须从 evidence 抽取
    expect(out.result.citations.some((c) => c.metric === 'baseline_earned_claim_ratio')).toBe(true);
    // redLineWarnings 聚合 + 去重
    expect(out.result.redLineWarnings).toContain('本评分基于规则模型，未经精算建模与业务字典确认');
    expect(out.result.redLineWarnings).toContain('未纳入客户流失弹性模型，保费影响可能偏乐观');
    expect(out.result.narrativeMeta.llmAvailable).toBe(true);
    expect(out.result.narrativeMeta.blockedBySqlGuard).toBe(false);
    expect(out.result.narrativeMeta.fallbackReason).toBeNull();
  });

  it('LLM provider 抛错 → narrative 降级，但 citations + redLineWarnings 仍输出', async () => {
    // 用 vi.doMock 替换默认 provider，让 generateNarrative 抛错
    vi.doMock('../adapters/llm/index.js', async () => {
      const real = await vi.importActual<typeof import('../adapters/llm/index.js')>(
        '../adapters/llm/index.js',
      );
      class ThrowingProvider {
        readonly provider = 'mock-throwing';
        readonly enabled = true;
        async generateNarrative() {
          throw new real.LLMUnavailableError('mock-throwing', 'simulated outage');
        }
      }
      return {
        ...real,
        getDefaultLlmProvider: () => new ThrowingProvider() as any,
      };
    });
    const { attachNarrativeSkill: skill } = await import('../skills/attach-narrative.skill.js');

    const out = await skill.run(
      {
        workflowId: 'wf-test',
        scope: 'full',
        steps: sampleSteps,
      } as any,
      ctx,
    );
    expect(out.result.narrativeMeta.llmAvailable).toBe(false);
    expect(out.result.narrativeMeta.fallbackReason).toBe('simulated outage');
    expect(out.result.narrative).toContain('LLM 调用失败');
    // 关键不变量：citations 完整保留（不被 LLM 失败影响）
    expect(out.result.citations.length).toBeGreaterThan(0);
    // 关键不变量：redLineWarnings 完整保留
    expect(out.result.redLineWarnings.length).toBeGreaterThan(0);

    vi.doUnmock('../adapters/llm/index.js');
  });

  it('LLM 输出含 SQL 关键字 → 被 sql-guard 拦截，narrative 替换为占位，citations 不变', async () => {
    vi.doMock('../adapters/llm/index.js', async () => {
      const real = await vi.importActual<typeof import('../adapters/llm/index.js')>(
        '../adapters/llm/index.js',
      );
      // 让 mock provider 返回含 SQL 的文本（会被 sql-guard 拦截）
      const { MockLLMProvider } = real;
      const provider = new MockLLMProvider({
        fixedText: 'SELECT * FROM PolicyFact WHERE x=1',
      });
      return {
        ...real,
        getDefaultLlmProvider: () => provider,
      };
    });
    const { attachNarrativeSkill: skill } = await import('../skills/attach-narrative.skill.js');

    const out = await skill.run(
      {
        workflowId: 'wf-test',
        scope: 'full',
        steps: sampleSteps,
      } as any,
      ctx,
    );
    expect(out.result.narrativeMeta.blockedBySqlGuard).toBe(true);
    expect(out.result.narrative).toContain('sql-guard');
    expect(out.result.citations.length).toBeGreaterThan(0);
    expect(out.result.redLineWarnings.length).toBeGreaterThan(0);

    vi.doUnmock('../adapters/llm/index.js');
  });

  it('LLM 输出捏造数字 → citations 仍仅来自 evidence（不接受 LLM 编造）', async () => {
    vi.doMock('../adapters/llm/index.js', async () => {
      const real = await vi.importActual<typeof import('../adapters/llm/index.js')>(
        '../adapters/llm/index.js',
      );
      const { MockLLMProvider } = real;
      // LLM 返回包含编造 metric 的文本，但 attach-narrative 不应据此回填 citations
      const provider = new MockLLMProvider({
        fixedText: '本期赔付率达到 99.9%（伪造数字），建议立即停止全部承保。',
      });
      return {
        ...real,
        getDefaultLlmProvider: () => provider,
      };
    });
    const { attachNarrativeSkill: skill } = await import('../skills/attach-narrative.skill.js');

    const out = await skill.run(
      {
        workflowId: 'wf-test',
        scope: 'full',
        steps: sampleSteps,
      } as any,
      ctx,
    );
    expect(out.result.narrative).toContain('99.9%'); // LLM 文本原样保留
    // 但 citations 必须只含 evidence 的 metric，不含 LLM 编造的「99.9%」
    const citationMetrics = out.result.citations.map((c) => c.metric);
    expect(citationMetrics).not.toContain('99.9%');
    expect(citationMetrics).toContain('baseline_earned_claim_ratio');
    expect(citationMetrics).toContain('top_action_count');

    vi.doUnmock('../adapters/llm/index.js');
  });

  it('scope=risk → 仅过滤到 risk-scoring，citations 不含 pricing-simulation', async () => {
    process.env.LLM_NARRATIVE_PROVIDER = 'mock';
    const { resetLlmProviderCache } = await import('../adapters/llm/index.js');
    resetLlmProviderCache();
    const { attachNarrativeSkill: skill } = await import('../skills/attach-narrative.skill.js');

    const out = await skill.run(
      {
        workflowId: 'wf-test',
        scope: 'risk',
        steps: sampleSteps,
      } as any,
      ctx,
    );
    expect(out.result.scope).toBe('risk');
    expect(out.result.citations.every((c) => c.nodeId !== 'pricing-simulation')).toBe(true);
    // pricing-simulation 的「未纳入客户流失弹性模型」不应被聚合
    expect(out.result.redLineWarnings).not.toContain('未纳入客户流失弹性模型，保费影响可能偏乐观');
  });

  it('attach-narrative 红线已登记 — applyRedLinePolicy 注入 advisory warning', () => {
    const out = applyRedLinePolicy('attach-narrative', {
      result: { narrative: 't', citations: [], redLineWarnings: [], scope: 'full', workflowId: 'x', narrativeMeta: { provider: 'm', model: null, blockedBySqlGuard: false, llmAvailable: true, fallbackReason: null } },
      evidence: [],
      confidence: 1,
      warnings: [],
      assumptions: [],
      dataLineage: [],
      nextSuggestedSkills: [],
    } as SkillResult<unknown>);
    expect(out.warnings).toContain('叙述基于规则模型输出，未经业务字典确认，不构成决策建议');
  });
});
