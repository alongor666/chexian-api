import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectLedgerDiffFiles,
  evaluateLedgerFreshness,
  evaluateLedgerUncommittedBulk,
  LEDGER_TRACKED_FILES,
} from '../etl-ledger/governance-check.mjs';

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

describe('evaluateLedgerUncommittedBulk（2419ed 台账未提交体量提醒）', () => {
  it('白名单只含拆分后仍入库的台账文件', () => {
    expect(LEDGER_TRACKED_FILES).toEqual([
      '数据管理/ledger/etl-ledger.jsonl',
      '数据管理/ledger/events',
      '数据管理/knowledge/QUICK_REFERENCE.md',
    ]);
  });

  it('无 diff（CI 工作区干净）→ ok，0 行', () => {
    const r = evaluateLedgerUncommittedBulk({ files: [] });
    expect(r.level).toBe('ok');
    expect(r.totalLines).toBe(0);
  });

  it('累积在阈值内 → ok', () => {
    const r = evaluateLedgerUncommittedBulk({
      files: [{ path: '数据管理/ledger/events/2026-07.jsonl', added: 120, deleted: 0 }],
    });
    expect(r.level).toBe('ok');
    expect(r.totalLines).toBe(120);
  });

  it('累积超阈值 → warn，消息含体量与可执行提示', () => {
    const r = evaluateLedgerUncommittedBulk({
      files: [
        { path: '数据管理/ledger/events/2026-07.jsonl', added: 400, deleted: 0 },
        { path: '数据管理/knowledge/QUICK_REFERENCE.md', added: 4, deleted: 4 },
      ],
    });
    expect(r.level).toBe('warn');
    expect(r.totalLines).toBe(408);
    expect(r.message).toContain('chore commit');
    expect(r.message).toContain('体量门禁');
  });

  it('阈值可配置', () => {
    const r = evaluateLedgerUncommittedBulk({
      files: [{ path: '数据管理/ledger/events/2026-07.jsonl', added: 100, deleted: 0 }],
      thresholdLines: 50,
    });
    expect(r.level).toBe('warn');
  });

  it('每月首次生成的 untracked JSONL 也计入体量', () => {
    const root = mkdtempSync(join(tmpdir(), 'etl-ledger-diff-'));
    mkdirSync(join(root, '数据管理/ledger/events'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, 'seed.txt'), 'seed\n');
    execFileSync('git', ['add', 'seed.txt'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'seed'], { cwd: root });
    const monthly = '数据管理/ledger/events/2026-07.jsonl';
    writeFileSync(join(root, monthly), '{"a":1}\n{"a":2}\n');

    expect(collectLedgerDiffFiles(root)).toContainEqual({ path: monthly, added: 2, deleted: 0 });
  });
});
