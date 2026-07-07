/**
 * sync-vps 完整性闸门 + 多省子目录同步单测（B3：退役 #753 前缀方案 → 分省子目录 current/<省>/）
 *
 * 锁定：
 *   - evaluateFreshness：本地 policy 比 VPS 现役更旧/更少 → block，防残缺数据覆盖生产。
 *   - 闸门执行范围（kind:'policy-current'）：标准全量同步含 policy（扁平/子目录两种 label 都识别）；
 *     --domain 不含 policy（闸门跳过）。
 *   - buildPolicyCurrentTasks：扁平 → 单任务（字节等价历史）；子目录独占 → 仅基准省每省独立任务；
 *     非基准省子目录防御性排除（不静默推生产，由 GATED 预检大声 fail-closed）。
 *   - 真实本地 rsync：扁平 SC 字节安全（无 filter 参数）+ 每省独立 current/<省>/ 隔离 + --delete 作用域限子目录。
 *   - assertLocalNotStaleVsVps：B3 简化路径（无 branchCode/非SC降级），指纹不可用时 skip 降级放行。
 *
 * B3 退役删除：buildRsyncBranchFilterArgs / branchOfFile / fileBelongsToBranch / branchFilePatterns /
 *   isFileInBranch / getSyncBranchCode / queryLocalPolicyFingerprintForBranch（前缀方案，已无消费者）。
 *   其 GATED 闸 + 基准省语义见 scripts/lib/__tests__/policy-current-shards.test.mjs。
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  evaluateFreshness,
  buildSyncTasks,
  buildStandardSyncTasks,
  buildPolicyCurrentTasks,
  assertLocalNotStaleVsVps,
} from '../sync-vps.mjs';

const vps = { maxDate: '2026-05-30', rowCount: 1_000_000 };

/** 构造临时 policy/current 目录：flat=顶层扁平文件名，subdirs={省:[文件名]}。 */
function makeCurrent({ flat = [], subdirs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'b3-sync-cur-'));
  for (const name of flat) writeFileSync(join(dir, name), name);
  for (const [prov, files] of Object.entries(subdirs)) {
    mkdirSync(join(dir, prov), { recursive: true });
    for (const name of files) writeFileSync(join(dir, prov, name), `${prov}/${name}`);
  }
  return dir;
}

describe('evaluateFreshness', () => {
  it('本地与现役一致 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, vps).verdict).toBe('pass');
  });

  it('本地更新更多 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-31', rowCount: 1_000_100 }, vps).verdict).toBe('pass');
  });

  it('本地日期更旧 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 1_000_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
  });

  it('本地行数更少 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-30', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('行数');
  });

  it('日期与行数同时倒退 → block，原因含两条', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
    expect(r.reason).toContain('行数');
  });

  it('VPS 指纹不可用（端点未部署）→ skip 降级放行', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, null).verdict).toBe('skip');
  });

  it('本地指纹不可用（duckdb CLI 缺失）→ skip 降级放行', () => {
    expect(evaluateFreshness(null, vps).verdict).toBe('skip');
  });

  it('一侧 maxDate 为 null 时不据日期 block，仅看行数', () => {
    expect(evaluateFreshness({ maxDate: null, rowCount: 1_000_000 }, { maxDate: null, rowCount: 1_000_000 }).verdict).toBe('pass');
  });
});

// ============================================================
// 闸门执行范围：kind:'policy-current' 跨「扁平 / 子目录」label 统一识别（codex 闸-1 P0-2）
// ============================================================
describe('闸门执行范围（buildSyncTasks 是否含 policy-current kind）', () => {
  const cfg = (domains) => ({ domains, remoteDir: '/r', frontendDistDir: '/f' });

  it('标准全量同步 → 含 policy-current kind（闸门生效）', () => {
    const tasks = buildSyncTasks(cfg([]));
    expect(tasks.some((t) => t.kind === 'policy-current')).toBe(true);
  });

  it('--domain customer_flow → 不含 policy-current kind（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['customer_flow'])).some((t) => t.kind === 'policy-current')).toBe(false);
  });

  it('--domain new_energy_claims → 不含 policy-current kind（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['new_energy_claims'])).some((t) => t.kind === 'policy-current')).toBe(false);
  });
});

