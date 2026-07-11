/**
 * policy/current 分片枚举共享 helper 单测（多省 Phase B B2）
 *
 * 锁定 listPolicyCurrentShards / inspectPolicyCurrentLayout 行为：
 *   - 顶层扁平 parquet → branch=undefined（复刻现状）
 *   - 省份子目录 current/<省>/ 内 parquet → branch=省码（下钻不失明）
 *   - 枚举实际子目录、不硬编码省常量；省码不以 .parquet 结尾故两遍扫描不相交
 *   - 嵌套目录（staging/）排除；非 ^[A-Z]{2}$ 目录忽略
 *
 * 全部用 tmpdir + 空 .parquet 文件，**无条件运行**（不依赖 duckdb/python，避免 CI warning skip 假安全）。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listPolicyCurrentShards,
  toDuckdbReadParquetList,
  policyCurrentGlobPatterns,
  inspectPolicyCurrentLayout,
  findPolicyCurrentSyncGateViolations,
  VALIDATION_SYNCED_FACT_DOMAINS,
  validationFactDomainHasData,
  listValidationFactShards,
  collectValidationFactFileEntries,
} from '../lib/policy-current-shards.mjs';

let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function makeCurrent({ flat = [], subdirs = {} } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'policy-shards-'));
  for (const name of flat) writeFileSync(join(dir, name), '');
  for (const [province, files] of Object.entries(subdirs)) {
    mkdirSync(join(dir, province), { recursive: true });
    for (const name of files) writeFileSync(join(dir, province, name), '');
  }
  return dir;
}

describe('listPolicyCurrentShards', () => {
  it('目录不存在 → []', () => {
    expect(listPolicyCurrentShards('/nonexistent/xxx/current')).toEqual([]);
  });

  it('纯扁平布局（现状）→ 全部 branch=undefined，逐字节复刻 readdir', () => {
    makeCurrent({ flat: ['a.parquet', 'b.parquet', 'note.txt'] });
    const shards = listPolicyCurrentShards(dir);
    expect(shards).toHaveLength(2);
    expect(shards.every((s) => s.branch === undefined)).toBe(true);
    expect(shards.map((s) => s.name).sort()).toEqual(['a.parquet', 'b.parquet']);
  });

  it('省份子目录被枚举（下钻不失明）→ branch=省码', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet', 'y.parquet'], SX: ['z.parquet'] } });
    const shards = listPolicyCurrentShards(dir);
    expect(shards).toHaveLength(3);
    const byBranch = shards.reduce((m, s) => ((m[s.branch] = (m[s.branch] || 0) + 1), m), {});
    expect(byBranch).toEqual({ SC: 2, SX: 1 });
  });

  it('扁平 + 子目录并存 → 两遍都枚举，不相交（省码不以 .parquet 结尾）', () => {
    makeCurrent({ flat: ['flat.parquet'], subdirs: { SC: ['sub.parquet'] } });
    const shards = listPolicyCurrentShards(dir);
    expect(shards).toHaveLength(2);
    expect(shards.find((s) => s.name === 'flat.parquet').branch).toBeUndefined();
    expect(shards.find((s) => s.name === 'sub.parquet').branch).toBe('SC');
  });

  it('非 ^[A-Z]{2}$ 目录忽略；子目录内嵌套目录排除', () => {
    dir = mkdtempSync(join(tmpdir(), 'policy-shards-'));
    mkdirSync(join(dir, 'SC'), { recursive: true });
    writeFileSync(join(dir, 'SC', 'ok.parquet'), '');
    mkdirSync(join(dir, 'SC', 'staging.parquet'), { recursive: true }); // 嵌套目录（名以 .parquet 结尾）→ 排除
    mkdirSync(join(dir, 'archive'), { recursive: true }); // 非省码目录 → 忽略
    writeFileSync(join(dir, 'archive', 'old.parquet'), '');
    mkdirSync(join(dir, 'ABC'), { recursive: true }); // 3 字母 → 非 ^[A-Z]{2}$ → 忽略
    writeFileSync(join(dir, 'ABC', 'nope.parquet'), '');
    const shards = listPolicyCurrentShards(dir);
    expect(shards.map((s) => s.name)).toEqual(['ok.parquet']);
    expect(shards[0].branch).toBe('SC');
  });
});

describe('toDuckdbReadParquetList', () => {
  it('显式文件列表 → DuckDB 数组字面量（单引号 SQL 转义）', () => {
    expect(toDuckdbReadParquetList(['/a/x.parquet', '/b/y.parquet']))
      .toBe("['/a/x.parquet', '/b/y.parquet']");
  });

  it('路径含单引号 → SQL 双写转义（防注入）', () => {
    expect(toDuckdbReadParquetList(["/a/o'brien.parquet"]))
      .toBe("['/a/o''brien.parquet']");
  });
});

describe('policyCurrentGlobPatterns', () => {
  it('返回顶层 + 单层 [A-Z][A-Z] 省份子目录两模式（非递归，与 ^[A-Z]{2}$ 一致）', () => {
    expect(policyCurrentGlobPatterns('/w/policy/current')).toEqual([
      '/w/policy/current/*.parquet',
      '/w/policy/current/[A-Z][A-Z]/*.parquet',
    ]);
  });
});

describe('inspectPolicyCurrentLayout', () => {
  it('纯扁平 → subdirOnly=false', () => {
    makeCurrent({ flat: ['a.parquet'] });
    const r = inspectPolicyCurrentLayout(dir);
    expect(r).toMatchObject({ flatCount: 1, subdirCount: 0, subdirOnly: false, branches: [] });
  });

  it('子目录独占（flat 空 + 子目录有）→ subdirOnly=true（fail-closed 触发条件）', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet'], SX: ['z.parquet'] } });
    const r = inspectPolicyCurrentLayout(dir);
    expect(r).toMatchObject({ flatCount: 0, subdirCount: 2, subdirOnly: true });
    expect(r.branches).toEqual(['SC', 'SX']);
  });

  it('扁平+子目录并存 → subdirOnly=false（B1 互斥闸另行抛错；此处不判独占）', () => {
    makeCurrent({ flat: ['flat.parquet'], subdirs: { SC: ['sub.parquet'] } });
    const r = inspectPolicyCurrentLayout(dir);
    expect(r).toMatchObject({ flatCount: 1, subdirCount: 1, subdirOnly: false });
  });
});

// ============================================================
// B3/B5 · sync 前 GATED 子目录闸（镜像 data-bootstrapper.ts，比 B1 严；
// B5 cutover 起白名单参数驱动（allowedBranches），默认最保守 ['SC']）
// ============================================================
describe('findPolicyCurrentSyncGateViolations — sync 前 GATED 子目录闸（fail-closed，白名单语义）', () => {
  it('纯扁平（cutover 前生产现状）→ 零违规（休眠放行，字节安全）', () => {
    makeCurrent({ flat: ['a.parquet', 'b.parquet'] });
    expect(findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC'] })).toEqual([]);
  });

  it('空目录 → 零违规', () => {
    makeCurrent({});
    expect(findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC'] })).toEqual([]);
  });

  it('仅白名单省子目录（current/SC/，白名单=[SC]）→ 零违规（名单内省份放行）', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet'] } });
    expect(findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC'] })).toEqual([]);
  });

  it('名单外省子目录（current/SX/，白名单=[SC]）→ GATED fail-closed 违规（无条件，不给 RLS 放行口）', () => {
    makeCurrent({ subdirs: { SX: ['x.parquet'] } });
    const v = findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC'] });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('GATED');
    expect(v[0]).toContain('SX');
    expect(v[0]).toContain('validation');
  });

  it('B5 cutover 白名单=[SC,SX] → current/SC/ + current/SX/ 双省子目录全部放行（零违规）', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet'], SX: ['y.parquet'] } });
    expect(findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC', 'SX'] })).toEqual([]);
  });

  it('白名单=[SC,SX] 时第三省（current/GD/）仍 GATED 拒绝（名单外省不随扩省自动放行）', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet'], SX: ['y.parquet'], GD: ['z.parquet'] } });
    const v = findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC', 'SX'] });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('GATED');
    expect(v[0]).toContain('GD');
    expect(v[0]).not.toContain('[SX]'); // SX 在名单内，不应出现在违规省清单
  });

  it('扁平 + 子目录并存 → 迁移态冲突违规（白名单不豁免并存态）', () => {
    makeCurrent({ flat: ['flat.parquet'], subdirs: { SC: ['sub.parquet'] } });
    const v = findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC', 'SX'] });
    expect(v.some((m) => m.includes('迁移态冲突'))).toBe(true);
  });

  it('扁平 + 名单外省子目录并存 → 同时报迁移冲突 + GATED（两类违规）', () => {
    makeCurrent({ flat: ['flat.parquet'], subdirs: { SX: ['sub.parquet'] } });
    const v = findPolicyCurrentSyncGateViolations(dir, { allowedBranches: ['SC'] });
    expect(v).toHaveLength(2);
    expect(v.some((m) => m.includes('迁移态冲突'))).toBe(true);
    expect(v.some((m) => m.includes('GATED'))).toBe(true);
  });

  it('默认白名单（不传 allowedBranches）→ 最保守 [SC]（禁读 ETL BRANCH_CODE，codex 闸-2 P1）', () => {
    makeCurrent({ subdirs: { SC: ['x.parquet'] } });
    // 默认白名单固定 ['SC'] → current/SC/ 零违规（与 env BRANCH_CODE 无关）
    expect(findPolicyCurrentSyncGateViolations(dir)).toEqual([]);
  });

  it('默认白名单不受 env BRANCH_CODE=SX 影响（解耦 ETL 声明省，防 current/SX/ 误放行）', () => {
    const saved = process.env.BRANCH_CODE;
    process.env.BRANCH_CODE = 'SX'; // 模拟 SX ETL 残留 env
    try {
      makeCurrent({ subdirs: { SX: ['x.parquet'] } });
      // 即便 env BRANCH_CODE=SX，默认白名单仍固定 ['SC'] → current/SX/ 仍 GATED fail-closed
      const v = findPolicyCurrentSyncGateViolations(dir);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('GATED');
      expect(v[0]).toContain('SX');
    } finally {
      if (saved === undefined) delete process.env.BRANCH_CODE;
      else process.env.BRANCH_CODE = saved;
    }
  });
});

// ─────────── validation 事实域枚举（2026-07-11 drift 误报根治，与 sync-vps 键对称） ───────────

function makeValidation(structure = {}) {
  dir = mkdtempSync(join(tmpdir(), 'validation-fact-'));
  for (const [province, domains] of Object.entries(structure)) {
    for (const [domain, files] of Object.entries(domains)) {
      mkdirSync(join(dir, province, domain), { recursive: true });
      for (const name of files) writeFileSync(join(dir, province, domain, name), 'x');
    }
  }
  return dir;
}

describe('listValidationFactShards / collectValidationFactFileEntries', () => {
  it('validation 根不存在 → []', () => {
    expect(listValidationFactShards('/tmp/nonexistent-validation-xyz')).toEqual([]);
  });

  it('键规则与 sync-vps manifest 一致：validation/<省>/<域>/<文件>', () => {
    const root = makeValidation({
      SX: {
        claims_detail: ['claims_2024.parquet', 'claims_2025.parquet', '_partition_meta.json'],
        repair_resource: ['latest.parquet'],
      },
    });
    const keys = listValidationFactShards(root).map((s) => s.key);
    expect(keys).toEqual([
      'validation/SX/claims_detail/claims_2024.parquet',
      'validation/SX/claims_detail/claims_2025.parquet',
      'validation/SX/repair_resource/latest.parquet',
    ]);
  });

  it('SC 与非省码目录被排除（与 sync-vps 省份谓词一致）', () => {
    const root = makeValidation({
      SC: { claims_detail: ['claims_2024.parquet'] },
      SX: { renewal_tracker: ['latest.parquet'] },
      staging: { claims_detail: ['claims_2024.parquet'] },
    });
    const keys = listValidationFactShards(root).map((s) => s.key);
    expect(keys).toEqual(['validation/SX/renewal_tracker/latest.parquet']);
  });

  it('无数据的域跳过（镜像 sync-vps 任务创建条件，防反向「新增未同步」误报）', () => {
    const root = makeValidation({
      SX: {
        quotes_conversion: ['other.parquet'],            // 无 latest.parquet → 域无数据
        claims_detail: ['notes.txt'],                     // 无 claims_*.parquet → 域无数据
        repair_resource: ['latest.parquet'],
      },
    });
    const keys = listValidationFactShards(root).map((s) => s.key);
    expect(keys).toEqual(['validation/SX/repair_resource/latest.parquet']);
  });

  it('域清单外目录（如 dim / 未注册域）不枚举', () => {
    const root = makeValidation({
      SX: { dim: ['latest.parquet'], unknown_domain: ['latest.parquet'], cross_sell: ['latest.parquet'] },
    });
    const keys = listValidationFactShards(root).map((s) => s.key);
    expect(keys).toEqual(['validation/SX/cross_sell/latest.parquet']);
  });

  it('collectValidationFactFileEntries 返回 {key: {size, mtimeMs}} 条目', () => {
    const root = makeValidation({ SX: { renewal_tracker: ['latest.parquet'] } });
    const entries = collectValidationFactFileEntries(root);
    const key = 'validation/SX/renewal_tracker/latest.parquet';
    expect(Object.keys(entries)).toEqual([key]);
    expect(entries[key].size).toBe(1);
    expect(typeof entries[key].mtimeMs).toBe('number');
  });
});

describe('validationFactDomainHasData', () => {
  it('claims_detail 认年度分区 claims_*.parquet', () => {
    const root = makeValidation({ SX: { claims_detail: ['claims_2024.parquet'] } });
    expect(validationFactDomainHasData(join(root, 'SX', 'claims_detail'), 'claims_detail')).toBe(true);
    expect(validationFactDomainHasData(join(root, 'SX', 'claims_detail'), 'renewal_tracker')).toBe(false);
  });

  it('其余派生域认 latest.parquet', () => {
    const root = makeValidation({ SX: { repair_resource: ['latest.parquet'] } });
    expect(validationFactDomainHasData(join(root, 'SX', 'repair_resource'), 'repair_resource')).toBe(true);
  });
});

describe('VALIDATION_SYNCED_FACT_DOMAINS（单一事实源）', () => {
  it('覆盖 2026-07-11 误报事故涉及的全部域', () => {
    for (const d of ['claims_detail', 'quotes_conversion', 'renewal_tracker', 'repair_resource']) {
      expect(VALIDATION_SYNCED_FACT_DOMAINS).toContain(d);
    }
  });
});
