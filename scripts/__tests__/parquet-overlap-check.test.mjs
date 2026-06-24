/**
 * policy/current 重叠检测共享逻辑单测
 *
 * 锁定 detectPolicyCurrentOverlap 行为：
 * 1. 互补分片（剔摩↔限摩）时间重叠 → 0 overlap
 * 2. 裸名主分片 + 限摩（无配对剔摩） → 报告 overlap（2026-05-15 事故反模式）
 * 3. 三段不重叠主分片 → 0 overlap
 * 4. 不存在的目录 → skipped
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  parseDateRangeFromFilename,
  parseBranchFromFilename,
  isComplementaryPair,
  detectPolicyCurrentOverlap,
  assertNoPolicyCurrentOverlap,
  resolveBranchFromParquet,
} from '../lib/parquet-overlap-check.mjs';

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'parquet-overlap-'));
  for (const name of files) writeFileSync(join(dir, name), '');
  return dir;
}

// 派生轴（真 parquet）测试需 python3 + duckdb（CI 通常无）→ 显式 skipIf（非静默跳过，避免假 passed）。
// 本地有 duckdb 时真跑作证据；CI 无 duckdb 时 vitest 输出显式标记 skipped。
function duckdbAvailable() {
  try {
    execFileSync('python3', ['-c', 'import duckdb'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_DUCKDB = duckdbAvailable();

// 用 python3+duckdb 在 dir 里写一个真 parquet：cols 形如 {policy_no:[...], branch_code:[...]}（branch_code 可省）
function writeParquetFixture(dir, name, cols) {
  const py = `
import sys, json, duckdb, pandas as pd
cols = json.loads(sys.argv[1]); out = sys.argv[2]
df = pd.DataFrame(cols)
con = duckdb.connect(); con.register('df', df)
con.execute(f"COPY (SELECT * FROM df) TO '{out}' (FORMAT parquet)")
`;
  execFileSync('python3', ['-c', py, JSON.stringify(cols), join(dir, name)], { stdio: 'ignore' });
}

describe('parseDateRangeFromFilename', () => {
  it('解析标准命名 *_YYYYMMDD_YYYYMMDD.parquet', () => {
    expect(parseDateRangeFromFilename('01_签单清单_20240101_20260504.parquet'))
      .toEqual({ start: 20240101, end: 20260504 });
  });

  it('解析新前缀式命名 YYYYMMDD-YYYYMMDD_01_签单清单_定稿.parquet（2026-06-10 上游重构）', () => {
    expect(parseDateRangeFromFilename('20260601-20260610_01_签单清单_定稿.parquet'))
      .toEqual({ start: 20260601, end: 20260610 });
  });

  it('跨命名代际重叠可被检测（遗留后缀式 vs 新前缀式）', () => {
    const dir = makeDir([
      '每日数据_20240101_20260610.parquet',
      '20260601-20260612_01_签单清单_定稿.parquet',
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('非标准命名（单日期）返回 null', () => {
    expect(parseDateRangeFromFilename('20260514_01_签单清单.parquet')).toBeNull();
  });

  it('非 parquet 后缀返回 null', () => {
    expect(parseDateRangeFromFilename('01_签单清单_20240101_20260504.xlsx')).toBeNull();
  });
});

describe('parseBranchFromFilename', () => {
  it('裸名（四川）→ SC', () => {
    expect(parseBranchFromFilename('20210101-20260617_01_签单清单_定稿.parquet')).toBe('SC');
    expect(parseBranchFromFilename('每日数据_20240101_20260610.parquet')).toBe('SC');
  });

  it('省份前缀 → 对应 CHAR(2)', () => {
    expect(parseBranchFromFilename('SX_20210101-20260617_01_签单清单_定稿.parquet')).toBe('SX');
  });
});

describe('isComplementaryPair', () => {
  it('剔摩 + 限摩 = true', () => {
    expect(isComplementaryPair(
      '01_签单清单_剔摩_20240101_20260504.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet'
    )).toBe(true);
  });

  it('裸名 + 限摩 = false（反模式 — 2026-05-15 事故）', () => {
    expect(isComplementaryPair(
      '01_签单清单_20230101_20241231.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet'
    )).toBe(false);
  });

  it('两个剔摩 = false', () => {
    expect(isComplementaryPair(
      '01_签单清单_剔摩_2023.parquet',
      '01_签单清单_剔摩_2024.parquet'
    )).toBe(false);
  });
});

describe('detectPolicyCurrentOverlap', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('裸名主分片 + 限摩 → 报 overlap（2026-05-15 反模式）', () => {
    dir = makeDir([
      '01_签单清单_20230101_20241231.parquet',
      '01_签单清单_20250101_20260512.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet',
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(2);
    expect(r.overlaps.map(o => o.b)).toEqual(expect.arrayContaining([
      '01_签单清单_限摩_20240101_20260504.parquet',
    ]));
  });

  it('剔摩 + 限摩 时间重叠 → 互补豁免（0 overlap）', () => {
    dir = makeDir([
      '01_签单清单_剔摩_20240101_20260504.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet',
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(0);
    expect(r.files).toBe(2);
  });

  it('三段不重叠主分片 → 0 overlap', () => {
    dir = makeDir([
      '01_签单清单_20210101_20221231.parquet',
      '01_签单清单_20230101_20241231.parquet',
      '01_签单清单_20250101_20260512.parquet',
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(0);
    expect(r.files).toBe(3);
  });

  it('SC 裸名 + SX 前缀 同期 → 跨省不算重叠（多省物理隔离）', () => {
    dir = makeDir([
      '20210101-20260617_01_签单清单_定稿.parquet',       // SC 裸名
      'SX_20210101-20260617_01_签单清单_定稿.parquet',    // SX 前缀
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(0);
  });

  it('同省内真实重叠仍检出（SX 组内，非互补）', () => {
    dir = makeDir([
      'SX_20210101-20260617_01_签单清单_定稿.parquet',
      'SX_20250101-20260617_01_签单清单_定稿.parquet',
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBeGreaterThan(0);
  });

  it('目录不存在 → skipped', () => {
    const r = detectPolicyCurrentOverlap('/nonexistent/path/xxx');
    expect(r.skipped).toBe(true);
  });

  // B2 防沉默失败：省份子目录 current/<省>/ 分片必须被枚举（否则 files=0 假「通过」）
  it('省份子目录分片被枚举（current/<省>/，无条件结构断言）', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-overlap-'));
    mkdirSync(join(dir, 'SC'), { recursive: true });
    writeFileSync(join(dir, 'SC', '01_签单清单_20210101_20221231.parquet'), '');
    writeFileSync(join(dir, 'SC', '01_签单清单_20230101_20241231.parquet'), '');
    const r = detectPolicyCurrentOverlap(dir);
    // 关键：files 计入子目录分片（不失明）；两段不重叠 → 0 overlap
    expect(r.files).toBe(2);
    expect(r.skipped).toBe(false);
  });

  it('扁平 + 子目录并存时两者都被枚举', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-overlap-'));
    writeFileSync(join(dir, '01_签单清单_20210101_20221231.parquet'), '');
    mkdirSync(join(dir, 'SC'), { recursive: true });
    writeFileSync(join(dir, 'SC', '01_签单清单_20230101_20241231.parquet'), '');
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.files).toBe(2);
  });

  it('忽略 test-data 前缀与无日期范围的文件', () => {
    dir = makeDir([
      'test-data_20240101_20260504.parquet',  // 应被过滤
      '20260514_01_签单清单.parquet',           // 单日期无范围，过滤
      '01_签单清单_20210101_20221231.parquet',  // 唯一参与检测的
    ]);
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.files).toBe(1);
    expect(r.count).toBe(0);
  });
});

describe('assertNoPolicyCurrentOverlap', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('健康目录 → 调 onPass，返回 true', () => {
    dir = makeDir(['01_签单清单_20210101_20221231.parquet']);
    let passMsg = null;
    const ok = assertNoPolicyCurrentOverlap(dir, {
      onPass: (m) => { passMsg = m; },
      onFail: () => { throw new Error('should not fail'); },
    });
    expect(ok).toBe(true);
    expect(passMsg).toContain('1 个文件');
  });

  it('重叠目录 → 调 onFail，返回 false', () => {
    dir = makeDir([
      '01_签单清单_20230101_20241231.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet',
    ]);
    let failMsg = null;
    const ok = assertNoPolicyCurrentOverlap(dir, {
      onPass: () => { throw new Error('should not pass'); },
      onFail: (m) => { failMsg = m; },
    });
    expect(ok).toBe(false);
    expect(failMsg).toContain('反模式');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 派生轴（数据权威）测试 — Phase 4 codex 闸-1 P1.4 / P2 #3b（真 parquet fixture，需 duckdb）
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_DUCKDB)('resolveBranchFromParquet（派生轴权威·真 parquet）', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('空占位文件（0 字节）→ 回退文件名轴（legacy 兼容）', () => {
    dir = makeDir(['SX_20210101-20260617_01_签单清单_定稿.parquet']);
    expect(resolveBranchFromParquet(join(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet')))
      .toEqual({ branch: 'SX' });
  });

  it('文件名 SX_ 但内容全 SC → 取派生 SC（数据轴覆盖文件名）', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-derive-'));
    writeParquetFixture(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6100001', '6100002'], branch_code: ['SC', 'SC'],
    });
    expect(resolveBranchFromParquet(join(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet')))
      .toEqual({ branch: 'SC' });
  });

  it('无 branch_code 列但 policy_no 派生 SX → 取派生 SX', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-derive-'));
    writeParquetFixture(dir, '20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6180001', '6180002'],
    });
    expect(resolveBranchFromParquet(join(dir, '20210101-20260617_01_签单清单_定稿.parquet')))
      .toEqual({ branch: 'SX' });
  });

  it('单文件混省（SC+SX）→ branchError（fail-closed）', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-derive-'));
    writeParquetFixture(dir, '20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6100001', '6180002'], branch_code: ['SC', 'SX'],
    });
    const r = resolveBranchFromParquet(join(dir, '20210101-20260617_01_签单清单_定稿.parquet'));
    expect(r.branchError).toBeTruthy();
    expect(r.branch).toBeUndefined();
  });
});

describe.skipIf(!HAS_DUCKDB)('detectPolicyCurrentOverlap（派生轴·真 parquet）', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('文件名 SX_ 但内容 SC + 裸名 SC 同期 → 派生轴归同省 → 检出重叠（文件名轴会漏）', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-derive-'));
    // 两文件同期；若按文件名轴会分入 SX/SC 两组（0 overlap），按派生轴都是 SC（1 overlap）
    writeParquetFixture(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6100001'], branch_code: ['SC'],
    });
    writeParquetFixture(dir, '20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6100002'], branch_code: ['SC'],
    });
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.count).toBe(1);
    expect(r.branchErrors).toEqual([]);
  });

  it('混省 parquet → branchErrors 非空 → assertNoPolicyCurrentOverlap fail-closed', () => {
    dir = mkdtempSync(join(tmpdir(), 'parquet-derive-'));
    writeParquetFixture(dir, '20210101-20260617_01_签单清单_定稿.parquet', {
      policy_no: ['6100001', '6180002'], branch_code: ['SC', 'SX'],
    });
    const r = detectPolicyCurrentOverlap(dir);
    expect(r.branchErrors.length).toBeGreaterThan(0);
    let failMsg = null;
    const ok = assertNoPolicyCurrentOverlap(dir, {
      onPass: () => { throw new Error('should not pass'); },
      onFail: (m) => { failMsg = m; },
    });
    expect(ok).toBe(false);
    expect(failMsg).toContain('混省');
  });
});
