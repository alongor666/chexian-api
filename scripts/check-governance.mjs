#!/usr/bin/env node

/**
 * 治理一致性校验脚本
 *
 * 校验规则：
 * 1. 必需文件与核心索引：根目录治理文件、三大索引、核心层 INDEX.md（原 1/2 两项同构合并，2026-07-04 奥卡姆批次一）
 * 3. BACKLOG 证据链（折叠日志直查）：终态任务（DONE 完成 / CANCELLED·WONTFIX 弃置）必须有关联文档、关联代码、验收证据或弃置理由
 * 4. GEMINI.md 引用正确性（已移除 — GEMINI.md 不再维护）
 * 5. CLAUDE.md 关键章节：必须包含验证协议、工作流集成、数据准备章节
 * 6. DC-002 合规性（B106+B107）：
 *    - 禁止硬编码CURRENT_DATE（排除带DC-002 Exception注释的行）
 *    - 禁止使用||运算符判断filters字段（B107增强：日期字段报错，其他字段警告）
 *    - 禁止函数签名包含可选日期参数
 * 7. BACKLOG 事件日志校验（event-log 模型，2026-06 治本后取代「任务ID分配」）：
 *    - 真相 = BACKLOG_LOG.jsonl（append-only，唯一进 git 的账本）；BACKLOG.md/ARCHIVE 是本地渲染的派生视图（gitignored，不进 git）
 *    - 校验事件结构 / 无孤儿事件 / create uid 唯一 / 曾用号唯一（禁复用）
 *    - 视图不进 git ⇒ 无被提交视图可陈旧 ⇒ 陈旧守卫已删除（2026-07-09 根治，见 .claude/rules/backlog-eventlog.md §10）
 * 8. Merge conflict 标记扫描：
 *    - 扫描 BACKLOG_LOG.jsonl / PROGRESS.md 等治理文件中是否残留 <<<<<<< / ======= / >>>>>>> 冲突标记
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
import { createRequire } from 'module';
import { execFileSync, execSync } from 'child_process';
import {
  collectPolicyCurrentStats,
  extractQuickReferenceStats,
  syncQuickReferenceFile,
} from '../数据管理/pipelines/quick_reference.mjs';
import { detectPolicyCurrentOverlap } from './lib/parquet-overlap-check.mjs';
import { evaluateLedgerFreshness, runLedgerUncommittedBulkCheck } from './etl-ledger/governance-check.mjs';
import { listPolicyCurrentShards, collectValidationDimFileEntries, collectValidationFactFileEntries } from './lib/policy-current-shards.mjs';
import {
  loadLog, fold, validateLog, displayId, TERMINAL_STATUSES,
} from './backlog/lib.mjs';
import { SHADOW_KEYS, MAIN_CUBES, CUBE_STATE_NAMES } from './shared/cube-routes.mjs';
import { parseLedger as parseLoopLedger, normalizeVerdict as normalizeLoopVerdict } from './loop/quality-report.mjs';
import { scanEntries as scanAutomationEntries, verifyMechanisms as verifyAutomationMechanisms } from './loop/automation-due.mjs';
import { buildPatternChecks } from './governance/pattern-engine.mjs';
import { PATTERN_RULES } from './governance/pattern-rules.mjs';
import { checkUploadSizeLimitConsistency as runUploadSizeCheck } from './governance/upload-size-consistency.mjs';
import { checkDualLockConsistency as runDualLockConsistencyCheck, checkBranchMappingMirror as runBranchMappingMirrorCheck } from './governance/dual-lock-and-branch-mirror-checks.mjs';
import { governanceCheckChunkInvariants } from './check-chunk-invariants.mjs';

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
// 1. 必需文件与核心索引存在性检查
//    （原「核心层索引」检查与本检查同构——固定清单 + existsSync——2026-07-04 奥卡姆批次一合并）
// ============================================================

function checkRequiredFiles() {
  info('检查必需文件与核心层索引存在性...');

  const requiredFiles = [
    // 根目录治理文件
    //（BACKLOG.md / BACKLOG_ARCHIVE.md 已改为 gitignored 本地派生视图，不再要求存在——
    //  真相 BACKLOG_LOG.jsonl 由下方「BACKLOG 事件日志」检查守护；见 backlog-eventlog.md §10）
    'CLAUDE.md',
    'BACKLOG_LOG.jsonl',
    'PROGRESS.md',
    // 三大索引
    '开发文档/00_index/DOC_INDEX.md',
    '开发文档/00_index/CODE_INDEX.md',
    '开发文档/00_index/PROGRESS_INDEX.md',
    // 核心层 INDEX.md（原「核心层索引」检查并入）
    'src/shared/INDEX.md',
    'src/features/INDEX.md',
    'src/widgets/INDEX.md',
    'scripts/INDEX.md',
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
// 3. BACKLOG 证据链检查（折叠日志直查，不依赖派生视图）
//    视图 BACKLOG.md/ARCHIVE 已 gitignored（2026-07-09 根治），故直接折叠真相日志、
//    在内存任务模型上查终态任务证据——比解析渲染表格更正确。见 backlog-eventlog.md §10。
// ============================================================

function checkBacklogEvidence() {
  info('检查 BACKLOG 证据链（折叠日志）...');

  const logPath = path.join(ROOT_DIR, 'BACKLOG_LOG.jsonl');
  const eventsDir = path.join(ROOT_DIR, 'backlog-events');
  if (!fs.existsSync(logPath) && !fs.existsSync(eventsDir)) {
    error('BACKLOG_LOG.jsonl 与 backlog-events/ 均不存在，跳过证据链检查');
    return false;
  }

  let tasks;
  try {
    tasks = [...fold(loadLog(logPath, eventsDir)).values()];
  } catch (e) {
    error(`折叠 BACKLOG 事件日志失败：${e.message}`);
    return false;
  }

  if (tasks.length === 0) {
    warning('BACKLOG_LOG.jsonl 中未找到任务');
    return true; // 没有任务不算失败
  }

  // 终态任务（DONE=完成 / CANCELLED·WONTFIX=弃置）均须证据链完整——同一强制机制
  const terminalTasks = tasks.filter(task => TERMINAL_STATUSES.includes(task.status));

  if (terminalTasks.length === 0) {
    info(`BACKLOG 共 ${tasks.length} 个任务，其中 0 个终态（DONE/CANCELLED/WONTFIX），无需检查证据链`);
    return true;
  }

  let hasErrors = false;
  const errors = [];

  for (const task of terminalTasks) {
    const issues = [];
    const isDiscard = task.status === 'CANCELLED' || task.status === 'WONTFIX';
    const evidenceLabel = isDiscard ? '弃置理由' : '验收/证据';

    // 关联文档 / 关联代码：fold 缺省为 'N/A'（视为已声明），仅空串 / '-' 判缺失
    if (!task.docs || task.docs === '' || task.docs === '-') {
      issues.push('关联文档为空（应填写文档路径或 N/A）');
    }
    if (!task.code || task.code === '' || task.code === '-') {
      issues.push('关联代码为空（应填写代码路径或 N/A）');
    }

    // 验收/证据：与旧渲染列同口径——status 证据 + note 链任一非空即可
    // （DONE=完成证据，CANCELLED/WONTFIX=弃置理由；均须非空且非 N/A/-）
    const evidenceText = [task.evidence, ...(task.notes || [])]
      .filter(s => s && String(s).trim())
      .join(' ')
      .trim();
    if (!evidenceText || evidenceText === '-' || evidenceText === 'N/A') {
      issues.push(isDiscard
        ? `${evidenceLabel}为空（弃置任务必须填写弃置理由）`
        : `${evidenceLabel}为空（必须填写 PR链接/Commit/测试报告等）`);
    }

    if (issues.length > 0) {
      hasErrors = true;
      errors.push({ id: displayId(task), issues });
    }
  }

  if (hasErrors) {
    error(`BACKLOG 证据链检查失败，共 ${terminalTasks.length} 个终态任务，${errors.length} 个有问题：`);
    errors.forEach(({ id, issues }) => {
      console.log(`    - ${id}：`);
      issues.forEach(issue => console.log(`        • ${issue}`));
    });
    return false;
  } else {
    success(`BACKLOG 证据链检查通过（${terminalTasks.length} 个终态任务：DONE/CANCELLED/WONTFIX）`);
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

// （已迁移）checkDC002Compliance → scripts/governance/pattern-rules.mjs 规则 dc002-*（3 条子规则）（奥卡姆批次二，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs）

// ============================================================
// 第7项检查：任务ID分配合规性（多Agent冲突防护）
// ============================================================

/**
 * BACKLOG 事件日志校验（event-log 模型，2026-06 治本后取代「任务ID分配」）：
 *  1. 日志结构完整：每条事件 kind/uid/ts 合规；create uid 唯一；曾用号唯一（禁复用）
 *  2. 无孤儿事件：status/note/amend 必须引用已存在的 create
 *  （陈旧守卫已删除：视图 BACKLOG.md/ARCHIVE 已 gitignored、不进 git，无被提交视图可陈旧。
 *    2026-07-09 根治——结构性消除 > 检查性防御，见 backlog-eventlog.md §10）
 */
function checkBacklogLog() {
  const logPath = path.join(ROOT_DIR, 'BACKLOG_LOG.jsonl');
  const eventsDir = path.join(ROOT_DIR, 'backlog-events');
  if (!fs.existsSync(logPath) && !fs.existsSync(eventsDir)) {
    error('BACKLOG_LOG.jsonl 与 backlog-events/ 均不存在（首次请 bun scripts/backlog/migrate.mjs --apply）');
    return false;
  }

  let events;
  try {
    // 两源合并：冻结 jsonl（存量）+ backlog-events/ 目录（增量，每事件一文件）
    events = loadLog(logPath, eventsDir);
  } catch (e) {
    error(`BACKLOG 事件日志解析失败：${e.message}`);
    return false;
  }

  // 0. 目录事件文件名 ↔ 内容 eid 一致性（防手工复制/改名造成的身份漂移）
  const eidMismatch = events.filter(e => e.__src && e.eid && !e.__src.includes(`-${e.eid}.json`));
  if (eidMismatch.length > 0) {
    error(`backlog-events/ 有 ${eidMismatch.length} 个事件文件名与内容 eid 不一致（文件名须为 <at压缩>-<eid>.json）：`);
    eidMismatch.slice(0, 10).forEach(e => console.log(`    - ${e.__src}（内容 eid=${e.eid}）`));
    return false;
  }

  // 1+2. 结构完整 + 无孤儿
  const { errors, warnings, stats } = validateLog(events);
  if (errors.length > 0) {
    error(`BACKLOG 事件日志校验失败（${errors.length} 处）：`);
    errors.slice(0, 20).forEach(e => console.log(`    - ${e}`));
    return false;
  }

  // 陈旧守卫已删除：视图 BACKLOG.md/ARCHIVE 已 gitignored、不进 git → 无被提交视图可陈旧
  //（2026-07-09 根治：结构性消除 > 检查性防御，见 backlog-eventlog.md §10）。
  // 看板按需本地渲染：bun run backlog:render（= governance-backlog-curate.mjs --apply）。

  const warnNote = warnings.length ? `，${warnings.length} 处提示` : '';
  success(`BACKLOG 事件日志校验通过（${stats.events} 事件 / ${stats.tasks} 任务${warnNote}）`);
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
    // BACKLOG.md / BACKLOG_ARCHIVE.md 已 gitignored、不进 git，不再扫描（真相 BACKLOG_LOG.jsonl 仍扫）
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

// 暂存区文件清单（供「调试产物」「凭据扫描」两闸复用——同一次 governance 只调一次 git，
// 2026-07-04 奥卡姆批次一去重；--diff-filter=d 排除删除：删调试产物/凭据文件是好事，不拦）
let stagedFilesCache; // undefined=未取；null=git 不可用；array=清单
function getStagedFiles() {
  if (stagedFilesCache !== undefined) return stagedFilesCache;
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=d -z', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    stagedFilesCache = output.split('\0').filter(Boolean);
  } catch {
    stagedFilesCache = null;
  }
  return stagedFilesCache;
}

