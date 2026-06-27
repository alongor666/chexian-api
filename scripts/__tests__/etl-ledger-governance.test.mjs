import { describe, it, expect } from 'vitest';
import { evaluateLedgerFreshness } from '../etl-ledger/governance-check.mjs';

const T = (iso) => Date.parse(iso);
const base = {
  ledgerExists: true,
  ledgerMtimeMs: T('2026-06-27T10:00:00Z'),
  dataSourcesMtimeMs: T('2026-06-27T10:00:00Z'),
};

describe('evaluateLedgerFreshness', () => {
  it('台账不存在 → warn', () => {
    expect(evaluateLedgerFreshness({ ...base, ledgerExists: false }).level).toBe('warn');
  });

  it('data-sources 比台账文件新超阈值 → warn（疑似漏记）', () => {
    const r = evaluateLedgerFreshness({ ...base, dataSourcesMtimeMs: T('2026-06-27T20:00:00Z') }); // +10h
    expect(r.level).toBe('warn');
    expect(r.message).toContain('未写台账');
  });

  it('滞后在阈值内 → ok', () => {
    expect(evaluateLedgerFreshness(base).level).toBe('ok');
  });

  it('台账文件比 data-sources 还新 → ok（回填后典型场景，不误报）', () => {
    const r = evaluateLedgerFreshness({ ...base, dataSourcesMtimeMs: T('2026-06-27T08:00:00Z') });
    expect(r.level).toBe('ok');
  });

  it('阈值可配置', () => {
    const r = evaluateLedgerFreshness({ ...base, dataSourcesMtimeMs: T('2026-06-27T14:00:00Z'), thresholdHours: 6 }); // +4h < 6h
    expect(r.level).toBe('ok');
  });
});
