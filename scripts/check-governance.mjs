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
 * 7. 任务ID分配检查（多Agent冲突防护）：
 *    - 检查BACKLOG.md任务ID是否超出分配范围（B001-B699）
 *    - 检测任务ID重复
 *    - Agent专属ID范围：@user(B001-099), @claude(B100-199), @codex(B200-299),
 *      @gemini(B300-399), @trae(B400-499), @kilo(B500-599), @codebuddy(B600-699)
 * 8. Merge conflict 标记扫描：
 *    - 扫描 BACKLOG.md / PROGRESS.md 中是否残留 <<<<<<< / ======= / >>>>>>> 冲突标记
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
 *
 * 退出码：
 * - 0: 所有检查通过
 * - 1: 存在校验失败
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import {
  collectPolicyCurrentStats,
  extractQuickReferenceStats,
} from '../数据管理/pipelines/quick_reference.mjs';

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
      const cells = line
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell !== '');

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

  const content = fs.readFileSync(backlogPath, 'utf-8');
  const tasks = parseBacklogTable(content);

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
 * 检查BACKLOG.md中的任务ID是否符合Agent专属范围
 */
function checkTaskIdAllocation() {
  const backlogPath = path.join(ROOT_DIR, 'BACKLOG.md');
  if (!fs.existsSync(backlogPath)) {
    error('BACKLOG.md 不存在');
    return false;
  }

  const content = fs.readFileSync(backlogPath, 'utf-8');
  const lines = content.split('\n');

  // Agent ID范围配置
  const AGENT_RANGES = {
    '@user': { min: 1, max: 99 },
    '@claude': { min: 100, max: 199 },
    '@codex': { min: 200, max: 299 },
    '@gemini': { min: 300, max: 399 },
    '@trae': { min: 400, max: 499 },
    '@kilo': { min: 500, max: 599 },
    '@codebuddy': { min: 600, max: 699 },
  };

  const errors = [];
  const usedIds = new Map(); // ID -> 行号

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 解析表格行
    if (line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length < 4) continue;

      const taskIdStr = cells[0]; // 第1列：ID
      const owner = cells[3]; // 第4列：归属对象

      const match = taskIdStr.match(/^B(\d{3})$/);
      if (!match) continue;

      const taskIdNum = parseInt(match[1], 10);

      // 检查ID重复
      if (usedIds.has(taskIdNum)) {
        errors.push(
          `任务ID重复: ${taskIdStr} 在第 ${usedIds.get(taskIdNum)} 行和第 ${i + 1} 行`
        );
      } else {
        usedIds.set(taskIdNum, i + 1);
      }

      // 检查ID是否超出分配范围
      const expectedAgent = Object.entries(AGENT_RANGES).find(
        ([_, range]) => taskIdNum >= range.min && taskIdNum <= range.max
      )?.[0];

      if (!expectedAgent) {
        errors.push(
          `任务ID ${taskIdStr} (行${i + 1}) 超出所有Agent的分配范围 (B001-B699)`
        );
      }
    }
  }

  // 输出结果
  if (errors.length > 0) {
    error(`任务ID分配检查失败（发现 ${errors.length} 个错误）：`);
    errors.forEach(err => console.log(`    - ${err}`));
    return false;
  } else {
    success(`任务ID分配检查通过（扫描 ${usedIds.size} 个任务，无冲突）`);
    return true;
  }
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
    'PROGRESS.md',
    'CLAUDE.md',
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
// 第12项检查：包管理器锁文件策略（Bun-only）
// ============================================================

