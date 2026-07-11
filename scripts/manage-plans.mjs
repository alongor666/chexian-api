#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadLog, fold, renderBacklog, renderArchive } from './backlog/lib.mjs';

/**
 * 解析命令行参数并返回运行选项。
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const getValue = (flag, fallback) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return fallback;
    const value = args[idx + 1];
    if (!value || value.startsWith('--')) return fallback;
    return value;
  };

  const hasFlag = flag => args.includes(flag);

  return {
    plansDir: getValue('--dir', '.claude/plans'),
    archiveDir: getValue('--archive-dir', '.claude/plans/_archive'),
    summaryMdPath: getValue('--summary-md', '.claude/plans/STATUS_SNAPSHOT.md'),
    summaryJsonPath: getValue('--summary-json', '.claude/plans/STATUS_SNAPSHOT.json'),
    apply: hasFlag('--apply'),
    dryRun: hasFlag('--dry-run') || !hasFlag('--apply'),
    noSummary: hasFlag('--no-summary')
  };
}

/**
 * 将路径标准化为 posix 风格，便于在 Markdown 中展示与检索。
 */
function toPosixPath(p) {
  return p.split(path.sep).join('/');
}

/**
 * 判断路径是否存在且为文件。
 */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * 判断路径是否存在且为目录。
 */
function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 读取文本文件内容（UTF-8）。
 */
function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * 写入文本文件内容（UTF-8），并确保父目录存在。
 */
function writeText(filePath, content) {
  const parentDir = path.dirname(filePath);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 列出 plans 目录下的 Markdown 文件（仅一级，跳过 _archive 等保留目录）。
 */
function listPlanMarkdownFiles(plansDir) {
  if (!isDirectory(plansDir)) return [];

  const entries = fs.readdirSync(plansDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if (entry.name === 'STATUS_SNAPSHOT.md') continue;
    if (entry.name === 'README.md') continue;
    files.push(path.join(plansDir, entry.name));
  }

  return files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/**
 * BACKLOG.md / BACKLOG_ARCHIVE.md 自 2026-07-09 起 gitignored（真相 = BACKLOG_LOG.jsonl）。
 * 本工具按 Bxxx 读渲染视图，故读前若视图缺失即从日志惰性渲染，避免拿到静默空索引。
 * 见 .claude/rules/backlog-eventlog.md §10。
 */
function ensureBacklogViews(rootDir) {
  const backlogPath = path.join(rootDir, 'BACKLOG.md');
  const archivePath = path.join(rootDir, 'BACKLOG_ARCHIVE.md');
  const logPath = path.join(rootDir, 'BACKLOG_LOG.jsonl');
  const eventsDir = path.join(rootDir, 'backlog-events');
  if (isFile(backlogPath) && isFile(archivePath)) return;
  if (!isFile(logPath) && !fs.existsSync(eventsDir)) return; // 两源皆无则无从渲染，交由既有 isFile 守卫降级
  const tasks = [...fold(loadLog(logPath, eventsDir)).values()];
  if (!isFile(backlogPath)) fs.writeFileSync(backlogPath, renderBacklog(tasks), 'utf-8');
  if (!isFile(archivePath)) fs.writeFileSync(archivePath, renderArchive(tasks), 'utf-8');
}

/**
 * 从 BACKLOG.md 与 BACKLOG_ARCHIVE.md 构建任务状态索引（Bxxx -> 状态）。
 */
function buildBacklogStatusIndex(rootDir) {
  ensureBacklogViews(rootDir);
  const index = new Map();

  const backlogPath = path.join(rootDir, 'BACKLOG.md');
  if (isFile(backlogPath)) {
    const content = readText(backlogPath);
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      if (!/\|\s*B\d{3}\s*\|/.test(line)) continue;
      const cells = line.split('|').map(c => c.trim());
      const id = cells[1];
      const status = (cells[7] || '').trim();
      if (/^B\d{3}$/.test(id) && status) index.set(id, { status, source: 'BACKLOG.md' });
    }
  }

  const archivePath = path.join(rootDir, 'BACKLOG_ARCHIVE.md');
  if (isFile(archivePath)) {
    const content = readText(archivePath);
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      const m = line.match(/\|\s*A\d{3}\s*\|\s*(B\d{3})\s*\|/);
      if (!m) continue;
      const id = m[1];
      if (!index.has(id)) index.set(id, { status: 'ARCHIVED', source: 'BACKLOG_ARCHIVE.md' });
    }
  }

  const replacedPath = path.join(rootDir, 'BACKLOG_ARCHIVED_REPLACED.md');
  if (isFile(replacedPath)) {
    const content = readText(replacedPath);
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      const m = line.match(/\|\s*(B\d{3})\s*\|/);
      if (!m) continue;
      const id = m[1];
      if (!index.has(id)) index.set(id, { status: 'ARCHIVED', source: 'BACKLOG_ARCHIVED_REPLACED.md' });
    }
  }

  return index;
}

