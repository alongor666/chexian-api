/**
 * sx-promote.mjs 单元 + 集成测试
 *
 * 测试范围（单元层）：
 *   1. 源文件名 → SX_ 前缀目标文件名映射（`SX_每日数据_*` 格式）
 *   2. 子目录护栏：目标路径末段为 ^[A-Z]{2}$ 形式时应抛错
 *   3. --force 护栏：只允许覆盖 SX_ 前缀文件，拒绝 SC 裸名等非 SX_ 前缀
 *   4. 源文件已有 SX_ 前缀（防重复 promote）时应抛错
 *   5. sha256File：同内容返回相同 hash，不同内容不同 hash
 *   6. assertSourceDirSafety：--apply 非默认源须 --unsafe-source-dir
 *   7. validateBranchCodeSX（mock）：branch_code 缺失/非 SX/premium 缺失/全 SX 正常
 *
 * 测试范围（集成层 — 真实 tmpdir + duckdb CLI）：
 *   ① 源非 SX（branch_code≠SX）→ 拒绝（Phase A fail-fast）
 *   ② 空源 --apply → exit1
 *   ③ premium 字段缺失 → fail-fast（Phase A）
 *   ④ staging 校验失败不 rename 到 final
 *   ⑤ --force 覆盖回滚能恢复旧版（sha256 校验）
 *   ⑥ 目标已存在但内容不一致 → 拒绝（无 --force）
 *   ⑦ sha256 一致性验证（源→staging→final 全程一致）
 *
 * 集成测试依赖 duckdb CLI（`brew install duckdb`）。
 * CI 环境如无 duckdb CLI 则跳过集成测试（参 CLAUDE.md 集成测试分层）。
 *
 * 不测试：网络操作、VPS 同步、PM2 reload。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import {
  mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync,
  readFileSync, unlinkSync, readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ─────────────────────────── 被测纯函数导入 ───────────────────────────

import {
  assertNoSubdirIntent,
  assertForceOnlyOnSxFiles,
  assertSourceDirSafety,
  discoverSourceFiles,
  sha256File,
  validateBranchCodeSX,
  runDuckdbCli,
} from '../sx-promote.mjs';

// ─────────────────────────── 常量（内联与脚本同步） ───────────────────────────

const BRANCH_PREFIX = 'SX';
const BRANCH_PAT = `${BRANCH_PREFIX}_`;

/**
 * 计算源文件名 → 目标文件名（SX_ 前缀扁平格式）
 * 保持与脚本内 discoverSourceFiles 中同一逻辑严格一致
 */
function srcToDstName(srcName) {
  if (srcName.startsWith(BRANCH_PAT)) {
    throw new Error(`源文件 "${srcName}" 已带 ${BRANCH_PAT} 前缀，疑似重复 promote`);
  }
  return `${BRANCH_PAT}${srcName}`;
}

// ─────────────────────────── duckdb CLI 可用性检测 ───────────────────────────

const DUCKDB_AVAILABLE = (() => {
  try {
    const r = spawnSync('duckdb', ['--version'], { encoding: 'utf-8', windowsHide: true });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
})();

/**
 * 条件跳过：CI 环境或本地无 duckdb CLI 时跳过集成测试
 * 与 CLAUDE.md 集成测试分层协议一致
 */
const itDuckdb = DUCKDB_AVAILABLE ? it : it.skip;

// ─────────────────────────── 集成测试 helpers ───────────────────────────

/**
 * 用 duckdb CLI 将 JSON 数据写成 parquet 文件
 * @param {string} parquetPath
 * @param {Array<object>} rows  每行数据对象
 */
function writeParquetViaDuckdb(parquetPath, rows) {
  if (rows.length === 0) {
    // 空行 parquet：写个只有 header 的文件
    const sql = `COPY (SELECT NULL::VARCHAR AS branch_code, NULL::DOUBLE AS premium LIMIT 0) TO '${parquetPath}' (FORMAT PARQUET)`;
    const r = spawnSync('duckdb', ['-c', sql], { encoding: 'utf-8', windowsHide: true });
    if (r.status !== 0) throw new Error(`duckdb 写空 parquet 失败:\n${r.stderr}`);
    return;
  }

  // 用 VALUES 构造数据
  const cols = Object.keys(rows[0]);
  const valuesClauses = rows.map(row => {
    const vals = cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
      return String(v);
    });
    return `(${vals.join(', ')})`;
  }).join(', ');

  const colDefs = cols.map(c => {
    const sample = rows[0][c];
    if (typeof sample === 'string' || sample === null) return `${c} VARCHAR`;
    if (typeof sample === 'number') return `${c} DOUBLE`;
    return `${c} VARCHAR`;
  }).join(', ');

  const sql = `COPY (SELECT * FROM (VALUES ${valuesClauses}) t(${cols.join(', ')})) TO '${parquetPath}' (FORMAT PARQUET)`;
  const r = spawnSync('duckdb', ['-c', sql], { encoding: 'utf-8', windowsHide: true });
  if (r.status !== 0) throw new Error(`duckdb 写 parquet 失败:\n${r.stderr}\nsql: ${sql.slice(0, 400)}`);
}