function checkPackageManagerLockPolicy() {
  info('检查包管理器锁文件策略（Bun-only）...');

  const lockfiles = ['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  const existing = lockfiles.filter((name) => fs.existsSync(path.join(ROOT_DIR, name)));

  if (!existing.includes('bun.lock')) {
    error('缺少 bun.lock（项目默认执行器为 Bun）');
    return false;
  }

  const disallowed = existing.filter((name) => name !== 'bun.lock');
  if (disallowed.length > 0) {
    error(`检测到非 Bun 锁文件：${disallowed.join(', ')}`);
    console.log('    - 请移除非 Bun 锁文件，避免依赖解析漂移');
    return false;
  }

  success('包管理器锁文件策略检查通过');
  return true;
}

// ============================================================
// 第13项检查：本地 current/ Parquet 文件重叠检测
// ============================================================

/**
 * 从文件名中解析日期范围（格式：*_YYYYMMDD_YYYYMMDD.parquet）
 * @returns {{ start: number, end: number } | null}
 */
function parseDateRangeFromFilename(filename) {
  const match = filename.match(/_(\d{8})_(\d{8})\.parquet$/);
  if (!match) return null;
  return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
}

/**
 * 检查本地 current/ 目录中是否存在时间范围重叠的 Parquet 文件。
 *
 * 根因：多个重叠文件经 UNION ALL 后数据翻倍（历史事故：1,837,252行 vs 正确的 1,161,809行）。
 * 修复：sync-vps.mjs 已默认清理，本检查作为提交前最后一道防线。
 */
function checkParquetOverlapInCurrent() {
  info('检查 current/ Parquet 文件时间范围重叠...');

  const currentDir = path.join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');

  if (!fs.existsSync(currentDir)) {
    success('current/ 目录不存在，跳过重叠检测');
    return true;
  }

  const parquetFiles = fs.readdirSync(currentDir)
    .filter(f => f.endsWith('.parquet') && !f.startsWith('test-data'))
    .map(f => ({ name: f, range: parseDateRangeFromFilename(f) }))
    .filter(f => f.range !== null); // 只检测有日期范围的文件（聚合文件无日期不参与检测）

  if (parquetFiles.length <= 1) {
    success(`current/ Parquet 重叠检测通过（${parquetFiles.length} 个有效文件，无重叠风险）`);
    return true;
  }

  // 业务互补：剔摩（非摩托）和 限摩（仅摩托）按险类切分，时间重叠也无数据翻倍
  const isComplementary = (a, b) => {
    const aTuomo = /_剔摩_/.test(a), aXianmo = /_限摩_/.test(a);
    const bTuomo = /_剔摩_/.test(b), bXianmo = /_限摩_/.test(b);
    return (aTuomo && bXianmo) || (aXianmo && bTuomo);
  };

  const overlaps = [];
  for (let i = 0; i < parquetFiles.length; i++) {
    for (let j = i + 1; j < parquetFiles.length; j++) {
      const a = parquetFiles[i];
      const b = parquetFiles[j];
      // 两个区间重叠条件：a.start <= b.end AND b.start <= a.end
      if (a.range.start <= b.range.end && b.range.start <= a.range.end) {
        if (isComplementary(a.name, b.name)) continue; // 剔摩/限摩互补豁免
        overlaps.push(
          `"${a.name}" [${a.range.start}~${a.range.end}] ↔ "${b.name}" [${b.range.start}~${b.range.end}]`
        );
      }
    }
  }

  if (overlaps.length > 0) {
    error(`current/ Parquet 文件存在时间范围重叠（将导致数据翻倍）：`);
    overlaps.forEach(o => console.log(`    - ${o}`));
    console.log('    ▶ 修复：删除或移出重叠文件，保留互补的文件集合');
    console.log('    ▶ 同步时使用 node scripts/sync-vps.mjs（默认清理旧文件）');
    return false;
  }

  success(`current/ Parquet 重叠检测通过（${parquetFiles.length} 个文件，区间互补无重叠）`);
  return true;
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
 * 阻止含 token 的 Playwright auth 状态文件或含敏感 key 的文件进入提交。
 * 根因：commit 82c78ac 将 output/playwright/.auth/user.json（含 cx_access_token）直接提交到仓库。
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

  // 规则2：文件内容包含敏感 key（cx_access_token / cx_refresh_token）
  const SENSITIVE_KEYS = ['cx_access_token', 'cx_refresh_token'];
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

    for (const key of SENSITIVE_KEYS) {
      if (content.includes(key)) {
        credErrors.push(`文件内容包含敏感 key "${key}"：${file}`);
        break;
      }
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
        error(`知识库数据规模不一致: ${mismatches.join('；')}`);
        console.log('    修复: 运行 node 数据管理/daily.mjs，或用真实 policy/current 分片刷新 QUICK_REFERENCE.md');
        return false;
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
        execSync(`git check-ignore -q "${f}"`, { cwd: ROOT_DIR, encoding: 'utf-8' });
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

  // 提取 runStandardMode 函数体
  const fnStart = content.indexOf('async function runStandardMode');
  if (fnStart === -1) {
    warning('sync-vps.mjs 中未找到 runStandardMode 函数，跳过检查');
    return true;
  }

  // 简单提取：从函数声明到下一个 async function 或文件末尾
  const fnEnd = content.indexOf('\nasync function ', fnStart + 1);
  const fnBody = fnEnd === -1 ? content.slice(fnStart) : content.slice(fnStart, fnEnd);

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
// 主函数
// ============================================================

function main() {
  console.log(`\n${colors.bold}=== 治理一致性校验 ===${colors.reset}\n`);

  const checks = [
    { name: '必需文件', fn: checkRequiredFiles },
    { name: '核心层索引', fn: checkCoreLayerIndices },
    { name: 'BACKLOG证据链', fn: checkBacklogEvidence },
    { name: 'CLAUDE章节', fn: checkClaudeMdSections },
    { name: 'DC-002合规', fn: checkDC002Compliance },
    { name: '任务ID分配', fn: checkTaskIdAllocation },
    { name: 'Conflict标记', fn: checkMergeConflictMarkers },
    { name: '调试产物', fn: checkStagedDebugArtifacts },
    { name: '热点文件契约', fn: checkHotfileContractCoverage },
    { name: 'TS检查范围', fn: checkTsconfigTypecheckScope },
    { name: '锁文件策略', fn: checkPackageManagerLockPolicy },
    { name: 'Parquet重叠', fn: checkParquetOverlapInCurrent },
    { name: 'Claims去重', fn: checkClaimsDetailDeduplication },
    { name: '凭据扫描', fn: checkStagedCredentials },
    { name: 'PR体量门禁', fn: checkPrSizeLimit },
    { name: '知识库一致性', fn: checkKnowledgeDataConsistency },
    { name: 'gitignore审计', fn: checkGitignoreShadow },
    { name: '字段定义一致', fn: checkFieldDefinitionConsistency },
    { name: 'DarkMode质量', fn: checkDarkModeQuality },
    { name: 'ECharts网格线', fn: checkEchartsSplitLine },
    { name: 'sync-vps覆盖', fn: checkSyncVpsCoverage },
    { name: '数据漂移检测', fn: checkDataDrift },
    { name: 'SQL模块数一致', fn: checkSqlModuleCountConsistency },
    { name: 'CLAUDE.md预算', fn: checkClaudeMdBudget },
    { name: 'ETL多sheet规范', fn: checkEtlMultiSheetCompliance },
  ];

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

  // 输出总结
  console.log(`${colors.bold}=== Summary ===${colors.reset}`);
  console.log(`Total checks: ${checks.length}`);
  console.log(`${colors.green}✓ Passed: ${passedCount}${colors.reset}`);
  if (failedCount > 0) {
    console.log(`${colors.red}✗ Failed: ${failedCount}${colors.reset}`);
  }
  console.log('');

  // 返回退出码
  if (failedCount > 0) {
    error('治理校验失败，请修复上述问题后重试');
    process.exit(1);
  } else {
    success('所有治理校验通过！');
    process.exit(0);
  }
}

main();
