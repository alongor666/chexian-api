#!/usr/bin/env node

/**
 * 治理一致性校验脚本
 *
 * 校验规则：
 * 1. 必需文件存在性：根目录、索引目录
 * 2. 核心层索引完整性：src/shared、src/features、src/widgets、scripts
 * 3. BACKLOG.md 证据链：DONE任务必须有关联文档、关联代码、验收/证据
 * 4. GEMINI.md 引用正确性：不得引用废弃文件，必须引用三大索引和两本账
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
 * 10. TypeScript 检查范围护栏（API-only 清理批次）：
 *    - tsconfig.json 不得再排除活跃源码目录（src/charts/src/components/src/services/src/types/src/core）
 *    - 防止通过扩大 exclude 隐藏真实类型问题
 *
 * 退出码：
 * - 0: 所有检查通过
 * - 1: 存在校验失败
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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
    'AGENTS.md',
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

// ============================================================
// 4. GEMINI.md 引用正确性检查（新增）
// ============================================================

function checkGeminiMdReferences() {
  info('检查 GEMINI.md 引用正确性...');

  const geminiPath = path.join(ROOT_DIR, 'GEMINI.md');

  if (!fs.existsSync(geminiPath)) {
    warning('GEMINI.md 不存在，跳过引用检查');
    return true;
  }

  const content = fs.readFileSync(geminiPath, 'utf-8');
  const errors = [];

  // 检查是否引用废弃文件
  if (content.includes('DEVELOPMENT_PROGRESS.md')) {
    errors.push('GEMINI.md 引用了已废弃的 DEVELOPMENT_PROGRESS.md（应引用 BACKLOG.md + PROGRESS.md）');
  }

  // 检查是否引用三大索引
  const requiredRefs = [
    'DOC_INDEX',
    'CODE_INDEX',
    'PROGRESS_INDEX',
  ];

  for (const ref of requiredRefs) {
    if (!content.includes(ref)) {
      errors.push(`GEMINI.md 缺少对 ${ref} 的引用`);
    }
  }

  // 检查是否引用两本账
  if (!content.includes('BACKLOG.md') && !content.includes('BACKLOG]')) {
    errors.push('GEMINI.md 缺少对 BACKLOG.md 的引用');
  }

  if (!content.includes('PROGRESS.md') && !content.includes('PROGRESS]')) {
    errors.push('GEMINI.md 缺少对 PROGRESS.md 的引用');
  }

  if (errors.length > 0) {
    error(`GEMINI.md 引用检查失败：`);
    errors.forEach(err => console.log(`    - ${err}`));
    return false;
  } else {
    success('GEMINI.md 引用检查通过');
    return true;
  }
}

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
    { pattern: /##\s+.*验证.*协议/, name: '验证协议章节' },
    { pattern: /##\s+.*Claude\s+Code.*工作流/, name: 'Claude Code 工作流集成章节' },
    { pattern: /##\s+.*数据准备/, name: '数据准备章节' },
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
    'AGENTS.md',
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
    const output = execSync('git diff --cached --name-only -z', {
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
// 第10项检查：TypeScript 检查范围护栏
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
// 主函数
// ============================================================

function main() {
  console.log(`\n${colors.bold}=== 治理一致性校验 ===${colors.reset}\n`);

  const checks = [
    { name: '必需文件', fn: checkRequiredFiles },
    { name: '核心层索引', fn: checkCoreLayerIndices },
    { name: 'BACKLOG证据链', fn: checkBacklogEvidence },
    { name: 'GEMINI引用', fn: checkGeminiMdReferences },
    { name: 'CLAUDE章节', fn: checkClaudeMdSections },
    { name: 'DC-002合规', fn: checkDC002Compliance },
    { name: '任务ID分配', fn: checkTaskIdAllocation },
    { name: 'Conflict标记', fn: checkMergeConflictMarkers },
    { name: '调试产物', fn: checkStagedDebugArtifacts },
    { name: 'TS检查范围', fn: checkTsconfigTypecheckScope },
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
