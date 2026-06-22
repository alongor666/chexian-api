#!/usr/bin/env node

/**
 * 治理一致性校验脚本
 *
 * 校验规则：
 * 1. 必需文件存在性：根目录、索引目录
 * 2. 核心层索引完整性：src/shared、src/features、src/widgets、scripts
 * 3. BACKLOG.md 证据链：DONE任务必须有关联文档、关联代码、验收/证据
 * 4. GEMINI.md 引用正确性（已移除 — GEMINI.md 不再维护）
 * 5. CLAUDE.md 关键章节：必须包含验证协议、工作流集成、数据准备章节
 * 6. DC-002 合规性（B106+B107）：
 *    - 禁止硬编码CURRENT_DATE（排除带DC-002 Exception注释的行）
 *    - 禁止使用||运算符判断filters字段（B107增强：日期字段报错，其他字段警告）
 *    - 禁止函数签名包含可选日期参数
 * 7. BACKLOG 事件日志校验（event-log 模型，2026-06 治本后取代「任务ID分配」）：
 *    - 真相 = BACKLOG_LOG.jsonl（append-only）；BACKLOG.md/ARCHIVE 是其派生视图
 *    - 校验事件结构 / 无孤儿事件 / create uid 唯一 / 曾用号唯一（禁复用）
 *    - 陈旧守卫：视图必须 == 折叠(日志) 的渲染（手改/漏渲染即报错，提示重新渲染）
 * 8. Merge conflict 标记扫描：
 *    - 扫描 BACKLOG.md / BACKLOG_LOG.jsonl / PROGRESS.md 中是否残留 <<<<<<< / ======= / >>>>>>> 冲突标记
 *    - 残留冲突标记 → 阻断提交
 * 9. 暂存区调试产物阻断：
 *    - 阻止日志/Playwright 报告等调试产物进入提交
 * 10. 热点文件契约联动：
 *    - `server/src/routes/query.ts` 改动时，必须同步更新 `tests/api/*route-contract.test.ts`
 *    - `src/shared/api/client.ts` 改动时，必须同步更新 `tests/api/client-contracts.test.ts`
 * 11. TypeScript 检查范围护栏（API-only 清理批次）：
 *    - tsconfig.json 不得再排除活跃源码目录（src/charts/src/components/src/services/src/types/src/core）
 *    - 防止通过扩大 exclude 隐藏真实类型问题
 * 24. ETL 多 sheet 加载规范：
 *    - pipelines/convert_*.py 和 quote_etl.py 禁止裸 pd.read_excel()
 *    - 必须使用 load_excel_all_sheets() 自动合并续表，防止 Excel 拆分后静默丢数据
 * 25. 空 catch 块禁令（静默失败 Law 1）：
 *    - server/src + src 禁止纯空 catch 块（catch {} / catch (e) {}）
 *    - 空 catch 吞异常且无痕迹，是最典型的静默失败；配套 .claude/skills/silent-failure-guard.md
 *
 * 退出码：
 * - 0: 所有检查通过
 * - 1: 存在校验失败
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync, execSync } from 'child_process';
import {
  collectPolicyCurrentStats,
  extractQuickReferenceStats,
  syncQuickReferenceFile,
} from '../数据管理/pipelines/quick_reference.mjs';
import { detectPolicyCurrentOverlap } from './lib/parquet-overlap-check.mjs';
import {
  parseLog, fold, validateLog, renderBacklog, renderArchive, splitRow,
} from './backlog/lib.mjs';
import { SHADOW_KEYS } from './shared/cube-routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function log(color, symbol, message) {
  console.log(`${color}${colors.bold}[${symbol}]${colors.reset} ${message}`);
}

function success(message) {
  log(colors.green, '✓', message);
}

function error(message) {
  log(colors.red, '✗', message);
}

function warning(message) {
  log(colors.yellow, '⚠', message);
}

function info(message) {
  log(colors.blue, 'ℹ', message);
}

// ============================================================
// 1. 必需文件存在性检查
// ============================================================

function checkRequiredFiles() {
  info('检查必需文件存在性...');

  const requiredFiles = [
    // 根目录治理文件
    'CLAUDE.md',
    'BACKLOG.md',
    'BACKLOG_ARCHIVE.md',
    'PROGRESS.md',
    // 三大索引
    '开发文档/00_index/DOC_INDEX.md',
    '开发文档/00_index/CODE_INDEX.md',
    '开发文档/00_index/PROGRESS_INDEX.md',
  ];

  let allExist = true;
  const missing = [];

  for (const file of requiredFiles) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      allExist = false;
      missing.push(file);
    }
  }

  if (allExist) {
    success('必需文件检查通过');
    return true;
  } else {
    error(`必需文件检查失败，缺少以下文件：`);
    missing.forEach(file => console.log(`    - ${file}`));
    return false;
  }
}

// ============================================================
// 2. 核心层索引完整性检查
// ============================================================

function checkCoreLayerIndices() {
  info('检查核心层索引完整性...');

  const coreLayerDirs = [
    'src/shared',
    'src/features',
    'src/widgets',
    'scripts',
  ];

  let allExist = true;
  const missing = [];

  for (const dir of coreLayerDirs) {
    const indexPath = path.join(ROOT_DIR, dir, 'INDEX.md');
    if (!fs.existsSync(indexPath)) {
      allExist = false;
      missing.push(`${dir}/INDEX.md`);
    }
  }

  if (allExist) {
    success('核心层索引检查通过');
    return true;
  } else {
    error(`核心层索引检查失败，缺少以下 INDEX.md：`);
    missing.forEach(file => console.log(`    - ${file}`));
    return false;
  }
}

// ============================================================
// 3. BACKLOG.md 证据链检查
// ============================================================

function parseBacklogTable(content) {
  const lines = content.split('\n');
  const tasks = [];

  // 找到任务列表表格（以 "| ID |" 开头的行）
  let inTable = false;
  let headerPassed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过空行
    if (!line) continue;

    // 检测表格开始（标题行）
    if (line.startsWith('| ID |')) {
      inTable = true;
      continue;
    }

    // 跳过分隔符行
    if (inTable && !headerPassed && line.startsWith('|---')) {
      headerPassed = true;
      continue;
    }

    // 解析数据行
    if (inTable && headerPassed && line.startsWith('|')) {
      // 用转义感知的 splitRow（SSOT），正确处理 desc/evidence 内的 \| ，避免按列错位
      const cells = splitRow(line);

      // 表格格式：ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据
      if (cells.length >= 10) {
        const task = {
          id: cells[0],
          submitTime: cells[1],
          category: cells[2],
          owner: cells[3],
          description: cells[4],
          priority: cells[5],
          status: cells[6],
          relatedDocs: cells[7],
          relatedCode: cells[8],
          evidence: cells[9],
          lineNumber: i + 1,
        };
        tasks.push(task);
      }
    }

    // 检测表格结束（遇到非表格行）
    if (inTable && headerPassed && !line.startsWith('|')) {
      break;
    }
  }

  return tasks;
}

function checkBacklogEvidence() {
  info('检查 BACKLOG.md 证据链...');

  const backlogPath = path.join(ROOT_DIR, 'BACKLOG.md');

  if (!fs.existsSync(backlogPath)) {
    error('BACKLOG.md 不存在，跳过证据链检查');
    return false;
  }

  // DONE 任务已归档到 BACKLOG_ARCHIVE.md，证据链需合并两文件一起校验
  const archivePath = path.join(ROOT_DIR, 'BACKLOG_ARCHIVE.md');
  let tasks = parseBacklogTable(fs.readFileSync(backlogPath, 'utf-8'));
  if (fs.existsSync(archivePath)) {
    tasks = tasks.concat(parseBacklogTable(fs.readFileSync(archivePath, 'utf-8')));
  }

  if (tasks.length === 0) {
    warning('BACKLOG.md 中未找到任务表格');
    return true; // 没有任务不算失败
  }

  const doneTasks = tasks.filter(task => task.status === 'DONE');

  if (doneTasks.length === 0) {
    info(`BACKLOG.md 中有 ${tasks.length} 个任务，其中 0 个已完成，无需检查证据链`);
    return true;
  }

  let hasErrors = false;
  const errors = [];

  for (const task of doneTasks) {
    const issues = [];

    // 检查关联文档
    if (!task.relatedDocs || task.relatedDocs === '' || task.relatedDocs === '-') {
      issues.push('关联文档为空（应填写文档路径或 N/A）');
    }

    // 检查关联代码
    if (!task.relatedCode || task.relatedCode === '' || task.relatedCode === '-') {
      issues.push('关联代码为空（应填写代码路径或 N/A）');
    }

    // 检查验收/证据（必须非空）
    if (!task.evidence || task.evidence === '' || task.evidence === '-' || task.evidence === 'N/A') {
      issues.push('验收/证据为空（必须填写 PR链接/Commit/测试报告等）');
    }

    if (issues.length > 0) {
      hasErrors = true;
      errors.push({
        id: task.id,
        lineNumber: task.lineNumber,
        issues,
      });
    }
  }

  if (hasErrors) {
    error(`BACKLOG.md 证据链检查失败，共 ${doneTasks.length} 个 DONE 任务，${errors.length} 个有问题：`);
    errors.forEach(({ id, lineNumber, issues }) => {
      console.log(`    - ${id} (行 ${lineNumber}):`);
      issues.forEach(issue => console.log(`        • ${issue}`));
    });
    return false;
  } else {
    success(`BACKLOG.md 证据链检查通过（${doneTasks.length} 个 DONE 任务）`);
    return true;
  }
}

// (已移除) GEMINI.md 引用检查 — GEMINI.md 不再维护

// ============================================================
// 5. CLAUDE.md 关键章节检查（新增）
// ============================================================

function checkClaudeMdSections() {
  info('检查 CLAUDE.md 关键章节...');

  const claudePath = path.join(ROOT_DIR, 'CLAUDE.md');

  if (!fs.existsSync(claudePath)) {
    error('CLAUDE.md 不存在');
    return false;
  }

  const content = fs.readFileSync(claudePath, 'utf-8');
  const errors = [];

  // 检查关键章节（使用正则匹配标题）
  const requiredSections = [
    { pattern: /##\s+.*验证/, name: '验证协议章节' },
    { pattern: /##\s+.*护栏|RED LINE/, name: '护栏章节' },
    { pattern: /##\s+.*API/, name: 'API 架构章节' },
  ];

  for (const section of requiredSections) {
    if (!section.pattern.test(content)) {
      errors.push(`CLAUDE.md 缺少关键章节：${section.name}`);
    }
  }

  if (errors.length > 0) {
    error(`CLAUDE.md 章节检查失败：`);
    errors.forEach(err => console.log(`    - ${err}`));
    return false;
  } else {
    success('CLAUDE.md 章节检查通过');
    return true;
  }
}

// ============================================================
// 6. DC-002 合规性检查（新增）
// ============================================================

function checkDC002Compliance() {
  info('检查 DC-002 合规性（用户筛选优先规则）...');

  const sqlDir = path.join(ROOT_DIR, 'src/shared/sql');
  const errors = [];
  const warnings = [];

  // 检查1: 扫描所有 SQL 生成器文件
  if (!fs.existsSync(sqlDir)) {
    warning('src/shared/sql 目录不存在，跳过 DC-002 检查');
    return true;
  }

  const sqlFiles = fs.readdirSync(sqlDir).filter(file => file.endsWith('.ts'));

  for (const file of sqlFiles) {
    const filePath = path.join(sqlDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // 违规模式1: 硬编码 CURRENT_DATE
    if (/CURRENT_DATE|current_date|CURDATE\(\)|NOW\(\)/i.test(content)) {
      // 排除注释和字符串中的合法使用
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 检查前2行是否有 DC-002 Exception 注释
        const hasExceptionAbove = (i >= 1 && lines[i - 1].includes('DC-002 Exception')) ||
                                   (i >= 2 && lines[i - 2].includes('DC-002 Exception'));

        if (/CURRENT_DATE|current_date|CURDATE\(\)|NOW\(\)/i.test(line) &&
            !line.trim().startsWith('//') &&
            !line.trim().startsWith('*') &&
            !line.includes('DC-002') &&
            !line.includes('禁止') &&
            !hasExceptionAbove) {
          errors.push(`${file}:${i + 1} 检测到硬编码 CURRENT_DATE（违反 DC-002 §2.3）`);
          break;
        }
      }
    }

    // 违规模式2: 使用 || 运算符判断 filters 字段（应使用 ??）
    // B107增强：更严格的检测，模拟ESLint规则
    if (/\|\|/.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 更严格的条件：检测在赋值或函数参数中使用 || 判断 filters 相关字段
        const isLogicalOrForFilters = /\|\|/.test(line) &&
            (line.includes('filters.') || line.includes('policy_date')) &&
            !line.trim().startsWith('//') &&
            !line.trim().startsWith('*') &&
            !line.includes('DC-002') &&
            !line.includes('Exception'); // 排除已知例外

        if (isLogicalOrForFilters) {
          // 区分警告和错误
          if (line.includes('startDate') || line.includes('endDate')) {
            errors.push(`${file}:${i + 1} 使用 || 判断 filters 日期字段（违反 DC-002 §2.1，必须使用 ??）`);
          } else {
            warnings.push(`${file}:${i + 1} 使用 || 判断 filters 字段（建议使用 ?? 运算符，DC-002 §2.1）`);
          }
        }
      }
    }

    // 违规模式3: 可选日期参数（函数签名中包含 startDate?: 或 endDate?:）
    const optionalDateParamRegex = /(startDate|endDate|start_date|end_date)\s*:\s*string\s*\?/;
    if (optionalDateParamRegex.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (optionalDateParamRegex.test(line) &&
            !line.includes('DC-002')) {
          errors.push(`${file}:${i + 1} 函数签名包含可选日期参数（违反 DC-002 §2.4，应从 filters 读取）`);
          break;
        }
      }
    }
  }

  // 输出结果
  if (errors.length > 0) {
    error(`DC-002 合规性检查失败（${errors.length} 个错误）：`);
    errors.forEach(err => console.log(`    - ${err}`));
    if (warnings.length > 0) {
      console.log('');
      warning(`额外发现 ${warnings.length} 个警告：`);
      warnings.forEach(warn => console.log(`    - ${warn}`));
    }
    return false;
  } else {
    if (warnings.length > 0) {
      warning(`DC-002 检查通过，但发现 ${warnings.length} 个警告：`);
      warnings.forEach(warn => console.log(`    - ${warn}`));
    } else {
      success(`DC-002 合规性检查通过（扫描 ${sqlFiles.length} 个 SQL 文件）`);
    }
    return true;
  }
}

// ============================================================
// 第7项检查：任务ID分配合规性（多Agent冲突防护）
// ============================================================

/**
 * BACKLOG 事件日志校验（event-log 模型，2026-06 治本后取代「任务ID分配」）：
 *  1. 日志结构完整：每条事件 kind/uid/ts 合规；create uid 唯一；曾用号唯一（禁复用）
 *  2. 无孤儿事件：status/note/amend 必须引用已存在的 create
 *  3. 陈旧守卫：BACKLOG.md / BACKLOG_ARCHIVE.md 必须 == 折叠(日志) 的渲染结果
 *     —— 视图是日志的纯函数，任何手改/漏渲染都会被此守卫抓出，提示重新渲染
 */
function checkBacklogLog() {
  const logPath = path.join(ROOT_DIR, 'BACKLOG_LOG.jsonl');
  if (!fs.existsSync(logPath)) {
    error('BACKLOG_LOG.jsonl 不存在（首次请 bun scripts/backlog/migrate.mjs --apply）');
    return false;
  }

  let events;
  try {
    events = parseLog(fs.readFileSync(logPath, 'utf-8'));
  } catch (e) {
    error(`BACKLOG_LOG.jsonl 解析失败：${e.message}`);
    return false;
  }

  // 1+2. 结构完整 + 无孤儿
  const { errors, warnings, stats } = validateLog(events);
  if (errors.length > 0) {
    error(`BACKLOG 事件日志校验失败（${errors.length} 处）：`);
    errors.slice(0, 20).forEach(e => console.log(`    - ${e}`));
    return false;
  }

  // 3. 陈旧守卫：视图必须等于折叠(日志) 的渲染
  const tasks = [...fold(events).values()];
  const expectBacklog = renderBacklog(tasks);
  const expectArchive = renderArchive(tasks);
  const drift = [];
  const cmp = (rel, expect) => {
    const p = path.join(ROOT_DIR, rel);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    if (cur !== expect) drift.push(rel);
  };
  cmp('BACKLOG.md', expectBacklog);
  cmp('BACKLOG_ARCHIVE.md', expectArchive);

  if (drift.length > 0) {
    error(`BACKLOG 派生视图已陈旧/被手改：${drift.join(', ')}`);
    console.log('    视图必须 == 折叠(日志)。请重新渲染：bun scripts/governance-backlog-curate.mjs --apply');
    console.log('    （切勿手工编辑 BACKLOG.md / BACKLOG_ARCHIVE.md；它们是 BACKLOG_LOG.jsonl 的派生物）');
    return false;
  }

  const warnNote = warnings.length ? `，${warnings.length} 处提示` : '';
  success(`BACKLOG 事件日志校验通过（${stats.events} 事件 / ${stats.tasks} 任务，视图与日志一致${warnNote}）`);
  return true;
}

