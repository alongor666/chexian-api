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
 *   warehouse/fact/policy/current/   ← 保单+保费（4个分片文件）
 *   warehouse/fact/policy/staging/   ← 日增量暂存（周更时清空）
 *   warehouse/fact/claims/latest.parquet  ← 赔付+费用（每周全量替换）
 *   warehouse/fact/quotes/latest.parquet  ← 报价状态（每日全量替换）
 *
 * 用法：
 *   node daily.mjs                # 自动处理 premium 分片
 *   node daily.mjs claims         # 全量替换赔付+费用域（已废弃）
 *   node daily.mjs claims_detail  # 全量替换赔案明细域 + claims 聚合
 *   node daily.mjs quotes         # 全量替换报价清单域
 *   node daily.mjs cross_sell     # 全量替换交叉销售域
 *   node daily.mjs renewal        # 全量替换续保清单域
 *   node daily.mjs brand          # 全量替换厂牌维度表
 *   node daily.mjs repair         # 全量替换维修资源域
 *   node daily.mjs customer_flow  # 全量替换客户来源去向域
 *   node daily.mjs all            # 全部 8 域
 *   node daily.mjs --no-sync      # 跳过 VPS 同步
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, rmdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';

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
  // 增量文件强制归入 weekly（以新格式处理，输出到 current/）
  if (filename.match(/增量_\d{8}/)) return 'weekly';

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

/** 用 Python+DuckDB 快速获取 parquet 行数 */
function getParquetRowCount(python, parquetPath) {
  try {
    const result = execSync(
      `"${python}" -c "import pyarrow.parquet as pq; print(pq.read_metadata('${parquetPath.replace(/\\/g, '/')}').num_rows)"`,
      { encoding: 'utf-8', cwd: __dirname }
    );
    return parseInt(result.trim(), 10);
  } catch { return null; }
}

// ── 分域处理 ──

const WAREHOUSE = join(__dirname, 'warehouse/fact');
const QUOTES_DIR = join(WAREHOUSE, 'quotes');
const QUOTES_PATH = join(QUOTES_DIR, 'latest.parquet');
const QUOTES_CONVERSION_DIR = join(WAREHOUSE, 'quotes_conversion');
const QUOTES_CONVERSION_PATH = join(QUOTES_CONVERSION_DIR, 'latest.parquet');
const CLAIMS_DETAIL_DIR = join(WAREHOUSE, 'claims_detail');
const CLAIMS_DETAIL_PATH = join(CLAIMS_DETAIL_DIR, 'latest.parquet');
const CROSS_SELL_DIR = join(WAREHOUSE, 'cross_sell');
const CROSS_SELL_PATH = join(CROSS_SELL_DIR, 'latest.parquet');
const RENEWAL_DIR = join(WAREHOUSE, 'renewal');
const RENEWAL_PATH = join(RENEWAL_DIR, 'latest.parquet');
const CUSTOMER_FLOW_DIR = join(WAREHOUSE, 'customer_flow');
const CUSTOMER_FLOW_PATH = join(CUSTOMER_FLOW_DIR, 'latest.parquet');
const BRAND_DIM_DIR = join(__dirname, 'warehouse/dim/brand');
const BRAND_DIM_PATH = join(BRAND_DIM_DIR, 'latest.parquet');
const REPAIR_DIM_DIR = join(__dirname, 'warehouse/dim/repair');
const REPAIR_DIM_PATH = join(REPAIR_DIM_DIR, 'latest.parquet');
const RENEWAL_UNIVERSE_DIR = join(WAREHOUSE, 'renewal_universe');
const RENEWAL_UNIVERSE_PATH = join(RENEWAL_UNIVERSE_DIR, 'latest.parquet');

