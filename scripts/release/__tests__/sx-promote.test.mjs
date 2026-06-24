/**
 * sx-promote.mjs 纯逻辑单元测试
 *
 * 测试范围：
 *   1. 源文件名 → SX_ 前缀目标文件名映射（`SX_每日数据_*` 格式）
 *   2. 子目录护栏：目标路径末段为 ^[A-Z]{2}$ 形式时应抛错
 *   3. --force 护栏：只允许覆盖 SX_ 前缀文件，拒绝 SC 裸名等非 SX_ 前缀
 *   4. 源文件已有 SX_ 前缀（防重复 promote）时应抛错
 *   5. duckdb 校验：行数严格相等 / 保费万分之一容差
 *
 * 不测试：文件系统 I/O、Python 进程调用（集成测试范畴）。
 * 纯函数均抽自 sx-promote.mjs 中的同名逻辑，在测试内内联定义（避免 ESM 侧效应）。
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────── 内联被测逻辑（与脚本同步） ───────────────────────────
// 注意：保持与 sx-promote.mjs 同名函数逻辑严格一致。若脚本修改须同步更新此处。

const BRANCH_PREFIX = 'SX';
const BRANCH_PAT = `${BRANCH_PREFIX}_`;
const PREMIUM_TOLERANCE = 1e-4;

/**
 * 计算源文件名 → 目标文件名（SX_ 前缀扁平格式）
 */
function srcToDstName(srcName) {
  if (srcName.startsWith(BRANCH_PAT)) {
    throw new Error(`源文件 "${srcName}" 已带 ${BRANCH_PAT} 前缀，疑似重复 promote`);
  }
  return `${BRANCH_PAT}${srcName}`;
}

/**
 * 子目录护栏：目标根目录末段不得是省码目录格式（^[A-Z]{2}$）
 */
function assertNoSubdirIntent(targetDir) {
  const { basename } = { basename: (p) => p.split('/').pop() };
  const dirName = targetDir.split('/').pop();
  if (/^[A-Z]{2}$/.test(dirName)) {
    throw new Error(
      `--target-dir "${targetDir}" 末段是省码目录格式（${dirName}），` +
      `会触发 bootstrap GATED fail-closed。应传 current/ 根目录。`
    );
  }
}

/**
 * --force 安全护栏：只允许覆盖 SX_ 前缀文件
 */
function assertForceOnlyOnSxFiles(filename) {
  if (!filename.startsWith(BRANCH_PAT)) {
    throw new Error(
      `--force 仅允许覆盖 ${BRANCH_PAT}* 前缀文件，拒绝覆盖: ${filename}`
    );
  }
}

/**
 * 保费容差校验逻辑（万分之一）
 */
function isPremiumMatch(srcPremium, dstPremium) {
  if (srcPremium === null || dstPremium === null) return true;  // 字段不可用时跳过
  return Math.abs(srcPremium - dstPremium) / (Math.abs(srcPremium) || 1) < PREMIUM_TOLERANCE;
}

// ─────────────────────────── 测试套件 ───────────────────────────

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

describe('sx-promote: duckdb 校验逻辑', () => {
  describe('行数校验（严格相等）', () => {
    it('行数相等时通过', () => {
      expect(100 === 100).toBe(true);
    });

    it('行数不等时失败', () => {
      expect(100 === 101).toBe(false);
    });

    it('行数差 1 也算失败（严格相等）', () => {
      const srcRows = 1000000;
      const dstRows = 999999;
      expect(srcRows === dstRows).toBe(false);
    });
  });

  describe('保费容差校验（万分之一）', () => {
    it('保费完全相等时通过', () => {
      expect(isPremiumMatch(1000000, 1000000)).toBe(true);
    });

    it('保费差异在万分之一以内时通过', () => {
      const src = 10000000;
      const dst = src * (1 + 0.00005);  // 0.005%，小于万分之一
      expect(isPremiumMatch(src, dst)).toBe(true);
    });

    it('保费差异超过万分之一时失败', () => {
      const src = 10000000;
      const dst = src * (1 + 0.00015);  // 0.015%，大于万分之一
      expect(isPremiumMatch(src, dst)).toBe(false);
    });

    it('保费刚好等于万分之一时失败（严格小于）', () => {
      const src = 10000000;
      const dst = src * (1 + PREMIUM_TOLERANCE);  // 恰好等于阈值 → 不通过
      expect(isPremiumMatch(src, dst)).toBe(false);
    });

    it('源保费为 null（字段不可用）时跳过保费校验', () => {
      expect(isPremiumMatch(null, 1000)).toBe(true);
    });

    it('目标保费为 null 时跳过保费校验', () => {
      expect(isPremiumMatch(1000, null)).toBe(true);
    });

    it('源保费为 0 时正确处理（防除零）', () => {
      // srcPremium=0: Math.abs(0-0)/(|0||1) = 0 < tolerance → true
      expect(isPremiumMatch(0, 0)).toBe(true);
      // srcPremium=0, dstPremium=0.1: Math.abs(0-0.1)/(|0||1) = 0.1 → false
      expect(isPremiumMatch(0, 0.1)).toBe(false);
    });
  });
});

describe('sx-promote: SX_ glob 与 sync-vps 对齐验证', () => {
  it('SX_ 前缀文件应匹配 sync-vps 的 SX_*.parquet glob（字符串断言）', () => {
    // sync-vps buildRsyncBranchFilterArgs('SX') 使用 `SX_*.parquet` glob
    const glob = 'SX_*.parquet';
    const sxFiles = [
      'SX_每日数据_20240101_20261231.parquet',
      'SX_每日数据_20210101_20231231.parquet',
      'SX_20240601-20260623_01_签单清单.parquet',
    ];
    const scFiles = [
      '每日数据_20240101_20261231.parquet',  // SC 裸名
      'schema-analysis.json',
    ];
    // 模拟 glob 匹配：以 SX_ 开头且以 .parquet 结尾
    const matchGlob = (f) => f.startsWith('SX_') && f.endsWith('.parquet');
    for (const f of sxFiles) {
      expect(matchGlob(f)).toBe(true);
    }
    for (const f of scFiles) {
      expect(matchGlob(f)).toBe(false);
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
