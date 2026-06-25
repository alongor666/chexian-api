/**
 * validation/<非SC省> 派生域同步任务构建测试（PR-2 · 部署链 cutover 能力）。
 *
 * 被测：buildValidationBranchSyncTasks(remote, validationRoot) —— 枚举本地
 * warehouse/validation/<省>/<派生域>，构建 rsync 任务推到 VPS data/validation/<省>/<域>，
 * 让 VPS 读到 SX 派生域（claims_detail/quotes_conversion/renewal_tracker 等）。
 *
 * 对称性：省份枚举规则与 data-bootstrapper resolveBranch*Extras 一致
 * （`^[A-Z]{2}$` + 排除 SC + 升序）→ 「loader 读取域」== 「sync 推送域」。
 *
 * 字节安全：validationRoot 不存在 → 返回 [] → buildStandardSyncTasks 输出与历史逐字节等价。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildValidationBranchSyncTasks } from '../sync-vps.mjs';

describe('buildValidationBranchSyncTasks', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'val-sync-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('validationRoot 不存在 → 空数组（字节安全：无 validation 时日常同步逐字节不变）', () => {
    expect(buildValidationBranchSyncTasks('/remote/data', join(root, '不存在'))).toEqual([]);
  });

  it('validationRoot 存在但无任何省份目录 → 空数组', () => {
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('SX 含 claims_detail/quotes_conversion/renewal_tracker → 3 任务，remote 落 data/validation/SX/<域>', () => {
    for (const d of ['claims_detail', 'quotes_conversion', 'renewal_tracker']) {
      mkdirSync(join(root, 'SX', d), { recursive: true });
    }
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual([
      'validation/SX/claims_detail',
      'validation/SX/quotes_conversion',
      'validation/SX/renewal_tracker',
    ]);
    const claims = tasks.find((t) => t.label === 'validation/SX/claims_detail');
    expect(claims.local).toBe(join(root, 'SX', 'claims_detail'));
    expect(claims.remote).toBe('/remote/data/validation/SX/claims_detail');
    // GATED：RLS-off 时不消费，失败不阻断日常同步
    expect(claims.critical).toBe(false);
  });

  it('排除 SC 省（走 fact/ 标准同步）+ staging 中间态 + 根部 premium parquet（走 current/ promote）', () => {
    mkdirSync(join(root, 'SC', 'claims_detail'), { recursive: true });   // SC 基准省，不经 validation
    mkdirSync(join(root, 'SX', 'staging'), { recursive: true });         // 中间态，非 loader 读取域
    mkdirSync(join(root, 'SX', 'quotes_conversion'), { recursive: true });
    writeFileSync(join(root, 'SX', '01_签单清单_x.parquet'), '');        // premium 走 current/ promote
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual(['validation/SX/quotes_conversion']);
  });

  it('同名为文件而非目录的派生域条目被忽略（仅同步真实目录）', () => {
    mkdirSync(join(root, 'SX'), { recursive: true });
    writeFileSync(join(root, 'SX', 'claims_detail'), ''); // 同名文件，非目录
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });

  it('多省（SX+GD）数据驱动枚举，无硬编码省份，按省份升序', () => {
    mkdirSync(join(root, 'GD', 'claims_detail'), { recursive: true });
    mkdirSync(join(root, 'SX', 'claims_detail'), { recursive: true });
    const tasks = buildValidationBranchSyncTasks('/remote/data', root);
    expect(tasks.map((t) => t.label)).toEqual([
      'validation/GD/claims_detail',
      'validation/SX/claims_detail',
    ]);
  });

  it('非省份命名目录（小写/长度≠2/数字）被忽略', () => {
    for (const bad of ['sx', 'SXX', 'S1', 'temp']) {
      mkdirSync(join(root, bad, 'claims_detail'), { recursive: true });
    }
    expect(buildValidationBranchSyncTasks('/remote/data', root)).toEqual([]);
  });
});