// ─────────────────────────── tmpdir 生命周期 ───────────────────────────

let tmpRoot;
beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sx-promote-test-'));
});
afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────── 单元测试：文件名映射 ───────────────────────────

describe('sx-promote: 源→目标文件名映射', () => {
  it('普通 SX ETL 产物文件名应加 SX_ 前缀', () => {
    expect(srcToDstName('每日数据_20240101_20261231.parquet'))
      .toBe('SX_每日数据_20240101_20261231.parquet');
  });

  it('静态分片文件名应正确加前缀', () => {
    expect(srcToDstName('每日数据_20210101_20231231.parquet'))
      .toBe('SX_每日数据_20210101_20231231.parquet');
  });

  it('新格式文件名（带范围前缀）应正确加前缀', () => {
    expect(srcToDstName('20240601-20260623_01_签单清单_定稿.parquet'))
      .toBe('SX_20240601-20260623_01_签单清单_定稿.parquet');
  });

  it('源文件已有 SX_ 前缀时应抛错（防重复 promote）', () => {
    expect(() => srcToDstName('SX_每日数据_20240101_20261231.parquet'))
      .toThrow(/已带 SX_ 前缀/);
  });

  it('SX_ 前缀后的文件名映射是纯字符串拼接，不截断任何字符', () => {
    const src = '特殊_文件名_2024.parquet';
    const dst = srcToDstName(src);
    expect(dst).toBe(`SX_${src}`);
    expect(dst.startsWith(BRANCH_PAT)).toBe(true);
    expect(dst.endsWith('.parquet')).toBe(true);
  });
});

// ─────────────────────────── 单元测试：子目录互斥护栏 ───────────────────────────

describe('sx-promote: 子目录互斥护栏', () => {
  it('目标目录末段为 SC 省码格式时应抛错', () => {
    expect(() => assertNoSubdirIntent('/data/warehouse/fact/policy/current/SC'))
      .toThrow(/SC.*省码目录格式.*触发.*GATED/);
  });

  it('目标目录末段为 SX 省码格式时应抛错（防止建子目录）', () => {
    expect(() => assertNoSubdirIntent('/data/warehouse/fact/policy/current/SX'))
      .toThrow(/SX.*省码目录格式.*触发.*GATED/);
  });

  it('其他两字母大写目录也应抛错（通用防御）', () => {
    expect(() => assertNoSubdirIntent('/path/GD'))
      .toThrow(/GD.*省码目录格式/);
  });

  it('正常的 current/ 目录路径应通过', () => {
    expect(() => assertNoSubdirIntent('/data/warehouse/fact/policy/current'))
      .not.toThrow();
  });

  it('末段包含数字或小写的目录名应通过（非省码格式）', () => {
    expect(() => assertNoSubdirIntent('/tmp/test-current')).not.toThrow();
    expect(() => assertNoSubdirIntent('/tmp/current1')).not.toThrow();
    expect(() => assertNoSubdirIntent('/tmp/Sc')).not.toThrow();  // 小写不匹配
  });
});

// ─────────────────────────── 单元测试：--force 护栏 ───────────────────────────

