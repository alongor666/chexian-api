import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvents, renderLedger } from '../etl-ledger/render.mjs';

const EVENTS = [
  { ts: '2026-06-26T10:00:00+08:00', run_id: 'rA', stage: 'etl', domain: 'premium', status: 'success', row_count: 100, date_range: '2021-01-01~2026-05-15' },
  { ts: '2026-06-26T10:01:00+08:00', run_id: 'rA', stage: 'validate', domain: 'claims', status: 'failure', error: '行数不足' },
  { ts: '2026-06-27T10:00:00+08:00', run_id: 'rB', stage: 'etl', domain: 'premium', status: 'success', row_count: 110, date_range: '2021-01-01~2026-05-16' },
  { ts: '2026-06-27T10:05:00+08:00', run_id: 'rB', stage: 'health', domain: null, status: 'warning', error: 'reload 重试' },
];

describe('renderLedger', () => {
  const md = renderLedger(EVENTS);

  it('含三视角标题', () => {
    expect(md).toContain('🔴 断点告警');
    expect(md).toContain('📅 最近运行时间线');
    expect(md).toContain('📊 各域生命周期');
  });

  it('断点区含失败/警告的域与原因', () => {
    expect(md).toContain('行数不足');
    expect(md).toContain('claims');
    expect(md).toContain('reload 重试');
  });

  it('时间线倒序（最新 run 在前）', () => {
    expect(md.indexOf('rB')).toBeLessThan(md.indexOf('rA'));
  });

  it('域生命周期显示当前行数与增量', () => {
    expect(md).toContain('110'); // premium 最新行数
    expect(md).toContain('+10'); // 110 - 100
  });
});

describe('loadEvents', () => {
  it('跳过非法 JSON 坏行', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'etl-render-')), 'l.jsonl');
    writeFileSync(p, '{"a":1}\n坏行不是json\n{"b":2}\n', 'utf8');
    expect(loadEvents(p)).toHaveLength(2);
  });

  it('文件不存在返回空数组', () => {
    expect(loadEvents('/nonexistent-xyz/l.jsonl')).toEqual([]);
  });
});
