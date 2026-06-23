/**
 * Phase B B1 — 装载层省份子目录发现（生死点）回归锁
 *
 * 锁定三件事（全部用合成 tempdir / 内存数组 fixture，CI 无 parquet 亦可跑）：
 *   ① discoverInDir：顶层扁平字节安全 + current/<省>/ 子目录枚举（^[A-Z]{2}$，readdir 实际子目录，
 *      非硬编码省常量）+ symlink/嵌套目录边界。
 *   ② deduplicateOverlapping：分组键纳 branch 维度 → 跨省同名/同起期不互相覆盖（P0 生死点），
 *      同省去重 + 剔摩/限摩互补豁免行为不变。
 *   ③ enforceProvinceSubdirGate：GATED fail-closed（非基准省 + 闸关抛错 / 扁平+子目录并存抛错），
 *      基准省可装 + 多省闸开放行 + 基准省码动态（非写死 SC）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DataBootstrapper } from '../data-bootstrapper.js';

interface FileInfo { name: string; path: string; size: number; mtimeMs: number; branch?: string }

/** 仅 discoverInDir/dedup/gate 用，不触 db；构造极简 stub。 */
function makeBootstrapper(): any {
  return new DataBootstrapper({} as any);
}
function touch(p: string): void {
  fs.writeFileSync(p, '');
}
function fileInfo(name: string, branch?: string): FileInfo {
  return { name, path: `/x/${branch ?? 'flat'}/${name}`, size: 1, mtimeMs: 1, branch };
}

// ── ① discoverInDir（静态，tempdir fixture）─────────────────────────────────
describe('DataBootstrapper.discoverInDir', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('不存在的目录 → 空数组', () => {
    expect(DataBootstrapper.discoverInDir(path.join(tmp, 'nope'))).toEqual([]);
  });

  it('扁平顶层文件 → 全部发现且 branch=undefined（字节安全：与现状同集合）', () => {
    touch(path.join(tmp, 'a_20210101_20211231.parquet'));
    touch(path.join(tmp, 'b_20220101_20221231.parquet'));
    touch(path.join(tmp, 'schema-analysis.json')); // 非 parquet → 忽略
    const got = DataBootstrapper.discoverInDir(tmp);
    expect(got.map(f => f.name).sort()).toEqual(['a_20210101_20211231.parquet', 'b_20220101_20221231.parquet']);
    expect(got.every(f => f.branch === undefined)).toBe(true);
  });

  it('省份子目录 current/<省>/ → 发现并标 branch=目录名', () => {
    fs.mkdirSync(path.join(tmp, 'SX'));
    touch(path.join(tmp, 'SX', 'sx_data.parquet'));
    const got = DataBootstrapper.discoverInDir(tmp);
    expect(got).toHaveLength(1);
    expect(got[0].branch).toBe('SX');
    expect(got[0].name).toBe('sx_data.parquet');
  });

  it('顶层 + 多省子目录共存 → 各自正确标注 branch', () => {
    touch(path.join(tmp, 'flat.parquet'));
    fs.mkdirSync(path.join(tmp, 'SC'));
    touch(path.join(tmp, 'SC', 'sc.parquet'));
    fs.mkdirSync(path.join(tmp, 'SX'));
    touch(path.join(tmp, 'SX', 'sx.parquet'));
    const got = DataBootstrapper.discoverInDir(tmp);
    const byName = Object.fromEntries(got.map(f => [f.name, f.branch]));
    expect(byName).toEqual({ 'flat.parquet': undefined, 'sc.parquet': 'SC', 'sx.parquet': 'SX' });
  });

  it('非 ^[A-Z]{2}$ 目录（staging/.archive/小写/三字母）一律忽略（readdir 枚举本意）', () => {
    for (const d of ['staging', '.archive', 'sx', 'SCX', 'S1']) {
      fs.mkdirSync(path.join(tmp, d));
      touch(path.join(tmp, d, 'x.parquet'));
    }
    expect(DataBootstrapper.discoverInDir(tmp)).toEqual([]);
  });

  it('顶层 symlink parquet 仍纳入（P1-3：保留 statSync 跟随 symlink 语义）', () => {
    const real = path.join(tmp, 'real.parquet');
    touch(real);
    fs.symlinkSync(real, path.join(tmp, 'link.parquet'));
    const got = DataBootstrapper.discoverInDir(tmp).map(f => f.name).sort();
    expect(got).toEqual(['link.parquet', 'real.parquet']);
  });

  it('省份子目录内嵌套目录被排除（仅取文件）', () => {
    fs.mkdirSync(path.join(tmp, 'SX'));
    touch(path.join(tmp, 'SX', 'ok.parquet'));
    fs.mkdirSync(path.join(tmp, 'SX', 'staging')); // 嵌套目录
    const got = DataBootstrapper.discoverInDir(tmp);
    expect(got.map(f => f.name)).toEqual(['ok.parquet']);
  });
});

