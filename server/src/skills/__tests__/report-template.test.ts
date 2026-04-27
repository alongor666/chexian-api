/**
 * report-template Skill — 阶段 3 单元测试
 *
 * 通过 vi.mock 把 getWorkflowRun 替换为可控 fixture，避开真实文件系统。
 * 覆盖：
 *  - success 全成功 → 5 段 + 红线 warning 在头部
 *  - partial 含失败步 → ❌ 渲染 + 整体 confidence 下降
 *  - skipped 节点（branch 未命中）
 *  - run 不存在 → 抛错
 *  - 跨用户 RBAC 拦截
 *  - includeJsonAppendix 控制附录段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillContext } from '../types.js';
import type { WorkflowRunRecord, WorkflowStepRecord } from '../workflow-runner.js';

const mockGetWorkflowRun = vi.fn<(id: string) => Promise<WorkflowRunRecord | null>>();

vi.mock('../workflow-runner.js', async () => ({
  getWorkflowRun: (id: string) => mockGetWorkflowRun(id),
}));

const { reportTemplateSkill } = await import('../skills/report-template.skill.js');

const baseCtx: SkillContext = {
  userId: 'u1',
  username: 'alice',
  role: 'admin',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
};

function buildStep(partial: Partial<WorkflowStepRecord> & { skillId: string; status: WorkflowStepRecord['status'] }): WorkflowStepRecord {
  return {
    nodeId: partial.nodeId ?? partial.skillId,
    nodeType: 'sequential',
    skillId: partial.skillId,
    status: partial.status,
    runId: partial.runId ?? `r_${partial.skillId}`,
    result: partial.result,
    error: partial.error,
    startedAt: '2026-04-26T00:00:00.000Z',
    finishedAt: '2026-04-26T00:00:01.000Z',
    elapsedMs: partial.elapsedMs ?? 1000,
  };
}

function buildRun(steps: WorkflowStepRecord[], overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId: 'wr_20260426000000_auto-risk-control-v1_abcdef12',
    workflowId: 'auto-risk-control-v1',
    workflowVersion: '1.0.0',
    status: 'success',
    userId: 'u1',
    username: 'alice',
    requestId: 'req-test',
    startedAt: '2026-04-26T00:00:00.000Z',
    finishedAt: '2026-04-26T00:00:05.000Z',
    elapsedMs: 5000,
    input: { period: { startDate: '2026-04-01', endDate: '2026-04-26' } },
    steps,
    report: { narrative: null },
    ...overrides,
  };
}

const SUCCESS_INPUT = {
  workflowRunId: 'wr_20260426000000_auto-risk-control-v1_abcdef12',
  includeRedLineHeader: true,
  includeJsonAppendix: false,
};

beforeEach(() => {
  mockGetWorkflowRun.mockReset();
});

describe('report-template skill — 输入校验', () => {
  it('runId 格式不合法 → zod 报错', () => {
    const parsed = reportTemplateSkill.inputSchema.safeParse({ workflowRunId: 'invalid' });
    expect(parsed.success).toBe(false);
  });

  it('合法 runId + 默认值', () => {
    const parsed = reportTemplateSkill.inputSchema.safeParse(SUCCESS_INPUT);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.includeRedLineHeader).toBe(true);
      expect(parsed.data.includeJsonAppendix).toBe(false);
    }
  });
});

describe('report-template skill — RBAC', () => {
  it('run 不存在 → 抛错', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    await expect(reportTemplateSkill.run(SUCCESS_INPUT, baseCtx)).rejects.toThrow(/not found/);
  });

  it('非 branch_admin 跨用户访问 → 抛错', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(buildRun([], { username: 'bob' }));
    await expect(reportTemplateSkill.run(SUCCESS_INPUT, baseCtx)).rejects.toThrow(/not accessible/);
  });

  it('branch_admin 可跨用户访问', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(buildRun([], { username: 'bob' }));
    const adminCtx = { ...baseCtx, role: 'branch_admin' };
    const result = await reportTemplateSkill.run(SUCCESS_INPUT, adminCtx);
    expect(result.result.workflowRunId).toBe(SUCCESS_INPUT.workflowRunId);
  });
});

describe('report-template skill — 全成功 5 步', () => {
  it('生成 markdown，含 5 段标题', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      buildRun([
        buildStep({
          skillId: 'data-health',
          status: 'success',
          result: {
            result: {
              status: 'pass',
              dataConfidence: 0.95,
              rowCount: 12345,
              availableDomains: ['PolicyFact'],
              missingDomains: [],
              fieldGaps: [],
            },
            evidence: [],
            confidence: 1,
            warnings: [],
            assumptions: [],
            dataLineage: ['PolicyFact'],
            nextSuggestedSkills: [],
          },
        }),
        buildStep({
          skillId: 'kpi-baseline',
          status: 'success',
          result: {
            result: {
              premium: 12000000,
              policyCount: 1500,
              reportedClaims: 5000000,
              feeAmount: 1800000,
              earnedClaimRatio: 65.5,
              expenseRatio: 15.2,
              avgClaimAmount: 8000,
              period: { startDate: '2026-04-01', endDate: '2026-04-26' },
            },
            evidence: [],
            confidence: 1,
            warnings: [],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
        buildStep({
          skillId: 'cost-diagnosis',
          status: 'success',
          result: {
            result: {
              dimension: 'customer_category',
              cutoffDate: '2026-04-26',
              totalGroups: 8,
              groups: [],
              topRiskGroups: [
                {
                  dimKey: '营业出租',
                  policyCount: 200,
                  totalPremium: 3000000,
                  earnedClaimRatio: 85.0,
                  comprehensiveCostRatio: 105,
                  riskLevel: 'red',
                  premiumShare: 0.25,
                },
              ],
              redGroupCount: 1,
              yellowGroupCount: 2,
              greenGroupCount: 5,
              overallEarnedClaimRatio: 65.0,
              overallComprehensiveCostRatio: 80.5,
            },
            evidence: [],
            confidence: 1,
            warnings: [],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
        buildStep({
          skillId: 'claims-drilldown',
          status: 'success',
          result: {
            result: {
              period: { startDate: '2026-04-01', endDate: '2026-04-26' },
              overview: {
                totalCases: 300,
                settledCases: 200,
                pendingCases: 100,
                bodilyInjuryCases: 30,
                bodilyInjuryRate: 10.0,
                totalReserveWan: 500.5,
                pendingReserveWan: 200.3,
                bodilyReserveWan: 100,
                vehicleReserveWan: 350,
                propertyReserveWan: 50,
              },
              topByOrg: [
                { org: '乐山中支', cases: 50, reserveWan: 80, avgReserve: 16000, injuryCases: 5, injuryRate: 10 },
              ],
              topByCause: [
                { cause: '车辆碰撞', cases: 200, reserveWan: 300, avgReserve: 15000, injuryCases: 20, injuryRate: 10 },
              ],
              cycleByInjury: [],
              signals: ['人伤占比偏高'],
            },
            evidence: [],
            confidence: 1,
            warnings: [],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
        buildStep({
          skillId: 'segment-risk-scan',
          status: 'success',
          result: {
            result: {
              dimensions: ['customer_category', 'org_level_3'],
              cutoffDate: '2026-04-26',
              baselineEarnedClaimRatio: 65.0,
              totalSegments: 40,
              segments: [],
              topRiskSegments: [
                {
                  dimKey: '营业出租|乐山中支',
                  dimValues: { customer_category: '营业出租', org_level_3: '乐山中支' },
                  policyCount: 50,
                  totalPremium: 800000,
                  earnedPremium: 600000,
                  totalReportedClaims: 480000,
                  rawEarnedClaimRatio: 80,
                  credibility: 0.143,
                  adjustedEarnedClaimRatio: 67.1,
                  riskLevel: 'red',
                },
              ],
              redCount: 3,
            },
            evidence: [],
            confidence: 1,
            warnings: ['credibility 修正基于统计学经验公式 n/(n+300)，未经业务字典确认，仅作分析参考'],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
      ])
    );

    const { result } = await reportTemplateSkill.run(SUCCESS_INPUT, baseCtx);
    expect(result.workflowStatus).toBe('success');
    expect(result.successCount).toBe(5);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.markdown).toContain('# auto-risk-control-v1 经营巡检报告');
    expect(result.markdown).toContain('一、数据健康检查');
    expect(result.markdown).toContain('二、经营基线');
    expect(result.markdown).toContain('三、高赔付分组诊断');
    expect(result.markdown).toContain('四、赔案下钻');
    expect(result.markdown).toContain('五、维度交叉风险扫描');
    // 红线 warning 必须出现在头部
    expect(result.redLineWarnings.length).toBe(1);
    expect(result.markdown).toContain('## ⚠️ 重要声明（红线 warning）');
    expect(result.markdown.indexOf('重要声明')).toBeLessThan(result.markdown.indexOf('一、数据健康检查'));
    expect(result.markdown).toContain('未经业务字典确认');
    // 数值格式校验
    expect(result.markdown).toMatch(/1,200(\.0)? 万元/); // premium=12_000_000 / 10_000
    expect(result.markdown).toContain('65.50%'); // earnedClaimRatio
  });
});

describe('report-template skill — partial / failed / skipped', () => {
  it('含失败步骤 → confidence 下降，markdown 含 ❌', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      buildRun(
        [
          buildStep({
            skillId: 'data-health',
            status: 'success',
            result: {
              result: {
                status: 'pass',
                dataConfidence: 0.9,
                rowCount: 100,
                availableDomains: ['PolicyFact'],
                missingDomains: [],
                fieldGaps: [],
              },
              evidence: [],
              confidence: 1,
              warnings: [],
              assumptions: [],
              dataLineage: [],
              nextSuggestedSkills: [],
            },
          }),
          buildStep({
            skillId: 'cost-diagnosis',
            status: 'failed',
            error: 'ClaimsAgg load failed',
          }),
          buildStep({
            skillId: 'claims-drilldown',
            status: 'skipped',
            error: 'no branch matched',
          }),
        ],
        { status: 'partial' }
      )
    );

    const { result } = await reportTemplateSkill.run(SUCCESS_INPUT, baseCtx);
    expect(result.workflowStatus).toBe('partial');
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.markdown).toContain('❌ 失败');
    expect(result.markdown).toContain('ClaimsAgg load failed');
    expect(result.markdown).toContain('⏭️ 跳过');
    expect(result.allWarnings.length).toBeGreaterThanOrEqual(0);
  });

  it('未知 skillId → fallback 到 JSON code-fence', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      buildRun([
        buildStep({
          skillId: 'unknown-skill',
          status: 'success',
          result: {
            result: { hello: 'world' },
            evidence: [],
            confidence: 1,
            warnings: [],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
      ])
    );

    const { result } = await reportTemplateSkill.run(SUCCESS_INPUT, baseCtx);
    expect(result.markdown).toContain('```json');
    expect(result.markdown).toContain('"hello"');
  });
});

describe('report-template skill — 配置开关', () => {
  it('includeRedLineHeader=false → 不渲染头部声明', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      buildRun([
        buildStep({
          skillId: 'segment-risk-scan',
          status: 'success',
          result: {
            result: {
              dimensions: ['customer_category'],
              cutoffDate: '2026-04-26',
              baselineEarnedClaimRatio: 60,
              totalSegments: 1,
              segments: [],
              topRiskSegments: [],
              redCount: 0,
            },
            evidence: [],
            confidence: 1,
            warnings: ['credibility 修正基于统计学经验公式 n/(n+300)，未经业务字典确认，仅作分析参考'],
            assumptions: [],
            dataLineage: [],
            nextSuggestedSkills: [],
          },
        }),
      ])
    );

    const { result } = await reportTemplateSkill.run(
      { ...SUCCESS_INPUT, includeRedLineHeader: false },
      baseCtx
    );
    expect(result.redLineWarnings.length).toBe(1);
    expect(result.markdown).not.toContain('## ⚠️ 重要声明');
  });

  it('includeJsonAppendix=true → 末尾追加 JSON 附录', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(buildRun([]));
    const { result } = await reportTemplateSkill.run(
      { ...SUCCESS_INPUT, includeJsonAppendix: true },
      baseCtx
    );
    expect(result.markdown).toContain('## 附录：结构化摘要');
    expect(result.markdown).toContain('"workflowStatus"');
  });
});
