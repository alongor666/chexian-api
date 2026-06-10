#!/usr/bin/env node
/**
 * 主 ETL 脚本：3层分片架构（cold/warm/hot）+ 分域支持
 *
 * 分片类型（由 shard-config.json 配置边界）：
 *   static  — 签单日期 <= static_cutoff，已满期1年+，永不重新转换
 *   weekly  — 签单日期 >= weekly_start，每周日重新转换
 *   daily   — 日增量小文件，转到 staging/（不进 current/）
 *
 * 输出目录结构：
 *   warehouse/fact/policy/current/   ← 保单+保费（多分片文件）
 *   warehouse/fact/policy/staging/   ← 日增量暂存（周更时清空）
 *   warehouse/fact/claims_detail/claims_*.parquet  ← 赔案明细
 *   warehouse/fact/quotes_conversion/latest.parquet ← 报价转化
 *
 * 用法：
 *   node daily.mjs                # 自动处理 premium 分片
 *   node daily.mjs claims         # 全量替换赔付+费用域（已废弃）
 *   node daily.mjs claims_detail  # 全量替换赔案明细域 + claims 聚合
 *   node daily.mjs quotes         # 全量替换报价清单域
 *   node daily.mjs cross_sell     # 全量替换交叉销售域
 *   node daily.mjs brand          # 全量替换厂牌维度表
 *   node daily.mjs repair         # 全量替换维修资源域
 *   node daily.mjs customer_flow  # 08/09 每日全量快照 → 客户来源去向
 *   node daily.mjs new_energy_claims # 新能源出险信息每日全量快照
 *   node daily.mjs renewal_tracker # 续保追踪派生域（JOIN policy+quotes+salesman）
 *   node daily.mjs all            # 全部域（含派生域）
 *   node daily.mjs --no-sync      # 跳过 VPS 同步
 *   node daily.mjs --skip-report  # 跳过短中长期 HTML 报告生成
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, rmdirSync, copyFileSync, rmSync, openSync, closeSync } from 'fs';
import { basename, dirname, extname, join, resolve, isAbsolute } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import {
  getParquetRowCount,
  getParquetColumnCount,
  getPartitionedRowCount,
  getPartitionedColumnCount,
  getPartitionedMaxReportDate,
} from './pipelines/parquet_stats.mjs';
import { collectPolicyCurrentStats, syncQuickReferenceFile } from './pipelines/quick_reference.mjs';
import { assertNoPolicyCurrentOverlap } from '../scripts/lib/parquet-overlap-check.mjs';
// 分片判定纯函数抽到 lib/shard-classify.mjs（可单测，daily.mjs 顶层执行 main() 无法被 import）
import { formatDate, extractDateRange, getShardType } from './lib/shard-classify.mjs';
// claims 报案截止日新鲜度判定纯函数（同模式抽 lib/ 便于单测）
import {
  claimsReportLagDays,
  shouldWarnClaimsFreshness,
  localTodayISO,
  CLAIMS_REPORT_LAG_WARN_DAYS,
} from './lib/claims-freshness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 颜色与日志 ──

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ── 环境变量加载（轻量 dotenv，仅 daily.mjs 使用，不污染全局） ──
// 读取 chexian-api 根目录 .env.local，不覆盖已设置的 process.env
function loadEnvLocal(scriptDir) {
  const envPath = join(scriptDir, '..', '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawVal.replace(/^['"](.*)['"]$/, '$1');
  }
}

// ── 工具函数 ──

function isWindows() {
  return platform() === 'win32';
}

function findPython() {
  const pythonCmds = isWindows() ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cmd of pythonCmds) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch (e) { /* next */ }
  }
  throw new Error('未找到 Python，请确保已安装 Python 并添加到 PATH');
}