// ── ② deduplicateOverlapping（branch-aware 分组键）──────────────────────────
describe('DataBootstrapper.deduplicateOverlapping (branch-aware)', () => {
  const dedup = (files: FileInfo[]): FileInfo[] => (makeBootstrapper()).deduplicateOverlapping(files);

  it('跨省同名文件（非匹配正则）不互相覆盖 — P0 生死点', () => {
    const files = [fileInfo('签单_定稿.parquet', undefined), fileInfo('签单_定稿.parquet', 'SX')];
    const got = dedup(files);
    expect(got).toHaveLength(2);
    expect(got.map(f => f.branch).sort()).toEqual(['SX', undefined]);
  });

  it('跨省同起期（匹配正则）不互补误删 — 两省全保留', () => {
    const files = [
      fileInfo('a_20240101_20240601.parquet', undefined),
      fileInfo('a_20240101_20240701.parquet', 'SX'),
    ];
    expect(dedup(files)).toHaveLength(2);
  });

  it('同省同起期非互补 → 仍去重保留 endDate 最新（行为不变）', () => {
    const files = [
      fileInfo('a_20240101_20240601.parquet', undefined),
      fileInfo('a_20240101_20240701.parquet', undefined),
    ];
    const got = dedup(files);
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe('a_20240101_20240701.parquet');
  });

  it('剔摩 + 限摩同起期互补豁免 → 全保留（行为不变）', () => {
    const files = [
      fileInfo('01_签单清单_剔摩_20240101_20260504.parquet', undefined),
      fileInfo('01_签单清单_限摩_20240101_20260504.parquet', undefined),
    ];
    expect(dedup(files)).toHaveLength(2);
  });

  it('单文件 → 原样返回', () => {
    const files = [fileInfo('only_20240101_20240601.parquet', undefined)];
    expect(dedup(files)).toHaveLength(1);
  });
});

// ── ③ enforceProvinceSubdirGate（GATED fail-closed）────────────────────────
describe('DataBootstrapper.enforceProvinceSubdirGate (GATED)', () => {
  const gate = (files: FileInfo[]): FileInfo[] => (makeBootstrapper()).enforceProvinceSubdirGate(files);
  let savedRls: string | undefined;
  let savedBranch: string | undefined;
  beforeEach(() => { savedRls = process.env.BRANCH_RLS_ENABLED; savedBranch = process.env.BRANCH_CODE; });
  afterEach(() => {
    if (savedRls === undefined) delete process.env.BRANCH_RLS_ENABLED; else process.env.BRANCH_RLS_ENABLED = savedRls;
    if (savedBranch === undefined) delete process.env.BRANCH_CODE; else process.env.BRANCH_CODE = savedBranch;
  });

  it('无省份子目录（今天扁平布局）→ 原样返回，不抛错（休眠）', () => {
    delete process.env.BRANCH_RLS_ENABLED;
    const files = [fileInfo('flat1.parquet', undefined), fileInfo('flat2.parquet', undefined)];
    expect(gate(files)).toEqual(files);
  });

  it('非基准省子目录 + 多省闸关 → 抛错（P0-2 fail-closed）', () => {
    delete process.env.BRANCH_RLS_ENABLED; // baseline=SC（BRANCH_CODE 未设）
    delete process.env.BRANCH_CODE;
    const files = [fileInfo('sx.parquet', 'SX')];
    expect(() => gate(files)).toThrow(/GATED fail-closed/);
  });

  it('非基准省子目录 + 多省闸开 → 放行', () => {
    process.env.BRANCH_RLS_ENABLED = 'true';
    delete process.env.BRANCH_CODE;
    const files = [fileInfo('sx.parquet', 'SX')];
    expect(gate(files)).toEqual(files);
  });

  it('基准省子目录 + 闸关 → 放行（部署自身省份允许）', () => {
    delete process.env.BRANCH_RLS_ENABLED;
    delete process.env.BRANCH_CODE; // baseline=SC
    const files = [fileInfo('sc.parquet', 'SC')];
    expect(gate(files)).toEqual(files);
  });

  it('扁平 parquet 与省份子目录 parquet 并存 → 抛错（P1-4 一次性迁移互斥）', () => {
    process.env.BRANCH_RLS_ENABLED = 'true'; // 即便闸开，并存仍非法
    const files = [fileInfo('flat.parquet', undefined), fileInfo('sc.parquet', 'SC')];
    expect(() => gate(files)).toThrow(/迁移态冲突/);
  });

  it('基准省码动态：BRANCH_CODE=SX 部署 + SX 子目录 + 闸关 → 放行（非写死 SC）', () => {
    delete process.env.BRANCH_RLS_ENABLED;
    process.env.BRANCH_CODE = 'SX';
    const files = [fileInfo('sx.parquet', 'SX')];
    expect(gate(files)).toEqual(files);
  });
});
