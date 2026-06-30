import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  PROVINCE_FILENAME_PREFIX_TO_CODE,
  provinceCodeFromFilename,
  stripProvincePrefix,
  fileBelongsToBranch,
  buildBranchAwareGlobs,
  registeredBranchCodesFromPrefixMap,
  collectBranchAwareFiles,
} from '../数据管理/lib/source-file-routing.mjs';
// @ts-expect-error — 纯 JS 模块
import { extractDateRange, getShardType } from '../数据管理/lib/shard-classify.mjs';

describe('provinceCodeFromFilename（拼音前缀→branch_code）', () => {
  it('sichuan_ 前缀 → SC', () => {
    expect(provinceCodeFromFilename('sichuan_20250601-20260628_05_理赔明细.xlsx')).toBe('SC');
  });
  it('shanxi_ 前缀 → SX', () => {
    expect(provinceCodeFromFilename('shanxi_20250601-20260628_01_签单清单_定稿.xlsx')).toBe('SX');
  });
  it('无省前缀（范围日期开头）→ null（归当前省，向后兼容）', () => {
    expect(provinceCodeFromFilename('20250601-20260531_01_签单清单_定稿.xlsx')).toBeNull();
  });
  it('legacy 每日数据_ → null', () => {
    expect(provinceCodeFromFilename('每日数据_20240101_20260409.xlsx')).toBeNull();
  });
  it('FineBI 残留 01_签单清单_定稿_YYYYMMDD → null（闸-1 P1-1：不误判为省前缀）', () => {
    expect(provinceCodeFromFilename('01_签单清单_定稿_20260608.xlsx')).toBeNull();
    expect(provinceCodeFromFilename('05_理赔明细_20260608.xlsx')).toBeNull();
  });
  it('大小写不敏感 Sichuan_/SHANXI_ → 对应码（闸-1 P1-3）', () => {
    expect(provinceCodeFromFilename('Sichuan_20250601-20260628_01_签单清单_定稿.xlsx')).toBe('SC');
    expect(provinceCodeFromFilename('SHANXI_20250601-20260628_05_理赔明细.xlsx')).toBe('SX');
  });
  it('未知字母前缀 foo_ → null（glob 不生成此前缀，天然不被发现）', () => {
    expect(provinceCodeFromFilename('foo_20250601-20260628_01_签单清单_定稿.xlsx')).toBeNull();
  });
  it('非字符串 → null', () => {
    expect(provinceCodeFromFilename(null)).toBeNull();
    expect(provinceCodeFromFilename(undefined)).toBeNull();
  });
});

describe('stripProvincePrefix', () => {
  it('剥离 sichuan_ 前缀', () => {
    expect(stripProvincePrefix('sichuan_20250601-20260628_05_理赔明细.xlsx')).toBe('20250601-20260628_05_理赔明细.xlsx');
  });
  it('无前缀原样返回', () => {
    expect(stripProvincePrefix('20250601-20260531_01_签单清单_定稿.xlsx')).toBe('20250601-20260531_01_签单清单_定稿.xlsx');
  });
  it('大小写不敏感剥离', () => {
    expect(stripProvincePrefix('SHANXI_20250601-20260628_05_理赔明细.xlsx')).toBe('20250601-20260628_05_理赔明细.xlsx');
  });
  it('幂等：strip(strip(x)) === strip(x)', () => {
    const x = 'sichuan_20250601-20260628_01_签单清单_定稿.xlsx';
    expect(stripProvincePrefix(stripProvincePrefix(x))).toBe(stripProvincePrefix(x));
  });
  it('带省前缀的 FineBI 残留 strip 后命中 daily.mjs FineBI 过滤正则（闸-2 P2-B）', () => {
    // daily.mjs premium 用 /^01_签单清单_定稿_\d{8}/.test(stripProvincePrefix(name)) 跳过 FineBI 残留；
    // 验证带省前缀的残留（sichuan_01_签单清单_定稿_YYYYMMDD）剥离后同样命中、不漏过
    const stripped = stripProvincePrefix('sichuan_01_签单清单_定稿_20260608.xlsx');
    expect(stripped).toBe('01_签单清单_定稿_20260608.xlsx');
    expect(/^01_签单清单_定稿_\d{8}/.test(stripped)).toBe(true);
  });
});

