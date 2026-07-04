import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  REQUIRED_REPORT_CODES,
  MIN_SIZE_MB_BY_CODE,
  beijingDayOf,
  evaluateManifestReports,
  routeBranchCode,
  derivePolicyProvince,
  planCoverageArchive,
} from '../数据管理/lib/bi-export-pull.mjs';

const TODAY = '2026-07-04';

function report(code: string, overrides: Record<string, unknown> = {}) {
  const base: Record<string, Record<string, unknown>> = {
    '01': { file: 'shanxi_20250601-20260703_01_签单清单_定稿.xlsx', sizeBytes: 72878075, sizeMB: 69.5 },
    '02': { file: 'shanxi_20260703_02_报价清单_商业险.xlsx', sizeBytes: 4546281, sizeMB: 4.3 },
    '03': { file: 'shanxi_20250601-20260703_03_维修资源.xlsx', sizeBytes: 6900906, sizeMB: 6.6 },
    '04': { file: '20260704_04_厂牌明细.xlsx', sizeBytes: 40934154, sizeMB: 39 },
    '05': { file: 'shanxi_20250601-20260703_05_理赔明细_报案时间.xlsx', sizeBytes: 12681080, sizeMB: 12.1 },
  };
  return {
    code,
    reportName: `${code}_报表`,
    // 2026-07-03T22:18Z = 北京 2026-07-04 06:18（跨日边界：UTC 昨天 = 北京今天）
    mtime: '2026-07-03T22:18:59.050Z',
    ...base[code],
    ...overrides,
  };
}

function manifestOf(reports: unknown[]) {
  return { schema: 'sinosafe-bi-export/manifest@1', reports };
}

function statsFor(reports: Array<{ file: string; sizeBytes: number }>) {
  return Object.fromEntries(reports.map((r) => [r.file, { size: r.sizeBytes }]));
}

function fullBatch() {
  return REQUIRED_REPORT_CODES.map((c: string) => report(c));
}

describe('beijingDayOf（新鲜度判定必须换算北京时区，本机时钟不可信）', () => {
  it('UTC 昨天深夜 = 北京今天（22:18Z → +8 = 次日 06:18）', () => {
    expect(beijingDayOf('2026-07-03T22:18:59.050Z')).toBe('2026-07-04');
  });
  it('UTC 当天下午 = 北京同日晚间', () => {
    expect(beijingDayOf('2026-07-04T02:31:14.395Z')).toBe('2026-07-04');
  });
  it('北京时区边界前一秒仍是前一天', () => {
    expect(beijingDayOf('2026-07-03T15:59:59Z')).toBe('2026-07-03');
    expect(beijingDayOf('2026-07-03T16:00:00Z')).toBe('2026-07-04');
  });
  it('无效时间返回 null', () => {
    expect(beijingDayOf('not-a-date')).toBeNull();
  });
});

describe('evaluateManifestReports（断线兜底：缺 code / 旧 mtime / 字节不齐 / 空表）', () => {
  it('五张齐全 + 今天 + 字节一致 → ok', () => {
    const reports = fullBatch();
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.reports.map((x: { code: string }) => x.code)).toEqual([...REQUIRED_REPORT_CODES]);
  });

  it('🔴 缺 code 02 → error（禁止默默用旧数据）', () => {
    const reports = fullBatch().filter((r) => r.code !== '02');
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i: { code: string | null }) => i.code === '02')).toBe(true);
  });

  it('🔴 mtime 停在北京昨天 → error', () => {
    const reports = fullBatch();
    reports[1] = report('02', { mtime: '2026-07-03T02:31:14Z' }); // 北京 07-03
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i: { code: string | null }) => i.code === '02')?.message).toContain('不是北京时间今天');
  });

  it('🔴 本地字节数 ≠ manifest（传输不完整）→ error', () => {
    const reports = fullBatch();
    const stats = statsFor(reports);
    stats[reports[0].file] = { size: 1234 };
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: stats });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i: { code: string | null }) => i.code === '01')?.message).toContain('字节数不一致');
  });

  it('🔴 本地文件缺失 → error 且不进入分发列表', () => {
    const reports = fullBatch();
    const stats = statsFor(reports);
    delete stats[reports[4].file];
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: stats });
    expect(r.ok).toBe(false);
    expect(r.reports.map((x: { code: string }) => x.code)).not.toContain('05');
  });

  it('🔴 sizeMB 低于下限 → 疑似空表 error', () => {
    const reports = fullBatch();
    reports[0] = report('01', { sizeMB: MIN_SIZE_MB_BY_CODE['01'] - 1 });
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i: { code: string | null }) => i.code === '01')?.message).toContain('疑似空表');
  });

  it('schema 前缀不符 → error', () => {
    const reports = fullBatch();
    const r = evaluateManifestReports(
      { schema: 'other/manifest@9', reports },
      { todayBeijing: TODAY, statByName: statsFor(reports) },
    );
    expect(r.ok).toBe(false);
  });

  it('manifest 缺 reports 数组 → error 不抛异常', () => {
    const r = evaluateManifestReports({}, { todayBeijing: TODAY, statByName: {} });
    expect(r.ok).toBe(false);
    expect(r.reports).toEqual([]);
  });
});

