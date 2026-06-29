import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  parseRangePrefix,
  isRangeCovered,
  isCoveredBySameQualifier,
  findCoveredKeys,
} from '../数据管理/lib/range-coverage.mjs';

describe('parseRangePrefix（区间 + 品类解析）', () => {
  it('范围前缀 xlsx → {start,end,qualifier}（去扩展名）', () => {
    expect(parseRangePrefix('20250601-20260628_01_签单清单_定稿.xlsx'))
      .toEqual({ start: '20250601', end: '20260628', qualifier: '01_签单清单_定稿' });
  });
  it('带省前缀先剥离（sichuan_/shanxi_）', () => {
    expect(parseRangePrefix('sichuan_20250601-20260628_05_理赔明细.xlsx'))
      .toEqual({ start: '20250601', end: '20260628', qualifier: '05_理赔明细' });
  });
  it('🔴 parquet 与 xlsx 同内容 → 同 qualifier（跨层可比，去 .parquet/.xlsx）', () => {
    const x = parseRangePrefix('20250601-20260628_01_签单清单_定稿.xlsx');
    const p = parseRangePrefix('20250601-20260628_01_签单清单_定稿.parquet');
    expect(x.qualifier).toBe(p.qualifier);
  });
  it('legacy 每日数据_ / 无范围前缀 → null', () => {
    expect(parseRangePrefix('每日数据_20240101_20260409.xlsx')).toBeNull();
    expect(parseRangePrefix('01_签单清单_剔摩_24年至.xlsx')).toBeNull();
    expect(parseRangePrefix('02_理赔明细_报案时间20260101_20260413.xlsx')).toBeNull();
  });
  it('SX_ 码前缀（非拼音）不被 stripProvincePrefix 认 → null（SC 跑不误归 SX parquet）', () => {
    expect(parseRangePrefix('SX_20210101-20260617_01_签单清单_定稿.parquet')).toBeNull();
  });
  it('start>end 畸形区间 → null（闸-1 B3-03 防御）', () => {
    expect(parseRangePrefix('20261231-20260101_01_签单清单_定稿.xlsx')).toBeNull();
  });
  it('非字符串 → null', () => {
    expect(parseRangePrefix(null)).toBeNull();
    expect(parseRangePrefix(undefined)).toBeNull();
  });
});

describe('isRangeCovered', () => {
  it('窗口被全量覆盖 → true', () => {
    expect(isRangeCovered({ start: '20260614', end: '20260625' }, { start: '20250601', end: '20260628' })).toBe(true);
  });
  it('历史不重叠段不被覆盖 → false', () => {
    expect(isRangeCovered({ start: '20240101', end: '20250531' }, { start: '20250601', end: '20260628' })).toBe(false);
  });
  it('同区间 → true（含端点相等）', () => {
    expect(isRangeCovered({ start: '20250601', end: '20260628' }, { start: '20250601', end: '20260628' })).toBe(true);
  });
});

describe('isCoveredBySameQualifier', () => {
  it('同品类 + 覆盖 → true', () => {
    expect(isCoveredBySameQualifier(
      { start: '20250601', end: '20260531', qualifier: '01_签单清单_定稿' },
      { start: '20250601', end: '20260628', qualifier: '01_签单清单_定稿' })).toBe(true);
  });
  it('🔴 不同品类（剔摩 vs 限摩）即使覆盖 → false（B3-01 防数据丢失）', () => {
    expect(isCoveredBySameQualifier(
      { start: '20240101', end: '20260504', qualifier: '01_签单清单_剔摩' },
      { start: '20240101', end: '20260504', qualifier: '01_签单清单_限摩' })).toBe(false);
  });
  it('🔴 跨省前缀 + 跨扩展名同品类可比（sichuan_.xlsx 新全量覆盖无前缀 .parquet 旧碎片·B3 修 B1 遗漏核心）', () => {
    const newXlsx = parseRangePrefix('sichuan_20250601-20260628_01_签单清单_定稿.xlsx');
    const oldParquet = parseRangePrefix('20250601-20260531_01_签单清单_定稿.parquet');
    expect(isCoveredBySameQualifier(oldParquet, newXlsx)).toBe(true);
  });
  it('同品类同区间也算覆盖（premium parquet 层归档同区间旧 parquet 防双倍）', () => {
    const newXlsx = parseRangePrefix('sichuan_20250601-20260628_01_签单清单_定稿.xlsx');
    const oldSame = parseRangePrefix('20250601-20260628_01_签单清单_定稿.parquet');
    expect(isCoveredBySameQualifier(oldSame, newXlsx)).toBe(true);
  });
});

describe('findCoveredKeys（核心：区间覆盖 + 同品类互斥，闸-1 B3-01）', () => {
  const item = (key: string, start: string, end: string, qualifier = '01_签单清单_定稿') => ({ key, start, end, qualifier });

  it('窗口增量 + 旧全量被新全量覆盖归档，历史段保留', () => {
    const items = [
      item('full', '20250601', '20260628'),      // 新全量
      item('old', '20250601', '20260531'),        // 旧全量（同 start，被覆盖）
      item('window', '20260614', '20260625'),     // 窗口增量（跨 start，被覆盖）
      item('hist1', '20210101', '20231231'),      // 历史段（不被覆盖）
      item('hist2', '20240101', '20250531'),      // 历史段（不被覆盖）
    ];
    const covered = findCoveredKeys(items);
    expect(covered).toEqual(new Set(['old', 'window']));
  });

  it('🔴 同区间不同品类（剔摩/限摩多文件共存）都不归档（B3-01 最严重缺陷防护）', () => {
    const items = [
      item('剔摩', '20240101', '20260504', '01_签单清单_剔摩'),
      item('限摩', '20240101', '20260504', '01_签单清单_限摩'),
    ];
    expect(findCoveredKeys(items)).toEqual(new Set()); // 都保留
  });

  it('同区间同品类（前缀 vs 无前缀）留字典序最大', () => {
    const items = [
      item('sichuan_20250601-20260628_01_签单清单_定稿.xlsx', '20250601', '20260628'),
      item('20250601-20260628_01_签单清单_定稿.xlsx', '20250601', '20260628'),
    ];
    // 'sichuan_...' 字典序 > '2025...' → 保留 sichuan_，归档无前缀
    expect(findCoveredKeys(items)).toEqual(new Set(['20250601-20260628_01_签单清单_定稿.xlsx']));
  });

  it('传递覆盖 A⊆B⊆C → A,B 归档留 C', () => {
    const items = [
      item('A', '20260614', '20260620'),
      item('B', '20260601', '20260625'),
      item('C', '20250601', '20260628'),
    ];
    expect(findCoveredKeys(items)).toEqual(new Set(['A', 'B']));
  });

  it('空 / 单文件 → 空集合', () => {
    expect(findCoveredKeys([])).toEqual(new Set());
    expect(findCoveredKeys([item('solo', '20250601', '20260628')])).toEqual(new Set());
  });

  it('claims 真实场景：4 碎片 + 2 历史段 → 归档 3 个被全量覆盖碎片', () => {
    // current/ 现状碎片（连续不重叠）+ 新全量覆盖
    const items = [
      item('newfull', '20250601', '20260628'),
      item('frag1', '20250601', '20260531'),
      item('frag2', '20260601', '20260613'),
      item('frag3', '20260614', '20260625'),
      item('hist1', '20210101', '20231231'),
      item('hist2', '20240101', '20250531'),
    ];
    expect(findCoveredKeys(items)).toEqual(new Set(['frag1', 'frag2', 'frag3']));
  });
});
