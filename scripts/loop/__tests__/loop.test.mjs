/**
 * Loop v2 调度/质量/进化 纯函数单测（无文件系统、无时钟依赖 → CI 可跑）。
 *
 * 被测：scripts/loop/{dispatch,quality-report,automation-due}.mjs 的导出纯函数。
 * 安全核心：调度的「域互斥独立集」「deps/inflight/gated 排除」「过期分类」必须确定可复现。
 */
import { describe, it, expect } from 'vitest';
import { foldBacklog, bucketOf, taskDomains, computeFrontier, mergeGate, latestClaims, failureLedgerRows, isInspectMode } from '../dispatch.mjs';
import { parseLedger, aggregate, normalizeVerdict, parseRevertedPrs, buildRevertGitArgs, collectRevertedPrs, effectiveVerdict, parseUserReworkLog, classifyTopic, hhiOf, overfitFlag, extractPrEvolutionEntryDates, ledgerMaxTs, isEntryLedgerStale } from '../quality-report.mjs';
import { scanEntries, classify, isoAddDays, verifyMechanisms } from '../automation-due.mjs';
import { scanNotes, classifyStale, scanStale, uidToken, branchMatchesUid } from '../stale-scan.mjs';
import { RULES, ruleHits } from '../rule-hit-rate.mjs';

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
  it('全角逗号「，」/顿号「、」是合法分隔符（漏判会把多路径整串误归单一域 → 域冲突漏检并行撞车）', () => {
    expect([...taskDomains({ uid: 'w', code: 'src/a.ts，server/src/sql/shared.ts' })].sort())
      .toEqual(['be-sql', 'frontend']);
    expect([...taskDomains({ uid: 'v', code: 'src/a.ts、数据管理/b.py' })].sort())
      .toEqual(['etl', 'frontend']);
    // 回归锚：修复前整串被 bucketOf 判为 frontend，be-sql 被吞 → 与纯 be-sql 任务误判互斥
    const a = taskDomains({ uid: 'a', code: 'src/a.ts，server/src/sql/shared.ts' });
    const b = taskDomains({ uid: 'b', code: 'server/src/sql/shared.ts' });
    expect([...a].some((d) => b.has(d))).toBe(true);
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

// ============ E1 账本记失败（治幸存者偏差·2026-06-27）============

describe('quality-report.normalizeVerdict（verdict 归一·单一事实源）', () => {
  it('bare pass → {pass, null}', () => {
    expect(normalizeVerdict('pass')).toEqual({ verdict: 'pass', qualifier: null });
  });
  it('pass-* 变体 → {pass, 子标记}（口径稳定：归一后非 pass 才计失败）', () => {
    expect(normalizeVerdict('pass-after-fix')).toEqual({ verdict: 'pass', qualifier: 'after-fix' });
    expect(normalizeVerdict('pass-pending-user-merge')).toEqual({ verdict: 'pass', qualifier: 'pending-user-merge' });
    expect(normalizeVerdict('pass-after-gate2-fix')).toEqual({ verdict: 'pass', qualifier: 'after-gate2-fix' });
    expect(normalizeVerdict('pass-with-documented-residual')).toEqual({ verdict: 'pass', qualifier: 'with-documented-residual' });
    expect(normalizeVerdict('pass-scoped')).toEqual({ verdict: 'pass', qualifier: 'scoped' });
  });
  it('历史成功同义词 all_fixed/mergeable → pass（防未来顶层使用误判为非 pass）', () => {
    expect(normalizeVerdict('all_fixed').verdict).toBe('pass');
    expect(normalizeVerdict('mergeable').verdict).toBe('pass');
  });
  it('pending-pr（2026-06-28 后新变体·完成待建 PR）→ pass（2026-07-03 审计：不归一会落 other 拉低一次过率 + accounted 守卫漏防误记 orphaned）', () => {
    expect(normalizeVerdict('pending-pr')).toEqual({ verdict: 'pass', qualifier: 'pending-pr' });
  });
  it('非 pass 规范终态原样透传', () => {
    for (const v of ['partial', 'reverted', 'abandoned', 'orphaned', 'blocked']) {
      expect(normalizeVerdict(v)).toEqual({ verdict: v, qualifier: null });
    }
  });
  it('大小写/空白容错；未知值小写保留（不臆造）；空/缺失 → unknown', () => {
    expect(normalizeVerdict('  PASS ').verdict).toBe('pass');
    expect(normalizeVerdict('Weird-State').verdict).toBe('weird-state');
    expect(normalizeVerdict('')).toEqual({ verdict: 'unknown', qualifier: null });
    expect(normalizeVerdict(null)).toEqual({ verdict: 'unknown', qualifier: null });
    expect(normalizeVerdict(undefined)).toEqual({ verdict: 'unknown', qualifier: null });
  });
});

describe('quality-report.aggregate · 失败记账（非 pass 纳分母 + 放弃率/孤儿率/阻塞率）', () => {
  it('失败行纳入分母；放弃率=（abandoned+orphaned）/n；孤儿率/阻塞率独立', () => {
    const rows = [
      { uid: 'p1', rounds_to_green: 1, rework_count: 0, governance_pass: true, verdict: 'pass' },
      { uid: 'p2', rounds_to_green: 1, rework_count: 0, governance_pass: true, verdict: 'pass-after-fix' }, // 归一后仍 pass
      { uid: 'part', rounds_to_green: 1, rework_count: 0, governance_pass: true, verdict: 'partial' },       // 非 pass → 不计一次过
      { uid: 'orph', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' },
      { uid: 'blk', verdict: 'blocked' },
    ];
    const a = aggregate(rows);
    expect(a.n).toBe(5);                                  // 失败行进分母（治幸存者偏差）
    expect(a.first_pass_rate).toBe(+(2 / 5).toFixed(3));  // 仅 p1/p2 一次过（part/orph/blk 不计）
    expect(a.orphan_rate).toBe(+(1 / 5).toFixed(3));
    expect(a.blocked_rate).toBe(+(1 / 5).toFixed(3));
    expect(a.abandonment_rate).toBe(+(1 / 5).toFixed(3)); // (abandoned0 + orphaned1)/5，blocked 不混入放弃
    expect(a.verdict_breakdown).toMatchObject({ pass: 2, partial: 1, orphaned: 1, blocked: 1 });
  });

  it('partial（rtg=1/rework=0）不再被误计为一次过（口径修正·codex #812 P2）', () => {
    expect(aggregate([{ uid: 'x', rounds_to_green: 1, rework_count: 0, verdict: 'partial' }]).first_pass_rate).toBe(0);
  });

  it('avg 转绿/返工只算「有完成指标」的行（孤儿/阻塞无 rtg → 不拉低均值，missing≠0·codex P2-5）', () => {
    const rows = [
      { uid: 'a', rounds_to_green: 2, rework_count: 1, verdict: 'pass' },
      { uid: 'o', verdict: 'orphaned', claim_at: 't' }, // 无 rtg/rework
    ];
    const a = aggregate(rows);
    expect(a.avg_rounds_to_green).toBe(2);  // 仅 a 计入（不是 (2+0)/2=1）
    expect(a.avg_rework).toBe(1);
  });

  it('读时去重：并发/union 产生的相同 orphaned (uid,claim_at) 只计 1 次（codex P1-1 并发安全）', () => {
    const rows = [
      { uid: 'o', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' },
      { uid: 'o', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' }, // union 重复行
      { uid: 'p', verdict: 'pass', rounds_to_green: 1, rework_count: 0 },
    ];
    const a = aggregate(rows);
    expect(a.n).toBe(2);                       // 去重后分母不被重复行污染
    expect(a.verdict_breakdown.orphaned).toBe(1);
    expect(a.orphan_rate).toBe(+(1 / 2).toFixed(3));
  });

  it('不同 claim_at 同 uid = 两次孤儿尝试（不去重·attempt 维度）', () => {
    const rows = [
      { uid: 'o', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' },
      { uid: 'o', verdict: 'orphaned', claim_at: '2026-06-21T00:00:00.000Z' },
    ];
    expect(aggregate(rows).verdict_breakdown.orphaned).toBe(2);
  });

  it('blocked 读时按 uid 去重（任务级可见性）', () => {
    const rows = [{ uid: 'b', verdict: 'blocked' }, { uid: 'b', verdict: 'blocked' }];
    expect(aggregate(rows).verdict_breakdown.blocked).toBe(1);
  });

  it('未知/缺失 verdict 落 other 桶（不在分布里消失·codex P2-3）', () => {
    const a = aggregate([{ uid: 'x', verdict: 'weird-state' }, { uid: 'y' }]);
    expect(a.verdict_breakdown.other).toBe(2);
  });

  it('归一覆盖全部历史成功变体（bare pass + 5 种顶层 pass-* + all_fixed/mergeable 同义词）→ 计入 pass（codex 闸-2 P2 锁清单）', () => {
    const successVariants = ['pass', 'pass-after-fix', 'pass-pending-user-merge', 'pass-after-gate2-fix', 'pass-with-documented-residual', 'pass-scoped', 'all_fixed', 'mergeable'];
    const rows = successVariants.map((v, i) => ({ uid: `u${i}`, rounds_to_green: 1, rework_count: 0, verdict: v }));
    const a = aggregate(rows);
    expect(a.verdict_breakdown.pass).toBe(successVariants.length); // 全部归一 pass
    expect(a.abandonment_rate).toBe(0);
    expect(a.first_pass_rate).toBe(1); // 全部一次过（归一后皆 pass）
  });

  it('缺 uid 的坏 schema orphaned 行不被归并（保留可见·codex 闸-2 P2）', () => {
    const rows = [
      { verdict: 'orphaned', claim_at: 'same' }, // 无 uid
      { verdict: 'orphaned', claim_at: 'same' }, // 无 uid 同 claim_at → 不应归并
    ];
    expect(aggregate(rows).verdict_breakdown.orphaned).toBe(2);
  });
});

describe('dispatch.failureLedgerRows（孤儿/阻塞幂等记账·纯函数）', () => {
  const T = (uid, extra = {}) => ({ uid, desc: `任务${uid}`, code: 'src/a.tsx', ...extra });

  it('released（陈旧认领）→ orphaned 行（含 claim_at/actor/reason/domain）', () => {
    const released = [{ task: T('t1'), actor: '@sess', at: '2026-06-20T00:00:00.000Z', ageMs: 36 * 3600 * 1000 }];
    const rows = failureLedgerRows({ released, blocked: [], ledgerRows: [], ts: '2026-06-27' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uid: 't1', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z', actor: '@sess', ts: '2026-06-27' });
    expect(rows[0].domain).toEqual(['frontend']);
    expect(rows[0].reason).toMatch(/TTL|超时|孤儿/);
    expect(rows[0].rounds_to_green).toBeUndefined(); // 失败行不造完成指标
  });

  it('accounted 守卫：released uid 已有 pass 行 → 跳过（完成未流转≠孤儿·假阳性防护）', () => {
    const released = [{ task: T('t1'), actor: '@s', at: '2026-06-20T00:00:00.000Z' }];
    expect(failureLedgerRows({ released, blocked: [], ledgerRows: [{ uid: 't1', verdict: 'pass' }], ts: '2026-06-27' })).toHaveLength(0);
    // pass-* 变体同样视为已入账
    expect(failureLedgerRows({ released, blocked: [], ledgerRows: [{ uid: 't1', verdict: 'pass-after-fix' }], ts: '2026-06-27' })).toHaveLength(0);
    // partial/reverted 也算到达记账点
    expect(failureLedgerRows({ released, blocked: [], ledgerRows: [{ uid: 't1', verdict: 'reverted' }], ts: '2026-06-27' })).toHaveLength(0);
  });

  it('accounted 守卫吸收 schema 漂移：backlog_uid 而非 uid 也识别（codex P1-6）', () => {
    const released = [{ task: T('t1'), at: '2026-06-20T00:00:00.000Z' }];
    expect(failureLedgerRows({ released, blocked: [], ledgerRows: [{ backlog_uid: 't1', verdict: 'pass' }], ts: '2026-06-27' })).toHaveLength(0);
  });

  it('accounted 守卫含终态 abandoned：已 abandoned 的 uid 不再补 orphaned（防双计·codex 闸-2 P1）', () => {
    const released = [{ task: T('t1'), at: '2026-06-25T00:00:00.000Z' }]; // 即便是不同认领时刻
    const ledgerRows = [{ uid: 't1', verdict: 'abandoned', reason: '人工终止' }];
    expect(failureLedgerRows({ released, blocked: [], ledgerRows, ts: '2026-06-27' })).toHaveLength(0);
    // blocked 同理：abandoned 终态 uid 不再补 blocked
    expect(failureLedgerRows({ released: [], blocked: [{ uid: 't1', desc: 'x' }], ledgerRows, ts: '2026-06-27' })).toHaveLength(0);
  });

  it('幂等：已存在同 (uid,claim_at) orphaned → 不重复记（连跑两次只 1 条·oracle）', () => {
    const released = [{ task: T('t1'), at: '2026-06-20T00:00:00.000Z' }];
    const ledgerRows = [{ uid: 't1', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' }];
    expect(failureLedgerRows({ released, blocked: [], ledgerRows, ts: '2026-06-27' })).toHaveLength(0);
  });

  it('重新认领（不同 claim_at）→ 记新 orphaned 行（attempt 维度·codex P1-3）', () => {
    const released = [{ task: T('t1'), at: '2026-06-25T00:00:00.000Z' }];
    const ledgerRows = [{ uid: 't1', verdict: 'orphaned', claim_at: '2026-06-20T00:00:00.000Z' }];
    const rows = failureLedgerRows({ released, blocked: [], ledgerRows, ts: '2026-06-27' });
    expect(rows).toHaveLength(1);
    expect(rows[0].claim_at).toBe('2026-06-25T00:00:00.000Z');
  });

  it('缺 claim_at → 跳过（无稳定去重键，保守不记防重复污染）', () => {
    expect(failureLedgerRows({ released: [{ task: T('t1'), at: '' }], blocked: [], ledgerRows: [], ts: '2026-06-27' })).toHaveLength(0);
  });

  it('同一轮多条同 (uid,claim_at) released → 批内去重只记 1 条', () => {
    const released = [
      { task: T('t1'), at: '2026-06-20T00:00:00.000Z' },
      { task: T('t1'), at: '2026-06-20T00:00:00.000Z' },
    ];
    expect(failureLedgerRows({ released, blocked: [], ledgerRows: [], ts: '2026-06-27' })).toHaveLength(1);
  });

  it('blocked → blocked 行；幂等（已有 blocked uid 跳过）；accounted 守卫', () => {
    const blocked = [{ uid: 'b1', desc: '阻塞', code: 'server/src/sql/x.ts' }];
    const rows = failureLedgerRows({ released: [], blocked, ledgerRows: [], ts: '2026-06-27' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uid: 'b1', verdict: 'blocked', ts: '2026-06-27' });
    expect(rows[0].domain).toEqual(['be-sql']);
    expect(failureLedgerRows({ released: [], blocked, ledgerRows: [{ uid: 'b1', verdict: 'blocked' }], ts: '2026-06-27' })).toHaveLength(0);
    expect(failureLedgerRows({ released: [], blocked, ledgerRows: [{ uid: 'b1', verdict: 'pass' }], ts: '2026-06-27' })).toHaveLength(0);
  });

  it('released + blocked 混合一轮记两类行；空输入安全（无 ts 不崩）', () => {
    const rows = failureLedgerRows({
      released: [{ task: T('o1'), at: '2026-06-20T00:00:00.000Z' }],
      blocked: [{ uid: 'b1', desc: 'x', code: 'src/y.tsx' }],
      ledgerRows: [], ts: '2026-06-27',
    });
    expect(rows.map((r) => r.verdict).sort()).toEqual(['blocked', 'orphaned']);
    expect(failureLedgerRows({ released: [], blocked: [], ledgerRows: [] })).toEqual([]);
  });
});

describe('dispatch.isInspectMode（只读模式不写账本·codex 闸-2 P2）', () => {
  it('--json/--board/--merge-gate 为只读模式（不记账）', () => {
    expect(isInspectMode(['--json'])).toBe(true);
    expect(isInspectMode(['--board'])).toBe(true);
    expect(isInspectMode(['--merge-gate'])).toBe(true);
    expect(isInspectMode(['--no-fetch', '--json'])).toBe(true); // 组合参数仍判只读
  });
  it('默认模式 / 仅 --no-fetch / --no-orphan-ledger 非只读（默认模式才记账）', () => {
    expect(isInspectMode([])).toBe(false);
    expect(isInspectMode(['--no-fetch'])).toBe(false);
    expect(isInspectMode(['--no-orphan-ledger'])).toBe(false);
  });
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
  it('scanEntries 兼容标题形式 `### needs_automation: true`（防催办网漏计·2026-06-27 meta）', () => {
    const titleMd = [
      '## R5 · 标题形式任务',
      '### 体检结果（截至 2026-01-01）', // 子节标题括号内含日期，不应被当任务级（边界）
      '### 三问复盘',
      '### needs_automation: true',
      '- expires: 2026-11-30',
    ].join('\n');
    const items = scanEntries(titleMd);
    expect(items).toHaveLength(1); // 标题形式不再被标题分支吞掉
    expect(items[0].expires).toBe('2026-11-30'); // 且正确配对后续 expires
    expect(items[0].entry).toBe('R5 · 标题形式任务'); // 归任务级，不被「体检结果（含日期）」或「三问复盘」夺走（codex P2-a）
  });
  it('相邻两项窗口截断：前项缺 expires 不得「借用」后项的（2026-07-03 审计发现 3·真实数据 E1 entry 实证）', () => {
    const items = scanEntries([
      '## R6 · 前项（自身缺 expires）',
      '- needs_automation: true',
      '正文一行',
      '- needs_automation: true',
      '- expires: 2026-03-01', // 只属第二项
    ].join('\n'));
    expect(items).toHaveLength(2);
    expect(items[0].expires).toBe(null);       // 修复前会错借到 2026-03-01
    expect(items[1].expires).toBe('2026-03-01');
  });
  it('E4 mechanism 提取 + verifyMechanisms 真升级校验（governance:名 / 路径两种形式）', () => {
    const items = scanEntries([
      '## R7 · 已机制化项',
      '- needs_automation: true',
      '- mechanism: governance:checkLoopLedgerVerdicts',
      '- expires: 2026-01-01',
      '## R8 · 假处置项',
      '- needs_automation: true',
      '- mechanism: scripts/loop/no-such-file.mjs',
      '- expires: 2026-01-01',
      '## R9 · 无 mechanism 项',
      '- needs_automation: true',
      '- expires: 2026-12-31',
    ].join('\n'));
    expect(items.map((i) => i.mechanism)).toEqual(['governance:checkLoopLedgerVerdicts', 'scripts/loop/no-such-file.mjs', null]);
    // 包裹/尾注杂质剥离：反引号包裹与中文括号尾注不得污染值（否则存在性验证恒失败 → 误报假处置）
    const wrapped = scanEntries([
      '## W1', '- needs_automation: true', '- mechanism: `scripts/loop/rule-hit-rate.mjs`', '- expires: 2026-12-31',
      '## W2', '- needs_automation: true', '- mechanism: governance:checkFoo（第53项）', '- expires: 2026-12-31',
    ].join('\n'));
    expect(wrapped.map((i) => i.mechanism)).toEqual(['scripts/loop/rule-hit-rate.mjs', 'governance:checkFoo']);
    const verified = verifyMechanisms(items, {
      fileExists: () => false,
      governanceSource: 'function checkLoopLedgerVerdicts() {}',
    });
    const c = classify(verified, '2026-06-21', 14);
    expect(c.mechanized.map((x) => x.entry)).toEqual(['R7 · 已机制化项']); // 已过期但机制已验证 → 摘出催办网
    expect(c.fake.map((x) => x.entry)).toEqual(['R8 · 假处置项']);          // 声明了但机制不存在 → 假处置
    expect(c.ok.map((x) => x.entry)).toEqual(['R9 · 无 mechanism 项']);     // 无声明走原日期逻辑
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
  it('子串重叠不虚增：「已完成」一处出现只计 1 条证据（2026-07-03 审计发现 5）', () => {
    expect(scanNotes('已完成').completionHits).toBe(1); // 修复前=2（已完成+完成 双计）
    expect(scanNotes('本任务完成').completionHits).toBe(1); // 裸「完成」真实命中保留
  });
  it('否定语境不算完成信号：未完成/尚未完成/没有完成/不算完成', () => {
    expect(scanNotes('尚未完成，仍需补 E2E').completionHits).toBe(0);
    expect(scanNotes('该模块未完成').completionHits).toBe(0);
    expect(scanNotes('没有完成迁移；但已合并前置 PR').markers).toEqual(['已合并']);
  });
  it('否定插入语与名词化用法不误判（code review P2 反例回归）', () => {
    expect(scanNotes('由于时间关系未能完成').completionHits).toBe(0); // 否定词与「完成」隔 1 字
    expect(scanNotes('完成度不高，仅30%').completionHits).toBe(0);     // 「完成度」名词化非声明
    expect(scanNotes('已完成，完成度 100%').completionHits).toBe(1);   // 真完成声明不受剥离误伤
  });
});

describe('rule-hit-rate.ruleHits（E4 死规则审计·纯函数）', () => {
  const baseCtx = {
    ledger: [
      { uid: 'a', verdict: 'pass', codex_plan: { P0: 0, P1: 1 }, codex_done: { P0: 0 } },
      { uid: 'b', verdict: 'orphaned' },
    ],
    prEvo: 'needs_automation: true\n合并门 slot holder\n待跨域验证',
    config: { deps: { x: ['y'] }, tasks: { g: { gated: true }, d: { domain: ['etl'] } } },
    backlogEvents: [{ kind: 'status', status: 'IN_PROGRESS', actor: '@s' }, { kind: 'status', status: 'DONE', actor: '@s' }],
    reworkCount: 0,
    revertedCount: null,
  };
  const byId = (rs, id) => rs.find((r) => r.id === id);
  it('alive / dead-candidate / untestable 三分类', () => {
    const rs = ruleHits(baseCtx);
    expect(rs).toHaveLength(RULES.length);
    expect(byId(rs, 'codex-gate1')).toMatchObject({ hits: 1, verdict: 'alive' });
    expect(byId(rs, 'e1-failure-accounting')).toMatchObject({ hits: 1, verdict: 'alive' });
    expect(byId(rs, 'claim-lock')).toMatchObject({ hits: 1, verdict: 'alive' }); // DONE 状态事件不算认领
    expect(byId(rs, 'e2-rework-sink')).toMatchObject({ hits: 0, verdict: 'dead-candidate' });
    expect(byId(rs, 'e2-revert-lookup').verdict).toBe('untestable'); // revertedCount=null（--no-git）
    expect(byId(rs, 'session-prompt-discipline').verdict).toBe('untestable');
  });
  it('probe 崩溃 → untestable 而非误判 0（数据缺失 ≠ 死规则）', () => {
    const rs = ruleHits({ ...baseCtx, ledger: null }); // ledger.filter 抛错
    expect(byId(rs, 'codex-gate1').verdict).toBe('untestable');
  });
  it('pending-pr 等 pass 同义词经 normalizeVerdict 不落入失败记账计数', () => {
    const rs = ruleHits({ ...baseCtx, ledger: [{ uid: 'c', verdict: 'pending-pr' }] });
    expect(byId(rs, 'e1-failure-accounting').hits).toBe(0);
  });
  it('codex 闸 {"skipped":…}/{"unavailable":…} 占位对象不算闸命中（账本实存此类行）', () => {
    const rs = ruleHits({
      ...baseCtx,
      ledger: [
        { uid: 'a', codex_plan: { skipped: 'default-off' }, codex_done: { unavailable: true } },
        { uid: 'b', codex_plan: { P0: 0, P1: 2 } },
      ],
    });
    expect(byId(rs, 'codex-gate1').hits).toBe(1);
    expect(byId(rs, 'codex-gate2').hits).toBe(0);
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

// ============ E2 注入外部真相（治茧房3 自指闭环·2026-06-27）============

describe('quality-report.parseRevertedPrs（git revert 反查·被回滚原 PR 解析）', () => {
  it('GitHub squash revert：取引号内被回滚 PR，排除引号外 revert 自身号', () => {
    expect([...parseRevertedPrs(['Revert "feat(loop): E1 (#815)" (#820)'])]).toEqual([815]);
  });
  it('git revert 默认格式：引号内 PR', () => {
    expect([...parseRevertedPrs(['Revert "fix(x): y (#700)"'])]).toEqual([700]);
  });
  it('无引号手写 revert/回滚 动词窗口：取号（含中文 + 带空格 PR #N）', () => {
    // squash-merge 语境下末尾 (#N) = 本提交所属 PR 自身号（恒非被回滚对象）→ 剥离后无窗口命中。
    // 本仓禁直推 main，所有提交经 PR squash 合入，裸「回滚 … (#N)」的 #N 只能是自身号。
    expect([...parseRevertedPrs(['revert: 回滚 E1 误改 (#704)'])]).toEqual([]);
    // 被回滚号在正文（非末尾括号）→ 剥自身号 (#830) 后窗口仍命中 #704
    expect([...parseRevertedPrs(['revert: 回滚 #704 的 E1 误改 (#830)'])]).toEqual([704]);
    expect([...parseRevertedPrs(['回滚 PR #710'])]).toEqual([710]);
  });
  it('自描述型提交不误报（2026-07-03 审计实证 #818：功能名含「回滚」+ squash 自身号被误标已回滚）', () => {
    expect([...parseRevertedPrs(['feat(loop): E2 注入外部真相 — 治茧房3 自指闭环（git 回滚反查 + owner 返工 + 双率） (#818)'])]).toEqual([]);
    expect([...parseRevertedPrs(['docs(loop): 回滚检测逻辑说明 (#900)'])]).toEqual([]);
  });
  it('lookbehind 排除紧贴 PR#N/pr#N 来源标注（codex 闸-1 P1-4 真实 #391 误报根因）；带空格 PR #N 保留为真 revert 引用（codex 闸-2 P2-2 边界）', () => {
    expect([...parseRevertedPrs(['fix(deploy): 修正 PM2 回滚命令语法（codex P1 PR#391）'])]).toEqual([]); // 紧贴 PR# 排除
    expect([...parseRevertedPrs(['回滚 pr#392 的改动'])]).toEqual([]);                                    // 小写 pr# 也排除
    expect([...parseRevertedPrs(['回滚 PR #393 的改动'])]).toEqual([393]);                                // 带空格 = 真 revert 引用格式 → 命中（残留局限：带空格来源标注会误命中，本仓实测来源为紧贴）
  });
  it('纯 hotfix / 非 revert 提交 → 空（不污染回滚率·codex P1-5）', () => {
    expect([...parseRevertedPrs(['hotfix: fix prod (#123)'])]).toEqual([]);
    expect([...parseRevertedPrs(['feat: 增加导出 (#999)'])]).toEqual([]);
  });
  it('多引号段 → 并集（codex 闸-1 P2-2）', () => {
    expect([...parseRevertedPrs(['Revert "A (#11)" and revert "B (#22)"'])].sort((a, b) => a - b)).toEqual([11, 22]);
  });
  it('多行 subject → 并集去重；空/缺失安全；#0 不计（仅正整数）', () => {
    expect([...parseRevertedPrs(['Revert "a (#1)"', 'Revert "b (#2)"', 'Revert "a again (#1)"'])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...parseRevertedPrs([])]).toEqual([]);
    expect([...parseRevertedPrs(null)]).toEqual([]);
    expect([...parseRevertedPrs([''])]).toEqual([]);
    expect([...parseRevertedPrs(['Revert "x (#0)"'])]).toEqual([]);
  });
});

describe('quality-report.buildRevertGitArgs（-E alternation + -i 大小写·oracle 必需）', () => {
  it('参数含 -E（让 | 作 ERE alternation）+ -i（匹配大写 Revert）+ grep + format', () => {
    const args = buildRevertGitArgs('/some/dir');
    expect(args).toContain('-E');     // 无 -E git grep 不解析 | → 命中 0（codex #812 P1）
    expect(args).toContain('-i');     // GitHub 大写 Revert 需 -i 才命中（否则 oracle 失败）
    expect(args).toContain('--grep=(revert|回滚|hotfix)');
    expect(args).toContain('--pretty=format:%s');
    expect(args.slice(0, 4)).toEqual(['-C', '/some/dir', 'log', '-E']);
  });
});

describe('quality-report.collectRevertedPrs（runGit 可注入·CI 不 spawn git）', () => {
  it('mock runGit 喂三类 alternation 分支（revert/回滚/hotfix）→ 正确解析被回滚 PR', () => {
    const fakeLog = [
      'Revert "feat: a (#101)" (#201)',  // revert 分支 → 101（排除自身 201）
      'revert: 回滚 #102 的改动 (#202)',  // 回滚 分支 → 102（剥末尾自身号 202 后窗口命中正文 #102）
      'hotfix: fix prod (#999)',          // hotfix 分支命中 grep 但无 revert 语境 → 不计
    ].join('\n');
    const got = collectRevertedPrs('/x', () => fakeLog);
    expect([...got].sort((a, b) => a - b)).toEqual([101, 102]);
  });
  it('runGit 抛错（git 不可用/非 git 目录）→ 空集，不阻断报告', () => {
    expect(collectRevertedPrs('/x', () => { throw new Error('not a git repo'); }).size).toBe(0);
  });
  it('反查参数确实经 buildRevertGitArgs 传入（含 -E -i -C gitDir）', () => {
    let captured = null;
    collectRevertedPrs('/probe', (args) => { captured = args; return ''; });
    expect(captured).toContain('-E');
    expect(captured).toContain('-i');
    expect(captured).toContain('-C');
    expect(captured).toContain('/probe');
  });
});

describe('quality-report.effectiveVerdict（事后回滚读时归一·不改历史行）', () => {
  const reverted = new Set([704]);
  it('pass/partial 行 pr 命中反查集合 → reverted（外部真相覆盖）', () => {
    expect(effectiveVerdict({ verdict: 'pass', pr: 704 }, reverted)).toBe('reverted');
    expect(effectiveVerdict({ verdict: 'partial', pr: 704 }, reverted)).toBe('reverted');
  });
  it('pass-* 变体命中 → reverted（先归一 pass 再覆盖）', () => {
    expect(effectiveVerdict({ verdict: 'pass-after-fix', pr: 704 }, reverted)).toBe('reverted');
  });
  it('pr 不命中 → 原 verdict', () => {
    expect(effectiveVerdict({ verdict: 'pass', pr: 999 }, reverted)).toBe('pass');
  });
  it('无 pr / 脏 pr 即便集合非空 → 不误标（oracle 关键·codex P2-1）', () => {
    expect(effectiveVerdict({ verdict: 'pass' }, reverted)).toBe('pass');
    expect(effectiveVerdict({ verdict: 'pass', pr: null }, reverted)).toBe('pass');
    expect(effectiveVerdict({ verdict: 'pass', pr: '' }, reverted)).toBe('pass'); // Number('')=0 非正整数
  });
  it('失败终态 orphaned/blocked/abandoned 即便 pr 命中 → 不覆盖（谈不上事后回滚）', () => {
    expect(effectiveVerdict({ verdict: 'orphaned', pr: 704 }, reverted)).toBe('orphaned');
    expect(effectiveVerdict({ verdict: 'blocked', pr: 704 }, reverted)).toBe('blocked');
  });
  it('空集 → 退化为 normalizeVerdict（向后兼容）', () => {
    expect(effectiveVerdict({ verdict: 'pass', pr: 704 }, new Set())).toBe('pass');
    expect(effectiveVerdict({ verdict: 'pass-scoped', pr: 704 }, new Set())).toBe('pass');
  });
});

describe('quality-report.aggregate · E2① 事后回滚（opts.revertedPrs 读时标记）', () => {
  const rows = [
    { uid: 'a', pr: 704, rounds_to_green: 1, rework_count: 0, verdict: 'pass' },
    { uid: 'b', pr: 705, rounds_to_green: 1, rework_count: 0, verdict: 'pass' },
    { uid: 'c', rounds_to_green: 1, rework_count: 0, verdict: 'pass' }, // 无 pr
  ];
  it('被回滚 PR 对应行读时标 reverted + 事后回滚率；不改其它行；被回滚不再算一次过', () => {
    const a = aggregate(rows, { revertedPrs: new Set([704]) });
    expect(a.verdict_breakdown.reverted).toBe(1);
    expect(a.verdict_breakdown.pass).toBe(2);            // b/c 仍 pass
    expect(a.post_revert_rate).toBe(+(1 / 3).toFixed(3));
    expect(a.reverted_count).toBe(1);                    // 有效回滚（字面0+反查1）
    expect(a.ledger_reverted_count).toBe(0);             // 字面无 reverted
    expect(a.post_revert_count).toBe(1);                 // git 反查新增
    expect(a.first_pass_rate).toBe(+(2 / 3).toFixed(3)); // a 被回滚 → 不再算一次过
  });
  it('无 pr 行不被误标（即便集合含某号·oracle 关键）', () => {
    const a = aggregate(rows, { revertedPrs: new Set([704, 999]) });
    expect(a.verdict_breakdown.reverted).toBe(1); // 仅 a(704)；c 无 pr 不误标
  });
  it('字面 reverted + 反查 reverted 分清来源（codex 闸-1 P1-1）', () => {
    const mixed = [
      { uid: 'x', pr: 800, verdict: 'reverted', rounds_to_green: 1 },                    // 字面
      { uid: 'y', pr: 801, verdict: 'pass', rounds_to_green: 1, rework_count: 0 },       // 反查命中
    ];
    const a = aggregate(mixed, { revertedPrs: new Set([801]) });
    expect(a.reverted_count).toBe(2);          // 有效总数
    expect(a.ledger_reverted_count).toBe(1);   // 字面 x
    expect(a.post_revert_count).toBe(1);       // 反查 y
  });
  it('无 opts（向后兼容）→ 反查不生效、双率字段安全为 0', () => {
    const a = aggregate(rows);
    expect(a.verdict_breakdown.reverted).toBe(0);
    expect(a.post_revert_rate).toBe(0);
    expect(a.post_rework_rate).toBe(0);
    expect(a.first_pass_rate).toBe(1); // 三行皆 pass+rtg1+rework0
  });
});

describe('quality-report.aggregate · E2② owner 返工（opts.reworkRows 任务维度）', () => {
  const ledger = [
    { uid: 'u1', pr: 704, verdict: 'pass', rounds_to_green: 1, rework_count: 0 },
    { uid: 'u2', pr: 705, verdict: 'pass', rounds_to_green: 1, rework_count: 0 },
    { uid: 'u3', verdict: 'pass', rounds_to_green: 1, rework_count: 0 },
  ];
  it('有返工任务数 / 总任务数 + 返工总次数（owner 口径·整数次数 N）', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 2 }, { uid: 'u2', count: 1 }] });
    expect(a.user_rework_total).toBe(3);                  // 2 + 1
    expect(a.user_rework_tasks).toBe(2);                  // u1, u2
    expect(a.task_count).toBe(3);                         // u1/u2/u3 去重
    expect(a.post_rework_rate).toBe(+(2 / 3).toFixed(3));
  });
  it('同任务多行返工 → 次数累加、任务只计 1（codex P1-2 去重）', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 1 }, { uid: 'u1', count: 2 }] });
    expect(a.user_rework_total).toBe(3);
    expect(a.user_rework_tasks).toBe(1);
  });
  it('rework 行只有 pr → 经 pr→uid 索引归一到同任务，不重复计（codex P1-2）', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 1 }, { pr: 704, count: 1 }] });
    expect(a.user_rework_tasks).toBe(1);   // pr:704 映射到 u1，与 uid:u1 同任务
    expect(a.user_rework_total).toBe(2);
  });
  it('count 严格正整数：负/0/小数(含 1.9 不向下取整)/NaN/字符串忽略（codex 闸-1 P2-5 + 闸-2 P2-3）', () => {
    const a = aggregate(ledger, { reworkRows: [
      { uid: 'u1', count: 0 }, { uid: 'u2', count: -3 }, { uid: 'u3', count: 'x' }, { uid: 'u1', count: NaN },
      { uid: 'u2', count: 1.9 }, { uid: 'u3', count: 1.5 }, // 小数(含 >1)严格忽略，不向下取整（避免脏数据静默当整数·owner 口径=整数次数 N）
    ] });
    expect(a.user_rework_total).toBe(0);
    expect(a.user_rework_tasks).toBe(0);
    expect(a.post_rework_rate).toBe(0);
  });
  it('count 整数值（含 2.0 这类整数小数）正常计入', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 2 }, { uid: 'u2', count: 2.0 }] });
    expect(a.user_rework_total).toBe(4);   // 2 + 2.0(=== 2 整数)
    expect(a.user_rework_tasks).toBe(2);
  });
  it('无 uid 无 pr 的 rework 行 → 无法归属，跳过', () => {
    const a = aggregate(ledger, { reworkRows: [{ count: 5, reason: '孤儿返工' }] });
    expect(a.user_rework_total).toBe(0);
    expect(a.user_rework_tasks).toBe(0);
  });
  it('task_count 任务维度去重（同 uid 多尝试行算 1 任务，区别于 n 尝试维度·codex P1-3）', () => {
    const multi = [
      { uid: 'u1', pr: 704, verdict: 'pass', rounds_to_green: 1, rework_count: 0 },
      { uid: 'u1', verdict: 'orphaned', claim_at: 't1' }, // 同 uid 第二次尝试
    ];
    const a = aggregate(multi);
    expect(a.n).toBe(2);          // 尝试维度（行数）
    expect(a.task_count).toBe(1); // 任务维度（uid 去重）
  });
});