describe('routeBranchCode（前缀→省份路由；前缀只是路由键，权威判据是内容核验）', () => {
  it('shanxi_ → SX', () => {
    expect(routeBranchCode('shanxi_20250601-20260703_01_签单清单_定稿.xlsx')).toBe('SX');
  });
  it('sichuan_ → SC', () => {
    expect(routeBranchCode('sichuan_20250601-20260703_01_签单清单_定稿.xlsx')).toBe('SC');
  });
  it('无前缀（04 厂牌全国口径）→ SC 默认根目录', () => {
    expect(routeBranchCode('20260704_04_厂牌明细.xlsx')).toBe('SC');
  });
});

describe('derivePolicyProvince（保单号前缀内容核验，防换账号没改配置的错配）', () => {
  const MAPPING = { '610': 'SC', '618': 'SX' };

  it('全部 618 → SX 一致', () => {
    const v = derivePolicyProvince(['6180401030120240002381', '6180500000000000000001'], MAPPING, 3);
    expect(v).toMatchObject({ code: 'SX', consistent: true, sampled: 2 });
  });
  it('🔴 混省（610+618 并存）→ 不一致', () => {
    const v = derivePolicyProvince(['6181111', '6102222'], MAPPING, 3);
    expect(v.consistent).toBe(false);
    expect(v.code).toBeNull();
  });
  it('🔴 未知前缀 → 不一致（fail-closed，未注册省禁静默回落）', () => {
    const v = derivePolicyProvince(['9991111', '6181111'], MAPPING, 3);
    expect(v.consistent).toBe(false);
    expect(v.unknownPrefixes['999']).toBe(1);
  });
  it('空样本 → 不一致', () => {
    expect(derivePolicyProvince([], MAPPING, 3).consistent).toBe(false);
  });
});

describe('planCoverageArchive（分发层覆盖归档：同品类才互斥）', () => {
  it('新长窗覆盖旧短窗（同品类）→ 归档旧文件', () => {
    const plan = planCoverageArchive('shanxi_20250601-20260703_01_签单清单_定稿.xlsx', [
      'shanxi_20250601-20260628_01_签单清单_定稿.xlsx',
    ]);
    expect(plan.archive).toEqual(['shanxi_20250601-20260628_01_签单清单_定稿.xlsx']);
    expect(plan.incomingRedundant).toBe(false);
  });

  it('🔴 不同品类不互斥（05_理赔明细_报案时间 vs 05_理赔明细 交给 daily.mjs 的 claims 归档护栏）', () => {
    const plan = planCoverageArchive('shanxi_20250601-20260703_05_理赔明细_报案时间.xlsx', [
      'shanxi_20250601-20260628_05_理赔明细.xlsx',
    ]);
    expect(plan.archive).toEqual([]);
  });

  it('历史不重叠分段保留（20210101-20260623 不被 20250601-20260703 覆盖）', () => {
    const plan = planCoverageArchive('shanxi_20250601-20260703_05_理赔明细_报案时间.xlsx', [
      '20210101-20260623_02_理赔明细.xlsx',
    ]);
    expect(plan.archive).toEqual([]);
  });

  it('单日命名（02 报价）非范围前缀 → 永不归档，逐日累积', () => {
    const plan = planCoverageArchive('shanxi_20260704_02_报价清单_商业险.xlsx', [
      'shanxi_20260703_02_报价清单_商业险.xlsx',
      '04_报价清单_商业险_20251201-20260617.xlsx',
    ]);
    expect(plan.archive).toEqual([]);
    expect(plan.incomingRedundant).toBe(false);
  });

  it('目录已有同区间同品类且字典序更大 → incoming 冗余不落盘', () => {
    const plan = planCoverageArchive('20250601-20260703_03_维修资源.xlsx', [
      'shanxi_20250601-20260703_03_维修资源.xlsx',
    ]);
    expect(plan.incomingRedundant).toBe(true);
  });

  it('维修资源系列：新长窗归档旧短窗（merge 域源文件减负）', () => {
    const plan = planCoverageArchive('shanxi_20250601-20260703_03_维修资源.xlsx', [
      'shanxi_20250601-20260628_03_维修资源.xlsx',
      'shanxi_20260703_02_报价清单_商业险.xlsx',
    ]);
    expect(plan.archive).toEqual(['shanxi_20250601-20260628_03_维修资源.xlsx']);
  });
});
