/**
 * 多省 ETL 质量报告路径隔离单测（P2 681eee）
 *
 * 锁定：
 * - SC（四川/默认）：质量报告写 ./数据分析报告/转换质量报告.json（现状，字节安全）
 * - 非 SC 省（如 SX）：质量报告写 ./数据分析报告/<省>/转换质量报告.json（隔离，不覆盖四川报告）
 * - 空/undefined branchCode 等价于 SC（向后兼容）
 *
 * 防回归：SX 路径不得落入 SC 默认路径（否则多省常态化会覆盖四川质量报告）。
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { branchQualityReportPath } from '../数据管理/lib/branch-naming.mjs';

const BASE = './数据分析报告';
const FILENAME = '转换质量报告.json';

describe('branchQualityReportPath — SC 字节安全', () => {
  it('SC → 默认路径（与历史行为字节相同）', () => {
    expect(branchQualityReportPath(BASE, 'SC')).toBe(join(BASE, FILENAME));
  });

  it('undefined → 默认路径（向后兼容）', () => {
    expect(branchQualityReportPath(BASE, undefined)).toBe(join(BASE, FILENAME));
  });

  it('空字符串 → 默认路径（向后兼容）', () => {
    expect(branchQualityReportPath(BASE, '')).toBe(join(BASE, FILENAME));
  });
});

describe('branchQualityReportPath — 非 SC 省路径隔离', () => {
  it('SX → 隔离子目录 SX/', () => {
    expect(branchQualityReportPath(BASE, 'SX')).toBe(join(BASE, 'SX', FILENAME));
  });

  it('SX 路径不得落入 SC 默认路径（防覆盖四川报告）', () => {
    const sxPath = branchQualityReportPath(BASE, 'SX');
    const scPath = branchQualityReportPath(BASE, 'SC');
    expect(sxPath).not.toBe(scPath);
  });

  it('其他省份（如 GD）同样隔离', () => {
    expect(branchQualityReportPath(BASE, 'GD')).toBe(join(BASE, 'GD', FILENAME));
    expect(branchQualityReportPath(BASE, 'GD')).not.toBe(join(BASE, FILENAME));
  });

  it('绝对路径基目录同样生效', () => {
    const absBase = '/data/数据分析报告';
    expect(branchQualityReportPath(absBase, 'SX')).toBe(join(absBase, 'SX', FILENAME));
    expect(branchQualityReportPath(absBase, 'SC')).toBe(join(absBase, FILENAME));
  });
});
