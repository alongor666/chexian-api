/**
 * attach-narrative Skill — 阶段 4 PR-C
 *
 * 作战地图 stage 5 LLM 解释层在 workflow 报告侧的对应实现。
 *
 * 边界（docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md + CLAUDE.md §10）：
 * - **首个 deterministic=false skill**：可调用 LLM provider，但只生成自然语言叙述
 * - **不改任何数字 / 不创造指标**：citations 必须从 record.steps[].result.evidence 抽取，
 *   不允许从 LLM 输出回填 metric 或 value
 * - **不接 SQL 工具 / DuckDB / NL2SQL**：仅用 narrative provider，所有文本经 sql-guard
 * - **必须聚合上游所有 warnings + red-line warnings 去重**输出到 redLineWarnings
 * - **LLM 失败不阻断**：text 降级为占位符 + LLM 元信息记录在 narrativeMeta，citations / warnings 仍输出
 *
 * 红线：red-line-policy.ts 已新增 'attach-narrative' 条目
 *   "叙述基于规则模型输出，未经业务字典确认，不构成决策建议"
 *
 * 输入：workflow runner 在 inputBuilder 中从 ctx.results / record.steps 构造 stepsSummary
 *      （workflow runId 不直接注入，避免 skill 内部调 getWorkflowRun 形成回环）
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import {
  getDefaultLlmProvider,
  NARRATIVE_SYSTEM_PROMPT,
  LLMUnavailableError,
} from '../adapters/llm/index.js';

// ──────────────────────────────────────────────────────────────────────────
// Input
// ──────────────────────────────────────────────────────────────────────────

const StepEvidenceItemSchema = z.object({
  metric: z.string().optional(),
  value: z.unknown().optional(),
  source: z.string(),
  note: z.string().optional(),
});

const StepSummarySchema = z.object({
  nodeId: z.string().min(1),
  skillId: z.string().min(1).optional(),
  status: z.enum(['success', 'failed', 'skipped']),
  warnings: z.array(z.string()).default([]),
  evidence: z.array(StepEvidenceItemSchema).default([]),
});

export type StepSummary = z.infer<typeof StepSummarySchema>;

const ScopeSchema = z.enum(['risk', 'pricing', 'full']).default('full');

const InputSchema = z.object({
  workflowId: z.string().min(1),
  /** 摘要范围：risk = 仅 risk-scoring 之前；pricing = 仅 pricing-simulation；full = 全部 */
  scope: ScopeSchema,
  /** 每个 step 的精简快照，由 workflow inputBuilder 从 ctx.results 构造 */
  steps: z.array(StepSummarySchema).min(1),
  /** 可选 — 用户自定义补充提示，仍受 NARRATIVE_SYSTEM_PROMPT 约束 */
  extraContextHint: z.string().max(500).optional(),
});

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

const CitationSchema = z.object({
  nodeId: z.string(),
  metric: z.string(),
  source: z.string(),
  note: z.string().optional(),
});

const NarrativeMetaSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  blockedBySqlGuard: z.boolean(),
  llmAvailable: z.boolean(),
  /** 失败原因（LLMUnavailableError.reason / 其它），LLM 成功时 null */
  fallbackReason: z.string().nullable(),
});

export const AttachNarrativeResultSchema = z.object({
  narrative: z.string(),
  citations: z.array(CitationSchema),
  redLineWarnings: z.array(z.string()),
  scope: ScopeSchema,
  workflowId: z.string(),
  narrativeMeta: NarrativeMetaSchema,
});

type Result = z.infer<typeof AttachNarrativeResultSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (单测覆盖)
// ──────────────────────────────────────────────────────────────────────────

/** scope 过滤：限定参与 narrative + citation 的 step 子集 */
export function filterStepsByScope(steps: StepSummary[], scope: z.infer<typeof ScopeSchema>): StepSummary[] {
  if (scope === 'full') return steps;
  if (scope === 'risk') {
    // risk = 直到 risk-scoring（含）的所有节点
    const idx = steps.findIndex((s) => s.skillId === 'risk-scoring' || s.nodeId === 'risk-scoring');
    return idx >= 0 ? steps.slice(0, idx + 1) : steps;
  }
  // pricing = 仅 pricing-simulation 节点
  return steps.filter((s) => s.skillId === 'pricing-simulation' || s.nodeId === 'pricing-simulation');
}

/**
 * 从 stepsSummary 提取 citations。
 *
 * 严格约束：citations 只来自 evidence[*].metric/source，禁止从 LLM 输出回填。
 * 没有 metric 字段的 evidence 项跳过（叙述里不引用）。
 */