function ls(pattern, dir = '.') {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) return [];
  // 先转义除通配符 * ? 外的所有正则元字符（如 .()+ 等），再把 glob 通配符转正则，
  // 避免 `每日数据_*.xlsx` 里的 `.` 被当成"任意字符"而过匹配。
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return readdirSync(absDir)
    .filter(f => regex.test(f))
    // 浏览器重复下载残留（`xxx (1).xlsx`）一律不入 ETL —— FineBI/Chrome 在输出目录的
    // 原始残留与正式导出文件同名异本，混入会双倍计入（2026-06-10 上游交接 §4）
    .filter(f => !/\s?\(\d+\)\.xlsx$/i.test(f))
    .map(f => ({ name: f, path: join(absDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileFingerprint(path) {
  const stat = statSync(path);
  return {
    path,
    name: basename(path),
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
    sha256: sha256File(path),
  };
}

// formatDate（YYYYMMDD）已抽到 lib/shard-classify.mjs 并 import。
// 归档文件名用秒级精度，避免同日多次运行覆盖当日已归档的上一版（YYYYMMDD_HHMMSS）。
function formatDateTime() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeJson(path, payload) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

// 确保 pipelines 包可被 import（from pipelines.xxx import ...）；Windows 上强制 UTF-8
function buildPythonEnv() {
  const env = { ...process.env };
  const existingPath = env.PYTHONPATH || '';
  const sep = isWindows() ? ';' : ':';
  env.PYTHONPATH = existingPath ? `${__dirname}${sep}${existingPath}` : __dirname;
  if (isWindows()) {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }
  return env;
}

function runPythonScript(python, scriptPath, args) {
  // spawnSync 数组传参不经过 shell：彻底消除文件名含 $ / 反引号 / 空格 触发的注入与拆分。
  // 历史调用点用 `"${path}"` 包裹参数以适配旧的 shell 字符串拼接；这里剥离每个参数最外层
  // 的一对双引号（spawnSync 按字面量传递，剥离后即为真实路径，对未加引号的 flag 是 no-op）。
  const cleanArgs = args.map(a => {
    const s = String(a);
    return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  });
  log('blue', `执行: ${python} ${scriptPath} ${cleanArgs.join(' ')}`);
  const result = spawnSync(python, [scriptPath, ...cleanArgs], {
    stdio: 'inherit',
    cwd: __dirname,
    env: buildPythonEnv(),
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  // execSync 会在非零退出/超时时抛错，调用方（try/catch、try/finally）依赖此行为；
  // spawnSync 不抛，需手动还原：超时/启动失败抛 result.error，非零退出抛带退出码的错误。
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`python 脚本失败 (exit=${result.status}): ${basename(scriptPath)}`);
  }
}

function runPythonInline(python, script, args = []) {
  const result = spawnSync(python, ['-', ...args], {
    input: script,
    encoding: 'utf-8',
    cwd: __dirname,
    env: buildPythonEnv(),
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `python inline script failed with code ${result.status}`);
  }
  return result.stdout.trim();
}

function assertSqlIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`非法 ${label}: ${value}`);
  }
}

function validateDomainCandidate(python, domainId, parquetPath, validation) {
  if (!validation) return;
  const dateColumn = validation.date_column || 'insurance_start_date';
  assertSqlIdentifier(dateColumn, 'date_column');
  for (const field of Object.keys(validation.require_non_null || {})) {
    assertSqlIdentifier(field, 'require_non_null 字段');
  }

  const script = `
import json
import sys
import duckdb

path = sys.argv[1].replace("'", "''")
cfg = json.loads(sys.argv[2])
date_col = cfg.get("date_column") or "insurance_start_date"
require_non_null = cfg.get("require_non_null") or {}

selects = ["COUNT(*) AS row_count"]
if cfg.get("min_date") or cfg.get("max_date"):
    selects.append(f"CAST(MIN(CAST({date_col} AS DATE)) AS VARCHAR) AS min_date")
    selects.append(f"CAST(MAX(CAST({date_col} AS DATE)) AS VARCHAR) AS max_date")
for field in require_non_null:
    selects.append(f"COUNT(NULLIF(TRIM({field}), '')) AS {field}__non_null")

sql = f"SELECT {', '.join(selects)} FROM read_parquet('{path}')"
cursor = duckdb.sql(sql)
row = cursor.fetchone()
cols = [desc[0] for desc in cursor.description]
print(json.dumps(dict(zip(cols, row)), ensure_ascii=False, default=str))
`.trim();

  const stats = JSON.parse(runPythonInline(python, script, [parquetPath, JSON.stringify(validation)]));
  const failures = [];
  if (validation.min_rows != null && Number(stats.row_count) < Number(validation.min_rows)) {
    failures.push(`row_count ${stats.row_count} < min_rows ${validation.min_rows}`);
  }
  if (validation.min_date && !stats.min_date) {
    failures.push(`min_date is empty; required <= ${validation.min_date}`);
  } else if (validation.min_date && stats.min_date > validation.min_date) {
    failures.push(`min_date ${stats.min_date} > required ${validation.min_date}`);
  }
  if (validation.max_date && !stats.max_date) {
    failures.push(`max_date is empty; required >= ${validation.max_date}`);
  } else if (validation.max_date && stats.max_date < validation.max_date) {
    failures.push(`max_date ${stats.max_date} < required ${validation.max_date}`);
  }
  for (const [field, minCount] of Object.entries(validation.require_non_null || {})) {
    const actual = Number(stats[`${field}__non_null`] || 0);
    if (actual < Number(minCount)) {
      failures.push(`${field} non_null ${actual} < required ${minCount}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${domainId} 候选 parquet 未通过替换前校验: ${failures.join('; ')}`);
  }
  log('green', `  ✅ ${domainId} 候选 parquet 校验通过: rows=${Number(stats.row_count).toLocaleString()}`);
}

function checkVpsConnectivity() {
  try {
    execSync('ssh -o BatchMode=yes -o ConnectTimeout=10 chexian-vps-deploy true', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// ── 互斥锁（防止 cron + 手动并发损坏归档/替换）──

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // EPERM = 进程存在但无权限发信号 → 视为存活
}

function acquireLock(scriptDir) {
  const lockPath = join(scriptDir, '.daily.lock');
  try {
    const fd = openSync(lockPath, 'wx'); // O_EXCL：已存在则抛 EEXIST
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let holderPid = null;
    try { holderPid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10) || null; } catch (_) {}
    if (isProcessAlive(holderPid)) {
      log('red', `❌ 另一个 daily.mjs 实例正在运行 (pid=${holderPid})，本次中止以避免并发归档/替换冲突`);
      log('yellow', `   若确认无运行实例，手动删除: ${lockPath}`);
      process.exit(1);
    }
    log('yellow', `⚠ 发现陈旧锁 (pid=${holderPid ?? '?'} 已退出)，接管`);
    unlinkSync(lockPath);
    return acquireLock(scriptDir);
  }
  // 所有退出路径（含 process.exit 与信号）都释放锁
  const release = () => { try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch (_) {} };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
  return lockPath;
}

// ── 分片逻辑 ──
// extractDateRange / getShardType 已抽到 lib/shard-classify.mjs（可单测）并 import。

/** xlsx 比 parquet 更新时返回 true */
function isCacheStale(xlsxPath, parquetPath) {
  if (!existsSync(parquetPath)) return true;
  return statSync(xlsxPath).mtimeMs > statSync(parquetPath).mtimeMs;
}

/** 清空 staging 目录中的 parquet 文件 */
function cleanStaging(stagingDir) {
  if (!existsSync(stagingDir)) return;
  const files = readdirSync(stagingDir).filter(f => f.endsWith('.parquet'));
  for (const f of files) {
    unlinkSync(join(stagingDir, f));
    log('yellow', `🗑  清理 staging: ${f}`);
  }
}

// ── data-sources.json 自动更新 ──

const DATA_SOURCES_PATH = join(__dirname, 'data-sources.json');
const QUICK_REFERENCE_PATH = join(__dirname, 'knowledge/QUICK_REFERENCE.md');

function updateDataSources(domainId, { rowCount, fieldCount, dataRange } = {}) {
  try {
    if (!existsSync(DATA_SOURCES_PATH)) return;
    const config = JSON.parse(readFileSync(DATA_SOURCES_PATH, 'utf-8'));
    const domain = config.domains?.find(d => d.id === domainId);
    if (!domain) { log('yellow', `  ⚠️ data-sources.json 中未找到域 '${domainId}'`); return; }

    domain.last_updated = new Date().toISOString().slice(0, 10);
    if (rowCount != null) domain.row_count = rowCount;
    if (fieldCount != null) domain.field_count = fieldCount;
    if (dataRange != null) domain.data_range = dataRange;

    writeFileSync(DATA_SOURCES_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    log('green', `  📋 data-sources.json 已更新: ${domainId} (rows=${rowCount?.toLocaleString() ?? '-'})`);
  } catch (e) {
    log('yellow', `  ⚠️ data-sources.json 更新失败: ${e.message}`);
  }
}

function updateQuickReference(python, policyCurrentDir) {
  try {
    const stats = collectPolicyCurrentStats(python, policyCurrentDir);
    if (!stats) {
      log('yellow', '  ⚠️ QUICK_REFERENCE.md 跳过：未找到 policy/current/*.parquet');
      return;
    }
    const line = syncQuickReferenceFile(QUICK_REFERENCE_PATH, stats);
    if (line) log('green', `  📝 QUICK_REFERENCE.md 已更新: ${line}`);
  } catch (e) {
    log('yellow', `  ⚠️ QUICK_REFERENCE.md 更新失败: ${e.message}`);
  }
}

// ── 分域处理 ──
// getParquetRowCount / getParquetColumnCount / getPartitionedRowCount /
// getPartitionedColumnCount 已抽到 pipelines/parquet_stats.mjs

const WAREHOUSE = join(__dirname, 'warehouse/fact');
const CLAIMS_DETAIL_DIR = join(WAREHOUSE, 'claims_detail');
const CLAIMS_DETAIL_PATH = join(CLAIMS_DETAIL_DIR, 'latest.parquet');
// 标准域路径（cross_sell/quotes_conversion/brand/repair_resource/customer_flow）
// 由 runStandardDomain 从 data-sources.json:domains[*].output 派生，无需在此声明常量。

// ── 通用域执行器（声明式 manifest 驱动） ──

const _MANIFEST_CACHE = {};

// 模块级发布 manifest；由 main() 在启动时根据 --manifest 参数设置。
// runClaimsDetail / runRenewalTracker 等函数通过它判断是否跳过 metadata 写入，
// 避免改动所有函数签名。
let _currentReleaseManifest = null;

/** 从 data-sources.json 读取域配置（含 trigger 子对象） */
function loadDomainManifest(scriptDir, domainId) {
  if (!_MANIFEST_CACHE._loaded) {
    const cfg = JSON.parse(readFileSync(join(scriptDir, 'data-sources.json'), 'utf-8'));
    for (const d of cfg.domains) _MANIFEST_CACHE[d.id] = d;
    _MANIFEST_CACHE._loaded = true;
  }
  return _MANIFEST_CACHE[domainId];
}

// ── 发布 manifest（可选，由 --manifest <path> 触发） ──
//
// manifest 驱动流程：声明本次发布的 domain 范围 + 期望日期，并让所有 data-sources.json
// 写入在流程末尾由 refresh_metadata.py 单点执行。消除 #4 双写漂移根因。
//
// 无 --manifest 时所有行为保持旧逻辑，完全向后兼容（cron / /daily-sync 不受影响）。

function parseManifestArg(argv) {
  const idx = argv.indexOf('--manifest');
  return idx >= 0 ? argv[idx + 1] : null;
}

function loadReleaseManifest(scriptDir, manifestArg) {
  if (!manifestArg) return null;
  const path = isAbsolute(manifestArg) ? manifestArg : join(scriptDir, '..', manifestArg);
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  log('cyan', `📋 发布 manifest: ${basename(path)} (run_id=${m.run_id}, ${Object.keys(m.domains || {}).length} 域)`);
  return m;
}

function extractBatchDateFromName(filename) {
  const match = /^(\d{8})_/.exec(filename);
  return match ? match[1] : null;
}

function collectSourceFiles(inputGlobs, scriptDir) {
  const seen = new Set();
  const groups = inputGlobs.map(glob => ({
    glob,
    files: ls(glob, scriptDir).filter(f => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    }),
  }));
  return {
    groups,
    all: groups.flatMap(g => g.files),
  };
}

function resolveSourceFilesForTrigger(id, inputGlobs, scriptDir, trigger) {
  const { groups, all } = collectSourceFiles(inputGlobs, scriptDir);
  if (all.length === 0) return { sourceFiles: [], batchDate: null };

  if (trigger.snapshot_mode === 'full_batch_replace' || trigger.required_same_batch === true) {
    const dateSets = groups.map(group => {
      const dates = new Set(group.files.map(f => extractBatchDateFromName(f.name)).filter(Boolean));
      if (dates.size === 0) {
        throw new Error(`${id} full_snapshot 输入 ${group.glob} 未找到带 YYYYMMDD_ 前缀的文件`);
      }
      return dates;
    });
    const commonDates = [...dateSets[0]].filter(date => dateSets.every(s => s.has(date))).sort().reverse();
    if (commonDates.length === 0) {
      const byGlob = groups.map(g => `${g.glob}: ${[...new Set(g.files.map(f => extractBatchDateFromName(f.name)).filter(Boolean))].sort().join(', ') || '无'}`);
      throw new Error(`${id} full_snapshot 没有完整批次；${byGlob.join(' / ')}`);
    }
    const batchDate = commonDates[0];
    const selected = groups.map(group =>
      group.files
        .filter(f => extractBatchDateFromName(f.name) === batchDate)
        .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs)[0]
    );
    if (all.length !== selected.length) {
      log('cyan', `  full_snapshot：${all.length} 个候选 → 选择最新完整批次 ${batchDate} (${selected.map(f => f.name).join(', ')})`);
    }
    return { sourceFiles: selected, batchDate };
  }

  return { sourceFiles: all, batchDate: null };
}

function snapshotDir(scriptDir, id, batchDate) {
  return join(scriptDir, 'warehouse/snapshots', id, `batch_date=${batchDate}`);
}

function rawFullSnapshotDir(scriptDir, id, batchDate) {
  return join(scriptDir, 'raw/full_snapshot', id, `batch_date=${batchDate}`);
}

function fullSnapshotOutputName(id, trigger) {
  return trigger.snapshot_output || `${id}.parquet`;
}

function buildFullSnapshotCacheKey({ id, batchDate, sourceFingerprints, scriptPath, trigger }) {
  const dependencies = fullSnapshotDependencyPaths(dirname(scriptPath), scriptPath)
    .filter(p => existsSync(p))
    .map(p => {
      const fp = fileFingerprint(p);
      return { name: fp.name, size: fp.size, sha256: fp.sha256 };
    });
  const material = {
    id,
    batchDate,
    snapshotMode: trigger.snapshot_mode,
    outputName: fullSnapshotOutputName(id, trigger),
    dependencies,
    sources: sourceFingerprints
      .map(f => ({ name: f.name, size: f.size, sha256: f.sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function fullSnapshotDependencyPaths(pipelineDir, scriptPath) {
  return [
    scriptPath,
    join(pipelineDir, 'base_converter.py'),
    join(pipelineDir, 'etl_validation.py'),
    join(pipelineDir, 'parquet_utils.py'),
  ];
}

function removeDirRecursive(dir) {
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

function listBatchDirs(parentDir) {
  if (!existsSync(parentDir)) return [];
  return readdirSync(parentDir)
    .filter(name => name.startsWith('batch_date='))
    .map(name => ({
      name,
      path: join(parentDir, name),
      batchDate: name.slice('batch_date='.length),
    }))
    .filter(item => /^\d{8}$/.test(item.batchDate))
    .sort((a, b) => b.batchDate.localeCompare(a.batchDate));
}

function pruneSnapshotBatches(scriptDir, id, retainBatches) {
  const limit = Number(retainBatches);
  if (!Number.isFinite(limit) || limit <= 0) return;
  const parentDir = join(scriptDir, 'warehouse/snapshots', id);
  for (const item of listBatchDirs(parentDir).slice(limit)) {
    removeDirRecursive(item.path);
    log('yellow', `  清理旧 snapshot batch: ${id}/${item.name}`);
  }
}

function pruneRawFullSnapshotSources(scriptDir, id, retentionDays) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = `${cutoff.getFullYear()}${String(cutoff.getMonth() + 1).padStart(2, '0')}${String(cutoff.getDate()).padStart(2, '0')}`;
  const parentDir = join(scriptDir, 'raw/full_snapshot', id);
  for (const item of listBatchDirs(parentDir)) {
    if (item.batchDate < cutoffKey) {
      removeDirRecursive(item.path);
      log('yellow', `  清理旧 raw full_snapshot: ${id}/${item.name}`);
    }
  }
}

function pruneFullSnapshotHistory(scriptDir, id, trigger) {
  pruneSnapshotBatches(scriptDir, id, trigger.snapshot_retention_batches);
  pruneRawFullSnapshotSources(scriptDir, id, trigger.source_retention_days);
}

function archiveExistingLatest(outputAbs, archivePrefix) {
  if (!existsSync(outputAbs)) return;
  const archiveDir = join(__dirname, '.archive');
  ensureDir(archiveDir);
  renameSync(outputAbs, join(archiveDir, `${archivePrefix}_${formatDateTime()}.parquet`));
  log('yellow', `  归档旧 latest → ${archivePrefix}_${formatDateTime()}.parquet`);
}

function publishCandidate(tmpOutput, outputAbs, archivePrefix) {
  if (existsSync(outputAbs) && sha256File(tmpOutput) === sha256File(outputAbs)) {
    unlinkSync(tmpOutput);
    log('green', '  latest.parquet 内容未变化，跳过归档与替换');
    return false;
  }
  archiveExistingLatest(outputAbs, archivePrefix);
  renameSync(tmpOutput, outputAbs);
  return true;
}

function writeFullSnapshotSourceArchive(scriptDir, id, batchDate, sourceFiles, sourceFingerprints) {
  const rawDir = rawFullSnapshotDir(scriptDir, id, batchDate);
  ensureDir(rawDir);
  const archivedSources = sourceFiles.map((sourceFile, index) => {
    const file = sourceFingerprints[index];
    let dest = join(rawDir, sourceFile.name);
    if (existsSync(dest) && sha256File(dest) !== file.sha256) {
      const ext = extname(sourceFile.name);
      const stem = ext ? sourceFile.name.slice(0, -ext.length) : sourceFile.name;
      dest = join(rawDir, `${stem}.${file.sha256.slice(0, 12)}${ext}`);
    }
    if (!existsSync(dest)) copyFileSync(sourceFile.path, dest);
    return {
      ...file,
      archived_path: dest,
      archived_name: basename(dest),
    };
  });
  writeJson(join(rawDir, 'source-manifest.json'), {
    domain_id: id,
    batch_date: batchDate,
    archived_at: new Date().toISOString(),
    sources: archivedSources,
  });
}

function writeFullSnapshotReleaseManifest(scriptDir, id, batchDate, outputAbs, sourceFingerprints, cacheHit) {
  const manifestPath = join(scriptDir, 'release-manifests', `${batchDate}.full_snapshot.json`);
  const existing = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
    : { batch_date: batchDate, generated_at: new Date().toISOString(), domains: {} };
  existing.generated_at = new Date().toISOString();
  existing.domains[id] = {
    cache_hit: cacheHit,
    output: outputAbs,
    output_fingerprint: fileFingerprint(outputAbs),
    sources: sourceFingerprints,
  };
  writeJson(manifestPath, existing);
  log('green', `  release manifest: ${manifestPath}`);
}

// 流程末尾遍历 manifest 声明域，调 refresh_metadata.py 单点写入 data-sources.json。
// parquet 路径 + 日期列从 data-sources.json 派生，避免重复硬编码。
function runRefreshMetadata(python, scriptDir, releaseManifest) {
  log('cyan', '\n═══ 元数据单点写入（refresh_metadata.py）═══\n');
  const refreshScript = join(scriptDir, 'pipelines/refresh_metadata.py');
  const dateColumnByDomain = {
    premium: 'policy_date',
    claims_detail: 'report_time',
    cross_sell: 'policy_date',
    customer_flow: 'insurance_start_date',
    new_energy_claims: 'report_time',
  };
  const runDate = releaseManifest.run_date;
  for (const domainId of Object.keys(releaseManifest.domains || {})) {
    const domain = loadDomainManifest(scriptDir, domainId);
    if (!domain || !domain.output) {
      log('yellow', `  ⚠ 跳过 ${domainId}（data-sources.json 无 output 字段）`);
      continue;
    }
    const parquetGlob = join(scriptDir, domain.output);
    const args = [
      '--domain', domainId,
      '--parquet', `"${parquetGlob}"`,
      '--run-date', runDate,
    ];
    const dateCol = dateColumnByDomain[domainId];
    if (dateCol) args.push('--date-column', dateCol);
    runPythonScript(python, refreshScript, args);
  }
}

/**
 * 通用执行器：根据 manifest.trigger 驱动 ETL 转换
 *
 * input_strategy 三种模式：
 *   - 'single'              单文件 xlsx → safeConvertDomain（取第一个匹配文件）
 *   - 'multi_file_input'    多文件 xlsx 一次性传给 ETL（quote_etl.py 模式）
 *   - 'multi_file_merge'    每个 xlsx 转 parquet → merge_parquet.py dedup 合并
 */
function runStandardDomain(python, scriptDir, manifest) {
  if (!manifest || !manifest.trigger) {
    log('red', `❌ manifest 缺失或无 trigger 字段: ${manifest?.id || '(unknown)'}`);
    return;
  }
  const { id, name, etl_script, output, trigger } = manifest;
  const { input_strategy } = trigger;
  // 兼容 input_glob (单字符串) 和 input_globs (数组) 两种声明
  const inputGlobs = Array.isArray(trigger.input_globs)
    ? trigger.input_globs
    : (trigger.input_globs ? [trigger.input_globs] : [trigger.input_glob]).filter(Boolean);

  log('cyan', `\n═══ ${id} 域：${name || id}（${input_strategy}）═══\n`);

  // manifest 驱动：该域被 release manifest 声明时，跳过 BaseConverter 与 Node 端 metadata 写入，
  // 由流程末尾的 refresh_metadata.py 统一单点写入
  const skipMetadata = _currentReleaseManifest?.domains?.[id] != null;
  const extraArgs = skipMetadata ? ['--no-metadata'] : [];

  const { sourceFiles, batchDate } = resolveSourceFilesForTrigger(id, inputGlobs, scriptDir, trigger);
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${inputGlobs.join(' / ')}，跳过`);
    return;
  }
  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  const ctx = {
    python, id, scriptDir, sourceFiles, trigger, batchDate,
    scriptPath: join(scriptDir, etl_script),
    outputAbs: join(scriptDir, output),
    extraArgs,
  };
  ensureDir(dirname(ctx.outputAbs));

  const strategyFn = {
    single: runStrategySingle,
    multi_file_input: runStrategyMultiInput,
    multi_file_merge: runStrategyMultiMerge,
    full_snapshot: runStrategyFullSnapshot,
  }[input_strategy];

  if (!strategyFn) {
    log('red', `❌ 未知 input_strategy: ${input_strategy}`);
    return;
  }
  if (strategyFn(ctx) === false) return;

  // 行数 + 列数从 parquet 实读（避免 manifest 中可能过时的 field_count）+ data-sources.json 回写
  const rowCount = getParquetRowCount(python, ctx.outputAbs);
  const fieldCount = getParquetColumnCount(python, ctx.outputAbs);
  if (!skipMetadata) {
    updateDataSources(id, { rowCount, fieldCount });
  }
  log('green', `✅ ${id} 域完成`);
}

function runStrategySingle({ python, id, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] }) {
  // 多 glob 并存时按 mtime 取最新文件（避免历史旧命名文件长期占据声明顺序首位、屏蔽新命名更新）
  const latest = sourceFiles
    .slice()
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs)[0];
  if (sourceFiles.length > 1) {
    log('cyan', `  single 策略：${sourceFiles.length} 个候选 → 选 mtime 最新: ${latest.name}`);
  }
  safeConvertDomain(
    python,
    scriptPath,
    latest.path,
    outputAbs,
    trigger.archive_prefix,
    extraArgs,
    candidatePath => validateDomainCandidate(python, id, candidatePath, trigger.validation),
  );
}

function runStrategyMultiInput({ python, id, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] }) {
  const { archive_prefix, output_is_dir } = trigger;
  const inputArgs = ['-i', ...sourceFiles.map(f => `"${f.path}"`)];
  const outputArg = output_is_dir ? dirname(outputAbs) : outputAbs;
  if (output_is_dir) {
    if (existsSync(outputAbs)) {
      const archiveDir = join(__dirname, '.archive');
      ensureDir(archiveDir);
      renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDateTime()}.parquet`));
      log('yellow', `  归档旧 ${id} → ${archive_prefix}_${formatDateTime()}.parquet`);
    }
    runPythonScript(python, scriptPath, [...inputArgs, '-o', `"${outputArg}"`, ...extraArgs]);
    return;
  }

  const tmpOutput = outputAbs + '.tmp';
  try { if (existsSync(tmpOutput)) unlinkSync(tmpOutput); } catch (e) {}
  runPythonScript(python, scriptPath, [...inputArgs, '-o', `"${tmpOutput}"`, ...extraArgs]);
  validateDomainCandidate(python, id, tmpOutput, trigger.validation);
  if (existsSync(outputAbs)) {
    const archiveDir = join(__dirname, '.archive');
    ensureDir(archiveDir);
    renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDateTime()}.parquet`));
    log('yellow', `  归档旧 ${id} → ${archive_prefix}_${formatDateTime()}.parquet`);
  }
  renameSync(tmpOutput, outputAbs);
}

function runStrategyFullSnapshot({ python, id, scriptDir, scriptPath, sourceFiles, outputAbs, trigger, batchDate, extraArgs = [] }) {
  if (!batchDate) {
    throw new Error(`${id} full_snapshot 缺少 batchDate`);
  }
  const sourceFingerprints = sourceFiles.map(f => fileFingerprint(f.path));
  const snapDir = snapshotDir(scriptDir, id, batchDate);
  const snapshotOutput = join(snapDir, fullSnapshotOutputName(id, trigger));
  const snapshotManifest = join(snapDir, 'snapshot-manifest.json');
  const tmpOutput = outputAbs + '.tmp';
  const cacheKey = buildFullSnapshotCacheKey({ id, batchDate, sourceFingerprints, scriptPath, trigger });

  writeFullSnapshotSourceArchive(scriptDir, id, batchDate, sourceFiles, sourceFingerprints);
  try { if (existsSync(tmpOutput)) unlinkSync(tmpOutput); } catch (e) {}

  let cacheHit = false;
  if (existsSync(snapshotManifest) && existsSync(snapshotOutput)) {
    const manifest = JSON.parse(readFileSync(snapshotManifest, 'utf-8'));
    if (manifest.cache_key === cacheKey) {
      log('green', `  full_snapshot cache hit: ${id} batch_date=${batchDate}`);
      copyFileSync(snapshotOutput, tmpOutput);
      validateDomainCandidate(python, id, tmpOutput, trigger.validation);
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    log('cyan', `  full_snapshot cache miss: ${id} batch_date=${batchDate}`);
    ensureDir(snapDir);
    const inputArgs = ['-i', ...sourceFiles.map(f => `"${f.path}"`)];
    const snapshotArgs = trigger.write_snapshot_parts
      ? ['--snapshot-dir', `"${snapDir}"`, '--batch-date', batchDate]
      : [];
    runPythonScript(python, scriptPath, [
      ...inputArgs,
      '-o', `"${tmpOutput}"`,
      ...snapshotArgs,
      ...extraArgs,
    ]);
    validateDomainCandidate(python, id, tmpOutput, trigger.validation);
    copyFileSync(tmpOutput, snapshotOutput);
    writeJson(snapshotManifest, {
      domain_id: id,
      batch_date: batchDate,
      cache_key: cacheKey,
      cache_hit: false,
      generated_at: new Date().toISOString(),
      output: fileFingerprint(snapshotOutput),
      sources: sourceFingerprints,
    });
  }

  const published = publishCandidate(tmpOutput, outputAbs, trigger.archive_prefix);
  writeFullSnapshotReleaseManifest(scriptDir, id, batchDate, outputAbs, sourceFingerprints, cacheHit);
  pruneFullSnapshotHistory(scriptDir, id, trigger);
  if (!published) {
    log('green', `  ${id} latest 未变更，后续按域 rsync 将无实际数据传输`);
  }
}

function runStrategyMultiMerge(ctx) {
  const { python, id, scriptDir, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] } = ctx;
  const { archive_prefix, merge_dedup_key, merge_order_by } = trigger;
  const hasHistory = trigger.merge_with_history === true && existsSync(outputAbs);

  const tmpDir = join(dirname(outputAbs), '_tmp');
  ensureDir(tmpDir);
  const tmpFiles = [];
  const failed = [];
  for (const file of sourceFiles) {
    const tmpPath = join(tmpDir, file.name.replace(/\.xlsx$/i, '.parquet'));
    log('green', `▶ 转换: ${file.name}`);
    try {
      // extraArgs 传给 BaseConverter 子脚本（如 --no-metadata），merge_parquet.py 不消费 extraArgs
      runPythonScript(python, scriptPath, ['-i', `"${file.path}"`, '-o', `"${tmpPath}"`, ...extraArgs]);
    } catch (e) {
      log('red', `❌ 转换失败: ${file.name} — ${e.message?.slice(0, 200)}`);
      failed.push(file.name);
    }
    if (existsSync(tmpPath)) tmpFiles.push(tmpPath);
  }
  // 任一源文件转换失败即中止：避免静默把剩余分片合并成缺数据的产物（数据完整性护栏，
  // 与「未识别分片直接 exit」同级）。先清理已生成的临时 parquet 再抛错。
  if (failed.length > 0) {
    for (const f of tmpFiles) { try { unlinkSync(f); } catch (e) {} }
    try { if (readdirSync(tmpDir).length === 0) rmdirSync(tmpDir); } catch (e) {}
    throw new Error(`${id} 域 ${failed.length}/${sourceFiles.length} 个源文件转换失败，中止合并以防缺数据: ${failed.join(', ')}`);
  }
  if (tmpFiles.length === 0) {
    log('red', `❌ 未生成任何 ${id} parquet`);
    return false;
  }

  const archiveDir = join(__dirname, '.archive');
  const validateCandidate = candidatePath => validateDomainCandidate(python, id, candidatePath, trigger.validation);
  // 短路：单文件 + 不合并历史 → 直接替换（避免起 DuckDB 进程）
  if (tmpFiles.length === 1 && !hasHistory) {
    validateCandidate(tmpFiles[0]);
    if (existsSync(outputAbs)) {
      ensureDir(archiveDir);
      renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDateTime()}.parquet`));
    }
    renameSync(tmpFiles[0], outputAbs);
  } else {
    // merge_parquet.py dedup 合并；若 merge_with_history 则把历史 latest 加入输入
    const mergeInputs = hasHistory ? [outputAbs, ...tmpFiles] : tmpFiles;
    const tmpOutput = outputAbs + '.tmp';
    const mergeScript = join(scriptDir, 'pipelines/merge_parquet.py');
    const desc = hasHistory ? `历史 latest + ${tmpFiles.length} 增量` : `${tmpFiles.length} 分片`;
    log('green', `▶ 合并（${desc}），按 ${merge_dedup_key} 去重...`);
    runPythonScript(python, mergeScript, [
      '-i', ...mergeInputs.map(f => `"${f}"`),
      '-o', `"${tmpOutput}"`,
      '--dedup-key', `"${merge_dedup_key}"`,
      '--order-by', `"${merge_order_by}"`,
    ]);
    validateCandidate(tmpOutput);
    if (existsSync(outputAbs)) {
      ensureDir(archiveDir);
      renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDateTime()}.parquet`));
    }
    renameSync(tmpOutput, outputAbs);
    for (const f of tmpFiles) { try { unlinkSync(f); } catch (e) {} }
  }
  try { if (readdirSync(tmpDir).length === 0) rmdirSync(tmpDir); } catch (e) {}
}

// ETL 完成后调用 diagnose-period-trend skill，生成短中长期对照 HTML 报告
// 失败仅 console.warn 不阻塞 ETL；HTML 写入 <project_root>/public/reports/diagnose-period-trend/<cutoff>.html
function runPeriodTrendReport(scriptDir, python) {
  const skillCli = join(homedir(), '.claude/skills/diagnose-period-trend/lib/cli.py');
  if (!existsSync(skillCli)) {
    console.warn(`[ETL] 跳过短中长期对照报告：skill cli.py 不存在 (${skillCli})`);
    return;
  }
  const projectRoot = dirname(scriptDir);
  log('cyan', '\n═══ 9. 短中长期对照报告（diagnose-period-trend skill）═══\n');
  const result = spawnSync(
    python,
    [skillCli, '--view', 'all', '--project-root', projectRoot],
    {
      stdio: 'inherit',
      cwd: projectRoot,
      env: process.env,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
    }
  );
  if (result.status !== 0) {
    console.warn(`[ETL] 短中长期对照报告生成失败（不阻塞 ETL），exit=${result.status}`);
    if (result.error) console.warn(`        ${result.error.message}`);
    return;
  }
  log('green', '✅ 短中长期对照报告已生成');
}

async function syncToVps(scriptDir) {
  const projectRoot = dirname(scriptDir);
  // worktree 守卫：linked worktree 的 .git 是文件（gitdir 指针）而非目录。
  // staging/实验性 ETL 在 worktree 中运行时禁止把数据自动推到生产 VPS
  // （2026-06-09 staging 重建曾意外触发自动同步，幸数据已验收一致才无事故）。
  try {
    const gitPath = join(projectRoot, '.git');
    if (existsSync(gitPath) && statSync(gitPath).isFile()) {
      log('yellow', '⚠ 检测到 git worktree（.git 为文件），跳过 VPS 自动同步；如需同步请在主目录运行或手动执行 scripts/sync-vps.mjs');
      return false;
    }
  } catch (e) { /* 探测失败时不阻塞主目录正常同步 */ }
  log('cyan', '[ETL] 自动同步到 VPS（仅 rsync，不重启 PM2）...');
  const syncScript = join(projectRoot, 'scripts/sync-vps.mjs');
  try {
    // --no-restart：daily.mjs 只负责数据同步，不触发 PM2 restart
    // PM2 reload 由 scripts/sync-and-reload.mjs 全流程入口 或 用户手动执行
    // pm2 restart 无法恢复 errored 状态，pm2 delete+start (reload) 才能
    execSync(`node "${syncScript}" --no-restart`, { stdio: 'inherit', env: { ...process.env, RUN_MAIN: '1' } });
    log('green', '✅ VPS 同步完成（PM2 未重启，使用 sync-and-reload.mjs 或手动 reload）');
    return true;
  } catch (e) {
    console.warn(`[ETL] VPS 同步失败（数据已写入本地）: ${e.message}`);
    console.warn('[ETL] 可手动重试: node scripts/sync-vps.mjs --no-restart');
    return false;
  }
}

// ETL 完成后按 config.{instance}.json 逐个同步到企业微信智能表格
// 由 WECOM_SMARTSHEET_ENABLED=1 开关控制（默认关闭），失败降级告警不阻塞 ETL
async function runPostEtlIntegrations(scriptDir, python) {
  if (process.env.WECOM_SMARTSHEET_ENABLED !== '1') return;

  const integrationDir = join(scriptDir, 'integrations/wecom_smartsheet');
  const scriptV2 = join(integrationDir, 'sync_renewal_v2.py');
  const scriptV1 = join(integrationDir, 'sync_renewal.py');
  const instancesDir = join(integrationDir, 'instances');

  // v2：优先扫描 instances/*.yaml
  let v2Instances = [];
  if (existsSync(scriptV2) && existsSync(instancesDir)) {
    v2Instances = readdirSync(instancesDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
  }
  // v1 兼容：旧 config.*.json 仍跑（待 v2 稳定后删）
  let v1Configs = [];
  if (existsSync(scriptV1)) {
    v1Configs = readdirSync(integrationDir)
      .filter(f => f.startsWith('config.') && f.endsWith('.json'))
      .sort();
  }

  const total = v2Instances.length + v1Configs.length;
  if (total === 0) return;

  console.log('');
  log('green', '╔══════════════════════════════════════════╗');
  log('green', '║  8. 企业微信智能表格同步                   ║');
  log('green', '╚══════════════════════════════════════════╝');
  log('cyan', `  实例数: ${total}（v2 yaml=${v2Instances.length}, v1 json=${v1Configs.length}）`);

  // 8a. v2 yaml 实例
  //   yaml 内可声明 `script: <name>.py` 路由到 sync_renewal_v2.py 之外的引擎
  //   缺省路由到 sync_renewal_v2.py（续保口径）
  for (const yamlFile of v2Instances) {
    const instance = yamlFile.replace(/\.ya?ml$/, '');
    const yamlPath = join(instancesDir, yamlFile);

    // 读 yaml 头部解析 `script:` 行（轻量正则，允许行末 inline 注释）
    //   匹配示例：
    //     script: sync_filtered_policies.py
    //     script: sync_filtered_policies.py   # daily.mjs 据此路由...
    let targetScript = scriptV2;
    let scriptName = 'sync_renewal_v2.py';
    let isFilteredEngine = false;
    try {
      const yamlText = readFileSync(yamlPath, 'utf-8');
      const scriptMatch = yamlText.match(/^script:\s*([\w./-]+)\s*(?:#.*)?$/m);
      if (scriptMatch) {
        const declared = scriptMatch[1].trim();
        const candidate = join(integrationDir, declared);
        if (existsSync(candidate)) {
          targetScript = candidate;
          scriptName = declared;
          isFilteredEngine = declared !== 'sync_renewal_v2.py';
        } else {
          log('yellow', `  ⚠ ${instance}: 声明 script=${declared} 不存在，回退到 sync_renewal_v2.py`);
        }
      }
    } catch (err) {
      // 读取失败时静默回退
    }

    // 非续保引擎（sync_filtered_policies.py）需显式传 --mode sync 走增量
    // upsert，避免每次定时跑都全量重写（review #2）
    const extraArgs = isFilteredEngine ? ['--mode', 'sync'] : [];

    log('cyan', `\n  ▶ [v2] ${instance}  (engine: ${scriptName}${isFilteredEngine ? ', mode=sync' : ''})`);
    try {
      runPythonScript(python, targetScript, [
        '--instance', `"${yamlPath}"`,
        ...extraArgs,
      ]);
      log('green', `  ✓ ${instance} 同步完成`);
    } catch (err) {
      const msg = (err.message || '').trim();
      log('red', `  ⚠ ${instance} 同步失败（降级告警，不阻塞 ETL）`);
      for (const line of msg.split('\n')) if (line.trim()) log('red', `     ${line}`);
      log('yellow', `     详细日志：${join(integrationDir, 'logs')}/${instance}_sync_*.json`);
      log('yellow', `     手动重试：python3 ${targetScript} --instance ${yamlPath} --dry-run`);
    }
  }

  // 8b. v1 json 实例（向后兼容，待 v2 稳定后删）
  for (const configFile of v1Configs) {
    const instance = configFile.replace(/^config\.|\.json$/g, '');
    log('cyan', `\n  ▶ [v1] ${instance}`);
    try {
      runPythonScript(python, scriptV1, [
        '--config', `"${join(integrationDir, configFile)}"`,
      ]);
      log('green', `  ✓ ${instance} 同步完成`);
    } catch (err) {
      const msg = (err.message || '').trim();
      log('red', `  ⚠ ${instance} 同步失败（降级告警，不阻塞 ETL）`);
      for (const line of msg.split('\n')) if (line.trim()) log('red', `     ${line}`);
      log('yellow', `     手动重试：python3 ${scriptV1} --config ${join(integrationDir, configFile)} --dry-run`);
    }
  }
}

/** 找最大的全量 xlsx（quotes 需要完整历史） */
function findLargestXlsx(dir) {
  const files = ls('每日数据_*.xlsx', dir);
  if (files.length === 0) return null;
  return files.sort((a, b) => statSync(b.path).size - statSync(a.path).size)[0];
}

/** 找所有 每日数据_*.xlsx，按文件名倒序 */
function findAllXlsx(dir) {
  return ls('每日数据_*.xlsx', dir);
}

function runClaimsDetail(python, scriptDir) {
  log('cyan', '\n═══ ClaimsDetail 域：赔案明细（分区 + CDC）═══\n');

  // manifest 驱动：优先使用 manifest.domains.claims_detail.files，避免误合入 legacy 02_*/车险报立结案清单_*
  const claimsSpec = _currentReleaseManifest?.domains?.claims_detail;
  const manifestFiles = claimsSpec
    ? claimsSpec.files.map((rel) => {
        const path = isAbsolute(rel) ? rel : join(scriptDir, '..', rel);
        return { name: basename(path), path };
      })
    : null;

  // 查找赔案明细 xlsx（支持多文件合并，新命名优先）
  // 2026-06-10 上游 BI 清单重构：理赔编号 02 → 05，且基线为日期范围前缀文件
  // （YYYYMMDD-YYYYMMDD_05_理赔明细.xlsx）；旧 02 模式保留向后兼容
  const newFiles = [
    ...ls('02_理赔明细_*.xlsx', scriptDir),
    ...ls('????????_02_理赔明细*.xlsx', scriptDir),
    ...ls('????????_05_理赔明细*.xlsx', scriptDir),
    ...ls('????????-????????_0?_理赔明细*.xlsx', scriptDir),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const legacyFiles = ls('车险报立结案清单_*.xlsx', scriptDir).sort((a, b) => a.name.localeCompare(b.name));
  let sourceFiles = manifestFiles || [...newFiles, ...legacyFiles];
  if (sourceFiles.length === 0) {
    log('yellow', '⚠ 未找到 02/05_理赔明细 xlsx（含 YYYYMMDD-YYYYMMDD_ 范围前缀）或 车险报立结案清单_*.xlsx，跳过');
    return;
  }
  // 自动归档与最新全量文件覆盖区间冲突的旧文件（与签单清单一致的护栏）
  // 上游切换到 _YYYYMMDD_YYYYMMDD 全量格式时，旧增量/前缀文件需归档，否则 concat 双倍计入。
  if (!manifestFiles) {
    // 全量文件名格式（两代并存）：
    //   旧：02_理赔明细_报案时间YYYYMMDD_YYYYMMDD.xlsx（第一个日期紧跟「报案时间」）
    //   新：YYYYMMDD-YYYYMMDD_05_理赔明细.xlsx（2026-06-10 起范围前缀 + 编号 05）
    const FULL_RES = [
      /^02_理赔明细.*?(\d{8})_(\d{8})\.xlsx?$/i,
      /^(\d{8})-(\d{8})_\d{2}_理赔明细.*\.xlsx?$/i,
    ];
    const matchFull = name => {
      for (const re of FULL_RES) {
        const m = name.match(re);
        if (m) return m;
      }
      return null;
    };
    // 收集所有全量文件并按 end 日期降序排序，取 end 最大者作为「当前最新全量」
    // 避免按文件名升序取到较旧全量、把较新全量误归档
    const fullCandidates = sourceFiles
      .map(f => ({ f, m: matchFull(f.name) }))
      .filter(x => x.m)
      .sort((a, b) => b.m[2].localeCompare(a.m[2]));
    if (fullCandidates.length > 0) {
      const fullFile = fullCandidates[0].f;
      const fullStart = fullCandidates[0].m[1];
      const fullEnd = fullCandidates[0].m[2];
      const conflicting = sourceFiles.filter(f => {
        if (f.name === fullFile.name) return false;
        // 不归档其他全量文件本身（保留历史快照/历史分段），仅归档增量/前缀
        if (matchFull(f.name)) return false;
        const days = f.name.match(/(\d{8})/g);
        if (!days) return false;
        return days.some(d => d >= fullStart && d <= fullEnd);
      });
      if (conflicting.length > 0) {
        const archiveDir = join(scriptDir, '.xlsx-archive', formatDate());
        ensureDir(archiveDir);
        log('yellow', `📦 自动归档 ${conflicting.length} 个被新全量 ${fullFile.name} 覆盖的旧 xlsx`);
        for (const f of conflicting) {
          const dest = join(archiveDir, f.name);
          renameSync(f.path, dest);
          log('yellow', `   ${f.name} → .xlsx-archive/${formatDate()}/`);
        }
        sourceFiles = sourceFiles.filter(f => !conflicting.includes(f));
      }
    }
  }
  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  ensureDir(CLAIMS_DETAIL_DIR);

  const policyDir = join(scriptDir, 'warehouse/fact/policy/current');
  const convertScript = join(scriptDir, 'pipelines/convert_claims_detail.py');
  const tmpOutput = join(CLAIMS_DETAIL_DIR, '_incoming.parquet');
  const inputPaths = sourceFiles.map(f => `"${f.path}"`);

  // 开头清理：如果上次运行异常残留 _incoming.parquet，先清掉
  if (existsSync(tmpOutput)) {
    log('yellow', `  清理上次残留的临时文件: ${tmpOutput}`);
    unlinkSync(tmpOutput);
  }

  const partitionManager = join(scriptDir, 'pipelines/claims_partition_manager.py');

  try {
    // Step 1: xlsx → 临时 parquet（含 insurance_start_date enrichment）
    log('green', '▶ Step 1: 转换 xlsx → parquet (含 insurance_start_date)');
    runPythonScript(python, convertScript, [
      '-i', ...inputPaths,
      '-o', `"${tmpOutput}"`,
      '--policy-dir', `"${policyDir}"`
    ]);

    // Step 2: 检查是否已有分区文件
    const hasPartitions = readdirSync(CLAIMS_DETAIL_DIR)
      .some(f => f.startsWith('claims_') && f.endsWith('.parquet'));

    if (hasPartitions && claimsSpec?.mode === 'replace_range') {
      // manifest 驱动：按 report_time 日期窗替换（保留窗外历史）
      log('green', `▶ Step 2: 日期窗替换 (${claimsSpec.report_start} ~ ${claimsSpec.report_end})`);
      runPythonScript(python, partitionManager, [
        'replace_range',
        '-i', `"${tmpOutput}"`, '-o', `"${CLAIMS_DETAIL_DIR}"`,
        '--report-start', claimsSpec.report_start,
        '--report-end', claimsSpec.report_end,
      ]);
    } else if (hasPartitions) {
      // CDC 模式：增量合入已有分区
      log('green', '▶ Step 2: CDC 更新（合入已有分区）');
      runPythonScript(python, partitionManager, [
        'update', '-i', `"${tmpOutput}"`, '-o', `"${CLAIMS_DETAIL_DIR}"`
      ]);
    } else {
      // 首次迁移：初始分区
      log('green', '▶ Step 2: 初始迁移（创建年度分区）');
      runPythonScript(python, partitionManager, [
        'migrate', '-i', `"${tmpOutput}"`, '-o', `"${CLAIMS_DETAIL_DIR}"`
      ]);
    }
  } finally {
    // Step 3: 清理临时文件（finally 保证异常路径也清理，避免残留被 rsync 推到 VPS）
    if (existsSync(tmpOutput)) unlinkSync(tmpOutput);
  }

  // Step 4: 清理旧 latest.parquet（兼容迁移）
  if (existsSync(CLAIMS_DETAIL_PATH)) {
    const archiveDir = join(__dirname, '.archive');
    ensureDir(archiveDir);
    renameSync(CLAIMS_DETAIL_PATH, join(archiveDir, `claims_detail_latest_${formatDateTime()}.parquet`));
    log('yellow', '  归档旧 latest.parquet → archive/');
  }

  // Step 5: 统计总行数 + 列数（从 parquet 实读，避免硬编码过时）
  const totalRows = getPartitionedRowCount(python, CLAIMS_DETAIL_DIR);
  const fieldCount = getPartitionedColumnCount(python, CLAIMS_DETAIL_DIR);
  // manifest 声明 claims_detail 时由 refresh_metadata.py 统一写入
  if (!_currentReleaseManifest?.domains?.claims_detail) {
    updateDataSources('claims_detail', { rowCount: totalRows, fieldCount });
  }

  // Step 5.5: 报案截止日新鲜度检查（B191e0f）——防喂旧快照致满期赔付率系统性偏低。
  // 理赔金额是动态的，只喂窄窗增量会让历史赔案金额停在旧值；见 data-pipeline.md 存量更新铁律。
  const maxReportDate = getPartitionedMaxReportDate(python, CLAIMS_DETAIL_DIR);
  const lagDays = claimsReportLagDays(maxReportDate, localTodayISO());
  if (shouldWarnClaimsFreshness(lagDays)) {
    log('red', `⚠️ claims 报案截止日 ${maxReportDate} 落后当日 ${lagDays} 天（阈值 ${CLAIMS_REPORT_LAG_WARN_DAYS} 天）`);
    log('red', '   理赔金额是动态的，喂旧快照会让满期赔付率系统性偏低；');
    log('red', '   请用"含历史的全量"理赔明细源刷新（见 .claude/rules/data-pipeline.md「claims_detail 存量更新铁律」）');
  } else if (maxReportDate) {
    log('green', `  ✓ claims 报案截止日 ${maxReportDate}（落后当日 ${lagDays} 天，新鲜）`);
  } else {
    log('yellow', '  ⚠️ 无法读取 claims 报案截止日，跳过新鲜度检查');
  }

  // Step 6: 显示分区状态
  try {
    runPythonScript(python, partitionManager, ['status', '-o', `"${CLAIMS_DETAIL_DIR}"`]);
  } catch { /* non-fatal */ }

  log('green', '✅ ClaimsDetail 域完成（分区模式）');
}

// ── 安全域转换（先写 tmp，成功后再归档旧文件+原子替换）──

function safeConvertDomain(python, scriptPath, inputPath, outputPath, archivePrefix, extraArgs = [], validateCandidate = null) {
  const tmpPath = outputPath + '.tmp';
  ensureDir(dirname(outputPath));

  // 先转换到临时文件（extraArgs 透传给 BaseConverter 子脚本，如 --no-metadata）
  runPythonScript(python, scriptPath, [
    '-i', `"${inputPath}"`, '-o', `"${tmpPath}"`, ...extraArgs
  ]);

  if (validateCandidate) validateCandidate(tmpPath);

  // 转换成功后才归档旧文件
  if (existsSync(outputPath)) {
    const archiveDir = join(__dirname, '.archive');
    ensureDir(archiveDir);
    renameSync(outputPath, join(archiveDir, `${archivePrefix}_${formatDateTime()}.parquet`));
  }

  // 原子替换
  renameSync(tmpPath, outputPath);
}

// ── 旧 runXxx 已被 runStandardDomain 替代（cross_sell/quotes_conversion/brand/repair_resource/customer_flow） ──
// 当前续保追踪由 policy + quotes_conversion + salesman 派生。

// ── 派生域：renewal_tracker（依赖 policy + quotes_conversion + salesman，非 Excel） ──

function runRenewalTracker(python, scriptDir) {
  log('cyan', '\n═══ renewal_tracker 派生域：续保追踪（JOIN policy + quotes_conversion + salesman）═══\n');

  // 依赖检查
  const policyDir = join(scriptDir, 'warehouse/fact/policy/current');
  const quotesPath = join(scriptDir, 'warehouse/fact/quotes_conversion/latest.parquet');
  const salesmanPath = join(scriptDir, 'warehouse/dim/salesman/latest.parquet');
  const missing = [];
  if (!existsSync(policyDir) || readdirSync(policyDir).filter(f => f.endsWith('.parquet')).length === 0) missing.push('policy/current/*.parquet');
  if (!existsSync(quotesPath)) missing.push('quotes_conversion/latest.parquet');
  if (!existsSync(salesmanPath)) missing.push('salesman/latest.parquet');
  if (missing.length > 0) {
    log('red', `❌ 依赖缺失，跳过 renewal_tracker: ${missing.join(', ')}`);
    return;
  }

  const outputDir = join(scriptDir, 'warehouse/fact/renewal_tracker');
  const outputPath = join(outputDir, 'latest.parquet');
  const tmpPath = outputPath + '.tmp';
  ensureDir(outputDir);

  const scriptPath = join(scriptDir, 'pipelines/convert_renewal_tracker.py');
  runPythonScript(python, scriptPath, ['-o', `"${tmpPath}"`]);

  // 归档旧文件（成功转换后才归档）
  if (existsSync(outputPath)) {
    const archiveDir = join(__dirname, '.archive');
    ensureDir(archiveDir);
    renameSync(outputPath, join(archiveDir, `renewal_tracker_latest_${formatDateTime()}.parquet`));
    log('yellow', '  归档旧 latest.parquet → archive/');
  }
  renameSync(tmpPath, outputPath);

  // 回写 data-sources.json
  const rowCount = getParquetRowCount(python, outputPath);
  const fieldCount = getParquetColumnCount(python, outputPath);
  updateDataSources('renewal_tracker', { rowCount, fieldCount });
  log('green', '✅ renewal_tracker 派生域完成');
}

// ── 主流程 ──

async function main() {
  const scriptDir = __dirname;
  process.chdir(scriptDir);
  loadEnvLocal(scriptDir);
  // 互斥锁：cron 与手动 /daily-sync 可能并发，归档→替换序列无锁会相互覆盖。
  // 取锁后注册退出钩子（含 process.exit/信号路径）自动释放。
  acquireLock(scriptDir);

  const noSync = process.argv.includes('--no-sync');
  const skipReport = process.argv.includes('--skip-report');
  const ALL_DOMAINS = ['premium', 'claims', 'claims_detail', 'quotes', 'cross_sell', 'brand', 'repair', 'customer_flow', 'new_energy_claims', 'new_energy', 'renewal_tracker', 'all'];
  const subcommand = process.argv.find(a => ALL_DOMAINS.includes(a));

  // 发布 manifest（可选）：声明本次刷新的域范围 + 期望日期；
  // 存在时所有 data-sources.json 写入延后到流程末尾由 refresh_metadata.py 统一执行，消除双写漂移。
  _currentReleaseManifest = loadReleaseManifest(scriptDir, parseManifestArg(process.argv));

  // 子命令模式：单域处理
  if (subcommand && subcommand !== 'premium' && subcommand !== 'all') {
    const python = findPython();
    switch (subcommand) {
      case 'claims':
        log('red', '❌ claims 域已删除，赔付数据统一由 claims_detail 提供。请使用: node 数据管理/daily.mjs claims_detail');
        process.exit(1);
        break;
      case 'claims_detail':
        runClaimsDetail(python, scriptDir);
        break;
      case 'quotes': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'quotes_conversion')); break;
      case 'cross_sell': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'cross_sell')); break;
      case 'brand': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'brand')); break;
      case 'repair': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'repair_resource')); break;
      case 'customer_flow': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'customer_flow')); break;
      case 'new_energy':
      case 'new_energy_claims': runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, 'new_energy_claims')); break;
      case 'renewal_tracker': runRenewalTracker(python, scriptDir); break;
    }
    // manifest 驱动：该域完成后单点写入 metadata（替代 subroutine 内的 updateDataSources）
    if (_currentReleaseManifest) {
      runRefreshMetadata(python, scriptDir, _currentReleaseManifest);
    }
    if (skipReport) {
      log('yellow', '已跳过短中长期报告生成（--skip-report）');
    } else {
      runPeriodTrendReport(scriptDir, python);
    }
    if (!noSync) {
      const synced = await syncToVps(scriptDir);
      if (!synced) process.exit(1);
    }
    await runPostEtlIntegrations(scriptDir, python);
    return;
  }
  if (subcommand === 'all') {
    // all = premium（下面的分片流程）+ claims_detail + 5 个标准域
    // premium 继续走下面的分片逻辑，其他域在分片完成后执行
  }

  // 路径定义
  const currentDir = join(scriptDir, 'warehouse/fact/policy/current');
  const stagingDir = join(scriptDir, 'warehouse/fact/policy/staging');
  const archiveDir = join(__dirname, '.archive');

  ensureDir(currentDir);
  ensureDir(stagingDir);
  ensureDir(archiveDir);

  // 读取分片配置
  const configPath = join(scriptDir, 'shard-config.json');
  if (!existsSync(configPath)) {
    log('red', '❌ 未找到 shard-config.json');
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  log('green', `分片配置: static_cutoff=${config.static_cutoff}, weekly_start=${config.weekly_start}`);

  // 0. 迁移旧格式文件
  const policyDir = join(scriptDir, 'warehouse/fact/policy');
  if (existsSync(policyDir)) {
    const oldFiles = readdirSync(policyDir)
      .filter(f => f.startsWith('车险保单综合明细表') && f.endsWith('.parquet'));
    if (oldFiles.length > 0) {
      log('yellow', '📦 发现旧格式文件，迁移到 archive/');
      for (const f of oldFiles) {
        renameSync(join(policyDir, f), join(archiveDir, f));
        console.log(`   → ${f}`);
      }
    }
  }

  const old2426Files = readdirSync(currentDir)
    .filter(f => f.startsWith('车险24-26年清单_') && f.endsWith('.parquet'));
  if (old2426Files.length > 0) {
    log('yellow', '📦 发现旧命名格式文件，迁移到 archive/');
    for (const f of old2426Files) {
      renameSync(join(currentDir, f), join(archiveDir, f));
      console.log(`   → ${f}`);
    }
  }

  // 1. 找续保源文件
  const sourceFiles = [
    ...ls('续保业务类型匹配*.xlsx', scriptDir),
    ...ls('续保类型匹配*.xlsx', scriptDir)
  ].sort((a, b) => b.name.localeCompare(a.name));
  const renewalSource = sourceFiles.length > 0 ? sourceFiles[0].path : null;
  if (renewalSource) {
    log('green', `续保源文件: ${basename(renewalSource)}`);
  } else {
    log('yellow', '⚠ 未找到续保源文件，将跳过续保业务类型匹配');
  }

  // 2. 识别所有 xlsx 分片（新格式 + 旧格式 + 剔摩/限摩 + 新前缀 YYYYMMDD_01_* + 范围前缀 YYYYMMDD-YYYYMMDD_01_*）
  const legacyXlsx = ls('每日数据_*.xlsx', scriptDir);
  const newFormatXlsx = [
    ...ls('01_签单清单_*.xlsx', scriptDir),
    ...ls('????????_01_签单清单*.xlsx', scriptDir),
    ...ls('????????-????????_01_签单清单*.xlsx', scriptDir),
  ].filter(f => {
    // FineBI/Chrome 原始残留（无日期前缀、日期挂尾，如 01_签单清单_定稿_20260608.xlsx）
    // 与官方范围前缀文件同源但未经导出验收，禁止入 ETL（2026-06-10 上游交接 §4）
    if (/^01_签单清单_定稿_\d{8}/.test(f.name)) {
      log('yellow', `⚠ 跳过 FineBI 残留文件（无日期前缀）: ${f.name}`);
      return false;
    }
    return true;
  });
  let allXlsx = [...legacyXlsx, ...newFormatXlsx];
  if (allXlsx.length === 0) {
    log('red', '❌ 未找到任何签单清单 xlsx 文件（每日数据_*.xlsx / 01_签单清单_*.xlsx / ????????_01_签单清单*.xlsx / ????????-????????_01_签单清单*.xlsx）');
    process.exit(1);
  }

  // 范围前缀分片互斥守卫：同一 start 的多个范围文件只保留 end 最新者，其余自动归档。
  // 上游每日重导「20260601-<最新>_01_签单清单_定稿.xlsx」时，旧短窗文件与新文件并存
  // 会在 current/ 形成重叠分片、保费双倍计入。
  {
    const RANGE_RE = /^(\d{8})-(\d{8})_01_签单清单.*\.xlsx$/i;
    const byStart = new Map();
    for (const f of allXlsx) {
      const m = f.name.match(RANGE_RE);
      if (!m) continue;
      if (!byStart.has(m[1])) byStart.set(m[1], []);
      byStart.get(m[1]).push({ f, end: m[2] });
    }
    const losers = [];
    for (const list of byStart.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => b.end.localeCompare(a.end));
      losers.push(...list.slice(1).map(x => x.f));
    }
    if (losers.length > 0) {
      const rangeArchiveDir = join(scriptDir, '.xlsx-archive', formatDate());
      ensureDir(rangeArchiveDir);
      log('yellow', `📦 范围分片互斥：归档 ${losers.length} 个被更长窗口覆盖的旧范围 xlsx`);
      for (const f of losers) {
        renameSync(f.path, join(rangeArchiveDir, f.name));
        log('yellow', `   ${f.name} → .xlsx-archive/${formatDate()}/`);
      }
      const loserNames = new Set(losers.map(f => f.name));
      allXlsx = allXlsx.filter(f => !loserNames.has(f.name));
    }
  }

  // iCloud placeholder 体检：未下载的 iCloud 文件在 cp 后可能为 0 字节占位 → ETL 必败
  // 提前检测并明确报错，避免 pandas 读到空 xlsx 抛 ZipFile error 难定位
  const placeholderFiles = allXlsx.filter(f => {
    try {
      const stat = statSync(f.path);
      return stat.size === 0;
    } catch {
      return false;
    }
  });
  if (placeholderFiles.length > 0) {
    log('red', '❌ 检测到 0 字节 xlsx 文件（疑似 iCloud 占位未下载）：');
    for (const f of placeholderFiles) {
      log('red', `   ${f.path}`);
    }
    log('yellow', '修复：在 Finder 中右键→「立即下载」，或运行：');
    for (const f of placeholderFiles) {
      log('yellow', `   brctl download "${f.path}"`);
    }
    process.exit(1);
  }
  if (newFormatXlsx.length > 0) {
    log('green', `新格式文件: ${newFormatXlsx.map(f => f.name).join(', ')}`);
  }

  const shards = { static: [], weekly: [], daily: [] };
  const unrecognized = [];
  for (const file of allXlsx) {
    const type = getShardType(file.name, config);
    if (!type) {
      unrecognized.push(file.name);
      continue;
    }
    shards[type].push(file);
  }
  if (unrecognized.length > 0) {
    log('red', `❌ ${unrecognized.length} 个 xlsx 无法识别分片类型，ETL 中止以避免静默丢数据：`);
    for (const name of unrecognized) log('red', `   ${name}`);
    log('red', `   修复：在 daily.mjs:extractDateRange 增加对应正则后重跑`);
    process.exit(1);
  }

  console.log('');
  log('green', '╔══════════════════════════════════════════╗');
  log('green', '║  3层分片 ETL                              ║');
  log('green', '╚══════════════════════════════════════════╝');
  console.log('');
  log('cyan', `  静态分片: ${shards.static.length} 个`);
  log('cyan', `  周更分片: ${shards.weekly.length} 个`);
  log('cyan', `  日增量:   ${shards.daily.length} 个`);
  console.log('');

  const python = findPython();
  log('green', `使用 Python: ${python}`);
  const transformScript = join(scriptDir, 'pipelines/transform.py');

  // 3. 处理静态分片（存在就跳过）
  for (const file of shards.static) {
    const range = extractDateRange(file.name);
    // 新格式文件保留原始名称，旧格式使用日期范围命名
    const outputName = file.name.startsWith('每日数据_')
      ? `每日数据_${range.start}_${range.end}.parquet`
      : file.name.replace(/\.xlsx$/i, '.parquet');
    const outputPath = join(currentDir, outputName);

    let staleReplace = false;
    if (existsSync(outputPath)) {
      // staleness 检测：transform.py 比 parquet 新 → schema 可能已变更，不能静默用旧数据
      // （否则旧 schema 静态分片会与新 schema 周更分片混入 current/，union_by_name 下列错位）。
      const scriptMtime = statSync(transformScript).mtimeMs;
      const parquetMtime = statSync(outputPath).mtimeMs;
      if (scriptMtime > parquetMtime) {
        log('yellow', `⚠️  静态分片已过时（transform.py 晚于 parquet，schema 可能变更），重转替换: ${outputName}`);
        staleReplace = true; // 落到下方走 tmp + 原子 rename，转换成功前不破坏现有分片
      } else {
        log('green', `✓ 静态分片已存在，跳过: ${outputName}`);
        continue;
      }
    }

    // 过时替换先写 .tmp，转换成功后 renameSync 原子替换：避免转换失败/超时时
    // current/ 丢失原本可用的静态分片（codex PR#450 P2）。首次转换无旧文件，直写即可。
    const convertTarget = staleReplace ? outputPath + '.tmp' : outputPath;
    if (staleReplace) { try { if (existsSync(convertTarget)) unlinkSync(convertTarget); } catch (e) {} }
    log('green', `▶ 转换静态分片: ${file.name} → ${outputName}`);
    runPythonScript(python, transformScript, [
      '-i', `"${file.path}"`,
      '-o', `"${convertTarget}"`
    ]);
    if (staleReplace) renameSync(convertTarget, outputPath); // 同目录原子替换
  }

  // 4. 处理周更分片（每次重新转换）
  // 新格式（01_签单清单_*）：每个文件独立命名，多文件共存（剔摩+限摩）
  // 旧格式（每日数据_*）：按日期范围命名，归档旧版本
  const weeklyStart = config.weekly_start.replace(/-/g, '');
  let weeklyArchiveDone = false;  // 旧格式归档只做一次

  for (const file of shards.weekly) {
    const range = extractDateRange(file.name);
    const isNewFormat = file.name.startsWith('01_签单清单_') || /^\d{8}(-\d{8})?_01_签单清单/.test(file.name);

    // 新格式：保留原始名称（如 01_签单清单_剔摩_24年至.parquet），支持多文件共存
    // 旧格式：使用日期范围命名（如 每日数据_20240101_20260409.parquet）
    const outputName = isNewFormat
      ? file.name.replace(/\.xlsx$/i, '.parquet')
      : `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(currentDir, outputName);

    // 范围前缀分片：归档 current/ 中同 start 不同 end 的旧范围 parquet（防重叠双倍计入）
    // 放在缓存检测之前，保证即使本文件缓存命中也清掉历史残留分片
    const rangeM = file.name.match(/^(\d{8})-(\d{8})_01_签单清单.*\.xlsx$/i);
    if (rangeM && existsSync(currentDir)) {
      const staleRange = readdirSync(currentDir).filter(f =>
        f.endsWith('.parquet') && f !== outputName
        && new RegExp(`^${rangeM[1]}-\\d{8}_01_签单清单`).test(f));
      for (const old of staleRange) {
        const archivedName = `${old.replace('.parquet', '')}_${formatDateTime()}.parquet`;
        renameSync(join(currentDir, old), join(archiveDir, archivedName));
        log('yellow', `📦 归档旧范围分片: ${old} → ${archivedName}`);
      }
    }

    // 新格式用缓存检测（xlsx 没变就跳过），旧格式每次重新转换
    if (isNewFormat && !isCacheStale(file.path, outputPath)) {
      log('green', `✓ 周更分片缓存命中: ${outputName}`);
      continue;
    }

    // 旧格式归档旧的周更 parquet（仅限同为旧格式的文件，不归档新格式）
    if (!isNewFormat && !weeklyArchiveDone) {
      const existingOldWeekly = readdirSync(currentDir)
        .filter(f => f.endsWith('.parquet') && f.startsWith('每日数据_') && f !== outputName
                && extractDateRange(f)?.start === weeklyStart);
      for (const old of existingOldWeekly) {
        const archivedName = `${old.replace('.parquet', '')}_${formatDateTime()}.parquet`;
        renameSync(join(currentDir, old), join(archiveDir, archivedName));
        log('yellow', `📦 归档旧周更: ${old} → ${archivedName}`);
      }
      weeklyArchiveDone = true;
    }

    log('green', `▶ 转换周更分片: ${file.name} → ${outputName}`);
    const args = ['-i', `"${file.path}"`, '-o', `"${outputPath}"`];

    // 续保匹配只应用于旧格式周更分片（新格式数据自带续保字段）
    if (!isNewFormat && renewalSource && config.renewal_apply_to === 'weekly') {
      args.push('-r', `"${renewalSource}"`);
      log('green', `  续保匹配: ${basename(renewalSource)}`);
    }

    runPythonScript(python, transformScript, args);

    // 清空 staging（日增量已合入周更 xlsx）
    if (!isNewFormat) cleanStaging(stagingDir);
  }

  // 5. 处理日增量（转到 staging/）
  for (const file of shards.daily) {
    const range = extractDateRange(file.name);
    const outputName = `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(stagingDir, outputName);

    if (!isCacheStale(file.path, outputPath)) {
      log('green', `✓ 日增量缓存命中: ${outputName}`);
      continue;
    }

    log('green', `▶ 转换日增量: ${file.name} → staging/${outputName}`);
    runPythonScript(python, transformScript, [
      '-i', `"${file.path}"`,
      '-o', `"${outputPath}"`
    ]);
  }

  // 更新 premium 域的 data-sources.json（汇总所有 current/ 分片行数）
  // manifest 声明 premium 时由 refresh_metadata.py 统一写入
  const policyCurrentDir = join(WAREHOUSE, 'policy/current');
  if (existsSync(policyCurrentDir) && !_currentReleaseManifest?.domains?.premium) {
    const shardFiles = readdirSync(currentDir).filter(f => f.endsWith('.parquet'));
    let totalRows = 0;
    for (const f of shardFiles) {
      const cnt = getParquetRowCount(python, join(currentDir, f));
      if (cnt != null) totalRows += cnt;
    }
    if (totalRows > 0) updateDataSources('premium', { rowCount: totalRows });
  }
  updateQuickReference(python, policyCurrentDir);

  console.log('');

  // 6. all 模式下追加全部域（带耗时打点：定位 ETL 瓶颈用）
  const __etlTimings = [];
  const __timeDomain = (label, fn) => {
    const t0 = Date.now();
    try {
      fn();
    } finally {
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      __etlTimings.push({ domain: label, seconds: Number(dur) });
      log('cyan', `⏱  [${label}] 耗时 ${dur}s`);
    }
  };
  if (subcommand === 'all') {
    __timeDomain('claims_detail', () => runClaimsDetail(python, scriptDir));
    for (const id of ['cross_sell', 'quotes_conversion', 'brand', 'repair_resource', 'customer_flow', 'new_energy_claims']) {
      __timeDomain(id, () => runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, id)));
    }
    // 派生域放末尾（依赖 policy + quotes_conversion + salesman 已产出）
    __timeDomain('renewal_tracker', () => runRenewalTracker(python, scriptDir));
    // ETL 阶段总结 — 一目了然识别瓶颈
    if (__etlTimings.length > 0) {
      console.log('');
      log('cyan', '=== ETL 耗时汇总（all 模式各域）===');
      const sorted = [...__etlTimings].sort((a, b) => b.seconds - a.seconds);
      const total = sorted.reduce((s, x) => s + x.seconds, 0);
      for (const { domain, seconds } of sorted) {
        const pct = total > 0 ? ((seconds / total) * 100).toFixed(0) : '0';
        log('cyan', `  ${domain.padEnd(20)} ${String(seconds).padStart(6)}s  (${pct}%)`);
      }
      log('cyan', `  ${'TOTAL'.padEnd(20)} ${String(total.toFixed(1)).padStart(6)}s`);
      console.log('');
    }
  }

  // manifest 驱动：所有域完成后单点写入 metadata（premium/claims_detail/cross_sell/customer_flow）
  if (_currentReleaseManifest) {
    runRefreshMetadata(python, scriptDir, _currentReleaseManifest);
  }

  // 7a. 短中长期对照报告（失败不阻塞，先于 VPS 同步以便 rsync 顺带推 HTML）
  if (skipReport) {
    log('yellow', '已跳过短中长期报告生成（--skip-report）');
  } else {
    runPeriodTrendReport(scriptDir, python);
  }

  // 7b. ETL 末端门禁：policy/current 重叠检测（防止 2026-05-15 类裸名+限摩重复事故复发）
  const overlapOk = assertNoPolicyCurrentOverlap(
    join(WAREHOUSE, 'policy/current'),
    {
      onPass: (msg) => log('green', `✓ ${msg}`),
      onFail: (msg) => log('red', `❌ ${msg}`),
    }
  );
  if (!overlapOk) {
    log('red', '中止 VPS 同步：current/ 存在数据翻倍风险，请先修复后重跑');
    process.exit(1);
  }

  // 7. VPS 同步（与子命令路径一致：失败即 exit(1)，不静默吞掉同步失败）
  if (noSync) {
    log('yellow', '已跳过 VPS 同步（--no-sync）');
  } else {
    const synced = await syncToVps(scriptDir);
    if (!synced) {
      log('red', '❌ VPS 同步失败（数据已写入本地）。修复网络后重试: node scripts/sync-vps.mjs --no-restart');
      process.exit(1);
    }
  }

  // 8. 外部系统集成（企业微信智能表格），失败降级告警不阻塞 ETL
  await runPostEtlIntegrations(scriptDir, python);

  console.log('');
  log('green', '✅ ETL 流程完成！');

  // 提示可清理的旧文件
  const staleXlsx = allXlsx.filter(f => {
    const type = getShardType(f.name, config);
    if (type !== 'static' && type !== 'weekly' && type !== 'daily') return true;
    // 检查是否有更新版本（同 start 日期、更新的 end 日期）
    const range = extractDateRange(f.name);
    if (!range) return false;
    return allXlsx.some(other => {
      const otherRange = extractDateRange(other.name);
      return otherRange && otherRange.start === range.start && otherRange.end > range.end;
    });
  });
  if (staleXlsx.length > 0) {
    console.log('');
    log('yellow', '以下旧 xlsx 文件可以安全归档:');
    for (const f of staleXlsx) {
      log('yellow', `  mv "${f.path}" .archive/`);
    }
  }
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
