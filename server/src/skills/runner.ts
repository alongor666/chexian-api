/**
 * Skill Runner — 阶段 1
 *
 * 责任：
 * 1. inputSchema 校验
 * 2. requiredPermissions 校验
 * 3. 执行 skill.run
 * 4. outputResultSchema 校验
 * 5. 落盘 SkillRunRecord
 *
 * 红线警告注入留到阶段 2（red-line-policy.ts）
 */

import { AppError } from '../middleware/error.js';
import type { Skill, SkillContext, SkillResult, SkillRunRecord } from './types.js';
import { saveRun, generateRunId } from './run-store.js';

export interface RunSkillOptions {
  /** 是否落盘运行记录，默认 true */
  persist?: boolean;
}

export async function runSkill<R = unknown>(
  skill: Skill<any, R>,
  rawInput: unknown,
  ctx: SkillContext,
  options: RunSkillOptions = {}
): Promise<{ runId: string; result: SkillResult<R> }> {
  const persist = options.persist ?? true;
  const runId = generateRunId(skill.id);
  const startedAt = ctx.startedAt;

  // 1. inputSchema 校验
  const parsedInput = skill.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const issue = parsedInput.error.issues[0];
    const path = issue?.path.join('.') || 'input';
    throw new AppError(400, `Skill ${skill.id} input invalid: ${path} - ${issue?.message ?? 'unknown'}`);
  }

  // 2. 权限校验
  if (skill.requiredPermissions?.length) {
    const role = ctx.role ?? '';
    const hasAll = skill.requiredPermissions.every((p) => role === 'branch_admin' || role === p);
    if (!hasAll) {
      throw new AppError(403, `Skill ${skill.id} requires permissions: ${skill.requiredPermissions.join(', ')}`);
    }
  }

  // 3. 执行
  let result: SkillResult<R>;
  let status: 'success' | 'failed' = 'success';
  let error: string | undefined;
  try {
    result = await skill.run(parsedInput.data, ctx);
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    if (persist) {
      await saveRun(buildFailedRecord(runId, skill, ctx, parsedInput.data, error));
    }
    throw err;
  }

  // 4. outputResultSchema 校验（仅校验 result 字段，evidence/warnings 由约定结构保证）
  const parsedResult = skill.outputResultSchema.safeParse(result.result);
  if (!parsedResult.success) {
    const issue = parsedResult.error.issues[0];
    throw new AppError(
      500,
      `Skill ${skill.id} output invalid: ${issue?.path.join('.')} - ${issue?.message ?? 'unknown'}`
    );
  }

  // 5. 落盘
  if (persist) {
    const finishedAt = new Date();
    const record: SkillRunRecord = {
      runId,
      skillId: skill.id,
      skillVersion: skill.version,
      status,
      userId: ctx.userId,
      username: ctx.username,
      requestId: ctx.requestId,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt,
      input: parsedInput.data,
      output: result,
    };
    await saveRun(record);
  }

  return { runId, result };
}

function buildFailedRecord(
  runId: string,
  skill: Skill<any, any>,
  ctx: SkillContext,
  input: unknown,
  error: string
): SkillRunRecord {
  const finishedAt = new Date();
  return {
    runId,
    skillId: skill.id,
    skillVersion: skill.version,
    status: 'failed',
    userId: ctx.userId,
    username: ctx.username,
    requestId: ctx.requestId,
    startedAt: new Date(ctx.startedAt).toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - ctx.startedAt,
    input,
    error,
  };
}