function checkStagedDebugArtifacts() {
  info('检查暂存区调试产物...');

  const stagedFiles = getStagedFiles();
  if (stagedFiles === null) {
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
// 幽灵字段治理检查（BACKLOG 2026-04-21-claude-b250）
// ============================================================
/**
 * 独立脚本 scripts/check-phantom-fields.mjs 的 governance 挂载点（与 checkHotfileContractCoverage
 * 同种 execFileSync + --quiet-pass 包装风格）。扫描 数据管理/pipelines/*.py 与
 * server/src/sql/**\/*.ts 引用的 Parquet 列名，与 fields.json + parquet-columns.snapshot.json
 * 真值来源比对，引用了两者并集之外的字段（幽灵字段）即报错。误报控制策略、别名消解规则、
 * 域覆盖缺口（quotes/renewal_tracker 暂无机器可读列清单）见独立脚本头部注释。
 */
function checkPhantomFields() {
  info('检查幽灵字段引用（pipelines/*.py + sql/**/*.ts 列引用 vs 注册表）...');

  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/check-phantom-fields.mjs'), '--quiet-pass'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    success('幽灵字段检查通过');
    return true;
  } catch (cause) {
    error('幽灵字段检查失败');
    const stdout = cause?.stdout?.toString().trim();
    const stderr = cause?.stderr?.toString().trim();
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    return false;
  }
}

// ============================================================
// Context Provider 未挂载治理检查（BACKLOG 2026-06-12-claude-27972c 子项 2b）
// ============================================================
/**
 * 独立脚本 scripts/check-unmounted-providers.mjs 的 governance 挂载点（与 checkPhantomFields/
 * checkHotfileContractCoverage 同种 execFileSync + --quiet-pass 包装风格）。扫描
 * src/**\/*.ts(x) 内 createContext + export XxxProvider 定义，与全仓库 JSX <XxxProvider>/
 * <XxxContext.Provider> 挂载点比对，命中"定义了但从未挂载"即报错。识别规则、误报控制（独立
 * Provider 组件模式 / 自挂载模式 / 测试专用 Provider 白名单）见独立脚本头部注释。
 */
function checkUnmountedProviders() {
  info('检查 Context Provider 未挂载（createContext + export XxxProvider vs 全仓库 JSX 挂载）...');

  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/check-unmounted-providers.mjs'), '--quiet-pass'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    success('Context Provider 挂载检查通过');
    return true;
  } catch (cause) {
    error('Context Provider 挂载检查失败');
    const stdout = cause?.stdout?.toString().trim();
    const stderr = cause?.stderr?.toString().trim();
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    return false;
  }
}

// ============================================================
// execSync/exec 模板拼接注入检测（BACKLOG 2026-06-12-claude-27972c 子项 1）
// ============================================================
/**
 * 独立脚本 scripts/check-exec-template-injection.mjs 的 governance 挂载点（同种 execFileSync +
 * --quiet-pass 包装风格）。扫描 scripts/ + server/src/ 下 execSync/exec 的模板字面量插值调用，
 * 要求逐一在独立脚本的 KNOWN_SAFE_INTERPOLATIONS 显式登记理由，防止"插值来自文件枚举结果/
 * 用户输入直接进 shell"的危险模式被静默引入。识别范围、白名单机制见独立脚本头部注释。
 */
