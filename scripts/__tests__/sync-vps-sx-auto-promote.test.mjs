/**
 * SX 自动晋升单测（scripts/sync-vps.mjs runSxAutoPromote()）
 *
 * 背景：2026-07-09 山西数据在生产端因 sx-promote.mjs 从未接入自动化链路而连续多日
 * 滞后，靠人工介入才发现。本文件锁定 runSxAutoPromote() 的三条路径，均通过依赖注入
 * mock（queryRls / runPromoteSubprocess / validationSxDir），不连真实网络或生产：
 *
 *   1. 无 validation/SX 目录 → skip，不调用 RLS 查询、不 spawn 晋升子进程（纯 SC 场景零副作用）
 *   2. RLS 核实通过 → promote，spawn 晋升子进程带 --auto-verified-rls + 非空 note
 *   3. RLS 核实失败/为 false → block，不 spawn 晋升子进程（拒绝晋升，不静默用陈旧数据）
 *
 * evaluateSxAutoPromoteReadiness 本身的判定矩阵见 tests/sx-promote-gate.test.ts（本文件只测
 * runSxAutoPromote() 这层"调用真实核实 + 按判定结果决定是否 spawn"的编排逻辑）。
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSxAutoPromote } from '../sync-vps.mjs';

const sshConfig = { host: '127.0.0.1', port: 22, username: 'test', alias: 'test-alias' };

function silentLog() {} // 测试不需要真实打印

describe('runSxAutoPromote', () => {
  it('无 validation/SX 目录 → skip，不查询 RLS、不 spawn 晋升子进程', async () => {
    const queryRls = vi.fn();
    const runPromoteSubprocess = vi.fn();
    const nonexistentDir = join(tmpdir(), 'sx-auto-promote-test-nonexistent-' + Date.now());

    const result = await runSxAutoPromote(sshConfig, {
      validationSxDir: nonexistentDir,
      queryRls,
      runPromoteSubprocess,
      log: silentLog,
    });

    expect(result.verdict).toBe('skip');
    expect(queryRls).not.toHaveBeenCalled();
    expect(runPromoteSubprocess).not.toHaveBeenCalled();
  });

  it('存在 validation/SX 且 RLS 核实为 true → promote，spawn 晋升子进程带非空 note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sx-auto-promote-test-'));
    try {
      const queryRls = vi.fn().mockResolvedValue(true);
      const runPromoteSubprocess = vi.fn().mockResolvedValue({ code: 0 });

      const result = await runSxAutoPromote(sshConfig, {
        validationSxDir: dir,
        queryRls,
        runPromoteSubprocess,
        log: silentLog,
      });

      expect(result.verdict).toBe('promote');
      expect(queryRls).toHaveBeenCalledWith(sshConfig);
      expect(runPromoteSubprocess).toHaveBeenCalledTimes(1);
      const noteArg = runPromoteSubprocess.mock.calls[0][0];
      expect(typeof noteArg).toBe('string');
      expect(noteArg.length).toBeGreaterThan(0);
      expect(noteArg).toContain('branchRlsEnabled=true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('存在 validation/SX 且 RLS 核实为 false → block，不 spawn 晋升子进程', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sx-auto-promote-test-'));
    try {
      const queryRls = vi.fn().mockResolvedValue(false);
      const runPromoteSubprocess = vi.fn();

      const result = await runSxAutoPromote(sshConfig, {
        validationSxDir: dir,
        queryRls,
        runPromoteSubprocess,
        log: silentLog,
      });

      expect(result.verdict).toBe('block');
      expect(runPromoteSubprocess).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('存在 validation/SX 且 RLS 查询失败（null，网络/端点异常）→ block（安全默认拒绝），不 spawn 晋升子进程', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sx-auto-promote-test-'));
    try {
      const queryRls = vi.fn().mockResolvedValue(null);
      const runPromoteSubprocess = vi.fn();

      const result = await runSxAutoPromote(sshConfig, {
        validationSxDir: dir,
        queryRls,
        runPromoteSubprocess,
        log: silentLog,
      });

      expect(result.verdict).toBe('block');
      expect(result.reason).toContain('查询失败');
      expect(runPromoteSubprocess).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RLS 核实通过但晋升子进程本身失败 → block（不静默视为成功）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sx-auto-promote-test-'));
    try {
      const queryRls = vi.fn().mockResolvedValue(true);
      const runPromoteSubprocess = vi.fn().mockRejectedValue(new Error('sx-promote.mjs exit=1（模拟）'));

      const result = await runSxAutoPromote(sshConfig, {
        validationSxDir: dir,
        queryRls,
        runPromoteSubprocess,
        log: silentLog,
      });

      expect(result.verdict).toBe('block');
      expect(result.reason).toContain('sx-promote.mjs 子进程失败');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
