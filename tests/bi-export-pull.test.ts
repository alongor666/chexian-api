import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  REQUIRED_REPORT_CODES,
  MIN_SIZE_MB_BY_CODE,
  beijingDayOf,
  evaluateManifestReports,
  evaluateRemoteManifest,
  OPTIONAL_REPORT_CODES,
  HARD_REQUIRED_CODES,
  planBackfillFiles,
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

describe('多省份 manifest（分省上线后同一 code 下 SC+SX 两条 — 2026-07-06 修复 .find() 丢省 bug）', () => {
  // 复现实测：manifest 里山西排在四川前面，.find() 版本永远只挑到山西，
  // 四川的 01/02/03/05 从未被分发/校验，本地 ETL 源静默停在陈旧快照且不报错。
  function sxSc(code: string) {
    const sx = report(code, {
      province: 'shanxi',
      file: `shanxi_20250601-20260705_${code}_报表.xlsx`,
    });
    const sc = report(code, {
      province: 'sichuan',
      file: `sichuan_20260601-20260705_${code}_报表.xlsx`,
    });
    return [sx, sc];
  }

  function multiProvinceBatch() {
    return REQUIRED_REPORT_CODES.flatMap((c: string) => (c === '04' ? [report(c)] : sxSc(c)));
  }

  it('SC+SX 均新鲜 → 两条都进 reports（不再只挑第一条）', () => {
    const reports = multiProvinceBatch();
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(true);
    const code01 = r.reports.filter((x: { code: string }) => x.code === '01');
    expect(code01).toHaveLength(2);
    expect(code01.map((x: { province: string }) => x.province).sort()).toEqual(['shanxi', 'sichuan'].sort());
  });

  it('🔴 复现事故：SX 新鲜但 SC 停在昨天 → 硬闸整体 ok=false 且精确指名是 sichuan 那条不新鲜', () => {
    const reports = multiProvinceBatch();
    const scIdx = reports.findIndex((r) => r.code === '01' && r.province === 'sichuan');
    reports[scIdx] = { ...reports[scIdx], mtime: '2026-07-03T02:31:14Z' }; // 北京 07-03，非今天
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    // 硬闸 code：不健康的省份仍留在 reports 里（原语义——outer ok=false 才是真正的拦截点，
    // --force 时靠这份 reports 继续分发），关键是 ok 必须为 false 且精确点名哪个省份的问题。
    expect(r.ok).toBe(false);
    const code01 = r.reports.filter((x: { code: string }) => x.code === '01');
    expect(code01.map((x: { province: string }) => x.province).sort()).toEqual(['shanxi', 'sichuan'].sort());
    expect(r.issues.find((i: { code: string | null; message: string }) => i.code === '01' && i.message.includes('sichuan'))?.message)
      .toContain('不是北京时间今天');
    // 山西那条本身没问题，不应该被牵连出一条不相关的 error
    expect(r.issues.filter((i: { code: string | null }) => i.code === '01')).toHaveLength(1);
  });

  it('--allow-stale 只豁免被指名 code 里所有省份的新鲜度', () => {
    const reports = multiProvinceBatch();
    const scIdx = reports.findIndex((r) => r.code === '02' && r.province === 'sichuan');
    reports[scIdx] = { ...reports[scIdx], mtime: '2026-07-03T02:31:14Z' };
    const r = evaluateManifestReports(manifestOf(reports), {
      todayBeijing: TODAY, statByName: statsFor(reports), allowStaleCodes: ['02'],
    });
    expect(r.ok).toBe(true);
    expect(r.reports.filter((x: { code: string }) => x.code === '02')).toHaveLength(2);
  });

  it('evaluateRemoteManifest 同样逐省判定：SC 停在昨天 → 未就绪，仅 SX 计入已出', () => {
    const reports = multiProvinceBatch();
    const scIdx = reports.findIndex((r) => r.code === '05' && r.province === 'sichuan');
    reports[scIdx] = { ...reports[scIdx], mtime: '2026-07-03T02:31:14Z' };
    const r = evaluateRemoteManifest(manifestOf(reports), { todayBeijing: TODAY });
    expect(r.ready).toBe(false);
    const code05 = r.reports.filter((x: { code: string }) => x.code === '05');
    expect(code05).toHaveLength(1);
    expect(code05[0].province).toBe('shanxi');
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

describe('evaluateRemoteManifest（watcher 轻量就绪探测：只看 manifest，不比本地字节）', () => {
  it('五张齐全且均为北京今天 → ready', () => {
    const r = evaluateRemoteManifest(manifestOf(fullBatch()), { todayBeijing: TODAY });
    expect(r.ready).toBe(true);
    expect(r.reports).toHaveLength(5);
  });

  it('🔴 02 报价还没出（缺席）→ 未就绪且指明 code', () => {
    const r = evaluateRemoteManifest(manifestOf(fullBatch().filter((x) => x.code !== '02')), { todayBeijing: TODAY });
    expect(r.ready).toBe(false);
    expect(r.issues.find((i: { code: string | null }) => i.code === '02')?.message).toContain('未出表');
  });

  it('🔴 02 mtime 停在昨天（10:30 批次未出）→ 未就绪，其余四张仍计入已出', () => {
    const reports = fullBatch();
    reports[1] = report('02', { mtime: '2026-07-03T02:31:14Z' });
    const r = evaluateRemoteManifest(manifestOf(reports), { todayBeijing: TODAY });
    expect(r.ready).toBe(false);
    expect(r.reports).toHaveLength(4);
  });

  it('🔴 体积骤降（疑似空表）→ 未就绪', () => {
    const reports = fullBatch();
    reports[0] = report('01', { sizeMB: 0.1 });
    const r = evaluateRemoteManifest(manifestOf(reports), { todayBeijing: TODAY });
    expect(r.ready).toBe(false);
  });

  it('manifest 结构非法 → 未就绪不抛异常', () => {
    expect(evaluateRemoteManifest(null, { todayBeijing: TODAY }).ready).toBe(false);
  });
});

describe('可选表分层（04 厂牌低频维表：异常不阻塞，跳过分发保留旧维表 — 2026-07-05）', () => {
  it('常量派生：可选=04，硬闸=01/02/03/05', () => {
    expect([...OPTIONAL_REPORT_CODES]).toEqual(['04']);
    expect([...HARD_REQUIRED_CODES]).toEqual(['01', '02', '03', '05']);
  });

  it('🔴 04 缺席 → 本地校验仍 ok（warn），04 不进分发列表', () => {
    const reports = fullBatch().filter((r) => r.code !== '04');
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(true);
    expect(r.issues.find((i: { code: string | null }) => i.code === '04')?.level).toBe('warn');
    expect(r.reports.map((x: { code: string }) => x.code)).toEqual(['01', '02', '03', '05']);
  });

  it('🔴 04 体积骤降（2026-07-05 实证 4.1MB）→ ok（warn）+ 跳过分发', () => {
    const reports = fullBatch();
    reports[3] = report('04', { sizeMB: 4.1 });
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(true);
    expect(r.reports.map((x: { code: string }) => x.code)).not.toContain('04');
  });

  it('04 mtime 停在昨天 → ok（warn）+ 跳过分发', () => {
    const reports = fullBatch();
    reports[3] = report('04', { mtime: '2026-07-03T01:33:00Z' });
    const r = evaluateManifestReports(manifestOf(reports), { todayBeijing: TODAY, statByName: statsFor(reports) });
    expect(r.ok).toBe(true);
    expect(r.reports.map((x: { code: string }) => x.code)).not.toContain('04');
  });

  it('🔴 远程探测：04 异常不拦就绪（否则偶发骤降会拦住核心事实表发布）', () => {
    const reports = fullBatch();
    reports[3] = report('04', { sizeMB: 4.1 });
    const r = evaluateRemoteManifest(manifestOf(reports), { todayBeijing: TODAY });
    expect(r.ready).toBe(true);
    expect(r.issues.every((i: { level: string }) => i.level === 'warn')).toBe(true);
  });
});

describe('--allow-stale 显式豁免（仅豁免新鲜度，watcher 自动路径不透传）', () => {
  it('02 停在昨天 + 豁免 02 → ok（warn）且 02 照常分发', () => {
    const reports = fullBatch();
    reports[1] = report('02', { mtime: '2026-07-03T02:31:14Z' });
    const r = evaluateManifestReports(manifestOf(reports), {
      todayBeijing: TODAY, statByName: statsFor(reports), allowStaleCodes: ['02'],
    });
    expect(r.ok).toBe(true);
    expect(r.reports.map((x: { code: string }) => x.code)).toContain('02');
    expect(r.issues.find((i: { code: string | null }) => i.code === '02')?.message).toContain('豁免');
  });

  it('🔴 豁免不覆盖字节不一致（传输完整性闸不松）', () => {
    const reports = fullBatch();
    reports[1] = report('02', { mtime: '2026-07-03T02:31:14Z' });
    const stats = statsFor(reports);
    stats[reports[1].file] = { size: 1 };
    const r = evaluateManifestReports(manifestOf(reports), {
      todayBeijing: TODAY, statByName: stats, allowStaleCodes: ['02'],
    });
    expect(r.ok).toBe(false);
  });

  it('豁免 02 不影响其他硬闸 code 的新鲜度拦截', () => {
    const reports = fullBatch();
    reports[1] = report('02', { mtime: '2026-07-03T02:31:14Z' });
    reports[4] = report('05', { mtime: '2026-07-03T02:31:14Z' });
    const r = evaluateManifestReports(manifestOf(reports), {
      todayBeijing: TODAY, statByName: statsFor(reports), allowStaleCodes: ['02'],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i: { code: string | null }) => i.code === '05')?.level).toBe('error');
  });
});

describe('planBackfillFiles（契约外补导文件识别 — 2026-07-05 上游补导 02 报价 0624-0703 实证）', () => {
  const CURRENT = [
    'shanxi_20250601-20260703_01_签单清单_定稿.xlsx',
    'shanxi_20260703_02_报价清单_商业险.xlsx',
    'shanxi_20250601-20260703_03_维修资源.xlsx',
    '20260705_04_厂牌明细.xlsx',
    'shanxi_20250601-20260703_05_理赔明细_报案时间.xlsx',
  ];

  it('识别补导的 02 历史单日文件，排除当前份与非报表文件', () => {
    const inbox = [
      ...CURRENT,
      'shanxi_20260624_02_报价清单_商业险.xlsx',
      'shanxi_20260625_02_报价清单_商业险.xlsx',
      'latest-manifest.json',
      'README-for-etl.md',
    ];
    expect(planBackfillFiles(inbox, CURRENT)).toEqual([
      'shanxi_20260624_02_报价清单_商业险.xlsx',
      'shanxi_20260625_02_报价清单_商业险.xlsx',
    ]);
  });

  it('🔴 04 当前份即使被校验剔除也不从补导侧门混入（排除集=manifest 全部当前份）', () => {
    expect(planBackfillFiles(['20260705_04_厂牌明细.xlsx'], CURRENT)).toEqual([]);
  });

  it('范围前缀补导文件（如重导历史签单段）同样识别', () => {
    expect(planBackfillFiles(['shanxi_20240101-20250531_01_签单清单_定稿.xlsx'], CURRENT))
      .toEqual(['shanxi_20240101-20250531_01_签单清单_定稿.xlsx']);
  });

  it('浏览器重复下载残留（`xxx (1).xlsx`）与非 01-05 编号不入 ETL', () => {
    const inbox = ['shanxi_20260624_02_报价清单_商业险 (1).xlsx', '20260705_08_商业险续保流失公司.xlsx'];
    expect(planBackfillFiles(inbox, CURRENT)).toEqual([]);
  });
});
