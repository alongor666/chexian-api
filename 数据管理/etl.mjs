#!/usr/bin/env node
/**
 * 分域 ETL 入口（替代 daily.mjs）
 *
 * 用法:
 *   node etl.mjs premium   # 每日：增量追加 policy/daily/
 *   node etl.mjs claims    # 每周：全量替换 claims/latest.parquet
 *   node etl.mjs quotes    # 每日：全量替换 quotes/latest.parquet
 *   node etl.mjs all       # 全部重跑（初始化/修复用）
 *
 * 数据架构:
 *   warehouse/fact/policy/daily/YYYY-MM-DD.parquet  ← 保单+保费（按日分区）
 *   warehouse/fact/claims/latest.parquet            ← 赔付+费用
 *   warehouse/fact/quotes/latest.parquet            ← 报价状态
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, renameSync, mkdirSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 颜色与工具 ──

const colors = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  blue: '\x1b[34m', cyan: '\x1b[36m', reset: '\x1b[0m'
};

function log(color, msg) { console.log(`${colors[color]}${msg}${colors.reset}`); }

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function findPython() {
  const cmds = platform() === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cmd of cmds) {
    try { execSync(`${cmd} --version`, { stdio: 'pipe' }); return cmd; }
    catch (_) { /* next */ }
  }
  throw new Error('未找到 Python');
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

function runPython(python, script, args) {
  const cmd = `"${python}" "${script}" ${args.join(' ')}`;
  log('blue', `执行: ${cmd}`);
  const env = { ...process.env };
  if (platform() === 'win32') {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }
  execSync(cmd, { stdio: 'inherit', cwd: __dirname, env });
}

// ── 路径定义 ──

const SCRIPT_DIR = __dirname;
const WAREHOUSE = join(SCRIPT_DIR, 'warehouse/fact');
const POLICY_DAILY_DIR = join(WAREHOUSE, 'policy/daily');
const CLAIMS_DIR = join(WAREHOUSE, 'claims');
const CLAIMS_PATH = join(CLAIMS_DIR, 'latest.parquet');
const QUOTES_DIR = join(WAREHOUSE, 'quotes');
const QUOTES_PATH = join(QUOTES_DIR, 'latest.parquet');
const ARCHIVE_DIR = join(homedir(), 'chexian-archive');
const TRANSFORM_SCRIPT = join(SCRIPT_DIR, 'pipelines/transform.py');

// ── 源文件查找 ──

/**
 * 查找源 xlsx 文件。
 * - premium 用最新文件（可能是增量小文件）
 * - claims/quotes 用最大的全量文件（赔付/报价会回溯更新历史）
 */
function findCurrentXlsx(preferLargest = false) {
  const files = ls('每日数据_*.xlsx', SCRIPT_DIR)
    .filter(f => !/20241231\.xlsx$/i.test(f.name));
  if (files.length === 0) return null;

  if (preferLargest) {
    // claims/quotes：选文件最大的（全量数据）
    return files.sort((a, b) => statSync(b.path).size - statSync(a.path).size)[0];
  }
  // premium：选文件名最新的（可能是增量）
  return files[0];
}

function findRenewalSource() {
  const files = [
    ...ls('续保业务类型匹配*.xlsx', SCRIPT_DIR),
    ...ls('续保类型匹配*.xlsx', SCRIPT_DIR)
  ].sort((a, b) => b.name.localeCompare(a.name));
  return files.length > 0 ? files[0].path : null;
}

/** 扫描 daily/ 目录中最新日期文件 → "YYYY-MM-DD" */
function getLatestDailyDate() {
  if (!existsSync(POLICY_DAILY_DIR)) return null;
  const files = readdirSync(POLICY_DAILY_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.parquet$/.test(f))
    .sort((a, b) => b.localeCompare(a));
  if (files.length === 0) return null;
  return files[0].replace('.parquet', '');
}

