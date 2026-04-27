/**
 * auto-risk-control 工作流 — 阶段 4 PR-B（线性 5 步前置 + risk-scoring + approval + pricing-simulation）
 *
 * 流程：
 *   1. data-health
 *   2. kpi-baseline
 *   3. cost-diagnosis
 *   4. claims-drilldown
 *   5. segment-risk-scan
 *   6. risk-scoring          （阶段 4 PR-B；接 segment-risk-scan 输出，纯确定性内存计算）
 *   7. risk-control-approval （阶段 4 PR-B；approval 节点，approverRoles=branch_admin，挂起整个 workflow）
 *   8. pricing-simulation    （阶段 4 PR-B；审批通过后才执行，接 risk-scoring 输出）
 *
 * 失败策略：
 *   - 5 步前置保留原 skip-and-continue（除 data-health=stop）
 *   - risk-scoring / pricing-simulation: onFailure='stop'，审批前后任何失败都不能继续执行下游
 */

import { z } from 'zod';
import { PeriodSchema } from '../types.js';
import type { SkillResult } from '../types.js';
import type { WorkflowDef } from '../workflow-runner.js';
import type { SegmentRiskScanResultSchema } from '../skills/segment-risk-scan.skill.js';
import type { RiskScoringResultSchema } from '../skills/risk-scoring.skill.js';

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

export const autoRiskControlWorkflow: WorkflowDef<typeof InputSchema> = {
  id: 'auto-risk-control-v1',
  name: '自动风险管控（5 步前置 + 评分 + 审批 + 定价模拟）',
  version: '1.1.0',
  description:
    'data-health → kpi-baseline → cost-diagnosis → claims-drilldown → segment-risk-scan → ' +
    'risk-scoring → risk-control-approval → pricing-simulation',
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
      // 审批通过后再失败 → 不允许继续，但当前节点已是末尾，stop 与 skip 等价；
      // 显式 stop 表达"审批后任何失败也不再向下游传递"的语义。
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
  ],
};
