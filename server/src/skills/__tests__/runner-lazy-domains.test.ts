/**
 * runner.ts lazy 域加载落盘测试 — 接 codex P2
 *
 * 验证：当 skill.lazyDomains 加载失败时，runner 必须落盘 failed run record，
 * 保留可观测性（与 skill.run 异常的落盘行为一致）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Skill, SkillContext } from '../types.js';

const saveRunMock = vi.fn(async (_record: unknown) => {});
const ensureDomainLoadedMock = vi.fn(async (_domain: string) => {});

vi.mock('../run-store.js', () => ({
  saveRun: saveRunMock,
  generateRunId: (skillId: string) => `sr_test_${skillId}_abcd1234`,
}));

vi.mock('../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: () => ({
    ensureDomainLoaded: ensureDomainLoadedMock,
  }),
}));

const { runSkill } = await import('../runner.js');

const ctx: SkillContext = {
  userId: 'u1',
  username: 'u1',
  role: 'admin',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
};

const InputSchema = z.object({});
const ResultSchema = z.object({ ok: z.boolean() });

const makeSkill = (lazyDomains?: string[]): Skill<typeof InputSchema, { ok: boolean }> => ({
  id: 'test-skill',
  name: 'test',
  version: '1.0.0',
  description: '',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  lazyDomains,
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

beforeEach(() => {
  saveRunMock.mockClear();
  ensureDomainLoadedMock.mockReset();
  ensureDomainLoadedMock.mockImplementation(async () => {});
});

describe('runner — lazyDomains 落盘行为', () => {
  it('lazy 域加载成功 → skill 执行 → success record 落盘', async () => {
    const skill = makeSkill(['ClaimsAgg']);
    const { runId, result } = await runSkill(skill, {}, ctx);
    expect(ensureDomainLoadedMock).toHaveBeenCalledWith('ClaimsAgg');
    expect(result.result.ok).toBe(true);
    expect(saveRunMock).toHaveBeenCalledTimes(1);
    expect(saveRunMock.mock.calls[0][0]).toMatchObject({
      runId,
      status: 'success',
    });
  });

  it('lazy 域加载失败 → 抛 AppError 503 + 落盘 failed record（codex P2）', async () => {
    ensureDomainLoadedMock.mockRejectedValueOnce(new Error('timeout loading ClaimsAgg'));
    const skill = makeSkill(['ClaimsAgg']);
    await expect(runSkill(skill, {}, ctx)).rejects.toThrow(/Lazy domain load failed/);
    expect(saveRunMock).toHaveBeenCalledTimes(1);
    const record = saveRunMock.mock.calls[0][0] as {
      status: string;
      error: string;
      skillId: string;
    };
    expect(record.status).toBe('failed');
    expect(record.skillId).toBe('test-skill');
    expect(record.error).toContain('Lazy domain load failed');
    expect(record.error).toContain('ClaimsAgg');
    expect(record.error).toContain('timeout loading ClaimsAgg');
  });

  it('多 lazy 域，第二个失败 → error 包含全部声明的域名', async () => {
    ensureDomainLoadedMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    const skill = makeSkill(['ClaimsAgg', 'ClaimsDetail']);
    await expect(runSkill(skill, {}, ctx)).rejects.toThrow();
    const record = saveRunMock.mock.calls[0][0] as { error: string };
    expect(record.error).toContain('ClaimsAgg, ClaimsDetail');
  });

  it('persist=false 时 lazy 失败也不落盘', async () => {
    ensureDomainLoadedMock.mockRejectedValueOnce(new Error('boom'));
    const skill = makeSkill(['ClaimsAgg']);
    await expect(runSkill(skill, {}, ctx, { persist: false })).rejects.toThrow();
    expect(saveRunMock).not.toHaveBeenCalled();
  });

  it('skill 无 lazyDomains 时不调 ensureDomainLoaded', async () => {
    const skill = makeSkill();
    await runSkill(skill, {}, ctx);
    expect(ensureDomainLoadedMock).not.toHaveBeenCalled();
  });
});
