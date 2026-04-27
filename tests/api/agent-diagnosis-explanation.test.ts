import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Server } from 'node:http';

import type { LLMAdapter } from '../../server/src/skills/adapters/llm/types';
import {
  AgentDiagnosisExplanationRequestSchema,
  explainDiagnosisResult,
} from '../../server/src/agent/services/agent-diagnosis-explanation-service';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

afterEach(() => {
  vi.restoreAllMocks();
});

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function makeProvider(text: string): LLMAdapter {
  return {
    provider: 'test-provider',
    enabled: true,
    generateNarrative: vi.fn().mockResolvedValue({
      text,
      model: 'test-model',
      blockedBySqlGuard: false,
      tokens: { prompt: 10, completion: 5, total: 15 },
    }),
  };
}

function makeRejectingProvider(): LLMAdapter {
  return {
    provider: 'test-provider',
    enabled: true,
    generateNarrative: vi.fn().mockRejectedValue(new Error('network timeout with internal details')),
  };
}

function makeCostDiagnosisResult() {
  return {
    capabilityId: 'cost_indicator_diagnosis',
    status: 'supported',
    requestedTools: ['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'],
    summary: {
      topDriver: 'claim',
      highRiskCount: 1,
    },
    diagnostics: [
      {
        metricId: 'variable_cost_ratio',
        dimKey: 'A机构',
        metrics: {
          variableCostRatio: 106,
          earnedClaimRatio: 90,
          expenseRatio: 16,
        },
      },
    ],
    warnings: ['项目内经营分析口径，不代表完整财务综合成本率。'],
    forbiddenInterpretations: ['承保利润', '利润率', '财务盈利', '财务亏损'],
  };
}