describe('quality-report.aggregate · rework_data_collected（F4 配套：区分「0%」与「未采集」·2026-07-12）', () => {
  const ledger = [{ uid: 'u1', pr: 704, verdict: 'pass', rounds_to_green: 1, rework_count: 0 }];
  it('无 opts / reworkRows 缺省 → 未采集（sink 从未激活，非"验证过零返工"）', () => {
    expect(aggregate(ledger).rework_data_collected).toBe(false);
    expect(aggregate(ledger, {}).rework_data_collected).toBe(false);
  });
  it('reworkRows 空数组（sink 文件存在但为空）→ 仍视为未采集', () => {
    expect(aggregate(ledger, { reworkRows: [] }).rework_data_collected).toBe(false);
  });
  it('reworkRows 非数组（脏 opts）→ 未采集，不抛错', () => {
    expect(aggregate(ledger, { reworkRows: null }).rework_data_collected).toBe(false);
    expect(aggregate(ledger, { reworkRows: 'bad' }).rework_data_collected).toBe(false);
  });
  it('reworkRows 有≥1行（即便全部 count 非法/过滤后为 0）→ 已采集，post_rework_rate 仍可为 0', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 0 }] });
    expect(a.rework_data_collected).toBe(true);
    expect(a.post_rework_rate).toBe(0); // count=0 被过滤，真实 0%——但与"未采集"字段独立可区分
  });
  it('reworkRows 有真实返工行 → 已采集 + 非零返工率', () => {
    const a = aggregate(ledger, { reworkRows: [{ uid: 'u1', count: 1 }] });
    expect(a.rework_data_collected).toBe(true);
    expect(a.post_rework_rate).toBeGreaterThan(0);
  });
});