/** 从 xlsx 文件名提取结束日期 → "YYYY-MM-DD" */
function xlsxEndDate(filename) {
  const m = filename.match(/每日数据_\d{8}-(\d{8})/);
  if (!m) return null;
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 归档旧文件（覆盖前备份） */
function archiveFile(filePath) {
  if (!existsSync(filePath)) return;
  ensureDir(ARCHIVE_DIR);
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `${basename(filePath, '.parquet')}_${ts}.parquet`;
  renameSync(filePath, join(ARCHIVE_DIR, name));
  log('yellow', `  归档: ${basename(filePath)} → ${name}`);
}

// ── 子命令实现 ──

function runPremium(python) {
  log('cyan', '\n═══ Premium 域：保单+保费（增量追加）═══\n');

  const xlsx = findCurrentXlsx();
  if (!xlsx) { log('red', '未找到当前数据 xlsx'); process.exit(1); }
  log('green', `源文件: ${xlsx.name}`);

  ensureDir(POLICY_DAILY_DIR);

  const latestDate = getLatestDailyDate();
  const endDate = xlsxEndDate(xlsx.name);

  if (latestDate && endDate && latestDate >= endDate) {
    log('yellow', `daily/ 已有数据截至 ${latestDate}，xlsx 截至 ${endDate}，无需更新`);
    return;
  }

  const outputFile = join(POLICY_DAILY_DIR, (endDate || 'output') + '.parquet');
  const args = ['-i', `"${xlsx.path}"`, '-o', `"${outputFile}"`, '--domain', 'policy'];

  if (latestDate) {
    args.push('--after-date', latestDate);
    log('green', `增量模式: 只提取签单日期 > ${latestDate}`);
  } else {
    log('green', '全量模式: 首次生成');
  }

  const renewalSource = findRenewalSource();
  if (renewalSource) {
    args.push('-r', `"${renewalSource}"`);
    log('green', `续保源: ${basename(renewalSource)}`);
  }

  runPython(python, TRANSFORM_SCRIPT, args);
  log('green', 'Premium 域完成');
}

function runClaims(python) {
  log('cyan', '\n═══ Claims 域：赔付+费用（全量替换）═══\n');

  const xlsx = findCurrentXlsx(true);  // 选最大的全量文件
  if (!xlsx) { log('red', '未找到当前数据 xlsx'); process.exit(1); }
  log('green', `源文件: ${xlsx.name}`);

  ensureDir(CLAIMS_DIR);
  archiveFile(CLAIMS_PATH);

  const args = ['-i', `"${xlsx.path}"`, '-o', `"${CLAIMS_PATH}"`, '--domain', 'claims'];
  runPython(python, TRANSFORM_SCRIPT, args);
  log('green', 'Claims 域完成');
}

function runQuotes(python) {
  log('cyan', '\n═══ Quotes 域：报价状态（全量替换）═══\n');

  const xlsx = findCurrentXlsx(true);  // 选最大的全量文件
  if (!xlsx) { log('red', '未找到当前数据 xlsx'); process.exit(1); }
  log('green', `源文件: ${xlsx.name}`);

  ensureDir(QUOTES_DIR);
  archiveFile(QUOTES_PATH);

  const args = ['-i', `"${xlsx.path}"`, '-o', `"${QUOTES_PATH}"`, '--domain', 'quotes'];
  runPython(python, TRANSFORM_SCRIPT, args);
  log('green', 'Quotes 域完成');
}

// ── 智能检测 ──

/** 检测哪些域需要更新 */
function detectNeeded() {
  const needed = [];

  // 1. Premium：增量 xlsx 的结束日期 > daily/ 最新日期？
  const xlsx = findCurrentXlsx(false);
  if (xlsx) {
    const latestDaily = getLatestDailyDate();
    const xlsxEnd = xlsxEndDate(xlsx.name);
    if (!latestDaily || (xlsxEnd && xlsxEnd > latestDaily)) {
      needed.push({ domain: 'premium', reason: latestDaily
        ? `daily/ 截至 ${latestDaily}，xlsx 截至 ${xlsxEnd}`
        : 'daily/ 为空，首次生成' });
    }
  }

  // 2. Claims：全量 xlsx 比 claims/latest.parquet 更新？
  const fullXlsx = findCurrentXlsx(true);
  if (fullXlsx) {
    const xlsxMtime = statSync(fullXlsx.path).mtimeMs;
    const claimsStale = !existsSync(CLAIMS_PATH) || statSync(CLAIMS_PATH).mtimeMs < xlsxMtime;
    if (claimsStale) {
      needed.push({ domain: 'claims', reason: !existsSync(CLAIMS_PATH)
        ? 'claims/latest.parquet 不存在'
        : `xlsx (${fullXlsx.name}) 比 claims 更新` });
    }
  }

  // 3. Quotes：全量 xlsx 比 quotes/latest.parquet 更新？
  if (fullXlsx) {
    const xlsxMtime = statSync(fullXlsx.path).mtimeMs;
    const quotesStale = !existsSync(QUOTES_PATH) || statSync(QUOTES_PATH).mtimeMs < xlsxMtime;
    if (quotesStale) {
      needed.push({ domain: 'quotes', reason: !existsSync(QUOTES_PATH)
        ? 'quotes/latest.parquet 不存在'
        : `xlsx (${fullXlsx.name}) 比 quotes 更新` });
    }
  }

  return needed;
}

// ── 主程序 ──

function main() {
  const command = process.argv[2] || 'auto';
  const validCommands = ['auto', 'premium', 'claims', 'quotes', 'all'];

  if (!validCommands.includes(command)) {
    log('red', `未知命令: ${command}`);
    console.log(`\n用法: node etl.mjs [${validCommands.join('|')}]\n`);
    console.log('  (无参数) 智能检测哪些域需要更新，只跑需要的');
    console.log('  premium  强制：增量追加保单+保费');
    console.log('  claims   强制：全量替换赔付+费用');
    console.log('  quotes   强制：全量替换报价状态');
    console.log('  all      强制：全部域重跑');
    process.exit(1);
  }

  const python = findPython();
  const start = Date.now();

  if (command === 'auto') {
    // ── 智能模式 ──
    const needed = detectNeeded();

    console.log('');
    log('green', '╔══════════════════════════════════════════╗');
    log('green', '║  分域 ETL — 智能检测                     ║');
    log('green', '╚══════════════════════════════════════════╝');
    log('green', `Python: ${python}`);
    console.log('');

    if (needed.length === 0) {
      log('green', '所有域均为最新，无需更新');
    } else {
      log('cyan', `检测到 ${needed.length} 个域需要更新:`);
      for (const { domain, reason } of needed) {
        log('yellow', `  ${domain}: ${reason}`);
      }
      console.log('');

      for (const { domain } of needed) {
        if (domain === 'premium') runPremium(python);
        if (domain === 'claims')  runClaims(python);
        if (domain === 'quotes')  runQuotes(python);
      }
    }
  } else {
    // ── 强制模式 ──
    console.log('');
    log('green', '╔══════════════════════════════════════════╗');
    log('green', `║  分域 ETL — ${command.toUpperCase().padEnd(30)}║`);
    log('green', '╚══════════════════════════════════════════╝');
    log('green', `Python: ${python}`);

    if (command === 'premium' || command === 'all') runPremium(python);
    if (command === 'claims'  || command === 'all') runClaims(python);
    if (command === 'quotes'  || command === 'all') runQuotes(python);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('');
  log('green', `ETL 完成（${elapsed}s）`);
}

main();