describe('fileBelongsToBranch（防混省过滤，闸-1 P0-1/P1-4）', () => {
  it('本省前缀文件归本省', () => {
    expect(fileBelongsToBranch('sichuan_20250601-20260628_05_理赔明细.xlsx', 'SC')).toBe(true);
    expect(fileBelongsToBranch('shanxi_20250601-20260628_05_理赔明细.xlsx', 'SX')).toBe(true);
  });
  it('🔴 他省前缀文件被过滤（核心防混省）', () => {
    expect(fileBelongsToBranch('shanxi_20250601-20260628_05_理赔明细.xlsx', 'SC')).toBe(false);
    expect(fileBelongsToBranch('sichuan_20250601-20260628_05_理赔明细.xlsx', 'SX')).toBe(false);
  });
  it('无前缀文件归当前省（向后兼容 SC + SX）', () => {
    expect(fileBelongsToBranch('20250601-20260531_01_签单清单_定稿.xlsx', 'SC')).toBe(true);
    expect(fileBelongsToBranch('20250601-20260531_01_签单清单_定稿.xlsx', 'SX')).toBe(true);
  });
  it("'' / undefined 归四川（SC，对称处理 P1-4）", () => {
    expect(fileBelongsToBranch('shanxi_x_05_理赔明细.xlsx', '')).toBe(false);
    expect(fileBelongsToBranch('shanxi_x_05_理赔明细.xlsx', undefined)).toBe(false);
    expect(fileBelongsToBranch('sichuan_x_05_理赔明细.xlsx', undefined)).toBe(true);
    expect(fileBelongsToBranch('20250601-20260531_x.xlsx', '')).toBe(true);
  });
});

describe('buildBranchAwareGlobs（前缀感知 glob 扩展）', () => {
  it('扩展为「无前缀 + 各省前缀」', () => {
    const globs = buildBranchAwareGlobs('????????-????????_01_签单清单*.xlsx');
    expect(globs).toContain('????????-????????_01_签单清单*.xlsx');
    expect(globs).toContain('sichuan_????????-????????_01_签单清单*.xlsx');
    expect(globs).toContain('shanxi_????????-????????_01_签单清单*.xlsx');
    expect(globs).toHaveLength(1 + registeredBranchCodesFromPrefixMap().length);
  });
  it('🔴 幂等守卫（PR #861 HIGH）：已含省前缀的 glob 不二次扩展（防 sichuan_sichuan_*）', () => {
    expect(buildBranchAwareGlobs('sichuan_07_维修资源*.xlsx')).toEqual(['sichuan_07_维修资源*.xlsx']);
    expect(buildBranchAwareGlobs('shanxi_????????-????????_03_维修资源*.xlsx'))
      .toEqual(['shanxi_????????-????????_03_维修资源*.xlsx']);
  });
  it('大小写不敏感前缀同样不二次扩展（防上游 Sichuan_/SHANXI_ 命名）', () => {
    expect(buildBranchAwareGlobs('Sichuan_07_维修资源*.xlsx')).toEqual(['Sichuan_07_维修资源*.xlsx']);
  });
});

describe('唯一事实源一致性（闸-1 P2-1）', () => {
  it('拼音 map 值 ⊆ {SC,SX}（须与 fields.json branch_code.derivation.mapping 同步）', () => {
    const codes = [...new Set(Object.values(PROVINCE_FILENAME_PREFIX_TO_CODE))].sort();
    expect(codes).toEqual(['SC', 'SX']);
  });
});