describe('quality-report.parseUserReworkLog（owner 返工 sink 解析·跳坏行）', () => {
  it('跳过坏 JSON 行 / 空行', () => {
    const rows = parseUserReworkLog([J({ uid: 'a', count: 1 }), '', 'bad json', J({ pr: 704, count: 2 })]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ pr: 704, count: 2 });
  });
  it('空/缺失输入安全', () => {
    expect(parseUserReworkLog([])).toEqual([]);
    expect(parseUserReworkLog(null)).toEqual([]);
  });
});

// ============ F1 entry↔ledger 一致闸支持函数（治 D1 账本断档·2026-07-12）============

describe('quality-report.extractPrEvolutionEntryDates（pr-evolution.md entry 标题日期提取）', () => {
  it('提取 ## / ### 开头的 YYYY-MM-DD 标题日期', () => {
    const content = [
      '## 2026-07-04 · rules 瘦身第二批',
      '',
      '- 正文一行',
      '### 2026-07-05 · 子标题（三级）',
      '## 2026-07-08 · #977 硬编码专项',
    ].join('\n');
    expect(extractPrEvolutionEntryDates(content)).toEqual(['2026-07-04', '2026-07-05', '2026-07-08']);
  });
  it('非标题行 / 无日期标题 → 不提取', () => {
    const content = '## 不带日期的标题\n正文提到 2026-07-04 但非标题行\n#### 太深层级不识别';
    expect(extractPrEvolutionEntryDates(content)).toEqual([]);
  });
  it('空/缺失输入安全', () => {
    expect(extractPrEvolutionEntryDates('')).toEqual([]);
    expect(extractPrEvolutionEntryDates(null)).toEqual([]);
    expect(extractPrEvolutionEntryDates(undefined)).toEqual([]);
  });
});

