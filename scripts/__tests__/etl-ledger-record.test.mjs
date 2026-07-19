import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listLedgerPaths, localIsoNow, monthlyLedgerPath, recordEvent } from '../etl-ledger/record.mjs';

const tmpLedger = () => join(mkdtempSync(join(tmpdir(), 'etl-ledger-')), 'etl-ledger.jsonl');

describe('recordEvent', () => {
  it('默认路径按事件北京时间月份分片', () => {
    expect(monthlyLedgerPath('2026-07-31T23:59:59.000+08:00')).toMatch(/events\/2026-07\.jsonl$/);
  });

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

describe('listLedgerPaths', () => {
  it('按封存历史、月度分片顺序聚合并忽略非分片文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'etl-ledger-sources-'));
    const legacyPath = join(dir, 'etl-ledger.jsonl');
    const eventsDir = join(dir, 'events');
    mkdirSync(eventsDir);
    writeFileSync(legacyPath, '{}\n');
    writeFileSync(join(eventsDir, '2026-08.jsonl'), '{}\n');
    writeFileSync(join(eventsDir, '2026-07.jsonl'), '{}\n');
    writeFileSync(join(eventsDir, 'README.md'), '说明');

    expect(listLedgerPaths({ legacyPath, eventsDir })).toEqual([
      legacyPath,
      join(eventsDir, '2026-07.jsonl'),
      join(eventsDir, '2026-08.jsonl'),
    ]);
  });
});

describe('localIsoNow', () => {
  it('输出 +08:00 ISO', () => {
    expect(localIsoNow(new Date('2026-06-27T00:00:00Z'))).toBe('2026-06-27T08:00:00.000+08:00');
  });
});