export function extractCitations(steps: StepSummary[]): Array<z.infer<typeof CitationSchema>> {
  const out: Array<z.infer<typeof CitationSchema>> = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const ev of step.evidence) {
      if (!ev.metric) continue;
      const key = `${step.nodeId}|${ev.metric}|${ev.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        nodeId: step.nodeId,
        metric: ev.metric,
        source: ev.source,
        note: ev.note,
      });
    }
  }
  return out;
}

/** 聚合所有 step warnings 去重，保持原顺序 */
export function aggregateWarnings(steps: StepSummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of steps) {
    for (const w of step.warnings) {
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/**
 * 构造给 LLM 的 userContent。
 * 严格约束：
 * - 仅引用 metric / source / status 等已聚合的元数据字符串
 * - 数字若来自 evidence.value 则原样写入文本；不允许 LLM 改写
 * - 末尾附 redLineWarnings 全集，强制 LLM 在叙述里保留警示
 */
export function buildUserContent(
  steps: StepSummary[],
  redLineWarnings: string[],
  workflowId: string,
  extraHint?: string,
): string {
  const lines: string[] = [];
  lines.push(`【工作流】${workflowId}`);
  lines.push(`【步骤数】${steps.length}`);
  lines.push('');
  lines.push('【步骤摘要】');
  for (const s of steps) {
    const skillTag = s.skillId ? `(${s.skillId})` : '';
    lines.push(`- ${s.nodeId}${skillTag} 状态=${s.status} warnings=${s.warnings.length} evidence=${s.evidence.length}`);
    for (const ev of s.evidence) {
      if (!ev.metric) continue;
      const valStr =
        ev.value === null || ev.value === undefined
          ? 'null'
          : typeof ev.value === 'object'
            ? JSON.stringify(ev.value)
            : String(ev.value);
      lines.push(`  · ${ev.metric} = ${valStr} (来源 ${ev.source})`);
    }
  }
  lines.push('');
  if (redLineWarnings.length > 0) {
    lines.push('【红线警示，必须在叙述中保留】');
    for (const w of redLineWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }
  if (extraHint) {
    lines.push(`【额外提示（仅参考，不得改变数字）】${extraHint}`);
  }
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Skill
// ──────────────────────────────────────────────────────────────────────────

export const attachNarrativeSkill: Skill<typeof InputSchema, Result> = {
  id: 'attach-narrative',
  name: '叙述附加',
  version: '1.0.0',
  description:
    '基于上游 workflow steps 的 evidence/warnings 生成只读自然语言叙述。' +
    '首个 deterministic=false 的 skill，仅生成文本，不改任何数字，不接 SQL 工具。' +
    '所有 citations 从 evidence 抽取，所有 warnings 聚合去重输出。',
  inputSchema: InputSchema,
  outputResultSchema: AttachNarrativeResultSchema,
  deterministic: false,
  requiresApproval: true,
  async run(input) {
    const filteredSteps = filterStepsByScope(input.steps, input.scope);
    const citations = extractCitations(filteredSteps);
    const redLineWarnings = aggregateWarnings(filteredSteps);
    const userContent = buildUserContent(filteredSteps, redLineWarnings, input.workflowId, input.extraContextHint);

    const provider = getDefaultLlmProvider();
    let narrative = '';
    let blockedBySqlGuard = false;
    let model: string | null = null;
    let fallbackReason: string | null = null;
    let llmAvailable = true;

    try {
      const llmRes = await provider.generateNarrative({
        systemPrompt: NARRATIVE_SYSTEM_PROMPT,
        userContent,
        temperature: 0.3,
        maxTokens: 400,
      });
      narrative = llmRes.text;
      blockedBySqlGuard = llmRes.blockedBySqlGuard;
      model = llmRes.model;
    } catch (err) {
      llmAvailable = false;
      fallbackReason =
        err instanceof LLMUnavailableError ? err.reason : err instanceof Error ? err.message : String(err);
      // 降级：narrative 用确定性占位，citations / warnings 仍输出，不阻断 workflow
      narrative = `[LLM 调用失败：${fallbackReason}。本期叙述未生成，请直接查看下方 citations 与 redLineWarnings。]`;
    }

    const warnings: string[] = [];
    if (filteredSteps.length === 0) {
      warnings.push(`scope=${input.scope} 过滤后无步骤可叙述`);
    }
    if (blockedBySqlGuard) {
      warnings.push('LLM 输出被 sql-guard 拦截，narrative 已替换为占位文本');
    }
    if (!llmAvailable) {
      warnings.push(`LLM provider 不可用：${fallbackReason ?? 'unknown'}`);
    }

    return {
      result: {
        narrative,
        citations,
        redLineWarnings,
        scope: input.scope,
        workflowId: input.workflowId,
        narrativeMeta: {
          provider: provider.provider,
          model,
          blockedBySqlGuard,
          llmAvailable,
          fallbackReason,
        },
      },
      evidence: [
        { metric: 'citation_count', value: citations.length, source: 'attach-narrative' },
        { metric: 'red_line_warning_count', value: redLineWarnings.length, source: 'attach-narrative' },
        {
          metric: 'narrative_provider',
          value: provider.provider,
          source: 'attach-narrative.provider',
          note: model ?? undefined,
        },
        {
          metric: 'sql_guard_blocked',
          value: blockedBySqlGuard,
          source: 'attach-narrative.sql-guard',
        },
      ],
      confidence: filteredSteps.length === 0 ? 0.2 : llmAvailable && !blockedBySqlGuard ? 0.7 : 0.4,
      warnings,
      assumptions: [
        'narrative 仅生成自然语言文字，禁止改写任何数字（违反由 sql-guard + 红线策略联合拦截）',
        'citations 严格来自 record.steps[].result.evidence，禁止 LLM 自造',
        `redLineWarnings 聚合自 scope='${input.scope}' 内全部 step.warnings 去重`,
      ],
      dataLineage: [
        'upstream:workflow.steps',
        `llm-provider:${provider.provider}`,
        'red-line-policy:attach-narrative',
        'sql-guard:adapters/llm/sql-guard',
      ],
      nextSuggestedSkills: [],
    };
  },
};
