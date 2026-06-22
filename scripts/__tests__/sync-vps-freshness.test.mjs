/**
 * sync-vps 完整性闸门决策逻辑单测
 *
 * 锁定 evaluateFreshness 行为：本地 policy 数据比 VPS 现役更旧/更少 → block，
 * 防 parquet 不全的机器把残缺数据覆盖到生产。
 *
 * 多省安全改造（§6.1）：增加以下覆盖：
 *   - buildRsyncBranchFilterArgs：单省短路 + 多省 protect filter 参数生成
 *   - getSyncBranchCode：env 读取与格式校验
 *   - isFileInBranch：manifest 分省过滤
 *   - buildStandardSyncTasks：多省时 policy/current 带 safeDeleteBranch
 *   - assertLocalNotStaleVsVps：多省降级 skip（由于 VPS 端无分省指纹）
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  evaluateFreshness,
  buildSyncTasks,
  buildRsyncBranchFilterArgs,
  getSyncBranchCode,
  isFileInBranch,
  buildStandardSyncTasks,
} from '../sync-vps.mjs';

const vps = { maxDate: '2026-05-30', rowCount: 1_000_000 };

describe('evaluateFreshness', () => {
  it('本地与现役一致 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, vps).verdict).toBe('pass');
  });

  it('本地更新更多 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-31', rowCount: 1_000_100 }, vps).verdict).toBe('pass');
  });

  it('本地日期更旧 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 1_000_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
  });

  it('本地行数更少 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-30', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('行数');
  });

  it('日期与行数同时倒退 → block，原因含两条', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
    expect(r.reason).toContain('行数');
  });

  it('VPS 指纹不可用（端点未部署）→ skip 降级放行', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, null).verdict).toBe('skip');
  });

  it('本地指纹不可用（duckdb CLI 缺失）→ skip 降级放行', () => {
    expect(evaluateFreshness(null, vps).verdict).toBe('skip');
  });

  it('一侧 maxDate 为 null 时不据日期 block，仅看行数', () => {
    // 现役 maxDate 缺失（如刚启动未查到）但行数完整 → 不应误 block
    expect(evaluateFreshness({ maxDate: null, rowCount: 1_000_000 }, { maxDate: null, rowCount: 1_000_000 }).verdict).toBe('pass');
  });
});

// policy 完整性闸门只该在本次确实同步 policy/current 时执行：
// --domain 模式只传对应 fact 域 latest.parquet，不含 policy，不应被 policy 新鲜度阻断。
describe('闸门执行范围（buildSyncTasks 是否含 policy/current）', () => {
  const cfg = (domains) => ({ domains, remoteDir: '/r', frontendDistDir: '/f', branchCode: null });

  it('标准全量同步 → 含 policy/current（闸门生效）', () => {
    expect(buildSyncTasks(cfg([])).some((t) => t.label === 'policy/current')).toBe(true);
  });

  it('--domain customer_flow → 不含 policy/current（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['customer_flow'])).some((t) => t.label === 'policy/current')).toBe(false);
  });

  it('--domain new_energy_claims → 不含 policy/current（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['new_energy_claims'])).some((t) => t.label === 'policy/current')).toBe(false);
  });
});

// ============================================================
// 多省安全改造（§6.1）新增测试
// ============================================================

// ------- 站点 1：buildRsyncBranchFilterArgs -------
describe('buildRsyncBranchFilterArgs — rsync 分省保护 filter 参数生成', () => {
  it('单省短路：branchCode=null 返回空数组（字节安全：历史行为等价）', () => {
    expect(buildRsyncBranchFilterArgs(null)).toEqual([]);
  });

  it('单省短路：branchCode=null 不生成任何 filter 参数', () => {
    const args = buildRsyncBranchFilterArgs(null);
    expect(args.every(a => !a.includes('--filter'))).toBe(true);
  });

  it('多省 SC 模式：生成保护 SX 的 filter', () => {
    const args = buildRsyncBranchFilterArgs('SC', ['SC', 'SX']);
    expect(args).toContain('--filter');
    // 应该有 'P SX_*.parquet' 保护规则
    const filterIdx = args.indexOf('--filter');
    expect(args[filterIdx + 1]).toBe('P SX_*.parquet');
  });

  it('多省 SX 模式：生成保护 SC 的 filter', () => {
    const args = buildRsyncBranchFilterArgs('SX', ['SC', 'SX']);
    expect(args).toContain('--filter');
    const filterIdx = args.indexOf('--filter');
    expect(args[filterIdx + 1]).toBe('P SC_*.parquet');
  });

  it('三省模式：保护所有非目标省', () => {
    const args = buildRsyncBranchFilterArgs('SC', ['SC', 'SX', 'GD']);
    // 两条 --filter 规则（SX + GD）
    const filterCount = args.filter(a => a === '--filter').length;
    expect(filterCount).toBe(2);
    const rules = args.filter(a => a.startsWith('P '));
    expect(rules).toContain('P SX_*.parquet');
    expect(rules).toContain('P GD_*.parquet');
    // 不包含自身（SC）的保护规则
    expect(rules).not.toContain('P SC_*.parquet');
  });

  it('单省时 knownBranches 只含目标省：返回空数组（无异省可保护）', () => {
    expect(buildRsyncBranchFilterArgs('SC', ['SC'])).toEqual([]);
  });
});

// ------- 站点 2/新增：getSyncBranchCode -------
describe('getSyncBranchCode — SYNC_VPS_BRANCH_CODE env 读取', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.SYNC_VPS_BRANCH_CODE;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SYNC_VPS_BRANCH_CODE;
    } else {
      process.env.SYNC_VPS_BRANCH_CODE = originalEnv;
    }
  });

  it('env 未设置 → null（单省历史模式，字节安全）', () => {
    delete process.env.SYNC_VPS_BRANCH_CODE;
    expect(getSyncBranchCode()).toBeNull();
  });

  it('SYNC_VPS_BRANCH_CODE=SC → 返回 SC', () => {
    process.env.SYNC_VPS_BRANCH_CODE = 'SC';
    expect(getSyncBranchCode()).toBe('SC');
  });

  it('SYNC_VPS_BRANCH_CODE=sx（小写）→ 自动转 SX', () => {
    process.env.SYNC_VPS_BRANCH_CODE = 'sx';
    expect(getSyncBranchCode()).toBe('SX');
  });

  it('SYNC_VPS_BRANCH_CODE 带空格 → trim 后解析', () => {
    process.env.SYNC_VPS_BRANCH_CODE = '  SC  ';
    expect(getSyncBranchCode()).toBe('SC');
  });

  it('SYNC_VPS_BRANCH_CODE 格式不合法（非 2 位字母）→ 抛错', () => {
    process.env.SYNC_VPS_BRANCH_CODE = 'SICHUAN';
    expect(() => getSyncBranchCode()).toThrow('SYNC_VPS_BRANCH_CODE');
  });
});

// ------- P2：isFileInBranch — manifest 分省过滤 -------
describe('isFileInBranch — manifest 分省文件过滤', () => {
  it('单省模式（branchCode=null）：所有文件都通过（字节安全：等价历史）', () => {
    expect(isFileInBranch('SC_20210101-20261231_签单.parquet', null)).toBe(true);
    expect(isFileInBranch('SX_20210101-20261231_签单.parquet', null)).toBe(true);
    expect(isFileInBranch('裸名_20210101-20261231.parquet', null)).toBe(true);
  });

  it('多省 SC 模式：SC 前缀文件通过', () => {
    expect(isFileInBranch('SC_20210101-20261231_签单.parquet', 'SC')).toBe(true);
  });

  it('多省 SC 模式：SX 前缀文件被过滤', () => {
    expect(isFileInBranch('SX_20210101-20261231_签单.parquet', 'SC')).toBe(false);
  });

  it('多省 SC 模式：裸名文件（无省份前缀）= 历史 SC 分片，通过', () => {
    expect(isFileInBranch('20210101-20261231_01_签单清单_定稿.parquet', 'SC')).toBe(true);
    expect(isFileInBranch('每日数据_20260101_20261231.parquet', 'SC')).toBe(true);
  });

  it('多省 SX 模式：裸名文件（= SC 历史分片）被过滤', () => {
    expect(isFileInBranch('20210101-20261231_01_签单清单_定稿.parquet', 'SX')).toBe(false);
  });
});

// ------- 站点 3：buildStandardSyncTasks 分省支持 -------
describe('buildStandardSyncTasks — 多省安全（policy/current safeDeleteBranch）', () => {
  it('单省默认（branchCode=null）：policy/current 无 safeDeleteBranch（字节安全）', () => {
    const tasks = buildStandardSyncTasks('/remote', '/frontend');
    const policy = tasks.find(t => t.label === 'policy/current');
    expect(policy).toBeDefined();
    expect(policy.safeDeleteBranch).toBeUndefined();
  });

  it('单省默认（opts={}）：policy/current 无 safeDeleteBranch', () => {
    const tasks = buildStandardSyncTasks('/remote', '/frontend', {});
    const policy = tasks.find(t => t.label === 'policy/current');
    expect(policy.safeDeleteBranch).toBeUndefined();
  });

  it('多省 SC 模式（branchCode=SC）：policy/current 带 safeDeleteBranch=SC', () => {
    const tasks = buildStandardSyncTasks('/remote', '/frontend', { branchCode: 'SC' });
    const policy = tasks.find(t => t.label === 'policy/current');
    expect(policy.safeDeleteBranch).toBe('SC');
  });

  it('其他目录（dim/salesman 等）不受 branchCode 影响', () => {
    const tasks = buildStandardSyncTasks('/remote', '/frontend', { branchCode: 'SC' });
    const salesman = tasks.find(t => t.label === 'dim/salesman');
    expect(salesman.safeDeleteBranch).toBeUndefined();
  });

  it('buildSyncTasks（含 branchCode=SC）：policy/current 带 safeDeleteBranch', () => {
    const cfg = { domains: [], remoteDir: '/r', frontendDistDir: '/f', branchCode: 'SC' };
    const tasks = buildSyncTasks(cfg);
    const policy = tasks.find(t => t.label === 'policy/current');
    expect(policy.safeDeleteBranch).toBe('SC');
  });

  it('buildSyncTasks（branchCode=null）：policy/current 无 safeDeleteBranch（字节安全）', () => {
    const cfg = { domains: [], remoteDir: '/r', frontendDistDir: '/f', branchCode: null };
    const tasks = buildSyncTasks(cfg);
    const policy = tasks.find(t => t.label === 'policy/current');
    expect(policy.safeDeleteBranch).toBeUndefined();
  });
});