describe('shard-classify 前缀感知集成（闸-1 P0-2：带前缀文件不再 process.exit(1)）', () => {
  const config = { static_cutoff: '2025-05-31', weekly_start: '2025-06-01' };
  it('带 sichuan_ 前缀全量：extractDateRange 正确提取', () => {
    expect(extractDateRange('sichuan_20250601-20260628_05_理赔明细.xlsx')).toEqual({ start: '20250601', end: '20260628' });
  });
  it('带 shanxi_ 前缀全量：extractDateRange 正确提取', () => {
    expect(extractDateRange('shanxi_20250601-20260628_01_签单清单_定稿.xlsx')).toEqual({ start: '20250601', end: '20260628' });
  });
  it('带前缀窗口增量：日期正确（B1 识别为窗口区间）', () => {
    expect(extractDateRange('sichuan_20260614-20260625_01_签单清单_定稿.xlsx')).toEqual({ start: '20260614', end: '20260625' });
  });
  it('🔴 带前缀文件 getShardType 非 null（修复前 null → unrecognized → ETL 中止）', () => {
    expect(getShardType('sichuan_20250601-20260628_01_签单清单_定稿.xlsx', config)).not.toBeNull();
    expect(getShardType('shanxi_20250601-20260628_01_签单清单_定稿.xlsx', config)).not.toBeNull();
  });
  it('带前缀全量（end > cutoff）归 weekly（输出 current/ 多文件共存）', () => {
    expect(getShardType('sichuan_20250601-20260628_01_签单清单_定稿.xlsx', config)).toBe('weekly');
  });
  it('无前缀文件行为不变（向后兼容）', () => {
    expect(extractDateRange('20250601-20260531_01_签单清单_定稿.xlsx')).toEqual({ start: '20250601', end: '20260531' });
    expect(getShardType('20250601-20260531_01_签单清单_定稿.xlsx', config)).toBe('weekly');
  });
});

describe('collectBranchAwareFiles（Bug 2：标准域省前缀扩展 + 防混省过滤）', () => {
  // 模拟磁盘：repair 域源根混放无前缀 + sichuan_ + shanxi_ 三态文件。
  const disk: Record<string, string[]> = {
    '????????-????????_03_维修资源*.xlsx': ['20250601-20260628_03_维修资源.xlsx'],
    'sichuan_????????-????????_03_维修资源*.xlsx': ['sichuan_20250601-20260628_03_维修资源.xlsx'],
    'shanxi_????????-????????_03_维修资源*.xlsx': ['shanxi_20250601-20260628_03_维修资源.xlsx'],
  };
  // lsFn 注入：按 glob 精确返回（pattern → 文件名列表 → {name, path}）。
  const makeLs = (d: Record<string, string[]>) =>
    (pattern: string, dir: string) =>
      (d[pattern] || []).map((name) => ({ name, path: `${dir}/${name}` }));
  const GLOBS = ['????????-????????_03_维修资源*.xlsx'];

  it('🔴 SC：发现无前缀 + sichuan_ 新命名文件，剔除 shanxi_（修复前只匹配无前缀，漏 sichuan_ 新文件）', () => {
    const { all } = collectBranchAwareFiles(GLOBS, '/src', 'SC', makeLs(disk));
    const names = all.map((f) => f.name).sort();
    expect(names).toEqual([
      '20250601-20260628_03_维修资源.xlsx',
      'sichuan_20250601-20260628_03_维修资源.xlsx',
    ]);
  });

  it('🔴 SX：发现 shanxi_ 文件（修复前 SX repair 报"未找到源"跳过），剔除 sichuan_，无前缀归本省', () => {
    const { all } = collectBranchAwareFiles(GLOBS, '/src', 'SX', makeLs(disk));
    const names = all.map((f) => f.name).sort();
    expect(names).toEqual([
      '20250601-20260628_03_维修资源.xlsx',
      'shanxi_20250601-20260628_03_维修资源.xlsx',
    ]);
  });

  it('groups[i].glob 保留未扩展的声明 glob（供 full_batch 错误回显声明口径）', () => {
    const { groups } = collectBranchAwareFiles(GLOBS, '/src', 'SC', makeLs(disk));
    expect(groups[0].glob).toBe('????????-????????_03_维修资源*.xlsx');
  });

  it('跨 glob 按 path 去重（同一文件被多个声明 glob 命中只计一次）', () => {
    const lsFn = (_p: string, dir: string) => [{ name: 'dup.xlsx', path: `${dir}/dup.xlsx` }];
    const { all } = collectBranchAwareFiles(['07_维修资源*.xlsx', '03_维修资源*.xlsx'], '/src', 'SC', lsFn);
    expect(all).toHaveLength(1);
  });

  it('空 branchCode / undefined 归四川（向后兼容，剔除 shanxi_）', () => {
    const { all } = collectBranchAwareFiles(GLOBS, '/src', '', makeLs(disk));
    expect(all.map((f) => f.name)).not.toContain('shanxi_20250601-20260628_03_维修资源.xlsx');
    expect(all.map((f) => f.name)).toContain('sichuan_20250601-20260628_03_维修资源.xlsx');
  });
});