describe('agent diagnosis explanation service', () => {
  it('explains deterministic diagnosis output and preserves guardrail fields', async () => {
    const provider = makeProvider('变动成本率升高主要来自满期赔付率变化，费用率也需要继续观察。');

    const result = await explainDiagnosisResult(
      {
        sourceCapabilityId: 'cost_indicator_diagnosis',
        userQuestion: '变动成本率为什么升高？',
        diagnosisResult: makeCostDiagnosisResult(),
      },
      { provider }
    );

    expect(result).toMatchObject({
      capabilityId: 'cost_indicator_diagnosis',
      status: 'explained',
      summary: '变动成本率升高主要来自满期赔付率变化，费用率也需要继续观察。',
      referencedMetricIds: expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio']),
      warnings: expect.arrayContaining([
        '项目内经营分析口径，不代表完整财务综合成本率。',
        '变动成本率为项目内经营分析口径，不代表完整财务承保利润。',
      ]),
      forbiddenInterpretations: ['承保利润', '利润率', '财务盈利', '财务亏损'],
      unsupportedRefusals: [],
      narrativeMeta: {
        provider: 'test-provider',
        model: 'test-model',
        blockedBySqlGuard: false,
      },
    });
    expect(result.evidence.map((item) => item.metricId)).toEqual(
      expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'])
    );
    expect(provider.generateNarrative).toHaveBeenCalledTimes(1);
  });

  it('refuses unsupported profit questions before calling the provider', async () => {
    const provider = makeProvider('不应生成这段解释');

    const result = await explainDiagnosisResult(
      {
        sourceCapabilityId: 'cost_indicator_diagnosis',
        userQuestion: '承保利润怎么样？',
        diagnosisResult: makeCostDiagnosisResult(),
      },
      { provider }
    );

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('当前项目数据不支持承保利润');
    expect(result.summary).toContain('财务利润');
    expect(result.unsupportedRefusals[0]).toMatchObject({
      source: 'routeAgentQuestion',
      reason: expect.stringContaining('当前项目数据不支持承保利润'),
    });
    expect(provider.generateNarrative).not.toHaveBeenCalled();
  });

  it('refuses non-supported capabilities before calling the provider', async () => {
    const provider = makeProvider('不应生成这段解释');

    const result = await explainDiagnosisResult(
      {
        sourceCapabilityId: 'underwriting_profit_diagnosis',
        diagnosisResult: {
          ...makeCostDiagnosisResult(),
          capabilityId: 'underwriting_profit_diagnosis',
        },
      },
      { provider }
    );

    expect(result.status).toBe('refused');
    expect(result.summary).toContain('当前不是 supported Agent 诊断能力');
    expect(result.unsupportedRefusals[0]).toMatchObject({
      source: 'agentDataCapabilityRegistry',
      replacementSuggestions: expect.arrayContaining(['cost_indicator_diagnosis']),
    });
    expect(provider.generateNarrative).not.toHaveBeenCalled();
  });

  it('falls back to deterministic output when the provider fails', async () => {
    const provider = makeRejectingProvider();

    const result = await explainDiagnosisResult(
      {
        sourceCapabilityId: 'cost_indicator_diagnosis',
        userQuestion: '变动成本率为什么升高？',
        diagnosisResult: makeCostDiagnosisResult(),
      },
      { provider }
    );

    expect(result.status).toBe('explained');
    expect(result.summary).toContain('解释生成暂不可用');
    expect(result.narrativeMeta).toMatchObject({
      provider: 'test-provider',
      blockedBySqlGuard: false,
      error: 'provider_error',
    });
    expect(result.narrativeMeta.error).not.toContain('network timeout');
    expect(provider.generateNarrative).toHaveBeenCalledTimes(1);
  });

  it('runs sql-guard over provider output and returns a guarded placeholder', async () => {
    const provider = makeProvider('SELECT * FROM PolicyFact');

    const result = await explainDiagnosisResult(
      {
        sourceCapabilityId: 'cost_indicator_diagnosis',
        userQuestion: '变动成本率为什么升高？',
        diagnosisResult: makeCostDiagnosisResult(),
      },
      { provider }
    );

    expect(result.status).toBe('explained');
    expect(result.summary).toContain('LLM 输出被 sql-guard 拦截');
    expect(result.narrativeMeta.blockedBySqlGuard).toBe(true);
  });

  it('requires warnings and forbiddenInterpretations in the request contract', () => {
    expect(() =>
      AgentDiagnosisExplanationRequestSchema.parse({
        sourceCapabilityId: 'cost_indicator_diagnosis',
        diagnosisResult: {
          capabilityId: 'cost_indicator_diagnosis',
          status: 'supported',
          requestedTools: ['cost.variable_cost'],
          summary: {},
        },
      })
    ).toThrow();
  });
});

describe('agent diagnosis explanation HTTP route', () => {
  it('serves the protected route with auth, permission and Zod-validated response', async () => {
    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentExplainRoutes }] =
      await Promise.all([
        import('../../server/src/config/auth.js'),
        import('../../server/src/middleware/error.js'),
        import('../../server/src/agent/routes/agent-explain.js'),
      ]);

    const app = express();
    app.use(express.json());
    app.use('/api/agent/explain', agentExplainRoutes);
    app.use(errorHandler);
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind to a port');
      const token = jwt.sign(
        {
          userId: 'u1',
          username: 'admin',
          role: 'branch_admin',
        },
        authConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/explain/diagnosis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceCapabilityId: 'cost_indicator_diagnosis',
          userQuestion: '变动成本率为什么升高？',
          diagnosisResult: makeCostDiagnosisResult(),
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('cost_indicator_diagnosis');
      expect(body.data.status).toBe('explained');
      expect(body.data.warnings).toEqual(
        expect.arrayContaining([
          '项目内经营分析口径，不代表完整财务综合成本率。',
          '变动成本率为项目内经营分析口径，不代表完整财务承保利润。',
        ])
      );
      expect(body.data.forbiddenInterpretations).toEqual(['承保利润', '利润率', '财务盈利', '财务亏损']);
    } finally {
      await closeServer(server);
    }
  });
});
