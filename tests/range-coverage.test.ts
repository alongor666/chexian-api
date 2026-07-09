import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  parseRangePrefix,
  isRangeCovered,
  isCoveredBySameQualifier,
  findCoveredKeys,
  findPartialOverlapPairs,
  findSupersededOldWeeklyFiles,
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

describe('findPartialOverlapPairs（部分重叠——谁都不完全包含谁，2026-07-06 上游窗口前移实测）', () => {
  const item = (key: string, start: string, end: string, qualifier = '01_签单清单_定稿') => ({ key, start, end, qualifier });

  it('🔴 复现事故：老窗口 25-06-01~26-06-28 与新窗口 26-06-01~26-07-05 → 部分重叠一对', () => {
    const items = [
      item('old', '20250601', '20260628'),
      item('new', '20260601', '20260705'),
    ];
    const pairs = findPartialOverlapPairs(items);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.key).toBe('old'); // a.start <= b.start
    expect(pairs[0].b.key).toBe('new');
  });

  it('完全覆盖不算部分重叠（交给 findCoveredKeys 处理，本函数不重复报告）', () => {
    const items = [
      item('window', '20260614', '20260625'),
      item('full', '20250601', '20260628'),
    ];
    expect(findPartialOverlapPairs(items)).toEqual([]);
  });

  it('不同品类（剔摩/限摩）即使日期重叠也不算部分重叠（B3-01 同款防护）', () => {
    const items = [
      item('剔摩', '20250601', '20260628', '01_签单清单_剔摩'),
      item('限摩', '20260601', '20260705', '01_签单清单_限摩'),
    ];
    expect(findPartialOverlapPairs(items)).toEqual([]);
  });

  it('历史不重叠分段（互不相交）→ 不算重叠', () => {
    const items = [item('hist1', '20210101', '20231231'), item('hist2', '20240101', '20250531')];
    expect(findPartialOverlapPairs(items)).toEqual([]);
  });

  it('三文件场景：A↔B 两两独立部分重叠，即使各自也被 C 完全覆盖（判定按 pair 独立，不看第三方）', () => {
    const items = [
      item('A', '20250601', '20260331'),   // 与 B 部分重叠（起点更早，终点更早）
      item('B', '20260101', '20260628'),   // 与 A 重叠；单独看也被 C 完全覆盖
      item('C', '20250101', '20260930'),   // 完全覆盖 A 和 B（真实链路里 findCoveredKeys 会先把两者都归档）
    ];
    const pairs = findPartialOverlapPairs(items);
    // A↔C、B↔C 是完全覆盖关系（isRangeCovered 短路跳过）；只剩 A↔B 这一对部分重叠
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.key).toBe('A');
    expect(pairs[0].b.key).toBe('B');
  });

  it('单文件 / 空数组 → 空结果', () => {
    expect(findPartialOverlapPairs([])).toEqual([]);
    expect(findPartialOverlapPairs([item('solo', '20250601', '20260628')])).toEqual([]);
  });
});

describe('findSupersededOldWeeklyFiles（旧格式周更 parquet 覆盖归档，2026-07-09 山西数据晋升事故复现）', () => {
  it('🔴 复现事故：同起点新文件覆盖旧文件（旧逻辑靠全局 weeklyStart 配置比较，配置漂移致永不匹配）', () => {
    // 山西/四川实况：滚动窗口起点均为 20250601，与 shard-config.json 的
    // weekly_start=2024-01-01 早已不一致——本函数改用「本次转换文件的实际区间」
    // 判定覆盖关系，不依赖该全局配置。
    const existing = [
      '20210101-20250531_01_签单清单_定稿.parquet', // 静态分片，范围前缀命名，不受影响
      '每日数据_20250601_20260707.parquet',          // 昨天的旧滚动文件（应被归档）
      '每日数据_20250601_20260708.parquet',          // 今天刚产出的输出文件本身（排除）
    ];
    const incoming = { start: '20250601', end: '20260708' };
    const result = findSupersededOldWeeklyFiles(existing, incoming, '每日数据_20250601_20260708.parquet');
    expect(result).toEqual(['每日数据_20250601_20260707.parquet']);
  });

  it('端点相等（内容重转但日期范围不变）也判定覆盖', () => {
    const existing = ['每日数据_20250601_20260707.parquet'];
    const incoming = { start: '20250601', end: '20260707' };
    // 注意：真实调用方会用 outputName 排除掉与 incoming 同名的文件；
    // 这里刻意验证「未被排除时」的覆盖判定本身仍然成立（同区间 = 覆盖）。
    expect(findSupersededOldWeeklyFiles(existing, incoming, '__不存在__.parquet')).toEqual(['每日数据_20250601_20260707.parquet']);
  });

  it('不同起点、且不被本次区间覆盖 → 不归档（历史不重叠分段保留）', () => {
    const existing = ['每日数据_20240101_20250531.parquet'];
    const incoming = { start: '20250601', end: '20260708' };
    expect(findSupersededOldWeeklyFiles(existing, incoming, '每日数据_20250601_20260708.parquet')).toEqual([]);
  });

  it('新格式范围前缀文件（连字符命名）不被本函数误判（各管各的，OLD_WEEKLY_RE 不匹配）', () => {
    const existing = ['20250601-20260628_01_签单清单_定稿.parquet'];
    const incoming = { start: '20250601', end: '20260708' };
    expect(findSupersededOldWeeklyFiles(existing, incoming, '每日数据_20250601_20260708.parquet')).toEqual([]);
  });

  it('非 .parquet 文件 / 非"每日数据_"前缀文件不参与判定', () => {
    const existing = ['dim_summary_SX.json', '.sx-promote-ready'];
    const incoming = { start: '20250601', end: '20260708' };
    expect(findSupersededOldWeeklyFiles(existing, incoming, '每日数据_20250601_20260708.parquet')).toEqual([]);
  });

  it('空现有文件列表 → 空结果', () => {
    expect(findSupersededOldWeeklyFiles([], { start: '20250601', end: '20260708' }, '每日数据_20250601_20260708.parquet')).toEqual([]);
  });
});