describe('quality-report.ledgerMaxTs（账本最新 ts·取全表 max 而非最后一行，容忍 union 合并乱序）', () => {
  it('取全表最大 ts（非最后一行）——union 合并致乱序时仍正确', () => {
    const rows = [{ ts: '2026-07-04' }, { ts: '2026-07-15' }, { ts: '2026-07-09' }];
    expect(ledgerMaxTs(rows)).toBe('2026-07-15');
  });
  it('末尾行不是最大值时仍正确取全表 max（模拟并发 append 乱序·2026-07-12 同批孤儿记账场景）', () => {
    const rows = [{ ts: '2026-07-15' }, { ts: '2026-07-04' }]; // 最后一行 ts 更早
    expect(ledgerMaxTs(rows)).toBe('2026-07-15');
  });
  it('非法/缺失 ts 行忽略不污染 max', () => {
    const rows = [{ ts: '2026-07-10' }, { ts: null }, { ts: 'not-a-date' }, {}, { ts: 42 }];
    expect(ledgerMaxTs(rows)).toBe('2026-07-10');
  });
  it('空数组 / 全无合法 ts → null（无基线）', () => {
    expect(ledgerMaxTs([])).toBeNull();
    expect(ledgerMaxTs([{ ts: null }, {}])).toBeNull();
    expect(ledgerMaxTs(null)).toBeNull();
  });
  it('ts 含时间戳后缀（非纯日期）时按前 10 字符归一比较', () => {
    const rows = [{ ts: '2026-07-04T10:00:00Z' }, { ts: '2026-07-04' }];
    expect(ledgerMaxTs(rows)).toBe('2026-07-04');
  });
});

