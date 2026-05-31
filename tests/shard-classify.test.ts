import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { formatDate, extractDateRange, getShardType } from '../数据管理/lib/shard-classify.mjs';

describe('formatDate', () => {
  it('注入 Date 返回 YYYYMMDD（补零）', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('20260105'); // 月份 0-based → 01
    expect(formatDate(new Date(2026, 11, 31))).toBe('20261231');
  });
});

describe('extractDateRange', () => {
  it('新前缀单日格式 YYYYMMDD_NN_ → start==end', () => {
    expect(extractDateRange('20260426_01_签单清单.xlsx')).toEqual({ start: '20260426', end: '20260426' });
  });

  it('年段格式 NN-NN年 → 全年区间', () => {
    expect(extractDateRange('01_签单清单_21-23年.xlsx')).toEqual({ start: '20210101', end: '20231231' });
  });

  it('开放结束格式 NN年至 → end 取注入的 today', () => {
    expect(extractDateRange('01_签单清单_剔摩_24年至.xlsx', '20260531'))
      .toEqual({ start: '20240101', end: '20260531' });
  });

  it('增量格式 增量_YYYYMMDD → 单日', () => {
    expect(extractDateRange('01_签单清单_增量_20260411.xlsx')).toEqual({ start: '20260411', end: '20260411' });
  });

  it('显式日期范围 _YYYYMMDD_YYYYMMDD.xlsx', () => {
    expect(extractDateRange('01_签单清单_剔摩_20240101_20260504.xlsx'))
      .toEqual({ start: '20240101', end: '20260504' });
  });

  it('旧格式 每日数据_YYYYMMDD_YYYYMMDD', () => {
    expect(extractDateRange('每日数据_20240101_20260407.xlsx'))
      .toEqual({ start: '20240101', end: '20260407' });
  });

  it('无法识别 → null', () => {
    expect(extractDateRange('随便一个名字.xlsx')).toBeNull();
  });

  it('新前缀优先级高于显式日期范围', () => {
    // 同时含 YYYYMMDD_NN_ 前缀与尾部 _YYYYMMDD_YYYYMMDD：应命中前缀分支（单日）
    expect(extractDateRange('20260426_01_签单清单_20240101_20260504.xlsx'))
      .toEqual({ start: '20260426', end: '20260426' });
  });
});

describe('getShardType', () => {
  const config = { static_cutoff: '2024-12-31', weekly_start: '2025-01-01' };

  it('end <= static_cutoff → static', () => {
    expect(getShardType('01_签单清单_21-23年.xlsx', config)).toBe('static');
  });

  it('start === weekly_start → weekly', () => {
    expect(getShardType('每日数据_20250101_20260407.xlsx', config)).toBe('weekly');
  });

  it('增量文件强制 weekly（无视日期）', () => {
    expect(getShardType('01_签单清单_增量_20260411.xlsx', config)).toBe('weekly');
  });

  it('新前缀单日文件强制 weekly', () => {
    expect(getShardType('20260426_01_签单清单.xlsx', config)).toBe('weekly');
  });

  it('既非静态也非周起始 → daily', () => {
    expect(getShardType('每日数据_20250215_20260407.xlsx', config)).toBe('daily');
  });

  it('无法识别日期 → null', () => {
    expect(getShardType('随便一个名字.xlsx', config)).toBeNull();
  });
});