function checkExecTemplateInjection() {
  info('检查 execSync/exec 模板插值调用（scripts/ + server/src/ 禁止未登记的 shell 拼接）...');

  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/check-exec-template-injection.mjs'), '--quiet-pass'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    success('execSync/exec 模板插值检查通过');
    return true;
  } catch (cause) {
    error('execSync/exec 模板插值检查失败');
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

  // fail-closed：派生省份混省/读失败（codex 闸-2 P1.2）——必须在 count===0 之前消费 branchErrors，
  // 否则「无 branch_code 列但 policy_no 混省」的文件会同时绕过本闸（count===0）与单文件不混省闸
  // （无 branch_code 列 → skip），双漏。
  if (result.branchErrors && result.branchErrors.length > 0) {
    error('current/ 存在单文件混省或不可判定省份的 parquet（数据轴权威，非文件名）：');
    for (const m of result.branchErrors) {
      console.log(`    - ${m}`);
    }
    console.log('    ▶ 修复：拆分混省 parquet（单文件单省），或核查损坏文件；省份以 parquet 内派生为准');
    return false;
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
 * 简易 glob 判定：指定 `<dir>/<basename-with-*>` 模式下是否存在匹配文件（无依赖，仅支持 `*` 通配）。
 * 用于「文件存在但 python/duckdb 跑不起来」时的 fail-closed 兜底判断。
 */
function hasMatchingFiles(globPattern) {
  const dir = path.dirname(globPattern);
  if (!fs.existsSync(dir)) return false;
  const base = path.basename(globPattern);
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try {
    return fs.readdirSync(dir).some((f) => re.test(f));
  } catch {
    return false;
  }
}

/**
 * 核心：对一组按省划分的 claims parquet glob 做 (branch_code, claim_no) 去重核验（纯函数，无 console）。
 *
 * 设计要点（与 checkSingleProvincePerFile 同源，遵循 P1.2 fail-closed）：
 * - 省份隔离（data-pipeline.md「省份数据隔离」RED LINE）：逐省 glob，**绝不**跨省裸 glob 混查；
 *   有 branch_code 列时按 (branch_code, claim_no) 分组，无则退化为 claim_no（同时正确允许 SC/SX 同号）。
 * - fail-closed + CI 安全：python 先 glob 判定数据是否存在，**无文件则不 import duckdb 直接 skip**
 *   （CI/worktree 无 parquet → skip，不造假安全）；**有数据但 DuckDB 读不了 / 缺 claim_no 列 →
 *   返回 error（= 失败放行=假安全，故报错）**，绝不降级为 skip。
 * @param {{branch:string, glob:string}[]} specs 各省 claims_*.parquet 绝对路径 glob
 * @returns {{status:'pass'|'fail'|'skip'|'error', reason?:string, provinces?:Array}}
 */
export function inspectClaimsClaimNoDuplication(specs) {
  const py = `
import sys, json, glob
specs = json.loads(sys.argv[1])
prepared = []
any_files = False
for spec in specs:
    files = sorted(glob.glob(spec["glob"]))
    if files:
        any_files = True
    prepared.append((spec["branch"], files))
if not any_files:
    print(json.dumps({"status": "skip", "reason": "no parquet files"}))
    sys.exit(0)
# 数据存在 → 任何读取/校验失败都必须 fail-closed（error），不得静默 skip（P1.2 假安全防护）。
try:
    import duckdb
    con = duckdb.connect()
    overall = "pass"
    provinces = []
    for branch, files in prepared:
        if not files:
            provinces.append({"branch": branch, "status": "skip", "reason": "no parquet"})
            continue
        lit = "[" + ",".join("'" + f.replace("'", "''") + "'" for f in files) + "]"
        src = "read_parquet(" + lit + ", union_by_name=true)"
        cols = [d[0] for d in con.execute("SELECT * FROM " + src + " LIMIT 0").description]
        if "claim_no" not in cols:
            raise ValueError("claims parquet 缺 claim_no 列（branch=" + branch + "）")
        keys = "branch_code, claim_no" if "branch_code" in cols else "claim_no"
        key_names = [k.strip() for k in keys.split(",")]
        total = con.execute("SELECT COUNT(*) FROM " + src).fetchone()[0]
        rows = con.execute(
            "SELECT " + keys + ", COUNT(*) AS cnt FROM " + src +
            " GROUP BY " + keys + " HAVING COUNT(*) > 1 ORDER BY cnt DESC, " + keys
        ).fetchall()
        dup_groups = len(rows)
        excess = sum(int(r[-1]) - 1 for r in rows)
        samples = [{**{k: r[i] for i, k in enumerate(key_names)}, "count": int(r[-1])} for r in rows[:10]]
        status = "fail" if dup_groups > 0 else "pass"
        if status == "fail":
            overall = "fail"
        provinces.append({"branch": branch, "status": status, "totalRows": int(total),
                          "dupGroups": dup_groups, "excessRows": excess, "samples": samples})
    print(json.dumps({"status": overall, "provinces": provinces}))
except Exception as e:
    print(json.dumps({"status": "error", "reason": str(e).splitlines()[0] if str(e) else type(e).__name__}))
    sys.exit(0)
`;
  try {
    const stdout = execFileSync('python3', ['-c', py, JSON.stringify(specs)], { encoding: 'utf-8' });
    return JSON.parse(stdout.trim());
  } catch (e) {
    // execFileSync 抛错 = python3 缺失 / 进程被杀 / 无 stdout。区分两种语义：
    // - 任一 spec 的 parquet 实际存在 → fail-closed（error）：数据在却跑不起来=假安全（P1.2）。
    // - 全无 parquet（CI/worktree） → skip。
    const reason = (e.message || String(e)).split('\n')[0];
    const anyFiles = specs.some((s) => hasMatchingFiles(s.glob));
    return anyFiles ? { status: 'error', reason } : { status: 'skip', reason };
  }
}

/**
 * 检查 claims_detail/ 各分区文件 claim_no 是否存在重复（按 branch_code 分省 · SC + SX）。
 *
 * 根因：2026-05-05 事故 — daily.mjs 把新全量 + 旧增量 11 个文件一并喂给 ETL，
 * convert_claims_detail.py 裸 concat 无去重，76,844 个 claim_no 各 2 行写入分区，
 * 服务端 SUM(settled+pending) 不去重，赔付率虚高 92% (真实 48%)。
 *
 * 本闸是「让下游聚合可证明安全」的发布前断言（PR #845 完整性审查 follow-up）：policy_age_dev /
 * diagnose_segment / ulr_dimensions / ulr_triangle / diagnose_lng_tractor /
 * diagnose_cohort_comparison / diagnose_transfer_location 等脚本对 claims 做
 * `LEFT JOIN ... ON policy_no` 后 `SUM(已决/未决)` 且**不按 claim_no 去重**，重复行即双计赔款。
 * 与其给每个脚本逐个加去重，不如在「下游真正读取的最终 warehouse 分区 parquet」上断言唯一性。
 */
function checkClaimsDetailDeduplication() {
  info('检查 claims_detail/ Parquet claim_no 去重（按 branch_code 分省 · SC + SX）...');

  const specs = [
    { branch: 'SC', glob: path.join(ROOT_DIR, '数据管理/warehouse/fact/claims_detail/claims_*.parquet') },
    { branch: 'SX', glob: path.join(ROOT_DIR, '数据管理/warehouse/validation/SX/claims_detail/claims_*.parquet') },
  ];
  const res = inspectClaimsClaimNoDuplication(specs);

  if (res.status === 'skip') {
    success(`claims_detail/ 去重检测跳过（无生产 parquet：${res.reason || 'no parquet'}）`);
    return true;
  }
  if (res.status === 'error') {
    // 数据存在却读不了 → fail-closed（失败放行=假安全，对齐 checkSingleProvincePerFile P1.2）
    error(`claims_detail/ 去重检测失败：parquet 存在但无法校验（${res.reason || 'unknown'}）`);
    console.log(`    ▶ 排查：确认 python3 + duckdb 可用、claims parquet 含 claim_no 列且未损坏`);
    return false;
  }
  if (res.status === 'fail') {
    for (const p of (res.provinces || []).filter(x => x.status === 'fail')) {
      error(`claims_detail [${p.branch}] claim_no 重复：${p.dupGroups.toLocaleString()} 组重复键，多计 ${p.excessRows.toLocaleString()} 行（共 ${p.totalRows.toLocaleString()} 行）`);
      for (const s of p.samples) {
        console.log(`    重复键样本: branch_code=${s.branch_code ?? p.branch}, claim_no=${s.claim_no}, count=${s.count}`);
      }
    }
    console.log(`    ▶ 影响：下游 LEFT JOIN claims ON policy_no 后 SUM(已决/未决) 双计赔款 → 满期赔付率虚高`);
    console.log(`    ▶ 修复：归档冲突的旧增量 xlsx + 重跑 node 数据管理/daily.mjs claims_detail`);
    return false;
  }
  // pass
  const checked = (res.provinces || []).filter(p => p.status === 'pass');
  const skipped = (res.provinces || []).filter(p => p.status === 'skip').map(p => p.branch);
  const summary = checked.map(p => `${p.branch}=${p.totalRows.toLocaleString()}行/0重复`).join(', ');
  success(`claims_detail/ 去重检测通过（${summary}${skipped.length ? `；${skipped.join('/')} 无数据跳过` : ''}）`);
  return true;
}

// ============================================================
// pre-sync readiness：fact parquet「单文件不混省」闸（多省派生化 Phase 4）
// ============================================================

/**
 * 校验每个生产 fact parquet「单文件不混省」+ 派生省==列省（codex 闸-1 P1.1/P1.5 采纳）。
 *
 * 设计要点：
 * - 注册到 PRE_SYNC_READINESS_CHECKS（数据就绪闸），**不在**代码门禁（CI 无 parquet 会造假安全 · P1.2）。
 * - 分域建模：policy/current + claims_detail + cross_sell + customer_flow 走「prefix hard-check」
 *   （派生省 == 列省）；new_energy_claims（VIN-JOIN，policy_no 全 NULL）/ quotes（warn，92.5% NULL）/
 *   renewal_tracker（无 policy_no）只校验单省 + 非空 + 允许值，**不**按 policy_no 前缀比对（P1.1）。
 * - 无 branch_code 列 → 跳过（loader 注入部署省常量，单省 by construction）。
 * - 允许值/mapping/prefixLength 全部从 fields.json 读取，不硬编码 SC/SX（P1.5）。
 * - 全量扫描不抽样（260 万行 premium ~0.04s · P2 #2a）；单 python3 进程批量检查（P2 #2c）。
 * - fail-closed：数据存在但 DuckDB 读不了 → 失败放行=假安全，故报错（P1.2）；
 *   无任何生产 parquet（CI/非数据环境）→ python 先 glob 判定、不 import duckdb → 跳过。
 */
// B2：source-file-routing 拼音 map 是分省编排省份枚举的实际来源（registeredBranchCodesFromPrefixMap）；
// 它必须与 fields.json branch_code.derivation.mapping（唯一事实源）的 values 同步，否则分省漏省/错省。
// 纯代码层静态对比（无 Parquet 数据依赖，CI 也跑），落实闸-1 B2 P0-B「避免 SSOT 分裂」。
function checkProvincePrefixMapConsistency() {
  info('检查省份前缀映射一致（source-file-routing 拼音 map ⟷ fields.json branch_code.mapping · B2）...');
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/src/config/field-registry/fields.json'), 'utf-8'));
    const bc = (reg.fields || []).find((f) => f.id === 'branch_code') || {};
    const fieldsCodes = [...new Set(Object.values((bc.derivation || {}).mapping || {}))].sort();

    const sfrSrc = fs.readFileSync(path.join(ROOT_DIR, '数据管理/lib/source-file-routing.mjs'), 'utf-8');
    const m = sfrSrc.match(/PROVINCE_FILENAME_PREFIX_TO_CODE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
    if (!m) {
      error('    无法解析 source-file-routing.mjs 的 PROVINCE_FILENAME_PREFIX_TO_CODE');
      return false;
    }
    const sfrCodes = [...new Set([...m[1].matchAll(/:\s*['"]([A-Z]{2})['"]/g)].map((x) => x[1]))].sort();

    if (JSON.stringify(fieldsCodes) !== JSON.stringify(sfrCodes)) {
      error(`    省份集不一致：fields.json mapping=[${fieldsCodes.join(',')}] vs source-file-routing 拼音 map=[${sfrCodes.join(',')}]`);
      error('    B2 分省编排省份枚举取自拼音 map，新增省份须同时加 fields.json mapping + 拼音 map 两处');
      return false;
    }
    success(`省份前缀映射一致（${sfrCodes.join('/')}，两源同步）`);
    return true;
  } catch (e) {
    error(`    省份前缀映射一致性检查异常：${e.message}`);
    return false;
  }
}

function checkSingleProvincePerFile() {
  info('检查 fact parquet 单文件不混省（派生省==列省 · pre-sync）...');

  const domains = [
    { glob: '数据管理/warehouse/fact/policy/current/*.parquet', prefixCheckable: true }, // B2：顶层扁平（现状）
    { glob: '数据管理/warehouse/fact/policy/current/[A-Z][A-Z]/*.parquet', prefixCheckable: true }, // B2：单层省份子目录 current/<省>/（^[A-Z]{2}$，与 helper 一致；空匹配 glob.glob 返回 []）
    { glob: '数据管理/warehouse/fact/claims_detail/claims_*.parquet', prefixCheckable: true },
    { glob: '数据管理/warehouse/fact/cross_sell/latest.parquet', prefixCheckable: true },
    { glob: '数据管理/warehouse/fact/customer_flow/latest.parquet', prefixCheckable: true },
    { glob: '数据管理/warehouse/fact/new_energy_claims/latest.parquet', prefixCheckable: false },
    { glob: '数据管理/warehouse/fact/quotes_conversion/latest.parquet', prefixCheckable: false },
    { glob: '数据管理/warehouse/fact/renewal_tracker/latest.parquet', prefixCheckable: false },
  ].map((d) => ({ ...d, glob: path.join(ROOT_DIR, d.glob) }));

  const fieldsPath = path.join(ROOT_DIR, 'server/src/config/field-registry/fields.json');

  // python：先 glob 判定数据是否存在（不 import duckdb）；有数据才 import duckdb 逐文件校验。
  const py = `
import sys, json, glob
fields_path = sys.argv[1]
domains = json.loads(sys.argv[2])
import re
reg = json.load(open(fields_path))
bc = next((f for f in reg.get('fields', []) if f.get('id') == 'branch_code'), {})
deriv = bc.get('derivation', {})
mapping = deriv.get('mapping', {})
plen = int(deriv.get('prefixLength', 3))
allowed = sorted(set(mapping.values()))
# 防注入：mapping 的 key/value 必须是纯字母数字（来自 fields.json registry，受治理）。
# 任一非法即拒绝构造 SQL CASE，避免拼接注入（codex 闸-2 P1.1）。
_safe = re.compile(r'^[A-Za-z0-9]+$')
_bad_map = [f"{k}->{v}" for k, v in mapping.items() if not (_safe.match(str(k)) and _safe.match(str(v)))]
if _bad_map:
    print(json.dumps({"data_present": True, "scanned": 0,
                      "violations": [{"file": fields_path, "kind": "unsafe_mapping",
                                      "detail": ",".join(_bad_map)}]})); sys.exit(0)
files = []
for d in domains:
    # B2：policy/current 拆「顶层 + 单层 [A-Z][A-Z] 省份子目录」两条 domain（非递归，与 helper
    # ^[A-Z]{2}$ 语义一致）；省份子目录 glob 空匹配时 glob.glob 返回 []（不报错）。
    for fp in sorted(glob.glob(d['glob'])):
        files.append((fp, bool(d['prefixCheckable'])))
if not files:
    print(json.dumps({"data_present": False})); sys.exit(0)
import duckdb
con = duckdb.connect()
violations = []
NL = chr(10)
for fp, prefix_checkable in files:
    rp = "read_parquet('" + fp + "')"
    try:
        cols = [c[0] for c in con.execute("DESCRIBE SELECT * FROM " + rp).fetchall()]
    except Exception as e:
        violations.append({"file": fp, "kind": "read_error", "detail": str(e).split(NL)[0]}); continue
    if 'branch_code' not in cols:
        continue
    try:
        distinct = [r[0] for r in con.execute("SELECT DISTINCT branch_code FROM " + rp).fetchall()]
        nonnull = sorted(set(str(v) for v in distinct if v is not None and str(v).strip() != ''))
        if len(nonnull) > 1:
            violations.append({"file": fp, "kind": "mixed", "detail": ",".join(nonnull)})
        nullcnt = con.execute("SELECT COUNT(*) FROM " + rp + " WHERE branch_code IS NULL OR TRIM(branch_code) = ''").fetchone()[0]
        if nullcnt and nullcnt > 0:
            violations.append({"file": fp, "kind": "null_empty", "detail": str(nullcnt)})
        bad = [v for v in nonnull if v not in allowed]
        if bad:
            violations.append({"file": fp, "kind": "illegal_value", "detail": ",".join(bad) + " 不在 " + ",".join(allowed)})
        if prefix_checkable and 'policy_no' in cols:
            cases = " ".join("WHEN '" + k + "' THEN '" + v + "'" for k, v in mapping.items())
            # 把派生省份提为 expected_branch；未知前缀→expected 为 NULL（单列 unknown_prefix），
            # 已知但≠列省→mislabel。用 IS DISTINCT FROM 让 NULL branch_code 也参与比对，
            # 不再有 branch_code 不等于 NULL = UNKNOWN 的漏判（codex 闸-2 P1.1）。
            sub = (
                "SELECT branch_code AS bc, "
                "(CASE SUBSTR(CAST(policy_no AS VARCHAR), 1, " + str(plen) + ") " + cases + " ELSE NULL END) AS expected "
                "FROM " + rp + " WHERE policy_no IS NOT NULL AND TRIM(CAST(policy_no AS VARCHAR)) <> ''"
            )
            row = con.execute(
                "SELECT COUNT(*) FILTER (WHERE expected IS NULL), "
                "COUNT(*) FILTER (WHERE expected IS NOT NULL AND bc IS DISTINCT FROM expected) "
                "FROM (" + sub + ")"
            ).fetchone()
            unknown_cnt, mislabel_cnt = (row[0] or 0), (row[1] or 0)
            if unknown_cnt > 0:
                violations.append({"file": fp, "kind": "unknown_prefix",
                                   "detail": str(unknown_cnt) + " 行 policy_no 前缀不在 mapping 值域"})
            if mislabel_cnt > 0:
                violations.append({"file": fp, "kind": "mislabel", "detail": str(mislabel_cnt) + " 行派生省≠列省"})
    except Exception as e:
        violations.append({"file": fp, "kind": "read_error", "detail": str(e).split(NL)[0]})
print(json.dumps({"data_present": True, "scanned": len(files), "violations": violations}))
`;

  let out;
  try {
    out = execFileSync('python3', ['-c', py, fieldsPath, JSON.stringify(domains)], {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    // fail-closed：数据就绪闸里 python3/duckdb 不可用是真问题（非 CI 代码门禁），不放行
    error(`单文件不混省检测无法执行（python3/duckdb 缺失或读失败）：${String(e.message || e).split('\n')[0]}`);
    console.log('    ▶ 修复：在含 parquet 的数据环境跑（python3 + duckdb 必备）；发布链路 fail-closed');
    return false;
  }

  let r;
  try {
    r = JSON.parse(out.trim());
  } catch {
    error(`单文件不混省检测输出解析失败：${out.slice(0, 200)}`);
    return false;
  }

  if (!r.data_present) {
    success('单文件不混省检测：无生产 fact parquet（CI/非数据环境），跳过');
    return true;
  }
  if (!r.violations || r.violations.length === 0) {
    success(`单文件不混省检测通过（扫描 ${r.scanned} 个 fact parquet · 派生省==列省）`);
    return true;
  }
  error(`单文件不混省检测失败（${r.violations.length} 项）：`);
  for (const v of r.violations) {
    const rel = v.file.replace(ROOT_DIR + '/', '');
    console.log(`    - [${v.kind}] ${rel}: ${v.detail}`);
  }
  console.log('    ▶ 混省(mixed)：拆分为单文件单省；贴错标签(mislabel)：核查 ETL declared_branch；');
  console.log('    ▶ 未知前缀(unknown_prefix)：policy_no 前缀不在 mapping，疑数据损坏；NULL/非法值(illegal_value)：重跑域 ETL 派生；');
  console.log('    ▶ unsafe_mapping：fields.json branch_code mapping 含非字母数字值，须修注册表；省份以 fields.json mapping 为准');
  return false;
}

// ============================================================
// SC policy [!S]* glob 前缀隔离检测（2026-06-28 · 四川混查止血的可靠性保证）
// ============================================================
/**
 * diagnose_common.branch_paths('SC').policy_glob = fact/policy/current/[!S]*.parquet，靠文件名
 * 前缀排除 SX_ 文件（fact/current 物理混放 SC+SX，Phase A 前缀架构；裸 *.parquet 会混入 SX 致
 * 四川诊断虚高约 70%）。本闸校验该 glob 的隔离前提持续成立：
 *   - 凡 branch_code='SX' 的文件，文件名必以 'S' 开头（会被 [!S]* 排除）；
 *   - 凡 branch_code='SC' 的文件，文件名必非 'S' 开头（会被 [!S]* 保留）；
 *   - 出现第三省（branch_code ∉ {SC,SX}）→ [!S]* 方案不适用，须把 SC 路由改 WHERE branch_code。
 * 与 checkSingleProvincePerFile 互补：后者查文件「内容」单省一致 + 派生省==列省，本闸查文件
 * 「名前缀」↔省份映射（防 SX 数据用非 S 前缀文件名致 [!S]* 静默漏入，前者抓不到此情形）。
 * CI 无数据 → skip（数据相关检查本地/发布链路跑）。
 */
function checkPolicyGlobPrefixIsolation() {
  info('检查 SC policy [!S]* glob 前缀隔离前提（SX 文件名必 S 开头）...');
  const policyGlob = path.join(ROOT_DIR, '数据管理/warehouse/fact/policy/current/*.parquet');
  const py = `
import sys, json, glob, os
files = sorted(glob.glob(sys.argv[1]))
if not files:
    print(json.dumps({"data_present": False})); sys.exit(0)
import duckdb
con = duckdb.connect()
violations = []
NL = chr(10)
for fp in files:
    base = os.path.basename(fp)
    starts_S = base[:1] == 'S'
    rp = "read_parquet('" + fp + "')"
    try:
        cols = [c[0] for c in con.execute("DESCRIBE SELECT * FROM " + rp).fetchall()]
    except Exception as e:
        violations.append({"file": fp, "kind": "read_error", "detail": str(e).split(NL)[0]}); continue
    if 'branch_code' not in cols:
        continue
    distinct = [r[0] for r in con.execute("SELECT DISTINCT branch_code FROM " + rp).fetchall()]
    nonnull = sorted(set(str(v) for v in distinct if v is not None and str(v).strip() != ''))
    for bc in nonnull:
        if bc not in ('SC', 'SX'):
            violations.append({"file": fp, "kind": "third_province",
                               "detail": "branch_code=" + bc + " 非 SC/SX，[!S]* 方案不适用，须改 WHERE branch_code"})
        elif bc == 'SX' and not starts_S:
            violations.append({"file": fp, "kind": "sx_not_excluded",
                               "detail": "branch_code=SX 但文件名非 S 开头，SC 的 [!S]* glob 会误读入致四川混查"})
        elif bc == 'SC' and starts_S:
            violations.append({"file": fp, "kind": "sc_wrongly_excluded",
                               "detail": "branch_code=SC 但文件名 S 开头，SC 的 [!S]* glob 会误排除致四川漏读"})
print(json.dumps({"data_present": True, "scanned": len(files), "violations": violations}))
`;
  let out;
  try {
    out = execFileSync('python3', ['-c', py, policyGlob], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    error(`[!S]* glob 前缀隔离检测无法执行（python3/duckdb 缺失或读失败）：${String(e.message || e).split('\n')[0]}`);
    return false;
  }
  let r;
  try {
    r = JSON.parse(out.trim());
  } catch {
    error(`[!S]* glob 前缀隔离检测输出解析失败：${out.slice(0, 200)}`);
    return false;
  }
  if (!r.data_present) {
    success('[!S]* glob 前缀隔离检测：无生产 policy parquet（CI/非数据环境），跳过');
    return true;
  }
  if (!r.violations || r.violations.length === 0) {
    success(`[!S]* glob 前缀隔离前提成立（扫描 ${r.scanned} 个 policy parquet · SX 文件名皆 S 开头）`);
    return true;
  }
  error(`[!S]* glob 前缀隔离前提被破坏（${r.violations.length} 项 · 四川诊断混查/漏读风险）：`);
  for (const v of r.violations) {
    const rel = v.file.replace(ROOT_DIR + '/', '');
    console.log(`    - [${v.kind}] ${rel}: ${v.detail}`);
  }
  console.log('    ▶ sx_not_excluded：SX 文件须用 SX_ 前缀命名（ETL 落盘命名规范）；');
  console.log('    ▶ third_province：第三省须把 diagnose_common SC 路由改 WHERE branch_code（[!S]* 仅 SC/SX 两省成立）；');
  console.log('    ▶ 关联：diagnose_common.branch_paths SC policy_glob = current/[!S]*.parquet');
  return false;
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
  if (valuePatterns.some(re => re.test(content))) return true;

  // 规则3：PAT 明文（cx_pat_<id8>.<secret43>，见 server PAT 设计——明文仅生成时返回一次，
  // 任何落盘即泄漏）。文档占位串（secret 段同字符重复，如 xxxx…）不算泄漏。
  const patRe = new RegExp('cx_pat' + '_[A-Za-z0-9]{8}\\.([A-Za-z0-9_\\-]{40,})', 'g');
  for (const m of content.matchAll(patRe)) {
    if (!/^(.)\1+$/.test(m[1])) return true;
  }
  return false;
}

/**
 * 阻止含 token 的 Playwright auth 状态文件或含敏感 token 值赋值的文件进入提交。
 * 根因：此前某次提交误将 output/playwright/.auth/user.json（包含 token 字段）直接提交到仓库。
 */
function checkStagedCredentials() {
  info('检查暂存区凭据/敏感产物...');

  const stagedFiles = getStagedFiles();
  if (stagedFiles === null) {
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
    const scriptFiles = tracked.filter(f => f.endsWith('.py') || f.endsWith('.ts') || f.endsWith('.mjs'));
    if (scriptFiles.length === 0) {
      success('无已跟踪脚本需要审计');
      return true;
    }
    // 单次 --stdin 批量查询（原实现逐文件 spawn 一次 git check-ignore，数百次进程创建是
    // governance 耗时黑洞——2026-07-04 奥卡姆批次一改为 1 次进程）。
    // 退出码约定：0=至少一个被忽略（stdout 列出）；1=全部不被忽略；≥128=真错误。
    let ignoredOut = '';
    try {
      ignoredOut = execFileSync('git', ['check-ignore', '--stdin'], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        input: scriptFiles.join('\n'),
      });
    } catch (e) {
      if (e.status === 1) {
        ignoredOut = ''; // 无命中，正常
      } else {
        throw e;
      }
    }
    const shadowed = ignoredOut.split('\n').filter(Boolean);
    if (shadowed.length > 0) {
      shadowed.forEach(f => warning(`.gitignore 会忽略已跟踪文件: ${f}（修改后将无法提交新变更）`));
      warning(`${shadowed.length} 个已跟踪脚本被 .gitignore 规则覆盖，修改后无法 git add`);
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

// 17b. 指标字典同步：metric-registry → 开发文档/指标字典.md codegen 产物一致性
//      2026-06-27 新增，根治长期 drift 双根因：旧脚本硬编码 5/9 分类漏 14 指标（repair/plan/
//      structure/renewal），且 regen 不在 package.json / CLAUDE.md §2 流程 / CI 任何一处。
//      与 #17 字段定义一致同构：靠 --check 逐字节比对，注册表一改忘 regen 即变红。
function checkMetricDocConsistency() {
  info('检查指标字典同步（metric-registry → 开发文档/指标字典.md）...');
  try {
    const result = execSync('bun scripts/metric-registry/generate-metric-doc.ts --check', {
      cwd: ROOT_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    const countMatch = result.match(/(\d+) 个指标/);
    const count = countMatch ? countMatch[1] : '?';
    success(`指标字典同步（${count} 个指标，开发文档/指标字典.md 与注册表一致）`);
    return true;
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    error('指标字典.md 与注册表不同步 — 运行 bun scripts/metric-registry/generate-metric-doc.ts 重新生成');
    output.split('\n').filter((l) => l.includes('✗')).forEach((l) => console.log(`    ${l.trim()}`));
    return false;
  }
}

// ============================================================
// 18. Dark Mode 质量门禁
// ============================================================

// 2026-07-04 奥卡姆批次一：DarkMode/ECharts 两项属 UI 风格 lint 而非治理一致性，
// 已移出 CODE_GOVERNANCE_CHECKS 主链，由 scripts/lint-ui.mjs（bun run lint:ui）独立承载，能力保留。
export function checkDarkModeQuality() {
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

export function checkEchartsSplitLine() {
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
    // B3：policy/current 用共享 helper 枚举子目录，key 规则与 writeSyncManifest 同源（codex 闸-1 P1-1）。
    if (dir.label === 'policy/current') {
      for (const shard of listPolicyCurrentShards(absPath)) {
        const key = shard.branch ? `${dir.label}/${shard.branch}/${shard.name}` : `${dir.label}/${shard.name}`;
        const stat = fs.statSync(shard.path);
        currentFiles[key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
      }
      continue;
    }
    const parquets = fs.readdirSync(absPath).filter(f => f.endsWith('.parquet'));
    for (const f of parquets) {
      const key = `${dir.label}/${f}`;
      const stat = fs.statSync(path.join(absPath, f));
      currentFiles[key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
    }
  }

  Object.assign(currentFiles, collectValidationDimFileEntries(path.join(ROOT_DIR, '数据管理/warehouse/validation')));
  // validation 事实域副本（claims_detail/quotes_conversion/...）：与 sync-vps buildValidationBranchSyncTasks
  // 写入 manifest 的键严格对称，否则新增同步域后本地扫描失明 → 「已删除」误报拦停发布
  // （2026-07-11 repair_resource 等 11 键实证；域清单 SSOT = VALIDATION_SYNCED_FACT_DOMAINS）
  Object.assign(currentFiles, collectValidationFactFileEntries(path.join(ROOT_DIR, '数据管理/warehouse/validation')));

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
// （已退役）第22项检查：SQL 模块数与 CODE_INDEX 一致性 —— 2026-07-04 奥卡姆批次一
// 退役理由：与「CLAUDE.md计数防漂移」闸哲学冲突——本检查强制在 CODE_INDEX.md 维护
// 会随迭代漂移的精确计数，而防漂移闸的判词恰是"这类数字 AI 干活不需要（会去 grep
// 目录/注册表），留着只会漂移 + 误导，应改『以 X 为准』指针"。
// CODE_INDEX.md 的 SQL 模块计数已同步改为指针表述，本检查随之删除。
// ============================================================

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

// （已迁移）checkEtlMultiSheetCompliance → scripts/governance/pattern-rules.mjs 规则 etl-multisheet（奥卡姆批次二，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs）

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

// （已迁移）checkFilterParamsBypass → pattern-rules.mjs；双锁一致性/省份映射镜像 → governance/dual-lock-and-branch-mirror-checks.mjs（H5 棘轮 ≤4000，仿 upload-size-consistency.mjs）

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

// （已迁移）checkBundleRoutesGuard → scripts/governance/pattern-rules.mjs 规则 bundle-routes-guard（奥卡姆批次二，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs）

// ============================================================
// 路由对账共享工具（奥卡姆批次三：原先在 query / 非query 两个对账检查内重复实现）
// ============================================================

/** 从 api-routes.ts 源码提取 `export const <NAME>` 花括号块内所有 '/path' 字面量集合；未找到该导出返回 null */
function extractConstPathSet(source, constName) {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) return null;
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  return new Set([...source.slice(braceStart, braceEnd).matchAll(/'(\/[^']*)'/g)].map((m) => m[1]));
}

/** 参数化路由归一：'/foo/:id' → '/foo' */
const paramBase = (p) => (p.includes('/:') ? p.slice(0, p.indexOf('/:')) : p);

/** query/ 路由目录中的非业务端点文件（公共模块/纯分发器/纯文件 IO）——RLS 覆盖与立方体影子覆盖两闸共用 */
const QUERY_ROUTE_EXEMPT = new Set([
  'shared.ts', // 公共模块，非路由
  'bundles.ts', // 仅 router.use 子路由分发，无业务端点
]);

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
  // 共享工具 extractConstPathSet / paramBase 见文件上方（奥卡姆批次三去重）
  const constants = extractConstPathSet(apiRoutesSrc, 'QUERY_ROUTES') ?? new Set();
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

/**
 * 非 query 路由域对账（BACKLOG 2026-07-03-claude-7982a9）
 *
 * 背景：checkQueryCatalogConsistency 只扫描 server/src/routes/query/，对 auth/data/ai/
 * filters/workflows/copilot/admin/reports/skills/discover/wecom-auth 以及 server/src/agent/
 * routes/ 下的路由零对账——上一批（PR #874 前后）刚补的 AUTH_ROUTES 缺 '/route-catalog' 键
 * 就是这个盲区暴露的真实漂移实例。本检查把"挂载 GET 端点 ↔ api-routes.ts 常量表"的对账模型
 * 扩到这些目录，但不发明 query-catalog 那种三方（挂载/catalog/常量）模型——这些域没有
 * route-catalog 元数据表，只对账"挂载 vs 常量"两方。
 *
 * 扫描范围：server/src/routes/（除 query/ 子目录，那边由 checkQueryCatalogConsistency 覆盖）
 * + server/src/agent/routes/。
 *
 * 对账目标：每个路由文件 → api-routes.ts 里对应的常量表（按 app.ts 的 app.use 前缀关联）。
 * 部分路由文件（admin/reports/skills/discover/discover-fields-view/wecom-auth）在
 * api-routes.ts 里没有任何常量表——不是遗漏，是历史上从未建过；这类文件登记进
 * KNOWN_GAP_FILES，每条注明原因，防止本检查静默漏扫。
 */
function checkNonQueryRoutesConsistency() {
  info('检查非 query 路由域对账（挂载端点 ↔ api-routes.ts 常量表，query/ 域外的另一半盲区）...');

  const routesDir = path.join(ROOT_DIR, 'server/src/routes');
  const agentRoutesDir = path.join(ROOT_DIR, 'server/src/agent/routes');
  const apiRoutesFile = path.join(ROOT_DIR, 'server/src/config/api-routes.ts');
  const apiRoutesSrc = fs.readFileSync(apiRoutesFile, 'utf-8');

  // 路由文件 → api-routes.ts 常量导出名。已知无常量表的文件登记原因（不静默跳过）。
  const FILE_TO_CONSTANT = {
    'auth.ts': 'AUTH_ROUTES',
    'data.ts': 'DATA_ROUTES',
    'ai.ts': 'AI_ROUTES',
    'filters.ts': 'FILTER_ROUTES',
    'workflows.ts': 'WORKFLOWS_ROUTES',
    'copilot.ts': 'COPILOT_ROUTES',
  };
  const AGENT_FILE_TO_CONSTANT = {
    'agent-audit.ts': 'AGENT_AUDIT_ROUTES',
    'agent-diagnosis.ts': 'AGENT_DIAGNOSIS_ROUTES',
    'agent-explain.ts': 'AGENT_EXPLAIN_ROUTES',
    'agent-forecast.ts': 'AGENT_FORECAST_ROUTES',
  };
  // 已知缺口：文件存在路由但 api-routes.ts 无对应常量表。逐项注明原因，
  // 到"实现常量表"那天从此清单移除即视为治理提升（而非放宽豁免）。
  const KNOWN_GAP_FILES = {
    'admin.ts': '仅 1 个内部运维端点（POST /data/reload），无前端/CLI/MCP 消费方，未建常量表',
    'reports.ts': '路径含 :reportId/:snapshot/* 通配符文件服务路由，非结构化 API，常量表意义有限',
    'skills.ts': '本地技能编排路由（/api/skills/*），面向内部 skill 运行时而非前端类型安全引用',
    'discover.ts': 'Agent 自解释发现端点（/fields /metrics /presets /schema /legend），无前端常量消费方',
    'feishu-auth.ts': '挂载前缀 /api/auth/feishu 与 AUTH_ROUTES.FEISHU_CONFIG(/feishu/config) 路径段拼接口径不同，需专项对齐后再纳入对账',
  };

  function extractMountedRoutes(filePath) {
    const src = fs
      .readFileSync(filePath, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const routes = [];
    // 覆盖单行 `router.get('/path', ...)` 与跨行 `router.get(\n  '/path'` 两种写法
    for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*\n?\s*'(\/[^']*)'/g)) {
      routes.push(m[2]);
    }
    return routes;
  }

  // 共享工具 extractConstPathSet / paramBase 见文件上方（奥卡姆批次三去重）
  const extractConstantValues = (constName) => extractConstPathSet(apiRoutesSrc, constName);

  const missingInConstants = []; // { file, route }
  const staleGapEntries = []; // 文件已在 KNOWN_GAP_FILES 但其实有常量表可对账了（陈旧豁免）

  const scannedFiles = [];
  if (fs.existsSync(routesDir)) {
    for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) continue; // query/ 子目录由 checkQueryCatalogConsistency 覆盖，__tests__ 跳过
      if (!entry.name.endsWith('.ts')) continue;
      scannedFiles.push({ name: entry.name, full: path.join(routesDir, entry.name), map: FILE_TO_CONSTANT });
    }
  }
  if (fs.existsSync(agentRoutesDir)) {
    for (const entry of fs.readdirSync(agentRoutesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      scannedFiles.push({ name: entry.name, full: path.join(agentRoutesDir, entry.name), map: AGENT_FILE_TO_CONSTANT });
    }
  }

  const unrecognizedFiles = [];
  for (const { name, full, map } of scannedFiles) {
    const mounted = extractMountedRoutes(full);
    // 零挂载路由的文件（纯聚合器如 query.ts 只 router.use 子路由、或纯视图模块如
    // discover-fields-view.ts）无对账对象，天然跳过——不算"未登记"，因为没有路由可漂移。
    if (mounted.length === 0) continue;

    if (name in KNOWN_GAP_FILES) {
      // 陈旧豁免检测：如果该文件其实已经有常量表了，说明豁免该移除
      const maybeConst = map[name];
      if (maybeConst && extractConstantValues(maybeConst)) {
        staleGapEntries.push(name);
      }
      continue;
    }
    const constName = map[name];
    if (!constName) {
      unrecognizedFiles.push(name);
      continue;
    }
    const constValues = extractConstantValues(constName);
    if (!constValues) {
      unrecognizedFiles.push(`${name}（声明对应常量 ${constName} 但 api-routes.ts 未找到该导出）`);
      continue;
    }
    for (const route of mounted) {
      const base = paramBase(route);
      if (!constValues.has(route) && !constValues.has(base)) {
        missingInConstants.push({ file: `server/src/routes/${name}`, route });
      }
    }
  }

  if (unrecognizedFiles.length > 0) {
    error(`非 query 路由文件既未登记常量映射也未登记 known-gap = ${unrecognizedFiles.length} 个：`);
    for (const f of unrecognizedFiles) console.log(`    - ${f}`);
    console.log('    修复：在 checkNonQueryRoutesConsistency 的 FILE_TO_CONSTANT/AGENT_FILE_TO_CONSTANT 补映射，或登记 KNOWN_GAP_FILES 并注明原因');
    return false;
  }

  if (staleGapEntries.length > 0) {
    error(`KNOWN_GAP_FILES 豁免已陈旧（该文件已有对应常量表可对账）= ${staleGapEntries.length} 个：`);
    for (const f of staleGapEntries) console.log(`    - ${f}`);
    console.log('    修复：从 checkNonQueryRoutesConsistency 的 KNOWN_GAP_FILES 移除该条目，纳入正式对账');
    return false;
  }

  if (missingInConstants.length > 0) {
    error(`已挂载但未登记 api-routes.ts 常量（前端/CLI 无法类型安全引用）= ${missingInConstants.length} 条：`);
    for (const { file, route } of missingInConstants) console.log(`    - ${file}: ${route}`);
    console.log('    修复：在 server/src/config/api-routes.ts 对应常量表补键（前端镜像 src/shared/api/routes.ts 同步）');
    return false;
  }

  const totalScanned = scannedFiles.length;
  const totalGaps = Object.keys(KNOWN_GAP_FILES).length;
  success(`非 query 路由域对账通过（扫描 ${totalScanned} 个路由文件，${totalGaps} 个登记 known-gap，其余均对账一致）`);
  return true;
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
  { name: '单文件不混省', fn: checkSingleProvincePerFile },
  // 2026-07-04 奥卡姆批次一：依赖真实 Parquet（CI 恒 skip）的数据检查从代码门禁移入数据就绪链，
  // 与同族「单文件不混省」归位一致
  {
    name: 'SC policy glob前缀隔离',
    fn: checkPolicyGlobPrefixIsolation,
    retireWhen: 'B3 子目录隔离落地后随前缀防线退役（BACKLOG 2026-06-23-claude-801409 退役清单）',
  },
];

// post-sync 检查：sync-vps 之后跑（本地 vs VPS 清单一致性，ETL 后必然先漂移再同步）
export const POST_SYNC_READINESS_CHECKS = [
  { name: '数据漂移检测', fn: checkDataDrift },
];

// 保留旧名以兼容现有调用方（=pre+post 全集，单独跑时全部项通过才通过）
export const DATA_READINESS_CHECKS = [
  ...PRE_SYNC_READINESS_CHECKS,
  ...POST_SYNC_READINESS_CHECKS,
];

// （已合并）checkCubeShadowTolerance → checkCubeInvariants（奥卡姆批次三，配置下沉 scripts/shared/cube-routes.mjs）

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
  const EXEMPT = QUERY_ROUTE_EXEMPT; // 与立方体影子路由覆盖共用同一豁免清单（奥卡姆批次三去重）
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

// （已合并）checkCubeShadowRouteCoverage → checkCubeInvariants（奥卡姆批次三，配置下沉 scripts/shared/cube-routes.mjs）

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

// （已合并）checkCubeVersionBinding / checkCubeSqlThreePieceShape → checkCubeInvariants（奥卡姆批次三）

// （已迁移）checkCubeRoutesSSOT → scripts/governance/pattern-rules.mjs 规则 cube-routes-ssot（奥卡姆批次二，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs）

/**
 * 立方体不变量（奥卡姆批次三：原「影子对账容差 / 影子路由覆盖 / SQL三件套 / 版本绑定」
 * 四项合并为一项，判定逻辑与失败文案保真自原函数，历史实现见 git）。
 * 三张手工同步表（三件套导出 / state 名 / 文件名映射）已下沉 scripts/shared/cube-routes.mjs
 * 单一事实源——新增 cube 只改那一处，本检查自动跟上。
 */
function checkCubeInvariants() {
  info('检查立方体不变量（容差红线 / 影子路由覆盖 / SQL三件套 / 版本绑定，SSOT=cube-routes.mjs）...');
  let allOk = true;

  // ① 影子对账数值容差红线：AI 易放宽容差"消除 mismatch"，但 1e-9 已是 DuckDB
  //    浮点求和顺序差异的物理下限；真正的口径 mismatch 应改改写器/白名单/集成测试
  const shadowSvc = path.join(ROOT_DIR, 'server/src/services/cube-shadow.ts');
  if (!fs.existsSync(shadowSvc)) {
    warning('cube-shadow.ts 不存在，跳过容差红线（立方体未启用）');
  } else {
    const tolMatch = fs.readFileSync(shadowSvc, 'utf-8').match(/const\s+NUMERIC_TOLERANCE\s*=\s*([^\s;]+)/);
    if (!tolMatch) {
      error('cube-shadow.ts 缺少 NUMERIC_TOLERANCE 常量定义');
      allOk = false;
    } else if (tolMatch[1] !== '1e-9') {
      error(`cube-shadow.ts 的 NUMERIC_TOLERANCE 被改为 ${tolMatch[1]}，不可放宽（1e-9 已是 DuckDB 浮点求和顺序差异的物理下限）`);
      error('  正确做法：mismatch 出现时改 sql/cube/<route>-cube.ts 改写器 / 白名单 / 补集成测试，不是改容差');
      allOk = false;
    }
  }

  // ② 影子路由覆盖：路由 handler 的 runShadowCompare key ↔ SHADOW_KEYS 白名单双向对账
  const ROUTE_DIR = path.join(ROOT_DIR, 'server/src/routes/query');
  if (!fs.existsSync(ROUTE_DIR)) {
    warning('server/src/routes/query 不存在，跳过影子路由覆盖');
  } else {
    const foundKeys = new Set();
    const KEY_RE = /\brunShadowCompare\(\s*['"]([^'"]+)['"]/g;
    for (const name of fs.readdirSync(ROUTE_DIR)) {
      if (QUERY_ROUTE_EXEMPT.has(name) || !name.endsWith('.ts')) continue;
      const filePath = path.join(ROUTE_DIR, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const src = fs.readFileSync(filePath, 'utf-8');
      KEY_RE.lastIndex = 0;
      let m;
      while ((m = KEY_RE.exec(src)) !== null) foundKeys.add(m[1]);
    }
    const missingKeys = SHADOW_KEYS.filter((k) => !foundKeys.has(k));
    const extraKeys = [...foundKeys].filter((k) => !SHADOW_KEYS.includes(k));
    if (missingKeys.length > 0 || extraKeys.length > 0) {
      error('立方体影子路由覆盖失败：');
      if (missingKeys.length > 0) error(`  缺漏 key（路由 handler 未调 runShadowCompare）：${missingKeys.join(', ')}`);
      if (extraKeys.length > 0) {
        error(`  多余 key（新增 cube 路由未登记到白名单）：${extraKeys.join(', ')}`);
        error("  如新增 cube 路由：handler 调 runShadowCompare('<key>', ...) + 更新 scripts/shared/cube-routes.mjs（SSOT）");
      }
      allOk = false;
    }
  }

  // ③ 主 cube SQL 三件套导出：servability gate 防误对账；buildXxxCubeSql 防 OOM 死循环；
  //    generateXxxCubeQuery 三阶段构建。清单来自 SSOT 的 MAIN_CUBES（growth/kpi 复用不在列）
  const CUBE_SQL_DIR = path.join(ROOT_DIR, 'server/src/sql/cube');
  for (const cube of MAIN_CUBES) {
    const filePath = path.join(CUBE_SQL_DIR, cube.sql.file);
    if (!fs.existsSync(filePath)) {
      error(`主 cube 文件缺失：server/src/sql/cube/${cube.sql.file}`);
      allOk = false;
      continue;
    }
    // 剥离注释后再检测，防止 `// export function X()` 误判为存在导出
    const src = stripComments(fs.readFileSync(filePath, 'utf-8'));
    const missingExports = cube.sql.exports.filter(
      (fn) => !new RegExp(`\\bexport\\b[\\s\\S]{0,20}\\b${fn}\\b`).test(src),
    );
    if (missingExports.length > 0) {
      error(`${cube.sql.file} 缺漏导出：${missingExports.join(', ')}`);
      allOk = false;
    }
  }

  // ④ builtVersion 绑定合规（防 PR #645 回归）：右值只允许 versionAtStart（标准绑定）或
  //    null（reset）；间接变量 / fallback / 直接调 getDataVersion() 均非法（ETL 推进会污染状态）
  const CUBE_SVC = path.join(ROOT_DIR, 'server/src/services/duckdb-cube.ts');
  if (!fs.existsSync(CUBE_SVC)) {
    warning('server/src/services/duckdb-cube.ts 不存在，跳过版本绑定');
  } else {
    const src = fs.readFileSync(CUBE_SVC, 'utf-8');
    const srcLines = src.split('\n');
    const ASSIGN_RE = new RegExp(`\\b(${CUBE_STATE_NAMES.join('|')})\\.builtVersion\\s*=(?!=)\\s*([^;]+);`, 'g');
    const violations = [];
    let m;
    while ((m = ASSIGN_RE.exec(src)) !== null) {
      const rhs = m[2].trim().replace(/;$/, '').trim();
      if (rhs === 'null' || rhs === 'versionAtStart') continue;
      const lineNo = src.slice(0, m.index).split('\n').length;
      violations.push({ line: lineNo, text: srcLines[lineNo - 1].trim(), rhs });
    }
    if (violations.length > 0) {
      error('builtVersion 绑定违规（PR #645 历史教训：ETL 推进期间用动态值赋值会污染 cube 状态）：');
      for (const v of violations) error(`  L${v.line}: ${v.text}  （右值：${v.rhs}）`);
      error('  修复：OOM 降级须在 materializeXxxCube 函数体内取 versionAtStart 后绑定；禁间接变量 / fallback / 直接调用');
      allOk = false;
    }
  }

  if (allOk) {
    success('立方体不变量通过（容差 1e-9 · 影子路由覆盖完整 · 三件套导出齐全 · builtVersion 绑定合规）');
  }
  return allOk;
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

// ============================================================
// 前端分层依赖边界（B330 防回归 · 2026-06-15-claude-2e017d；layout↛features 由 edbd61 补全）
// ============================================================
//
// 守 ARCHITECTURE.md §2.2：L1 共享层（shared/widgets/components）不依赖 L2 特性层（features/*），
// 各 L2 域禁横向互引，前端禁 import 后端 server/src。已修复但无闸 → 静默回退
// （CLAUDE.md「规则必须自动化执行」）。规则 SSOT：.claude/rules/architecture.md（path-scoped）。
//
// 设计要点（与 codex gate-1/gate-2 对齐）：用 TS AST 解析模块说明符（import / import type /
// export...from / 动态 import() / require() / 无插值模板串），归一 @/features、相对路径、server/src，
// 无法靠改写 import 形式绕过；逃生阀 marker 必须带 backlog/PR 引用，裸 marker 无效（防后门）。
// 8 条边界：依赖倒置（widgets/shared/components↛features）+ 前后端越界（前端三层↛server）+
// feature→feature 定向 denylist（B330 原始 growth→dashboard / quote-conversion→filters）。

const ARCH_BOUNDARY_RULES = [
  // from = 文件所在层（前缀，POSIX 路径）；to = 禁止解析到的目标层；desc 报错文案
  { from: 'src/widgets/', to: 'features', desc: 'src/widgets 禁依赖 features（依赖倒置）' },
  { from: 'src/shared/', to: 'features', desc: 'src/shared 禁依赖 features（依赖倒置）' },
  // components(layout) ↛ features：业务 Modal/Panel 由上层 slot 注入或迁入所属特性域（edbd61）
  { from: 'src/components/', to: 'features', desc: 'src/components(layout) 禁依赖 features（依赖倒置）' },
  // 前后端越界：全前端（features/shared/widgets）禁实值/类型 import server/src（codex gate-2 P1 收齐三层）
  { from: 'src/features/', to: 'server', desc: 'src/features 禁依赖 server/src（前后端越界）' },
  { from: 'src/shared/', to: 'server', desc: 'src/shared 禁依赖 server/src（前后端越界）' },
  { from: 'src/widgets/', to: 'server', desc: 'src/widgets 禁依赖 server/src（前后端越界）' },
  { from: 'src/features/growth/', to: 'features/dashboard', desc: 'growth 禁横向依赖 dashboard（L2→L2）' },
  { from: 'src/features/quote-conversion/', to: 'features/filters', desc: 'quote-conversion 禁横向依赖 filters（L2→L2）' },
];

export const ARCH_BOUNDARY_RULES_EXPORT = ARCH_BOUNDARY_RULES;

const ARCH_ALLOW_MARK = 'governance-allow: arch-boundary';
// 逃生阀必须带 backlog uid / PR 号 / B 编号引用，裸 marker 无效（防回归后门）
const ARCH_ALLOW_REF = /(B\d{2,4}|\d{4}-\d{2}-\d{2}-[\w-]+|#\d+)/;

/**
 * 逃生阀 marker 是否有效。要求三件套（codex gate-2 P2 收紧）：
 *   1) 含 'governance-allow: arch-boundary' 关键字
 *   2) 带 backlog uid / PR 号 / B 编号引用
 *   3) 引用之后还有非空「一句理由」（≥2 个非空白字符），裸引用不予豁免
 * 供单测复用。
 */
export function isValidArchAllowMark(line) {
  if (!line.includes(ARCH_ALLOW_MARK)) return false;
  const m = line.match(ARCH_ALLOW_REF);
  if (!m) return false;
  const after = line.slice(m.index + m[0].length).trim();
  return after.replace(/\s+/g, '').length >= 2;
}

/**
 * 纯函数：给定「文件相对路径」「归一后的目标层」，判定是否违反某条边界规则。
 * 返回命中的规则描述数组（空 = 不违规）。供单测直接喂字符串验证 7 条规则。
 */
export function classifyArchViolations(relPosix, normalizedTarget) {
  const hits = [];
  for (const rule of ARCH_BOUNDARY_RULES) {
    if (!relPosix.startsWith(rule.from)) continue;
    const hit = rule.to === 'server'
      ? (normalizedTarget.startsWith('server/') || normalizedTarget === 'server' || normalizedTarget.includes('/server/src/'))
      : (normalizedTarget === rule.to || normalizedTarget.startsWith(`${rule.to}/`));
    if (hit) hits.push(rule.desc);
  }
  return hits;
}

/**
 * 把模块说明符归一为「逻辑层标识」：
 * - @/features/... 或 features 相对路径 → 含 'features/<域>'
 * - server/src/... 或 ../server 相对路径 → 含 'server'
 * 返回用于 startsWith/includes 匹配的归一字符串（不解析磁盘路径，按目录段语义判定）。
 */
export function normalizeArchTarget(spec, fileAbsPath) {
  // 别名形式：@/features/dashboard → features/dashboard
  if (spec.startsWith('@/')) return spec.slice(2);
  // 相对路径：相对当前文件解析为仓库内 POSIX 相对路径
  if (spec.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fileAbsPath), spec);
    const rel = path.relative(ROOT_DIR, resolved).split(path.sep).join('/');
    // 去掉 src/ 前缀，使其与别名形式（features/...）可比
    return rel.startsWith('src/') ? rel.slice(4) : rel;
  }
  // 裸包名（含 server/src 直引这种少见但 B330 列出的越界）
  return spec;
}

/** 用 TS AST 抽取文件里所有模块说明符（import/export from/dynamic import/require）。 */
export function extractModuleSpecifiers(ts, sourceText, fileName) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs = []; // { spec, line }
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line; // 0-based
  const push = (specNode, anchorNode) => {
    // 接受普通字符串字面量 + 无插值模板字符串（`...`）——二者语义等价，
    // 防 import(`@/features/...`) / require(`server/src/...`) 反引号绕过（codex gate-2 P1）
    if (specNode && (ts.isStringLiteral(specNode) || ts.isNoSubstitutionTemplateLiteral(specNode))) {
      specs.push({ spec: specNode.text, line: lineOf(anchorNode || specNode) });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) push(node.moduleSpecifier, node);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) push(node.moduleSpecifier, node);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression, node);
    } else if (ts.isCallExpression(node)) {
      // 动态 import('...') / require('...')
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynImport || isRequire) && node.arguments.length > 0) push(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

function checkArchLayerBoundaries() {
  info('检查前端分层依赖边界（B330 防回归：shared/widgets/components↛features、features↛server、L2 横向）...');

  const require = createRequire(import.meta.url);
  let ts;
  try {
    ts = require('typescript');
  } catch {
    error('typescript 未安装，无法做 AST 边界扫描（应在 devDependencies）');
    return false;
  }

  const srcRoot = path.join(ROOT_DIR, 'src');
  if (!fs.existsSync(srcRoot)) {
    warning('src 不存在，跳过分层边界检查');
    return true;
  }

  const violations = [];
  let scanned = 0;

  walkDir(srcRoot, (full) => {
    if (!/\.(ts|tsx)$/.test(full)) return;
    if (full.includes(`${path.sep}node_modules${path.sep}`)) return;
    const relPosix = path.relative(ROOT_DIR, full).split(path.sep).join('/');
    // 只扫被某条规则的 from 覆盖的文件，省时
    const applicable = ARCH_BOUNDARY_RULES.filter((r) => relPosix.startsWith(r.from));
    if (applicable.length === 0) return;
    scanned += 1;

    const text = fs.readFileSync(full, 'utf-8');
    const lines = text.split('\n');
    let specs;
    try {
      specs = extractModuleSpecifiers(ts, text, full);
    } catch (e) {
      warning(`AST 解析失败（跳过该文件）：${relPosix} — ${e.message}`);
      return;
    }

    for (const { spec, line } of specs) {
      const target = normalizeArchTarget(spec, full);
      const hitDescs = classifyArchViolations(relPosix, target);
      if (hitDescs.length === 0) continue;
      // 逃生阀：命中行或上一行带合法 marker（marker + backlog/PR 引用）
      const cur = lines[line] || '';
      const prev = line > 0 ? lines[line - 1] || '' : '';
      if (isValidArchAllowMark(cur) || isValidArchAllowMark(prev)) continue;
      for (const desc of hitDescs) {
        violations.push(`${relPosix}:${line + 1}  →  '${spec}'  （违反：${desc}）`);
      }
    }
  });

  if (violations.length > 0) {
    error(`发现架构分层依赖违规 = ${violations.length} 处（B330 已修复，禁回退）：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复：被引用的 hook/组件/类型上提 src/shared/；前端需后端类型走 src/shared/types/ 镜像');
    console.log('    确有正当理由保留：命中行或上一行加 `// governance-allow: arch-boundary <B编号/PR号> <理由>`');
    console.log('    依据：.claude/rules/architecture.md · ARCHITECTURE.md §2.2 · BACKLOG B330');
    return false;
  }

  success(`前端分层依赖边界检查通过（扫描 ${scanned} 文件，0 违规）`);
  return true;
}

/**
 * 裸 spawn 参数引号安全（foot-gun 防回归）
 *
 * 病根：daily.mjs runPythonScript 内中央剥离 argv 最外层双引号（lib/arg-quotes.mjs），
 * 故历史 `"${path}"` 写法经它调用时安全（剥离后是裸路径）。但任何 **绕过 runPythonScript**
 * 的裸 spawnSync / execFileSync 若照搬 `"${path}"`，引号不会被剥离 → Python 端
 * Path('"…"').exists() 判 false → 静默跳过（new_energy_claims 曾踩坑）。
 *
 * 规则：数据管理/daily.mjs 内 spawnSync(...) / execFileSync(...) 的 argv 数组字面量，
 * 元素不得是「以双引号开头的反引号模板」（`"${...}"` 形态）。要传路径就传裸变量，
 * 由调用方保证不带字面引号；确需引号处理则改走 runPythonScript。
 *
 * 用 AST 精确命中「直接 spawn 的 argv 数组里的带引号模板」——经 runPythonScript 的调用
 * 其内部 spawnSync 只见 `...cleanArgs` 展开、无字面模板，故零误报。
 */
function checkSpawnArgQuoteSafety() {
  info('检查裸 spawn 参数引号安全（daily.mjs 禁绕过 runPythonScript 照搬 `"${path}"`）...');

  const require = createRequire(import.meta.url);
  let ts;
  try {
    ts = require('typescript');
  } catch {
    error('typescript 未安装，无法做 AST 扫描（应在 devDependencies）');
    return false;
  }

  const SCAN_FILES = ['数据管理/daily.mjs'];
  const DIRECT_SPAWN = new Set(['spawnSync', 'execFileSync']);
  const violations = [];

  for (const rel of SCAN_FILES) {
    const full = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(full)) {
      violations.push(`${rel}（文件不存在，无法校验）`);
      continue;
    }
    const text = fs.readFileSync(full, 'utf-8');
    let sf;
    try {
      sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    } catch (e) {
      error(`AST 解析失败：${rel} — ${e.message}`);
      return false;
    }

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        DIRECT_SPAWN.has(node.expression.text)
      ) {
        for (const arg of node.arguments) {
          if (!ts.isArrayLiteralExpression(arg)) continue;
          for (const el of arg.elements) {
            // foot-gun 形态：以双引号开头的反引号模板，如 `"${tmpOutput}"`
            if (el.getText(sf).trim().startsWith('`"')) {
              const line = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
              violations.push(`${rel}:${line}  →  ${node.expression.text}(...) argv 含字面引号模板 ${el.getText(sf).trim()}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  if (violations.length > 0) {
    error(`发现裸 spawn argv 带字面引号 = ${violations.length} 处（绕过 runPythonScript 剥引号 → Python Path.exists 判 false 静默跳过）：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复：裸 spawnSync/execFileSync 传路径用裸变量（不加字面引号）；确需引号处理走 runPythonScript');
    console.log('    依据：数据管理/lib/arg-quotes.mjs · tests/arg-quotes.test.ts');
    return false;
  }

  success('裸 spawn 参数引号安全检查通过（daily.mjs 无绕过 runPythonScript 的带引号 argv）');
  return true;
}

// （已迁移）checkBranchCodeFallbackAntipattern → scripts/governance/pattern-rules.mjs 规则 branch-code-fallback（奥卡姆批次二，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs）

// ============================================================
// 企微引擎省份隔离闸（分省隔离四道防线 P3 · uid 2026-06-29-claude-a5aa03）
// ============================================================
/**
 * 纯静态扫描（不依赖 parquet 数据，永远跑）。补 checkPolicyGlobPrefixIsolation 的缺口：
 * 后者只校验「数据文件名↔省份」前提，不校验「引擎/实例是否真应用了 branch_code 过滤」。
 *
 * 检测 A（引擎层）：sync_renewal_v2.py + sync_filtered_policies.py，凡函数体内 read_parquet
 *   读 policy current/（引用 DEFAULT_POLICY_GLOB / policy_glob），必须同函数体含 branch_code
 *   过滤或 assert_single_branch 出口兜底。按函数粒度判定（避免「文件别处有 assert 就放行」）。
 * 检测 B（实例层）：instances/*.yaml（非 .disabled），按 daily.mjs 路由逻辑判定引擎：
 *   - 缺 script: / script: sync_renewal_v2.py → v2 引擎（load 时 fail-closed 要 branch_code）→
 *     YAML 必须顶层声明 branch_code（静态前置，先于运行时拦截）。
 *   - script: sync_filtered_policies.py → 该引擎 fetch_rows 出口有 assert_single_branch 兜底
 *     （检测 A 已保证）→ 放行（不强制 extra_where，避免与邮政表 extra_where 修复 PR 耦合）。
 *   - 其他未知引擎 → 无法假设兜底，必须显式声明 branch_code/extra_where，否则失败。
 * 逃生阀：命中行附近写 `# governance-allow: branch-isolation <backlog-uid 或 PR#> <理由>`
 *   （仿 architecture.md，须带引用，防裸 marker 后门）。
 */
function checkWecomEngineBranchIsolation() {
  info('检查企微引擎/实例省份隔离（裸读 current/ 必带 branch_code 过滤或出口断言）...');
  const engineDir = path.join(ROOT_DIR, '数据管理/integrations/wecom_smartsheet');
  const violations = [];
  const ALLOW_RE = /governance-allow:\s*branch-isolation\s+(?:B\d+|#\d+|\d{4}-\d{2}-\d{2}[\w-]*)/;

  // ---- 检测 A：引擎层（按 top-level def 切函数块）----
  const ENGINES = ['sync_renewal_v2.py', 'sync_filtered_policies.py'];
  for (const eng of ENGINES) {
    const full = path.join(engineDir, eng);
    if (!fs.existsSync(full)) { violations.push(`引擎 ${eng} 不存在，无法校验`); continue; }
    const text = fs.readFileSync(full, 'utf-8');
    if (ALLOW_RE.test(text)) continue; // 文件级豁免
    const lines = text.split('\n');
    // 按 top-level `def ` 边界切块（含块起始行号）
    const blocks = [];
    let cur = null;
    lines.forEach((line, idx) => {
      if (/^def\s+\w+/.test(line)) {
        if (cur) blocks.push(cur);
        cur = { start: idx + 1, body: [] };
      }
      if (cur) cur.body.push(line);
    });
    if (cur) blocks.push(cur);
    for (const blk of blocks) {
      // 剥 Python 行注释（# 到行末）再匹配——否则注释里的「WHERE branch_code」散文会
      // 把破坏后的函数误判为「有隔离」（漏报）。我方 policy 读函数的 SQL 串无 # 字符，
      // 故按 # 截断安全。docstring 不含隔离关键字，不单独剥。
      const body = blk.body.map((l) => l.replace(/#.*$/, '')).join('\n');
      // 读 policy current/ 的标志：read_parquet + (DEFAULT_POLICY_GLOB | policy_glob)
      const readsPolicyCurrent = /read_parquet\(/.test(body)
        && /(DEFAULT_POLICY_GLOB|policy_glob)/.test(body);
      if (!readsPolicyCurrent) continue;
      // 真隔离信号（代码态强信号，剥注释后不被散文骗过）：
      const hasIsolation =
        /assert_single_branch\(/.test(body) ||      // 出口零信任断言（带括号 = 调用）
        /branch_code\s*=\s*[?'"]/.test(body) ||     // 参数化/字面量 WHERE 过滤串
        /extra_where/.test(body);                   // sync_filtered 受信任片段（YAML 注入 branch_code）
      if (!hasIsolation) {
        violations.push(`${eng}:${blk.start}: 函数读 policy current/ 但无 branch_code 过滤也无 assert_single_branch 出口断言`);
      }
    }
  }

  // ---- 检测 B：实例层（instances/*.yaml 非 .disabled）----
  const instDir = path.join(engineDir, 'instances');
  if (fs.existsSync(instDir)) {
    for (const f of fs.readdirSync(instDir).sort()) {
      if (!(f.endsWith('.yaml') || f.endsWith('.yml'))) continue; // .disabled 天然排除
      const full = path.join(instDir, f);
      const text = fs.readFileSync(full, 'utf-8');
      if (ALLOW_RE.test(text)) continue;
      // 复刻 daily.mjs 路由：script: 行（允许行末注释）；缺省 = sync_renewal_v2.py
      const sm = text.match(/^script:\s*([\w./-]+)\s*(?:#.*)?$/m);
      const engine = sm ? sm[1].trim() : 'sync_renewal_v2.py';
      // 顶层 branch_code: 声明（行首无缩进）
      const hasBranchCode = /^branch_code:\s*\S+/m.test(text);
      // sync_filtered 风格 extra_where 含 branch_code
      const hasExtraWhereBranch = /extra_where:.*branch_code/.test(text);
      if (engine === 'sync_renewal_v2.py') {
        if (!hasBranchCode) {
          violations.push(`instances/${f}: 路由到 sync_renewal_v2.py（读 current/）但未顶层声明 branch_code（fail-closed 前置）`);
        }
      } else if (engine === 'sync_filtered_policies.py') {
        // 该引擎 fetch_rows 出口有 assert_single_branch 兜底（检测 A 已校验）→ 放行
        continue;
      } else {
        // 未知引擎：无法假设有出口兜底，必须显式声明隔离
        if (!hasBranchCode && !hasExtraWhereBranch) {
          violations.push(`instances/${f}: 路由到未知引擎 '${engine}'，须显式声明 branch_code 或 filters.extra_where(branch_code)`);
        }
      }
    }
  }

  if (violations.length > 0) {
    error(`企微引擎/实例省份隔离缺口 ${violations.length} 处（裸读 current/ 混省 → 他省保单推进本省企微表）：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log('    修复（引擎）：函数读 current/ 须加 WHERE branch_code = ? 或 build_source_rows 出口 assert_single_branch');
    console.log('    修复（实例）：v2 实例顶层加 branch_code: <SC/SX>；sync_filtered 实例靠出口断言（已覆盖）');
    console.log('    依据：.claude/rules/data-pipeline.md「省份数据隔离」RED LINE · 数据管理/pipelines/branch_assert.py');
    console.log('    逃生阀：# governance-allow: branch-isolation <backlog-uid 或 PR#> <理由>');
    return false;
  }
  success('企微引擎/实例省份隔离检查通过（两引擎 policy 读均有 branch_code/断言 · v2 实例均声明省份）');
  return true;
}

// 上传上限对齐（安全审计 1200d2）：逻辑抽至 scripts/governance/upload-size-consistency.mjs
// （check-governance.mjs 行数棘轮 H5 ≤4000，新增检查一律独立模块，勿膨胀单体）。
function checkUploadSizeLimitConsistency() {
  return runUploadSizeCheck({ rootDir: ROOT_DIR, io: { info, success, error } });
}

// 禁止模式族：声明式规则表驱动（奥卡姆批次二）。每组一个检查项，组名与旧函数时代一致；
// 规则定义在 scripts/governance/pattern-rules.mjs，红绿 fixture 见 scripts/__tests__/pattern-engine.test.mjs。
const PATTERN_CHECK_MAP = new Map(
  buildPatternChecks(PATTERN_RULES, { rootDir: ROOT_DIR, io: { info, success, error, warning } })
    .map((c) => [c.name, c]),
);
function patternCheck(name) {
  const c = PATTERN_CHECK_MAP.get(name);
  if (!c) throw new Error(`pattern 规则组未定义：${name}（见 scripts/governance/pattern-rules.mjs）`);
  return c;
}

// 代码治理校验：随「代码变更」而变红，是代码门禁（pre-push + CI）的职责。
const CODE_GOVERNANCE_CHECKS = [
  { name: '必需文件与核心索引', fn: checkRequiredFiles },
  { name: 'BACKLOG证据链', fn: checkBacklogEvidence },
  { name: 'CLAUDE章节', fn: checkClaudeMdSections },
  patternCheck('DC-002合规'),
  { name: 'BACKLOG事件日志', fn: checkBacklogLog },
  { name: 'Conflict标记', fn: checkMergeConflictMarkers },
  { name: '调试产物', fn: checkStagedDebugArtifacts },
  { name: '热点文件契约', fn: checkHotfileContractCoverage },
  { name: '幽灵字段治理', fn: checkPhantomFields },
  { name: 'Context Provider未挂载', fn: checkUnmountedProviders },
  { name: 'execSync模板注入', fn: checkExecTemplateInjection },
  { name: 'ApiClient守恒', fn: checkApiWireConservation },
  { name: 'TS检查范围', fn: checkTsconfigTypecheckScope },
  { name: '锁文件策略', fn: checkPackageManagerLockPolicy },
  { name: '凭据扫描', fn: checkStagedCredentials },
  { name: 'PR体量门禁', fn: checkPrSizeLimit },
  { name: 'gitignore审计', fn: checkGitignoreShadow },
  { name: '字段定义一致', fn: checkFieldDefinitionConsistency },
  { name: '指标字典一致', fn: checkMetricDocConsistency },
  { name: 'sync-vps覆盖', fn: checkSyncVpsCoverage },
  { name: 'CLAUDE.md预算', fn: checkClaudeMdBudget },
  { name: 'rules eager-load 预算', fn: checkRulesEagerLoadBudget },
  { name: 'CLAUDE.md计数防漂移', fn: checkClaudeMdNoStaleCounts },
  patternCheck('ETL多sheet规范'),
  { name: 'state-db依赖隔离', fn: checkStateDbDependencyIsolation },
  patternCheck('空catch禁令'),
  patternCheck('业务员聚合键口径'),
  patternCheck('筛选参数绕过'),
  { name: '能力矩阵镜像', fn: checkFilterCapabilityMirror },
  { name: '双锁一致性', fn: () => runDualLockConsistencyCheck({ rootDir: ROOT_DIR, io: { info, success, error } }) },
  { name: '省份映射前后端镜像', fn: () => runBranchMappingMirrorCheck({ rootDir: ROOT_DIR, io: { info, success, error } }) },
  patternCheck('Bundle路由开关合规'),
  { name: 'QueryCatalog对账', fn: checkQueryCatalogConsistency },
  { name: '非query路由域对账', fn: checkNonQueryRoutesConsistency },
  { name: 'RouteCatalog参数契约', fn: checkRouteCatalogParamContracts },
  { name: 'Agent注册表版本', fn: checkAgentRegistryVersionBump },
  { name: '立方体不变量', fn: checkCubeInvariants },
  { name: 'RLS路由消费覆盖', fn: checkRlsRouteCoverage },
  patternCheck('5路由清单SSOT'),
  { name: 'shared-memory user-only', fn: checkSharedMemoryUserOnly },
  { name: 'evidence-loop SSOT 漂移', fn: checkEvidenceLoopSsotDrift },
  { name: 'pr-evolution needs_automation expires 闸', fn: checkPrEvolutionExpired },
  { name: '.github/workflows YAML 语法', fn: checkWorkflowYamlSyntax },
  { name: '分层依赖边界', fn: checkArchLayerBoundaries },
  { name: 'spawn参数引号安全', fn: checkSpawnArgQuoteSafety },
  { name: 'ETL台账新鲜度', fn: checkEtlLedgerFreshness },
  // 2419ed：实现在独立模块（H5 单体棘轮：新增检查勿再膨胀本文件）
  { name: '台账未提交体量', fn: () => runLedgerUncommittedBulkCheck({ rootDir: ROOT_DIR, info, success, warning }) },
  { name: '技能字段闸', fn: checkSkillFieldGate },
  patternCheck('省份静默默认反模式'),
  {
    name: '省份前缀映射一致',
    fn: checkProvincePrefixMapConsistency,
    retireWhen: 'B3 子目录隔离落地后随前缀防线退役（BACKLOG 2026-06-23-claude-801409 退役清单）',
  },
  { name: '企微引擎省份隔离', fn: checkWecomEngineBranchIsolation },
  { name: '上传上限对齐', fn: checkUploadSizeLimitConsistency },
  { name: 'Loop自进化闭环完整性', fn: checkLoopSelfEvolutionIntegrity },
  // vite chunk 图不变式（PR #904 防回归，7f984d）：实现在独立模块，无 dist 跳过、有 dist 真检
  { name: 'vite chunk图不变式', fn: () => governanceCheckChunkInvariants({ info, warning, error, success }, path.join(ROOT_DIR, 'dist')) },
];

// ============================================================
// Loop v2 自进化闭环完整性（E6 元闸·治全部回归，uid 2026-06-27-claude-054a3a）
// ============================================================
/**
 * 把 E1（失败记账）/ E4（真升级校验）能力固化成 governance 强制——回退即 fail：
 *   ① 账本 verdict 规范集：loop-quality-ledger.jsonl 每行 verdict 经 normalizeVerdict 归一后
 *      必须落规范集（pass/partial/reverted/abandoned/orphaned/blocked）。未归一的新变体（如曾
 *      漏归一的 pending-pr）会拉低一次过率且逃过 dispatch accounted 守卫被误记孤儿 → 源头拦截，
 *      提示扩 quality-report SUCCESS_SYNONYMS 或改用规范枚举。实测存量 80 行归一后零未知
 *      （2026-07-03），无 grandfather 负担，可直接 error 级。
 *   ② 失败记账维度不回退：dispatch.mjs 须保留 failureLedgerRows 导出、quality-report.mjs 须
 *      保留 normalizeVerdict 导出（删失败记账 = E1 回退 = 幸存者偏差复活）。
 *   ③ automation 真升级校验：pr-evolution.md 中声明了 mechanism 的 needs_automation 项，其
 *      机制必须真实存在（仓库相对路径存在，或 governance:<检查名> 在本文件中）——识别
 *      「处置=又写一条文档」的假处置（E4 动作②，automation-due 同源纯函数复用）。
 */
function checkLoopSelfEvolutionIntegrity() {
  info('检查 Loop v2 账本 verdict 规范集 + 失败记账维度 + automation 真升级（E6 元闸）...');
  const CANONICAL = new Set(['pass', 'partial', 'reverted', 'abandoned', 'orphaned', 'blocked']);
  const problems = [];

  // ① 账本 verdict 规范集
  const ledgerPath = path.join(ROOT_DIR, '.claude/workflow/loop-quality-ledger.jsonl');
  if (fs.existsSync(ledgerPath)) {
    const rows = parseLoopLedger(fs.readFileSync(ledgerPath, 'utf-8').split('\n'));
    rows.forEach((r, idx) => {
      const v = normalizeLoopVerdict(r.verdict).verdict;
      if (!CANONICAL.has(v)) problems.push(`账本第 ${idx + 1} 条 verdict「${r.verdict}」归一后为「${v}」不在规范集——扩 quality-report SUCCESS_SYNONYMS 或改用规范枚举`);
    });
  }

  // ② 失败记账维度不回退（静态导出存在性）
  const guards = [
    ['scripts/loop/dispatch.mjs', 'export function failureLedgerRows'],
    ['scripts/loop/quality-report.mjs', 'export function normalizeVerdict'],
  ];
  for (const [rel, needle] of guards) {
    const p = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(p) || !fs.readFileSync(p, 'utf-8').includes(needle)) {
      problems.push(`${rel} 缺少「${needle}」——E1 失败记账维度回退（幸存者偏差复活），禁止移除`);
    }
  }

  // ③ automation 真升级校验（假处置拦截）
  const prEvoPath = path.join(ROOT_DIR, '.claude/workflow/pr-evolution.md');
  if (fs.existsSync(prEvoPath)) {
    const items = verifyAutomationMechanisms(scanAutomationEntries(fs.readFileSync(prEvoPath, 'utf-8')), {
      fileExists: (p) => fs.existsSync(path.join(ROOT_DIR, p)),
      governanceSource: fs.readFileSync(__filename, 'utf-8'),
    });
    for (const it of items) {
      if (it.mechanismStatus === 'missing') problems.push(`pr-evolution「${it.entry}」声明 mechanism: ${it.mechanism} 但机制不存在——假处置（处置=又写一条文档），须真落地或撤回声明`);
    }
  }

  if (problems.length) {
    error(`Loop 自进化闭环完整性 ${problems.length} 处违规：`);
    for (const p of problems) error(`  - ${p}`);
    return false;
  }
  success('Loop 账本 verdict 规范、失败记账维度在位、无 automation 假处置');
  return true;
}

// ============================================================
// 技能字段闸（K3）：扫技能 SQL 引用「幽灵字段」（fields.json 注册但 Parquet 未落）
// ============================================================
/**
 * K1 实证：chexian-data-kpi SQL 用 endorsement_type（fields.json 有但 ETL 未落）→ duckdb Binder Error。
 * K2 元规则（技能挂靠 SSOT）靠自觉，本闸强制化（治理链 K3，uid 2026-06-27-claude-6f3275）。
 *
 * CI 无 Parquet → 幽灵字段从 scripts/governance/parquet-columns.snapshot.json 推导：
 *   幽灵 = fields.json id − snapshot 各域(policy/claims/quotes)实际列并集。
 *   snapshot 由本地 duckdb DESCRIBE 生成，Parquet schema 变更须同步（见其 _refresh）。
 *
 * 只扫 SQL fence（```sql / 含 duckdb|read_parquet / SELECT..FROM），排除 getMetricSql(...)（合法 SSOT 取数）、
 * AS alias（输出别名非输入列）、-- 注释；避免误报 K1 字段表里 "endorsement_type 不可用" 警示（markdown 表格非代码块）。
 * 豁免：代码块前 120 字符内写 `<!-- governance-allow: field-gate <理由> -->`（2026-07-05 批次四并入统一命名空间，原 governance-field-gate: allow 词根零存量直接改名）。
 * 局限：fence 提取用基础 ```...``` 正则（技能 .md 惯例），不支持 ~~~/嵌套 fence。
 */
function checkSkillFieldGate() {
  info('检查技能 SQL 引用幽灵字段（fields.json 注册但 Parquet 未落）...');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const walkMd = (dirPath) => {
    const out = [];
    if (!fs.existsSync(dirPath)) return out;
    for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, ent.name);
      if (ent.isDirectory()) out.push(...walkMd(full));
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(full);
    }
    return out;
  };
  let phantoms;
  try {
    const snap = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'scripts/governance/parquet-columns.snapshot.json'), 'utf-8'),
    );
    const fj = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'server/src/config/field-registry/fields.json'), 'utf-8'),
    );
    const flist = Array.isArray(fj) ? fj : fj.fields || [];
    const ids = flist.filter((f) => f && f.id).map((f) => f.id);
    const landed = new Set(Object.values(snap.domains || {}).flat());
    phantoms = ids.filter((id) => !landed.has(id));
  } catch (e) {
    error(`技能字段闸：无法加载 snapshot/fields.json：${e.message}`);
    return false;
  }
  if (phantoms.length === 0) {
    success('技能字段闸：fields.json 全字段已落列，无幽灵');
    return true;
  }
  const phantomRes = phantoms.map((p) => ({ field: p, re: new RegExp(`\\b${escapeRe(p)}\\b`) }));
  const violations = [];
  for (const dir of ['.claude/commands', '.claude/skills']) {
    for (const file of walkMd(path.join(ROOT_DIR, dir))) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(ROOT_DIR, file);
      // matchAll 拿 fence + index（重复 fence 也正确定位 allow 豁免窗口，防 indexOf 拿第一个）
      for (const m of content.matchAll(/```[\s\S]*?```/g)) {
        const fence = m[0];
        const idx = m.index ?? 0;
        const lang = ((fence.match(/^```(\w+)/) || [])[1] || '').toLowerCase();
        // 只扫 SQL fence：含 duckdb/read_parquet，或 sql 语言，或裸 SELECT..FROM；
        // 显式非 SQL 语言（text/markdown/json/yaml）不因 SELECT..FROM 文字误纳（除非含 duckdb/read_parquet）
        const hasParquetHint = /\b(duckdb|read_parquet)\b/i.test(fence);
        const isNonSqlLang = ['text', 'markdown', 'md', 'json', 'yaml', 'yml'].includes(lang);
        const isSql =
          hasParquetHint ||
          (!isNonSqlLang && (lang === 'sql' || /\bSELECT\b[\s\S]*\bFROM\b/i.test(fence)));
        if (!isSql) continue;
        // 豁免：fence 前 120 字符内 `governance-allow: field-gate`（细粒度·每个违规 fence 显式标记，无整文件后门）
        if (/governance-allow:\s*field-gate/.test(content.slice(Math.max(0, idx - 120), idx))) continue;
        // 清理避免误报：去单引号字符串字面量（同名字段的字符串值，如 '...'；不去双引号以免误删 duckdb -c "整个SQL"）
        // + -- 注释 + getMetricSql(简单 id，合法 SSOT 取数) + AS 输出别名
        const cleaned = fence
          .replace(/'[^']*'/g, '')
          .replace(/--[^\n]*/g, '')
          .replace(/getMetricSql\s*\([^)]*\)/gi, '')
          .replace(/\bAS\s+\w+/gi, '');
        for (const { field, re } of phantomRes) {
          if (re.test(cleaned)) violations.push(`${rel}: SQL 代码块引用幽灵字段 '${field}'`);
        }
      }
    }
  }
  const uniq = [...new Set(violations)];
  if (uniq.length === 0) {
    success(`技能字段闸：无幽灵字段引用（推导 ${phantoms.length} 幽灵，扫 commands/skills SQL 代码块）`);
    return true;
  }
  error('技能 SQL 引用幽灵字段（fields.json 注册但 Parquet 未落，直查会 Binder Error）：');
  uniq.forEach((v) => console.log(`    - ${v}`));
  error(
    '  修复：改用 getMetricSql(id) 或正确落列字段；确属存量待修可在 SQL fence 前加 `<!-- governance-allow: field-gate <reason> -->`。幽灵清单见 scripts/governance/parquet-columns.snapshot.json（schema 变更须 duckdb 重算同步）',
  );
  return false;
}

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

function checkEtlLedgerFreshness() {
  info('检查 ETL 台账新鲜度（防漏记）...');
  const ledgerPath = path.join(ROOT_DIR, '数据管理/ledger/etl-ledger.jsonl');
  const statusPath = path.join(ROOT_DIR, '数据管理/data-sources-status.json');
  const ledgerExists = fs.existsSync(ledgerPath);
  const ledgerMtimeMs = ledgerExists ? fs.statSync(ledgerPath).mtimeMs : 0;
  const statusExists = fs.existsSync(statusPath);
  const statusMtimeMs = statusExists ? fs.statSync(statusPath).mtimeMs : 0;
  const { level, message } = evaluateLedgerFreshness({ ledgerExists, ledgerMtimeMs, statusExists, statusMtimeMs });
  if (level === 'ok') {
    success(message);
    return true;
  }
  warning(message);
  return true; // warn 级：防漏记是提示，不阻断 governance（对标 checkPrEvolutionExpired）
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

  // 检查生命周期（奥卡姆批次三）：登记了 retireWhen 的检查是过渡性资产——条件达成应触发
  // 退役而非永久保留（治理体系自我适用「expires 哲学」：pr-evolution 条目要 expires，检查也要）。
  const lifecycle = checks.filter((c) => c.retireWhen);
  if (lifecycle.length > 0) {
    console.log(`${colors.yellow}${colors.bold}↻ 生命周期${colors.reset} ${lifecycle.length} 项检查登记了退役条件：`);
    for (const c of lifecycle) console.log(`    - ${c.name} → ${c.retireWhen}`);
    console.log('');
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