describe('quality-report.isEntryLedgerStale（entry↔ledger 断档判据·纯函数）', () => {
  it('滞后超过 maxLagDays（默认 3）→ true', () => {
    expect(isEntryLedgerStale('2026-07-15', '2026-07-10')).toBe(true); // 滞后 5 天
  });
  it('滞后未超过阈值 → false（边界值=阈值本身不算超过）', () => {
    expect(isEntryLedgerStale('2026-07-13', '2026-07-10')).toBe(false); // 恰好 3 天，不超过
    expect(isEntryLedgerStale('2026-07-12', '2026-07-10')).toBe(false); // 2 天
  });
  it('entry 早于或等于账本 ts → false（不诬告"未来"账本行）', () => {
    expect(isEntryLedgerStale('2026-07-08', '2026-07-10')).toBe(false);
    expect(isEntryLedgerStale('2026-07-10', '2026-07-10')).toBe(false);
  });
  it('自定义 maxLagDays 阈值', () => {
    expect(isEntryLedgerStale('2026-07-12', '2026-07-10', 1)).toBe(true);  // 2 天 > 1
    expect(isEntryLedgerStale('2026-07-11', '2026-07-10', 1)).toBe(false); // 1 天 = 阈值，不超过
  });
  it('ledgerMaxTsVal 为 null（空账本）→ false（无基线不诬告）', () => {
    expect(isEntryLedgerStale('2026-07-15', null)).toBe(false);
  });
  it('非法日期字符串安全返回 false', () => {
    expect(isEntryLedgerStale('not-a-date', '2026-07-10')).toBe(false);
    expect(isEntryLedgerStale('2026-07-15', 'not-a-date')).toBe(false);
    expect(isEntryLedgerStale('', '2026-07-10')).toBe(false);
  });
});

