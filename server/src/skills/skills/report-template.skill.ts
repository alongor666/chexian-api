/**
 * report-template Skill — 阶段 3
 *
 * 把一次 workflow run 的所有子步骤聚合成 Markdown 报告（确定性，不依赖 LLM）。
 *
 * 设计原则：
 * - 唯一输入：workflowRunId。从 run-store 读取已落盘的 WorkflowRunRecord，绝不重新执行 SQL
 * - 红线 warning 必须显式提取到报告头部「重要声明」段落（CLAUDE.md §10 可见性要求）
 * - dataLineage / assumptions 全部汇总，避免单步 skill 内部各自分散
 * - 失败步骤、跳过步骤、空数据均按显式段落渲染，不抛异常
 * - LLM 叙述增强不在本 Skill 内做，由 routes/copilot.ts 在路由层异步追加
 */

import { z } from 'zod';
import type { Skill, SkillResult } from '../types.js';
import { getWorkflowRun, type WorkflowRunRecord, type WorkflowStepRecord } from '../workflow-runner.js';

const InputSchema = z.object({
  workflowRunId: z.string().regex(/^wr_\d{14}_[a-z0-9-]{1,64}_[0-9a-f]{8}$/, 'invalid workflowRunId'),
  /** 是否在报告头部重复列出红线 warning（默认 true） */
  includeRedLineHeader: z.boolean().default(true),
  /** 是否在末尾追加结构化 JSON 摘要段（默认 false，前端 MVP 阶段 3-D 不需要） */
  includeJsonAppendix: z.boolean().default(false),
});

const SectionSchema = z.object({
  nodeId: z.string(),
  skillId: z.string().optional(),
  status: z.enum(['success', 'failed', 'skipped']),
  title: z.string(),
  markdown: z.string(),
  warningCount: z.number(),
  elapsedMs: z.number(),
});

const ResultSchema = z.object({
  workflowId: z.string(),
  workflowRunId: z.string(),
  workflowStatus: z.enum(['success', 'partial', 'failed', 'pending_approval']),
  generatedAt: z.string(),
  /** 完整 Markdown 字符串 */
  markdown: z.string(),
  sections: z.array(SectionSchema),
  /** 已提取的红线 warning 全集（去重） */
  redLineWarnings: z.array(z.string()),
  /** 全部子 Skill warning（去重，含红线） */
  allWarnings: z.array(z.string()),
  totalElapsedMs: z.number(),
  successCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number(),
});

type Result = z.infer<typeof ResultSchema>;

const STEP_TITLE_MAP: Record<string, string> = {
  'data-health': '一、数据健康检查',
  'kpi-baseline': '二、经营基线',
  'cost-diagnosis': '三、高赔付分组诊断',
  'claims-drilldown': '四、赔案下钻',
  'segment-risk-scan': '五、维度交叉风险扫描',
};

const RISK_LEVEL_LABEL: Record<string, string> = {
  red: '🔴 高风险',
  yellow: '🟡 中风险',
  green: '🟢 低风险',
};

const STATUS_LABEL: Record<string, string> = {
  success: '✅ 成功',
  failed: '❌ 失败',
  skipped: '⏭️ 跳过',
  partial: '⚠️ 部分成功',
  pending_approval: '⏸️ 待审批',
};

/** 千分位 + 万元换算 */
function formatPremiumWan(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const wan = value / 10000;
  return `${wan.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万元`;
}

