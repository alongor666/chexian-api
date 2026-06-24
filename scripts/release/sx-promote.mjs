#!/usr/bin/env node
/**
 * SX Premium Cutover 脚本 — validation/SX → current/ (Option A 扁平前缀布局)
 *
 * ⚠️  诚实边界：本脚本是 Day-1 SOP 序列里的「一步」，**不负责**：
 *   - 开启 BRANCH_RLS_ENABLED（服务端安全闸，须 operator 独立核实后手动切换）
 *   - sync-vps（同步到 VPS 须另跑 `SYNC_VPS_BRANCH_CODE=SX node scripts/sync-vps.mjs --dry-run` 先验）
 *   - 发放山西账号
 *
 * 调用时机：BRANCH_RLS_ENABLED=true 已在服务端核实生效、SX parquet 在 validation/ 通过
 * ETL 质量校验后，由 operator 在 Day-1 SOP 序列中手动触发（非自动化推送）。
 *
 * 文件命名（Option A 扁平前缀）：
 *   SX premium ETL 产物形如 `每日数据_<start>_<end>.parquet`，落在 warehouse/validation/SX/
 *   promote 后目标：current/ 根下 `SX_每日数据_<start>_<end>.parquet`
 *   格局：`SX_*.parquet`（二字母大写前缀）— 与 sync-vps buildRsyncBranchFilterArgs('SX')
 *           的 `SX_*.parquet` glob 完全对齐；SC 裸名文件永不被误匹配。
 *
 * 互斥安全：data-bootstrapper.ts 的 GATED fail-closed 检测「扁平顶层 parquet 与省份子目录 parquet
 *   并存」会拦截 → 扁平 SX_ 前缀文件**不建子目录**，与 bootstrap 互斥闸完全相容。
 *   Pass 2 子目录枚举仅匹配 ^[A-Z]{2}$ **目录**（不匹配文件），SX_ 前缀文件是顶层扁平文件，
 *   branch = undefined，不触发任何子目录闸。
 *
 * 用法：
 *   node scripts/release/sx-promote.mjs              # 默认 dry-run：打印计划，不写文件
 *   node scripts/release/sx-promote.mjs --apply      # 真实复制 + duckdb 校验 + 失败自动回滚
 *   node scripts/release/sx-promote.mjs --apply --force  # 允许覆盖已存在的 SX_ 文件（仅 SX_ 前缀）
 *   node scripts/release/sx-promote.mjs --target-dir /tmp/test-current  # 指定目标目录（测试用）
 *   node scripts/release/sx-promote.mjs --source-dir /custom/path       # 覆盖源目录（测试用）
 *
 * 退出码：
 *   0 — 成功（dry-run 打印完毕 / apply 校验全通过）
 *   1 — 失败（源文件不存在 / 目标冲突 / duckdb 校验不一致 → 已自动回滚）
 *
 * 相关：
 *   数据管理/lib/branch-naming.mjs       — SX 输出根逻辑（branchOutputRoot）
 *   scripts/sync-vps.mjs               — buildRsyncBranchFilterArgs('SX') / SX_ glob
 *   server/src/services/data-bootstrapper.ts — 互斥闸（GATED fail-closed）
 */