// ============ E5 样本主题集中度（治茧房2 过拟合·2026-06-27·codex 闸-1 全采纳）============

describe('quality-report.hhiOf（赫芬达尔指数 = Σ占比²；1=完全集中 / 1/n=完全均匀）', () => {
  it('完全集中（单一桶）→ HHI=1', () => {
    expect(hhiOf([10])).toBe(1);
    expect(hhiOf([5, 0, 0])).toBe(1);
  });
  it('完全均匀（n 桶等量）→ HHI=1/n', () => {
    expect(hhiOf([1, 1, 1, 1])).toBeCloseTo(0.25, 6);
    expect(hhiOf([3, 3])).toBeCloseTo(0.5, 6);
  });
  it('已知分布手算：[3,1] → (3/4)²+(1/4)² = 0.625', () => {
    expect(hhiOf([3, 1])).toBeCloseTo(0.625, 6);
  });
  it('空 / 全零 / 非法 → 0（无样本不算集中）', () => {
    expect(hhiOf([])).toBe(0);
    expect(hhiOf([0, 0])).toBe(0);
    expect(hhiOf(null)).toBe(0);
  });
  it('负数 / Infinity / NaN 过滤为 0（codex 闸-2 P1-4 边界防护，不污染平方和）', () => {
    expect(hhiOf([-1, 2])).toBe(1);                 // -1→0，剩 [0,2] → 单一有效桶 HHI=1
    expect(hhiOf([Infinity, 1])).toBe(1);           // Infinity→0，剩 [0,1] → HHI=1
    expect(hhiOf([NaN, 3, 3])).toBeCloseTo(0.5, 6); // NaN→0，剩 [0,3,3] → 两等量桶 HHI=0.5
  });
});

