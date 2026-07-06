/**
 * Phase B B4 — web 上传链路 current/ 布局解析回归锁
 *
 * 锁定三件事（合成 tempdir fixture，CI 无 parquet / 无 duckdb 原生模块亦可跑）：
 *   ① resolveUploadTargetDir：开关 off 默认扁平（SC 逐字节安全）；on → current/<部署省>/
 *      （getDeploymentBranchCode 单一来源，动态省码非写死 SC）。
 *   ② resolveManagedParquetDirs：off → [current/, DATA_DIR] 现状不变；on → 前插部署省子目录，
 *      且绝不枚举他省（clear/download 不触他省）。
 *   ③ discoverCurrentParquetPaths：复用 B1 discoverInDir + GATED 闸——扁平集合与旧 readdir
 *      等价；基准省子目录放行；非基准省 + RLS 关 fail-closed；扁平+子目录并存 fail-closed。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveUploadTargetDir,
  resolveManagedParquetDirs,
  discoverCurrentParquetPaths,
} from '../data-layout.js';

function touch(p: string): void {
  fs.writeFileSync(p, '');
}

let savedLayout: string | undefined;
let savedBranch: string | undefined;
let savedRls: string | undefined;
beforeEach(() => {
  savedLayout = process.env.POLICY_CURRENT_SUBDIR_LAYOUT;
  savedBranch = process.env.BRANCH_CODE;
  savedRls = process.env.BRANCH_RLS_ENABLED;
});
afterEach(() => {
  if (savedLayout === undefined) delete process.env.POLICY_CURRENT_SUBDIR_LAYOUT; else process.env.POLICY_CURRENT_SUBDIR_LAYOUT = savedLayout;
  if (savedBranch === undefined) delete process.env.BRANCH_CODE; else process.env.BRANCH_CODE = savedBranch;
  if (savedRls === undefined) delete process.env.BRANCH_RLS_ENABLED; else process.env.BRANCH_RLS_ENABLED = savedRls;
});

// ── ① resolveUploadTargetDir（multer 落盘目录）─────────────────────────────
describe('resolveUploadTargetDir', () => {
  const CURRENT = '/srv/data/current';

  it('开关未设置（默认 off）→ 扁平 current/，与现状逐字节一致', () => {
    delete process.env.POLICY_CURRENT_SUBDIR_LAYOUT;
    expect(resolveUploadTargetDir(CURRENT)).toBe(CURRENT);
  });

  it('开关显式 false → 扁平 current/（仅字面量 "true" 开启，与 ETL 侧同语义）', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'false';
    expect(resolveUploadTargetDir(CURRENT)).toBe(CURRENT);
  });

  it('开关 on + BRANCH_CODE 未设置 → current/SC（resolveBranchCode 告警回退基准省）', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'true';
    delete process.env.BRANCH_CODE;
    expect(resolveUploadTargetDir(CURRENT)).toBe(path.join(CURRENT, 'SC'));
  });

  it('开关 on + BRANCH_CODE=SX → current/SX（部署省动态，非写死 SC）', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'true';
    process.env.BRANCH_CODE = 'SX';
    expect(resolveUploadTargetDir(CURRENT)).toBe(path.join(CURRENT, 'SX'));
  });

  it('开关 on + BRANCH_CODE 非法（sc1）→ 白名单回退 SC，绝不把非法值拼进路径', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'true';
    process.env.BRANCH_CODE = 'sc1';
    expect(resolveUploadTargetDir(CURRENT)).toBe(path.join(CURRENT, 'SC'));
  });
});

// ── ② resolveManagedParquetDirs（files/load/download/clear 候选目录）────────
describe('resolveManagedParquetDirs', () => {
  const CURRENT = '/srv/data/current';
  const DATA_DIR = '/srv/data';

  it('开关 off → [current/, DATA_DIR]（现状不变）', () => {
    delete process.env.POLICY_CURRENT_SUBDIR_LAYOUT;
    expect(resolveManagedParquetDirs(CURRENT, DATA_DIR)).toEqual([CURRENT, DATA_DIR]);
  });

  it('开关 on → 前插 current/<部署省>/，扁平候选保留（迁移过渡期文件仍可寻址）', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'true';
    process.env.BRANCH_CODE = 'SX';
    expect(resolveManagedParquetDirs(CURRENT, DATA_DIR)).toEqual([
      path.join(CURRENT, 'SX'),
      CURRENT,
      DATA_DIR,
    ]);
  });

  it('开关 on 时只下钻部署省自身，不含任何他省目录', () => {
    process.env.POLICY_CURRENT_SUBDIR_LAYOUT = 'true';
    process.env.BRANCH_CODE = 'SC';
    const dirs = resolveManagedParquetDirs(CURRENT, DATA_DIR);
    expect(dirs).toHaveLength(3);
    expect(dirs.some((d) => d.endsWith(path.join('current', 'SX')))).toBe(false);
  });
});

// ── ③ discoverCurrentParquetPaths（上传后合并加载，复用 B1 发现 + GATED 闸）──
describe('discoverCurrentParquetPaths', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-load-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('扁平布局 → 返回集合与旧 readdir(endsWith .parquet) 逐字节等价', () => {
    touch(path.join(tmp, 'a.parquet'));
    touch(path.join(tmp, 'b.parquet'));
    touch(path.join(tmp, 'schema-analysis.json')); // 非 parquet → 忽略
    const got = discoverCurrentParquetPaths(tmp).sort();
    expect(got).toEqual([path.join(tmp, 'a.parquet'), path.join(tmp, 'b.parquet')]);
  });

  it('基准省子目录（RLS 关，BRANCH_CODE 未设 → 基准=SC）→ 正常下钻返回', () => {
    delete process.env.BRANCH_RLS_ENABLED;
    delete process.env.BRANCH_CODE;
    fs.mkdirSync(path.join(tmp, 'SC'));
    touch(path.join(tmp, 'SC', 'sc.parquet'));
    expect(discoverCurrentParquetPaths(tmp)).toEqual([path.join(tmp, 'SC', 'sc.parquet')]);
  });

  it('非基准省子目录 + RLS 关 → GATED fail-closed 抛错（严禁推 SX 进生产语义）', () => {
    delete process.env.BRANCH_RLS_ENABLED;
    delete process.env.BRANCH_CODE;
    fs.mkdirSync(path.join(tmp, 'SX'));
    touch(path.join(tmp, 'SX', 'sx.parquet'));
    expect(() => discoverCurrentParquetPaths(tmp)).toThrow(/GATED fail-closed/);
  });

  it('扁平 parquet 与省份子目录并存 → 迁移态冲突抛错（防同省双计）', () => {
    fs.mkdirSync(path.join(tmp, 'SC'));
    touch(path.join(tmp, 'SC', 'sc.parquet'));
    touch(path.join(tmp, 'flat.parquet'));
    expect(() => discoverCurrentParquetPaths(tmp)).toThrow(/迁移态冲突/);
  });
});
