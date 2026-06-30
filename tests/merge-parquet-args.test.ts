import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { buildMergeParquetArgs } from '../数据管理/lib/merge-parquet-args.mjs';

// Bug 1 回归：runStrategyMultiMerge 原内联引用未定义的 BRANCH_CODE → ReferenceError，
// 任何多分片合并域（SC repair_resource 39 分片）在 merge 步骤崩溃。本测试钉死 branchCode 透传：
// args 必须含 `--declared-branch "<省码>"`，且 SC 默认链路也透传 'SC'。
describe('buildMergeParquetArgs（merge_parquet.py 参数透传契约）', () => {
  const base = {
    mergeInputs: ['/w/a.parquet', '/w/b.parquet'],
    tmpOutput: '/w/repair/latest.parquet.tmp',
    mergeDedupKey: 'repair_shop_name',
    mergeOrderBy: 'report_date DESC NULLS LAST',
  };

  it('透传 SX：--declared-branch "SX"（多省隔离防线）', () => {
    const args = buildMergeParquetArgs({ ...base, branchCode: 'SX' });
    const i = args.indexOf('--declared-branch');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('"SX"');
  });

  it('SC 默认链路也透传 "SC"（strictNonNull/assertDeclaredBranch 同样守卫）', () => {
    const args = buildMergeParquetArgs({ ...base, branchCode: 'SC' });
    expect(args[args.indexOf('--declared-branch') + 1]).toBe('"SC"');
  });

  it('branchCode 缺省 / 空 → 归 "SC"（runStrategyMultiMerge 解构默认值兜底）', () => {
    expect(buildMergeParquetArgs({ ...base }).slice(-1)[0]).toBe('"SC"');
    expect(buildMergeParquetArgs({ ...base, branchCode: '' }).slice(-1)[0]).toBe('"SC"');
    expect(buildMergeParquetArgs({ ...base, branchCode: undefined }).slice(-1)[0]).toBe('"SC"');
  });

  it('完整参数序列与既有内联写法逐字节一致（值带外层双引号，由 stripArgQuotes 剥离）', () => {
    const args = buildMergeParquetArgs({ ...base, branchCode: 'SC' });
    expect(args).toEqual([
      '-i', '"/w/a.parquet"', '"/w/b.parquet"',
      '-o', '"/w/repair/latest.parquet.tmp"',
      '--dedup-key', '"repair_shop_name"',
      '--order-by', '"report_date DESC NULLS LAST"',
      '--declared-branch', '"SC"',
    ]);
  });

  it('mergeInputs 含历史 latest（merge_with_history 场景）也正确加引号', () => {
    const args = buildMergeParquetArgs({
      ...base,
      mergeInputs: ['/w/repair/latest.parquet', '/w/a.parquet'],
      branchCode: 'SC',
    });
    expect(args.slice(0, 4)).toEqual(['-i', '"/w/repair/latest.parquet"', '"/w/a.parquet"', '-o']);
  });

  it('mergeInputs 为空 → 抛错（防静默合成缺数据产物）', () => {
    expect(() => buildMergeParquetArgs({ ...base, mergeInputs: [] })).toThrow();
  });

  it('mergeDedupKey / mergeOrderBy 缺失 → 抛错（PR #861 MEDIUM：防 "undefined" 字面量传 Python）', () => {
    expect(() => buildMergeParquetArgs({ ...base, mergeDedupKey: undefined })).toThrow();
    expect(() => buildMergeParquetArgs({ ...base, mergeDedupKey: '' })).toThrow();
    expect(() => buildMergeParquetArgs({ ...base, mergeOrderBy: undefined })).toThrow();
    expect(() => buildMergeParquetArgs({ ...base, mergeOrderBy: '' })).toThrow();
  });
});