describe('quality-report.classifyTopic（E5 主题分类·业务工程优先于技术实现·codex 闸-1 P0-3）', () => {
  it('省份接入证据族命中（G3-G8 / 多省·分省·省份 / branch_code·prefix_map·派生域 / SX·山西 / RLS / Phase / current<省> / PR#753 / 切省）', () => {
    for (const t of [
      'G3 维度表多省 loader', 'G7 山西账号 preset-users', 'G8 前端空态保护',
      '多省RLS查询层收口', '转换质量报告按省隔离', 'sync-vps 分省安全改造',
      'P1 premium branch_code constant→prefix_map 派生', 'Phase 0 省份派生化',
      'Phase B B1 discoverParquetFiles 下钻 current/<省>/', 'G7 P2 SX账号 login→403',
      'PR #753 codex 对抗评审（分省安全同步）', '山西机构规范化映射',
      '全国超管 xuechenglong 切省(SC/SX)+全国合并视图', 'RepairDim 省份化',
    ]) expect(classifyTopic(t)).toBe('省份接入');
  });
  it('省份信号优先于技术词（含 etl/派生/RLS/claims 技术味的多省任务仍归省份接入，不被技术主题截胡）', () => {
    expect(classifyTopic('G4 派生域多省 loader')).toBe('省份接入');
    expect(classifyTopic('repair 影子网点分省 RLS 隔离（ClaimsDetail+PolicyFact 侧）')).toBe('省份接入');
    expect(classifyTopic('P3-A claims_detail constant→prefix_map 派生化 + 自校验 + ClaimsDetail loader')).toBe('省份接入');
  });
  it('省份证据族变体命中（codex 闸-2 P1-2 补漏判：驼峰 / 连字 / 英文省名 / current 路径变体 / 回填）', () => {
    for (const t of [
      'branchCode 调整', 'branch-code 调整', 'prefix map 调整', 'Shanxi 调整',
      'sichuan 调整', 'current/SX 调整', 'current/shanxi 调整',
    ]) expect(classifyTopic(t)).toBe('省份接入');
  });
  it('非省份任务归对应业务主题', () => {
    expect(classifyTopic('Loop v2 编排协议（首个用 codex 双闸的任务）')).toBe('loop治理');
    expect(classifyTopic('loop 跨会话认领锁(event-log claim lock+TTL)')).toBe('loop治理');
    expect(classifyTopic('E1 账本记失败（治茧房1 幸存者偏差·verdict 扩失败态）')).toBe('loop治理');
    expect(classifyTopic('零赔付专项分析')).toBe('数据分析口径');
    expect(classifyTopic('时间口径语义层 v0.1 收尾')).toBe('数据分析口径');
    expect(classifyTopic('成本/KPI 立方体生产不可服务')).toBe('数据分析口径');
    expect(classifyTopic('PerformanceAnalysisPanel 1401→882行拆分(4文件)')).toBe('产品前端');
    expect(classifyTopic('admin 纯逻辑提取+单测(0→21)')).toBe('产品前端');
    expect(classifyTopic('wecom_smartsheet 12 三级机构续保推送')).toBe('外部集成');
  });
  it('无法分类 → 其他（兜底，不臆造）', () => {
    expect(classifyTopic('一些无关紧要的杂项工作')).toBe('其他');
    expect(classifyTopic('')).toBe('其他');
    expect(classifyTopic(null)).toBe('其他');
    expect(classifyTopic(undefined)).toBe('其他');
  });
  it('删通用泛词后非省份反例不被误归省份（codex 闸-2 复审 P1-1：派生指标/数据回填/地域分析）', () => {
    expect(classifyTopic('派生指标口径分析')).toBe('数据分析口径');     // "派生"无 域/视图/化/映射/branch 上下文 → 不命中省份，"口径"归数据
    expect(classifyTopic('历史数据回填任务')).toBe('其他');            // "回填"已从省份证据移除 → 无信号归其他
    expect(classifyTopic('地域分布赔付情况分析')).toBe('数据分析口径');  // "地域"已移除 → "赔付"归数据
  });
});

