/**
 * Loop v2 调度/质量/进化 纯函数单测（无文件系统、无时钟依赖 → CI 可跑）。
 *
 * 被测：scripts/loop/{dispatch,quality-report,automation-due}.mjs 的导出纯函数。
 * 安全核心：调度的「域互斥独立集」「deps/inflight/gated 排除」「过期分类」必须确定可复现。
 */
import { describe, it, expect } from 'vitest';
import { foldBacklog, bucketOf, taskDomains, computeFrontier } from '../dispatch.mjs';
import { parseLedger, aggregate } from '../quality-report.mjs';
import { scanEntries, classify, isoAddDays } from '../automation-due.mjs';

const J = (o) => JSON.stringify(o);

describe('dispatch.foldBacklog', () => {
  it('create→status→amend 折叠为当前态', () => {
    const lines = [
      J({ uid: 'a', kind: 'create', desc: 'A', code: 'src/x.ts', priority: 'P2', section: 's' }),
      J({ uid: 'b', kind: 'create', desc: 'B', code: 'server/src/sql/y.ts', priority: 'P1' }),
      J({ uid: 'a', kind: 'status', status: 'DONE' }),
      J({ uid: 'b', kind: 'amend', priority: 'P0' }),
      '',
      'not-json',
    ];
    const t = foldBacklog(lines);
    expect(t.map((x) => x.uid)).toEqual(['a', 'b']);
    expect(t[0].status).toBe('DONE');
    expect(t[1].priority).toBe('P0');
  });
});

describe('dispatch.bucketOf', () => {
  it('路径→粗粒度域桶', () => {
    expect(bucketOf('src/features/x.tsx')).toBe('frontend');
    expect(bucketOf('server/src/sql/kpi.ts')).toBe('be-sql');
    expect(bucketOf('server/src/routes/query/x.ts')).toBe('be-routes');
    expect(bucketOf('server/src/services/duckdb-domain-loaders.ts')).toBe('be-services');
    expect(bucketOf('server/src/config/preset-users.ts')).toBe('be-config');
    expect(bucketOf('数据管理/pipelines/transform.py')).toBe('etl');
    expect(bucketOf('scripts/loop/dispatch.mjs')).toBe('scripts');
    expect(bucketOf('  ')).toBe(null);
  });
  it('归一化旧 backlog code 噪声（反引号/粗体/<br>/:行号）', () => {
    expect(bucketOf('`server/src/sql/kpi.ts:58-63`')).toBe('be-sql');
    expect(bucketOf('**server/src/routes/query/x.ts**')).toBe('be-routes');
    expect(bucketOf('src/a.tsx<br>')).toBe('frontend');
    expect(bucketOf('server/src/config/env.ts:127')).toBe('be-config');
  });
});

describe('dispatch.taskDomains', () => {
  it('从 code 字段取域，override 优先', () => {
    expect([...taskDomains({ uid: 'a', code: 'src/a.tsx, server/src/sql/b.ts' })].sort())
      .toEqual(['be-sql', 'frontend']);
    expect([...taskDomains({ uid: 'a', code: 'src/a.tsx' }, { a: { domain: ['custom'] } })])
      .toEqual(['custom']);
  });
});

describe('dispatch.computeFrontier', () => {
  const tasks = [
    { uid: 'g7', code: 'server/src/config/preset-users.ts', priority: 'P1', status: 'PROPOSED' },
    { uid: 'g8', code: 'src/x.tsx', priority: 'P2', status: 'PROPOSED' },
    { uid: 'rls', code: 'server/src/services/a.ts,server/src/sql/b.ts', priority: 'P1', status: 'PARTIAL' },
    { uid: 'sql2', code: 'server/src/sql/c.ts', priority: 'P1', status: 'PROPOSED' }, // 与 rls 域冲突(be-sql)
    { uid: 'doneX', code: 'src/y.tsx', priority: 'P0', status: 'DONE' },
    { uid: 'blk', code: 'server/src/config/z.ts', priority: 'P0', status: 'BLOCKED' },
  ];

  it('取域互斥独立集；域冲突者推迟；DONE/BLOCKED 不进前沿', () => {
    const r = computeFrontier(tasks, {});
    const f = r.frontier.map((x) => x.task.uid).sort();
    // g7(be-config) / g8(frontend) / rls(be-services+be-sql) 三者域互斥 → 同波；sql2 与 rls 撞 be-sql → 推迟
    expect(f).toEqual(['g7', 'g8', 'rls']);
    expect(r.deferred.map((d) => d.task.uid)).toContain('sql2');
    expect(r.blocked.map((b) => b.uid)).toEqual(['blk']);
  });

  it('deps 未完成 → 不就绪；完成 → 就绪', () => {
    const r1 = computeFrontier(tasks, { deps: { g7: ['sql2'] } });
    expect(r1.frontier.map((x) => x.task.uid)).not.toContain('g7'); // sql2 未 DONE
    const r2 = computeFrontier(tasks, { deps: { g8: ['doneX'] } });
    expect(r2.frontier.map((x) => x.task.uid)).toContain('g8'); // doneX 已 DONE
  });

  it('inflight 与 gated 排除出前沿', () => {
    const r = computeFrontier(tasks, { inflight: ['g7'], tasks: { g8: { gated: true } } });
    const f = r.frontier.map((x) => x.task.uid);
    expect(f).not.toContain('g7');
    expect(f).not.toContain('g8');
    expect(f).toContain('rls');
  });

  it('缺 code/域 → 不冒进，推迟待人工指派', () => {
    const r = computeFrontier([{ uid: 'nocode', code: '', priority: 'P1', status: 'PROPOSED' }], {});
    expect(r.frontier).toHaveLength(0);
    expect(r.deferred[0].reason).toMatch(/no-domain/);
  });
});

