/**
 * Loop v2 调度/质量/进化 纯函数单测（无文件系统、无时钟依赖 → CI 可跑）。
 *
 * 被测：scripts/loop/{dispatch,quality-report,automation-due}.mjs 的导出纯函数。
 * 安全核心：调度的「域互斥独立集」「deps/inflight/gated 排除」「过期分类」必须确定可复现。
 */
import { describe, it, expect } from 'vitest';
import { foldBacklog, bucketOf, taskDomains, computeFrontier, mergeGate, latestClaims } from '../dispatch.mjs';
import { parseLedger, aggregate } from '../quality-report.mjs';
import { scanEntries, classify, isoAddDays } from '../automation-due.mjs';
import { scanNotes, classifyStale, scanStale, uidToken, branchMatchesUid } from '../stale-scan.mjs';

const J = (o) => JSON.stringify(o);

describe('dispatch.foldBacklog（委托 backlog/lib 权威 fold）', () => {
  it('create→status→amend(field/value LWW) 折叠为当前态', () => {
    // 权威 fold：amend 用 {field,value} schema（非顶层字段）。这正是 codex 闸-2 P1-1 修复点：
    // 旧自实现只认顶层 amend 字段会漏读 → 这里用真实 schema 验证委托后正确。
    const lines = [
      J({ uid: 'a', kind: 'create', desc: 'A', code: 'src/x.ts', priority: 'P2', section: 's', at: '2026-06-21T01:00:00.000Z' }),
      J({ uid: 'b', kind: 'create', desc: 'B', code: 'server/src/sql/y.ts', priority: 'P1', at: '2026-06-21T01:00:01.000Z' }),
      J({ uid: 'a', kind: 'status', status: 'DONE', at: '2026-06-21T02:00:00.000Z', eid: 'e1' }),
      J({ uid: 'b', kind: 'amend', field: 'priority', value: 'P0', at: '2026-06-21T02:00:01.000Z', eid: 'e2' }),
    ];
    const t = foldBacklog(lines);
    const byUid = Object.fromEntries(t.map((x) => [x.uid, x]));
    expect(byUid.a.status).toBe('DONE');
    expect(byUid.b.priority).toBe('P0'); // amend(field/value) 生效
    expect(byUid.b.status).toBe('PROPOSED'); // 权威 fold 默认态
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
  it('P1-2：未知 token 返回 null（绝不臆造伪域）', () => {
    expect(bucketOf('N/A')).toBe(null);
    expect(bucketOf('同B244')).toBe(null);
    expect(bucketOf('一些中文描述')).toBe(null);
    // 看似真实路径（含 / 且含扩展名）的未识别前缀 → 回退前两段粗域
    expect(bucketOf('weirdtop/sub/file.ts')).toBe('weirdtop/sub');
  });
  it('P1-3：目录形式 code（无尾斜杠/无文件）正确归桶——防域互斥漏判', () => {
    // wave-2 实测：b331 的 `server/src/sql`（目录、无尾斜杠）旧版回退到 be-other，
    // 漏掉与 b244 的 claims-detail.ts 真重叠。修复后须归 be-sql。
    expect(bucketOf('server/src/sql')).toBe('be-sql');
    expect(bucketOf('src/features/dashboard')).toBe('frontend');
    expect(bucketOf('server/src/services')).toBe('be-services');
    expect(bucketOf('数据管理')).toBe('etl');
    expect(bucketOf('server')).toBe('be-other');
    // 不误伤：同前缀但不同目录段（sqlfoo 非 sql/）→ 落到 be-other（^server）
    expect(bucketOf('server/src/sqlfoo/x.ts')).toBe('be-other');
  });
});

describe('dispatch.taskDomains 分隔符', () => {
  it('支持中文/英文分号 + 花括号路径前缀', () => {
    expect([...taskDomains({ uid: 'x', code: 'src/a.tsx；server/src/sql/b.ts;数据管理/c.py' })].sort())
      .toEqual(['be-sql', 'etl', 'frontend']);
    expect([...taskDomains({ uid: 'y', code: 'src/features/{growth,quote-conversion}' })])
      .toEqual(['frontend']);
  });
  it('全为非路径 token → 空域集（→ computeFrontier 推迟）', () => {
    expect(taskDomains({ uid: 'z', code: 'N/A' }).size).toBe(0);
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

  it('P1-3：GATED cutover 关键词命中 → 永不进前沿（精确词，不误伤"GATED 前置"）', () => {
    const t = [
      { uid: 'cut', code: 'server/src/config/x.ts', priority: 'P0', status: 'PROPOSED', desc: 'RLS-on 上线 → SX 进 current/ → sync VPS 发账号' },
      { uid: 'prep', code: 'server/src/sql/y.ts', priority: 'P1', status: 'PROPOSED', desc: 'G3 维度省份化（GATED 上线前置，该做）' },
    ];
    const r = computeFrontier(t, {});
    const f = r.frontier.map((x) => x.task.uid);
    expect(f).not.toContain('cut');   // cutover 词命中 → 排除
    expect(f).toContain('prep');      // "GATED 上线前置" 不被误伤 → 仍可派
  });

  it('P1-3：显式 config tasks.<uid>.gated 也排除', () => {
    const r = computeFrontier(
      [{ uid: 'g', code: 'src/a.tsx', priority: 'P1', status: 'PROPOSED', desc: '普通任务' }],
      { tasks: { g: { gated: true } } },
    );
    expect(r.frontier).toHaveLength(0);
  });
});

describe('dispatch.mergeGate（合并门串行化闸）', () => {
  const tasks = [
    { uid: 'a', priority: 'P1', status: 'IN_PROGRESS', desc: 'A' },
    { uid: 'b', priority: 'P0', status: 'DOING', desc: 'B' },
    { uid: 'c', priority: 'P1', status: 'PARTIAL', desc: 'C' },
    { uid: 'd', priority: 'P1', status: 'DONE', desc: 'D' },
  ];

  it('在飞集空 → slot=null、queue/skipped 皆空（无 PR 排队）', () => {
    const g = mergeGate(tasks, {});
    expect(g.slot).toBe(null);
    expect(g.queue).toEqual([]);
    expect(g.skipped).toEqual([]);
  });

  it('单个在飞 → 该任务即 slot holder、无排队', () => {
    const g = mergeGate(tasks, { inflight: ['a'] });
    expect(g.slot.uid).toBe('a');
    expect(g.queue).toEqual([]);
  });

  it('多个在飞 → 按 priority 升序→uid 升序定合并次序；slot=首、queue=其余', () => {
    // b(P0) < a(P1,uid a) < c(P1,uid c) → 次序 b,a,c
    const g = mergeGate(tasks, { inflight: ['c', 'a', 'b'] });
    expect(g.slot.uid).toBe('b');           // 只放一个过门
    expect(g.queue.map((t) => t.uid)).toEqual(['a', 'c']); // 其余按序排队
  });

  it('DONE 在飞项剔除（应移出 inflight）→ 不占 slot', () => {
    const g = mergeGate(tasks, { inflight: ['d', 'a'] });
    expect(g.slot.uid).toBe('a');
    expect(g.queue).toEqual([]);
    expect(g.skipped.some((s) => s.includes('d') && s.includes('DONE'))).toBe(true);
  });

  it('不在 backlog 的 uid 剔除（防脏 inflight 卡门）', () => {
    const g = mergeGate(tasks, { inflight: ['ghost', 'c'] });
    expect(g.slot.uid).toBe('c');
    expect(g.skipped.some((s) => s.includes('ghost') && s.includes('不在 backlog'))).toBe(true);
  });

  it('缺 priority → 视作 P9 排最后（确定可复现）', () => {
    const t = [{ uid: 'z', status: 'DOING' }, { uid: 'y', priority: 'P2', status: 'DOING' }];
    const g = mergeGate(t, { inflight: ['z', 'y'] });
    expect(g.slot.uid).toBe('y');           // P2 < P9(默认)
    expect(g.queue.map((x) => x.uid)).toEqual(['z']);
  });
});

describe('dispatch.latestClaims（事件日志 → 当前活跃认领·跨会话锁主信号）', () => {
  it('最新 status=IN_PROGRESS → 记为认领（含 actor+at+lastAt）', () => {
    const events = [
      { uid: 'a', kind: 'create', ts: '2026-06-22', at: '2026-06-22T01:00:00.000Z' },
      { uid: 'a', kind: 'status', status: 'IN_PROGRESS', actor: '@sessionX', at: '2026-06-22T02:00:00.000Z', eid: 'e1' },
    ];
    expect(latestClaims(events).a).toEqual({ actor: '@sessionX', at: '2026-06-22T02:00:00.000Z', lastAt: '2026-06-22T02:00:00.000Z' });
  });
  it('认领后续 note → lastAt 推进到 note（活动信号刷新 TTL·codex 闸-2 P1），at 仍是认领时刻', () => {
    const events = [
      { uid: 'a', kind: 'create', ts: '2026-06-22', at: '2026-06-22T01:00:00.000Z' },
      { uid: 'a', kind: 'status', status: 'IN_PROGRESS', actor: '@x', at: '2026-06-22T02:00:00.000Z', eid: 'e1' },
      { uid: 'a', kind: 'note', text: '进度心跳', at: '2026-06-22T07:30:00.000Z', eid: 'e2' },
    ];
    expect(latestClaims(events).a).toEqual({ actor: '@x', at: '2026-06-22T02:00:00.000Z', lastAt: '2026-06-22T07:30:00.000Z' });
  });
  it('认领后流转 DONE → 不再是认领（锁随状态前进自动释放）', () => {
    const events = [
      { uid: 'a', kind: 'create', ts: '2026-06-22', at: '2026-06-22T01:00:00.000Z' },
      { uid: 'a', kind: 'status', status: 'IN_PROGRESS', actor: '@x', at: '2026-06-22T02:00:00.000Z', eid: 'e1' },
      { uid: 'a', kind: 'status', status: 'DONE', evidence: 'PR#9', actor: '@x', at: '2026-06-22T03:00:00.000Z', eid: 'e2' },
    ];
    expect(latestClaims(events).a).toBeUndefined();
  });
  it('DOING 也算认领；PROPOSED/PARTIAL/BLOCKED 不算（仅活跃认领态上锁）', () => {
    const mk = (s) => [
      { uid: 'a', kind: 'create', ts: '2026-06-22', at: '2026-06-22T01:00:00.000Z' },
      { uid: 'a', kind: 'status', status: s, actor: '@x', at: '2026-06-22T02:00:00.000Z', eid: 'e1' },
    ];
    expect(latestClaims(mk('DOING')).a).toBeDefined();
    expect(latestClaims(mk('PROPOSED')).a).toBeUndefined();
    expect(latestClaims(mk('PARTIAL')).a).toBeUndefined();
    expect(latestClaims(mk('BLOCKED')).a).toBeUndefined();
  });
  it('多次认领事件按 (at,eid) 全序取最新（分支无关·与 fold 同序，物理行序乱序不影响）', () => {
    const events = [
      { uid: 'a', kind: 'create', ts: '2026-06-22', at: '2026-06-22T01:00:00.000Z' },
      { uid: 'a', kind: 'status', status: 'IN_PROGRESS', actor: '@late', at: '2026-06-22T05:00:00.000Z', eid: 'e2' },
      { uid: 'a', kind: 'status', status: 'IN_PROGRESS', actor: '@early', at: '2026-06-22T03:00:00.000Z', eid: 'e1' },
    ];
    expect(latestClaims(events).a.actor).toBe('@late');
  });
  it('空/无 status 事件 → 空认领集', () => {
    expect(latestClaims([])).toEqual({});
    expect(latestClaims([{ uid: 'a', kind: 'create', ts: '2026-06-22' }])).toEqual({});
  });
});

describe('dispatch.computeFrontier · 跨会话认领锁（P0「跨会话重复劳动」根治）', () => {
  const now = '2026-06-22T10:00:00.000Z';
  // fresh 本地看是 PROPOSED（wave-2 b331 形态：本地未见别会话的认领，仅靠 claims 注入锁出）
  const baseTasks = [
    { uid: 'fresh', code: 'src/a.tsx', priority: 'P1', status: 'PROPOSED', desc: 'A' },
    { uid: 'stale', code: 'server/src/sql/b.ts', priority: 'P1', status: 'IN_PROGRESS', desc: 'B' },
    { uid: 'free', code: 'server/src/routes/c.ts', priority: 'P1', status: 'PROPOSED', desc: 'C' },
  ];

  it('新鲜认领（age<TTL）→ 锁出前沿；陈旧认领（≥TTL）→ 释放回前沿（带时效防死锁）', () => {
    const claims = {
      fresh: { actor: '@A', at: '2026-06-22T09:00:00.000Z' }, // 1h 前 → 新鲜
      stale: { actor: '@B', at: '2026-06-22T00:00:00.000Z' }, // 10h 前 → 陈旧(>8h)
    };
    const r = computeFrontier(baseTasks, { claims, now, claimTtlHours: 8 });
    const f = r.frontier.map((x) => x.task.uid).sort();
    expect(f).not.toContain('fresh');                  // 别的会话在做 → 锁出（防重复劳动）
    expect(f).toContain('stale');                       // 陈旧认领 → 释放回前沿
    expect(f).toContain('free');
    expect(r.claimed.map((c) => c.task.uid)).toEqual(['fresh']);
    expect(r.claimed[0].actor).toBe('@A');
    expect(r.released.map((c) => c.task.uid)).toEqual(['stale']);
  });

  it('本地 PROPOSED 但远程已新鲜认领 → 锁出候选（wave-2 b331：本地视图看不到别会话进度，靠注入认领拦截）', () => {
    const claims = { fresh: { actor: '@other-session', at: '2026-06-22T09:30:00.000Z' } };
    const r = computeFrontier(baseTasks, { claims, now });
    expect(r.frontier.map((x) => x.task.uid)).not.toContain('fresh');
    expect(r.candidates.map((c) => c.uid)).not.toContain('fresh');
  });

  it('无 claims/now → 锁不生效（向后兼容：IN_PROGRESS 仍按 OPEN 候选进前沿）', () => {
    const r = computeFrontier(baseTasks, {});
    expect(r.claimed).toEqual([]);
    expect(r.released).toEqual([]);
    expect(r.frontier.map((x) => x.task.uid)).toContain('stale');
  });

  it('claims 有但缺 now → 保守视为新鲜（锁出，宁串行勿重复派单）', () => {
    const claims = { fresh: { actor: '@A', at: '2026-06-22T00:00:00.000Z' } };
    const r = computeFrontier(baseTasks, { claims }); // 无 now
    expect(r.frontier.map((x) => x.task.uid)).not.toContain('fresh');
    expect(r.claimed.map((c) => c.task.uid)).toEqual(['fresh']);
  });

  it('TTL 边界：age 恰好 == TTL → 视为陈旧释放（仅 age<ttl 才锁）', () => {
    const claims = { fresh: { actor: '@A', at: '2026-06-22T02:00:00.000Z' } }; // 恰好 8h 前
    const r = computeFrontier(baseTasks, { claims, now, claimTtlHours: 8 });
    expect(r.frontier.map((x) => x.task.uid)).toContain('fresh');
    expect(r.released.map((c) => c.task.uid)).toEqual(['fresh']);
  });

  it('at 不可解析 → 保守视为新鲜（锁出，防脏时间戳误释放）', () => {
    const claims = { fresh: { actor: '@A', at: 'not-a-date' } };
    const r = computeFrontier(baseTasks, { claims, now });
    expect(r.claimed.map((c) => c.task.uid)).toEqual(['fresh']);
  });

  it('codex 闸-2 P1：认领时刻超 TTL 但有后续活动（lastAt 新鲜）→ 仍锁（防误释放活跃会话）', () => {
    // 认领 @00:00（10h 前，>TTL），但 lastAt @09:30（0.5h 前，活跃 note 心跳）→ TTL 据 lastAt → 锁
    const claims = { fresh: { actor: '@A', at: '2026-06-22T00:00:00.000Z', lastAt: '2026-06-22T09:30:00.000Z' } };
    const r = computeFrontier(baseTasks, { claims, now, claimTtlHours: 8 });
    expect(r.frontier.map((x) => x.task.uid)).not.toContain('fresh');
    expect(r.claimed.map((c) => c.task.uid)).toEqual(['fresh']);
    expect(r.released).toEqual([]);
  });

  it('codex 闸-2 P1：认领与 lastAt 都超 TTL → 释放（无活动 = 真陈旧）', () => {
    const claims = { fresh: { actor: '@A', at: '2026-06-22T00:00:00.000Z', lastAt: '2026-06-22T00:30:00.000Z' } };
    const r = computeFrontier(baseTasks, { claims, now, claimTtlHours: 8 });
    expect(r.frontier.map((x) => x.task.uid)).toContain('fresh');
    expect(r.released.map((c) => c.task.uid)).toEqual(['fresh']);
  });

  it('codex 闸-2 P2：claimTtlHours 非法（"bad"/0/负/null）→ 回退默认 8h，不静默释放所有认领', () => {
    const claims = { fresh: { actor: '@A', at: '2026-06-22T09:00:00.000Z' } }; // 1h 前
    for (const ttl of ['bad', 0, -1, null, NaN]) {
      const r = computeFrontier(baseTasks, { claims, now, claimTtlHours: ttl });
      expect(r.frontier.map((x) => x.task.uid), `ttl=${ttl}`).not.toContain('fresh'); // 回退 8h → 1h<8h → 锁
      expect(r.claimed.map((c) => c.task.uid), `ttl=${ttl}`).toEqual(['fresh']);
    }
  });

  it('DONE 任务即便有认领残留也不计入 claimed/released（仅 OPEN 计）', () => {
    const tasks = [{ uid: 'd', code: 'src/a.tsx', priority: 'P0', status: 'DONE', desc: 'D' }];
    const claims = { d: { actor: '@A', at: '2026-06-22T09:00:00.000Z' } };
    const r = computeFrontier(tasks, { claims, now });
    expect(r.claimed).toEqual([]);
    expect(r.released).toEqual([]);
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

describe('stale-scan.scanNotes', () => {
  it('提取完成标记命中 + 去重 PR 号', () => {
    const r = scanNotes('第四批次完成，已合并 PR #704 与 #710；又见 #704');
    expect(r.completionHits).toBeGreaterThanOrEqual(2); // 完成 + 已合并
    expect(r.prRefs).toEqual([704, 710]); // 去重
  });
  it('无完成语 → 零命中', () => {
    const r = scanNotes('待评估报价口径，需用户拍板');
    expect(r.completionHits).toBe(0);
    expect(r.prRefs).toEqual([]);
  });
});

describe('stale-scan.classifyStale', () => {
  it('DONE/BLOCKED 不扫 → null', () => {
    expect(classifyStale({ uid: 'a', status: 'DONE' }, '完成 #704')).toBe(null);
    expect(classifyStale({ uid: 'b', status: 'BLOCKED' }, '完成 #704')).toBe(null);
  });
  it('IN_PROGRESS + 完成 note + PR → 高置信（90a92c 形态）', () => {
    const h = classifyStale({ uid: '90a92c', status: 'IN_PROGRESS', priority: 'P1', desc: '立方体' }, '第四批次完成，接线 /api/query/kpi；生产闭环 #608→#609', 0);
    expect(h).not.toBe(null);
    expect(h.confidence).toBe('high');
    expect(h.prRefs).toContain(608);
  });
  it('PARTIAL + closeout note + PR → 高置信（6ae4d7 形态）', () => {
    const h = classifyStale({ uid: '6ae4d7', status: 'PARTIAL', priority: 'P1', desc: '维度表省份化' }, '查询期收口已落，#704 + #710 交付', 0);
    expect(h.confidence).toBe('high');
  });
  it('PROPOSED + 仅 1 条完成语 → note 信号不足（保守）→ null', () => {
    expect(classifyStale({ uid: 'x', status: 'PROPOSED', desc: 'x' }, '已落地一半', 0)).toBe(null);
  });
  it('PROPOSED 无 note 但 churn 超阈 → 低置信（b246/b330 旁路覆盖形态）', () => {
    const h = classifyStale({ uid: 'b246', status: 'PROPOSED', priority: 'P1', desc: 'kpi CTE' }, '', 6);
    expect(h).not.toBe(null);
    expect(h.confidence).toBe('low');
    expect(h.churnCount).toBe(6);
  });
  it('churn 未达阈 + 无 note → null', () => {
    expect(classifyStale({ uid: 'y', status: 'PROPOSED', desc: 'y' }, '', 4)).toBe(null);
  });
});

describe('stale-scan.scanStale 排序', () => {
  it('按 confidence(high>medium>low) 再 churn 降序', () => {
    const tasks = [
      { uid: 'lowc', status: 'PROPOSED', desc: 'l' },
      { uid: 'high1', status: 'PARTIAL', desc: 'h' },
      { uid: 'mid1', status: 'IN_PROGRESS', desc: 'm' },
      { uid: 'done1', status: 'DONE', desc: 'd' },
    ];
    const notes = new Map([
      ['high1', '完成 #704'], // high (note + PR)
      ['mid1', '已完成 已落地'], // medium (note 无 PR)
      ['lowc', ''], // low (churn only)
    ]);
    const churn = new Map([['lowc', 7]]);
    const r = scanStale(tasks, notes, churn);
    expect(r.map((x) => x.uid)).toEqual(['high1', 'mid1', 'lowc']); // done1 被滤除
  });
});

describe('stale-scan.uidToken / branchMatchesUid（47c2a5）', () => {
  it('uidToken 取 uid 末段；<4 字符弃用（防误配）', () => {
    expect(uidToken('2026-05-30-user-b299')).toBe('b299');
    expect(uidToken('2026-06-11-claude-7a2849')).toBe('7a2849');
    expect(uidToken('x-ab')).toBe(''); // 太短
    expect(uidToken('')).toBe('');
  });
  it('branchMatchesUid 分隔符边界匹配（loop + 非 loop fix 分支命中；子串不误配）', () => {
    expect(branchMatchesUid('claude/loop-2026-05-30-user-b299', '2026-05-30-user-b299')).toBe(true);
    expect(branchMatchesUid('claude/fix-yoy-ytd-phantom-7a2849', '2026-06-11-claude-7a2849')).toBe(true);
    expect(branchMatchesUid('claude/loop-2026-06-05-claude-b332-expense', '2026-06-05-claude-b332')).toBe(true); // 后接分隔符
    expect(branchMatchesUid('claude/loop-xb299y', '2026-05-30-user-b299')).toBe(false); // 子串非边界 → 不误配
    expect(branchMatchesUid('claude/loop-b332x', '2026-06-05-claude-b332')).toBe(false); // 后接非分隔符
    expect(branchMatchesUid('', '2026-05-30-user-b299')).toBe(false);
  });
});

describe('stale-scan.classifyStale · PR-合并信号（47c2a5）', () => {
  it('实现 PR 已合 → 高置信（即便 PROPOSED、note 不足）', () => {
    const h = classifyStale({ uid: '2026-05-30-user-b299', status: 'PROPOSED', priority: 'P2', desc: 'asOfDate' }, '实现完成，待合', 0, [721]);
    expect(h).not.toBe(null);
    expect(h.confidence).toBe('high');
    expect(h.mergedPrRefs).toEqual([721]);
    expect(h.reasons.some((r) => r.includes('#721') && r.includes('MERGED'))).toBe(true);
  });
  it('IN_PROGRESS + 实现 PR 已合 → 高置信（b261/b299 合并后未回填 DONE 形态）', () => {
    const h = classifyStale({ uid: '2026-04-26-user-b261', status: 'IN_PROGRESS', priority: 'P3', desc: 'riskGrade' }, '待编排会话过闸后合', 0, [723]);
    expect(h.confidence).toBe('high');
  });
  it('无 PR-合并 + 无 note + churn 未达阈 → null（PR 信号不误报）', () => {
    expect(classifyStale({ uid: 'q', status: 'PROPOSED', desc: 'q' }, '待评估', 0, [])).toBe(null);
  });
  it('DONE 任务即便传 mergedPrRefs 也不扫 → null', () => {
    expect(classifyStale({ uid: 'd', status: 'DONE', desc: 'd' }, '', 0, [999])).toBe(null);
  });
});

describe('stale-scan.scanStale · 注入 mergedPrsByUid（47c2a5）', () => {
  it('PR 已合任务进清单且高置信，排在仅 churn 的低置信前', () => {
    const tasks = [
      { uid: 'prdone', status: 'IN_PROGRESS', desc: 'p' },
      { uid: 'lowc', status: 'PROPOSED', desc: 'l' },
    ];
    const r = scanStale(tasks, new Map(), new Map([['lowc', 7]]), new Map([['prdone', [721]]]));
    expect(r.map((x) => x.uid)).toEqual(['prdone', 'lowc']);
    expect(r[0].confidence).toBe('high');
  });
});
