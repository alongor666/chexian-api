/**
 * ETL 台账分析器纯函数单测（loadRuns / summarizeRun / aggregateSteps）。
 * 全部用 tmp jsonl 文件，不依赖真实台账。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRuns, summarizeRun, aggregateSteps } from '../analyze.mjs';

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function makeLedger(lines) {
  dir = mkdtempSync(join(tmpdir(), 'ledger-analyze-'));
  const p = join(dir, 'etl-ledger.jsonl');
  writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return p;
}

describe('loadRuns', () => {
  it('文件不存在 → 空 Map', () => {
    expect(loadRuns('/tmp/nonexistent-ledger-xyz.jsonl').size).toBe(0);
  });

  it('按 run_id 分组；坏行跳过不中断', () => {
    const p = makeLedger([
      { ts: '2026-07-11T10:00:00.000+08:00', run_id: 'r1', stage: 'run', step: 'start', status: 'success' },
      '{{{ 坏行',
      { ts: '2026-07-11T10:01:00.000+08:00', run_id: 'r1', stage: 'pipeline', step: 'ETL', status: 'success', duration_ms: 60000 },
      { ts: '2026-07-11T11:00:00.000+08:00', run_id: 'r2', stage: 'run', step: 'start', status: 'success' },
    ]);
    const runs = loadRuns(p);
    expect(runs.size).toBe(2);
    expect(runs.get('r1')).toHaveLength(2);
    expect(runs.get('r2')).toHaveLength(1);
  });

  it('sinceMs 过滤早于窗口的事件', () => {
    const p = makeLedger([
      { ts: '2026-07-01T10:00:00.000+08:00', run_id: 'old', stage: 'run', step: 'start' },
      { ts: '2026-07-11T10:00:00.000+08:00', run_id: 'new', stage: 'run', step: 'start' },
    ]);
    const runs = loadRuns(p, { sinceMs: Date.parse('2026-07-10T00:00:00.000+08:00') });
    expect([...runs.keys()]).toEqual(['new']);
  });
});

describe('summarizeRun', () => {
  it('带 run start/end 打点：总耗时取 end.duration_ms，trigger/终态/断点齐全', () => {
    const s = summarizeRun('r1', [
      { ts: '2026-07-11T10:00:00.000+08:00', stage: 'run', step: 'start', trigger: 'watcher', status: 'success' },
      { ts: '2026-07-11T10:01:00.000+08:00', stage: 'pipeline', step: 'ETL', status: 'success', duration_ms: 60000 },
      { ts: '2026-07-11T10:02:00.000+08:00', stage: 'pipeline', step: 'VPS sync', status: 'failed', duration_ms: 5000, exit_code: 1 },
      { ts: '2026-07-11T10:02:05.000+08:00', stage: 'run', step: 'end', status: 'failed', trigger: 'watcher', duration_ms: 125000, note: 'VPS sync 退出码 1' },
    ]);
    expect(s.trigger).toBe('watcher');
    expect(s.status).toBe('failed');
    expect(s.totalMs).toBe(125000);
    expect(s.totalIsInferred).toBe(false);
    expect(s.breakpoint).toBe('VPS sync 退出码 1');
    expect(s.steps).toHaveLength(2);
  });

  it('旧数据无 run 打点：总耗时由首末事件推断并标记', () => {
    const s = summarizeRun('legacy', [
      { ts: '2026-07-11T10:00:00.000+08:00', stage: 'etl', step: 'premium_transform', status: 'success' },
      { ts: '2026-07-11T10:03:00.000+08:00', stage: 'vps_sync', step: 'rsync_all', status: 'success' },
    ]);
    expect(s.totalMs).toBe(180000);
    expect(s.totalIsInferred).toBe(true);
    expect(s.breakpoint).toBe(null);
  });
});

describe('aggregateSteps', () => {
  it('跨 run 聚合：次数/失败数/中位/最大，按总耗时降序', () => {
    const mk = (steps) => ({ steps });
    const rows = aggregateSteps([
      mk([{ step: 'ETL', status: 'success', ms: 100 }, { step: 'governance', status: 'success', ms: 10 }]),
      mk([{ step: 'ETL', status: 'success', ms: 300 }, { step: 'governance', status: 'failed', ms: 20 }]),
      mk([{ step: 'ETL', status: 'success', ms: 200 }]),
    ]);
    expect(rows[0].step).toBe('ETL'); // 总耗时 600 最大 → 排第一
    expect(rows[0]).toMatchObject({ runs: 3, fails: 0, p50: 200, max: 300 });
    expect(rows[1]).toMatchObject({ step: 'governance', runs: 2, fails: 1, max: 20 });
  });

  it('无耗时数据的环节 p50/max 为 null', () => {
    const rows = aggregateSteps([{ steps: [{ step: 'X', status: 'success', ms: null }] }]);
    expect(rows[0]).toMatchObject({ p50: null, max: null, runs: 1 });
  });
});
