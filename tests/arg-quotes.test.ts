import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { stripOuterDoubleQuotes, stripArgQuotes } from '../数据管理/lib/arg-quotes.mjs';

// daily.mjs runPythonScript 依赖此剥离把历史 `"${path}"` 写法还原成裸路径再交给 spawnSync。
// 该不变量一旦回退（如有人误删剥离），所有带引号调用点会整片 Path.exists() 判 false 静默跳过，
// 故此处把契约钉死。配套 governance 闸「spawn 参数引号安全」禁止裸 spawn 照搬带引号写法。

describe('stripOuterDoubleQuotes（单参数剥离契约）', () => {
  it('首尾成对双引号 → 剥离（claims_detail --policy-dir 场景）', () => {
    expect(stripOuterDoubleQuotes('"/Users/x/warehouse/fact/policy/current"'))
      .toBe('/Users/x/warehouse/fact/policy/current');
  });
  it('裸路径（无引号）→ 原样返回（new_energy_claims 裸路径场景，no-op）', () => {
    expect(stripOuterDoubleQuotes('/Users/x/warehouse')).toBe('/Users/x/warehouse');
  });
  it('裸 flag → 原样返回（no-op）', () => {
    expect(stripOuterDoubleQuotes('--policy-dir')).toBe('--policy-dir');
    expect(stripOuterDoubleQuotes('-o')).toBe('-o');
    expect(stripOuterDoubleQuotes('replace_range')).toBe('replace_range');
  });
  it('含中文 / 空格的带引号路径 → 仅剥最外层，内部原样保留', () => {
    expect(stripOuterDoubleQuotes('"/Users/x/底层数据湖/warehouse/fact/policy/current"'))
      .toBe('/Users/x/底层数据湖/warehouse/fact/policy/current');
    expect(stripOuterDoubleQuotes('"/tmp/my data/_incoming.parquet"'))
      .toBe('/tmp/my data/_incoming.parquet');
  });
  it('只剥「最外层一对」，不贪婪剥内层引号', () => {
    expect(stripOuterDoubleQuotes('""quoted""')).toBe('"quoted"');
  });
  it('单边引号（首或尾缺）→ 原样返回（不误剥）', () => {
    expect(stripOuterDoubleQuotes('"/path/no-close')).toBe('"/path/no-close');
    expect(stripOuterDoubleQuotes('/path/no-open"')).toBe('/path/no-open"');
  });
  it('边界长度：空串 / 单个双引号 → 原样返回（长度 < 2 不剥）', () => {
    expect(stripOuterDoubleQuotes('')).toBe('');
    expect(stripOuterDoubleQuotes('"')).toBe('"');
  });
  it('恰好一对空引号 "" → 剥成空串（长度 = 2）', () => {
    expect(stripOuterDoubleQuotes('""')).toBe('');
  });
  it('非字符串入参 → String() 归一后判定（数字/无引号 → 原样字符串）', () => {
    expect(stripOuterDoubleQuotes(123)).toBe('123');
  });
  it('幂等性：已剥过的裸路径再剥仍是 no-op', () => {
    const once = stripOuterDoubleQuotes('"/a/b"');
    expect(stripOuterDoubleQuotes(once)).toBe(once);
  });
});

describe('stripArgQuotes（整组 argv 剥离）', () => {
  it('混合 flag + 带引号路径 → flag 不动、路径剥引号（claims_detail 真实 argv）', () => {
    const argv = [
      '--policy-dir', '"/Users/x/warehouse/fact/policy/current"',
      '-o', '"/tmp/_incoming.parquet"',
    ];
    expect(stripArgQuotes(argv)).toEqual([
      '--policy-dir', '/Users/x/warehouse/fact/policy/current',
      '-o', '/tmp/_incoming.parquet',
    ]);
  });
  it('partition_manager replace_range 子命令 argv → 仅路径被剥', () => {
    const argv = [
      'replace_range',
      '-i', '"/tmp/_incoming.parquet"', '-o', '"/data/claims_detail"',
      '--report-start', '2026-01-01',
      '--report-end', '2026-06-22',
    ];
    expect(stripArgQuotes(argv)).toEqual([
      'replace_range',
      '-i', '/tmp/_incoming.parquet', '-o', '/data/claims_detail',
      '--report-start', '2026-01-01',
      '--report-end', '2026-06-22',
    ]);
  });
  it('全裸路径 argv（new_energy_claims 修复后形态）→ 整组 no-op', () => {
    const argv = ['--policy-dir', '/Users/x/warehouse'];
    expect(stripArgQuotes(argv)).toEqual(argv);
  });
  it('空数组 → 空数组', () => {
    expect(stripArgQuotes([])).toEqual([]);
  });
});
