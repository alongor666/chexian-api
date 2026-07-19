import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendBackfillEvents,
  dedupeByDomainChange,
  hasBackfilledEvents,
  parseSnapshotToEvents,
} from '../etl-ledger/backfill-from-git.mjs';

describe('parseSnapshotToEvents', () => {
  const obj = {
    domains: [
      { id: 'premium', row_count: 100, data_range: '2021-01-01 ~ 2026-05-16' },
      { id: 'claims_detail', row_count: 50, data_range: '2019-01-01 ~ 2026-05-16' },
      { id: 'plate_region', name: '无行数维度' }, // 无 row_count → 跳过
    ],
  };
  const evs = parseSnapshotToEvents(obj, { sha: 'abcdef1234567', date: '2026-06-14T10:00:00+08:00' });

  it('只回填有 row_count 的域', () => {
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.domain)).toEqual(['premium', 'claims_detail']);
  });

  it('事件字段正确（含空格归一、backfilled 标记）', () => {
    const p = evs[0];
    expect(p.stage).toBe('etl');
    expect(p.backfilled).toBe(true);
    expect(p.actor).toBe('backfill');
    expect(p.row_count).toBe(100);
    expect(p.date_range).toBe('2021-01-01~2026-05-16');
    expect(p.ts).toBe('2026-06-14T10:00:00+08:00');
    expect(p.source_commit).toBe('abcdef12');
  });

  it('空对象安全返回空数组', () => {
    expect(parseSnapshotToEvents({}, { sha: 'x', date: 'd' })).toEqual([]);
    expect(parseSnapshotToEvents(null, { sha: 'x', date: 'd' })).toEqual([]);
  });
});

describe('dedupeByDomainChange', () => {
  it('同域连续相同 row_count 只留变化点', () => {
    const events = [
      { domain: 'premium', row_count: 100 },
      { domain: 'premium', row_count: 100 },
      { domain: 'premium', row_count: 110 },
      { domain: 'claims', row_count: 50 },
      { domain: 'premium', row_count: 110 },
    ];
    const out = dedupeByDomainChange(events);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.row_count)).toEqual([100, 110, 50]);
  });
});

describe('月度分片回填', () => {
  it('跨月事件按各自 ts 写入对应分片，不回写封存历史', () => {
    const root = mkdtempSync(join(tmpdir(), 'etl-ledger-backfill-'));
    try {
      const sealed = join(root, 'etl-ledger.jsonl');
      writeFileSync(sealed, '{"sealed":true}\n');
      const events = [
        { ts: '2026-05-31T23:59:59+08:00', domain: 'premium', backfilled: true },
        { ts: '2026-06-01T00:00:00+08:00', domain: 'claims_detail', backfilled: true },
      ];
      const targets = appendBackfillEvents(events, {
        pathForEvent: (event) => join(root, 'events', `${event.ts.slice(0, 7)}.jsonl`),
      });

      expect(targets.map((p) => p.split('/').at(-1))).toEqual(['2026-05.jsonl', '2026-06.jsonl']);
      expect(readFileSync(join(root, 'events/2026-05.jsonl'), 'utf8')).toContain('"domain":"premium"');
      expect(readFileSync(join(root, 'events/2026-06.jsonl'), 'utf8')).toContain('"domain":"claims_detail"');
      expect(readFileSync(sealed, 'utf8')).toBe('{"sealed":true}\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('任一来源含 backfilled 事件即识别为已回填', () => {
    const root = mkdtempSync(join(tmpdir(), 'etl-ledger-backfill-check-'));
    try {
      const sealed = join(root, 'etl-ledger.jsonl');
      const monthly = join(root, '2026-06.jsonl');
      writeFileSync(sealed, '{"backfilled":false}\n');
      writeFileSync(monthly, '{"backfilled":true}\n');
      expect(hasBackfilledEvents([sealed, monthly])).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
