/**
 * sync-vps 完整性闸门决策逻辑单测
 *
 * 锁定 evaluateFreshness 行为：本地 policy 数据比 VPS 现役更旧/更少 → block，
 * 防 parquet 不全的机器把残缺数据覆盖到生产。
 *
 * 多省安全改造（§6.1）：增加以下覆盖：
 *   - buildRsyncBranchFilterArgs：单省短路 + 多省 protect filter + sender exclude 参数生成（P0-1/P0-2 修复）
 *   - branchOfFile / fileBelongsToBranch / branchFilePatterns：纯函数，裸名 SC 识别
 *   - getSyncBranchCode：env 读取与格式校验
 *   - isFileInBranch：manifest 分省过滤
 *   - buildStandardSyncTasks：多省时 policy/current 带 safeDeleteBranch
 *   - assertLocalNotStaleVsVps：P1 修复（SC 模式仍跑新鲜度闸，非 SC 省份才降级）
 *   - 真实 rsync --delete 验证：本地临时目录验证裸名 SC 不被删 + 异省不被上传
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  evaluateFreshness,
  buildSyncTasks,
  buildRsyncBranchFilterArgs,
  getSyncBranchCode,
  isFileInBranch,
  buildStandardSyncTasks,
  assertLocalNotStaleVsVps,
  branchOfFile,
  fileBelongsToBranch,
  branchFilePatterns,
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

// ------- 站点 0：branchOfFile / fileBelongsToBranch / branchFilePatterns（P0-1 核心修复）-------
describe('branchOfFile — 从文件名推断省份', () => {
  it('裸名分片（无前缀）→ SC（历史四川分片约定）', () => {
    expect(branchOfFile('20210101-20231231_01_签单清单_定稿.parquet')).toBe('SC');
    expect(branchOfFile('每日数据_20260101_20261231.parquet')).toBe('SC');
  });

  it('SX_ 前缀 → SX', () => {
    expect(branchOfFile('SX_20210101-20261231_签单.parquet')).toBe('SX');
  });

  it('SC_ 前缀 → SC', () => {
    expect(branchOfFile('SC_20210101-20261231_签单.parquet')).toBe('SC');
  });

  it('GD_ 前缀 → GD（三省扩展）', () => {
    expect(branchOfFile('GD_20210101-20261231_签单.parquet')).toBe('GD');
  });
});

describe('fileBelongsToBranch — 文件是否属于指定省份', () => {
  it('裸名文件属于 SC', () => {
    expect(fileBelongsToBranch('20210101-20231231_01_签单清单_定稿.parquet', 'SC')).toBe(true);
  });

  it('裸名文件不属于 SX', () => {
    expect(fileBelongsToBranch('20210101-20231231_01_签单清单_定稿.parquet', 'SX')).toBe(false);
  });

  it('SX_ 前缀文件属于 SX', () => {
    expect(fileBelongsToBranch('SX_20210101-20261231_签单.parquet', 'SX')).toBe(true);
  });

  it('SX_ 前缀文件不属于 SC', () => {
    expect(fileBelongsToBranch('SX_20210101-20261231_签单.parquet', 'SC')).toBe(false);
  });
});

describe('branchFilePatterns — 省份文件模式（辅助函数）', () => {
  it('SC 返回含 SC_ 前缀模式', () => {
    const pats = branchFilePatterns('SC');
    expect(pats).toContain('SC_*.parquet');
  });

  it('SX 返回单条 SX_*.parquet 模式', () => {
    expect(branchFilePatterns('SX')).toEqual(['SX_*.parquet']);
  });

  it('GD 返回单条 GD_*.parquet 模式（三省扩展）', () => {
    expect(branchFilePatterns('GD')).toEqual(['GD_*.parquet']);
  });
});

// ------- 站点 1：buildRsyncBranchFilterArgs（P0 第 2 轮根因修复）-------
describe('buildRsyncBranchFilterArgs — rsync 分省保护（前缀轴策略）', () => {
  it('单省短路：branchCode=null 返回空数组（字节安全：历史行为等价）', () => {
    expect(buildRsyncBranchFilterArgs(null)).toEqual([]);
  });

  it('单省短路：branchCode=null 不生成任何 filter 或 exclude 参数', () => {
    const args = buildRsyncBranchFilterArgs(null);
    expect(args).toEqual([]);
    expect(args).not.toContain('--filter');
    expect(args).not.toContain('--exclude');
  });

  // ★ P0 根因修复核心：同步 SC 时，用 [A-Z][A-Z]_*.parquet 统一覆盖所有带前缀省
  it('SC 模式：receiver protect 用 [A-Z][A-Z]_*.parquet（覆盖 SX_/GD_/ 等所有带前缀省）', () => {
    const args = buildRsyncBranchFilterArgs('SC');
    // 必须有 --filter 'P [A-Z][A-Z]_*.parquet'
    expect(args).toContain('--filter');
    expect(args).toContain('P [A-Z][A-Z]_*.parquet');
    // 必须有 --exclude '[A-Z][A-Z]_*.parquet'（sender 侧不上传异省）
    expect(args).toContain('--exclude');
    expect(args).toContain('[A-Z][A-Z]_*.parquet');
  });

  it('SC 模式：只有 2 个参数对（1 条 protect + 1 条 exclude，简洁精准）', () => {
    const args = buildRsyncBranchFilterArgs('SC');
    expect(args).toHaveLength(4); // [--filter, P ..., --exclude, ...]
  });

  it('SC 模式：不包含 [0-9]*.parquet 模式（旧枚举方式已废弃）', () => {
    const args = buildRsyncBranchFilterArgs('SC');
    expect(args).not.toContain('[0-9]*.parquet');
  });

  // ★ SX 模式：protect-all + risk-open（receiver）+ include-first（sender）
  it('SX 模式：receiver 侧含 P *.parquet（保护所有 parquet）和 R SX_*.parquet（放开 SX_）', () => {
    const args = buildRsyncBranchFilterArgs('SX');
    // R 必须在 P 前（首匹配）
    const rIdx = args.indexOf('R SX_*.parquet');
    const pIdx = args.indexOf('P *.parquet');
    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(pIdx).toBeGreaterThanOrEqual(0);
    expect(rIdx).toBeLessThan(pIdx); // R 先匹配，P 后兜底
    // 包含 --filter 标志
    const filterFlags = args.filter((a, i) => a === '--filter' && (args[i+1] === 'R SX_*.parquet' || args[i+1] === 'P *.parquet'));
    expect(filterFlags.length).toBe(2);
  });

  it('SX 模式：sender 侧含 --include SX_*.parquet 在前，--exclude *.parquet 在后', () => {
    const args = buildRsyncBranchFilterArgs('SX');
    const includeIdx = args.indexOf('SX_*.parquet');
    const excludeIdx = args.lastIndexOf('*.parquet');
    // --include 'SX_*.parquet' 必须在 --exclude '*.parquet' 前
    expect(includeIdx).toBeGreaterThanOrEqual(0);
    expect(excludeIdx).toBeGreaterThan(includeIdx);
    // 对应 flag 是 --include 和 --exclude
    expect(args[includeIdx - 1]).toBe('--include');
    expect(args[excludeIdx - 1]).toBe('--exclude');
  });

  it('SX 模式：包含 4 个参数对（R filter + P filter + include + exclude）', () => {
    const args = buildRsyncBranchFilterArgs('SX');
    expect(args).toHaveLength(8); // [--filter R SX_, --filter P *, --include SX_, --exclude *]
  });

  it('knownBranches 参数兼容（新实现已忽略该参数，旧测试调用不报错）', () => {
    // 向后兼容：第二参数 _knownBranches 已废弃，传入任意值不报错
    expect(() => buildRsyncBranchFilterArgs('SC', ['SC', 'SX', 'GD'])).not.toThrow();
    expect(() => buildRsyncBranchFilterArgs('SX', ['SC', 'SX'])).not.toThrow();
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

  it('SYNC_VPS_BRANCH_CODE=GD（不支持的省份）→ 抛错拒绝（明确白名单）', () => {
    process.env.SYNC_VPS_BRANCH_CODE = 'GD';
    expect(() => getSyncBranchCode()).toThrow('不支持的省份编码');
  });

  it('SYNC_VPS_BRANCH_CODE=SX → 返回 SX（已支持）', () => {
    process.env.SYNC_VPS_BRANCH_CODE = 'SX';
    expect(getSyncBranchCode()).toBe('SX');
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

// ============================================================
// P1 修复：assertLocalNotStaleVsVps
// 修复前：branchCode 非 null 时（含 SC）无条件降级跳过新鲜度闸
// 修复后：只有非 SC 省份（SX 等）才降级；SC 模式仍跑新鲜度校验（保护四川生产数据）
// ============================================================
describe('assertLocalNotStaleVsVps — P1 修复：SC 不再跳过新鲜度闸 + 非 SC 省份才降级', () => {
  it('P1 修复验证：多省 SX 模式降级放行，warn 消息含省份编码', async () => {
    const warnMessages = [];
    const onWarn = (msg) => warnMessages.push(msg);
    const onFail = vi.fn();
    const onPass = vi.fn();

    const result = await assertLocalNotStaleVsVps(
      /* config 不会被访问（SX 路径早返回） */ {},
      /* localCurrentDir 不会被访问 */ '/unused',
      { onWarn, onFail, onPass },
      'SX', // 非 SC 省份 → 降级放行
    );

    expect(result).toBe(true);
    expect(warnMessages.length).toBe(1);
    expect(warnMessages[0]).toContain('SX');
    expect(warnMessages[0]).toContain('降级放行');
    // onFail / onPass 不应被调用
    expect(onFail).not.toHaveBeenCalled();
    expect(onPass).not.toHaveBeenCalled();
  });

  it('P1 修复验证：多省 GD 模式同样降级，warn 消息含省份编码', async () => {
    const warnings = [];
    const result = await assertLocalNotStaleVsVps(
      {},
      '/unused',
      { onWarn: (m) => warnings.push(m) },
      'GD', // 非 SC 省份 → 降级
    );
    expect(result).toBe(true);
    expect(warnings[0]).toContain('GD');
    expect(warnings[0]).toContain('降级放行');
  });

  it('P1 修复验证：SC 模式不再无条件降级，走新鲜度校验路径', async () => {
    // SC 模式走单省路径（queryLocalPolicyFingerprint + queryVpsPolicyFingerprint）
    // 在测试环境 duckdb/SSH 不可用，指纹为 null → evaluateFreshness skip → return true
    // 关键：不产生"降级放行"的 warn 消息（那是非 SC 降级专用消息）
    const warnMessages = [];
    const result = await assertLocalNotStaleVsVps(
      { host: '127.0.0.1', port: 22, username: 'test', alias: 'test-alias' },
      '/nonexistent-path-for-test',
      { onWarn: (m) => warnMessages.push(m) },
      'SC', // SC 模式 → 走新鲜度闸，不降级
    );
    // 不抛异常（指纹 null → skip → true）
    expect(result).toBe(true);
    // 关键断言：没有"降级放行"消息（证明 SC 没走非 SC 降级分支）
    const hasDegradeMsg = warnMessages.some(m => m.includes('降级放行'));
    expect(hasDegradeMsg).toBe(false);
  });

  it('单省模式（branchCode=null）：走历史路径，不降级', async () => {
    // 单省路径会尝试 queryLocalPolicyFingerprint + queryVpsPolicyFingerprint，
    // 两者依赖 duckdb CLI + SSH，在单测环境必然 skip/warn（evaluateFreshness 对 null 指纹返回 skip）。
    // 此断言仅验证"不会被多省早返回短路"，即 branchCode=null 不触发多省 warn 消息。
    const warnMessages = [];
    const result = await assertLocalNotStaleVsVps(
      { host: '127.0.0.1', port: 22, username: 'test', alias: 'test-alias' },
      '/nonexistent-path-for-test',
      { onWarn: (m) => warnMessages.push(m) },
      null, // branchCode=null → 单省历史路径
    );
    // 单省路径：指纹获取失败 → evaluateFreshness skip → return true；或异常捕获后 skip
    // 关键：不含"降级放行"字样（证明没走非 SC 降级分支）
    const hasDegradeMsg = warnMessages.some(m => m.includes('降级放行'));
    expect(hasDegradeMsg).toBe(false);
  });
});

