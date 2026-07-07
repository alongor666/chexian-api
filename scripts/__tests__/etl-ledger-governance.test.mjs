import { describe, it, expect } from 'vitest';
import { evaluateLedgerFreshness } from '../etl-ledger/governance-check.mjs';

const T = (iso) => Date.parse(iso);
const base = {
  ledgerExists: true,
  ledgerMtimeMs: T('2026-06-27T10:00:00Z'),
  statusExists: true,
  statusMtimeMs: T('2026-06-27T10:00:00Z'),
};

describe('evaluateLedgerFreshness（三态：ledgerExists × statusExists）', () => {
  it('台账、状态文件均不存在 → ok（干净环境）', () => {
    const r = evaluateLedgerFreshness({ ledgerExists: false, statusExists: false });
    expect(r.level).toBe('ok');
  });

  it('台账不存在、状态文件存在 → warn（疑似漏记）', () => {
    const r = evaluateLedgerFreshness({ ...base, ledgerExists: false });
    expect(r.level).toBe('warn');
  });

  it('台账存在、状态文件不存在 → warn（拆分后尚未跑首轮 ETL 或状态文件被误删）', () => {
    const r = evaluateLedgerFreshness({ ...base, statusExists: false });
    expect(r.level).toBe('warn');
    expect(r.message).toContain('data-sources-status.json');
  });

  it('状态文件比台账新超阈值 → warn（疑似漏记，且断言含"台账"证明检查没变死）', () => {
    const r = evaluateLedgerFreshness({ ...base, statusMtimeMs: T('2026-06-27T20:00:00Z') }); // +10h
    expect(r.level).toBe('warn');
    expect(r.message).toContain('台账');
  });

  it('滞后在阈值内 → ok', () => {
    expect(evaluateLedgerFreshness(base).level).toBe('ok');
  });

  it('台账文件比状态文件还新 → ok（回填后典型场景，不误报）', () => {
    const r = evaluateLedgerFreshness({ ...base, statusMtimeMs: T('2026-06-27T08:00:00Z') });
    expect(r.level).toBe('ok');
  });

  it('阈值可配置', () => {
    const r = evaluateLedgerFreshness({ ...base, statusMtimeMs: T('2026-06-27T14:00:00Z'), thresholdHours: 6 }); // +4h < 6h
    expect(r.level).toBe('ok');
  });
});
