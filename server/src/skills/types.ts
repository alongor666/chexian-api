/**
 * Skill 运行时类型 — 阶段 1 基础设施
 *
 * 设计原则：
 * - inputSchema / outputSchema 用 zod 做强约束（zod 4.3.6 已装）
 * - SkillResult 标准结构：result + evidence + confidence + warnings + dataLineage
 * - SkillContext 包含 RBAC + 行级过滤 + trace，全部可由 routes 注入
 * - deterministic=true 的 Skill 不允许调用 LLM（runner 强制校验）
 */

import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────
// SkillContext — 路由注入，Skill 内部只读
// ──────────────────────────────────────────────────────────────────────────

export interface SkillContext {
  userId: string;
  username: string;
  role: string;
  organization?: string;
  /**
   * 用户功能开关（可选）。未提供时 runner 在校验 requiredPermissions 前按 username
   * 从 access-control 存储解析（middleware/special-feature.ts resolveSpecialFeatures）。
   */
  specialFeatures?: string[];
  /** 行级过滤 SQL WHERE 子句，由 permissionMiddleware 生成 */
  permissionFilter: string;
  /** 请求追踪 ID（与 X-Request-Id 一致） */
  requestId: string;
  /** Skill 运行起始时间戳 */
  startedAt: number;
  now: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// 标准输入：所有业务 Skill 都接受 PeriodInput
// ──────────────────────────────────────────────────────────────────────────

export const PeriodSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
});

export type Period = z.infer<typeof PeriodSchema>;

// ──────────────────────────────────────────────────────────────────────────
// 标准输出：SkillResult
// ──────────────────────────────────────────────────────────────────────────

export const EvidenceItemSchema = z.object({
  metric: z.string().optional(),
  value: z.unknown().optional(),
  source: z.string(),
  note: z.string().optional(),
});

export const SkillResultSchema = z.object({
  result: z.unknown(),
  evidence: z.array(EvidenceItemSchema),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  assumptions: z.array(z.string()).default([]),
  dataLineage: z.array(z.string()).default([]),
  nextSuggestedSkills: z.array(z.string()).default([]),
});

export type SkillResult<R = unknown> = Omit<z.infer<typeof SkillResultSchema>, 'result'> & {
  result: R;
};

// ──────────────────────────────────────────────────────────────────────────
// Skill 接口
// ──────────────────────────────────────────────────────────────────────────

export interface Skill<I extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
  id: string;
  name: string;
  version: string;
  description: string;
  inputSchema: I;
  outputResultSchema: z.ZodType<R>;
  /**
   * 必需的功能开关（取值为 specialFeatures 项，如 'cost'）。runner 对照用户
   * specialFeatures 校验（超管恒通过），与角色无关——角色边界由路由层 requireRole 承担。
   */
  requiredPermissions?: string[];
  /** 是否纯确定性（不调用 LLM）。runner 据此强制校验 */
  deterministic: boolean;
  /**
   * 是否需要人工审批后才能在 workflow 中继续向下游传递结果。阶段 4 起：
   * - `risk-scoring` / `pricing-simulation` / `underwriting-recommendation` 设为 true
   * - workflow-runner 的 ApprovalNode 检测下游 skill 的 requiresApproval=true 时
   *   会挂起为 status='pending_approval'（routes/workflows.ts 在阶段 4 PR-B 启用）
   * - 路由层（routes/skills.ts）当前不阻断单步执行，但 listSkills() 会暴露此元数据
   *   以便前端 UI 标注「此结果未经审批，禁止直接执行落库」
   */
  requiresApproval?: boolean;
  /**
   * Skill SQL 依赖的 lazy 注册域（如 ClaimsAgg / ClaimsDetail / CrossSell 等）。
   * runner 在执行前调 bootstrapper.ensureDomainLoaded() 触发加载，避免冷启动后
   * 第一次调用直接 Catalog Error。完整域列表见 data-bootstrapper.ts:registerLazyDomains()。
   */
  lazyDomains?: readonly string[];
  run(input: z.infer<I>, ctx: SkillContext): Promise<SkillResult<R>>;
}

// ──────────────────────────────────────────────────────────────────────────
// SkillRun — 持久化记录
// ──────────────────────────────────────────────────────────────────────────

export interface SkillRunRecord {
  runId: string;
  skillId: string;
  skillVersion: string;
  status: 'success' | 'failed';
  userId: string;
  username: string;
  requestId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  input: unknown;
  output?: unknown;
  error?: string;
}