describe('quality-report.aggregate', () => {
  const rows = [
    { uid: 'a', round: 'R1', domain: ['be-sql'], rounds_to_green: 1, rework_count: 0, codex_plan: { P0: 0, P1: 1 }, codex_done: { P2: 1 }, verifier_refuted: 0, governance_pass: true, tests_added: 3, verdict: 'pass' },
    { uid: 'b', round: 'R1', domain: ['frontend'], rounds_to_green: 3, rework_count: 2, codex_plan: { P0: 1 }, codex_done: {}, verifier_refuted: 1, governance_pass: true, tests_added: 2, verdict: 'pass' },
    { uid: 'c', round: 'R2', domain: ['be-sql'], rounds_to_green: 1, rework_count: 1, governance_pass: false, tests_added: 0, verdict: 'reverted' },
  ];
  it('parseLedger 跳过坏行', () => {
    expect(parseLedger([J(rows[0]), '', 'bad', J(rows[1])])).toHaveLength(2);
  });
  it('北极星指标正确', () => {
    const a = aggregate(rows);
    expect(a.n).toBe(3);
    expect(a.first_pass_rate).toBe(+(1 / 3).toFixed(3)); // 仅 a 一次过
    expect(a.avg_rounds_to_green).toBe(+((1 + 3 + 1) / 3).toFixed(2));
    expect(a.codex_plan_findings).toBe(2); // 1 + 1
    expect(a.codex_done_findings).toBe(1);
    expect(a.codex_findings_total).toBe(3);
    expect(a.verifier_refuted_total).toBe(1);
    expect(a.reverted_count).toBe(1);
    expect(a.governance_pass_rate).toBe(+(2 / 3).toFixed(3));
    expect(a.byDomain['be-sql'].n).toBe(2);
  });
  it('空账本', () => { expect(aggregate([]).n).toBe(0); });
});

describe('automation-due', () => {
  const md = [
    '## R1 · 任务一', '- needs_automation: true', '  - expires: 2026-01-01',
    '## R2 · 任务二', '- needs_automation: true', '  - expires: 2026-12-31',
    '## R3 · 任务三', '- needs_automation: true   （无 expires）',
  ].join('\n');

  it('isoAddDays 纯函数加天数', () => {
    expect(isoAddDays('2026-06-21', 14)).toBe('2026-07-05');
    expect(isoAddDays('2026-12-25', 10)).toBe('2027-01-04');
  });
  it('scanEntries 配对 needs_automation 与 expires', () => {
    const items = scanEntries(md);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ entry: 'R1 · 任务一', expires: '2026-01-01' });
    expect(items[2].expires).toBe(null);
  });
  it('classify 按基准日分过期/临期/缺失', () => {
    const c = classify(scanEntries(md), '2026-06-21', 14);
    expect(c.expired.map((x) => x.entry)).toEqual(['R1 · 任务一']); // 2026-01-01 < 今
    expect(c.missing.map((x) => x.entry)).toEqual(['R3 · 任务三']);
    expect(c.ok.map((x) => x.entry)).toEqual(['R2 · 任务二']); // 2026-12-31 远期
  });
  it('临期窗口命中', () => {
    const c = classify(scanEntries(md), '2026-12-20', 14); // 距 12-31 仅 11 天 → soon
    expect(c.soon.map((x) => x.entry)).toEqual(['R2 · 任务二']);
  });
});