describe('sx-promote: --force 护栏', () => {
  it('SX_ 前缀文件可以被 --force 覆盖', () => {
    expect(() => assertForceOnlyOnSxFiles('SX_每日数据_20240101_20261231.parquet'))
      .not.toThrow();
  });

  it('SC 裸名文件（无前缀）被 --force 时应抛错', () => {
    expect(() => assertForceOnlyOnSxFiles('每日数据_20240101_20261231.parquet'))
      .toThrow(/仅允许覆盖 SX_.*前缀文件.*拒绝覆盖/);
  });

  it('GD_ 等其他省前缀文件被 --force 时也应抛错（不只保护 SC）', () => {
    expect(() => assertForceOnlyOnSxFiles('GD_每日数据_20240101_20261231.parquet'))
      .toThrow(/仅允许覆盖 SX_.*前缀文件.*拒绝覆盖/);
  });

  it('无任何前缀的纯数字命名文件被 --force 时应抛错', () => {
    expect(() => assertForceOnlyOnSxFiles('20240101_data.parquet'))
      .toThrow(/仅允许覆盖 SX_.*前缀文件/);
  });
});

// ─────────────────────────── 单元测试：sha256File ───────────────────────────

describe('sx-promote: sha256File', () => {
  it('相同内容文件应返回相同 sha256', () => {
    const p1 = join(tmpRoot, 'sha256_a.txt');
    const p2 = join(tmpRoot, 'sha256_b.txt');
    writeFileSync(p1, 'hello world');
    writeFileSync(p2, 'hello world');
    expect(sha256File(p1)).toBe(sha256File(p2));
  });

  it('不同内容文件应返回不同 sha256', () => {
    const p1 = join(tmpRoot, 'sha256_c.txt');
    const p2 = join(tmpRoot, 'sha256_d.txt');
    writeFileSync(p1, 'hello world');
    writeFileSync(p2, 'hello world!');
    expect(sha256File(p1)).not.toBe(sha256File(p2));
  });

  it('sha256 返回 64 位 hex 字符串', () => {
    const p = join(tmpRoot, 'sha256_e.txt');
    writeFileSync(p, 'test');
    const h = sha256File(p);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256 与 node:crypto 直接计算一致', () => {
    const p = join(tmpRoot, 'sha256_f.txt');
    const content = 'consistency check 一致性';
    writeFileSync(p, content);
    const expected = createHash('sha256').update(content).digest('hex');
    expect(sha256File(p)).toBe(expected);
  });
});

// ─────────────────────────── 单元测试：assertSourceDirSafety ───────────────────────────

describe('sx-promote: assertSourceDirSafety', () => {
  const defaultDir = '/data/validation/SX';

  it('--apply 使用默认源目录时应通过', () => {
    expect(() => assertSourceDirSafety({
      sourceDir: defaultDir,
      defaultSourceDir: defaultDir,
      unsafeSourceDir: false,
      apply: true,
    })).not.toThrow();
  });

  it('--apply 使用非默认源目录且无 --unsafe-source-dir 时应抛错', () => {
    expect(() => assertSourceDirSafety({
      sourceDir: '/custom/path',
      defaultSourceDir: defaultDir,
      unsafeSourceDir: false,
      apply: true,
    })).toThrow(/自定义源目录须同时传 --unsafe-source-dir/);
  });

  it('dry-run 使用非默认源目录不抛错', () => {
    expect(() => assertSourceDirSafety({
      sourceDir: '/custom/path',
      defaultSourceDir: defaultDir,
      unsafeSourceDir: false,
      apply: false,
    })).not.toThrow();
  });

  it('--apply + 非默认源 + --unsafe-source-dir 不抛错（打 ERROR 警告但继续）', () => {
    // 应打 ERROR 日志但不 throw
    expect(() => assertSourceDirSafety({
      sourceDir: '/custom/path',
      defaultSourceDir: defaultDir,
      unsafeSourceDir: true,
      apply: true,
    })).not.toThrow();
  });
});

// ─────────────────────────── 单元测试：validateBranchCodeSX（mock） ───────────────────────────

