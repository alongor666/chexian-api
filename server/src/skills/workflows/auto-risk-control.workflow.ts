/**
 * auto-risk-control 工作流 — 阶段 4 PR-C（在 PR-B 基础上追加 attach-narrative 末尾节点）
 *
 * 流程（v1.2.0）：
 *   1. data-health
 *   2. kpi-baseline
 *   3. cost-diagnosis
 *   4. claims-drilldown
 *   5. segment-risk-scan
 *   6. risk-scoring          （阶段 4 PR-B；接 segment-risk-scan 输出，纯确定性内存计算）
 *   7. risk-control-approval （阶段 4 PR-B；approval 节点，approverRoles=branch_admin）
 *   8. pricing-simulation    （阶段 4 PR-B；审批通过后才执行）
 *   9. attach-narrative      （阶段 4 PR-C；首个 deterministic=false skill；
 *                              生成自然语言叙述，仅文本，不改任何数字；
 *                              失败 onFailure='skip-and-continue'，不阻断 workflow）
 *
 * 失败策略：
 *   - 5 步前置保留原 skip-and-continue（除 data-health=stop）
 *   - risk-scoring / pricing-simulation: onFailure='stop'
 *   - attach-narrative: skip-and-continue（advisory，不能因 LLM 失败拖累整个 workflow）
 */

import { z } from 'zod';
import { PeriodSchema } from '../types.js';
import type { SkillResult } from '../types.js';
import type { WorkflowDef, WorkflowExecCtx } from '../workflow-runner.js';
import type { SegmentRiskScanResultSchema } from '../skills/segment-risk-scan.skill.js';
import type { RiskScoringResultSchema } from '../skills/risk-scoring.skill.js';
import type { StepSummary } from '../skills/attach-narrative.skill.js';

const InputSchema = z.object({
  period: PeriodSchema,
  /** 透传给 cost-diagnosis 的维度，默认 customer_category */
  costDimension: z
    .enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage'])
    .default('customer_category'),
  /** 透传给 claims-drilldown 的客户类别筛选（可选） */
  customerCategories: z.array(z.string()).optional(),
  /** 透传给 segment-risk-scan 的维度（默认 customer_category × org_level_3） */
  scanDimensions: z
    .array(z.enum([
      'customer_category',
      'org_level_3',
      'coverage_combination',
      'is_nev',
      'tonnage_segment',
      'business_type',
    ]))
    .min(1)
    .max(2)
    .default(['customer_category', 'org_level_3']),
});

/**
 * 把 ctx.results 转成 attach-narrative 的 stepsSummary 输入。
 *
 * 仅抽取已聚合的元数据（status/skillId/warnings/evidence），禁止注入原始数据 / SQL / 字段名。
 * inputBuilder 时点：所有上游节点已完成（含 pricing-simulation），ctx.results 完整。
 */
export function buildAttachNarrativeStepsFromCtx(ctx: WorkflowExecCtx): StepSummary[] {
  const orderedNodeIds = [
    'data-health',
    'kpi-baseline',
    'cost-diagnosis',
    'claims-drilldown',
    'segment-risk-scan',
    'risk-scoring',
    'pricing-simulation',
  ] as const;
  const out: StepSummary[] = [];
  for (const nodeId of orderedNodeIds) {
    const r = ctx.results[nodeId];
    if (!r) {
      // 失败 / 跳过的节点也保留摘要（status='skipped'）以便叙述完整反映失败信号
      out.push({
        nodeId,
        skillId: nodeId,
        status: 'skipped',
        warnings: [],
        evidence: [],
      });
      continue;
    }
    out.push({
      nodeId,
      skillId: nodeId,
      status: 'success',
      warnings: r.warnings ?? [],
      evidence: (r.evidence ?? []).map((ev) => ({
        metric: ev.metric,
        value: ev.value,
        source: ev.source,
        note: ev.note,
      })),
    });
  }
  return out;
}

export const autoRiskControlWorkflow: WorkflowDef<typeof InputSchema> = {
  id: 'auto-risk-control-v1',
  name: '自动风险管控（5 步前置 + 评分 + 审批 + 定价模拟 + 叙述）',
  version: '1.2.0',
  description:
    'data-health → kpi-baseline → cost-diagnosis → claims-drilldown → segment-risk-scan → ' +
    'risk-scoring → risk-control-approval → pricing-simulation → attach-narrative',
  inputSchema: InputSchema,
  nodes: [
    {
      id: 'data-health',
      type: 'sequential',
      skillId: 'data-health',
      onFailure: 'stop', // 数据健康失败 → 后续 skill 无意义，整体停止
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        return { period: input.period };
      },
    },
    {
      id: 'kpi-baseline',
      type: 'sequential',
      skillId: 'kpi-baseline',
      onFailure: 'skip-and-continue',
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        return { period: input.period };
      },
    },
    {
      id: 'cost-diagnosis',
      type: 'sequential',
      skillId: 'cost-diagnosis',
      onFailure: 'skip-and-continue',
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        return { period: input.period, dimension: input.costDimension };
      },
    },
    {
      id: 'claims-drilldown',
      type: 'sequential',
      skillId: 'claims-drilldown',
      onFailure: 'skip-and-continue',
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        return {
          period: input.period,
          customerCategories: input.customerCategories,
        };
      },
    },
    {
      id: 'segment-risk-scan',
      type: 'sequential',
      skillId: 'segment-risk-scan',
      onFailure: 'skip-and-continue',
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        return { period: input.period, dimensions: input.scanDimensions };
      },
    },
    {
      id: 'risk-scoring',
      type: 'sequential',
      skillId: 'risk-scoring',
      // segment-risk-scan 失败 → 无 scan 结果可评分，整体停止
      onFailure: 'stop',
      inputBuilder: (ctx) => {
        const input = ctx.runInput as z.infer<typeof InputSchema>;
        const upstream = ctx.results['segment-risk-scan'] as SkillResult | undefined;
        if (!upstream?.result) {
          throw new Error('risk-scoring inputBuilder: segment-risk-scan result missing');
        }
        return {
          scan: upstream.result as z.infer<typeof SegmentRiskScanResultSchema>,
          period: input.period,
        };
      },
    },
    {
      id: 'risk-control-approval',
      type: 'approval',
      approverRoles: ['branch_admin'],
    },
    {
      id: 'pricing-simulation',
      type: 'sequential',
      skillId: 'pricing-simulation',
      // 审批通过后再失败 → 不允许继续到下游 deterministic 输出。
      // attach-narrative 在 pricing-simulation 失败时不应被执行（叙述需要完整数据）；
      // stop 直接 break，attach-narrative 节点不会被调用 — 符合预期。
      onFailure: 'stop',
      inputBuilder: (ctx) => {
        const upstream = ctx.results['risk-scoring'] as SkillResult | undefined;
        if (!upstream?.result) {
          throw new Error('pricing-simulation inputBuilder: risk-scoring result missing');
        }
        return {
          scoring: upstream.result as z.infer<typeof RiskScoringResultSchema>,
        };
      },
    },
    {
      id: 'attach-narrative',
      type: 'sequential',
      skillId: 'attach-narrative',
      // LLM 失败不阻断 workflow，advisory 信息
      onFailure: 'skip-and-continue',
      inputBuilder: (ctx) => {
        const steps = buildAttachNarrativeStepsFromCtx(ctx);
        return {
          workflowId: 'auto-risk-control-v1',
          scope: 'full',
          steps,
        };
      },
    },
  ],
};