import {
  existsSync, mkdirSync, readdirSync, statSync,
  copyFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─────────────────────────── 路径常量 ───────────────────────────

const __filename = fileURLToPath(import.meta.url);
// scripts/release/sx-promote.mjs → 项目根
const PROJECT_ROOT = resolve(__filename, '../../..');

const WAREHOUSE_ROOT = join(PROJECT_ROOT, '数据管理', 'warehouse');
const DEFAULT_SOURCE_DIR = join(WAREHOUSE_ROOT, 'validation', 'SX');
const DEFAULT_TARGET_DIR = join(WAREHOUSE_ROOT, 'fact', 'policy', 'current');

// SX parquet 文件的两字母大写前缀（与 sync-vps buildRsyncBranchFilterArgs 完全对齐）
const BRANCH_PREFIX = 'SX';
const BRANCH_PAT = `${BRANCH_PREFIX}_`;

// duckdb 校验：保费字段允许万分之一浮点容差（含舍入误差）
const PREMIUM_TOLERANCE = 1e-4;

// ─────────────────────────── 参数解析 ───────────────────────────

const argv = process.argv.slice(2);
const args = {
  apply: false,
  force: false,
  sourceDir: null,
  targetDir: null,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eat = () => argv[++i];
  if (a === '--apply') args.apply = true;
  else if (a === '--force') args.force = true;
  else if (a === '--source-dir') args.sourceDir = resolve(eat());
  else if (a === '--target-dir') args.targetDir = resolve(eat());
  else if (a === '--help' || a === '-h') {
    console.log('见文件头注释。用法：node scripts/release/sx-promote.mjs [--apply] [--force] [--target-dir <dir>] [--source-dir <dir>]');
    process.exit(0);
  } else {
    console.error(`❌ 未知参数: ${a}（见 --help）`);
    process.exit(1);
  }
}

const sourceDir = args.sourceDir || DEFAULT_SOURCE_DIR;
const targetDir = args.targetDir || DEFAULT_TARGET_DIR;

// ─────────────────────────── 日志工具 ───────────────────────────

function log(level, msg) {
  const PREFIX = { info: 'ℹ', ok: '✅', warn: '⚠️ ', error: '❌', plan: '📋', dryrun: '🔍' };
  console.log(`${PREFIX[level] ?? level}  ${msg}`);
}

// ─────────────────────────── 安全护栏 ───────────────────────────

/**
 * 禁子目录护栏：目标路径下不得创建 [A-Z]{2} 形式的子目录。
 * bootstrap Pass 2 仅枚举 ^[A-Z]{2}$ 目录，一旦检测到扁平 SX_ 文件与子目录并存即 fail-closed。
 * 本脚本只写顶层扁平文件，严格禁止建子目录。
 * @param {string} targetRoot
 */
function assertNoSubdirIntent(targetRoot) {
  // 检查 targetRoot 本身是否是 current/<省>/ 子目录形式（防误传 --target-dir current/SX）
  const dirName = basename(targetRoot);
  if (/^[A-Z]{2}$/.test(dirName)) {
    throw new Error(
      `[sx-promote] --target-dir "${targetRoot}" 末段是省码目录格式（${dirName}），` +
      `这会在 current/ 下建子目录，触发 bootstrap GATED fail-closed。` +
      `应传 current/ 根目录，而非省份子目录。`
    );
  }
}

/**
 * --force 安全护栏：只允许覆盖 SX_ 前缀文件，绝不允许覆盖 SC 裸名或其他省前缀文件。
 * @param {string} filename
 */
function assertForceOnlyOnSxFiles(filename) {
  if (!filename.startsWith(BRANCH_PAT)) {
    throw new Error(
      `[sx-promote] --force 仅允许覆盖 ${BRANCH_PAT}* 前缀文件，拒绝覆盖: ${filename}。` +
      `此护栏防止误删 SC 数据。`
    );
  }
}

// ─────────────────────────── duckdb 校验（Python inline） ───────────────────────────

/**
 * 用 Python duckdb 包统计 parquet 文件的 COUNT(*) 和 SUM(premium)。
 * 沿用 daily.mjs 的 Python inline + spawnSync 模式（无需独立 duckdb CLI）。
 *
 * @param {string} parquetPath  单个 parquet 文件路径
 * @returns {{ rowCount: number, premiumSum: number | null }}
 */
function duckdbStats(parquetPath) {
  const script = `
import sys, json, duckdb
path = sys.argv[1].replace("'", "''")
# 尝试查 pure_risk_premium 字段（premium 域主保费字段）；若字段不存在则 premiumSum=null
try:
    row = duckdb.sql(f"SELECT COUNT(*), SUM(pure_risk_premium) FROM read_parquet('{path}')").fetchone()
    print(json.dumps({"rowCount": row[0], "premiumSum": float(row[1]) if row[1] is not None else None}))
except Exception as e:
    # 字段不存在或其他 schema 差异：只返回行数
    try:
        row2 = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{path}')").fetchone()
        print(json.dumps({"rowCount": row2[0], "premiumSum": None, "premiumNote": str(e)}))
    except Exception as e2:
        print(json.dumps({"error": str(e2)}))
        sys.exit(1)
`.trim();

  const python = 'python3';
  const result = spawnSync(python, ['-', parquetPath], {
    input: script,
    encoding: 'utf-8',
    windowsHide: true,
  });

  if (result.error) throw new Error(`[duckdb] spawnSync 启动失败: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`[duckdb] python3 非零退出 (${result.status}):\n${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout.trim());
  if (parsed.error) throw new Error(`[duckdb] 查询错误: ${parsed.error}`);
  if (parsed.premiumNote) {
    log('warn', `  premium 字段不可用（${parsed.premiumNote}），仅校验行数`);
  }
  return { rowCount: Number(parsed.rowCount), premiumSum: parsed.premiumSum };
}

// ─────────────────────────── 文件发现 ───────────────────────────

/**
 * 扫描 sourceDir，收集所有 *.parquet 文件。
 * SX ETL 产出格式：`每日数据_<start>_<end>.parquet`（与 SC current/ 同格式）。
 * 按文件名字典序排列，保证输出确定性。
 *
 * @returns {Array<{name: string, srcPath: string, dstName: string, dstPath: string}>}
 */
function discoverSourceFiles() {
  if (!existsSync(sourceDir)) {
    log('error', `源目录不存在: ${sourceDir}`);
    log('error', `  SX premium ETL 产物应落在 warehouse/validation/SX/`);
    log('error', `  请先运行: BRANCH_CODE=SX node 数据管理/daily.mjs premium`);
    process.exit(1);
  }

  const entries = readdirSync(sourceDir).filter(f => f.endsWith('.parquet')).sort();

  if (entries.length === 0) {
    log('warn', `源目录无 parquet 文件: ${sourceDir}`);
    log('warn', `  请先运行 SX premium ETL 生成分片`);
    return [];
  }

  return entries.map(name => {
    // 禁止：源文件已有省前缀（防重复 promote 产生 SX_SX_ 嵌套）
    if (name.startsWith(BRANCH_PAT)) {
      throw new Error(
        `[sx-promote] 源文件 "${name}" 已带 ${BRANCH_PAT} 前缀，` +
        `疑似之前 promote 产物被误放回 validation/SX。请检查源目录。`
      );
    }
    const dstName = `${BRANCH_PAT}${name}`;  // SX_每日数据_<start>_<end>.parquet
    return {
      name,
      srcPath: join(sourceDir, name),
      dstName,
      dstPath: join(targetDir, dstName),
    };
  });
}

// ─────────────────────────── 计划打印（dry-run） ───────────────────────────

/**
 * 打印 dry-run 计划（不写任何文件）。
 * @param {ReturnType<typeof discoverSourceFiles>} files
 */
function printPlan(files) {
  log('dryrun', `【DRY-RUN 模式】不会写入任何文件。传 --apply 才真实复制。`);
  console.log('');
  log('plan', `源目录: ${sourceDir}`);
  log('plan', `目标目录: ${targetDir}`);
  console.log('');

  if (files.length === 0) {
    log('warn', '无可 promote 的 parquet 文件。');
    return;
  }

  console.log(`  ${'源文件名'.padEnd(50)} → ${'目标文件名（SX_ 前缀）'}`);
  console.log('  ' + '─'.repeat(90));

  for (const f of files) {
    const srcStat = statSync(f.srcPath);
    const srcMB = (srcStat.size / 1024 / 1024).toFixed(1);
    const exists = existsSync(f.dstPath) ? ' [已存在]' : '';
    console.log(`  ${f.name.padEnd(50)} → ${f.dstName}  (${srcMB} MB)${exists}`);
  }

  console.log('');
  console.log(`  共 ${files.length} 个文件`);

  // 预读行数统计（用 Python pyarrow，快速 metadata-only）
  console.log('');
  log('plan', '预读源文件行数/保费（metadata 只读，不加载全量数据）...');

  let totalRows = 0;
  let totalPremium = 0;
  let premiumAvailable = true;
  for (const f of files) {
    try {
      const { rowCount, premiumSum } = duckdbStats(f.srcPath);
      totalRows += rowCount;
      if (premiumSum !== null) {
        totalPremium += premiumSum;
      } else {
        premiumAvailable = false;
      }
      const pStr = premiumSum !== null ? `  保费合计: ${premiumSum.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '';
      console.log(`    ${f.name}: ${rowCount.toLocaleString()} 行${pStr}`);
    } catch (e) {
      log('warn', `  ${f.name} 行数读取失败（非阻断）: ${e.message}`);
      premiumAvailable = false;
    }
  }

  console.log('');
  log('plan', `总计: ${totalRows.toLocaleString()} 行${premiumAvailable ? `，保费合计 ${totalPremium.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '（保费字段不可用）'}`);
  log('info', `promote 后文件名: SX_*.parquet（与 sync-vps buildRsyncBranchFilterArgs('SX') glob 对齐）`);
  log('info', `bootstrap 兼容性: 扁平顶层文件，branch=undefined，不触发子目录互斥闸`);
  console.log('');
  log('dryrun', `确认无误后，运行：node scripts/release/sx-promote.mjs --apply`);
}

// ─────────────────────────── 主 promote 逻辑 ───────────────────────────

/**
 * 执行实际 promote：复制 + duckdb 校验 + 失败自动回滚。
 * @param {ReturnType<typeof discoverSourceFiles>} files
 */
async function applyPromote(files) {
  log('info', `【APPLY 模式】正式 promote：${files.length} 个文件`);
  log('info', `  源: ${sourceDir}`);
  log('info', `  目标: ${targetDir}`);
  console.log('');

  // 确保目标目录存在
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    log('info', `已创建目标目录: ${targetDir}`);
  }

  // 护栏：目标目录不得是省份子目录形式
  assertNoSubdirIntent(targetDir);

  const copiedFiles = [];  // 用于回滚
  const manifest = {
    promotedAt: new Date().toISOString(),
    sourceDir,
    targetDir,
    files: [],
    summary: null,
  };

  let allPassed = true;

  for (const f of files) {
    console.log('');
    log('info', `处理: ${f.name} → ${f.dstName}`);

    // 检查目标是否已存在
    if (existsSync(f.dstPath)) {
      if (!args.force) {
        log('error', `  目标已存在: ${f.dstPath}`);
        log('error', `  传 --force 覆盖（仅限 SX_ 前缀文件）。`);
        // 非强制时跳过，但不算失败（幂等）
        log('warn', `  跳过（幂等：目标已存在，未修改）`);
        manifest.files.push({ name: f.name, dstName: f.dstName, status: 'skipped_exists' });
        continue;
      } else {
        // --force：只允许覆盖 SX_ 前缀文件（护栏）
        assertForceOnlyOnSxFiles(f.dstName);
        log('warn', `  --force：覆盖已存在文件 ${f.dstName}`);
      }
    }

    // Step 1：先读源文件统计（校验基准）
    let srcStats;
    try {
      srcStats = duckdbStats(f.srcPath);
      log('info', `  源统计: ${srcStats.rowCount.toLocaleString()} 行` +
        (srcStats.premiumSum !== null ? `，保费合计 ${srcStats.premiumSum.toFixed(2)}` : ''));
    } catch (e) {
      log('error', `  源文件 duckdb 统计失败: ${e.message}`);
      allPassed = false;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'failed', error: e.message });
      continue;
    }

    // Step 2：原子写（先写临时文件，再 rename）
    const tmpPath = `${f.dstPath}.tmp_sx_promote`;
    try {
      // 清理旧 tmp（防残留）
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      copyFileSync(f.srcPath, tmpPath);
      renameSync(tmpPath, f.dstPath);
      copiedFiles.push(f.dstPath);
      log('ok', `  已复制: ${f.dstName}`);
    } catch (e) {
      // 清理 tmp
      if (existsSync(tmpPath)) { try { unlinkSync(tmpPath); } catch {} }
      log('error', `  复制失败: ${e.message}`);
      allPassed = false;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'failed', error: e.message });
      continue;
    }

    // Step 3：promote 后校验（目标文件的 duckdb stats）
    let dstStats;
    try {
      dstStats = duckdbStats(f.dstPath);
      log('info', `  目标统计: ${dstStats.rowCount.toLocaleString()} 行` +
        (dstStats.premiumSum !== null ? `，保费合计 ${dstStats.premiumSum.toFixed(2)}` : ''));
    } catch (e) {
      log('error', `  目标文件 duckdb 校验失败: ${e.message}`);
      allPassed = false;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'verify_failed', error: e.message,
        srcStats, dstStats: null });
      continue;
    }

    // Step 4：严格比对
    const rowsMatch = srcStats.rowCount === dstStats.rowCount;
    const premiumMatch = (srcStats.premiumSum === null || dstStats.premiumSum === null)
      ? true  // 字段不可用时跳过保费校验（仅校验行数）
      : Math.abs(srcStats.premiumSum - dstStats.premiumSum) / (Math.abs(srcStats.premiumSum) || 1) < PREMIUM_TOLERANCE;

    if (!rowsMatch) {
      log('error', `  行数不一致！源=${srcStats.rowCount}，目标=${dstStats.rowCount}，差值=${dstStats.rowCount - srcStats.rowCount}`);
      allPassed = false;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'mismatch',
        srcStats, dstStats, mismatch: 'row_count' });
      continue;
    }
    if (!premiumMatch) {
      const diff = Math.abs((srcStats.premiumSum ?? 0) - (dstStats.premiumSum ?? 0));
      const rel = diff / (Math.abs(srcStats.premiumSum ?? 1) || 1);
      log('error', `  保费不一致！差值=${diff.toFixed(4)}（相对偏差=${(rel * 100).toFixed(6)}%，阈值=${(PREMIUM_TOLERANCE * 100).toFixed(4)}%）`);
      allPassed = false;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'mismatch',
        srcStats, dstStats, mismatch: 'premium' });
      continue;
    }

    log('ok', `  校验通过: 行数 ${srcStats.rowCount.toLocaleString()}` +
      (srcStats.premiumSum !== null ? `，保费偏差 < 万分之一` : '（仅行数校验）'));
    manifest.files.push({
      name: f.name, dstName: f.dstName, status: 'ok',
      srcStats, dstStats,
    });
  }

  console.log('');

  // ─── 失败处理：自动回滚本次复制的所有 SX_ 文件 ───
  if (!allPassed) {
    log('error', '校验失败，自动回滚本次 promote 的文件...');
    const rolledBack = [];
    for (const p of copiedFiles) {
      // 只回滚本次复制成功的（已在 copiedFiles 里的），且只删 SX_ 前缀
      const fn = basename(p);
      if (!fn.startsWith(BRANCH_PAT)) {
        log('warn', `  跳过非 SX_ 文件（不应出现）: ${fn}`);
        continue;
      }
      try {
        unlinkSync(p);
        rolledBack.push(fn);
        log('ok', `  已回滚删除: ${fn}`);
      } catch (e) {
        log('error', `  回滚删除失败（需人工处理）: ${fn}: ${e.message}`);
      }
    }
    manifest.summary = { status: 'FAILED_ROLLED_BACK', rolledBack };
    writeManifest(manifest);
    log('error', `promote 失败，已回滚 ${rolledBack.length} 个文件。`);
    process.exit(1);
  }

  // ─── 全部通过 ───
  const okFiles = manifest.files.filter(f => f.status === 'ok');
  const skippedFiles = manifest.files.filter(f => f.status === 'skipped_exists');
  manifest.summary = {
    status: 'SUCCESS',
    totalPromoted: okFiles.length,
    totalSkipped: skippedFiles.length,
    totalRows: okFiles.reduce((s, f) => s + (f.srcStats?.rowCount ?? 0), 0),
    totalPremium: okFiles.every(f => f.srcStats?.premiumSum !== null)
      ? okFiles.reduce((s, f) => s + (f.srcStats?.premiumSum ?? 0), 0)
      : null,
  };

  writeManifest(manifest);

  console.log('');
  log('ok', `SX promote 完成！`);
  log('ok', `  已 promote: ${okFiles.length} 个文件，共 ${manifest.summary.totalRows.toLocaleString()} 行` +
    (manifest.summary.totalPremium !== null ? `，保费合计 ${manifest.summary.totalPremium.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : ''));
  if (skippedFiles.length > 0) {
    log('info', `  已跳过（目标已存在）: ${skippedFiles.length} 个文件`);
  }
  console.log('');
  log('info', '⬇  后续步骤（需 operator 手动确认后执行）：');
  log('info', '   1. 确认服务端 BRANCH_RLS_ENABLED=true 已生效（SX 用户只能查 SX 数据）');
  log('info', '   2. 同步到 VPS（先 dry-run）:');
  log('info', '      SYNC_VPS_BRANCH_CODE=SX node scripts/sync-vps.mjs --dry-run');
  log('info', '      SYNC_VPS_BRANCH_CODE=SX node scripts/sync-vps.mjs');
  log('info', '   3. PM2 reload: sudo /usr/local/bin/deploy-chexian-api reload');
  log('info', '   4. 健康检查: curl https://chexian.cretvalu.com/health');
}

// ─────────────────────────── Manifest 落盘 ───────────────────────────

function writeManifest(manifest) {
  const outPath = join(PROJECT_ROOT, 'scripts', 'release', '.sx-promote-manifest.json');
  try {
    writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
    log('info', `清单已落盘: ${outPath}`);
  } catch (e) {
    log('warn', `清单落盘失败（非阻断）: ${e.message}`);
    console.log(JSON.stringify(manifest, null, 2));
  }
}

// ─────────────────────────── 主入口 ───────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SX Premium Cutover — validation/SX → current/ (Option A)');
  console.log(`  模式: ${args.apply ? '【APPLY】' : '【DRY-RUN（默认）】'}${args.force ? ' [--force]' : ''}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // 护栏：目标目录不得是省份子目录格式
  try {
    assertNoSubdirIntent(targetDir);
  } catch (e) {
    log('error', e.message);
    process.exit(1);
  }

  // 发现源文件
  let files;
  try {
    files = discoverSourceFiles();
  } catch (e) {
    log('error', e.message);
    process.exit(1);
  }

  if (!args.apply) {
    printPlan(files);
  } else {
    await applyPromote(files);
  }
}

main().catch(e => {
  log('error', `未捕获错误: ${e.message}`);
  process.exit(1);
});