// ============================================================
// buildPolicyCurrentTasks：布局感知任务构建（B3 核心 · B5 起白名单语义）
// ============================================================
describe('buildPolicyCurrentTasks — 布局感知（扁平 / 子目录 / 白名单过滤）', () => {
  it('扁平布局（SC 现状）→ 单任务 policy/current（字节等价历史·无省份后缀）', () => {
    const dir = makeCurrent({ flat: ['每日数据_20260101.parquet', '20210101-20231231_01.parquet'] });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      label: 'policy/current',
      kind: 'policy-current',
      local: dir,
      remote: '/remote/current',
      critical: true,
    });
  });

  it('空目录 → 单任务 policy/current（扁平兜底，字节安全）', () => {
    const dir = makeCurrent({});
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].label).toBe('policy/current');
    expect(tasks[0].remote).toBe('/remote/current');
  });

  it('子目录独占·仅 SC（白名单=[SC]）→ 每省独立任务 current/SC/ → data/current/SC', () => {
    const dir = makeCurrent({ subdirs: { SC: ['a.parquet', 'b.parquet'] } });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current', ['SC']);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      label: 'policy/current/SC',
      kind: 'policy-current',
      local: join(dir, 'SC'),
      remote: '/remote/current/SC',
      critical: true,
    });
  });

  it('B5 cutover 默认白名单（SYNC_ALLOWED_BRANCHES=[SC,SX]）→ SC+SX 双省各一个 critical 任务', () => {
    const dir = makeCurrent({ subdirs: { SC: ['a.parquet'], SX: ['x.parquet'] } });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current'); // 不传第三参 → 走生产默认白名单
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.label).sort()).toEqual(['policy/current/SC', 'policy/current/SX']);
    for (const t of tasks) {
      expect(t.kind).toBe('policy-current');
      expect(t.critical).toBe(true);
    }
    const sx = tasks.find((t) => t.label === 'policy/current/SX');
    expect(sx).toMatchObject({ local: join(dir, 'SX'), remote: '/remote/current/SX' });
  });

  it('子目录含名单外省（SC+SX+GD，白名单=[SC,SX]）→ 仅 SC/SX 任务（GD 防御性排除）', () => {
    const dir = makeCurrent({ subdirs: { SC: ['a.parquet'], SX: ['x.parquet'], GD: ['g.parquet'] } });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current', ['SC', 'SX']);
    // 防御性排除名单外省：不静默把 GD 推生产（GATED 预检会大声 fail-closed，见 helper 测试）
    expect(tasks).toHaveLength(2);
    expect(tasks.some((t) => t.label.includes('GD'))).toBe(false);
  });

  it('白名单=[SX] 时 → 仅生成 SX 子目录任务（白名单由参数驱动，非硬编码 SC）', () => {
    const dir = makeCurrent({ subdirs: { SC: ['a.parquet'], SX: ['x.parquet'] } });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current', ['SX']);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ label: 'policy/current/SX', remote: '/remote/current/SX' });
  });

  it('扁平+子目录并存 → 单扁平任务（非 subdirOnly；并存冲突交 GATED 预检 fail-closed）', () => {
    const dir = makeCurrent({ flat: ['flat.parquet'], subdirs: { SC: ['sub.parquet'] } });
    const tasks = buildPolicyCurrentTasks(dir, '/remote/current', ['SC', 'SX']);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].label).toBe('policy/current');
  });
});

describe('buildStandardSyncTasks — policy 任务布局感知 + 其余 13 域不变', () => {
  it('扁平 localCurrentDir 注入 → policy/current 单任务，其余域齐全', () => {
    const dir = makeCurrent({ flat: ['x.parquet'] });
    const tasks = buildStandardSyncTasks('/remote', '/frontend', { localCurrentDir: dir });
    const labels = tasks.map((t) => t.label);
    expect(labels).toContain('policy/current');
    expect(labels).toContain('dim/salesman');
    expect(labels).toContain('fact/claims_detail');
    expect(labels).toContain('public_reports');
    // policy 任务只有一个（扁平）
    expect(tasks.filter((t) => t.kind === 'policy-current')).toHaveLength(1);
  });

  it('子目录 localCurrentDir 注入（仅 SC）→ policy/current/SC 任务', () => {
    const dir = makeCurrent({ subdirs: { SC: ['x.parquet'] } });
    const tasks = buildStandardSyncTasks('/remote', '/frontend', { localCurrentDir: dir });
    const policyTasks = tasks.filter((t) => t.kind === 'policy-current');
    expect(policyTasks).toHaveLength(1);
    expect(policyTasks[0]).toMatchObject({ label: 'policy/current/SC', remote: '/remote/current/SC' });
  });

  it('子目录 localCurrentDir 注入（SC+SX，B5 cutover 布局）→ 两省 policy 任务都进标准任务列表', () => {
    const dir = makeCurrent({ subdirs: { SC: ['x.parquet'], SX: ['y.parquet'] } });
    const tasks = buildStandardSyncTasks('/remote', '/frontend', { localCurrentDir: dir });
    const policyTasks = tasks.filter((t) => t.kind === 'policy-current');
    expect(policyTasks.map((t) => t.label).sort()).toEqual(['policy/current/SC', 'policy/current/SX']);
  });
});

