/**
 * BACKLOG「每事件一文件」读写层单测（卡 637c35 · backlog-eventlog.md §12）
 *
 * 背景：BACKLOG_LOG.jsonl 单文件尾部追加是全仓最高并发写竞争点——merge=union 只在本地生效，
 * GitHub 服务端计算 PR 可合并性不应用 merge 策略，两 PR 同改文件尾仍标 CONFLICTING。
 * 根治：存量 jsonl 冻结只读，新事件经 appendEvents() 每事件写一个独立文件到
 * backlog-events/<YYYY-MM>/<at压缩>-<eid>.json；loadLog() 合并两源，fold 按 (at,eid) 全序折叠。
 *
 * 本测试锁五条不变量：
 * ① eventFilePath 命名（按月分片 + at压缩 + eid，缺 at/eid 响亮失败）
 * ② appendEvents/loadEventsDir 往返一致 + __src 定位标签 + 'wx' 撞名拒绝覆盖
 * ③ loadLog 两源合并：jsonl 里的 create + 目录里的 status 折叠出正确终态（物理落位无关）
 * ④ 两个「不同 PR」各写各的事件文件互不重名（并发零冲突的文件层前提）
 * ⑤ validateLog 对目录事件用文件路径定位报错（孤儿事件）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  eventFilePath,
  appendEvents,
  loadEventsDir,
  loadLog,
  fold,
  validateLog,
} from '../scripts/backlog/lib.mjs';

let dir: string;
let jsonlPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backlog-events-test-'));
  jsonlPath = join(dir, 'frozen.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const eventsDir = () => join(dir, 'backlog-events');

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    uid: '2026-07-11-claude-abc123',
    kind: 'status',
    ts: '2026-07-11',
    actor: '@claude',
    status: 'IN_PROGRESS',
    evidence: '',
    at: '2026-07-11T02:46:57.323Z',
    eid: 'deadbeef',
    ...overrides,
  };
}

describe('eventFilePath（命名不变量）', () => {
  it('按月分片 + at压缩 + eid', () => {
    expect(eventFilePath(makeEvent())).toBe('2026-07/2026-07-11T024657323Z-deadbeef.json');
  });

  it('缺 at 或 eid 响亮失败（禁止无时间戳/无唯一键的事件落盘）', () => {
    expect(() => eventFilePath(makeEvent({ at: undefined }))).toThrow(/缺 at\/eid/);
    expect(() => eventFilePath(makeEvent({ eid: undefined }))).toThrow(/缺 at\/eid/);
  });
});

describe('appendEvents / loadEventsDir（写读往返）', () => {
  it('每事件一文件写入，读回内容一致且带 __src 定位标签', () => {
    const e1 = makeEvent();
    const e2 = makeEvent({ eid: 'cafe0001', at: '2026-08-01T00:00:00.000Z', kind: 'note', text: '测试' });
    const written = appendEvents([e1, e2], eventsDir());
    expect(written).toEqual([
      'backlog-events/2026-07/2026-07-11T024657323Z-deadbeef.json',
      'backlog-events/2026-08/2026-08-01T000000000Z-cafe0001.json',
    ]);

    const loaded = loadEventsDir(eventsDir());
    expect(loaded).toHaveLength(2);
    // 目录按名排序：2026-07 分片先于 2026-08
    expect(loaded[0].eid).toBe('deadbeef');
    expect(loaded[0].__src).toBe('backlog-events/2026-07/2026-07-11T024657323Z-deadbeef.json');
    expect(loaded[1].text).toBe('测试');
    // 文件内容 = 单行 JSON + 换行（跨 ref `git grep` 倾倒依赖单行结构）
    const raw = readFileSync(join(eventsDir(), '2026-07/2026-07-11T024657323Z-deadbeef.json'), 'utf-8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw).uid).toBe(e1.uid);
  });

  it("撞名拒绝覆盖（flag 'wx' 响亮失败，事件文件禁改禁删）", () => {
    appendEvents([makeEvent()], eventsDir());
    expect(() => appendEvents([makeEvent()], eventsDir())).toThrow();
  });

  it('目录不存在 / 传 null → 读回空数组（e2e env 覆盖时可显式关闭目录源）', () => {
    expect(loadEventsDir(join(dir, 'no-such-dir'))).toEqual([]);
    expect(loadEventsDir(null as unknown as string)).toEqual([]);
  });

  it('非法 JSON 文件响亮失败并指明文件路径', () => {
    appendEvents([makeEvent()], eventsDir());
    writeFileSync(join(eventsDir(), '2026-07', '2026-07-11T024657999Z-badbad01.json'), '{broken', 'utf-8');
    expect(() => loadEventsDir(eventsDir())).toThrow(/badbad01\.json 非法 JSON/);
  });
});

describe('loadLog 两源合并 + fold 折叠（物理落位无关）', () => {
  it('jsonl 里的 create + 目录里的 status → 折叠出目录事件的终态', () => {
    const create = {
      uid: '2026-07-11-claude-abc123', kind: 'create', ts: '2026-07-11', actor: '@claude',
      section: '测试', priority: 'P3', desc: '两源合并用例', docs: 'N/A', code: 'N/A',
      at: '2026-07-11T00:00:00.000Z', eid: 'aaaa0001',
    };
    writeFileSync(jsonlPath, JSON.stringify(create) + '\n', 'utf-8');
    appendEvents([
      makeEvent({ eid: 'bbbb0002', at: '2026-07-11T01:00:00.000Z', status: 'DOING' }),
      makeEvent({ eid: 'cccc0003', at: '2026-07-11T02:00:00.000Z', status: 'DONE', evidence: 'PR #9999' }),
    ], eventsDir());

    const events = loadLog(jsonlPath, eventsDir());
    expect(events).toHaveLength(3);
    const { errors } = validateLog(events);
    expect(errors).toEqual([]);

    const task = fold(events).get('2026-07-11-claude-abc123');
    expect(task).toBeDefined();
    expect(task!.status).toBe('DONE'); // (at,eid) 全序 LWW：目录里最晚的 status 生效
    expect(task!.evidence).toBe('PR #9999');
  });

  it('两个「不同 PR」各写一个事件 → 文件名互不重名（并发零冲突的文件层前提）', () => {
    // 模拟两个并发分支各自 appendEvents：同一 uid、同一秒、不同 eid
    const prA = makeEvent({ eid: 'aaaaaaaa', kind: 'note', text: 'PR A 的收口 note' });
    const prB = makeEvent({ eid: 'bbbbbbbb', kind: 'note', text: 'PR B 的收口 note' });
    const [pathA] = appendEvents([prA], eventsDir());
    const [pathB] = appendEvents([prB], eventsDir());
    expect(pathA).not.toBe(pathB);
    expect(loadEventsDir(eventsDir())).toHaveLength(2);
  });
});

describe('validateLog 定位标签', () => {
  it('目录事件的孤儿报错用文件路径定位（非行号）', () => {
    appendEvents([makeEvent({ uid: '2026-07-11-claude-orphan' })], eventsDir());
    const { errors } = validateLog(loadEventsDir(eventsDir()));
    expect(errors.some(e => e.includes('事件文件 backlog-events/2026-07/') && e.includes('孤儿事件'))).toBe(true);
  });
});