// ============================================================
// 第8项检查：Merge conflict 标记扫描
// ============================================================

/**
 * 扫描治理文件中是否残留未解决的 merge conflict 标记
 * 来源：PR #47 中 BACKLOG.md/PROGRESS.md 残留 <<<<<<< HEAD 标记（P0 级问题）
 */
function checkMergeConflictMarkers() {
  info('检查 merge conflict 标记...');

  const filesToCheck = [
    'BACKLOG.md',
    'BACKLOG_ARCHIVE.md',
    'BACKLOG_LOG.jsonl',
    'PROGRESS.md',
    'CLAUDE.md',
    // merge=union 的 append-only 文件：union 通常自动消解冲突，但非纯追加/半行残留仍可能留标记（codex 闸-2 P2-4）
    '.claude/workflow/pr-evolution.md',
    '.claude/workflow/loop-quality-ledger.jsonl',
  ];

  const conflictPattern = /^(<{7}\s|={7}$|>{7}\s)/;
  const errors = [];

  for (const file of filesToCheck) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (conflictPattern.test(lines[i])) {
        errors.push(`${file}:${i + 1} 残留 merge conflict 标记: ${lines[i].substring(0, 40)}`);
      }
    }
  }

  if (errors.length > 0) {
    error(`Merge conflict 标记检查失败（${errors.length} 处残留）：`);
    errors.forEach(err => console.log(`    - ${err}`));
    return false;
  } else {
    success(`Merge conflict 标记检查通过（扫描 ${filesToCheck.length} 个治理文件）`);
    return true;
  }
}

// ============================================================
// 第9项检查：暂存区调试产物阻断
// ============================================================

function checkStagedDebugArtifacts() {
  info('检查暂存区调试产物...');

  let stagedFiles = [];
  try {
    // Use --diff-filter=d to exclude deletions (deleting debug artifacts is fine)
    const output = execSync('git diff --cached --name-only --diff-filter=d -z', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    stagedFiles = output.split('\0').filter(Boolean);
  } catch {
    warning('无法读取 git 暂存区，跳过调试产物检查');
    return true;
  }

  if (stagedFiles.length === 0) {
    success('暂存区为空，无调试产物风险');
    return true;
  }

  const blockedPattern = /(^|\/)(\.playwright-cli\/|playwright-report\/|test-results\/|.*\.log$|test_output\.txt$|vitest_log\.txt$|dev_log\.txt$|test_err\.txt$)/;
  const blockedFiles = stagedFiles.filter((file) => blockedPattern.test(file));

  if (blockedFiles.length > 0) {
    error(`检测到 ${blockedFiles.length} 个调试产物已加入暂存区（阻断提交）：`);
    blockedFiles.forEach((file) => console.log(`    - ${file}`));
    console.log('    - 请执行: bun run cleanup:artifacts');
    console.log('    - 对已跟踪文件请移出暂存: git restore --staged <file>');
    return false;
  }

  success('暂存区调试产物检查通过');
  return true;
}

// ============================================================
// 第10项检查：热点文件契约联动
// ============================================================

function checkApiWireConservation() {
  info('检查 ApiClient 拆分守恒恒等式...');

  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/api-wire-conservation.mjs'), '--quiet-pass'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    success('ApiClient 守恒恒等式成立（保留 + Σ命名空间 == pre-#536，golden 覆盖齐全）');
    return true;
  } catch (cause) {
    error('ApiClient 守恒恒等式校验失败');
    const stdout = cause?.stdout?.toString().trim();
    const stderr = cause?.stderr?.toString().trim();
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    return false;
  }
}

function checkHotfileContractCoverage() {
  info('检查热点文件契约测试联动...');

  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/check-hotfile-contracts.mjs'), '--quiet-pass'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    success('热点文件契约联动检查通过');
    return true;
  } catch (cause) {
    error('热点文件契约联动检查失败');
    const stdout = cause?.stdout?.toString().trim();
    const stderr = cause?.stderr?.toString().trim();
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    return false;
  }
}

// ============================================================
// 第11项检查：TypeScript 检查范围护栏
// ============================================================

function checkTsconfigTypecheckScope() {
  info('检查 tsconfig 类型检查范围护栏...');

  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    error('tsconfig.json 不存在');
    return false;
  }

  const content = fs.readFileSync(tsconfigPath, 'utf-8');

  const forbiddenExcludes = [
    'src/charts',
    'src/components',
    'src/services',
    'src/types',
    'src/core',
  ];

  const hit = forbiddenExcludes.filter((dir) => new RegExp(`["']${dir}["']`).test(content));
  if (hit.length > 0) {
    error(`tsconfig 仍排除了活跃源码目录：${hit.join(', ')}`);
    console.log('    - 请修复真实类型问题，不要通过 exclude 规避');
    return false;
  }

  if (!/"include"\s*:\s*\[\s*"src"\s*]/.test(content)) {
    error('tsconfig include 未覆盖 src 目录（期望 include: [\"src\"]）');
    return false;
  }

  success('tsconfig 类型检查范围护栏检查通过');
  return true;
}

// ============================================================
// 第12项检查：包管理器锁文件策略
//   - root: Bun-only（保持现状，CI/dev 用 Bun）
//   - server/: bun.lock + package-lock.json 共存例外
//     CI build 用 bun install --frozen-lockfile，
//     VPS wrapper 用 npm ci --omit=dev（见 deploy/vps-wrapper/deploy-chexian-api.sh）
// ============================================================