// ============================================================
// 真实本地 rsync --delete 验证（P0 第 2 轮根因修复核心测试）
// 使用临时目录跑真实 rsync，不连生产 VPS
// ⚠ rsync 不可用时 skipIf 跳过，日志中会有明显提示
// ============================================================
describe('真实 rsync --delete 验证 — 裸名 SC 保护（数字/非数字开头）+ sender 隔离', () => {
  // 检查 rsync 是否可用
  const rsyncAvailable = (() => {
    try { execSync('rsync --version', { stdio: 'ignore' }); return true; } catch { return false; }
  })();

  if (!rsyncAvailable) {
    console.warn('[SKIP] rsync 不可用，跳过真实 rsync 验证组（需本机安装 rsync）');
  }

  it.skipIf(!rsyncAvailable)('SX 模式：VPS 上的数字开头裸名 SC 文件不被 --delete 删除（P0-1 旧场景）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local：只有 SX 省的文件
    writeFileSync(join(srcDir, 'SX_20260101_签单.parquet'), 'sx-data');

    // remote/VPS：有 SX 文件 + 数字开头裸名 SC 文件（生产上的四川历史分片）
    writeFileSync(join(dstDir, 'SX_20260101_签单.parquet'), 'sx-data-old');
    writeFileSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-bare-data');
    writeFileSync(join(dstDir, '20240101-20261231_02_签单清单_定稿.parquet'), 'sc-bare-data-2');

    const filterArgs = buildRsyncBranchFilterArgs('SX');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // 验证：数字开头裸名 SC 文件不被删除
    expect(existsSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, '20240101-20261231_02_签单清单_定稿.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
  });

  // ★ P0 第 2 轮根因：非数字开头裸名 SC 文件（每日数据_、01_签单清单_ 等）
  it.skipIf(!rsyncAvailable)('SX 模式：VPS 上的非数字开头裸名 SC 文件不被 --delete 删除（P0 残留修复）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local：只有 SX 省的文件
    writeFileSync(join(srcDir, 'SX_20260101_签单.parquet'), 'sx-data');

    // remote/VPS：有 SX 文件 + 非数字开头裸名 SC 文件（这是 P0 第 2 轮残留场景）
    writeFileSync(join(dstDir, 'SX_20260101_签单.parquet'), 'sx-data-old');
    // 非数字开头裸名 SC 文件：旧实现 [0-9]* 无法覆盖这类文件！
    writeFileSync(join(dstDir, '每日数据_20260101.parquet'), 'sc-daily-data');
    writeFileSync(join(dstDir, '01_签单清单_定稿.parquet'), 'sc-list-data');

    const filterArgs = buildRsyncBranchFilterArgs('SX');
    console.log('[test] SX 模式 filterArgs:', filterArgs); // 便于调试
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // ★ 关键断言（P0 第 2 轮修复验证）：非数字开头裸名 SC 文件不被 --delete 删除
    expect(existsSync(join(dstDir, '每日数据_20260101.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, '01_签单清单_定稿.parquet'))).toBe(true);
    // SX 文件正常同步
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
  });

  // ★ P0 第 2 轮：SX 模式 sender 侧，非数字开头裸名 SC 文件不被上传
  it.skipIf(!rsyncAvailable)('SX 模式 sender：本地混有非数字开头裸名 SC，不被上传（P0 残留 sender 侧修复）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local（SX 模式，但混有非数字开头裸名 SC 文件）
    writeFileSync(join(srcDir, 'SX_20260101_签单.parquet'), 'sx-data');
    writeFileSync(join(srcDir, '每日数据_20260101.parquet'), 'sc-daily-local'); // 非数字开头裸名 SC
    writeFileSync(join(srcDir, '01_签单清单_定稿.parquet'), 'sc-list-local');  // 另一种裸名 SC

    // remote/VPS 初始为空
    const filterArgs = buildRsyncBranchFilterArgs('SX');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // ★ 关键断言：非数字开头裸名 SC 文件不被上传（sender exclude *.parquet 自动覆盖）
    expect(existsSync(join(dstDir, '每日数据_20260101.parquet'))).toBe(false);
    expect(existsSync(join(dstDir, '01_签单清单_定稿.parquet'))).toBe(false);
    // SX 文件正常上传
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
  });

  it.skipIf(!rsyncAvailable)('SC 模式：VPS 上的 SX 前缀文件不被 --delete 删除（receiver protect）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local（SC 模式）：含数字和非数字开头裸名 SC 文件
    writeFileSync(join(srcDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-data');
    writeFileSync(join(srcDir, '每日数据_20260101.parquet'), 'sc-daily-data');

    // remote/VPS：有 SC 裸名文件 + SX 前缀文件（两省共存）
    writeFileSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-data-old');
    writeFileSync(join(dstDir, 'SX_20260101_签单.parquet'), 'sx-data');

    const filterArgs = buildRsyncBranchFilterArgs('SC');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // 验证：SX 文件受保护，不被删除
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
    // 验证：SC 文件正常同步
    expect(existsSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'))).toBe(true);
    expect(existsSync(join(dstDir, '每日数据_20260101.parquet'))).toBe(true);
  });

  it.skipIf(!rsyncAvailable)('SC 模式 sender：本地混有 SX 文件，SX 不被上传（sender exclude 生效）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local（SC 模式）：裸名 SC 文件 + 误混入的 SX 文件
    writeFileSync(join(srcDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-data');
    writeFileSync(join(srcDir, 'SX_20260101_签单.parquet'), 'sx-mistake-data'); // 本地误混 SX

    const filterArgs = buildRsyncBranchFilterArgs('SC');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // 验证：SX 文件不被上传（sender exclude [A-Z][A-Z]_*.parquet 生效）
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(false);
    // 验证：SC 文件正常同步
    expect(existsSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'))).toBe(true);
  });

  it.skipIf(!rsyncAvailable)('P0-2 验证：SX 模式时本地混有数字开头裸名 SC，SC 文件不被上传到 VPS', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local（SX 模式，但混有数字开头裸名 SC 文件）
    writeFileSync(join(srcDir, 'SX_20260101_签单.parquet'), 'sx-data');
    writeFileSync(join(srcDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-bare-local');

    const filterArgs = buildRsyncBranchFilterArgs('SX');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // 验证：数字开头裸名 SC 文件不被上传
    expect(existsSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'))).toBe(false);
    // 验证：SX 文件正常上传
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
  });

  // P1 强化：stale SC 本地文件在 SC 模式下真的被 block（不只是没有降级放行文案）
  it.skipIf(!rsyncAvailable)('SC 模式（stale）：旧版本 SC 文件在 VPS 上存在但本地不存在 → 被 --delete 清理（SC 同步正常行为）', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sync-vps-src-'));
    const dstDir = mkdtempSync(join(tmpdir(), 'sync-vps-dst-'));

    // local（SC 模式）：只有新版本 SC 文件
    writeFileSync(join(srcDir, '20260101-20261231_新期签单.parquet'), 'sc-new-data');

    // remote/VPS：有旧版本 SC 文件 + SX 文件
    writeFileSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'), 'sc-stale-data');
    writeFileSync(join(dstDir, 'SX_20260101_签单.parquet'), 'sx-data');

    const filterArgs = buildRsyncBranchFilterArgs('SC');
    const rsyncArgs = ['-a', '--delete', ...filterArgs, `${srcDir}/`, `${dstDir}/`];
    execSync(`rsync ${rsyncArgs.map(a => JSON.stringify(a)).join(' ')}`);

    // SC 模式 --delete：旧 SC 文件（stale）应该被删除（不是 block，这是正常的 SC 同步删除）
    expect(existsSync(join(dstDir, '20210101-20231231_01_签单清单_定稿.parquet'))).toBe(false);
    // SX 文件受保护，不被删除
    expect(existsSync(join(dstDir, 'SX_20260101_签单.parquet'))).toBe(true);
    // 新 SC 文件被同步上去
    expect(existsSync(join(dstDir, '20260101-20261231_新期签单.parquet'))).toBe(true);
  });

  it('单省字节等价验证：branchCode=null 时无 filter 参数（与历史行为相同）', () => {
    // 不跑真实 rsync，仅验证参数为空
    const args = buildRsyncBranchFilterArgs(null);
    expect(args).toEqual([]);
    expect(args).not.toContain('--filter');
    expect(args).not.toContain('--exclude');
  });
});