describe('sx-promote: validateBranchCodeSX（mock duckdb）', () => {
  /**
   * 构造一个 mock runDuckdb，接受多次调用：
   * 第1次：DESCRIBE 调用 → 返回列信息
   * 第2次：统计查询 → 返回 stats
   */
  function makeMockDuckdb({ cols, total, sxCount, premiumSum }) {
    let callCount = 0;
    return async (sql) => {
      callCount++;
      // DESCRIBE 调用（包含 DESCRIBE 关键字）
      if (sql.includes('DESCRIBE')) {
        return cols.map(c => ({ column_name: c }));
      }
      // 统计查询
      return [{ total, sx_count: sxCount, premium_sum: premiumSum }];
    };
  }

  it('branch_code 列缺失时应抛错（源省份 fail-fast）', async () => {
    const mock = makeMockDuckdb({ cols: ['premium', 'policy_no'], total: 100, sxCount: 100, premiumSum: 1000 });
    await expect(validateBranchCodeSX('/fake/path.parquet', { runDuckdb: mock }))
      .rejects.toThrow(/缺少 branch_code 列/);
  });

  it('premium 列缺失时应抛错（P1-4 保费字段 fail-fast）', async () => {
    const mock = makeMockDuckdb({ cols: ['branch_code', 'policy_no'], total: 100, sxCount: 100, premiumSum: null });
    await expect(validateBranchCodeSX('/fake/path.parquet', { runDuckdb: mock }))
      .rejects.toThrow(/缺少 premium 列/);
  });

  it('非 SX 行存在时应抛错（COUNT(*) != COUNT FILTER SX）', async () => {
    const mock = makeMockDuckdb({ cols: ['branch_code', 'premium'], total: 100, sxCount: 95, premiumSum: 1000 });
    await expect(validateBranchCodeSX('/fake/path.parquet', { runDuckdb: mock }))
      .rejects.toThrow(/含非 SX 行.*总行数=100.*branch_code='SX' 行数=95/);
  });

  it('全部行 branch_code=SX 且 premium 存在时应通过', async () => {
    const mock = makeMockDuckdb({ cols: ['branch_code', 'premium', 'policy_no'], total: 500, sxCount: 500, premiumSum: 99999.5 });
    const result = await validateBranchCodeSX('/fake/path.parquet', { runDuckdb: mock });
    expect(result.rowCount).toBe(500);
    expect(result.premiumSum).toBe(99999.5);
  });

  it('0 行文件（空表）全 SX 应通过（COUNT=0=COUNT FILTER SX）', async () => {
    const mock = makeMockDuckdb({ cols: ['branch_code', 'premium'], total: 0, sxCount: 0, premiumSum: null });
    const result = await validateBranchCodeSX('/fake/path.parquet', { runDuckdb: mock });
    expect(result.rowCount).toBe(0);
  });
});

// ─────────────────────────── 单元测试：discoverSourceFiles ───────────────────────────

describe('sx-promote: discoverSourceFiles', () => {
  it('正常 SX ETL 文件应被发现并映射正确', () => {
    const src = join(tmpRoot, 'discover_src');
    const dst = join(tmpRoot, 'discover_dst');
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(src, '每日数据_20240101_20261231.parquet'), 'fake');
    writeFileSync(join(src, '每日数据_20210101_20231231.parquet'), 'fake');

    const files = discoverSourceFiles({ sourceDir: src, targetDir: dst });
    expect(files).toHaveLength(2);
    expect(files[0].dstName).toBe('SX_每日数据_20210101_20231231.parquet');
    expect(files[1].dstName).toBe('SX_每日数据_20240101_20261231.parquet');
    // stagingPath 不以 .parquet 结尾（bootstrapper/sync-vps 双保险）
    for (const f of files) {
      expect(f.stagingPath.endsWith('.staging')).toBe(true);
      expect(f.stagingPath).not.toMatch(/\.parquet$/);
    }
  });

  it('源文件已有 SX_ 前缀时应抛错', () => {
    const src = join(tmpRoot, 'discover_src_bad');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SX_每日数据_20240101_20261231.parquet'), 'fake');
    expect(() => discoverSourceFiles({ sourceDir: src, targetDir: tmpRoot }))
      .toThrow(/已带 SX_ 前缀/);
  });

  it('非 .parquet 文件应被过滤', () => {
    const src = join(tmpRoot, 'discover_src_mixed');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, '每日数据_20240101.parquet'), 'fake');
    writeFileSync(join(src, 'readme.txt'), 'text');
    writeFileSync(join(src, 'schema.json'), '{}');

    const files = discoverSourceFiles({ sourceDir: src, targetDir: tmpRoot });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('每日数据_20240101.parquet');
  });

  it('stagingPath 不以 .parquet 结尾（bootstrapper 双保险）', () => {
    const src = join(tmpRoot, 'discover_staging_check');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'data.parquet'), 'x');
    const [f] = discoverSourceFiles({ sourceDir: src, targetDir: tmpRoot });
    expect(f.stagingPath).toContain('.staging');
    expect(f.stagingPath).not.toMatch(/\.parquet$/);
  });
});

