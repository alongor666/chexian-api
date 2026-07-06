/**
 * runner.ts requiredPermissions 语义测试（权限治理 Critical-1 / Medium）
 *
 * 历史 bug：校验曾写成 `role === p`，p 是功能名（'cost'）、role 是角色枚举，永不相等，
 * 声明形同虚设（branch_admin 全过、其余全拒）。新语义：对照用户 specialFeatures，
 * 超管（admin / xuechenglong）恒通过；ctx 未带 specialFeatures 时按 username 解析。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Skill, SkillContext } from '../types.js';

const saveRunMock = vi.fn(async (_record: unknown) => {});
const resolveSpecialFeaturesMock = vi.fn(async (_username: string): Promise<string[] | undefined> => undefined);

vi.mock('../run-store.js', () => ({
  saveRun: saveRunMock,
  generateRunId: (skillId: string) => `sr_test_${skillId}_abcd1234`,
}));

vi.mock('../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: () => null,
}));

vi.mock('../../middleware/special-feature.js', () => ({
  isSuperUser: (username?: string) => username === 'admin' || username === 'xuechenglong',
  resolveSpecialFeatures: (username: string) => resolveSpecialFeaturesMock(username),
}));

const { runSkill } = await import('../runner.js');

const InputSchema = z.object({});
const ResultSchema = z.object({ ok: z.boolean() });

const makeSkill = (requiredPermissions?: string[]): Skill<typeof InputSchema, { ok: boolean }> => ({
  id: 'perm-test-skill',
  name: 'perm-test',
  version: '1.0.0',
  description: '',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  requiredPermissions,
  async run() {
    return {
      result: { ok: true },
      evidence: [],
      confidence: 1,
      warnings: [],
      assumptions: [],
      dataLineage: [],
      nextSuggestedSkills: [],
    };
  },
});

const makeCtx = (overrides: Partial<SkillContext> = {}): SkillContext => ({
  userId: 'u1',
  username: 'alice',
  role: 'branch_admin',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
  ...overrides,
});

beforeEach(() => {
  saveRunMock.mockClear();
  resolveSpecialFeaturesMock.mockReset();
  resolveSpecialFeaturesMock.mockResolvedValue(undefined);
});

describe('runner — requiredPermissions 对照 specialFeatures', () => {
  it('ctx.specialFeatures 含所需开关 → 放行', async () => {
    const { result } = await runSkill(
      makeSkill(['cost']),
      {},
      makeCtx({ specialFeatures: ['cost'] }),
      { persist: false },
    );
    expect(result.result.ok).toBe(true);
  });

  it('ctx.specialFeatures 不含所需开关 → 403（branch_admin 不再无条件通过）', async () => {
    await expect(
      runSkill(makeSkill(['cost']), {}, makeCtx({ specialFeatures: [] }), { persist: false }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('超管 username 恒通过（即使无 specialFeatures）', async () => {
    const { result } = await runSkill(
      makeSkill(['cost']),
      {},
      makeCtx({ username: 'admin', specialFeatures: [] }),
      { persist: false },
    );
    expect(result.result.ok).toBe(true);
  });

  it('ctx 未带 specialFeatures → 按 username 解析后放行', async () => {
    resolveSpecialFeaturesMock.mockResolvedValue(['cost']);
    const { result } = await runSkill(makeSkill(['cost']), {}, makeCtx(), { persist: false });
    expect(result.result.ok).toBe(true);
    expect(resolveSpecialFeaturesMock).toHaveBeenCalledWith('alice');
  });

  it('解析结果为 undefined（用户无开关定义）→ 403', async () => {
    resolveSpecialFeaturesMock.mockResolvedValue(undefined);
    await expect(
      runSkill(makeSkill(['cost']), {}, makeCtx(), { persist: false }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('未声明 requiredPermissions 的 skill 不受影响（零行为变化）', async () => {
    const { result } = await runSkill(makeSkill(), {}, makeCtx(), { persist: false });
    expect(result.result.ok).toBe(true);
    expect(resolveSpecialFeaturesMock).not.toHaveBeenCalled();
  });
});