async function syncToVps(scriptDir) {
  log('cyan', '[ETL] 自动同步到 VPS...');
  const projectRoot = dirname(scriptDir);
  const syncScript = join(projectRoot, 'scripts/sync-vps.mjs');
  try {
    execSync(`node "${syncScript}"`, { stdio: 'inherit', env: { ...process.env, RUN_MAIN: '1' } });
    log('green', '✅ VPS 同步完成');
    return true;
  } catch (e) {
    console.warn(`[ETL] VPS 同步失败（数据已写入本地）: ${e.message}`);
    console.warn('[ETL] 可手动重试: node scripts/sync-vps.mjs');
    return false;
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

  // 查找赔案明细 xlsx（支持多文件合并，新命名优先）
  const newFiles = ls('02_理赔明细_*.xlsx', scriptDir).sort((a, b) => a.name.localeCompare(b.name));
  const legacyFiles = ls('车险报立结案清单_*.xlsx', scriptDir).sort((a, b) => a.name.localeCompare(b.name));
  const sourceFiles = [...newFiles, ...legacyFiles];
  if (sourceFiles.length === 0) {
    log('yellow', '⚠ 未找到 02_理赔明细_*.xlsx 或 车险报立结案清单_*.xlsx，跳过');
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

  const partitionManager = join(scriptDir, 'pipelines/claims_partition_manager.py');

  if (hasPartitions) {
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

  // Step 3: 清理临时文件
  if (existsSync(tmpOutput)) unlinkSync(tmpOutput);

  // Step 4: 清理旧 latest.parquet（兼容迁移）
  if (existsSync(CLAIMS_DETAIL_PATH)) {
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    renameSync(CLAIMS_DETAIL_PATH, join(archiveDir, `claims_detail_latest_${formatDate()}.parquet`));
    log('yellow', '  归档旧 latest.parquet → archive/');
  }

  // Step 5: 统计总行数
  const totalRows = getPartitionedRowCount(python, CLAIMS_DETAIL_DIR);
  updateDataSources('claims_detail', { rowCount: totalRows, fieldCount: 38 });

  // Step 6: 显示分区状态
  try {
    runPythonScript(python, partitionManager, ['status', '-o', `"${CLAIMS_DETAIL_DIR}"`]);
  } catch { /* non-fatal */ }

  log('green', '✅ ClaimsDetail 域完成（分区模式）');
}

/** 统计分区目录中所有 claims_*.parquet 的总行数 */
function getPartitionedRowCount(python, dir) {
  try {
    const globPath = join(dir, 'claims_*.parquet').replace(/\\/g, '/');
    const result = execSync(
      `"${python}" -c "import duckdb; print(duckdb.sql(\\"SELECT COUNT(*) FROM read_parquet('${globPath}')\\").fetchone()[0])"`,
      { encoding: 'utf-8', cwd: __dirname }
    );
    return parseInt(result.trim(), 10);
  } catch { return null; }
}

function runQuotes(python, scriptDir) {
  log('cyan', '\n═══ Quotes 域：报价状态（全量替换）═══\n');

  // 优先使用独立报价 Excel（商业险续转保报价*.xlsx）
  const quoteFiles = ls('商业险续转保报价*.xlsx', scriptDir);
  const xlsx = quoteFiles.length > 0
    ? quoteFiles[0]  // 独立报价文件（按文件名倒序，取最新）
    : findLargestXlsx(scriptDir);  // 回退到主数据 Excel

  if (!xlsx) { log('red', '未找到报价数据 xlsx'); return; }
  const isStandalone = quoteFiles.length > 0;
  log('green', `源文件: ${xlsx.name} (${(statSync(xlsx.path).size / 1024 / 1024).toFixed(1)} MB)${isStandalone ? ' [独立报价文件]' : ''}`);

  ensureDir(QUOTES_DIR);
  if (existsSync(QUOTES_PATH)) {
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    const ts = formatDate();
    renameSync(QUOTES_PATH, join(archiveDir, `quotes_latest_${ts}.parquet`));
    log('yellow', `  归档旧 quotes → quotes_latest_${ts}.parquet`);
  }

  if (isStandalone) {
    // 独立报价文件：用 convert_quotes.py 处理
    runPythonScript(python, join(scriptDir, 'pipelines/convert_quotes.py'), [
      '-i', `"${xlsx.path}"`, '-o', `"${QUOTES_PATH}"`
    ]);
  } else {
    // 回退：从主数据 Excel 提取报价域
    runPythonScript(python, join(scriptDir, 'pipelines/transform.py'), [
      '-i', `"${xlsx.path}"`, '-o', `"${QUOTES_PATH}"`, '--domain', 'quotes'
    ]);
  }
  // 更新 data-sources.json
  const quotesRowCount = getParquetRowCount(python, QUOTES_PATH);
  updateDataSources('quotes_status', { rowCount: quotesRowCount, fieldCount: 2 });

  log('green', '✅ Quotes 域完成');
}

// ── 安全域转换（先写 tmp，成功后再归档旧文件+原子替换）──

function safeConvertDomain(python, scriptPath, inputPath, outputPath, archivePrefix) {
  const tmpPath = outputPath + '.tmp';
  ensureDir(dirname(outputPath));

  // 先转换到临时文件
  runPythonScript(python, scriptPath, [
    '-i', `"${inputPath}"`, '-o', `"${tmpPath}"`
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

// ── 新域处理函数 ──

function runCrossSell(python, scriptDir) {
  log('cyan', '\n═══ CrossSell 域：交叉销售（多文件合并）═══\n');
  const config = JSON.parse(readFileSync(join(scriptDir, 'shard-config.json'), 'utf-8'));
  const pattern = config.source_patterns?.['03_cross_sell'] || '03_交叉销售_*.xlsx';
  const sourceFiles = ls(pattern, scriptDir);
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${pattern}，跳过`);
    return;
  }

  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  if (sourceFiles.length === 1) {
    // 单文件：直接转换
    safeConvertDomain(python, join(scriptDir, 'pipelines/convert_cross_sell.py'),
      sourceFiles[0].path, CROSS_SELL_PATH, 'cross_sell_latest');
  } else {
    // 多文件：逐个转换 → DuckDB 合并去重
    const tmpDir = join(CROSS_SELL_DIR, '_tmp');
    ensureDir(tmpDir);
    const tmpFiles = [];

    for (const file of sourceFiles) {
      const tmpPath = join(tmpDir, file.name.replace(/\.xlsx$/i, '.parquet'));
      log('green', `▶ 转换: ${file.name}`);
      try {
        runPythonScript(python, join(scriptDir, 'pipelines/convert_cross_sell.py'), [
          '-i', `"${file.path}"`, '-o', `"${tmpPath}"`
        ]);
      } catch (e) {
        log('yellow', `⚠ 转换失败: ${file.name} — ${e.message?.slice(0, 100)}`);
      }
      if (existsSync(tmpPath)) tmpFiles.push(tmpPath);
    }

    if (tmpFiles.length === 0) {
      log('red', '❌ 未生成任何 cross_sell parquet');
      return;
    }

    // 合并：UNION ALL + 按 policy_no 去重（保留最新 policy_date）
    const tmpOutputPath = (CROSS_SELL_PATH + '.tmp').replace(/\\/g, '/');
    const fileListStr = tmpFiles.map(f => `"${f.replace(/\\/g, '/')}"`).join(', ');
    const mergeScriptPath = join(tmpDir, '_merge_cross_sell.py');
    const mergeContent = [
      'import duckdb',
      `files = [${fileListStr}]`,
      `output = "${tmpOutputPath}"`,
      'duckdb.sql(f"""',
      '  COPY (',
      '    SELECT * EXCLUDE (_rn) FROM (',
      '      SELECT *, ROW_NUMBER() OVER (PARTITION BY policy_no ORDER BY policy_date DESC NULLS LAST) AS _rn',
      '      FROM read_parquet({files}, union_by_name=true)',
      '    )',
      '    WHERE _rn = 1',
      "  ) TO '{output}' (FORMAT PARQUET)",
      '""")',
      'cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet(\'{output}\')").fetchone()[0]',
      'print(f"   ✅ 合并完成: {cnt:,} 条")',
    ].join('\n');
    writeFileSync(mergeScriptPath, mergeContent, 'utf-8');
    log('green', `▶ 合并 ${tmpFiles.length} 个分片（按 policy_no 去重）...`);
    runPythonScript(python, mergeScriptPath, []);

    // 归档旧文件 + 原子替换
    if (existsSync(CROSS_SELL_PATH)) {
      const archiveDir = join(homedir(), 'chexian-archive');
      ensureDir(archiveDir);
      renameSync(CROSS_SELL_PATH, join(archiveDir, `cross_sell_latest_${formatDate()}.parquet`));
    }
    renameSync(CROSS_SELL_PATH + '.tmp', CROSS_SELL_PATH);

    // 清理临时文件
    try { unlinkSync(mergeScriptPath); } catch(e) {}
    for (const f of tmpFiles) { try { unlinkSync(f); } catch(e) {} }
    try { if (readdirSync(tmpDir).length === 0) rmdirSync(tmpDir); } catch(e) {}
  }

  const rowCount = getParquetRowCount(python, CROSS_SELL_PATH);
  updateDataSources('cross_sell', { rowCount, fieldCount: 9 });
  log('green', '✅ CrossSell 域完成');
}

function runQuotesV2(python, scriptDir) {
  log('cyan', '\n═══ Quotes 域：报价转化（quote_etl 多文件合并）═══\n');
  const config = JSON.parse(readFileSync(join(scriptDir, 'shard-config.json'), 'utf-8'));
  const pattern = config.source_patterns?.['04_quotes'] || '04_报价清单_*.xlsx';
  const sourceFiles = ls(pattern, scriptDir);

  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${pattern}，跳过`);
    return;
  }

  // 列出所有匹配文件
  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // 归档旧文件
  ensureDir(QUOTES_CONVERSION_DIR);
  if (existsSync(QUOTES_CONVERSION_PATH)) {
    const archiveDir = join(homedir(), 'chexian-archive');
    ensureDir(archiveDir);
    const ts = formatDate();
    renameSync(QUOTES_CONVERSION_PATH, join(archiveDir, `quotes_conversion_latest_${ts}.parquet`));
    log('yellow', `  归档旧 quotes_conversion → quotes_conversion_latest_${ts}.parquet`);
  }

  // 多文件输入：-i file1 file2 (nargs='+' 要求单个 -i 后跟所有文件)
  const inputArgs = ['-i', ...sourceFiles.map(f => `"${f.path}"`)];
  runPythonScript(python, join(scriptDir, 'pipelines/quote_etl.py'), [
    ...inputArgs, '-o', `"${QUOTES_CONVERSION_DIR}"`
  ]);

  const rowCount = getParquetRowCount(python, QUOTES_CONVERSION_PATH);
  updateDataSources('quotes_conversion', { rowCount, fieldCount: 33 });
  log('green', '✅ Quotes 域完成 (quote_etl 多文件合并)');
}

function runRenewal(python, scriptDir) {
  log('cyan', '\n═══ Renewal 域：续保清单（全量替换）═══\n');
  const config = JSON.parse(readFileSync(join(scriptDir, 'shard-config.json'), 'utf-8'));
  const pattern = config.source_patterns?.['05_renewal'] || '05_续保清单_*.xlsx';
  const sourceFiles = ls(pattern, scriptDir);
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${pattern}，跳过`);
    return;
  }
  const xlsx = sourceFiles[0];
  log('green', `源文件: ${xlsx.name} (${(statSync(xlsx.path).size / 1024 / 1024).toFixed(1)} MB)`);

  safeConvertDomain(python, join(scriptDir, 'pipelines/convert_renewal.py'),
    xlsx.path, RENEWAL_PATH, 'renewal_latest');

  const rowCount = getParquetRowCount(python, RENEWAL_PATH);
  updateDataSources('renewal_funnel', { rowCount, fieldCount: 10 });
  log('green', '✅ Renewal 域完成');
}

function runBrand(python, scriptDir) {
  log('cyan', '\n═══ Brand 域：厂牌维度表（全量替换）═══\n');
  const config = JSON.parse(readFileSync(join(scriptDir, 'shard-config.json'), 'utf-8'));
  const pattern = config.source_patterns?.['06_brand'] || '06_厂牌明细*.xlsx';
  const sourceFiles = ls(pattern, scriptDir);
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${pattern}，跳过`);
    return;
  }
  const xlsx = sourceFiles[0];
  log('green', `源文件: ${xlsx.name} (${(statSync(xlsx.path).size / 1024 / 1024).toFixed(1)} MB)`);

  safeConvertDomain(python, join(scriptDir, 'pipelines/convert_brand_dim.py'),
    xlsx.path, BRAND_DIM_PATH, 'brand_latest');

  const rowCount = getParquetRowCount(python, BRAND_DIM_PATH);
  updateDataSources('brand', { rowCount, fieldCount: 15 });
  log('green', '✅ Brand 域完成');
}

function runRepair(python, scriptDir) {
  log('cyan', '\n═══ Repair 域：维修资源（多文件合并）═══\n');
  const config = JSON.parse(readFileSync(join(scriptDir, 'shard-config.json'), 'utf-8'));
  const pattern = config.source_patterns?.['07_repair'] || '07_维修资源*.xlsx';
  const sourceFiles = ls(pattern, scriptDir);
  if (sourceFiles.length === 0) {
    log('yellow', `⚠ 未找到 ${pattern}，跳过`);
    return;
  }

  for (const f of sourceFiles) {
    log('green', `源文件: ${f.name} (${(statSync(f.path).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  if (sourceFiles.length === 1) {
    safeConvertDomain(python, join(scriptDir, 'pipelines/convert_repair.py'),
      sourceFiles[0].path, REPAIR_DIM_PATH, 'repair_latest');
  } else {
    // 多文件：逐个转换 → DuckDB 合并去重
    const tmpDir = join(REPAIR_DIM_DIR, '_tmp');
    ensureDir(tmpDir);
    const tmpFiles = [];

    for (const file of sourceFiles) {
      const tmpPath = join(tmpDir, file.name.replace(/\.xlsx$/i, '.parquet'));
      log('green', `▶ 转换: ${file.name}`);
      try {
        runPythonScript(python, join(scriptDir, 'pipelines/convert_repair.py'), [
          '-i', `"${file.path}"`, '-o', `"${tmpPath}"`
        ]);
      } catch (e) {
        log('yellow', `⚠ 转换失败: ${file.name} — ${e.message?.slice(0, 100)}`);
      }
      if (existsSync(tmpPath)) tmpFiles.push(tmpPath);
    }

    if (tmpFiles.length === 0) {
      log('red', '❌ 未生成任何 repair parquet');
      return;
    }

    // 合并：UNION ALL + 按 repair_shop_name 去重（保留最新 report_date）
    const tmpOutputPath = (REPAIR_DIM_PATH + '.tmp').replace(/\\/g, '/');
    const fileListStr = tmpFiles.map(f => `"${f.replace(/\\/g, '/')}"`).join(', ');
    const mergeScriptPath = join(tmpDir, '_merge_repair.py');
    const mergeContent = [
      'import duckdb',
      `files = [${fileListStr}]`,
      `output = "${tmpOutputPath}"`,
      'duckdb.sql(f"""',
      '  COPY (',
      '    SELECT * EXCLUDE (_rn) FROM (',
      '      SELECT *, ROW_NUMBER() OVER (PARTITION BY repair_shop_name ORDER BY report_date DESC NULLS LAST) AS _rn',
      '      FROM read_parquet({files}, union_by_name=true)',
      '    )',
      '    WHERE _rn = 1',
      "  ) TO '{output}' (FORMAT PARQUET)",
      '""")',
      'cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet(\'{output}\')").fetchone()[0]',
      'print(f"   ✅ 合并完成: {cnt:,} 条")',
    ].join('\n');
    writeFileSync(mergeScriptPath, mergeContent, 'utf-8');
    log('green', `▶ 合并 ${tmpFiles.length} 个分片（按 repair_shop_name 去重）...`);
    runPythonScript(python, mergeScriptPath, []);

    // 归档旧文件 + 原子替换
    if (existsSync(REPAIR_DIM_PATH)) {
      const archiveDir = join(homedir(), 'chexian-archive');
      ensureDir(archiveDir);
      renameSync(REPAIR_DIM_PATH, join(archiveDir, `repair_latest_${formatDate()}.parquet`));
    }
    renameSync(REPAIR_DIM_PATH + '.tmp', REPAIR_DIM_PATH);

    // 清理临时文件
    try { unlinkSync(mergeScriptPath); } catch(e) {}
    for (const f of tmpFiles) { try { unlinkSync(f); } catch(e) {} }
    try { if (readdirSync(tmpDir).length === 0) rmdirSync(tmpDir); } catch(e) {}
  }

  const rowCount = getParquetRowCount(python, REPAIR_DIM_PATH);
  updateDataSources('repair_resource', { rowCount, fieldCount: 12 });
  log('green', '✅ Repair 域完成');
}

function runCustomerFlow(python, scriptDir) {
  log('cyan', '\n═══ CustomerFlow 域：客户来源去向（全量替换）═══\n');
  const sourceFiles = ls('08_客户来源去向*.xlsx', scriptDir);
  if (sourceFiles.length === 0) {
    log('yellow', '⚠ 未找到 08_客户来源去向*.xlsx，跳过');
    return;
  }
  const xlsx = sourceFiles[0];
  log('green', `源文件: ${xlsx.name} (${(statSync(xlsx.path).size / 1024 / 1024).toFixed(1)} MB)`);

  safeConvertDomain(python, join(scriptDir, 'pipelines/convert_customer_flow.py'),
    xlsx.path, CUSTOMER_FLOW_PATH, 'customer_flow_latest');

  const rowCount = getParquetRowCount(python, CUSTOMER_FLOW_PATH);
  updateDataSources('customer_flow', { rowCount, fieldCount: 7 });
  log('green', '✅ CustomerFlow 域完成');
}

function runRenewalUniverse(python, scriptDir) {
  log('cyan', '\n═══ RenewalUniverse 域：续保宇宙预计算（多源 JOIN）═══\n');

  // 依赖：policy/current/ + quotes + customer_flow
  const policyGlob = join(scriptDir, 'warehouse/fact/policy/current/*.parquet');
  const quotesPath = QUOTES_PATH;
  const customerFlowPath = CUSTOMER_FLOW_PATH;

  const args = [
    '--policy-glob', `"${policyGlob}"`,
    '-o', `"${RENEWAL_UNIVERSE_PATH}"`,
  ];
  if (existsSync(quotesPath)) args.push('--quotes', `"${quotesPath}"`);
  if (existsSync(customerFlowPath)) args.push('--customer-flow', `"${customerFlowPath}"`);

  runPythonScript(python, join(scriptDir, 'pipelines/generate_renewal_universe.py'), args);

  const rowCount = getParquetRowCount(python, RENEWAL_UNIVERSE_PATH);
  updateDataSources('renewal_universe', { rowCount, fieldCount: 31 });
  log('green', '✅ RenewalUniverse 域完成');
}

// ── 主流程 ──

async function main() {
  const scriptDir = __dirname;
  process.chdir(scriptDir);

  const noSync = process.argv.includes('--no-sync');
  const ALL_DOMAINS = ['premium', 'claims', 'claims_detail', 'quotes', 'cross_sell', 'renewal', 'renewal_universe', 'brand', 'repair', 'customer_flow', 'all'];
  const subcommand = process.argv.find(a => ALL_DOMAINS.includes(a));

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
      case 'quotes': runQuotesV2(python, scriptDir); break;
      case 'cross_sell': runCrossSell(python, scriptDir); break;
      case 'renewal': runRenewal(python, scriptDir); break;
      case 'brand': runBrand(python, scriptDir); break;
      case 'repair': runRepair(python, scriptDir); break;
      case 'customer_flow': runCustomerFlow(python, scriptDir); break;
      case 'renewal_universe': runRenewalUniverse(python, scriptDir); break;
    }
    if (!noSync) {
      const synced = await syncToVps(scriptDir);
      if (synced) await rebuildSnapshots(scriptDir);
    }
    return;
  }
  if (subcommand === 'all') {
    // all = premium（下面的分片流程）+ 全部 7 个域
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

  // 2. 识别所有 xlsx 分片（新格式 + 旧格式 + 剔摩/限摩）
  const legacyXlsx = ls('每日数据_*.xlsx', scriptDir);
  const newFormatXlsx = ls('01_签单清单_*.xlsx', scriptDir);
  const allXlsx = [...legacyXlsx, ...newFormatXlsx];
  if (allXlsx.length === 0) {
    log('red', '❌ 未找到任何签单清单 xlsx 文件（每日数据_*.xlsx 或 01_签单清单_*.xlsx）');
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
    const isNewFormat = file.name.startsWith('01_签单清单_');

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

  // 更新 premium 域的 data-sources.json（汇总所有 current/ 分片行数）
  const policyCurrentDir = join(WAREHOUSE, 'policy/current');
  if (existsSync(policyCurrentDir)) {
    const shardFiles = readdirSync(currentDir).filter(f => f.endsWith('.parquet'));
    let totalRows = 0;
    for (const f of shardFiles) {
      const cnt = getParquetRowCount(python, join(currentDir, f));
      if (cnt != null) totalRows += cnt;
    }
    if (totalRows > 0) updateDataSources('premium', { rowCount: totalRows });
  }

  console.log('');

  // 6. all 模式下追加全部域
  if (subcommand === 'all') {
    runClaimsDetail(python, scriptDir);
    runCrossSell(python, scriptDir);
    runQuotesV2(python, scriptDir);
    runRenewal(python, scriptDir);
    runBrand(python, scriptDir);
    runRepair(python, scriptDir);
    runCustomerFlow(python, scriptDir);
  }

  // 7. VPS 同步 + 快照重建
  if (noSync) {
    log('yellow', '已跳过 VPS 同步（--no-sync）');
  } else {
    const synced = await syncToVps(scriptDir);
    if (synced) await rebuildSnapshots(scriptDir);
  }

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
