/**
 * workflow-runner 单元测试 — 阶段 2
 *
 * 用 mock skill 验证状态机：sequential / parallel / branch / skip-and-continue。
 * 不触碰 DuckDB / 真实 SQL，纯逻辑测试。
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runWorkflow, type WorkflowDef } from '../workflow-runner.js';
import type { Skill, SkillContext, SkillResult } from '../types.js';

const ctx: SkillContext = {
  userId: 'u1',
  username: 'u1',
  role: 'admin',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
};

const ResultSchema = z.object({ ok: z.boolean(), tag: z.string().optional() });

function makeOkSkill(id: string, tag: string): Skill<typeof InputSchema, z.infer<typeof ResultSchema>> {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'test',
    inputSchema: InputSchema,
    outputResultSchema: ResultSchema,
    deterministic: true,
    async run() {
      return {
        result: { ok: true, tag },
        evidence: [],
        confidence: 1,
        warnings: [],
        assumptions: [],
        dataLineage: [],
        nextSuggestedSkills: [],
      } as SkillResult<z.infer<typeof ResultSchema>>;
    },
  };
}

function makeFailSkill(id: string): Skill<typeof InputSchema, z.infer<typeof ResultSchema>> {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'test',
    inputSchema: InputSchema,
    outputResultSchema: ResultSchema,
    deterministic: true,
    async run() {
      throw new Error(`boom-${id}`);
    },
  };
}

const InputSchema = z.object({ x: z.number().default(0) });

const wf = (nodes: WorkflowDef<typeof InputSchema>['nodes']): WorkflowDef<typeof InputSchema> => ({
  id: 'wf-test',
  name: 'wf-test',
  version: '1.0.0',
  description: '',
  inputSchema: InputSchema,
  nodes,
});

describe('runWorkflow — sequential', () => {
  it('全部成功 → status=success', async () => {
    const skills = [makeOkSkill('a', 'A'), makeOkSkill('b', 'B')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        { id: 'n1', type: 'sequential', skillId: 'a' },
        { id: 'n2', type: 'sequential', skillId: 'b' },
      ]),
      { x: 1 },
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.status).toBe('success');
    expect(record.steps).toHaveLength(2);
    expect(record.steps[0].status).toBe('success');
    expect(record.steps[1].status).toBe('success');
  });

  it('skip-and-continue：单步失败 → 后续继续，整体 partial', async () => {
    const skills = [makeOkSkill('a', 'A'), makeFailSkill('b'), makeOkSkill('c', 'C')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        { id: 'n1', type: 'sequential', skillId: 'a' },
        { id: 'n2', type: 'sequential', skillId: 'b', onFailure: 'skip-and-continue' },
        { id: 'n3', type: 'sequential', skillId: 'c' },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.status).toBe('partial');
    expect(record.steps[0].status).toBe('success');
    expect(record.steps[1].status).toBe('failed');
    expect(record.steps[1].error).toContain('boom-b');
    expect(record.steps[2].status).toBe('success'); // 继续
  });

  it('onFailure=stop：失败立即终止 → status=failed', async () => {
    const skills = [makeOkSkill('a', 'A'), makeFailSkill('b'), makeOkSkill('c', 'C')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        { id: 'n1', type: 'sequential', skillId: 'a' },
        { id: 'n2', type: 'sequential', skillId: 'b', onFailure: 'stop' },
        { id: 'n3', type: 'sequential', skillId: 'c' },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.status).toBe('failed');
    expect(record.steps).toHaveLength(2); // n3 未执行
  });

  it('inputBuilder 可访问之前节点的 result', async () => {
    let captured: unknown = null;
    const echo: Skill<typeof InputSchema, z.infer<typeof ResultSchema>> = {
      id: 'echo',
      name: 'echo',
      version: '1.0.0',
      description: '',
      inputSchema: InputSchema,
      outputResultSchema: ResultSchema,
      deterministic: true,
      async run(input) {
        captured = input;
        return { result: { ok: true }, evidence: [], confidence: 1, warnings: [], assumptions: [], dataLineage: [], nextSuggestedSkills: [] };
      },
    };
    const skills = [makeOkSkill('a', 'tag-A'), echo];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    await runWorkflow(
      wf([
        { id: 'first', type: 'sequential', skillId: 'a' },
        {
          id: 'second',
          type: 'sequential',
          skillId: 'echo',
          inputBuilder: (c) => ({ x: 99, prevTag: (c.results.first?.result as { tag?: string } | undefined)?.tag }),
        },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(captured).toMatchObject({ x: 99 });
  });
});

describe('runWorkflow — parallel', () => {
  it('所有 branch 成功 → status=success', async () => {
    const skills = [makeOkSkill('a', 'A'), makeOkSkill('b', 'B')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        {
          id: 'pn',
          type: 'parallel',
          branches: [
            { id: 'ba', skillId: 'a' },
            { id: 'bb', skillId: 'b' },
          ],
        },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.status).toBe('success');
    expect(record.steps[0].children?.length).toBe(2);
    expect(record.steps[0].children?.every((c) => c.status === 'success')).toBe(true);
  });

  it('部分 branch 失败 → 节点 status=skipped, 整体 partial', async () => {
    const skills = [makeOkSkill('a', 'A'), makeFailSkill('b')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        {
          id: 'pn',
          type: 'parallel',
          branches: [
            { id: 'ba', skillId: 'a' },
            { id: 'bb', skillId: 'b' },
          ],
        },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.status).toBe('partial');
    expect(record.steps[0].status).toBe('skipped');
    expect(record.steps[0].children?.find((c) => c.branchId === 'bb')?.status).toBe('failed');
  });
});

describe('runWorkflow — branch', () => {
  it('case 命中 → 执行对应 skill', async () => {
    const skills = [makeOkSkill('high', 'HIGH'), makeOkSkill('low', 'LOW')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        {
          id: 'br',
          type: 'branch',
          cases: [
            { id: 'is-high', when: (c) => (c.runInput as { x: number }).x > 50, skillId: 'high' },
            { id: 'is-low', when: () => true, skillId: 'low' },
          ],
        },
      ]),
      { x: 80 },
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.steps[0].skillId).toBe('high');
  });

  it('无 case 命中且无 fallback → skipped, 整体 status 不下调', async () => {
    const skills = [makeOkSkill('x', 'X')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        {
          id: 'br',
          type: 'branch',
          cases: [{ id: 'never', when: () => false, skillId: 'x' }],
        },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.steps[0].status).toBe('skipped');
    expect(record.status).toBe('success');
  });

  it('fallback 在无命中时执行', async () => {
    const skills = [makeOkSkill('x', 'X'), makeOkSkill('fb', 'FB')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const { record } = await runWorkflow(
      wf([
        {
          id: 'br',
          type: 'branch',
          cases: [{ id: 'never', when: () => false, skillId: 'x' }],
          fallback: { skillId: 'fb' },
        },
      ]),
      {},
      ctx,
      { resolveSkill: (id) => map.get(id), persist: false }
    );
    expect(record.steps[0].status).toBe('success');
    expect(record.steps[0].skillId).toBe('fb');
  });
});

describe('runWorkflow — input validation', () => {
  it('inputSchema 校验失败 → 抛错', async () => {
    const strictWf: WorkflowDef<z.ZodObject<{ y: z.ZodString }>> = {
      id: 'strict',
      name: 'strict',
      version: '1.0.0',
      description: '',
      inputSchema: z.object({ y: z.string() }),
      nodes: [],
    };
    await expect(
      runWorkflow(strictWf, { y: 123 }, ctx, { resolveSkill: () => undefined, persist: false })
    ).rejects.toThrow(/input invalid/);
  });

  it('未注册的 skill → 节点 failed, 整体 partial', async () => {
    const { record } = await runWorkflow(
      wf([{ id: 'n', type: 'sequential', skillId: 'missing' }]),
      {},
      ctx,
      { resolveSkill: () => undefined, persist: false }
    );
    expect(record.status).toBe('partial');
    expect(record.steps[0].status).toBe('failed');
    expect(record.steps[0].error).toContain('skill not found');
  });
});