describe('quality-report.overfitFlag（打标判据·codex 闸-1 P0-4 纯函数可测·D4 相对判据·D6 边界）', () => {
  it('样本不足（<2）→ insufficient_cross_domain_evidence 不打过拟合标（单样本 HHI 必=1 不误触发）', () => {
    expect(overfitFlag({ sampleCount: 1, topName: '省份接入', topShare: 1, hhiRatio: 1 }))
      .toEqual({ flagged: false, status: 'insufficient_cross_domain_evidence' });
  });
  it('top 为「其他」→ classifier_coverage_low 不打标（防分类器失效的伪高集中·codex P1-2）', () => {
    expect(overfitFlag({ sampleCount: 5, topName: '其他', topShare: 0.8, hhiRatio: 3 }))
      .toEqual({ flagged: false, status: 'classifier_coverage_low' });
  });
  it('单一主题占比 ≥ 0.5 → overfit 打标', () => {
    expect(overfitFlag({ sampleCount: 10, topName: '省份接入', topShare: 0.53, hhiRatio: 2 }))
      .toEqual({ flagged: true, status: 'overfit' });
  });
  it('hhi_ratio ≥ 2（相对均匀基线 2 倍）→ overfit 打标，即使占比未过半（codex D4 相对判据）', () => {
    expect(overfitFlag({ sampleCount: 10, topName: '省份接入', topShare: 0.45, hhiRatio: 2.1 }))
      .toEqual({ flagged: true, status: 'overfit' });
  });
  it('分散（占比 < 0.5 且 ratio < 2）→ diverse 不打标', () => {
    expect(overfitFlag({ sampleCount: 10, topName: '省份接入', topShare: 0.3, hhiRatio: 1.4 }))
      .toEqual({ flagged: false, status: 'diverse' });
  });
  it('topName 缺失 / 非字符串 → classifier_coverage_low（不漏到 diverse·codex 闸-2 P1-3）', () => {
    expect(overfitFlag({ sampleCount: 5 })).toEqual({ flagged: false, status: 'classifier_coverage_low' });
    expect(overfitFlag({ sampleCount: 5, topName: null, topShare: 0.9, hhiRatio: 3 }))
      .toEqual({ flagged: false, status: 'classifier_coverage_low' });
  });
});

describe('quality-report.aggregate · 样本主题集中度（E5 治茧房2·codex 闸-1 全采纳·读时计算不 mutate）', () => {
  const mk = (uid, task, domain) => ({ uid, task, domain, verdict: 'pass', rounds_to_green: 1, rework_count: 0 });
  // 代表性 fixture：6 省份 + 2 loop + 1 前端 + 1 其他 = 10 任务（仿真实账本"单一工程主导"形态）
  const overfitRows = [
    mk('s1', 'G3 维度表多省 loader', ['etl']),
    mk('s2', 'P1 premium branch_code prefix_map 派生', ['etl', 'python']),
    mk('s3', 'Phase B current/<省>/ 下钻', ['data-architecture']),
    mk('s4', '山西账号 preset-users', ['be-config']),
    mk('s5', 'repair 影子网点分省 RLS 隔离', ['be-sql']),
    mk('s6', 'sync-vps 分省安全改造', ['scripts']),
    mk('l1', 'Loop v2 编排协议', ['scripts', 'meta']),
    mk('l2', 'loop 认领锁 event-log', ['scripts', 'meta']),
    mk('f1', 'PerformanceAnalysisPanel 拆分', ['frontend']),
    mk('o1', '一些无关杂项', ['docs']),
  ];
  it('topic：省份接入为 top（oracle 行为），share=6/10，HHI 明显 > 均匀基线（茧房2 可见）', () => {
    const c = aggregate(overfitRows).concentration;
    expect(c.topic.top.name).toBe('省份接入');
    expect(c.topic.top.share).toBeCloseTo(0.6, 6);
    expect(c.topic.sample_count).toBe(10);
    // hhi = (6/10)²+(2/10)²+(1/10)²+(1/10)² = 0.42; uniform = 1/4 = 0.25
    expect(c.topic.hhi).toBeCloseTo(0.42, 6);
    expect(c.topic.bucket_count).toBe(4);
    expect(c.topic.hhi).toBeGreaterThan(c.topic.uniform);
    expect(c.topic.hhi_ratio).toBeCloseTo(0.42 / 0.25, 4);
  });
  it('domain 双口径并存：技术域比业务主题分散 + 精确手算（codex P1-1 + 闸-2 P2-3 抓分摊公式回归）', () => {
    const c = aggregate(overfitRows).concentration;
    // 精确手算（10 任务·域权重 etl1.5 python.5 data-arch1 be-config1 be-sql1 scripts2 meta1 frontend1 docs1，total=10）
    expect(c.domain.label_total).toBe(13);                     // 标签计数 etl2+py1+da1+bc1+bs1+scripts3+meta2+fe1+docs1
    expect(c.domain.bucket_count).toBe(9);                     // 9 个技术域 > 主题 4
    expect(c.domain.task_weighted_hhi).toBeCloseTo(0.125, 4); // Σ(w/10)² = (2.25+.25+1+1+1+4+1+1+1)/100 = 12.5/100
    expect(c.domain.top.name).toBe('scripts');                 // 任务加权 2/10 最大
    expect(c.domain.top.share).toBeCloseTo(0.2, 4);
    expect(typeof c.domain.label_hhi).toBe('number');          // 标签口径保留（兼容现有"按域"段）
    expect(c.domain.task_weighted_hhi).toBeLessThan(c.topic.hhi); // 技术域分散 < 业务主题集中（茧房2 隐身机制）
    expect(c.domain.bucket_count).toBeGreaterThan(c.topic.bucket_count);
  });
  it('读时计算不 mutate 输入行（codex 闸-2 P2-2：冻结输入仍不抛 = 未写回 row 字段）', () => {
    const frozen = overfitRows.map((r) => Object.freeze({ ...r, domain: r.domain ? Object.freeze([...r.domain]) : r.domain }));
    let c;
    expect(() => { c = aggregate(frozen).concentration; }).not.toThrow();
    expect(c.topic.top.name).toBe('省份接入'); // 冻结输入下仍正常产出
  });
  it('打标：top.share≥0.5 → flagged + label「待跨域验证」（基于 topic 维度·codex D5）', () => {
    const c = aggregate(overfitRows).concentration;
    expect(c.overfit.flagged).toBe(true);
    expect(c.overfit.status).toBe('overfit');
    expect(c.overfit.label).toBe('待跨域验证');
    expect(c.overfit.evidence.topic).toBe('省份接入');
    expect(c.overfit.evidence.share).toBeCloseTo(0.6, 6);
  });
  it('单样本（n=1）：topic.hhi=1 但 status=insufficient_cross_domain_evidence 不打过拟合标（codex D6）', () => {
    const c = aggregate([mk('s1', 'G3 维度表多省 loader', ['etl'])]).concentration;
    expect(c.topic.hhi).toBe(1);
    expect(c.overfit.flagged).toBe(false);
    expect(c.overfit.status).toBe('insufficient_cross_domain_evidence');
  });
  it('全归「其他」：top=其他 → classifier_coverage_low 不打标（codex P1-2 伪高集中防护）', () => {
    const c = aggregate([mk('o1', '杂项甲', ['docs']), mk('o2', '杂项乙', ['docs']), mk('o3', '杂项丙', ['docs'])]).concentration;
    expect(c.topic.top.name).toBe('其他');
    expect(c.overfit.flagged).toBe(false);
    expect(c.overfit.status).toBe('classifier_coverage_low');
  });
  it('空账本：无 concentration（保持现有 {n:0} 契约）', () => {
    expect(aggregate([]).concentration).toBeUndefined();
  });
  it('缺 domain 字段行：回退 (无域) 桶，不崩（codex D6）', () => {
    const c = aggregate([
      mk('s1', 'G3 维度表多省 loader', undefined),
      mk('s2', '分省安全改造', undefined),
      mk('l1', 'Loop v2 编排协议', ['meta']),
    ]).concentration;
    expect(c.domain.distribution['(无域)']).toBeGreaterThan(0);
    expect(c.topic.top.name).toBe('省份接入'); // 缺 domain 不影响 topic 分类
  });
});