function checkPackageManagerLockPolicy() {
  info('检查包管理器锁文件策略（root: Bun-only / server: 双锁定）...');

  // ── root: 仍 Bun-only ──
  const rootLockfiles = ['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  const rootExisting = rootLockfiles.filter((name) => fs.existsSync(path.join(ROOT_DIR, name)));

  if (!rootExisting.includes('bun.lock')) {
    error('root: 缺少 bun.lock（项目默认执行器为 Bun）');
    return false;
  }

  const rootDisallowed = rootExisting.filter((name) => name !== 'bun.lock');
  if (rootDisallowed.length > 0) {
    error(`root: 检测到非 Bun 锁文件：${rootDisallowed.join(', ')}`);
    console.log('    - root 仍是 Bun-only，禁止 npm/yarn/pnpm 锁文件');
    return false;
  }

  // ── server: 显式双锁定例外 ──
  const serverDir = path.join(ROOT_DIR, 'server');
  if (!fs.existsSync(serverDir)) {
    success('包管理器锁文件策略检查通过（无 server 目录）');
    return true;
  }

  const serverBunLock = path.join(serverDir, 'bun.lock');
  const serverNpmLock = path.join(serverDir, 'package-lock.json');
  if (!fs.existsSync(serverBunLock)) {
    error('server: 缺少 server/bun.lock（CI build 用 bun install --frozen-lockfile）');
    return false;
  }
  if (!fs.existsSync(serverNpmLock)) {
    error('server: 缺少 server/package-lock.json（VPS wrapper 用 npm ci --omit=dev）');
    console.log('    - 见 deploy/vps-wrapper/deploy-chexian-api.sh install 子命令');
    return false;
  }

  // ── 内容一致性：server/package.json 的生产依赖必须在两个 lockfile 都被锁定 ──
  // 防止 deploy bundle 携带的 lockfile 与 CI build 时使用的依赖版本漂移
  try {
    const serverPkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf-8'));
    const prodDeps = Object.keys(serverPkg.dependencies || {});
    if (prodDeps.length > 0) {
      const bunLockContent = fs.readFileSync(serverBunLock, 'utf-8');
      const npmLock = JSON.parse(fs.readFileSync(serverNpmLock, 'utf-8'));
      const npmLockedPackages = new Set(
        Object.keys(npmLock.packages || {})
          .filter((p) => p.startsWith('node_modules/'))
          .map((p) => p.replace(/^node_modules\//, ''))
      );

      const missing = [];
      for (const dep of prodDeps) {
        // bun.lock 文本格式，按 `"<dep>":` 或 `"<dep>@` 模式匹配
        const inBun = bunLockContent.includes(`"${dep}":`) || bunLockContent.includes(`"${dep}@`);
        const inNpm = npmLockedPackages.has(dep);
        if (!inBun || !inNpm) {
          missing.push(`${dep} (bun=${inBun ? 'Y' : 'N'} npm=${inNpm ? 'Y' : 'N'})`);
        }
      }
      if (missing.length > 0) {
        error(`server: 生产依赖未在两个 lockfile 同时锁定：${missing.join(', ')}`);
        console.log('    - 执行 `cd server && bun install && npm install` 让两边重新解析');
        return false;
      }
    }
  } catch (err) {
    error(`server: 锁文件内容校验失败：${err.message}`);
    return false;
  }

  // ── deploy bundle 必须打包 server/package-lock.json ──
  // 防止改 deploy.yml 时漏掉 lockfile，导致 wrapper 的 npm ci 在 VPS 失败
  const deployYmlPath = path.join(ROOT_DIR, '.github/workflows/deploy.yml');
  if (fs.existsSync(deployYmlPath)) {
    const deployYml = fs.readFileSync(deployYmlPath, 'utf-8');
    if (!deployYml.includes('tar -czf deploy-bundle.tar.gz')) {
      // deploy.yml 改用其他打包方式 → 跳过检查（保持向前兼容）
    } else if (!deployYml.includes('server/package-lock.json')) {
      error('deploy.yml 的 deploy bundle 未包含 server/package-lock.json');
      console.log('    - VPS wrapper 用 npm ci，必须 bundle 携带 lockfile');
      return false;
    }
  }

  success('包管理器锁文件策略检查通过（root: bun-only / server: 双锁定 + bundle 一致）');
  return true;
}

// ============================================================
// 第13项检查：本地 current/ Parquet 文件重叠检测
// ============================================================

/**
 * 检查本地 current/ 目录中是否存在时间范围重叠的 Parquet 文件。
 *
 * 根因：多个重叠文件经 UNION ALL 后数据翻倍（历史事故：1,837,252行 vs 正确的 1,161,809行；
 * 2026-05-15 复发：裸名主分片+限摩 → 多出 310,822 行/10.8% 虚高）。
 * 共享逻辑在 scripts/lib/parquet-overlap-check.mjs（daily.mjs / sync-vps.mjs 同源调用）。
 */
function checkParquetOverlapInCurrent() {
  info('检查 current/ Parquet 文件时间范围重叠...');

  const currentDir = path.join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
  const result = detectPolicyCurrentOverlap(currentDir);

  if (result.skipped) {
    success('current/ 目录不存在，跳过重叠检测');
    return true;
  }

  if (result.count === 0) {
    success(`current/ Parquet 重叠检测通过（${result.files} 个文件，区间互补无重叠）`);
    return true;
  }

  error('current/ Parquet 文件存在时间范围重叠（将导致数据翻倍）：');
  for (const o of result.overlaps) {
    console.log(`    - "${o.a}" [${o.aRange[0]}~${o.aRange[1]}] ↔ "${o.b}" [${o.bRange[0]}~${o.bRange[1]}]`);
  }
  console.log('    ▶ 修复：删除冗余文件（裸名主分片+限摩=反模式），或确保剔摩↔限摩成对存在');
  console.log('    ▶ 同步时使用 node scripts/sync-vps.mjs（默认清理旧文件）');
  return false;
}

// ============================================================
// 第13.5项检查：claims_detail/ Parquet claim_no 去重检测
// ============================================================

/**
 * 检查 claims_detail/ 各分区文件 claim_no 是否存在重复（含跨文件）。
 *
 * 根因：2026-05-05 事故 — daily.mjs 把新全量 + 旧增量 11 个文件一并喂给 ETL，
 * convert_claims_detail.py 裸 concat 无去重，76,844 个 claim_no 各 2 行写入分区，
 * 服务端 SUM(settled+pending) 不去重，赔付率虚高 92% (真实 48%)。
 */
function checkClaimsDetailDeduplication() {
  info('检查 claims_detail/ Parquet claim_no 去重...');

  const dir = path.join(ROOT_DIR, '数据管理/warehouse/fact/claims_detail');
  if (!fs.existsSync(dir)) {
    success('claims_detail/ 目录不存在，跳过');
    return true;
  }
  const files = fs.readdirSync(dir).filter(f => f.startsWith('claims_') && f.endsWith('.parquet'));
  if (files.length === 0) {
    success('claims_detail/ 无分区文件，跳过');
    return true;
  }
  try {
    const out = execSync(
      `python3 -c "import duckdb; r = duckdb.sql(\\"SELECT COUNT(*) AS rows, COUNT(DISTINCT claim_no) AS dis FROM read_parquet('${dir}/claims_*.parquet', union_by_name=true)\\").fetchone(); print(r[0], r[1])"`,
      { encoding: 'utf-8' }
    ).trim();
    const [rows, dis] = out.split(/\s+/).map(Number);
    const dup = rows - dis;
    if (dup > 0) {
      error(`claims_detail/ claim_no 重复 ${dup.toLocaleString()} 行（rows=${rows.toLocaleString()} / distinct=${dis.toLocaleString()}）`);
      console.log(`    ▶ 修复：归档冲突的旧增量 xlsx + 重跑 node 数据管理/daily.mjs claims_detail`);
      console.log(`    ▶ 影响：服务端 SUM(settled+pending) 会双重计入，赔付率虚高约 ${Math.round(dup * 100 / dis)}%`);
      return false;
    }
    success(`claims_detail/ 去重检测通过（${rows.toLocaleString()} 行 = ${dis.toLocaleString()} distinct claim_no）`);
    return true;
  } catch (e) {
    warning(`claims_detail/ 去重检测跳过：${e.message.split('\n')[0]}`);
    return true;
  }
}

// ============================================================
// 第14项检查：暂存区凭据/敏感产物扫描
// ============================================================

/**
 * 判定文件内容是否包含「真实 token 值赋值」。
 *
 * 只命中 key 名紧邻一个长 value 的真实泄漏，不对「裸 key 名」的散文/evidence
 * 提及误报（例如 BACKLOG evidence 文本里出现 cx_access_token 这个 localStorage
 * key 名，但并无紧邻的密钥值）。命中以下任一模式即判为泄漏：
 *   1. 赋值形：key 后跟 : 或 = 再跟 ≥20 字符的 token 值
 *   2. Playwright storageState 形：{"name":"cx_access_token","value":"<长值>"}
 *
 * @param {string} content 文件全文
 * @returns {boolean}
 */
export function containsCredentialValue(content) {
  const keyAlt = 'cx_' + '(?:access|refresh)_token';
  const valuePatterns = [
    new RegExp(keyAlt + `["']?\\s*[:=]\\s*["']?[A-Za-z0-9._\\-]{20,}`),
    new RegExp(`"name"\\s*:\\s*"` + keyAlt + `"\\s*,\\s*"value"\\s*:\\s*"[^"]{20,}"`),
  ];
  return valuePatterns.some(re => re.test(content));
}

/**
 * 阻止含 token 的 Playwright auth 状态文件或含敏感 token 值赋值的文件进入提交。
 * 根因：此前某次提交误将 output/playwright/.auth/user.json（包含 token 字段）直接提交到仓库。
 */
function checkStagedCredentials() {
  info('检查暂存区凭据/敏感产物...');

  let stagedFiles = [];
  try {
    // Use --diff-filter=d to exclude deletions (deleting credential files is fine)
    const output = execSync('git diff --cached --name-only --diff-filter=d -z', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    stagedFiles = output.split('\0').filter(Boolean);
  } catch {
    warning('无法读取 git 暂存区，跳过凭据扫描');
    return true;
  }

  if (stagedFiles.length === 0) {
    success('暂存区为空，无凭据风险');
    return true;
  }

  const credErrors = [];

  // 规则1：路径匹配 Playwright auth 状态目录
  const authPathPattern = /output[\\/]playwright[\\/]\.auth[\\/]/;
  const authPathFiles = stagedFiles.filter(f => authPathPattern.test(f));
  if (authPathFiles.length > 0) {
    authPathFiles.forEach(f =>
      credErrors.push(`路径命中 Playwright auth 目录（含 token）：${f}`)
    );
  }

  // 规则2：文件内容包含「真实 token 值赋值」（key 名紧邻一个长 value）
  // 注意：只命中 key=value / storageState 这类真实泄漏，不再对「裸 key 名」
  // 的散文/evidence 提及（如 BACKLOG evidence 文本里出现 cx_access_token）误报。
  for (const file of stagedFiles) {
    if (authPathPattern.test(file)) continue; // 已被路径规则标记，跳过

    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // 二进制文件跳过
    }

    if (containsCredentialValue(content)) {
      credErrors.push(`文件内容包含敏感 token 值赋值（key=value）：${file}`);
    }
  }

  if (credErrors.length > 0) {
    error(`检测到 ${credErrors.length} 个凭据/敏感产物已加入暂存区（阻断提交）：`);
    credErrors.forEach(e => console.log(`    - ${e}`));
    console.log('    ▶ 移出暂存区：git restore --staged <file>');
    console.log('    ▶ 确认 .gitignore 包含 output/playwright/.auth/');
    return false;
  }

  success('暂存区凭据扫描通过');
  return true;
}

// ============================================================
// 第15项检查：PR 体量门禁（大体量提交切片）
// ============================================================

/**
 * 检查本次变更行数，防止工具/文档大包与业务逻辑混合提交。
 *
 * 规则：
 *   > 800 行  → WARNING（不阻断，但提示拆分意图）
 *   > 2000 行 → ERROR + exit(1)（强制拆分或注明例外原因）
 *
 * 背景：本窗口出现 +44,852 行大包提交，淹没了业务改动评审焦点，
 * 并引发事后热修复（fix: restore auto-deploy gate）。
 */
function checkPrSizeLimit() {
  info('检查 PR 体量门禁（大体量提交切片）...');

  const readText = (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  };

  const listUntrackedFiles = () => {
    try {
      const output = execSync('git ls-files --others --exclude-standard', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return output ? output.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const getTrackedChanges = () => {
    try {
      const output = execSync('git diff --numstat --find-renames=90% HEAD --', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!output) return [];
      return output
        .split('\n')
        .map((line) => {
          const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
          const file = pathParts.join('\t');
          return {
            file,
            added: addedRaw === '-' ? 0 : Number(addedRaw || 0),
            deleted: deletedRaw === '-' ? 0 : Number(deletedRaw || 0),
          };
        })
        .filter((entry) => entry.file);
    } catch {
      return [];
    }
  };

  const pendingChanges = getTrackedChanges();
  const untrackedFiles = listUntrackedFiles();

  // 检查是否有已暂存或工作区修改（不含未跟踪文件）
  const hasStagedOrModified = pendingChanges.length > 0;

  // 优先使用 origin/main..HEAD 来判断已提交的 diff（pre-push 场景）
  const getCommittedChanges = () => {
    try {
      const output = execSync('git diff --numstat --find-renames=90% origin/main..HEAD --', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!output) return [];
      return output
        .split('\n')
        .map((line) => {
          const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
          const file = pathParts.join('\t');
          return {
            file,
            added: addedRaw === '-' ? 0 : Number(addedRaw || 0),
            deleted: deletedRaw === '-' ? 0 : Number(deletedRaw || 0),
          };
        })
        .filter((entry) => entry.file);
    } catch {
      return null; // origin/main 不存在时回退
    }
  };

  const committedChanges = getCommittedChanges();

  // 如果有已提交的 diff（pre-push 场景），优先用它；否则用工作区变更 + 未跟踪文件
  const useCommittedDiff = committedChanges !== null && !hasStagedOrModified;

  const archivedLegacyFiles = new Map();
  for (const file of untrackedFiles) {
    if (!file.startsWith('archive/legacy-code/')) continue;
    const fullPath = path.join(ROOT_DIR, file);
    const content = readText(fullPath);
    if (content !== null) {
      archivedLegacyFiles.set(path.basename(file), content);
    }
  }

  const ignoredChanges = [];
  const countedChanges = [];

  const changesToAnalyze = useCommittedDiff ? committedChanges : pendingChanges;

  for (const change of changesToAnalyze) {
    if (change.file.startsWith('archive/legacy-code/')) {
      ignoredChanges.push({ ...change, reason: 'archive-only' });
      continue;
    }

    // Pure deletions (cleanup) — don't count toward PR size limit
    if (change.added === 0 && change.deleted > 0) {
      ignoredChanges.push({ ...change, reason: 'pure-deletion' });
      continue;
    }

    countedChanges.push(change);
  }

  // 未跟踪文件不计入 PR 体量（未 git add，不会进入 commit/PR）
  if (untrackedFiles.length > 0) {
    info(`${untrackedFiles.length} 个未跟踪文件不计入 PR 体量（未 git add）`);
  }

  let totalLines = countedChanges.reduce((sum, change) => sum + change.added + change.deleted, 0);

  if (changesToAnalyze.length === 0 && !useCommittedDiff && untrackedFiles.length === 0) {
    success('PR 体量检查跳过（无变更）');
    return true;
  }

  if (ignoredChanges.length > 0) {
    info(`PR 体量已忽略 ${ignoredChanges.length} 个归档类变更（archive/legacy-code 或等内容归档迁移）`);
  }

  if (totalLines > 2000) {
    if (process.env.GOVERNANCE_LARGE_PR_OK) {
      warning(
        `PR 体量超过 2000 行（实际: ${totalLines} 行）——已通过 GOVERNANCE_LARGE_PR_OK 环境变量豁免。\n` +
        `    ▶ 豁免原因: ${process.env.GOVERNANCE_LARGE_PR_OK}`
      );
    } else {
      error(
        `PR 体量超过 2000 行（实际: ${totalLines} 行）——必须拆分或在 PR 描述中注明例外原因。\n` +
        '    ▶ 工具/文档批量导入 vs 业务逻辑变更请拆成独立 PR\n' +
        '    ▶ 若确为合法大包，设置 GOVERNANCE_LARGE_PR_OK="原因" 后重试'
      );
      return false;
    }
  }

  if (totalLines > 800) {
    warning(
      `本次变更超过 800 行（实际: ${totalLines} 行）。\n` +
      '    ▶ 请确认：工具/文档批量导入 vs 业务逻辑变更是否已拆分到独立 PR？\n' +
      '    ▶ PR 描述中是否说明了大体量原因？（不阻断，仅提醒）'
    );
    return true;
  }

  success(`PR 体量检查通过（${totalLines} 行，在 800 行阈值内）`);
  return true;
}

// ============================================================
// 15. 知识库数据规模一致性检查
// ============================================================

function checkKnowledgeDataConsistency() {
  info('检查知识库数据规模一致性...');

  const reportPath = path.join(ROOT_DIR, '数据管理', '数据分析报告', '转换质量报告.json');
  const qrPath = path.join(ROOT_DIR, '数据管理', 'knowledge', 'QUICK_REFERENCE.md');
  const policyCurrentDir = path.join(ROOT_DIR, '数据管理', 'warehouse', 'fact', 'policy', 'current');

  if (!fs.existsSync(qrPath)) {
    warning('QUICK_REFERENCE.md 不存在，跳过知识库一致性检查');
    return true;
  }

  try {
    const qrText = fs.readFileSync(qrPath, 'utf-8');
    const qrStats = extractQuickReferenceStats(qrText);
    if (!qrStats) {
      error('QUICK_REFERENCE.md 未找到可解析的数据规模/字段/分片声明');
      return false;
    }

    const policyStats = collectPolicyCurrentStats(process.env.PYTHON || 'python3', policyCurrentDir);
    if (policyStats) {
      const expectedRoundedRows = Math.round(policyStats.rowCount / 10_000) * 10_000;
      const mismatches = [];
      if (qrStats.rowCountApprox !== expectedRoundedRows) {
        mismatches.push(`行数 ${qrStats.rowCountApprox.toLocaleString()} vs 实际约 ${expectedRoundedRows.toLocaleString()}`);
      }
      if (qrStats.fieldCount !== policyStats.fieldCount) {
        mismatches.push(`字段 ${qrStats.fieldCount} vs 实际 ${policyStats.fieldCount}`);
      }
      if (qrStats.shardCount !== policyStats.shardCount) {
        mismatches.push(`分片 ${qrStats.shardCount} vs 实际 ${policyStats.shardCount}`);
      }
      if (mismatches.length > 0) {
        // 目录即唯一事实源：QUICK_REFERENCE.md 的数据规模/字段/分片均为派生值。
        // CI/非交互环境：禁止静默回写放行——CI 只跑 `bun run governance`，回写的
        // 文件不会被提交，若放行则 stale QR 会借自愈蒙混过关、治理门禁形同虚设。
        // 故 CI 下直接失败并提示提交生成结果；本地（dev）才自愈回写放行。
        const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
        if (isCI) {
          error(`知识库数据规模不一致: ${mismatches.join('；')}`);
          console.log('    CI 不自动回写。请本地运行 node 数据管理/daily.mjs 刷新 QUICK_REFERENCE.md 后提交');
          return false;
        }
        // 本地：按目录重算并回写，自愈放行。回写失败（如文件结构损坏）才降级为阻断。
        try {
          const refreshedLine = syncQuickReferenceFile(qrPath, policyStats);
          warning(`知识库数据规模漂移，已按 policy/current 目录自动刷新 QUICK_REFERENCE.md：${mismatches.join('；')}`);
          console.log(`    新规模行: ${refreshedLine}`);
          console.log('    ▶ 文件已在工作区更新，请 git add 后随本次变更一并提交');
          return true;
        } catch (e) {
          error(`知识库数据规模不一致且自动刷新失败: ${mismatches.join('；')}（${e.message}）`);
          console.log('    修复: 运行 node 数据管理/daily.mjs，或用真实 policy/current 分片刷新 QUICK_REFERENCE.md');
          return false;
        }
      }

      success(`知识库数据规模一致（约 ${expectedRoundedRows.toLocaleString()} 行 / ${policyStats.fieldCount} 字段 / ${policyStats.shardCount} 分片）`);
      return true;
    }

    if (!fs.existsSync(reportPath)) {
      warning('缺少 policy/current parquet 与转换质量报告，跳过知识库一致性检查');
      return true;
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const reportCols = report.basic_stats?.columns;
    if (!reportCols) {
      warning('转换质量报告缺少 basic_stats.columns，跳过');
      return true;
    }

    if (Math.abs(reportCols - qrStats.fieldCount) > 3) {
      error(`知识库数据规模不一致: 转换质量报告 ${reportCols} 字段 vs QUICK_REFERENCE.md ${qrStats.fieldCount} 字段（差 ${Math.abs(reportCols - qrStats.fieldCount)}）`);
      console.log('    修复: 运行 node 数据管理/daily.mjs，或用真实 policy/current 分片刷新 QUICK_REFERENCE.md');
      return false;
    }

    success(`知识库数据规模一致（${reportCols} 字段；未发现本地 policy/current 分片，已跳过行数/分片校验）`);
    return true;
  } catch (e) {
    warning(`知识库一致性检查异常: ${e.message}`);
    return true;
  }
}

// 16. .gitignore 审计：检测已索引的脚本是否被忽略规则误杀
function checkGitignoreShadow() {
  info('检查 .gitignore 是否误杀已跟踪文件...');
  try {
    // 获取所有已被 git 跟踪的文件
    const tracked = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim().split('\n');
    // 检查每个已跟踪文件是否会被当前 .gitignore 忽略
    // 用 git check-ignore 批量检查
    const scriptFiles = tracked.filter(f => f.endsWith('.py') || f.endsWith('.ts') || f.endsWith('.mjs'));
    let shadowedCount = 0;
    for (const f of scriptFiles) {
      try {
        // 用 execFileSync 数组传参，避免文件名含 $()/反引号/引号时被 shell 注入执行
        execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT_DIR, encoding: 'utf-8' });
        // 如果没报错，说明文件会被忽略
        warning(`.gitignore 会忽略已跟踪文件: ${f}（修改后将无法提交新变更）`);
        shadowedCount++;
      } catch {
        // check-ignore 返回非0 = 不会被忽略，正常
      }
    }
    if (shadowedCount > 0) {
      warning(`${shadowedCount} 个已跟踪脚本被 .gitignore 规则覆盖，修改后无法 git add`);
    } else {
      success('无已跟踪文件被 .gitignore 误覆盖');
    }
    return true; // 降级为 warning，不阻断
  } catch (e) {
    warning(`.gitignore 审计异常: ${e.message}`);
    return true;
  }
}

// 17. 字段注册表同步：field-registry codegen 产物一致性
function checkFieldDefinitionConsistency() {
  info('检查字段注册表同步（field-registry → mapping.ts / validator.ts / etl_fields.json）...');
  try {
    const result = execSync('node scripts/field-registry/generate.mjs --check', {
      cwd: ROOT_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    // 从输出中提取字段数
    const countMatch = result.match(/(\d+) 个字段/);
    const count = countMatch ? countMatch[1] : '?';
    success(`字段注册表同步（${count} 个字段，3 个下游文件均一致）`);
    return true;
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    error(`字段注册表不同步 — 运行 node scripts/field-registry/generate.mjs 重新生成`);
    if (output) {
      const lines = output.split('\n').filter(l => l.includes('❌'));
      lines.forEach(l => console.log(`    ${l.trim()}`));
    }
    return false;
  }
}

// ============================================================
// 18. Dark Mode 质量门禁
// ============================================================

function checkDarkModeQuality() {
  info('检查 Dark Mode 质量门禁...');

  const srcDir = path.join(ROOT_DIR, 'src');
  const violations = [];

  // 递归扫描 .tsx 文件
  function walkTsx(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTsx(full);
      } else if (entry.name.endsWith('.tsx')) {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n');
        const relPath = path.relative(ROOT_DIR, full);

        lines.forEach((line, idx) => {
          // 规则 1: bg-white 无 dark: 变体（排除已有 dark:bg- 的行）
          if (/\bbg-white\b/.test(line) && !/dark:bg-/.test(line) && !/className.*dark:/.test(line)) {
            // 排除注释行和 style={{ 行
            if (!line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('style={{')) {
              violations.push({ file: relPath, line: idx + 1, rule: 'bg-white 缺 dark: 变体', code: line.trim().substring(0, 80) });
            }
          }

          // 规则 2: style={{ color/background 硬编码（仅限组件渲染区域）
          if (/style=\{\{/.test(line) && /(?:color|background(?:Color)?)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(line)) {
            if (!line.trim().startsWith('//')) {
              violations.push({ file: relPath, line: idx + 1, rule: 'style 硬编码颜色', code: line.trim().substring(0, 80) });
            }
          }
        });
      }
    }
  }

  walkTsx(srcDir);

  // 阈值：允许一定数量的遗留问题，但增长趋势必须下降
  const MAX_BG_WHITE_VIOLATIONS = 30; // 当前遗留量，逐步降低
  const bgWhiteCount = violations.filter(v => v.rule === 'bg-white 缺 dark: 变体').length;
  const styleCount = violations.filter(v => v.rule === 'style 硬编码颜色').length;

  if (bgWhiteCount > MAX_BG_WHITE_VIOLATIONS) {
    error(`bg-white 缺 dark: 变体 = ${bgWhiteCount} 处（阈值 ${MAX_BG_WHITE_VIOLATIONS}）`);
    violations.filter(v => v.rule === 'bg-white 缺 dark: 变体').slice(0, 5).forEach(v => {
      console.log(`    ${v.file}:${v.line} → ${v.code}`);
    });
    if (bgWhiteCount > 5) console.log(`    ... 及其他 ${bgWhiteCount - 5} 处`);
    return false;
  }

  if (styleCount > 0) {
    warning(`style 硬编码颜色 = ${styleCount} 处（建议迁移到 Tailwind + dark: 变体）`);
    violations.filter(v => v.rule === 'style 硬编码颜色').slice(0, 3).forEach(v => {
      console.log(`    ${v.file}:${v.line} → ${v.code}`);
    });
  }

  success(`Dark Mode 质量门禁通过（bg-white 遗留 ${bgWhiteCount}/${MAX_BG_WHITE_VIOLATIONS}）`);
  return true;
}

// ============================================================
// 18. ECharts splitLine 合规检查（DC-003 设计令牌）
// ============================================================

function checkEchartsSplitLine() {
  info('检查 ECharts splitLine 合规（value 轴必须 show:false）...');

  const srcDir = path.join(ROOT_DIR, 'src');
  const violations = [];

  // 安全模式列表：使用 theme.yAxisConfig / AXIS_SPLIT_LINE 的文件天然合规
  const SAFE_PATTERNS = [
    'theme.yAxisConfig',
    'theme.xAxisConfig',
    'AXIS_SPLIT_LINE',
    'Y_AXIS_CONFIG',
  ];

  function walkFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full);
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
        scanFile(full);
      }
    }
  }

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    // 只扫描包含 ECharts 轴配置的文件
    if (!content.includes('yAxis') && !content.includes('xAxis')) return;
    // 跳过配置定义文件本身
    const relPath = path.relative(ROOT_DIR, filePath);
    if (relPath.includes('chartStyles.ts')) return;

    const lines = content.split('\n');

    // 简单的块级扫描：找 type: 'value' 的轴定义，检查附近是否有 splitLine.*show.*false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 匹配 yAxis 或 xAxis 中包含 type: 'value' 的行
      if (/type:\s*['"]value['"]/.test(line)) {
        // 检查上下文（前3行到后10行）是否有 splitLine show false 或安全模式
        const contextStart = Math.max(0, i - 3);
        const contextEnd = Math.min(lines.length - 1, i + 10);
        const context = lines.slice(contextStart, contextEnd + 1).join('\n');

        const hasSplitLineOff = /splitLine.*show.*false/s.test(context);
        const hasSafePattern = SAFE_PATTERNS.some(p => context.includes(p));

        if (!hasSplitLineOff && !hasSafePattern) {
          violations.push({
            file: relPath,
            line: i + 1,
            code: line.trim().substring(0, 80),
          });
        }
      }
    }
  }

  walkFiles(srcDir);

  if (violations.length > 0) {
    error(`ECharts value 轴缺少 splitLine: { show: false } = ${violations.length} 处`);
    violations.slice(0, 8).forEach(v => {
      console.log(`    ${v.file}:${v.line} → ${v.code}`);
    });
    if (violations.length > 8) console.log(`    ... 及其他 ${violations.length - 8} 处`);
    return false;
  }

  success('ECharts splitLine 合规检查通过');
  return true;
}

// ============================================================
// 第20项检查：sync-vps 数据域覆盖一致性
// ============================================================

/**
 * 检查 sync-vps.mjs 中声明的 LOCAL_*_DIR 常量是否全部在 runStandardMode() 中被引用。
 * 防止新增数据域只声明了常量但忘记添加实际同步步骤。
 */
function checkSyncVpsCoverage() {
  info('检查 sync-vps 数据域同步覆盖...');

  const syncVpsPath = path.join(ROOT_DIR, 'scripts/sync-vps.mjs');
  let content;
  try {
    content = fs.readFileSync(syncVpsPath, 'utf8');
  } catch {
    warning('sync-vps.mjs 不存在，跳过检查');
    return true;
  }

  // 提取所有 LOCAL_*_DIR 常量名
  const constRegex = /const\s+(LOCAL_\w+_DIR)\s*=/g;
  const declaredDirs = [];
  let match;
  while ((match = constRegex.exec(content)) !== null) {
    declaredDirs.push(match[1]);
  }

  if (declaredDirs.length === 0) {
    success('sync-vps 数据域覆盖检查跳过（无 LOCAL_*_DIR 常量）');
    return true;
  }

  // 提取标准同步声明和执行函数体。sync-vps.mjs 可把任务数组抽到 helper，
  // 检查范围应覆盖声明 helper + runStandardMode，而不是只看执行函数。
  const fnStart = content.indexOf('async function runStandardMode');
  if (fnStart === -1) {
    warning('sync-vps.mjs 中未找到 runStandardMode 函数，跳过检查');
    return true;
  }
  const helperStart = content.indexOf('function buildStandardSyncTasks');

  // 简单提取：从函数声明到下一个 async function 或文件末尾
  const fnEnd = content.indexOf('\nasync function ', fnStart + 1);
  const fnBody = [
    helperStart >= 0 ? content.slice(helperStart, fnStart) : '',
    fnEnd === -1 ? content.slice(fnStart) : content.slice(fnStart, fnEnd),
  ].join('\n');

  const missing = declaredDirs.filter(name => !fnBody.includes(name));

  if (missing.length > 0) {
    error(
      `sync-vps.mjs 数据域同步遗漏：${missing.length} 个 LOCAL_*_DIR 常量未在 runStandardMode() 中引用\n` +
      missing.map(name => `    - ${name}`).join('\n') + '\n' +
      '    ▶ 修复：在 runStandardMode() 中添加对应的 rsyncDir 同步步骤'
    );
    return false;
  }

  success(`sync-vps 数据域覆盖一致（${declaredDirs.length} 个目录全部同步）`);
  return true;
}

// ============================================================
// 第21项检查：数据漂移检测（本地文件 vs 上次同步清单）
// ============================================================

/**
 * 对比本地 parquet 文件与 .last-sync-manifest.json 的差异。
 * 如果本地文件有新增/删除/大小变化，说明数据修改后还没同步到 VPS。
 */
function checkDataDrift() {
  info('检查数据同步状态（本地 vs VPS 清单）...');

  const manifestPath = path.join(ROOT_DIR, '.last-sync-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    warning('未找到 .last-sync-manifest.json（首次同步前正常）— 运行 node scripts/sync-vps.mjs 生成');
    return true; // 不阻断首次
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    warning('.last-sync-manifest.json 格式错误，跳过检查');
    return true;
  }

  // 扫描当前本地文件
  const syncVpsPath = path.join(ROOT_DIR, 'scripts/sync-vps.mjs');
  let syncContent;
  try {
    syncContent = fs.readFileSync(syncVpsPath, 'utf8');
  } catch {
    return true;
  }

  // 提取目录映射：从 writeSyncManifest 的 dirs 数组
  const dirMappings = [
    { label: 'policy/current', rel: '数据管理/warehouse/fact/policy/current' },
    { label: 'dim/salesman', rel: '数据管理/warehouse/dim/salesman' },
    { label: 'dim/plan', rel: '数据管理/warehouse/dim/plan' },
    { label: 'dim/brand', rel: '数据管理/warehouse/dim/brand' },
    { label: 'fact/renewal_tracker', rel: '数据管理/warehouse/fact/renewal_tracker' },
    { label: 'fact/quotes_conversion', rel: '数据管理/warehouse/fact/quotes_conversion' },
    { label: 'fact/claims_detail', rel: '数据管理/warehouse/fact/claims_detail' },
    { label: 'fact/cross_sell', rel: '数据管理/warehouse/fact/cross_sell' },
    { label: 'fact/customer_flow', rel: '数据管理/warehouse/fact/customer_flow' },
    { label: 'fact/new_energy_claims', rel: '数据管理/warehouse/fact/new_energy_claims' },
    { label: 'dim/repair', rel: '数据管理/warehouse/dim/repair' },
    { label: 'dim/plate_region', rel: '数据管理/warehouse/dim/plate_region' },
  ];
  const currentFiles = {};
  for (const dir of dirMappings) {
    const absPath = path.join(ROOT_DIR, dir.rel);
    if (!fs.existsSync(absPath)) continue;
    const parquets = fs.readdirSync(absPath).filter(f => f.endsWith('.parquet'));
    for (const f of parquets) {
      const key = `${dir.label}/${f}`;
      const stat = fs.statSync(path.join(absPath, f));
      currentFiles[key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
    }
  }

  const manifestFiles = manifest.files || {};
  const diffs = [];

  // 检查新增或大小变化的文件
  for (const [key, cur] of Object.entries(currentFiles)) {
    if (!manifestFiles[key]) {
      diffs.push(`+ ${key}（新增，未同步）`);
    } else if (manifestFiles[key].size !== cur.size) {
      diffs.push(`~ ${key}（大小变化: ${manifestFiles[key].size} → ${cur.size}）`);
    }
  }

  // 检查已删除的文件
  for (const key of Object.keys(manifestFiles)) {
    if (!currentFiles[key]) {
      diffs.push(`- ${key}（已删除，VPS 仍有旧文件）`);
    }
  }

  if (diffs.length === 0) {
    success(`数据同步状态一致（${Object.keys(currentFiles).length} 个文件，清单时间: ${manifest.syncedAt?.slice(0, 16) ?? '未知'}）`);
    return true;
  }

  error(
    `本地数据与 VPS 同步清单不一致（${diffs.length} 处差异）——push 前必须运行 node scripts/sync-vps.mjs\n` +
    diffs.map(d => `    ${d}`).join('\n')
  );
  return false;
}

// ============================================================
// 第22项检查：SQL 模块数与 CODE_INDEX 一致性
// ============================================================

/**
 * 校验 server/src/sql/*.ts 文件数量与 CODE_INDEX.md SQL 表格中声明的数量一致。
 * 根因：CODE_INDEX 曾漂移至 14/24（实际 31），误导 agent 架构决策。
 */
function checkSqlModuleCountConsistency() {
  info('检查 SQL 模块数与 CODE_INDEX 一致性...');

  const sqlDir = path.join(ROOT_DIR, 'server/src/sql');
  const codeIndexPath = path.join(ROOT_DIR, '开发文档/00_index/CODE_INDEX.md');

  if (!fs.existsSync(sqlDir)) {
    warning('server/src/sql/ 目录不存在，跳过');
    return true;
  }

  // 计算实际 SQL 文件数
  const sqlFiles = fs.readdirSync(sqlDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const actualCount = sqlFiles.length;

  if (!fs.existsSync(codeIndexPath)) {
    warning('CODE_INDEX.md 不存在，跳过');
    return true;
  }

  // 从 CODE_INDEX.md 提取声明的文件数（匹配 "31 个文件" 或 "31 个模块" 等模式）
  const indexContent = fs.readFileSync(codeIndexPath, 'utf8');
  const countMatch = indexContent.match(/server\/src\/sql\/.*?(\d+)\s*个/);

  if (!countMatch) {
    warning('CODE_INDEX.md 中未找到 SQL 模块数量声明，跳过');
    return true;
  }

  const declaredCount = parseInt(countMatch[1], 10);

  if (actualCount !== declaredCount) {
    error(
      `SQL 模块数不一致：CODE_INDEX.md 声明 ${declaredCount} 个，实际 ${actualCount} 个\n` +
      `    ▶ 修复：更新 CODE_INDEX.md SQL 生成器表格（新增或删除文件后必须同步）`
    );
    return false;
  }

  success(`SQL 模块数一致（${actualCount} 个文件 = CODE_INDEX 声明 ${declaredCount} 个）`);
  return true;
}

// ============================================================
// 23. CLAUDE.md 体积预算检查
// ============================================================

function checkClaudeMdBudget() {
  info('检查 CLAUDE.md 体积预算...');

  const claudePath = path.join(ROOT_DIR, 'CLAUDE.md');
  if (!fs.existsSync(claudePath)) {
    error('CLAUDE.md 不存在');
    return false;
  }

  const content = fs.readFileSync(claudePath, 'utf-8');
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  const sizeKB = (sizeBytes / 1024).toFixed(1);

  // 检查 GSD 区块是否被内联（非墓碑状态）
  const bloatedSections = [];
  for (const name of ['stack', 'conventions', 'architecture', 'skills']) {
    const startMarker = `<!-- GSD:${name}-start`;
    const endMarker = `<!-- GSD:${name}-end -->`;
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1) {
      const sectionContent = content.substring(startIdx, endIdx);
      const lines = sectionContent.split('\n').length;
      if (lines > 5) {
        bloatedSections.push(`${name}(${lines}行)`);
      }
    }
  }

  const errors = [];
  const warnings = [];

  if (bloatedSections.length > 0) {
    errors.push(
      `GSD 区块被内联：${bloatedSections.join(', ')}\n` +
      `    ▶ 这些内容已存在于 ARCHITECTURE.md / .claude/rules/ / system-reminder\n` +
      `    ▶ 修复：将区块内容替换为单行墓碑注释`
    );
  }

  if (sizeBytes > 20480) {
    errors.push(
      `CLAUDE.md 超出 20KB 预算：当前 ${sizeKB}KB\n` +
      `    ▶ 每次对话完整加载，膨胀直接降低性能\n` +
      `    ▶ 修复：删除冗余 GSD 区块内容，保留墓碑 marker`
    );
  } else if (sizeBytes > 15360) {
    warnings.push(`CLAUDE.md 接近预算上限：${sizeKB}KB / 20KB`);
  }

  if (warnings.length > 0) {
    warnings.forEach(w => warning(w));
  }

  if (errors.length > 0) {
    error('CLAUDE.md 体积检查失败：');
    errors.forEach(err => console.log(`    - ${err}`));
    return false;
  }

  success(`CLAUDE.md 体积合规（${sizeKB}KB / 20KB）`);
  return true;
}

// ============================================================
// rules 体系 eager-load 体积预算（Claude Code 官方黄金标准 #2：path-scoped 按需加载）
// ============================================================
//
// 背景：CLAUDE.md 与「无 paths: frontmatter 的 .claude/rules/*.md」每轮对话全量
// 加载（eager-load），是 CLAUDE.md 的真延伸。Claude Code 官方《Memory》最佳实践：
// 「文件超 200 行消耗更多上下文、降低遵从度；用路径门控（path-scoped rules）只在
// 处理匹配文件时加载，或裁掉不必每轮需要的内容」。
//
// #23 checkClaudeMdBudget 只管 CLAUDE.md 本体（20KB），放任 rules 延伸区无闸。
// 本闸度量「无 paths: 门控的 rules 文件」总字节——低频/事件性 SOP 应加 paths:
// frontmatter 移出常驻区（碰匹配代码时才注入）。
//
// 闸级 = error（防回退）：6 个低频 SOP 已加 paths: 门控（PR [policy-override]），
// eager-load 区从 60.3KB 降至达标。此后回退（删门控 / 塞大块常驻内容）即 fail。
// 给既有 rule 加 frontmatter 按 AGENTS.md §8.2「rules 既有文件改动按 frozen 处理」
// 需 [policy-override]——这是瘦身的合规前提，已在 .claude/workflow/pr-evolution.md 登记。

const EAGER_LOAD_RULES_BUDGET = 40 * 1024; // 40KB 目标线

/**
 * rule 文件是否带 paths: YAML frontmatter（= 路径门控按需加载，不计入 eager-load）。
 * paths 键必须有实际 glob 值（行内数组含引号串，或下方 `- "..."` 列表项）；
 * 空值 / null / 注释（`paths:` 后无值）不算门控——防"空值绕过 eager-load 预算"（verifier P1）。
 */
export function hasPathsFrontmatter(content) {
  if (!content.startsWith('---')) return false;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return false;
  const fm = content.slice(3, end);
  return /paths\s*:\s*(\[[^\]]*["'][^"']+["'][^\]]*\]|\r?\n\s*-\s*["'][^"']+["'])/.test(fm);
}

function checkRulesEagerLoadBudget() {
  info('检查 rules 体系 eager-load 体积预算（黄金标准：path-scoped 按需加载）...');
  const rulesDir = path.join(ROOT_DIR, '.claude/rules');
  if (!fs.existsSync(rulesDir)) {
    warning('.claude/rules 不存在，跳过');
    return true;
  }
  const eager = [];
  for (const name of fs.readdirSync(rulesDir)) {
    if (!name.endsWith('.md')) continue;
    const fp = path.join(rulesDir, name);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf-8');
    if (hasPathsFrontmatter(content)) continue; // 按需加载，不计入常驻预算
    eager.push({ name, bytes: Buffer.byteLength(content, 'utf-8') });
  }
  const totalBytes = eager.reduce((s, f) => s + f.bytes, 0);
  const totalKB = (totalBytes / 1024).toFixed(1);
  const budgetKB = (EAGER_LOAD_RULES_BUDGET / 1024).toFixed(0);

  if (totalBytes > EAGER_LOAD_RULES_BUDGET) {
    const top = [...eager].sort((a, b) => b.bytes - a.bytes).slice(0, 6)
      .map(f => `${f.name}(${(f.bytes / 1024).toFixed(1)}KB)`);
    error(
      `rules eager-load 区超 ${budgetKB}KB 预算：当前 ${totalKB}KB（${eager.length} 个无 paths: 门控文件，每轮全量加载）`
    );
    console.log(`    ▶ 体积最大者：${top.join(', ')}`);
    console.log(`    ▶ 黄金标准 #2（Claude Code 官方）：给低频/事件性 SOP 加 paths: frontmatter 门控（只在编辑匹配代码时加载，不进每轮 eager-load）`);
    console.log(`    ▶ 既有 rule 加 frontmatter 按 AGENTS.md §8.2 走 frozen，需 [policy-override]`);
    return false; // 防回退：达标后回退（删门控 / 塞大块常驻内容）即 fail
  }
  success(`rules eager-load 区合规（${totalKB}KB / ${budgetKB}KB，${eager.length} 个无门控文件）`);
  return true;
}

// ============================================================
// CLAUDE.md 漂移计数防回归（Claude Code 官方黄金标准 #8：避免会过期的快照）
// ============================================================
//
// 复盘：CLAUDE.md 曾硬编码「49 个指标 / 56 个字段 / 198 测试文件」等随迭代漂移的
// 精确计数，反复手工校准（指标 25→49→52、字段 42→56→58）仍漂。黄金标准 #8：
// eager-load 文件不放会过期的快照——这类数字 AI 干活不需要（会去 grep 注册表），
// 留着只会漂移 + 误导。本闸检测会漂移的硬编码计数，提示改「以 X 为准」指针。
// 不误伤：稳定枚举（「11 类」）、约数（「20+ 变量」「50+ 路由」）、changelog 历史数字。

/** 返回 CLAUDE.md 文本里会随迭代漂移的硬编码计数命中（带「个」单位锚定，避开稳定枚举/约数）。 */
export function findStaleCounts(content) {
  // 启发式覆盖（非穷举）：抓带单位锚点的会漂计数；新模式靠 review 补充（verifier P2）。
  // 排除约数（「50+」因 + 不匹配）与稳定枚举（「11 类」无单位词不匹配）。
  const STALE_PATTERNS = [
    /\d+\s*个指标/,
    /\d+\s*个字段/,
    /\d+\s*字段定义/,
    /\d+\s*个?\s*SQL\s*模块/,
    /\d+\s*子路由/,
    /\d+\s*路由/,
    /\d+\s*域(元数据|命名空间)/,
    /\d+\s*测试文件/,
  ];
  const hits = [];
  content.split('\n').forEach((line, i) => {
    for (const re of STALE_PATTERNS) {
      const m = line.match(re);
      if (m) hits.push({ line: i + 1, text: m[0] });
    }
  });
  return hits;
}

function checkClaudeMdNoStaleCounts() {
  info('检查 CLAUDE.md 漂移计数防回归（黄金标准：避免会过期的快照）...');
  const claudePath = path.join(ROOT_DIR, 'CLAUDE.md');
  if (!fs.existsSync(claudePath)) {
    warning('CLAUDE.md 不存在，跳过');
    return true;
  }
  const hits = findStaleCounts(fs.readFileSync(claudePath, 'utf-8'));
  if (hits.length > 0) {
    warning('CLAUDE.md 含会漂移的硬编码计数（黄金标准 #8：改「以 X 为准」指针）：');
    hits.forEach(h => console.log(`    - L${h.line}: "${h.text}"`));
    console.log('    ▶ 这类数字 AI 干活不需要（会 grep 注册表），留着只会漂移 + 误导');
    console.log('    ▶ 改法：如「52 个指标」→「数量以 validate.ts 为准」；稳定枚举(11 类)/约数(50+)不在此列');
    return true; // warning 不阻断（硬编码计数是债不是 bug，配合 review）
  }
  success('CLAUDE.md 无已知模式的漂移计数（启发式覆盖：指标/字段/SQL/路由/域/测试，非穷举）');
  return true;
}

// ============================================================
// #24 ETL 管道多 sheet 加载规范
// ============================================================

function checkEtlMultiSheetCompliance() {
  info('检查 ETL 管道是否使用 load_excel_all_sheets...');

  const pipelineDir = path.join('数据管理', 'pipelines');
  if (!fs.existsSync(pipelineDir)) {
    warning('数据管理/pipelines 目录不存在，跳过检查');
    return true;
  }

  const pyFiles = fs.readdirSync(pipelineDir)
    .filter(f => f.startsWith('convert_') || f === 'quote_etl.py')
    .map(f => path.join(pipelineDir, f));

  const errors = [];
  const ALLOWED_BARE_READ = new Set([
    // transform.py 使用自己的 load_target_excel，不在 convert_* 命名范围内
    // compare_excel.py 是对比工具，不在扫描范围内
  ]);

  for (const filePath of pyFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const fileName = path.basename(filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 检测裸 pd.read_excel 调用（排除注释行和 load_excel_all_sheets 内部）
      if (line.match(/pd\.read_excel\s*\(/) && !line.trim().startsWith('#')) {
        errors.push(`${fileName}:${i + 1}: 使用了裸 pd.read_excel()，应改用 load_excel_all_sheets()`);
      }
    }
  }

  if (errors.length > 0) {
    error('ETL 多 sheet 加载规范检查失败：');
    errors.forEach(e => console.log(`    - ${e}`));
    console.log('    修复：将 pd.read_excel() 替换为 from pipelines.etl_validation import load_excel_all_sheets');
    return false;
  }

  success(`ETL 多 sheet 加载规范通过（扫描 ${pyFiles.length} 个管道文件）`);
  return true;
}

// ============================================================
// state-db 依赖隔离（B296 Phase 1）
// ============================================================

/**
 * state.db 模块仅供 API server 使用，CLI/MCP/前端必须走 HTTP API。
 *
 * 检查：
 * 1) better-sqlite3 仅出现在 server/package.json（root + 未来 cli/mcp 不可有）
 * 2) state-db.ts 含访问契约注释（"ONLY ... may import"）
 * 3) state-db.js 的 import 来源仅来自白名单文件（防止意外扩散）
 *
 * 白名单（Phase 1 起，Phase 2/3 时 append）：
 * - server/src/app.ts                              （init/close 生命周期）
 * - server/src/services/state-db-schema.ts         （同包 schema 模块）
 * - server/src/services/__tests__/state-db.test.ts （单元测试）
 * 未来 Phase 2 加 access-control-store.ts；Phase 3 加 personal-access-token-store.ts
 */
function checkStateDbDependencyIsolation() {
  info('检查 state-db 依赖隔离（B296 Phase 1）...');

  // 1) 仓库根 package.json 不能含 better-sqlite3
  const rootPkgPath = path.join(ROOT_DIR, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    const allRootDeps = {
      ...(rootPkg.dependencies || {}),
      ...(rootPkg.devDependencies || {}),
    };
    if (allRootDeps['better-sqlite3']) {
      error('root package.json 不允许引入 better-sqlite3（仅 server 可用）');
      console.log('    - 状态持久层是后端权威写入口，前端构建工具链不应携带原生模块');
      return false;
    }
  }

  // 1b) 未来 cli/ mcp/ 目录创建时也不能引入 better-sqlite3
  for (const dir of ['cli', 'mcp']) {
    const pkgPath = path.join(ROOT_DIR, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue; // 目录不存在则跳过（未来扩展）
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    if (deps['better-sqlite3']) {
      error(`${dir}/package.json 不允许引入 better-sqlite3（必须走 HTTP API 客户端）`);
      console.log('    - CLI/MCP 是 PAT 持有者，通过 /api/* 调 API，禁止 require 原生 SQLite');
      return false;
    }
  }

  // 2) state-db.ts 文件头契约注释存在
  const stateDbPath = path.join(ROOT_DIR, 'server/src/services/state-db.ts');
  if (!fs.existsSync(stateDbPath)) {
    success('state-db.ts 尚未创建，跳过依赖隔离检查（B296 未启用）');
    return true;
  }
  const stateDbSrc = fs.readFileSync(stateDbPath, 'utf-8');
  if (!stateDbSrc.includes('ONLY')) {
    error('state-db.ts 缺少访问契约注释（应含 "ONLY {access-control,personal-access-token}-store.ts may import"）');
    return false;
  }

  // 3) state-db 的 import 来源限白名单
  const allowedImporters = new Set([
    'server/src/app.ts',
    'server/src/services/state-db-schema.ts',
    'server/src/services/__tests__/state-db.test.ts',
    // Phase 2（B297）：users / roles Repository + 单元测试
    'server/src/services/access-control-store.ts',
    'server/src/services/__tests__/access-control-store.test.ts',
    // Phase 2（B297）：一次性迁移 CLI — 需 init/close state-db 生命周期
    'server/src/scripts/admin-import-users-from-json.ts',
    // Phase 3（B298）：PAT Repository + 单元测试 + 一次性迁移 CLI
    'server/src/services/personal-access-token-store.ts',
    'server/src/services/__tests__/personal-access-token-store-sqlite.test.ts',
    'server/src/scripts/admin-import-pat-from-json.ts',
  ]);

  const serverSrc = path.join(ROOT_DIR, 'server/src');
  const violators = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      // 匹配 import 'state-db' / 'state-db.js' 但排除 'state-db-schema'
      const importsStateDb =
        /from\s+['"][^'"]*\/state-db(?:\.js)?['"]/m.test(content) ||
        /import\s+['"][^'"]*\/state-db(?:\.js)?['"]/m.test(content);
      if (!importsStateDb) continue;

      const relPath = path.relative(ROOT_DIR, fullPath);
      // 自身免检
      if (relPath === 'server/src/services/state-db.ts') continue;
      if (!allowedImporters.has(relPath)) {
        violators.push(relPath);
      }
    }
  }
  walk(serverSrc);

  if (violators.length > 0) {
    error('未授权的 state-db 导入：');
    for (const v of violators) console.log(`    - ${v}`);
    console.log('    修复：');
    console.log('    - 通过 *-store.ts Repository 层访问，不要直接 import state-db');
    console.log('    - 确属必要时，在 check-governance.mjs 的 allowedImporters 白名单中添加');
    return false;
  }

  success('state-db 依赖隔离通过（root/cli/mcp 无 better-sqlite3 + 契约注释存在 + 导入白名单受控）');
  return true;
}

// ============================================================
// 25. 空 catch 块禁令（静默失败 Law 1）
//    - server/src + src 禁止 `catch (e) {}` / `catch {}` 空块
//    - 空 catch 吞掉异常且无任何痕迹，是最典型的静默失败
//    - 仅拦"纯空块"（正则可精确识别、零误报）；"catch 返回空值无日志/无判别"
//      正则无法无误报地识别，留 silent-failure-guard skill 软自查 + 待 ESLint AST
//    - 配套 skill: .claude/skills/silent-failure-guard.md
// ============================================================

function checkEmptyCatchBlocks() {
  info('检查空 catch 块（静默失败 Law 1）...');

  const scanDirs = ['server/src', 'src'].map(d => path.join(ROOT_DIR, d));
  // 匹配 catch (...) {  } 或 catch {  }，块内仅空白（含跨行）
  const emptyCatchRe = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
  const violations = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        let m;
        emptyCatchRe.lastIndex = 0;
        while ((m = emptyCatchRe.exec(content)) !== null) {
          const line = content.slice(0, m.index).split('\n').length;
          violations.push(`${path.relative(ROOT_DIR, full)}:${line}`);
        }
      }
    }
  }

  for (const d of scanDirs) walk(d);

  if (violations.length > 0) {
    error(`发现空 catch 块（吞异常无痕迹）= ${violations.length} 处：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复：catch 内至少记日志（含上下文），并重抛或返回带错误标记的结果');
    console.log('    依据：.claude/skills/silent-failure-guard.md 五律 Law 1');
    return false;
  }

  success('空 catch 块检查通过（server/src + src 无吞异常空块）');
  return true;
}

/**
 * 筛选参数绕过检测（治理计划 2026-06-10 Task 1-D，防复发核心）
 *
 * 病根：各页绕过统一转换函数 src/shared/utils/filterParams.ts:buildFilterParams
 * 自写 filters.* → 请求参数映射，漏维度 → queryKey 不变 → chip 点了数据不动
 * （2026-06-10 全站审计：续保/对比/增长/赔案/交叉销售 5 页中招）。
 *
 * 规则：src/features/** 禁止对"快捷筛选维度参数名"手工赋值——这些名字只应由
 * buildFilterParams 产出。命中报错并提示改用统一函数。
 *
 * 范围说明：
 * - 不含 orgNames/salesmanNames——机构/业务员有 RBAC 注入、地区下钻、analyze 单独传参
 *   等大量合法单独处理，且不是漏接事故肇因，纳入会造成大面积误报豁免
 * - 该闸防"无意复发"，不防"故意绕过"（变量改名/间接赋值可绕，兜底是 Phase 5 E2E）
 * - 确需映射层的位置（如续保 hook 按后端能力裁剪、独立域自治参数集的同名巧合）
 *   在命中行或其上一行写 `governance-allow: filter-params-mapping`
 */
function checkFilterParamsBypass() {
  info('检查筛选参数绕过（features/ 禁手写 buildFilterParams 产出的参数名赋值）...');

  const PARAM_NAMES = 'customerCategories|coverageCombinations|renewalModes|tonnageSegments|insuranceGrades|isRenewal|isNewCar|isTransfer|isNev|isTelemarketing|insuranceType|isCommercialInsure|isRenewable|isCrossSell|vehicleQuickFilter|enterpriseCar|businessNature|fuelCategory';
  // 纯赋值两式（=(?!=) 负向断言：排除 ==/=== 比较，且兼容「赋值号在行尾、值断行到下一行」
  // 的 prettier 风格——旧 =[^=] 要求 = 后必须还有字符，断行赋值会静默漏检；读取无 = 跟随不命中）
  const FORBIDDEN_DOT = new RegExp(`\\.(${PARAM_NAMES})\\s*=(?!=)`);
  const FORBIDDEN_BRACKET = new RegExp(`\\[\\s*['"](${PARAM_NAMES})['"]\\s*\\]\\s*=(?!=)`);
  const ALLOW_MARK = 'governance-allow: filter-params-mapping';

  const scanRoot = path.join(ROOT_DIR, 'src/features');
  const violations = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (!FORBIDDEN_DOT.test(line) && !FORBIDDEN_BRACKET.test(line)) return;
          const prev = i > 0 ? lines[i - 1] : '';
          if (line.includes(ALLOW_MARK) || prev.includes(ALLOW_MARK)) return;
          violations.push(`${path.relative(ROOT_DIR, full)}:${i + 1}`);
        });
      }
    }
  }
  walk(scanRoot);

  if (violations.length > 0) {
    error(`发现手写筛选参数映射（绕过 buildFilterParams）= ${violations.length} 处：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复：改用 src/shared/utils/filterParams.ts:buildFilterParams（唯一事实源）');
    console.log('    确需按后端能力裁剪的映射层：命中行或上一行加 // governance-allow: filter-params-mapping');
    console.log('    依据：开发文档/筛选器联动治理计划_2026-06-10.md Task 1-D');
    return false;
  }

  success('筛选参数绕过检查通过（features/ 无未豁免的手写参数映射）');
  return true;
}

/**
 * 能力矩阵两端一致检查（治理计划 Phase 3，✅D5 = TS 常量起步）
 *
 * 前端 src/shared/config/filter-dimension-capability.ts 与后端
 * server/src/config/filter-dimension-capability.ts 是同一「维度 × 数据域能力矩阵」
 * 的两端镜像（独立编译域无法共享 import）。本检查提取两文件锚点
 * CAPABILITY-MATRIX-BEGIN/END 之间的文本，要求逐字一致，防两份镜像互相漂移。
 *
 * 另两条护栏：QuickFilterBar.tsx 必须 import 该矩阵（防重构回散装 hide props）；
 * 已知非 policy_fact 数据域页面必须声明 domain prop。
 *
 * 局限声明（评审 🟡6）：CI 无 DuckDB 原生模块与 parquet（CLAUDE.md §5），
 * 「域有哪些列」是手工常量——本检查只防前后端两份互相漂移，防不了与真实
 * parquet 列的漂移。真实漂移防线 = Phase 0/2 运行时测试 + 本地集成测试
 * + 字段注册表流程挂钩（ETL 列变更须同步本矩阵，CLAUDE.md §2）。
 */
function checkFilterCapabilityMirror() {
  info('检查能力矩阵两端一致（filter-dimension-capability 前后端镜像）...');

  const BEGIN = 'CAPABILITY-MATRIX-BEGIN';
  const END = 'CAPABILITY-MATRIX-END';
  const frontPath = path.join(ROOT_DIR, 'src/shared/config/filter-dimension-capability.ts');
  const backPath = path.join(ROOT_DIR, 'server/src/config/filter-dimension-capability.ts');

  function extractAnchored(p) {
    if (!fs.existsSync(p)) return null;
    const content = fs.readFileSync(p, 'utf-8');
    const begin = content.indexOf(BEGIN);
    const end = content.indexOf(END);
    if (begin === -1 || end === -1 || end <= begin) return null;
    return content.slice(begin, end);
  }

  const front = extractAnchored(frontPath);
  const back = extractAnchored(backPath);

  if (front === null || back === null) {
    error('能力矩阵文件缺失或锚点（CAPABILITY-MATRIX-BEGIN/END）不完整');
    console.log(`    前端: ${frontPath}`);
    console.log(`    后端: ${backPath}`);
    return false;
  }

  if (front !== back) {
    error('能力矩阵前后端镜像不一致（锚点区必须逐字相同）');
    const fl = front.split('\n');
    const bl = back.split('\n');
    for (let i = 0; i < Math.max(fl.length, bl.length); i++) {
      if (fl[i] !== bl[i]) {
        console.log(`    首个差异（锚点区第 ${i + 1} 行）:`);
        console.log(`      前端: ${(fl[i] ?? '<缺行>').trim()}`);
        console.log(`      后端: ${(bl[i] ?? '<缺行>').trim()}`);
        break;
      }
    }
    console.log('    修复：把改动同步到另一端镜像（两文件锚点区逐字一致）');
    return false;
  }

  // 护栏 2：QuickFilterBar 必须消费矩阵
  const qfb = fs.readFileSync(path.join(ROOT_DIR, 'src/shared/components/QuickFilterBar.tsx'), 'utf-8');
  if (!qfb.includes('FILTER_DIMENSION_CAPABILITY')) {
    error('QuickFilterBar.tsx 未 import FILTER_DIMENSION_CAPABILITY（禁止重构回散装 hide props）');
    return false;
  }

  // 护栏 3：已知非 policy_fact 域页面必须声明 domain
  // ⚠️ SpecialtyPage 是 /#/specialty?tab=cross-sell 的真实渲染入口（独立 CrossSellPage
  // 是从未挂载的死代码，PR #574 已删——Phase 0 的 hide props 曾误落其上，前车之鉴）。
  // 含动态 domain 的页面检查「domain=」声明存在即可（值由表达式按 tab 决定）。
  const DOMAIN_PAGES = [
    ['src/features/pages/SpecialtyPage.tsx', "'cross_sell_agg'"],
    ['src/features/renewal-tracker/RenewalTrackerPage.tsx', '"renewal_tracker"'],
  ];
  for (const [rel, marker] of DOMAIN_PAGES) {
    const pagePath = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(pagePath)) {
      // 守卫（#576 评审意见）：页面被删除/移动时给出明确指引而非 ENOENT 崩溃
      // （前车之鉴：本清单曾指向被 PR #574 删除的死代码 CrossSellPage.tsx）
      error(`${rel} 不存在——若页面被删除/移动，请同步更新本检查的 DOMAIN_PAGES 清单到新的渲染入口`);
      return false;
    }
    const content = fs.readFileSync(pagePath, 'utf-8');
    if (!(content.includes('domain=') && content.includes(marker))) {
      error(`${rel} 未声明 domain 含 ${marker}（该页数据域非 policy_fact，缺省会放出不可表达的 chip）`);
      return false;
    }
  }

  success('能力矩阵两端一致检查通过（镜像逐字一致 + QuickFilterBar 消费 + 域页面已声明）');
  return true;
}

/**
 * Bundle 路由开关合规检查
 *
 * 背景：项目支持 `VITE_ENABLE_BUNDLE_ROUTES=false` 的兼容部署（legacy 模式），
 * 后端会让 `/performance-bundle` 等聚合路由返回 503。任何调用 `usePerformanceBundle`
 * / `usePerformanceBundleApi` 等 bundle hook 的前端组件，必须显式遵守
 * `ENABLE_BUNDLE_ROUTES` 开关（通过 `enabled` 参数短路 + 渲染时 fallback / 隐藏），
 * 否则在 legacy 部署上会一直显示加载失败。
 *
 * 触发：codex review PR #477 line 190（FocusStrip 漏开关导致 legacy 模式 503 红卡）。
 *
 * 规则：任何 `src/` 下 `.ts/.tsx` 文件如果调用 `usePerformanceBundle(`，必须同时
 * 出现 `ENABLE_BUNDLE_ROUTES` 字符串（用于 import + enabled 引用）。
 */
function checkBundleRoutesGuard() {
  info('检查 Bundle 路由开关合规（usePerformanceBundle 调用方须遵守 ENABLE_BUNDLE_ROUTES）...');

  const scanDirs = ['src'].map((d) => path.join(ROOT_DIR, d));
  const violations = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        // 跳过 hook 本身（定义方）和测试文件
        if (full.endsWith('usePerformanceBundle.ts')) continue;
        if (full.includes('__tests__') || full.endsWith('.test.ts') || full.endsWith('.test.tsx')) continue;
        const callsBundle = /\busePerformanceBundle\s*\(/.test(content);
        if (!callsBundle) continue;
        const referencesGuard = /\bENABLE_BUNDLE_ROUTES\b/.test(content);
        if (!referencesGuard) {
          violations.push(path.relative(ROOT_DIR, full));
        }
      }
    }
  }

  for (const d of scanDirs) walk(d);

  if (violations.length > 0) {
    error(`Bundle 路由开关缺失 = ${violations.length} 处：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复：import { ENABLE_BUNDLE_ROUTES } from "@/shared/api/client";');
    console.log('    然后 usePerformanceBundle({ ..., enabled: <existing-condition> && ENABLE_BUNDLE_ROUTES })');
    console.log('    并在 render 阶段 if (!ENABLE_BUNDLE_ROUTES) 走 legacy fallback 或隐藏。');
    console.log('    依据：PR #477 codex review line 190；现有遵守者：PerformanceAnalysisPanel.tsx / PremiumDashboard.tsx');
    return false;
  }

  success('Bundle 路由开关合规检查通过（所有 usePerformanceBundle 调用方均遵守 ENABLE_BUNDLE_ROUTES）');
  return true;
}

function checkQueryCatalogConsistency() {
  info('检查 QueryCatalog 对账（实挂载 GET 端点 vs route-catalog 元数据）...');

  const queryDir = path.join(ROOT_DIR, 'server/src/routes/query');
  const metaFile = path.join(ROOT_DIR, 'server/src/config/query-routes-metadata.ts');
  // 豁免：仅本地调试/非对外发现路由
  const exempt = new Set(['/test']);

  const mounted = new Set();
  const scanFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        scanFiles.push(full);
      }
    }
  })(queryDir);
  for (const f of scanFiles) {
    // 剥离块注释与行注释，避免文档示例（如 shared.ts 的 router.get('/path', ...) 用法注释）误匹配
    const src = fs
      .readFileSync(f, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/router\.get\(\s*\n?\s*'(\/[^']+)'/g)) {
      if (!exempt.has(m[1])) mounted.add(m[1]);
    }
  }

  const metaSrc = fs.readFileSync(metaFile, 'utf-8');
  const catalog = new Set([...metaSrc.matchAll(/path:\s*'(\/[^']+)'/g)].map((m) => m[1]));

  const missingInCatalog = [...mounted].filter((p) => !catalog.has(p)).sort();
  const ghostInCatalog = [...catalog].filter((p) => !mounted.has(p)).sort();

  if (missingInCatalog.length > 0 || ghostInCatalog.length > 0) {
    if (missingInCatalog.length > 0) {
      error(`已挂载但未登记 route-catalog（CLI/MCP 不可发现）= ${missingInCatalog.length} 条：`);
      for (const p of missingInCatalog) console.log(`    - ${p}`);
    }
    if (ghostInCatalog.length > 0) {
      error(`catalog 登记了不存在的端点 = ${ghostInCatalog.length} 条：`);
      for (const p of ghostInCatalog) console.log(`    - ${p}`);
    }
    console.log('    修复：在 server/src/config/query-routes-metadata.ts 补/删对应 entry（RED LINE：只追加，删除走 BACKLOG）');
    return false;
  }

  // ── 三方对账：QUERY_ROUTES 常量 ↔ 实挂载端点（挂载 ↔ catalog 已在上方双向对账）──
  // 已知"常量先行、服务端未实现"豁免清单；实现挂载后必须从此清单移除（下方陈旧校验强制）
  const knownUnimplemented = new Set([
    // repair v2 八端点（BACKLOG 2026-06-10-claude-807f41）
    '/repair/channel', '/repair/city', '/repair/coop-tier', '/repair/diversion-list',
    '/repair/local-resource', '/repair/orphan-shops', '/repair/scatter', '/repair/to-premium',
  ]);
  const apiRoutesSrc = fs.readFileSync(path.join(ROOT_DIR, 'server/src/config/api-routes.ts'), 'utf-8');
  const qrStart = apiRoutesSrc.indexOf('export const QUERY_ROUTES');
  const braceStart = apiRoutesSrc.indexOf('{', qrStart);
  let depth = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < apiRoutesSrc.length; i++) {
    if (apiRoutesSrc[i] === '{') depth++;
    else if (apiRoutesSrc[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  const constants = new Set(
    [...apiRoutesSrc.slice(braceStart, braceEnd).matchAll(/'(\/[^']*)'/g)].map((m) => m[1])
  );

  // 参数化路由归一：挂载 '/patrol/:domain' 归一到基路径 '/patrol' 与常量对应
  const paramBase = (p) => (p.includes('/:') ? p.slice(0, p.indexOf('/:')) : p);
  const mountedBases = new Set([...mounted].map(paramBase));

  const constGhosts = [...constants]
    .filter((p) => !exempt.has(p) && !mounted.has(p) && !mountedBases.has(p) && !knownUnimplemented.has(p))
    .sort();
  const mountedOrphans = [...mounted]
    .filter((p) => !constants.has(p) && !constants.has(paramBase(p)))
    .sort();
  const staleExemptions = [...knownUnimplemented].filter((p) => mounted.has(p)).sort();

  if (constGhosts.length > 0 || mountedOrphans.length > 0 || staleExemptions.length > 0) {
    if (constGhosts.length > 0) {
      error(`QUERY_ROUTES 常量声明了未挂载的端点（前端/CLI 引用会 404）= ${constGhosts.length} 条：`);
      for (const p of constGhosts) console.log(`    - ${p}`);
      console.log('    修复：实现服务端路由，或暂未实现则登记 BACKLOG 后加入本检查的 knownUnimplemented 豁免');
    }
    if (mountedOrphans.length > 0) {
      error(`已挂载端点缺少 QUERY_ROUTES 常量（前端无法类型安全引用）= ${mountedOrphans.length} 条：`);
      for (const p of mountedOrphans) console.log(`    - ${p}`);
      console.log('    修复：在 server/src/config/api-routes.ts 补常量（前端镜像 src/shared/api/routes.ts 同步）');
    }
    if (staleExemptions.length > 0) {
      error(`knownUnimplemented 豁免已陈旧（端点已实现挂载）= ${staleExemptions.length} 条：`);
      for (const p of staleExemptions) console.log(`    - ${p}`);
      console.log('    修复：从 checkQueryCatalogConsistency 的 knownUnimplemented 清单移除');
    }
    return false;
  }

  // 参数级对账由「RouteCatalog参数契约」检查接管（per-route 强对账，
  // 见 scripts/route-catalog/validate-params.ts）。曾在此处的全局搜索域
  // 幽灵检测因 snake/camel 变体宽容会掩盖真实命名漂移，已被取代删除。
  success(`QueryCatalog 对账通过（${mounted.size} 个挂载端点 ↔ catalog ↔ QUERY_ROUTES 常量三方一致）`);
  return true;
}

function checkRouteCatalogParamContracts() {
  info('检查 RouteCatalog 参数契约（catalog 登记参数 ⊆ 运行时 zod/解析代码真实参数，per-route）...');
  try {
    const out = execFileSync('bun', ['scripts/route-catalog/validate-params.ts'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    success(out.trim().replace(/^✓\s*/, ''));
    return true;
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    const stdout = err.stdout?.toString() ?? '';
    error('RouteCatalog 参数契约对账失败：');
    for (const line of (stderr + stdout).split('\n').filter(Boolean)) console.log(`  ${line}`);
    console.log('    修复：对齐 query-routes-metadata.ts 与 route-param-contracts.ts（参数名以运行时 schema 为准）');
    console.log('    前置：server 依赖已安装（bun install --cwd server）');
    return false;
  }
}

// ============================================================
// Agent 注册表版本可追溯（harness 对标门槛 3，BACKLOG 2026-06-11-claude-f5646f）
// ============================================================

const AGENT_REGISTRY_FILES = [
  'server/src/agent/registry/agent-metric-registry.ts',
  'server/src/agent/registry/agent-data-capability-registry.ts',
  'server/src/agent/registry/agent-forecast-output-registry.ts',
  'server/src/agent/registry/unsupported-metric-registry.ts',
];

function checkAgentRegistryVersionBump() {
  info('检查 Agent 注册表版本可追溯（注册表文件变更必须 bump 表级 version + 追加 changelog）...');

  // 与 PR 体量门禁同模式：origin/main 不可用（CI 浅克隆 / 离线）时降级跳过，
  // 主执行点是本地 pre-push（CLAUDE.md §8 要求 PR 前 fetch origin main）。
  let mergeBase;
  try {
    mergeBase = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    warning('origin/main 不可用（浅克隆或离线），跳过 Agent 注册表版本检查');
    return true;
  }

  const violations = [];
  for (const file of AGENT_REGISTRY_FILES) {
    let diff;
    try {
      // working tree vs merge-base：同时覆盖已提交与未提交的变更
      diff = execFileSync('git', ['diff', mergeBase, '--', file], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      continue;
    }
    if (!diff) continue;

    const addedLines = diff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    // meta.version bump 或 changelog 追加必然产生含 version 字段的新增行；
    // Zod refine 已在运行时强制 meta.version === changelog 末条 version，两者闭环。
    const versionTouched = addedLines.some((line) => /version:\s*['"]/.test(line));
    if (!versionTouched) {
      violations.push(file);
    }
  }

  if (violations.length === 0) {
    success('Agent 注册表版本检查通过');
    return true;
  }

  error('以下 Agent 注册表文件有变更但未更新表级 version/changelog：');
  for (const file of violations) {
    console.log(`    - ${file}`);
  }
  console.log('    修复：bump 该文件 registryMeta 的 version 并在 changelog 追加一条 { version, date, changes }');
  console.log('    背景：harness 对标门槛 3 —— 释放大模型后能力边界变更必须可在产物层追溯');
  return false;
}

// ============================================================
// 主函数
// ============================================================

// 数据/运维状态校验：随「数据更新」而变红，与代码无关。
// 已从代码门禁解耦，搬到数据发布流程（scripts/check-data-readiness.mjs，
// 由 release:daily / sync-and-reload.mjs 在 ETL 后、发布前执行）。
// 在 PR/push 的代码门禁里跑这些项没有意义——CI 无 Parquet 数据时它们本就 skip，
// 只会绊住本地开发者。详见 BACKLOG 数据状态/代码分离条目。
// pre-sync 检查：sync-vps 之前跑（数据内在质量，本地可独立验证）
export const PRE_SYNC_READINESS_CHECKS = [
  { name: 'Parquet重叠', fn: checkParquetOverlapInCurrent },
  { name: 'Claims去重', fn: checkClaimsDetailDeduplication },
  { name: '知识库一致性', fn: checkKnowledgeDataConsistency },
];

// post-sync 检查：sync-vps 之后跑（本地 vs VPS 清单一致性，ETL 后必然先漂移再同步）
export const POST_SYNC_READINESS_CHECKS = [
  { name: '数据漂移检测', fn: checkDataDrift },
];

// 保留旧名以兼容现有调用方（=pre+post 全集，单独跑时仍是 4 项全过才通过）
export const DATA_READINESS_CHECKS = [
  ...PRE_SYNC_READINESS_CHECKS,
  ...POST_SYNC_READINESS_CHECKS,
];

/**
 * 立方体影子对账数值容差红线（AI agent 容易把容差放宽来"消除 mismatch"，但
 * 1e-9 已是 DuckDB 浮点求和顺序差异的物理下限；放宽 = 把真实口径漂移当噪音忽略）。
 * 任何 AI agent 试图改 cube-shadow.ts 的 NUMERIC_TOLERANCE 会被本检查阻断。
 *
 * 真正的口径 mismatch 应该改改写器 / 白名单 / 集成测试，不应该放宽容差。
 */
function checkCubeShadowTolerance() {
  info('检查立方体影子对账容差红线...');
  const filePath = path.join(ROOT_DIR, 'server/src/services/cube-shadow.ts');
  if (!fs.existsSync(filePath)) {
    warning('cube-shadow.ts 不存在，跳过（立方体未启用）');
    return true;
  }
  const src = fs.readFileSync(filePath, 'utf-8');
  // 期望恰好一处 `const NUMERIC_TOLERANCE = 1e-9`
  const match = src.match(/const\s+NUMERIC_TOLERANCE\s*=\s*([^\s;]+)/);
  if (!match) {
    error('cube-shadow.ts 缺少 NUMERIC_TOLERANCE 常量定义');
    return false;
  }
  if (match[1] !== '1e-9') {
    error(`cube-shadow.ts 的 NUMERIC_TOLERANCE 被改为 ${match[1]}，不可放宽（1e-9 已是 DuckDB 浮点求和顺序差异的物理下限）`);
    error('  正确做法：mismatch 出现时改 sql/cube/<route>-cube.ts 改写器 / 白名单 / 补集成测试，不是改容差');
    return false;
  }
  success('容差为 1e-9（红线保持）');
  return true;
}

/**
 * RLS（行级安全）整域绕过防回归（BACKLOG 2026-06-11-claude-942414 / P0）
 *
 * 历史教训：customer-flow / quote-conversion / claims-detail / repair 四域的
 * 路由 handler 长期不消费 req.permissionFilter（且对应 SQL 生成器签名也未预留
 * whereClause 入参），非超管账号可越权读全量。本检查防止同类漏洞再次溜进 main。
 *
 * 判定：server/src/routes/query/*.ts 中每个路由文件必须二选一：
 *   (A) 消费 req.permissionFilter（直接 grep，或经 parseFiltersAndBuildWhere /
 *       parseFiltersAndBuildBothWhere 间接消费），或
 *   (B) 用 requireBranchAdmin 兜底（路由级 admin-only 闸）
 *
 * 豁免清单（EXEMPT）：不查业务 SQL 的路由或纯分发器（未来如有新豁免，必须在此显式登记）。
 */
function checkRlsRouteCoverage() {
  info('检查 RLS 整域绕过防回归（BACKLOG 942414）...');
  const ROUTE_DIR = path.join(ROOT_DIR, 'server/src/routes/query');
  if (!fs.existsSync(ROUTE_DIR)) {
    warning('server/src/routes/query 不存在，跳过');
    return true;
  }
  const EXEMPT = new Set([
    'shared.ts',     // 公共模块，非路由
    'bundles.ts',    // 仅 router.use 子路由分发，无业务端点
    'patrol.ts',     // 只读巡检 JSON 文件，无 SQL 查询
  ]);
  const PERMISSION_CONSUMER_PATTERN =
    /\b(parseFiltersAndBuildWhere|parseFiltersAndBuildBothWhere|requireBranchAdmin|req\.permissionFilter|injectPermissionIntoAnySql)\b/;

  const offenders = [];
  const entries = fs.readdirSync(ROUTE_DIR);
  for (const name of entries) {
    if (EXEMPT.has(name)) continue;
    if (!name.endsWith('.ts')) continue;
    const filePath = path.join(ROUTE_DIR, name);
    if (!fs.statSync(filePath).isFile()) continue;
    const src = fs.readFileSync(filePath, 'utf-8');
    if (!PERMISSION_CONSUMER_PATTERN.test(src)) {
      offenders.push(name);
    }
  }

  if (offenders.length > 0) {
    error('RLS 整域绕过防回归失败：以下路由既未消费 req.permissionFilter，也未用 requireBranchAdmin 兜底');
    for (const f of offenders) {
      error(`  - server/src/routes/query/${f}`);
    }
    error('  修复路径：');
    error('    (A) 路由 handler 调 parseFiltersAndBuildWhere(req) 取 whereClause 传给 SQL 生成器；');
    error('    (B) SQL 生成器签名不接 whereClause 时，router.use(requireBranchAdmin) 兜底 admin-only；');
    error('    (C) 路由不查业务 SQL（如纯文件 IO）需在 scripts/check-governance.mjs:checkRlsRouteCoverage EXEMPT 显式登记。');
    return false;
  }
  success(`所有 ${entries.filter(n => n.endsWith('.ts') && !EXEMPT.has(n)).length} 个路由文件均消费 permissionFilter 或 requireBranchAdmin 兜底`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 33: cube shadow route coverage
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 防漏注册 cube shadow key。
 *
 * 5 路由（trend/growth/cost/kpi/salesman-ranking）各自在 handler 里调
 * runShadowCompare('<key>', ...)，shadow key 需与路由业务一一对应。
 * 新增 cube 路由时只改 scripts/shared/cube-routes.mjs（SSOT），本 check 自动跟上。
 */
function checkCubeShadowRouteCoverage() {
  info('检查立方体影子路由覆盖（shadow key 白名单）...');
  const EXPECTED_SHADOW_KEYS = new Set(SHADOW_KEYS);
  const ROUTE_DIR = path.join(ROOT_DIR, 'server/src/routes/query');
  const EXEMPT = new Set(['shared.ts', 'bundles.ts', 'patrol.ts']);

  if (!fs.existsSync(ROUTE_DIR)) {
    warning('server/src/routes/query 不存在，跳过');
    return true;
  }

  const foundKeys = new Set();
  const KEY_RE = /\brunShadowCompare\(\s*['"]([^'"]+)['"]/g;

  for (const name of fs.readdirSync(ROUTE_DIR)) {
    if (EXEMPT.has(name)) continue;
    if (!name.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(ROUTE_DIR, name), 'utf-8');
    KEY_RE.lastIndex = 0;
    let m;
    while ((m = KEY_RE.exec(src)) !== null) {
      foundKeys.add(m[1]);
    }
  }

  const missing = [...EXPECTED_SHADOW_KEYS].filter(k => !foundKeys.has(k));
  const extra   = [...foundKeys].filter(k => !EXPECTED_SHADOW_KEYS.has(k));

  if (missing.length > 0 || extra.length > 0) {
    error('立方体影子路由覆盖失败：');
    if (missing.length > 0) {
      error(`  缺漏 key（路由 handler 未调 runShadowCompare）：${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      error(`  多余 key（新增 cube 路由未登记到白名单）：${extra.join(', ')}`);
      error('  如新增 cube 路由：');
      error('    1) 路由 handler 调 runShadowCompare(\'<key>\', ...) ');
      error('    2) 同步更新 scripts/shared/cube-routes.mjs（SSOT，本 check + burn-in 共用）');
    }
    return false;
  }
  success(`立方体影子路由覆盖完整（${[...foundKeys].join(', ')}）`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 34: cube SQL three-piece shape
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 防主 cube SQL 三件套漏导出。
 *
 * 每个主 cube 必须导出三件套：
 *   isXxxCubeServable     — servability gate，防直接查空表/缺数据触发误对账
 *   generateXxxCubeQuery  — 三阶段查询构建（注：salesman 命名为 generateSalesmanRankingCubeQuery）
 *   buildXxxCubeSql       — 物化 SQL 生成，防 OOM 死循环
 *
 * growth/kpi 复用 trend/cost cube，不在 MAIN_CUBES 列表中。
 */
/**
 * 剥离 JS/TS 注释，防止注释掉的导出误触发 export 正则检测。
 * 先去块注释（非贪婪），再去行注释。
 */
function stripComments(src) {
  // 去块注释 /* ... */（非贪婪，防止跨越多个注释块）
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 去行注释 //...（锚定行首可选空白，确保不误删字符串内 //）
  s = s.replace(/^\s*\/\/.*$/gm, '');
  return s;
}

function checkCubeSqlThreePieceShape() {
  info('检查主 cube SQL 三件套导出...');

  // 每个 cube 期望的三件套导出函数名（以实际源文件为准）
  // key 与 Check 33 EXPECTED_SHADOW_KEYS 对齐：salesman-ranking（非 salesman）
  // key='salesman-ranking' 对应文件 server/src/sql/cube/salesman-cube.ts
  // 新增 cube 时同步更新本表 + Check 33 EXPECTED_SHADOW_KEYS + Check 35 CUBE_STATE_NAMES
  const CUBE_REQUIRED_EXPORTS = {
    trend:              ['isTrendCubeServable',    'generatePremiumTrendCubeQuery', 'buildTrendCubeSql'],
    cost:               ['isCostCubeServable',     'generateCostCubeQuery',         'buildCostCubeSql'],
    // salesman 文件名为 salesman-cube.ts，但导出函数命名为 generateSalesmanRankingCubeQuery
    'salesman-ranking': ['isSalesmanCubeServable', 'generateSalesmanRankingCubeQuery', 'buildSalesmanCubeSql'],
  };

  // cube 文件名映射（key → 实际文件名，默认 `${key}-cube.ts`，salesman-ranking 特殊）
  const CUBE_FILE_NAME = {
    'salesman-ranking': 'salesman',
  };

  const CUBE_SQL_DIR = path.join(ROOT_DIR, 'server/src/sql/cube');
  let allOk = true;

  for (const [cube, required] of Object.entries(CUBE_REQUIRED_EXPORTS)) {
    const fileName = CUBE_FILE_NAME[cube] ?? cube;
    const filePath = path.join(CUBE_SQL_DIR, `${fileName}-cube.ts`);
    if (!fs.existsSync(filePath)) {
      error(`主 cube 文件缺失：server/src/sql/cube/${fileName}-cube.ts`);
      allOk = false;
      continue;
    }
    const rawSrc = fs.readFileSync(filePath, 'utf-8');
    // 剥离注释后再检测，防止 `// export function X()` 误判为存在导出
    const src = stripComments(rawSrc);
    const missing = required.filter(fn => {
      // 匹配 export [async] function <name>  或  export const <name>
      const re = new RegExp(`\\bexport\\b[\\s\\S]{0,20}\\b${fn}\\b`);
      return !re.test(src);
    });
    if (missing.length > 0) {
      error(`${fileName}-cube.ts 缺漏导出：${missing.join(', ')}`);
      error('  三件套约束：servability gate 防误对账；buildXxxCubeSql 防 OOM 死循环；generateXxxCubeQuery 三阶段构建');
      allOk = false;
    }
  }

  if (allOk) {
    success('所有主 cube SQL 三件套导出完整（isCubeServable + generateQuery + buildSql）');
  }
  return allOk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 35: cube version binding
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 防 PR #645 同类回归：builtVersion 赋值必须绑 versionAtStart，不能用 catch 时
 * 重新调 getDataVersion()（ETL 推进会污染状态，导致过期 cube 被标为最新）。
 *
 * 合法右值：
 *   - versionAtStart（构建起始版本）
 *   - null（reset 路径）
 * 非法右值：直接调用 getDataVersion() 或 currentVersion 等动态值
 */
function checkCubeVersionBinding() {
  info('检查立方体 builtVersion 绑定合规（防 PR #645 回归）...');
  const CUBE_SVC = path.join(ROOT_DIR, 'server/src/services/duckdb-cube.ts');
  if (!fs.existsSync(CUBE_SVC)) {
    warning('server/src/services/duckdb-cube.ts 不存在，跳过');
    return true;
  }

  const src = fs.readFileSync(CUBE_SVC, 'utf-8');
  const lines = src.split('\n');

  // 新增立方体 state 变量时必须同步将其名称追加到 CUBE_STATE_NAMES
  // （与 Check 33 的 EXPECTED_SHADOW_KEYS、Check 34 的 CUBE_REQUIRED_EXPORTS 三处保持隐式同步）
  const CUBE_STATE_NAMES = ['trendCubeState', 'costCubeState', 'salesmanCubeState'];

  // 提取所有 .builtVersion = <rhs>; 赋值行（单等号，排除 === / !== 比较）
  // 负向前瞻确保 = 后不紧跟另一个 =
  const ASSIGN_RE = new RegExp(
    `\\b(${CUBE_STATE_NAMES.join('|')})\\.builtVersion\\s*=(?!=)\\s*([^;]+);`,
    'g'
  );

  // allowlist 策略：右值只允许 'versionAtStart'（标准绑定）或 'null'（reset）
  // 不再用 denylist——间接变量（freshVersion）/ fallback（versionAtStart || x）
  // / 任何未知右值均为非法，PR #645 等价违规无法再静默通过

  const violations = [];
  let m;
  ASSIGN_RE.lastIndex = 0;
  while ((m = ASSIGN_RE.exec(src)) !== null) {
    const rhs = m[2].trim().replace(/;$/, '').trim();
    // 合法：null（reset）或 versionAtStart（标准绑定）
    if (rhs === 'null' || rhs === 'versionAtStart') continue;
    // 其余一律非法
    const pos = m.index;
    const lineNo = src.slice(0, pos).split('\n').length;
    violations.push({ line: lineNo, text: lines[lineNo - 1].trim(), rhs });
  }

  if (violations.length > 0) {
    error('builtVersion 绑定违规（PR #645 历史教训：ETL 推进期间用动态值赋值会污染 cube 状态）：');
    for (const v of violations) {
      error(`  L${v.line}: ${v.text}  （右值：${v.rhs}）`);
    }
    error('  修复路径：OOM 降级须在 materializeXxxCube 函数体内取 versionAtStart 后绑定（PR #645 教训）');
    error('  禁止间接变量（const x = getDataVersion(); builtVersion = x）/ fallback（versionAtStart || y）/ 直接调用');
    return false;
  }

  success('所有 builtVersion 赋值均绑定 versionAtStart 或 null（合规）');
  return true;
}

/**
 * 防 5 路由清单 SSOT 漂移（PR #653 漏改 cube-promote-judge.mjs 教训）。
 *
 * scripts/shared/cube-routes.mjs 是 5 路由清单的唯一事实源。其他文件不得 inline
 * 重复定义 5 路由字面量数组（含顺序），
 * 必须从 SSOT import SHADOW_KEYS。
 *
 * 历史：evidence-verifier 在 PR #653 后查到 scripts/release/lib/cube-promote-judge.mjs:28
 * 仍有 inline SHADOW_ROUTES 定义（PR #648 lib 产物，#653 漏改），独立维护同样清单。
 */
function checkCubeRoutesSSOT() {
  info('检查 5 路由清单 SSOT 漂移防回归（PR #653 教训）...');
  const SSOT_FILE = 'scripts/shared/cube-routes.mjs';
  // 限定数组字面量：必须 `[` 开头才报（防止注释里的提示文字误命中）
  const FORBIDDEN_RE = /\[\s*['"]trend['"]\s*,\s*['"]growth['"]\s*,\s*['"]cost['"]\s*,\s*['"]kpi['"]\s*,\s*['"]salesman-ranking['"]\s*\]/;
  const SCAN_DIRS = ['scripts', 'server/src'];
  const offenders = [];

  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(fullDir)) continue;
    walkDir(fullDir, (filePath) => {
      const rel = path.relative(ROOT_DIR, filePath);
      if (rel === SSOT_FILE) return;
      if (!/\.(mjs|js|ts)$/.test(rel)) return;
      if (rel.includes('__tests__') || rel.includes('node_modules')) return;
      const src = fs.readFileSync(filePath, 'utf-8');
      if (FORBIDDEN_RE.test(src)) {
        offenders.push(rel);
      }
    });
  }

  if (offenders.length > 0) {
    error('5 路由清单 SSOT 漂移失败：以下文件 inline 定义了 5 路由字面量');
    for (const f of offenders) error(`  - ${f}`);
    error('  修复路径：');
    error(`    1) 从 ${SSOT_FILE} import { SHADOW_KEYS } 或 { CUBE_ROUTES }`);
    error('    2) 不要 inline 重复 5 路由字面量数组');
    return false;
  }
  success(`5 路由清单仅在 SSOT 定义（${SSOT_FILE}），其他文件均 import 派生`);
  return true;
}

/**
 * 检查 .claude/shared-memory/ user-only 红线（AGENTS.md §8.3）
 *
 * 背景：`.claude/shared-memory/**` 与 `~/.claude/shared-memory/chexian/**` 是 user-only 路径，
 * AI 仅可只读引用、不得写入（含新增/修改/删除/重命名——AGENTS.md §8.3 "AI 不得修改"含义为全写操作）。
 * 规则历史：2026-04-27 commit 801f84e7 用分层 policy 替代扁平禁改名单后正式生效。但纯文档化无自动闸，
 * 2026-06-10 两个 AI commit（b3e14e1c / f8866baf）违规写入，2026-06-17 PR #662 第 3 次复发。
 * 本检查把红线机制化为 governance 闸。
 *
 * 扫描范围（PR #664 review 修正：原版仅扫 staged + working tree → CI/pre-push clean checkout 漏 commit range）：
 *   1. staged (`git diff --cached --name-status`)
 *   2. 工作区 unstaged (`git diff --name-status`)
 *   3. 未跟踪 (`git ls-files --others --exclude-standard`)
 *   4. 已 commit 但未推到 main 的 range (`git diff --name-status origin/main...HEAD`) — CI/pre-push 关键
 *
 * 行为：
 *   - 检出任何 A/M/D/?? 的 `.claude/shared-memory/**` 变更 → error, exit 1
 *     （D 删除不再有"治理清理"例外——避免 AI 自我授权后门；本规则文件 §4 仅记述 user 已亲自执行的清理）
 *   - 环境变量 SHARED_MEMORY_USER_WRITE=1 → user 显式授权绕过（命名带 USER_WRITE 自我提示，AI 禁用）
 *
 * 详见 .claude/rules/shared-memory-discipline.md
 */
function checkSharedMemoryUserOnly() {
  info('检查 .claude/shared-memory/ user-only 红线（AGENTS.md §8.3）...');

  const TARGET_PREFIX = '.claude/shared-memory/';
  const collected = new Map(); // path -> status

  const collect = (cmd, defaultStatus) => {
    try {
      const out = execSync(cmd, {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return;
      for (const line of out.split('\n')) {
        if (!line) continue;
        if (defaultStatus) {
          // git ls-files --others：仅文件名，状态固定
          if (line.startsWith(TARGET_PREFIX)) collected.set(line, defaultStatus);
        } else {
          // git diff --name-status：tab 分隔，最后一列是 file path（重命名时是 dst）
          const parts = line.split('\t');
          const status = parts[0];
          const target = parts[parts.length - 1];
          if (target && target.startsWith(TARGET_PREFIX)) {
            // 已有 A/M 记录的不被后续 D 覆盖（保留更严重的状态）
            const prev = collected.get(target);
            if (!prev || (prev === 'D' && status !== 'D')) collected.set(target, status);
          }
        }
      }
    } catch {
      // 命令失败（如 origin/main 不存在）静默
    }
  };

  collect('git diff --cached --name-status', null);
  collect('git diff --name-status', null);
  collect('git ls-files --others --exclude-standard', '??');
  // PR #664 review 修正：CI/pre-push 在 clean checkout 跑时，已 commit 的改动不出现在 staged/working tree。
  // 扫 origin/main...HEAD 闭合该口子；origin/main 不存在时 try/catch 静默跳过（首次 push / 早期初始化场景）。
  collect('git diff --name-status origin/main...HEAD', null);

  if (collected.size === 0) {
    success('未检出对 .claude/shared-memory/ 的写入（user-only 红线已守护）');
    return true;
  }

  if (process.env.SHARED_MEMORY_USER_WRITE) {
    warning(
      `.claude/shared-memory/ 检出 ${collected.size} 个变更——已通过 SHARED_MEMORY_USER_WRITE 显式豁免（user 手动操作授权）`
    );
    collected.forEach((s, p) => warning(`    ${s}  ${p}`));
    return true;
  }

  error('.claude/shared-memory/** 是 user-only 路径（AGENTS.md §8.3 红线）');
  error('  AI 不得对该路径执行任何写操作——新增/修改/删除/重命名全部禁止；仅 user 手动 sync/编辑');
  error('  本次检出变更：');
  collected.forEach((s, p) => error(`    ${s}  ${p}`));
  error('');
  error('  备选路径建议（按内容类型）：');
  error('    教训/复盘/scorecard       → .claude/workflow/pr-evolution.md（append-only entry）');
  error('    跨项目可复用知识 / skill  → ~/.claude/skills/（共享 skills 仓 alongor666-skills）');
  error('    项目级 skill            → .claude/skills/');
  error('    本项目 rule（新增护栏） → .claude/rules/（append-only）');
  error('');
  error('  user 本人手动操作授权绕过：SHARED_MEMORY_USER_WRITE=1 bun run governance');
  error('  违规历史与本红线详情见 .claude/rules/shared-memory-discipline.md');
  return false;
}

function walkDir(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full, cb);
    else if (stat.isFile()) cb(full);
  }
}

// 代码治理校验：随「代码变更」而变红，是代码门禁（pre-push + CI）的职责。
const CODE_GOVERNANCE_CHECKS = [
  { name: '必需文件', fn: checkRequiredFiles },
  { name: '核心层索引', fn: checkCoreLayerIndices },
  { name: 'BACKLOG证据链', fn: checkBacklogEvidence },
  { name: 'CLAUDE章节', fn: checkClaudeMdSections },
  { name: 'DC-002合规', fn: checkDC002Compliance },
  { name: 'BACKLOG事件日志', fn: checkBacklogLog },
  { name: 'Conflict标记', fn: checkMergeConflictMarkers },
  { name: '调试产物', fn: checkStagedDebugArtifacts },
  { name: '热点文件契约', fn: checkHotfileContractCoverage },
  { name: 'ApiClient守恒', fn: checkApiWireConservation },
  { name: 'TS检查范围', fn: checkTsconfigTypecheckScope },
  { name: '锁文件策略', fn: checkPackageManagerLockPolicy },
  { name: '凭据扫描', fn: checkStagedCredentials },
  { name: 'PR体量门禁', fn: checkPrSizeLimit },
  { name: 'gitignore审计', fn: checkGitignoreShadow },
  { name: '字段定义一致', fn: checkFieldDefinitionConsistency },
  { name: 'DarkMode质量', fn: checkDarkModeQuality },
  { name: 'ECharts网格线', fn: checkEchartsSplitLine },
  { name: 'sync-vps覆盖', fn: checkSyncVpsCoverage },
  { name: 'SQL模块数一致', fn: checkSqlModuleCountConsistency },
  { name: 'CLAUDE.md预算', fn: checkClaudeMdBudget },
  { name: 'rules eager-load 预算', fn: checkRulesEagerLoadBudget },
  { name: 'CLAUDE.md计数防漂移', fn: checkClaudeMdNoStaleCounts },
  { name: 'ETL多sheet规范', fn: checkEtlMultiSheetCompliance },
  { name: 'state-db依赖隔离', fn: checkStateDbDependencyIsolation },
  { name: '空catch禁令', fn: checkEmptyCatchBlocks },
  { name: '筛选参数绕过', fn: checkFilterParamsBypass },
  { name: '能力矩阵镜像', fn: checkFilterCapabilityMirror },
  { name: 'Bundle路由开关合规', fn: checkBundleRoutesGuard },
  { name: 'QueryCatalog对账', fn: checkQueryCatalogConsistency },
  { name: 'RouteCatalog参数契约', fn: checkRouteCatalogParamContracts },
  { name: 'Agent注册表版本', fn: checkAgentRegistryVersionBump },
  { name: '立方体影子对账容差', fn: checkCubeShadowTolerance },
  { name: 'RLS路由消费覆盖', fn: checkRlsRouteCoverage },
  { name: '5路由清单SSOT', fn: checkCubeRoutesSSOT },
  { name: '立方体影子路由覆盖', fn: checkCubeShadowRouteCoverage },
  { name: '立方体SQL三件套', fn: checkCubeSqlThreePieceShape },
  { name: '立方体版本绑定', fn: checkCubeVersionBinding },
  { name: 'shared-memory user-only', fn: checkSharedMemoryUserOnly },
  { name: 'evidence-loop SSOT 漂移', fn: checkEvidenceLoopSsotDrift },
  { name: 'pr-evolution needs_automation expires 闸', fn: checkPrEvolutionExpired },
  { name: '.github/workflows YAML 语法', fn: checkWorkflowYamlSyntax },
];

// ============================================================
// evidence-loop 三处 SSOT 漂移检测（防 PR #662 复发）
// ============================================================

/**
 * PR #662 复盘：scorecard 落位规则同时写在 wrapper / pr-checklist 两处。
 * 24h 内即可漂移（实际就触发了违规）。本检查强制两处都明文提到
 * `.claude/workflow/pr-evolution.md` 作落位 + 都禁止 `.claude/shared-memory/**`。
 *
 * 注：原设计含 `.claude/rules/evidence-loop.md`（三处），但该文件按 AGENTS.md §8.2 既有 rules 改动需 [policy-override]；
 * PR #668 评审 (codex) 反馈撤回 rule 改动，governance 只验 wrapper + pr-checklist 两处。
 * 既有 rule 文件本身的 scorecard 段（line 32 现状）由 AGENTS §8 frozen 规则保护，不需 governance 重复检测。
 */
function checkEvidenceLoopSsotDrift() {
  info('检查 evidence-loop SSOT 两处同步（PR #662 教训）...');

  const files = [
    '.claude/commands/chexian-evidence-loop.md',
    '.claude/pr-checklist.md',
  ];
  const keywords = [
    { re: /\.claude\/workflow\/pr-evolution\.md/, desc: 'scorecard 落位指向 pr-evolution.md' },
    { re: /\.claude\/shared-memory/, desc: 'shared-memory 禁止提醒' },
  ];

  const missing = [];
  for (const file of files) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      missing.push(`${file}（文件不存在）`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const kw of keywords) {
      if (!kw.re.test(content)) {
        missing.push(`${file} 缺 "${kw.desc}"`);
      }
    }
  }

  if (missing.length === 0) {
    success('evidence-loop SSOT 两处同步（wrapper/pr-checklist）');
    return true;
  }
  error('evidence-loop SSOT 漂移：');
  missing.forEach((m) => console.log(`    - ${m}`));
  error('  修复：让两处（wrapper / pr-checklist）都提到 `.claude/workflow/pr-evolution.md` 作落位 + 都明文禁止 `.claude/shared-memory/`');
  return false;
}

// ============================================================
// pr-evolution 沉淀超期未机制化警告（防 24h 漂移）
// ============================================================

/**
 * PR #662 复盘：2026-06-16 entry 已写"预防：pr-evolution.md 作 scorecard 落位"，
 * 24h 后仍踩。说明纯文档沉淀不够，规则必须有 expire 机制 + governance 强制升级。
 *
 * 约定 schema：entry 内含 `needs_automation: true` 即声明该项需机制化；必须紧跟一行 `expires: YYYY-MM-DD`。
 * 校验（2026-06-20 校准——R4/R5 实测漏 expires 致改进项静默掉缝，印证"规则需代码兜底"）：
 *   ① 本次新增的 needs_automation 缺 expires → error（硬闸，强制填截止日，杜绝静默漏）；
 *   ② main 存量缺 expires → warning（grandfather，surfaced 供清理）；
 *   ③ 有 expires 但已过期未机制化 → warning（让用户判断）。
 */
// ============================================================
// .github/workflows YAML 语法验证（防 PR #669 hotfix 复发）
// ============================================================

/**
 * PR #669 hotfix 教训：sync-cx-cli.yml 用 `git commit -m "<多行字符串>"`，第二行起
 * 没有缩进 → YAML block scalar 提前终止 → 解析报 "could not find expected ':'"
 * → GitHub Actions UI 报 "workflow file issue" → 3 次 push 触发全部 failure。
 * 本地 governance / pre-push 都不验 YAML 语法，governance 缺这一项。
 *
 * 用 python3 yaml 解析（macOS / ubuntu CI runner 都默认带）。
 */
function checkWorkflowYamlSyntax() {
  info('检查 .github/workflows/*.yml 语法（PR #669 教训）...');

  const workflowsDir = path.join(ROOT_DIR, '.github/workflows');
  if (!fs.existsSync(workflowsDir)) {
    success('.github/workflows 不存在，跳过');
    return true;
  }
  const files = fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) {
    success('.github/workflows 无 YAML 文件，跳过');
    return true;
  }

  const broken = [];
  for (const file of files) {
    const filePath = path.join(workflowsDir, file);
    try {
      execFileSync('python3', [
        '-c',
        `import yaml,sys
try:
    yaml.safe_load(open('${filePath}'))
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)`,
      ], { stdio: 'pipe' });
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim().split('\n')[0];
      broken.push(`${file}: ${stderr}`);
    }
  }

  if (broken.length === 0) {
    success(`.github/workflows YAML 语法全部 OK（${files.length} 个文件）`);
    return true;
  }
  error('.github/workflows YAML 语法错误：');
  broken.forEach((b) => console.log(`    - ${b}`));
  error('  修复：用 `python3 -c "import yaml; yaml.safe_load(open(...))"` 本地验证；');
  error('  多行 commit 用 `-m "line1" -m "line2"` 多次 -m 替代 YAML block scalar 缩进陷阱');
  return false;
}

function checkPrEvolutionExpired() {
  info('检查 pr-evolution.md needs_automation 的 expires 字段（PR #662 + 2026-06-20 expires 静默漏校准）...');

  const filePath = path.join(ROOT_DIR, '.claude/workflow/pr-evolution.md');
  if (!fs.existsSync(filePath)) {
    warning('pr-evolution.md 不存在，跳过');
    return true;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const today = new Date().toISOString().slice(0, 10);

  // 本次变更新增的行（committed range ∪ 工作树），用于区分"缺 expires"是本 PR 新引入（→ error）
  // 还是 main 存量（→ warning grandfather）。两条 git diff 都失败（无 git / origin/main 不可用，
  // 如 CI 浅克隆）→ addedLines=null → 无法判定新旧 → 缺 expires 一律降级为 warning，不硬 fail。
  const collectAdded = (cmd) => {
    try {
      const diff = execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return diff.split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
        .map((l) => l.slice(1).trim())
        .filter(Boolean);
    } catch {
      return null;
    }
  };
  const committed = collectAdded('git diff origin/main...HEAD -- .claude/workflow/pr-evolution.md');
  const working = collectAdded('git diff HEAD -- .claude/workflow/pr-evolution.md');
  const addedLines = (committed === null && working === null)
    ? null
    : new Set([...(committed || []), ...(working || [])]);

  let currentEntry = '(unknown entry)';
  // 「本次新增」按**所属 entry 标题是否新增**判定，而非按 needs_automation 行内容。
  // 根因（2026-06-21 hygiene PR 实测）：`needs_automation: true` 是 boilerplate，多条 entry 文本全同；
  // 旧版 `addedLines.has(line.trim())` 用行内容判新旧 → 新 PR 一旦 append 同款 plain 行，会与存量同款行
  // 碰撞，把存量条目误判为「本次新增」→ 误报硬 fail。entry 标题含日期+标题近乎唯一，按标题判更健壮。
  let currentEntryIsNew = false;
  const expired = [];          // 有 expires 但已过期 → warning（原行为）
  const missingExisting = [];  // 缺 expires 且为 main 存量 → warning（grandfather，供清理）
  const missingNew = [];       // 缺 expires 且本次新增 → error（硬闸，杜绝静默漏）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const entryMatch = line.match(/^#{2,3}\s+(\d{4}-\d{2}-\d{2}.*)/); // 实际 entry 用 ## 或 ###
    if (entryMatch) {
      currentEntry = entryMatch[1].trim();
      currentEntryIsNew = addedLines !== null && addedLines.has(line.trim()); // 标题行是否在本次 diff 新增
      continue;
    }
    if (/needs_automation:\s*true/.test(line)) {
      let foundExpires = false;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const expMatch = lines[j].match(/expires:\s*(\d{4}-\d{2}-\d{2})/);
        if (expMatch) {
          foundExpires = true;
          if (expMatch[1] < today) {
            expired.push(`${currentEntry} (expired ${expMatch[1]})`);
          }
          break;
        }
      }
      if (!foundExpires) {
        (currentEntryIsNew ? missingNew : missingExisting).push(`${currentEntry}: ${line.trim().slice(0, 70)}`);
      }
    }
  }

  if (missingExisting.length > 0) {
    warning(`pr-evolution.md 存量 ${missingExisting.length} 条 needs_automation 缺 expires（governance 追踪不到，建议补 expires 后清理）：`);
    missingExisting.forEach((e) => console.log(`    - ${e}`));
  }
  if (expired.length > 0) {
    warning('pr-evolution.md 含超期未机制化的 needs_automation 项（须升级为 governance/hook）：');
    expired.forEach((e) => console.log(`    - ${e}`));
  }
  if (missingNew.length > 0) {
    error(`pr-evolution.md 本次新增 ${missingNew.length} 条 needs_automation 缺 expires（必须补 \`expires: YYYY-MM-DD\`）：`);
    missingNew.forEach((e) => console.log(`    - ${e}`));
    error('  规则：第三问结论"需自动化" → `needs_automation: true` 必须紧跟一行 `expires: YYYY-MM-DD`（机制化截止日）。');
    error('  原因：本闸只追踪有 expires 的项；缺 expires 会静默掉缝（2026-06-20 R4/R5 实测漏 expires → 改进项永不被催办）。');
    return false;
  }

  if (expired.length === 0 && missingExisting.length === 0) {
    success('pr-evolution.md needs_automation 项 expires 字段齐全、无超期');
  }
  return true;
}

/**
 * 执行一组检查并打印汇总。返回 true 表示全部通过（不退出进程，由调用方决定退出码）。
 */
export function runCheckList(checks, title) {
  console.log(`\n${colors.bold}=== ${title} ===${colors.reset}\n`);

  let passedCount = 0;
  let failedCount = 0;

  for (const check of checks) {
    const passed = check.fn();
    if (passed) {
      passedCount++;
    } else {
      failedCount++;
    }
    console.log(''); // 空行分隔
  }

  console.log(`${colors.bold}=== Summary ===${colors.reset}`);
  console.log(`Total checks: ${checks.length}`);
  console.log(`${colors.green}✓ Passed: ${passedCount}${colors.reset}`);
  if (failedCount > 0) {
    console.log(`${colors.red}✗ Failed: ${failedCount}${colors.reset}`);
  }
  console.log('');

  return failedCount === 0;
}

function main() {
  const ok = runCheckList(CODE_GOVERNANCE_CHECKS, '治理一致性校验');
  if (!ok) {
    error('治理校验失败，请修复上述问题后重试');
    process.exit(1);
  }
  success('所有治理校验通过！');
  process.exit(0);
}

// 仅在直接执行时运行 main()；被 import（如 check-data-readiness.mjs）时不触发。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
