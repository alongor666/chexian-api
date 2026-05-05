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
 *   node daily.mjs customer_flow  # 全量替换客户来源去向域
 *   node daily.mjs renewal_tracker # 续保追踪派生域（JOIN policy+quotes+salesman）
 *   node daily.mjs all            # 全部域（含派生域）
 *   node daily.mjs --no-sync      # 跳过 VPS 同步
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, rmdirSync } from 'fs';
import { basename, dirname, join, resolve, isAbsolute } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';
import {
  getParquetRowCount,
  getParquetColumnCount,
  getPartitionedRowCount,
  getPartitionedColumnCount,
} from './pipelines/parquet_stats.mjs';
import { collectPolicyCurrentStats, syncQuickReferenceFile } from './pipelines/quick_reference.mjs';

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
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return readdirSync(absDir)
    .filter(f => regex.test(f))
    .map(f => ({ name: f, path: join(absDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function runPythonScript(python, scriptPath, args) {
  const cmd = `"${python}" "${scriptPath}" ${args.join(' ')}`;
  log('blue', `执行: ${cmd}`);
  const env = { ...process.env };
  // 确保 pipelines 包可被 import（from pipelines.xxx import ...）
  const existingPath = env.PYTHONPATH || '';
  env.PYTHONPATH = existingPath ? `${__dirname}:${existingPath}` : __dirname;
  if (isWindows()) {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    env.PYTHONPATH = existingPath ? `${__dirname};${existingPath}` : __dirname;
  }
  execSync(cmd, { stdio: 'inherit', cwd: __dirname, env, timeout: 30 * 60 * 1000 });
}

function checkVpsConnectivity() {
  try {
    execSync('ssh -o BatchMode=yes -o ConnectTimeout=10 chexian-vps-deploy true', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// ── 分片逻辑 ──

/** 从文件名提取日期范围，支持下划线和连字符 */
function extractDateRange(filename) {
  // 新前缀格式（2026-04-26 起）：20260426_01_签单清单.xlsx → single-day（归入 weekly 处理）
  const newPrefix = filename.match(/^(\d{8})_\d{2}_/);
  if (newPrefix) {
    return { start: newPrefix[1], end: newPrefix[1] };
  }
  // 新格式：01_签单清单_21-23年.xlsx → { start: '20210101', end: '20231231' }
  const newFmt = filename.match(/(\d{2})-(\d{2})年/);
  if (newFmt) {
    return { start: `20${newFmt[1]}0101`, end: `20${newFmt[2]}1231` };
  }
  // 开放结束格式：01_签单清单_剔摩_24年至.xlsx → { start: '20240101', end: 今天 }
  const openEnd = filename.match(/(\d{2})年至/);
  if (openEnd) {
    return { start: `20${openEnd[1]}0101`, end: formatDate() };
  }
  // 增量格式：01_签单清单_增量_20260411.xlsx → single-day（归入 weekly 处理）
  const incr = filename.match(/增量_(\d{8})/);
  if (incr) {
    return { start: incr[1], end: incr[1] };
  }
  // 旧格式：每日数据_20240101_20260407.xlsx
  const m = filename.match(/每日数据_(\d{8})[_-](\d{8})/);
  return m ? { start: m[1], end: m[2] } : null;
}

/** 判断分片类型 */
function getShardType(filename, config) {
  const range = extractDateRange(filename);
  if (!range) return null;
  // 增量文件 / 新前缀单日文件 强制归入 weekly（以新格式处理，输出到 current/）
  if (filename.match(/增量_\d{8}/) || filename.match(/^\d{8}_\d{2}_/)) return 'weekly';

  const cutoff = parseInt(config.static_cutoff.replace(/-/g, ''));
  const weeklyStart = config.weekly_start.replace(/-/g, '');

  if (parseInt(range.end) <= cutoff) return 'static';
  if (range.start === weeklyStart) return 'weekly';
  return 'daily';
}

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

  // 多 glob 合并 + 按 path 去重（避免同一文件被多个模式匹配重复）
  const seen = new Set();
  const sourceFiles = inputGlobs
    .flatMap(g => ls(g, scriptDir))
    .filter(f => (seen.has(f.path) ? false : (seen.add(f.path), true)));
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${inputGlobs.join(' / ')}，跳过`);
    return;
  }
  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  const ctx = {
    python, id, scriptDir, sourceFiles, trigger,
    scriptPath: join(scriptDir, etl_script),
    outputAbs: join(scriptDir, output),
    extraArgs,
  };
  ensureDir(dirname(ctx.outputAbs));

  const strategyFn = {
    single: runStrategySingle,
    multi_file_input: runStrategyMultiInput,
    multi_file_merge: runStrategyMultiMerge,
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

function runStrategySingle({ python, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] }) {
  // 多 glob 并存时按 mtime 取最新文件（避免历史旧命名文件长期占据声明顺序首位、屏蔽新命名更新）
  const latest = sourceFiles
    .slice()
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs)[0];
  if (sourceFiles.length > 1) {
    log('cyan', `  single 策略：${sourceFiles.length} 个候选 → 选 mtime 最新: ${latest.name}`);
  }
  safeConvertDomain(python, scriptPath, latest.path, outputAbs, trigger.archive_prefix, extraArgs);
}

function runStrategyMultiInput({ python, id, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] }) {
  const { archive_prefix, output_is_dir } = trigger;
  if (existsSync(outputAbs)) {
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDate()}.parquet`));
    log('yellow', `  归档旧 ${id} → ${archive_prefix}_${formatDate()}.parquet`);
  }
  const inputArgs = ['-i', ...sourceFiles.map(f => `"${f.path}"`)];
  const outputArg = output_is_dir ? dirname(outputAbs) : outputAbs;
  runPythonScript(python, scriptPath, [...inputArgs, '-o', `"${outputArg}"`, ...extraArgs]);
}

function runStrategyMultiMerge(ctx) {
  const { python, id, scriptDir, scriptPath, sourceFiles, outputAbs, trigger, extraArgs = [] } = ctx;
  const { archive_prefix, merge_dedup_key, merge_order_by } = trigger;
  const hasHistory = trigger.merge_with_history === true && existsSync(outputAbs);

  const tmpDir = join(dirname(outputAbs), '_tmp');
  ensureDir(tmpDir);
  const tmpFiles = [];
  for (const file of sourceFiles) {
    const tmpPath = join(tmpDir, file.name.replace(/\.xlsx$/i, '.parquet'));
    log('green', `▶ 转换: ${file.name}`);
    try {
      // extraArgs 传给 BaseConverter 子脚本（如 --no-metadata），merge_parquet.py 不消费 extraArgs
      runPythonScript(python, scriptPath, ['-i', `"${file.path}"`, '-o', `"${tmpPath}"`, ...extraArgs]);
    } catch (e) {
      log('yellow', `⚠ 转换失败: ${file.name} — ${e.message?.slice(0, 100)}`);
    }
    if (existsSync(tmpPath)) tmpFiles.push(tmpPath);
  }
  if (tmpFiles.length === 0) {
    log('red', `❌ 未生成任何 ${id} parquet`);
    return false;
  }

  const archiveDir = join(homedir(), 'chexian-archive');
  // 短路：单文件 + 不合并历史 → 直接替换（避免起 DuckDB 进程）
  if (tmpFiles.length === 1 && !hasHistory) {
    if (existsSync(outputAbs)) {
      ensureDir(archiveDir);
      renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDate()}.parquet`));
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
      '--dedup-key', merge_dedup_key,
      '--order-by', `"${merge_order_by}"`,
    ]);
    if (existsSync(outputAbs)) {
      ensureDir(archiveDir);
      renameSync(outputAbs, join(archiveDir, `${archive_prefix}_${formatDate()}.parquet`));
    }
    renameSync(tmpOutput, outputAbs);
    for (const f of tmpFiles) { try { unlinkSync(f); } catch (e) {} }
  }
  try { if (readdirSync(tmpDir).length === 0) rmdirSync(tmpDir); } catch (e) {}
}

async function syncToVps(scriptDir) {
  log('cyan', '[ETL] 自动同步到 VPS（仅 rsync，不重启 PM2）...');
  const projectRoot = dirname(scriptDir);
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
  for (const yamlFile of v2Instances) {
    const instance = yamlFile.replace(/\.ya?ml$/, '');
    log('cyan', `\n  ▶ [v2] ${instance}`);
    try {
      runPythonScript(python, scriptV2, [
        '--instance', `"${join(instancesDir, yamlFile)}"`,
      ]);
      log('green', `  ✓ ${instance} 同步完成`);
    } catch (err) {
      const msg = (err.message || '').trim();
      log('red', `  ⚠ ${instance} 同步失败（降级告警，不阻塞 ETL）`);
      for (const line of msg.split('\n')) if (line.trim()) log('red', `     ${line}`);
      log('yellow', `     详细日志：${join(integrationDir, 'logs')}/${instance}_sync_*.json`);
      log('yellow', `     手动重试：python3 ${scriptV2} --instance ${join(instancesDir, yamlFile)} --dry-run`);
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

async function rebuildSnapshots(scriptDir) {
  log('cyan', '[ETL] 重建静态快照（从 VPS 拉取新数据）...');
  const projectRoot = dirname(scriptDir);
  const buildScript = join(projectRoot, 'scripts/build-snapshots.mjs');
  const syncScript = join(projectRoot, 'scripts/sync-vps.mjs');
  try {
    execSync(`node "${buildScript}"`, {
      stdio: 'inherit',
      env: { ...process.env, SNAPSHOT_SERVER_URL: 'https://chexian.cretvalu.com' },
    });
    log('green', '✅ 快照重建完成');
    // 增量推送快照到 VPS（不重启，rsync 只传变更文件）
    execSync(`node "${syncScript}" --no-restart`, {
      stdio: 'inherit',
      env: { ...process.env, RUN_MAIN: '1' },
    });
    log('green', '✅ 快照已同步到 VPS');
  } catch (e) {
    console.warn(`[ETL] 快照重建失败（不影响数据同步）: ${e.message}`);
    console.warn('[ETL] 可手动重试: SNAPSHOT_SERVER_URL=https://chexian.cretvalu.com bun run snapshot:build');
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
  const newFiles = [
    ...ls('02_理赔明细_*.xlsx', scriptDir),
    ...ls('????????_02_理赔明细*.xlsx', scriptDir),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const legacyFiles = ls('车险报立结案清单_*.xlsx', scriptDir).sort((a, b) => a.name.localeCompare(b.name));
  const sourceFiles = manifestFiles || [...newFiles, ...legacyFiles];
  if (sourceFiles.length === 0) {
    log('yellow', '⚠ 未找到 02_理赔明细_*.xlsx / ????????_02_理赔明细*.xlsx 或 车险报立结案清单_*.xlsx，跳过');
    return;
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
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    renameSync(CLAIMS_DETAIL_PATH, join(archiveDir, `claims_detail_latest_${formatDate()}.parquet`));
    log('yellow', '  归档旧 latest.parquet → archive/');
  }

  // Step 5: 统计总行数 + 列数（从 parquet 实读，避免硬编码过时）
  const totalRows = getPartitionedRowCount(python, CLAIMS_DETAIL_DIR);
  const fieldCount = getPartitionedColumnCount(python, CLAIMS_DETAIL_DIR);
  // manifest 声明 claims_detail 时由 refresh_metadata.py 统一写入
  if (!_currentReleaseManifest?.domains?.claims_detail) {
    updateDataSources('claims_detail', { rowCount: totalRows, fieldCount });
  }

  // Step 6: 显示分区状态
  try {
    runPythonScript(python, partitionManager, ['status', '-o', `"${CLAIMS_DETAIL_DIR}"`]);
  } catch { /* non-fatal */ }

  log('green', '✅ ClaimsDetail 域完成（分区模式）');
}

// ── 安全域转换（先写 tmp，成功后再归档旧文件+原子替换）──

function safeConvertDomain(python, scriptPath, inputPath, outputPath, archivePrefix, extraArgs = []) {
  const tmpPath = outputPath + '.tmp';
  ensureDir(dirname(outputPath));

  // 先转换到临时文件（extraArgs 透传给 BaseConverter 子脚本，如 --no-metadata）
  runPythonScript(python, scriptPath, [
    '-i', `"${inputPath}"`, '-o', `"${tmpPath}"`, ...extraArgs
  ]);

  // 转换成功后才归档旧文件
  if (existsSync(outputPath)) {
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    renameSync(outputPath, join(archiveDir, `${archivePrefix}_${formatDate()}.parquet`));
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
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    renameSync(outputPath, join(archiveDir, `renewal_tracker_latest_${formatDate()}.parquet`));
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

  const noSync = process.argv.includes('--no-sync');
  const ALL_DOMAINS = ['premium', 'claims', 'claims_detail', 'quotes', 'cross_sell', 'brand', 'repair', 'customer_flow', 'renewal_tracker', 'all'];
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
      case 'renewal_tracker': runRenewalTracker(python, scriptDir); break;
    }
    // manifest 驱动：该域完成后单点写入 metadata（替代 subroutine 内的 updateDataSources）
    if (_currentReleaseManifest) {
      runRefreshMetadata(python, scriptDir, _currentReleaseManifest);
    }
    if (!noSync) {
      const synced = await syncToVps(scriptDir);
      if (synced) await rebuildSnapshots(scriptDir);
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
  const archiveDir = join(homedir(), 'chexian-archive');

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

  // 2. 识别所有 xlsx 分片（新格式 + 旧格式 + 剔摩/限摩 + 新前缀 YYYYMMDD_01_*）
  const legacyXlsx = ls('每日数据_*.xlsx', scriptDir);
  const newFormatXlsx = [
    ...ls('01_签单清单_*.xlsx', scriptDir),
    ...ls('????????_01_签单清单*.xlsx', scriptDir),
  ];
  const allXlsx = [...legacyXlsx, ...newFormatXlsx];
  if (allXlsx.length === 0) {
    log('red', '❌ 未找到任何签单清单 xlsx 文件（每日数据_*.xlsx / 01_签单清单_*.xlsx / ????????_01_签单清单*.xlsx）');
    process.exit(1);
  }
  if (newFormatXlsx.length > 0) {
    log('green', `新格式文件: ${newFormatXlsx.map(f => f.name).join(', ')}`);
  }

  const shards = { static: [], weekly: [], daily: [] };
  for (const file of allXlsx) {
    const type = getShardType(file.name, config);
    if (!type) {
      log('yellow', `⚠ 无法识别分片类型: ${file.name}`);
      continue;
    }
    shards[type].push(file);
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

    if (existsSync(outputPath)) {
      // staleness 检测：transform.py 比 parquet 新 → 告警
      const scriptMtime = statSync(transformScript).mtimeMs;
      const parquetMtime = statSync(outputPath).mtimeMs;
      if (scriptMtime > parquetMtime) {
        log('yellow', `⚠️  静态分片已过时: ${outputName}`);
        log('yellow', `   transform.py 修改时间晚于 parquet，schema 可能已变更`);
        log('yellow', `   → 删除 ${outputPath} 后重新运行以更新`);
      } else {
        log('green', `✓ 静态分片已存在，跳过: ${outputName}`);
      }
      continue;
    }

    log('green', `▶ 转换静态分片: ${file.name} → ${outputName}`);
    runPythonScript(python, transformScript, [
      '-i', `"${file.path}"`,
      '-o', `"${outputPath}"`
    ]);
  }

  // 4. 处理周更分片（每次重新转换）
  // 新格式（01_签单清单_*）：每个文件独立命名，多文件共存（剔摩+限摩）
  // 旧格式（每日数据_*）：按日期范围命名，归档旧版本
  const weeklyStart = config.weekly_start.replace(/-/g, '');
  let weeklyArchiveDone = false;  // 旧格式归档只做一次

  for (const file of shards.weekly) {
    const range = extractDateRange(file.name);
    const isNewFormat = file.name.startsWith('01_签单清单_') || /^\d{8}_01_签单清单/.test(file.name);

    // 新格式：保留原始名称（如 01_签单清单_剔摩_24年至.parquet），支持多文件共存
    // 旧格式：使用日期范围命名（如 每日数据_20240101_20260409.parquet）
    const outputName = isNewFormat
      ? file.name.replace(/\.xlsx$/i, '.parquet')
      : `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(currentDir, outputName);

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
        const archivedName = `${old.replace('.parquet', '')}_${formatDate()}.parquet`;
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

  // 5.5 费用金额回填：24+签单源可能总费用金额为空，使用变动成本清单的实际手续费补齐
  const feeBackfillCsv = join(scriptDir, '车险保单变动成本清单_精简.csv');
  const feeBackfillScript = join(scriptDir, 'pipelines/backfill_policy_fee_amount.py');
  if (existsSync(feeBackfillCsv)) {
    log('green', `▶ 回填 PolicyFact 费用金额: ${basename(feeBackfillCsv)}`);
    runPythonScript(python, feeBackfillScript, [
      '--policy-dir', `"${currentDir}"`,
      '--fee-csv', `"${feeBackfillCsv}"`
    ]);
  } else {
    log('yellow', `⚠️  未找到费用回填清单，跳过: ${feeBackfillCsv}`);
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

  // 6. all 模式下追加全部域
  if (subcommand === 'all') {
    runClaimsDetail(python, scriptDir);
    for (const id of ['cross_sell', 'quotes_conversion', 'brand', 'repair_resource', 'customer_flow']) {
      runStandardDomain(python, scriptDir, loadDomainManifest(scriptDir, id));
    }
    // 派生域放末尾（依赖 policy + quotes_conversion + salesman 已产出）
    runRenewalTracker(python, scriptDir);
  }

  // manifest 驱动：所有域完成后单点写入 metadata（premium/claims_detail/cross_sell/customer_flow）
  if (_currentReleaseManifest) {
    runRefreshMetadata(python, scriptDir, _currentReleaseManifest);
  }

  // 7. VPS 同步 + 快照重建
  if (noSync) {
    log('yellow', '已跳过 VPS 同步（--no-sync）');
  } else {
    const synced = await syncToVps(scriptDir);
    if (synced) await rebuildSnapshots(scriptDir);
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
      log('yellow', `  mv "${f.path}" ~/chexian-archive/`);
    }
  }
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
