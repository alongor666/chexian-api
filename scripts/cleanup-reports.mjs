#!/usr/bin/env node

/**
 * Reports 目录清理器
 *
 * 清理规则（与 sync-vps.mjs 的 deleteRemote:false 累积问题配套）：
 *   1) 顶层 HTML 文件：
 *      - 纯时间戳模式 `^\d{8}-\d{6}-[a-f0-9]+\.html$` → 全部删除（开发期 demo）
 *      - 业务命名 `^\d{8}-<业务名>-<hash>.html$` → 按业务名分组，每组保留 mtime 最新一份
 *      - 无日期前缀（如 `邮政四川_经营复盘.html`） → 保留（遗留特殊）
 *   2) 顶层子目录：
 *      - 日期格式名（`^\d{4}-\d{2}-\d{2}$`） → 保留最新一个
 *      - 其他子目录 → 不动
 *
 * 用法：
 *   node scripts/cleanup-reports.mjs                 # dry-run（默认）
 *   node scripts/cleanup-reports.mjs --apply         # 实际删除
 *   node scripts/cleanup-reports.mjs --dir <path>    # 指定 reports 目录（默认 server/data/reports）
 *   node scripts/cleanup-reports.mjs --quiet         # 只输出汇总
 *
 * 设计原则：
 *   - 默认 dry-run，强制 --apply 才真删
 *   - 不调用 git，直接按文件系统状态决策（reports 不入 git）
 *   - 删除前打印每个目标的"删除原因"，便于追溯
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// ============================================
// 命名模式正则
// ============================================
const TEST_HTML_RE = /^\d{8}-\d{6}-[a-f0-9]+\.html$/;
const BIZ_HTML_RE = /^(\d{8})-(.+?)-([a-f0-9]+)\.html$/;
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================
// 参数解析
// ============================================
function parseArgs(argv) {
  const args = { apply: false, quiet: false, dir: path.join(ROOT_DIR, 'server/data/reports') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--dir' && argv[i + 1]) {
      args.dir = path.resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Reports 清理器
用法:
  node scripts/cleanup-reports.mjs [--apply] [--dir <path>] [--quiet]
默认 dry-run，加 --apply 才实际删除。`);
}

// ============================================
// 文件/目录大小计算（递归）
// ============================================
function dirSize(p) {
  let total = 0;
  try {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const child = path.join(p, ent.name);
      if (ent.isDirectory()) total += dirSize(child);
      else if (ent.isFile()) {
        try { total += fs.statSync(child).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return total;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ============================================
// 文件名日期解析（保留判据：文件名日期优先于 mtime）
// ============================================
// 背景（BACKLOG 2026-06-11-claude-84ea3a）：业务命名文件形如
// `<YYYYMMDD>-<业务名>-<hash>.html`，文件名自带日期前缀。若按 mtime 排序保留，
// 一旦旧日期报告被补生成/触碰（mtime 变新但文件名日期仍是旧的），--apply 会删掉
// 文件名日期更新的那份、错误保留文件名日期更旧的那份。且 sync-vps 每次同步自动
// 带 --apply、无人工确认，这类误删会静默发生。
//
// 解析优先级：BIZ_HTML_RE 捕获组 1（YYYYMMDD）能解析为合法日期 → 用该日期排序；
// 解析失败（正则未来放宽、文件名畸形等）→ 回退 mtime，且排在"文件名含日期"的
// 文件之后（避免无日期文件因 mtime 較新而抢占保留位）。
function parseFilenameDate(name) {
  const m = name.match(BIZ_HTML_RE);
  if (!m) return null;
  const raw = m[1]; // YYYYMMDD
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ts)) return null;
  return ts;
}

/**
 * 保留判据排序比较器：文件名日期优先，解析失败回退 mtime 且排在有日期者之后。
 * 用于 planFiles 的业务命名分组（每组保留"最新"一份）。
 */
function compareByFilenameDateThenMtime(a, b) {
  const dateA = parseFilenameDate(a.name);
  const dateB = parseFilenameDate(b.name);
  if (dateA !== null && dateB !== null) return dateB - dateA; // 日期降序
  if (dateA !== null && dateB === null) return -1; // 有日期者排前
  if (dateA === null && dateB !== null) return 1;
  return b.mtime - a.mtime; // 均解析失败 → 回退 mtime
}