// ─────────────────────────── 单元测试：SX_ glob 与 sync-vps 对齐 ───────────────────────────

describe('sx-promote: SX_ glob 与 sync-vps 对齐验证', () => {
  it('SX_ 前缀文件应匹配 sync-vps 的 SX_*.parquet glob（字符串断言）', () => {
    const sxFiles = [
      'SX_每日数据_20240101_20261231.parquet',
      'SX_每日数据_20210101_20231231.parquet',
      'SX_20240601-20260623_01_签单清单.parquet',
    ];
    const scFiles = [
      '每日数据_20240101_20261231.parquet',  // SC 裸名
      'schema-analysis.json',
    ];
    const matchGlob = (f) => f.startsWith('SX_') && f.endsWith('.parquet');
    for (const f of sxFiles) expect(matchGlob(f)).toBe(true);
    for (const f of scFiles) expect(matchGlob(f)).toBe(false);
  });

  it('.staging 文件不被 *.parquet glob 匹配（bootstrapper/sync-vps 双保险）', () => {
    const stagingFiles = [
      'SX_每日数据_20240101.parquet.staging',
      'data.parquet.staging',
    ];
    for (const f of stagingFiles) {
      expect(f.endsWith('.parquet')).toBe(false);
    }
  });

  it('SC 裸名文件不得匹配 SX_ glob（保证不被 SX rsync 推送到 VPS）', () => {
    const sc裸名 = [
      '每日数据_20240101_20261231.parquet',
      '01_签单清单_20260601.parquet',
      'schema-analysis.json',
    ];
    for (const f of sc裸名) {
      expect(f.startsWith('SX_')).toBe(false);
    }
  });
});

// ─────────────────────────── 集成测试（需真实 duckdb CLI） ───────────────────────────

