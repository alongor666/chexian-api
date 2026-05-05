/**
 * DataBootstrapper.allComplementary — 互补分片豁免规则
 *
 * 锁定 deduplicateOverlapping 在 startDate 相同的剔摩/限摩对上不去重。
 * 与 scripts/check-governance.mjs:checkParquetOverlapInCurrent 保持一致。
 */
import { describe, it, expect } from 'vitest';
import { DataBootstrapper } from '../data-bootstrapper.js';

describe('DataBootstrapper.allComplementary', () => {
  it('剔摩 + 限摩 → 互补，true', () => {
    const names = [
      '01_签单清单_剔摩_20240101_20260504.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet',
    ];
    expect(DataBootstrapper.allComplementary(names)).toBe(true);
  });

  it('两个剔摩 → 非互补，false', () => {
    const names = [
      '01_签单清单_剔摩_20240101_20260504.parquet',
      '01_签单清单_剔摩_20240101_20260505.parquet',
    ];
    expect(DataBootstrapper.allComplementary(names)).toBe(false);
  });

  it('单个文件 → false（无需豁免）', () => {
    expect(DataBootstrapper.allComplementary(['01_签单清单_剔摩_20240101_20260504.parquet'])).toBe(false);
  });

  it('空数组 → false', () => {
    expect(DataBootstrapper.allComplementary([])).toBe(false);
  });

  it('剔摩 + 限摩 + 全量（不带摩字符）三个 → 非全互补，false', () => {
    const names = [
      '01_签单清单_剔摩_20240101_20260504.parquet',
      '01_签单清单_限摩_20240101_20260504.parquet',
      '01_签单清单_全量_20240101_20260504.parquet',
    ];
    expect(DataBootstrapper.allComplementary(names)).toBe(false);
  });

  it('限摩 + 剔摩 顺序反转 → 仍互补，true', () => {
    const names = [
      '01_签单清单_限摩_20240101_20260504.parquet',
      '01_签单清单_剔摩_20240101_20260504.parquet',
    ];
    expect(DataBootstrapper.allComplementary(names)).toBe(true);
  });
});