// ============================================================
// assertLocalNotStaleVsVps — B3 简化（无 branchCode/非SC降级）
// ============================================================
describe('assertLocalNotStaleVsVps — 简化路径（指纹不可用 → skip 降级放行）', () => {
  it('duckdb/SSH 不可用（指纹 null）→ evaluateFreshness skip → return true，不抛异常', async () => {
    const warnMessages = [];
    const result = await assertLocalNotStaleVsVps(
      { host: '127.0.0.1', port: 22, username: 'test', alias: 'test-alias' },
      '/nonexistent-path-for-test',
      { onWarn: (m) => warnMessages.push(m) },
    );
    expect(result).toBe(true);
    // B3 已退役「降级放行」分省专用文案（前缀方案残留）
    expect(warnMessages.some((m) => m.includes('降级放行'))).toBe(false);
  });

  it('签名只接受 (config, dir, hooks)——多传 branchCode 不影响（已退役第 4 参数）', async () => {
    const onPass = vi.fn();
    const result = await assertLocalNotStaleVsVps(
      { host: '127.0.0.1', port: 22, username: 'test', alias: 'test-alias' },
      '/nonexistent-path-for-test',
      { onPass },
    );
    expect(result).toBe(true);
  });
});

// ============================================================
// 真实本地 rsync 验证（不连生产 VPS）—— 扁平字节安全 + 每省隔离 + --delete 作用域
// ⚠ rsync 不可用时 skipIf 跳过
// ============================================================
describe('真实 rsync — 扁平 SC 字节安全 + 分省子目录隔离 + --delete 限子目录', () => {
  const rsyncAvailable = (() => {
    try { execSync('rsync --version', { stdio: 'ignore' }); return true; } catch { return false; }
  })();
  if (!rsyncAvailable) {
    console.warn('[SKIP] rsync 不可用，跳过真实 rsync 验证组（需本机安装 rsync）');
  }

  // B3 退役前缀后，rsyncDir 对扁平任务的 args 与历史 branchCode=null 短路逐字节等价：
  // `-azv --delete <RSYNC_EXCLUDES> -e ssh src/ dst/`（无任何 --filter/--include 前缀参数）。
  // 本组用本地 `rsync -a --delete` 验证行为（src 尾 / 语义同 rsyncDir）。

  it.skipIf(!rsyncAvailable)('扁平 SC：plain rsync --delete 同步上行 + 清理远端陈旧（字节安全行为）', () => {
    const srcDir = makeCurrent({ flat: ['每日数据_20260101.parquet', '20210101-20231231_01.parquet'] });
    const dstDir = mkdtempSync(join(tmpdir(), 'b3-vps-flat-'));
    // 远端有一份陈旧文件，应被 --delete 清理（SC 单省正常行为）
    writeFileSync(join(dstDir, 'stale_old.parquet'), 'stale');

    execSync(`rsync ${['-a', '--delete', `${srcDir}/`, `${dstDir}/`].map((a) => JSON.stringify(a)).join(' ')}`);

    expect(existsSync(join(dstDir, '每日数据_20260101.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, '20210101-20231231_01.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, 'stale_old.parquet'))).toBe(false); // --delete 清理陈旧
  });

  it.skipIf(!rsyncAvailable)('分省隔离：current/SC/ → data/current/SC/，--delete 不触碰 data/current/SX/（跨省隔离 + 作用域）', () => {
    // 本地：子目录独占，仅基准省 SC
    const localCurrent = makeCurrent({ subdirs: { SC: ['new.parquet'] } });
    // 远端 data/current/：预存 SC/old + SX/old（模拟两省共存的生产远端）
    const remoteCurrent = mkdtempSync(join(tmpdir(), 'b3-vps-sub-'));
    mkdirSync(join(remoteCurrent, 'SC'), { recursive: true });
    mkdirSync(join(remoteCurrent, 'SX'), { recursive: true });
    writeFileSync(join(remoteCurrent, 'SC', 'old.parquet'), 'sc-old');
    writeFileSync(join(remoteCurrent, 'SX', 'old.parquet'), 'sx-old');

    // buildPolicyCurrentTasks（白名单=[SC]）→ 仅 SC 任务，目标 data/current/SC
    const tasks = buildPolicyCurrentTasks(localCurrent, remoteCurrent, ['SC']);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].remote).toBe(join(remoteCurrent, 'SC'));

    // 真实 rsync 该 SC 任务（src 尾 / → 目标 SC 子目录）
    execSync(`rsync ${['-a', '--delete', `${tasks[0].local}/`, `${tasks[0].remote}/`].map((a) => JSON.stringify(a)).join(' ')}`);

    // SC 子目录：新文件上行 + 陈旧被 --delete 清理（作用域限 SC/）
    expect(existsSync(join(remoteCurrent, 'SC', 'new.parquet'))).toBe(true);
    expect(existsSync(join(remoteCurrent, 'SC', 'old.parquet'))).toBe(false);
    // ★ 关键隔离断言：SX 子目录完全不受 SC 任务影响（每省独立目标目录 + --delete 限子目录）
    expect(existsSync(join(remoteCurrent, 'SX', 'old.parquet'))).toBe(true);
  });
});
