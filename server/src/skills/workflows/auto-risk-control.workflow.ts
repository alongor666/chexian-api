/**
 * auto-risk-control 工作流 — 阶段 2 线性 5 步
 *
 * 流程：
 *   1. data-health           （检查数据可用性，dataConfidence < 阈值则后续 skill 注意）
 *   2. kpi-baseline          （经营基线）
 *   3. cost-diagnosis        （高赔付分组）
 *   4. claims-drilldown      （出险下钻）
 *   5. segment-risk-scan     （维度交叉风险扫描，含实验性 credibility）
 *
 * 阶段 4 将追加：risk-scoring → pricing-simulation → underwriting-recommendation → approval → report-generation
 *
 * 失败策略：每步默认 'skip-and-continue'。任一步失败 → workflow 整体 status='partial'，
 * 但不抛异常，便于看板对成功步骤先出报告。
 */

import { z } from 'zod';
import { PeriodSchema } from '../types.js';
import type { WorkflowDef } from '../workflow-runner.js';

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
  name: '自动风险管控（线性 5 步）',
  version: '1.0.0',
  description: 'data-health → kpi-baseline → cost-diagnosis → claims-drilldown → segment-risk-scan',
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
  ],
};