function formatRatio(value: number | null | undefined, suffix = '%'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}${suffix}`;
}

function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('zh-CN');
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// ───────────────────────── Section Renderers ─────────────────────────

function renderDataHealthSection(result: SkillResult): string {
  const r = result.result as {
    status: 'pass' | 'warning' | 'fail';
    dataConfidence: number;
    rowCount: number;
    availableDomains: string[];
    missingDomains: string[];
    fieldGaps: Array<{ field: string; nullCount: number; nullRatio: number; level: string }>;
  };
  const lines: string[] = [];
  lines.push(`- **状态**：${STATUS_LABEL[r.status === 'pass' ? 'success' : r.status === 'fail' ? 'failed' : 'skipped'] ?? r.status} (${r.status})`);
  lines.push(`- **数据置信度**：${(r.dataConfidence * 100).toFixed(1)}%`);
  lines.push(`- **样本量**：${formatInt(r.rowCount)} 条记录`);
  if (r.missingDomains?.length > 0) {
    lines.push(`- **未加载数据域**：${r.missingDomains.join('、')}`);
  }
  if (r.fieldGaps?.length > 0) {
    lines.push('');
    lines.push('| 字段 | 缺失率 | 等级 |');
    lines.push('| --- | ---: | :---: |');
    for (const g of r.fieldGaps) {
      lines.push(`| ${g.field} | ${(g.nullRatio * 100).toFixed(1)}% | ${g.level} |`);
    }
  }
  return lines.join('\n');
}

function renderKpiBaselineSection(result: SkillResult): string {
  const r = result.result as {
    premium: number;
    policyCount: number;
    reportedClaims: number;
    feeAmount: number;
    earnedClaimRatio: number | null;
    expenseRatio: number | null;
    avgClaimAmount: number | null;
    period: { startDate: string; endDate: string };
  };
  const lines: string[] = [];
  lines.push(`- **周期**：${r.period.startDate} ~ ${r.period.endDate}`);
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | ---: |');
  lines.push(`| 签单保费 | ${formatPremiumWan(r.premium)} |`);
  lines.push(`| 保单件数 | ${formatInt(r.policyCount)} |`);
  lines.push(`| 已报案件赔款 | ${formatPremiumWan(r.reportedClaims)} |`);
  lines.push(`| 费用金额 | ${formatPremiumWan(r.feeAmount)} |`);
  lines.push(`| 满期赔付率 | ${formatRatio(r.earnedClaimRatio)} |`);
  lines.push(`| 费用率 | ${formatRatio(r.expenseRatio)} |`);
  lines.push(`| 案均赔款 | ${formatPremiumWan(r.avgClaimAmount)} |`);
  return lines.join('\n');
}

function renderCostDiagnosisSection(result: SkillResult): string {
  const r = result.result as {
    dimension: string;
    cutoffDate: string;
    totalGroups: number;
    redGroupCount: number;
    yellowGroupCount: number;
    greenGroupCount: number;
    overallEarnedClaimRatio: number | null;
    overallComprehensiveCostRatio: number | null;
    topRiskGroups: Array<{
      dimKey: string;
      policyCount: number;
      totalPremium: number;
      earnedClaimRatio: number | null;
      comprehensiveCostRatio: number | null;
      riskLevel: string;
      premiumShare: number;
    }>;
  };
  const lines: string[] = [];
  lines.push(`- **维度**：${r.dimension} · **截止**：${r.cutoffDate}`);
  lines.push(`- **风险分布**：🔴 ${r.redGroupCount} 组 / 🟡 ${r.yellowGroupCount} 组 / 🟢 ${r.greenGroupCount} 组（共 ${r.totalGroups}）`);
  lines.push(`- **整体满期赔付率**：${formatRatio(r.overallEarnedClaimRatio)}`);
  lines.push(`- **整体综合成本率**：${formatRatio(r.overallComprehensiveCostRatio)}`);
  if (r.topRiskGroups.length > 0) {
    lines.push('');
    lines.push('**Top 风险分组**：');
    lines.push('');
    lines.push('| 分组 | 等级 | 保单数 | 保费 | 满期赔付率 | 综合成本率 | 保费占比 |');
    lines.push('| --- | :---: | ---: | ---: | ---: | ---: | ---: |');
    for (const g of r.topRiskGroups) {
      lines.push(
        `| ${escapeMarkdown(g.dimKey)} | ${RISK_LEVEL_LABEL[g.riskLevel] ?? g.riskLevel} | ${formatInt(g.policyCount)} | ${formatPremiumWan(g.totalPremium)} | ${formatRatio(g.earnedClaimRatio)} | ${formatRatio(g.comprehensiveCostRatio)} | ${(g.premiumShare * 100).toFixed(2)}% |`
      );
    }
  }
  return lines.join('\n');
}

function renderClaimsDrilldownSection(result: SkillResult): string {
  const r = result.result as {
    overview: {
      totalCases: number;
      settledCases: number;
      pendingCases: number;
      bodilyInjuryCases: number;
      bodilyInjuryRate: number | null;
      totalReserveWan: number;
      pendingReserveWan: number;
    };
    topByOrg: Array<{ org: string; cases: number; reserveWan: number; injuryRate: number | null }>;
    topByCause: Array<{ cause: string; cases: number; reserveWan: number; injuryRate: number | null }>;
    signals: string[];
  };
  const lines: string[] = [];
  lines.push('**整体概览**：');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | ---: |');
  lines.push(`| 案件总数 | ${formatInt(r.overview.totalCases)} |`);
  lines.push(`| 已结案 / 未结案 | ${formatInt(r.overview.settledCases)} / ${formatInt(r.overview.pendingCases)} |`);
  lines.push(`| 人伤案件 | ${formatInt(r.overview.bodilyInjuryCases)} (${formatRatio(r.overview.bodilyInjuryRate)}) |`);
  lines.push(`| 准备金合计 | ${r.overview.totalReserveWan.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万元 |`);
  lines.push(`| 未决准备金 | ${r.overview.pendingReserveWan.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万元 |`);

  if (r.topByOrg?.length > 0) {
    lines.push('');
    lines.push('**Top 机构**（按案件数）：');
    lines.push('');
    lines.push('| 机构 | 案件数 | 准备金(万) | 人伤占比 |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const o of r.topByOrg) {
      lines.push(`| ${escapeMarkdown(o.org)} | ${formatInt(o.cases)} | ${o.reserveWan.toFixed(1)} | ${formatRatio(o.injuryRate)} |`);
    }
  }
  if (r.topByCause?.length > 0) {
    lines.push('');
    lines.push('**Top 原因**：');
    lines.push('');
    lines.push('| 原因 | 案件数 | 准备金(万) | 人伤占比 |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const c of r.topByCause) {
      lines.push(`| ${escapeMarkdown(c.cause)} | ${formatInt(c.cases)} | ${c.reserveWan.toFixed(1)} | ${formatRatio(c.injuryRate)} |`);
    }
  }
  if (r.signals?.length > 0) {
    lines.push('');
    lines.push('**风险信号**：');
    for (const s of r.signals) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}

function renderSegmentRiskScanSection(result: SkillResult): string {
  const r = result.result as {
    dimensions: string[];
    cutoffDate: string;
    baselineEarnedClaimRatio: number | null;
    totalSegments: number;
    redCount: number;
    yellowCount?: number;
    greenCount?: number;
    topRiskSegments: Array<{
      dimKey: string;
      policyCount: number;
      rawEarnedClaimRatio: number | null;
      adjustedEarnedClaimRatio: number | null;
      credibility: number;
      riskLevel: string;
    }>;
  };
  const lines: string[] = [];
  lines.push(`- **维度组合**：${r.dimensions.join(' × ')}`);
  lines.push(`- **基线满期赔付率**：${formatRatio(r.baselineEarnedClaimRatio)}`);
  lines.push(`- **高风险 segment**：${r.redCount} 个（共 ${r.totalSegments}）`);
  if (r.topRiskSegments?.length > 0) {
    lines.push('');
    lines.push('**Top 风险 segment**：');
    lines.push('');
    lines.push('| 组合 | 保单数 | 原赔付率 | credibility | 修正后 | 等级 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | :---: |');
    for (const s of r.topRiskSegments) {
      lines.push(
        `| ${escapeMarkdown(s.dimKey)} | ${formatInt(s.policyCount)} | ${formatRatio(s.rawEarnedClaimRatio)} | ${s.credibility.toFixed(3)} | ${formatRatio(s.adjustedEarnedClaimRatio)} | ${RISK_LEVEL_LABEL[s.riskLevel] ?? s.riskLevel} |`
      );
    }
  }
  return lines.join('\n');
}

const SECTION_RENDERERS: Record<string, (result: SkillResult) => string> = {
  'data-health': renderDataHealthSection,
  'kpi-baseline': renderKpiBaselineSection,
  'cost-diagnosis': renderCostDiagnosisSection,
  'claims-drilldown': renderClaimsDrilldownSection,
  'segment-risk-scan': renderSegmentRiskScanSection,
};

function renderGenericSection(result: SkillResult): string {
  // 兜底：用 JSON code-fence 显示，不抛错
  return '```json\n' + JSON.stringify(result.result, null, 2).slice(0, 2000) + '\n```';
}

function renderFailedSection(step: WorkflowStepRecord): string {
  return `- **状态**：❌ 失败\n- **错误**：${step.error ?? '未知错误'}\n- **耗时**：${step.elapsedMs}ms`;
}

function renderSkippedSection(step: WorkflowStepRecord): string {
  return `- **状态**：⏭️ 跳过\n- **原因**：${step.error ?? '上游分支未命中或被前置节点中断'}`;
}

// ───────────────────────── Main Renderer ─────────────────────────

interface SectionData {
  nodeId: string;
  skillId?: string;
  status: 'success' | 'failed' | 'skipped';
  title: string;
  markdown: string;
  warningCount: number;
  elapsedMs: number;
}

function buildSection(step: WorkflowStepRecord): SectionData {
  const skillId = step.skillId ?? '';
  const title = STEP_TITLE_MAP[skillId] ?? `节点：${step.nodeId}${skillId ? ` (${skillId})` : ''}`;

  if (step.status === 'failed') {
    return {
      nodeId: step.nodeId,
      skillId: step.skillId,
      status: 'failed',
      title,
      markdown: renderFailedSection(step),
      warningCount: 0,
      elapsedMs: step.elapsedMs,
    };
  }
  if (step.status === 'skipped') {
    return {
      nodeId: step.nodeId,
      skillId: step.skillId,
      status: 'skipped',
      title,
      markdown: renderSkippedSection(step),
      warningCount: 0,
      elapsedMs: step.elapsedMs,
    };
  }

  const result = step.result;
  if (!result) {
    return {
      nodeId: step.nodeId,
      skillId: step.skillId,
      status: 'skipped',
      title,
      markdown: '- 无结果数据',
      warningCount: 0,
      elapsedMs: step.elapsedMs,
    };
  }

  const renderer = skillId && SECTION_RENDERERS[skillId] ? SECTION_RENDERERS[skillId] : renderGenericSection;
  const markdown = renderer(result);
  return {
    nodeId: step.nodeId,
    skillId: step.skillId,
    status: 'success',
    title,
    markdown,
    warningCount: result.warnings?.length ?? 0,
    elapsedMs: step.elapsedMs,
  };
}

function collectAllWarnings(record: WorkflowRunRecord): { all: string[]; redLine: string[] } {
  const all = new Set<string>();
  const redLineKeywords = ['未经业务字典确认', '未经精算建模', '未纳入客户流失', '不构成定价建议', '未经核保人工审核'];
  for (const step of record.steps) {
    const ws = step.result?.warnings ?? [];
    for (const w of ws) all.add(w);
    if (step.children) {
      for (const c of step.children) {
        for (const w of c.result?.warnings ?? []) all.add(w);
      }
    }
  }
  const allArr = [...all];
  const redLine = allArr.filter((w) => redLineKeywords.some((kw) => w.includes(kw)));
  return { all: allArr, redLine };
}

function renderHeader(
  record: WorkflowRunRecord,
  redLineWarnings: string[],
  includeRedLineHeader: boolean
): string {
  const lines: string[] = [];
  lines.push(`# ${record.workflowId} 经营巡检报告`);
  lines.push('');
  lines.push(`> **运行 ID**：\`${record.runId}\``);
  lines.push(`> **状态**：${STATUS_LABEL[record.status] ?? record.status}`);
  lines.push(`> **开始**：${record.startedAt}`);
  lines.push(`> **结束**：${record.finishedAt}`);
  lines.push(`> **耗时**：${record.elapsedMs}ms`);
  lines.push('');
  if (includeRedLineHeader && redLineWarnings.length > 0) {
    lines.push('## ⚠️ 重要声明（红线 warning）');
    lines.push('');
    for (const w of redLineWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
    lines.push('> 以上为系统强制注入的红线 warning，对应 CLAUDE.md §10 业务字典未确认口径。');
    lines.push('');
  }
  return lines.join('\n');
}

export const reportTemplateSkill: Skill<typeof InputSchema, Result> = {
  id: 'report-template',
  name: '工作流模板报告',
  version: '1.0.0',
  description: '基于已落盘的 workflow run 生成确定性 Markdown 报告（不调用 LLM）',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  async run(input, ctx) {
    // 直接被路由层或测试调用时，input 可能未经 inputSchema parse → 显式应用 default
    const parsed = InputSchema.parse(input);
    const record = await getWorkflowRun(parsed.workflowRunId);
    if (!record) {
      throw new Error(`Workflow run not found: ${parsed.workflowRunId}`);
    }

    // 鉴权：调用方只能看到自己的 run（branch_admin 例外）
    if (ctx.role !== 'branch_admin' && record.username !== ctx.username) {
      throw new Error(`Workflow run ${input.workflowRunId} not accessible to user ${ctx.username}`);
    }

    const sections = record.steps.map(buildSection);
    const { all: allWarnings, redLine: redLineWarnings } = collectAllWarnings(record);

    const successCount = sections.filter((s) => s.status === 'success').length;
    const failedCount = sections.filter((s) => s.status === 'failed').length;
    const skippedCount = sections.filter((s) => s.status === 'skipped').length;

    const parts: string[] = [];
    parts.push(renderHeader(record, redLineWarnings, parsed.includeRedLineHeader));
    for (const s of sections) {
      parts.push(`## ${s.title}`);
      parts.push('');
      parts.push(s.markdown);
      parts.push('');
    }

    if (parsed.includeJsonAppendix) {
      parts.push('## 附录：结构化摘要');
      parts.push('');
      parts.push('```json');
      parts.push(
        JSON.stringify(
          {
            workflowId: record.workflowId,
            workflowStatus: record.status,
            elapsedMs: record.elapsedMs,
            stepCounts: { success: successCount, failed: failedCount, skipped: skippedCount },
          },
          null,
          2
        )
      );
      parts.push('```');
      parts.push('');
    }

    const markdown = parts.join('\n');

    return {
      result: {
        workflowId: record.workflowId,
        workflowRunId: record.runId,
        workflowStatus: record.status,
        generatedAt: new Date(ctx.startedAt).toISOString(),
        markdown,
        sections: sections.map((s) => ({
          nodeId: s.nodeId,
          skillId: s.skillId,
          status: s.status,
          title: s.title,
          markdown: s.markdown,
          warningCount: s.warningCount,
          elapsedMs: s.elapsedMs,
        })),
        redLineWarnings,
        allWarnings,
        totalElapsedMs: record.elapsedMs,
        successCount,
        failedCount,
        skippedCount,
      },
      evidence: [
        { metric: 'workflow_status', value: record.status, source: `workflow-runs/${record.runId}.json`, note: `${successCount} 成功 / ${failedCount} 失败 / ${skippedCount} 跳过` },
        { metric: 'red_line_warning_count', value: redLineWarnings.length, source: 'red-line-policy', note: 'CLAUDE.md §10 强制可见性' },
      ],
      confidence: failedCount === 0 ? 1.0 : Math.max(0.3, successCount / Math.max(1, sections.length)),
      warnings: failedCount > 0 ? [`报告基于 partial 工作流：${failedCount} 步失败、${skippedCount} 步跳过`] : [],
      assumptions: [
        `输入仅为 workflowRunId，不重新执行 SQL`,
        `RBAC：调用方 role=${ctx.role}，只能读取自己（或 branch_admin 全表）`,
      ],
      dataLineage: [`workflow-runs/${record.runId}.json`],
      nextSuggestedSkills: [],
    };
  },
};