/**
 * 解析 Markdown 中的勾选清单统计（[ ] / [x] / [X]）。
 */
function parseCheckboxStats(content) {
  const matches = content.match(/\[( |x|X)\]/g) || [];
  const checked = matches.filter(m => m.toLowerCase() === '[x]').length;
  const unchecked = matches.filter(m => m === '[ ]').length;
  return { total: matches.length, checked, unchecked };
}

/**
 * 从 Markdown 内容中提取可能的“状态”文本（优先取靠前位置）。
 */
function extractStatusLine(content) {
  const lines = content.split('\n').slice(0, 80);
  for (const line of lines) {
    const m = line.match(/(?:当前状态|状态)\s*[:：]\s*(.+)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * 从 Markdown 内容中提取引用的 BACKLOG 任务 ID（Bxxx）。
 */
function extractBacklogIds(content) {
  const matches = content.match(/\bB\d{3}\b/g) || [];
  return Array.from(new Set(matches)).sort();
}

/**
 * 对单个计划文件做状态判定，返回结构化结果（用于汇总/归档）。
 */
function assessPlanFile({ filePath, relativePath, content, backlogIndex }) {
  const titleLine = content.split('\n').find(l => l.startsWith('# ')) || '';
  const title = titleLine.replace(/^#\s+/, '').trim() || path.basename(filePath);

  const checkbox = parseCheckboxStats(content);
  const statusLine = extractStatusLine(content);
  const backlogIds = extractBacklogIds(content);

  const terminalStatuses = new Set(['DONE', 'ARCHIVED', 'DEPRECATED']);
  const inProgressStatuses = new Set(['IN_PROGRESS', 'BLOCKED', 'TRIAGED', 'PROPOSED']);

  const explicitDone =
    !!statusLine &&
    /(DONE|已完成|全部DONE|100%|完成\s*✅|已完成\s*✅|已完成✅|100%\s*✅)/i.test(statusLine) &&
    !/(未完成|待执行|等待执行|进行中|进行|计划|阶段\s*\d+\/\d+\/\d+\s*已完成\s*✅?\s*等待)/i.test(statusLine);

  const explicitInProgress =
    !!statusLine && /(IN_PROGRESS|进行中|未完成|待执行|等待执行|BLOCKED|阻塞)/i.test(statusLine);

  const doneByCheckbox = checkbox.total > 0 && checkbox.unchecked === 0;

  const backlogStatusDetails = backlogIds.map(id => ({
    id,
    ...((backlogIndex.get(id) || { status: 'UNKNOWN', source: 'N/A' }))
  }));

  const doneByBacklog =
    backlogStatusDetails.length > 0 &&
    backlogStatusDetails.every(x => terminalStatuses.has(String(x.status).toUpperCase()));

  const hasUncheckedBoxes = checkbox.unchecked > 0;

  let status = 'UNKNOWN';
  const reasons = [];

  if (explicitDone) {
    status = 'DONE';
    reasons.push(`状态行判定为已完成：${statusLine}`);
  } else if (doneByCheckbox) {
    status = 'DONE';
    reasons.push(`勾选清单已全部完成：${checkbox.checked}/${checkbox.total}`);
  } else if (doneByBacklog && !hasUncheckedBoxes) {
    status = 'DONE';
    reasons.push(`引用任务均为终态：${backlogIds.join(', ')}`);
  } else if (explicitInProgress) {
    status = 'IN_PROGRESS';
    reasons.push(`状态行判定为进行中：${statusLine}`);
  } else if (hasUncheckedBoxes) {
    status = 'IN_PROGRESS';
    reasons.push(`存在未完成勾选项：${checkbox.unchecked}/${checkbox.total}`);
  } else if (backlogStatusDetails.some(x => inProgressStatuses.has(String(x.status).toUpperCase()))) {
    status = 'IN_PROGRESS';
    reasons.push('引用任务存在非终态状态');
  } else if (backlogStatusDetails.length > 0 && backlogStatusDetails.some(x => x.status === 'UNKNOWN')) {
    status = 'UNKNOWN';
    reasons.push('存在无法在 BACKLOG/ARCHIVE 中定位的引用任务');
  }

  const isArchiveStub = /已归档至\s*[:：]/.test(content) && content.length < 2000;
  if (isArchiveStub) {
    status = 'DONE';
    reasons.unshift('已归档占位文件（无需再次归档）');
  }
  if (reasons.length === 0) {
    reasons.push('未发现状态信号（建议补充“当前状态：...”或勾选清单）');
  }

  return {
    title,
    filePath,
    relativePath,
    status,
    statusLine,
    checkbox,
    backlogIds,
    backlogStatusDetails,
    isArchiveStub,
    reasons
  };
}

/**
 * 生成汇总 Markdown（尽量短，优先机器可读与检索成本）。
 */
function buildSummaryMarkdown({ generatedAt, plansDir, results, appliedActions, dryRun }) {
  const statusOrder = ['IN_PROGRESS', 'UNKNOWN', 'DONE'];
  const byStatus = new Map(statusOrder.map(s => [s, []]));
  for (const r of results) {
    const list = byStatus.get(r.status) || [];
    list.push(r);
    byStatus.set(r.status, list);
  }

  const counts = statusOrder.map(s => `${s}=${(byStatus.get(s) || []).length}`).join('，');
  const actionLine = dryRun ? 'DRY_RUN（未执行归档移动）' : appliedActions.length > 0 ? '已执行归档移动' : '未执行归档移动';

  const rows = [];
  rows.push('| 文件 | 状态 | 依据 | 引用任务 |');
  rows.push('|------|------|------|----------|');
  for (const r of results) {
    const reason = (r.reasons[0] || '').replace(/\|/g, ' ');
    const backlog = r.backlogIds.slice(0, 6).join(', ') + (r.backlogIds.length > 6 ? `…(${r.backlogIds.length})` : '');
    rows.push(`| ${toPosixPath(r.relativePath)} | ${r.status} | ${reason} | ${backlog || '-'} |`);
  }

  const actions = appliedActions.length
    ? appliedActions.map(a => `- ${toPosixPath(a.from)} → ${toPosixPath(a.to)}`).join('\n')
    : '- 无';

  return [
    '# Plans 状态快照',
    '',
    `- 生成时间：${generatedAt}`,
    `- 扫描目录：${toPosixPath(plansDir)}`,
    `- 统计：${counts}`,
    `- 归档动作：${actionLine}`,
    '',
    '## 汇总表',
    '',
    ...rows,
    '',
    '## 本次归档清单',
    '',
    actions,
    ''
  ].join('\n');
}

/**
 * 生成汇总 JSON（用于 AI/脚本快速读取，避免全量搜索 plans）。
 */
function buildSummaryJson({ generatedAt, plansDir, results, appliedActions, dryRun }) {
  return {
    generatedAt,
    plansDir: toPosixPath(plansDir),
    dryRun,
    stats: results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    results: results.map(r => ({
      title: r.title,
      path: toPosixPath(r.relativePath),
      status: r.status,
      statusLine: r.statusLine,
      checkbox: r.checkbox,
      backlogIds: r.backlogIds,
      reasons: r.reasons.slice(0, 2)
    })),
    appliedActions: appliedActions.map(a => ({
      from: toPosixPath(a.from),
      to: toPosixPath(a.to)
    }))
  };
}

/**
 * 将完成的计划文件移动到归档目录，并在原位置写入极短的“归档占位文件”保留引用。
 */
function archivePlanFile({ rootDir, plan, archiveDir, nowDate, dryRun }) {
  const month = nowDate.slice(0, 7);
  const archiveMonthDir = path.join(rootDir, archiveDir, month);
  const fromAbs = plan.filePath;
  const fileName = path.basename(fromAbs);

  let toAbs = path.join(archiveMonthDir, fileName);
  if (isFile(toAbs)) {
    const ext = path.extname(fileName);
    const base = fileName.slice(0, fileName.length - ext.length);
    let i = 2;
    while (isFile(toAbs)) {
      toAbs = path.join(archiveMonthDir, `${base}-${i}${ext}`);
      i += 1;
    }
  }

  const fromRel = path.relative(rootDir, fromAbs);
  const toRel = path.relative(rootDir, toAbs);

  if (dryRun) {
    return { from: fromRel, to: toRel, performed: false };
  }

  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.renameSync(fromAbs, toAbs);

  const backlogPart = plan.backlogIds.length ? plan.backlogIds.join(', ') : '无';
  const reasonPart = plan.reasons[0] || '未提供';

  const stub = [
    `# 已归档：${plan.title}`,
    '',
    `- 已归档至：${toPosixPath(toRel)}`,
    `- 归档时间：${nowDate}`,
    `- 判定依据：${reasonPart}`,
    `- 引用任务：${backlogPart}`,
    ''
  ].join('\n');

  writeText(fromAbs, stub);

  return { from: fromRel, to: toRel, performed: true };
}

function main() {
  const options = parseArgs(process.argv);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.join(__dirname, '..');

  const plansDirAbs = path.join(rootDir, options.plansDir);
  const nowDate = new Date().toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();

  const backlogIndex = buildBacklogStatusIndex(rootDir);
  const planFiles = listPlanMarkdownFiles(plansDirAbs);

  const results = planFiles.map(filePath => {
    const content = readText(filePath);
    const relativePath = path.relative(rootDir, filePath);
    return assessPlanFile({ filePath, relativePath, content, backlogIndex });
  });

  const toArchive = results.filter(r => r.status === 'DONE' && !r.isArchiveStub);
  const appliedActions = [];

  for (const plan of toArchive) {
    const action = archivePlanFile({
      rootDir,
      plan,
      archiveDir: options.archiveDir,
      nowDate,
      dryRun: options.dryRun
    });
    appliedActions.push(action);
  }

  if (!options.noSummary) {
    const md = buildSummaryMarkdown({
      generatedAt,
      plansDir: options.plansDir,
      results,
      appliedActions,
      dryRun: options.dryRun
    });
    const json = buildSummaryJson({
      generatedAt,
      plansDir: options.plansDir,
      results,
      appliedActions,
      dryRun: options.dryRun
    });

    writeText(path.join(rootDir, options.summaryMdPath), md);
    writeText(path.join(rootDir, options.summaryJsonPath), JSON.stringify(json, null, 2) + '\n');
  }

  const doneCount = results.filter(r => r.status === 'DONE').length;
  const inProgressCount = results.filter(r => r.status === 'IN_PROGRESS').length;
  const unknownCount = results.filter(r => r.status === 'UNKNOWN').length;

  console.log('🧭 Plans 管理脚本');
  console.log('━'.repeat(60));
  console.log(`📁 扫描目录: ${toPosixPath(options.plansDir)}`);
  console.log(`📄 计划文件: ${results.length}`);
  console.log(`✅ DONE: ${doneCount}   🟡 IN_PROGRESS: ${inProgressCount}   ❔ UNKNOWN: ${unknownCount}`);
  console.log(`🧾 汇总文件: ${options.noSummary ? '已禁用' : `${toPosixPath(options.summaryMdPath)} / ${toPosixPath(options.summaryJsonPath)}`}`);
  console.log(`📦 待归档: ${toArchive.length}`);
  console.log(`🧪 模式: ${options.dryRun ? 'DRY_RUN（默认）' : 'APPLY'}`);

  if (toArchive.length > 0) {
    console.log('\n📋 待归档文件（按判定规则）：');
    for (const p of toArchive) {
      console.log(`- ${toPosixPath(p.relativePath)} (${p.reasons[0] || 'N/A'})`);
    }
  }

  if (options.dryRun) {
    console.log('\n提示：默认不移动文件；如确认执行归档，请使用：');
    console.log(`  node scripts/manage-plans.mjs --apply`);
  }
}

main();
