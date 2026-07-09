/**
 * policy/current 原子同步测试（BACKLOG 2026-07-03-claude-6c23b3 · 生产可靠性 P2）。
 *
 * 背景：sync-vps 对 critical 的 policy/current 用普通 rsync --delete（非原子），传输全程原地
 * 删/写分片。若与 VPS 端重启 / PM2 reload / loadMultipleParquet() 的 `current/*.parquet` glob
 * 重叠，会读到半份数据（部分分片已删/未写完）。
 *
 * 修复：policy-current 任务走 --delay-updates（新分片先落 `.~tmp~/`，末尾快速接连重命名就位）
 * + --delete-after（删除也延后到末尾）——危险窗口从"整个传输时长"收窄到"一次亚秒级重命名突发"，
 * 且 VPS 最终字节与 --delete 一致。
 *
 * 字节安全基线：非 policy-current 任务（atomic=false）参数逐字节等价历史（仍是 --delete，无 --delay-updates）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildRsyncArgs, buildPolicyCurrentTasks, buildStandardSyncTasks } from '../sync-vps.mjs';

// ============================================================
// buildRsyncArgs：rsync 参数纯函数（rsyncDir + printDryRun 单一来源，防命令串漂移）
// ============================================================
describe('buildRsyncArgs — 原子 / 非原子参数构造', () => {
  const base = { src: '/local/dir/', remote: 'alias:/remote/dir/' };

  it('非原子 + 删除（历史默认）→ --delete，不含 --delay-updates / --delete-after（字节安全基线）', () => {
    const args = buildRsyncArgs({ ...base, deleteRemote: true, atomic: false });
    expect(args).toContain('--delete');
    expect(args).not.toContain('--delete-after');
    expect(args).not.toContain('--delay-updates');
  });

  it('原子 + 删除 → --delay-updates + --delete-after，且不含裸 --delete', () => {
    const args = buildRsyncArgs({ ...base, deleteRemote: true, atomic: true });
    expect(args).toContain('--delay-updates');
    expect(args).toContain('--delete-after');
    expect(args).not.toContain('--delete'); // 裸 --delete（--delete-during）已被 --delete-after 取代
  });

  it('deleteRemote=false（累积目录）→ 任何删除标志都不出现，atomic 也不注入删除', () => {
    const off = buildRsyncArgs({ ...base, deleteRemote: false, atomic: false });
    expect(off.some((a) => a.startsWith('--delete'))).toBe(false);
    const offAtomic = buildRsyncArgs({ ...base, deleteRemote: false, atomic: true });
    expect(offAtomic.some((a) => a.startsWith('--delete'))).toBe(false);
    expect(offAtomic).toContain('--delay-updates');
  });

  it('保留 -azv / -e ssh / src / remote，且 src 与 remote 落在参数末尾（顺序稳定）', () => {
    const args = buildRsyncArgs({ ...base, deleteRemote: true, atomic: true });
    expect(args).toContain('-azv');
    expect(args).toContain('-e');
    expect(args).toContain('ssh');
    expect(args[args.length - 2]).toBe('/local/dir/');
    expect(args[args.length - 1]).toBe('alias:/remote/dir/');
  });

  it('默认参数（不传 deleteRemote/atomic）= 非原子删除（与历史 rsyncDir 默认一致）', () => {
    const args = buildRsyncArgs(base);
    expect(args).toContain('--delete');
    expect(args).not.toContain('--delay-updates');
  });
});

// ============================================================
// buildPolicyCurrentTasks：policy-current 任务须带 atomic:true（扁平 + 分省两种布局）
// ============================================================
describe('buildPolicyCurrentTasks — critical policy-current 任务标记 atomic:true', () => {
  function makeCurrent(spec) {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-current-'));
    for (const f of spec.flat ?? []) writeFileSync(join(dir, f), '');
    for (const [province, files] of Object.entries(spec.subdirs ?? {})) {
      mkdirSync(join(dir, province), { recursive: true });
      for (const f of files) writeFileSync(join(dir, province, f), '');
    }
    return dir;
  }

  it('扁平布局 → 单任务带 atomic:true', () => {
    const dir = makeCurrent({ flat: ['每日数据_20260101.parquet'] });
    try {
      const tasks = buildPolicyCurrentTasks(dir, '/remote/current');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].atomic).toBe(true);
      expect(tasks[0].critical).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('分省子目录布局 → 每省任务都带 atomic:true', () => {
    const dir = makeCurrent({ subdirs: { SC: ['a.parquet'], SX: ['x.parquet'] } });
    try {
      const tasks = buildPolicyCurrentTasks(dir, '/remote/current', ['SC', 'SX']);
      expect(tasks).toHaveLength(2);
      for (const t of tasks) expect(t.atomic).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// buildStandardSyncTasks：原子同步须覆盖服务端 glob 读的 critical fact 域
// （BACKLOG 2026-07-09-claude-78cc23 · 承接 policy/current 的 2026-07-03-claude-6c23b3）。
// fact/claims_detail 与 policy/current 同为 critical:true 且同被 loadMultipleParquet() 的
// `claims_*.parquet` / `current/*.parquet` glob 读，有完全相同的半份数据风险，故须同享原子同步。
// 反向锁定：原子性只授予 glob 读的 critical fact 域，不 blanket 应用到所有 critical（dim/* 保持非原子）。
// ============================================================
describe('buildStandardSyncTasks — critical glob-读 fact 目录标记 atomic:true', () => {
  const findTask = (tasks, label) => tasks.find((t) => t.label === label);

  // 注入扁平 current 临时目录 → policy/current 解析为单任务，不依赖 worktree 内 warehouse 实数据。
  function makeFlatCurrent() {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-std-current-'));
    writeFileSync(join(dir, '每日数据_20260101.parquet'), '');
    return dir;
  }

  it('fact/claims_detail 任务带 atomic:true（与 policy/current 同为服务端 glob 读的 critical 年度分区）', () => {
    const dir = makeFlatCurrent();
    try {
      const tasks = buildStandardSyncTasks('/remote', '/frontend/dist', { localCurrentDir: dir });
      const claims = findTask(tasks, 'fact/claims_detail');
      expect(claims, 'fact/claims_detail 任务应存在').toBeDefined();
      expect(claims.critical).toBe(true);
      expect(claims.atomic).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('policy/current 任务保持 atomic:true（2026-07-03-claude-6c23b3 不回归）', () => {
    const dir = makeFlatCurrent();
    try {
      const tasks = buildStandardSyncTasks('/remote', '/frontend/dist', { localCurrentDir: dir });
      const policy = findTask(tasks, 'policy/current');
      expect(policy, 'policy/current 任务应存在').toBeDefined();
      expect(policy.atomic).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非目标目录（dim/salesman、dim/plan 虽 critical、fact/renewal_tracker、fact/cross_sell）保持非 atomic（字节安全基线）', () => {
    const dir = makeFlatCurrent();
    try {
      const tasks = buildStandardSyncTasks('/remote', '/frontend/dist', { localCurrentDir: dir });
      for (const label of ['dim/salesman', 'dim/plan', 'fact/renewal_tracker', 'fact/cross_sell']) {
        const t = findTask(tasks, label);
        expect(t, `任务 ${label} 应存在`).toBeDefined();
        expect(t.atomic, `任务 ${label} 不应带 atomic`).toBeFalsy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
