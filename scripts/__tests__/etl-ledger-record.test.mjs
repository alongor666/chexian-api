import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent, localIsoNow } from '../etl-ledger/record.mjs';

const tmpLedger = () => join(mkdtempSync(join(tmpdir(), 'etl-ledger-')), 'etl-ledger.jsonl');

describe('recordEvent', () => {
  it('追加一行合法 JSON，含缺省字段', () => {
    const p = tmpLedger();
    const ev = recordEvent({ stage: 'etl', domain: 'premium', row_count: 100 }, { ledgerPath: p });
    const parsed = JSON.parse(readFileSync(p, 'utf8').trim());
    expect(parsed.stage).toBe('etl');
    expect(parsed.domain).toBe('premium');
    expect(parsed.row_count).toBe(100);
    expect(parsed.status).toBe('success'); // 缺省填充
    expect(parsed.backfilled).toBe(false); // 缺省填充
    expect(parsed.ts).toMatch(/\+08:00$/); // 本地时区
    expect(ev).not.toBeNull();
  });

  it('显式字段覆盖缺省值', () => {
    const p = tmpLedger();
    recordEvent({ stage: 'validate', status: 'failure', error: '行数不足', backfilled: true }, { ledgerPath: p });
    const parsed = JSON.parse(readFileSync(p, 'utf8').trim());
    expect(parsed.status).toBe('failure');
    expect(parsed.error).toBe('行数不足');
    expect(parsed.backfilled).toBe(true);
  });

  it('多次调用追加多行', () => {
    const p = tmpLedger();
    recordEvent({ stage: 'source', domain: 'premium' }, { ledgerPath: p });
    recordEvent({ stage: 'etl', domain: 'premium' }, { ledgerPath: p });
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('写入失败返回 null、不抛（不阻断主流程）', () => {
    const ev = recordEvent({ stage: 'etl' }, { ledgerPath: '/nonexistent-root-xyz/a/b.jsonl', noMkdir: true });
    expect(ev).toBeNull();
  });
});

describe('localIsoNow', () => {
  it('输出 +08:00 ISO', () => {
    expect(localIsoNow(new Date('2026-06-27T00:00:00Z'))).toBe('2026-06-27T08:00:00.000+08:00');
  });
});
