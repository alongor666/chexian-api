/**
 * policy/current 重叠检测共享逻辑单测
 *
 * 锁定 detectPolicyCurrentOverlap 行为：
 * 1. 互补分片（剔摩↔限摩）时间重叠 → 0 overlap
 * 2. 裸名主分片 + 限摩（无配对剔摩） → 报告 overlap（2026-05-15 事故反模式）
 * 3. 三段不重叠主分片 → 0 overlap
 * 4. 不存在的目录 → skipped
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseDateRangeFromFilename,
  isComplementaryPair,
  detectPolicyCurrentOverlap,
  assertNoPolicyCurrentOverlap,
} from '../lib/parquet-overlap-check.mjs';

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'parquet-overlap-'));
  for (const name of files) writeFileSync(join(dir, name), '');
  return dir;
}

describe('parseDateRangeFromFilename', () => {
  it('解析标准命名 *_YYYYMMDD_YYYYMMDD.parquet', () => {
    expect(parseDateRangeFromFilename('01_签单清单_20240101_20260504.parquet'))
      .toEqual({ start: 20240101, end: 20260504 });
  });

  it('非标准命名（单日期）返回 null', () => {
    expect(parseDateRangeFromFilename('20260514_01_签单清单.parquet')).toBeNull();
  });

  it('非 parquet 后缀返回 null', () => {
    expect(parseDateRangeFromFilename('01_签单清单_20240101_20260504.xlsx')).toBeNull();
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

  it('目录不存在 → skipped', () => {
    const r = detectPolicyCurrentOverlap('/nonexistent/path/xxx');
    expect(r.skipped).toBe(true);
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
