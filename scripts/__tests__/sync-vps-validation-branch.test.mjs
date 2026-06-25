/**
 * validation/<非SC省> 派生域同步任务构建测试（PR-2 · 部署链 cutover 能力）。
 *
 * 被测：buildValidationBranchSyncTasks(remote, validationRoot) —— 枚举本地
 * warehouse/validation/<省>/<派生域>，构建 rsync 任务推到 VPS data/validation/<省>/<域>，
 * 让 VPS 读到 SX 派生域（claims_detail/quotes_conversion/renewal_tracker 等）。
 *
 * 字节安全双闸（codex 闸-2）：
 *   1. 总开关 SYNC_VALIDATION_BRANCHES 默认 off → 返回 []（日常 sync 逐字节等价历史，SX 绝不进生产）。
 *   2. 域数据文件不存在 → 跳过（防 rsync --delete 误删 VPS data/validation）。
 *
 * 对称性：省份枚举（`^[A-Z]{2}$` + 排除 SC + 升序）与 data-bootstrapper resolveBranch*Extras 一致，
 * 文件级存在性（claims_*.parquet / latest.parquet）也与 bootstrapper 一致 →「loader 读取域」==「sync 推送域」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildValidationBranchSyncTasks } from '../sync-vps.mjs';

/** 在 root 下造一个含真实数据文件的派生域目录（claims_detail→claims_*.parquet，其余→latest.parquet）。 */
function mkDomain(root, province, domain) {
  const dir = join(root, province, domain);
  mkdirSync(dir, { recursive: true });
  const file = domain === 'claims_detail' ? 'claims_2026.parquet' : 'latest.parquet';
  writeFileSync(join(dir, file), '');
}

describe('buildValidationBranchSyncTasks · 总开关 gate（默认 off）', () => {
  const prev = process.env.SYNC_VALIDATION_BRANCHES;
  afterEach(() => {
    if (prev === undefined) delete process.env.SYNC_VALIDATION_BRANCHES;
    else process.env.SYNC_VALIDATION_BRANCHES = prev;
  });

  it('SYNC_VALIDATION_BRANCHES 未设 → 即使有完整 SX 数据也返回 []（字节安全：日常 sync 不推 SX）', () => {
    delete process.env.SYNC_VALIDATION_BRANCHES;
    const root = mkdtempSync(join(tmpdir(), 'val-gate-'));
    try {
      mkDomain(root, 'SX', 'claims_detail');
      expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('buildValidationBranchSyncTasks · 开关开启后的枚举', () => {
  let root;
  const prev = process.env.SYNC_VALIDATION_BRANCHES;
  beforeEach(() => {
    process.env.SYNC_VALIDATION_BRANCHES = '1';
    root = mkdtempSync(join(tmpdir(), 'val-sync-'));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SYNC_VALIDATION_BRANCHES;
    else process.env.SYNC_VALIDATION_BRANCHES = prev;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('validationRoot 不存在 → 空数组', () => {
    expect(buildValidationBranchSyncTasks('/remote/data', join(root, '不存在'))).toEqual([]);
  });

  it('validationRoot 存在但无任何省份目录 → 空数组', () => {
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('SX 含 claims_detail/quotes_conversion/renewal_tracker（带数据文件）→ 3 任务，remote 落 data/validation/SX/<域>', () => {
    for (const d of ['claims_detail', 'quotes_conversion', 'renewal_tracker']) mkDomain(root, 'SX', d);
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual([
      'validation/SX/claims_detail',
      'validation/SX/quotes_conversion',
      'validation/SX/renewal_tracker',
    ]);
    const claims = tasks.find((t) => t.label === 'validation/SX/claims_detail');
    expect(claims.local).toBe(join(root, 'SX', 'claims_detail'));
    expect(claims.remote).toBe('/remote/data/validation/SX/claims_detail');
    expect(claims.critical).toBe(false); // GATED：RLS-off 不消费，失败不阻断日常同步
  });

  it('域目录存在但无数据文件 → 排除（防空目录 rsync --delete 误删 VPS · codex 闸-2 HIGH）', () => {
    mkdirSync(join(root, 'SX', 'claims_detail'), { recursive: true });      // 空目录，无 claims_*.parquet
    mkdirSync(join(root, 'SX', 'quotes_conversion'), { recursive: true });  // 空目录，无 latest.parquet
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('claims_detail 仅有非 claims_ 前缀 parquet → 排除（须 claims_*.parquet，与 bootstrapper 对称）', () => {
    const dir = join(root, 'SX', 'claims_detail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'latest.parquet'), ''); // 非 claims_ 前缀，claims_detail 不认
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('排除 SC 省（走 fact/ 标准同步）+ staging 中间态 + 根部 premium parquet（走 current/ promote）', () => {
    mkDomain(root, 'SC', 'claims_detail');                              // SC 基准省，不经 validation
    mkdirSync(join(root, 'SX', 'staging'), { recursive: true });        // 中间态，非 loader 读取域
    mkDomain(root, 'SX', 'quotes_conversion');
    writeFileSync(join(root, 'SX', '01_签单清单_x.parquet'), '');       // premium 走 current/ promote
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual(['validation/SX/quotes_conversion']);
  });

  it('同名为文件而非目录的派生域条目被忽略（仅同步真实目录）', () => {
    mkdirSync(join(root, 'SX'), { recursive: true });
    writeFileSync(join(root, 'SX', 'claims_detail'), ''); // 同名文件，非目录
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('多省（SX+GD）数据驱动枚举，无硬编码省份，按省份升序', () => {
    mkDomain(root, 'GD', 'claims_detail');
    mkDomain(root, 'SX', 'claims_detail');
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual([
      'validation/GD/claims_detail',
      'validation/SX/claims_detail',
    ]);
  });

  it('非省份命名目录（小写/长度≠2/数字）被忽略', () => {
    for (const bad of ['sx', 'SXX', 'S1', 'temp']) mkDomain(root, bad, 'claims_detail');
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });
});