// ============================================
// 决策：顶层文件
// ============================================
function planFiles(reportsDir) {
  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  const htmlFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.html'))
    .map(e => {
      const full = path.join(reportsDir, e.name);
      const st = fs.statSync(full);
      return { name: e.name, full, size: st.size, mtime: st.mtimeMs };
    });

  const toDelete = []; // {path, size, reason}
  const toKeep = [];   // {path, size, reason}

  // 1. 测试文件（纯时间戳）→ 全删
  const testFiles = htmlFiles.filter(f => TEST_HTML_RE.test(f.name));
  for (const f of testFiles) {
    toDelete.push({ path: f.full, size: f.size, reason: '纯时间戳测试文件' });
  }

  // 2. 业务命名文件 → 按业务名分组保留最新
  const bizFiles = htmlFiles.filter(f => !TEST_HTML_RE.test(f.name) && BIZ_HTML_RE.test(f.name));
  const groups = new Map(); // bizKey -> [files]
  for (const f of bizFiles) {
    const m = f.name.match(BIZ_HTML_RE);
    const bizKey = m[2]; // 业务名（去日期前缀和 hash 后缀）
    if (!groups.has(bizKey)) groups.set(bizKey, []);
    groups.get(bizKey).push(f);
  }
  for (const [bizKey, files] of groups) {
    files.sort(compareByFilenameDateThenMtime);
    const [latest, ...older] = files;
    toKeep.push({ path: latest.full, size: latest.size, reason: `业务"${bizKey}"最新一份` });
    for (const f of older) {
      toDelete.push({ path: f.full, size: f.size, reason: `业务"${bizKey}"旧版本` });
    }
  }

  // 3. 未匹配任何模式（如 `邮政四川_经营复盘.html`）→ 保留
  for (const f of htmlFiles) {
    if (!TEST_HTML_RE.test(f.name) && !BIZ_HTML_RE.test(f.name)) {
      toKeep.push({ path: f.full, size: f.size, reason: '未识别模式（遗留保留）' });
    }
  }

  return { toDelete, toKeep };
}

// ============================================
// 决策：顶层日期子目录
// ============================================
function planDirs(reportsDir) {
  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  const subDirs = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, full: path.join(reportsDir, e.name) }));

  const toDelete = [];
  const toKeep = [];

  // 顶层每个子目录（如 diagnose-loss-development/）内部按日期保留最新一个
  for (const sub of subDirs) {
    let dateChildren;
    try {
      dateChildren = fs.readdirSync(sub.full, { withFileTypes: true })
        .filter(c => c.isDirectory() && DATE_DIR_RE.test(c.name))
        .map(c => ({
          name: c.name,
          full: path.join(sub.full, c.name),
          size: dirSize(path.join(sub.full, c.name)),
        }));
    } catch {
      continue;
    }
    if (dateChildren.length === 0) continue;
    dateChildren.sort((a, b) => b.name.localeCompare(a.name)); // 日期降序
    const [latest, ...older] = dateChildren;
    toKeep.push({ path: latest.full, size: latest.size, reason: `${sub.name}/ 最新日期` });
    for (const d of older) {
      toDelete.push({ path: d.full, size: d.size, reason: `${sub.name}/ 旧日期快照` });
    }
  }

  return { toDelete, toKeep };
}

// ============================================
// 主流程
// ============================================
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.dir)) {
    console.error(`✗ reports 目录不存在: ${args.dir}`);
    process.exit(1);
  }

  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`\n=== Reports 清理 [${mode}] ===`);
  console.log(`目录: ${args.dir}\n`);

  const filePlan = planFiles(args.dir);
  const dirPlan = planDirs(args.dir);

  const allDelete = [...filePlan.toDelete, ...dirPlan.toDelete];
  const allKeep = [...filePlan.toKeep, ...dirPlan.toKeep];
  const totalFreed = allDelete.reduce((s, d) => s + d.size, 0);
  const totalKept = allKeep.reduce((s, k) => s + k.size, 0);

  if (!args.quiet) {
    console.log(`-- 保留 (${allKeep.length} 项 / ${formatSize(totalKept)}) --`);
    for (const k of allKeep) {
      console.log(`  ✓ [${formatSize(k.size).padStart(8)}] ${path.basename(k.path).padEnd(60)} ${k.reason}`);
    }
    console.log(`\n-- 删除 (${allDelete.length} 项 / ${formatSize(totalFreed)}) --`);
    for (const d of allDelete) {
      console.log(`  ✗ [${formatSize(d.size).padStart(8)}] ${path.basename(d.path).padEnd(60)} ${d.reason}`);
    }
  }

  console.log(`\n=== 汇总 ===`);
  console.log(`保留: ${allKeep.length} 项, ${formatSize(totalKept)}`);
  console.log(`删除: ${allDelete.length} 项, ${formatSize(totalFreed)}  ← 将释放体积`);

  if (!args.apply) {
    console.log(`\n[DRY-RUN] 未实际删除。加 --apply 执行。\n`);
    return;
  }

  console.log(`\n执行删除...`);
  let failed = 0;
  for (const d of allDelete) {
    try {
      fs.rmSync(d.path, { recursive: true, force: true });
    } catch (err) {
      failed++;
      console.error(`  ✗ 删除失败 ${d.path}: ${err.message}`);
    }
  }
  if (failed === 0) {
    console.log(`✓ 已删除 ${allDelete.length} 项，释放 ${formatSize(totalFreed)}\n`);
  } else {
    console.log(`⚠ ${failed} 项删除失败（共 ${allDelete.length} 项）\n`);
    process.exit(1);
  }
}

main();