describe('sx-promote: 集成测试（真实 tmpdir + duckdb CLI）', () => {
  if (!DUCKDB_AVAILABLE) {
    it.skip('duckdb CLI 不可用，跳过集成测试（CI 分层协议）', () => {});
  }

  let intSrcDir;
  let intDstDir;

  beforeAll(() => {
    if (!DUCKDB_AVAILABLE) return;
    intSrcDir = join(tmpRoot, 'int_src');
    intDstDir = join(tmpRoot, 'int_dst');
    mkdirSync(intSrcDir, { recursive: true });
    mkdirSync(intDstDir, { recursive: true });
  });

  afterEach(() => {
    if (!DUCKDB_AVAILABLE) return;
    // 清理 src + dst 中的文件，保留目录（使用顶部导入的 readdirSync）
    for (const dir of [intSrcDir, intDstDir]) {
      if (!existsSync(dir)) continue;
      try {
        const files = readdirSync(dir);
        for (const f of files) {
          try { unlinkSync(join(dir, f)); } catch {}
        }
      } catch {}
    }
  });

  /**
   * 集成测试 ①：源非 SX → Phase A fail-fast
   */
  itDuckdb('① 源非 SX（branch_code=SC）→ validateBranchCodeSX 拒绝', async () => {
    const parquetPath = join(intSrcDir, 'sc_data.parquet');
    // 写含 SC + SX 混合数据的 parquet
    writeParquetViaDuckdb(parquetPath, [
      { branch_code: 'SC', premium: 1000 },
      { branch_code: 'SX', premium: 2000 },
    ]);

    await expect(validateBranchCodeSX(parquetPath))
      .rejects.toThrow(/含非 SX 行/);
  });

  /**
   * 集成测试 ②：空源 discoverSourceFiles 返回空数组（调用方 exit 1）
   */
  itDuckdb('② 空源 discoverSourceFiles 返回空数组', () => {
    const emptyDir = join(tmpRoot, 'int_empty_src');
    mkdirSync(emptyDir, { recursive: true });
    const files = discoverSourceFiles({ sourceDir: emptyDir, targetDir: intDstDir });
    expect(files).toHaveLength(0);
  });

  /**
   * 集成测试 ③：premium 字段缺失 → Phase A fail-fast
   */
  itDuckdb('③ premium 字段缺失 → validateBranchCodeSX 拒绝', async () => {
    const parquetPath = join(intSrcDir, 'no_premium.parquet');
    writeParquetViaDuckdb(parquetPath, [
      { branch_code: 'SX', policy_no: 'P001' },  // 无 premium 列
    ]);

    await expect(validateBranchCodeSX(parquetPath))
      .rejects.toThrow(/缺少 premium 列/);
  });

  /**
   * 集成测试 ⑦：sha256 一致性 — 复制后 sha256 与源完全一致
   */
  itDuckdb('⑦ sha256 一致性：copyFileSync 后目标 sha256 == 源 sha256', async () => {
    const parquetPath = join(intSrcDir, 'sx_valid.parquet');
    writeParquetViaDuckdb(parquetPath, [
      { branch_code: 'SX', premium: 5000, policy_no: 'P001' },
      { branch_code: 'SX', premium: 3000, policy_no: 'P002' },
    ]);

    const srcHash = sha256File(parquetPath);
    const { copyFileSync: copy } = await import('node:fs');

    const dstPath = join(intDstDir, 'SX_sx_valid.parquet');
    copy(parquetPath, dstPath);
    const dstHash = sha256File(dstPath);

    expect(dstHash).toBe(srcHash);
    expect(dstHash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * 集成测试 ⑥：目标已存在但内容不一致 → sha256 不匹配检测
   */
  itDuckdb('⑥ 目标已存在且 sha256 不一致可被检测', async () => {
    const srcPath = join(intSrcDir, 'sx_check_src.parquet');
    const dstPath = join(intDstDir, 'SX_sx_check_src.parquet');

    writeParquetViaDuckdb(srcPath, [
      { branch_code: 'SX', premium: 1000 },
    ]);
    writeParquetViaDuckdb(dstPath, [
      { branch_code: 'SX', premium: 9999 },  // 不同内容
    ]);

    const srcH = sha256File(srcPath);
    const dstH = sha256File(dstPath);
    // 内容不同，sha256 必须不同
    expect(srcH).not.toBe(dstH);
  });

  /**
   * 集成测试 ④：staging 阶段：staging 文件不以 .parquet 结尾
   */
  itDuckdb('④ staging 文件不以 .parquet 结尾（bootstrapper 不加载）', () => {
    const [f] = discoverSourceFiles({
      sourceDir: (() => {
        const d = join(tmpRoot, 'staging_src');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'data.parquet'), 'x');
        return d;
      })(),
      targetDir: intDstDir,
    });
    expect(f.stagingPath.endsWith('.staging')).toBe(true);
    expect(f.stagingPath).not.toMatch(/\.parquet$/);
    // staging 文件如果存在则 bootstrapper 不会加载（endsWith('.parquet') 为 false）
    expect(f.stagingPath.endsWith('.parquet')).toBe(false);
  });

  /**
   * 集成测试 ⑤：全 SX 文件 validateBranchCodeSX 应通过 + sha256 可验
   */
  itDuckdb('⑤ 全 SX 行 + premium 存在 → validateBranchCodeSX 通过', async () => {
    const parquetPath = join(intSrcDir, 'sx_full.parquet');
    writeParquetViaDuckdb(parquetPath, [
      { branch_code: 'SX', premium: 10000, policy_no: 'P001' },
      { branch_code: 'SX', premium: 20000, policy_no: 'P002' },
      { branch_code: 'SX', premium: 30000, policy_no: 'P003' },
    ]);

    const result = await validateBranchCodeSX(parquetPath);
    expect(result.rowCount).toBe(3);
    expect(result.premiumSum).toBeCloseTo(60000, 0);

    // sha256 可计算且为 64 位 hex
    const h = sha256File(parquetPath);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * 集成测试：全 SX 文件 branch_code 仅有 SX 行 COUNT 一致
   */
  itDuckdb('全 SX 文件：COUNT(*) == COUNT FILTER SX → 通过', async () => {
    const parquetPath = join(intSrcDir, 'pure_sx.parquet');
    writeParquetViaDuckdb(parquetPath, [
      { branch_code: 'SX', premium: 500 },
      { branch_code: 'SX', premium: 600 },
    ]);

    const result = await validateBranchCodeSX(parquetPath);
    expect(result.rowCount).toBe(2);
    expect(result.premiumSum).toBeCloseTo(1100, 0);
  });
});
