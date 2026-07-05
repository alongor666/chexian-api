#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PATTERN_RULES } from './pattern-rules.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const requiredDenyEntries = [
  'Read(./node_modules/**)',
  'Read(./dist/**)',
  // Read(./.claude/worktrees/**) 已移除（2026-06-23，PR #778）：与官方 EnterWorktree 默认落点（.claude/worktrees/）
  // 自相矛盾，且与 .gitignore 的 .claude/worktrees/ 冗余（官方推荐 gitignore 兜噪声，非 Read deny）。勿再加回。
  'Read(./server/data/**)',
  'Read(./logs/**)',
  'Read(./public/reports/**)',
  'Bash(rm -rf ./数据管理/warehouse/**)',
  'Bash(rm -rf ./.git/**)',
  'mcp__filesystem__write_file',
  'mcp__filesystem__edit_file',
  'mcp__filesystem__create_directory',
  'mcp__filesystem__move_file',
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function checkMcpFilesystemTools(errors) {
  const mcp = readJson('.mcp.json');
  const tools = mcp?.mcpServers?.filesystem?.tools ?? [];
  const writeTools = tools.filter(tool => /write|create|move|edit/i.test(tool));
  assert(
    writeTools.length === 0,
    `H2 filesystem MCP 暴露写工具：${writeTools.join(', ')}`,
    errors
  );
}

function checkPermissionsDeny(errors) {
  const settings = readJson('.claude/settings.json');
  const deny = settings?.permissions?.deny;
  assert(Array.isArray(deny) && deny.length > 0, 'H3 permissions.deny 必须为非空数组', errors);

  const denySet = new Set(Array.isArray(deny) ? deny : []);
  for (const entry of requiredDenyEntries) {
    assert(denySet.has(entry), `H3 permissions.deny 缺少：${entry}`, errors);
  }
}

function collectHookCommands(hooks) {
  const commands = [];
  for (const hookEntries of Object.values(hooks ?? {})) {
    for (const entry of hookEntries ?? []) {
      for (const hook of entry.hooks ?? []) {
        if (typeof hook.command === 'string') commands.push(hook.command);
      }
    }
  }
  return commands;
}

function checkStopHookDoesNotUseGitHistory(errors) {
  const settings = readJson('.claude/settings.json');
  const stopCommands = collectHookCommands({ Stop: settings?.hooks?.Stop });
  const offenders = stopCommands.filter(command => command.includes('HEAD~1 HEAD'));
  assert(offenders.length === 0, 'H4 Stop hook 仍包含 HEAD~1 HEAD', errors);
}

// H5（奥卡姆批次四·治理自我适用）：check-governance.mjs 体积棘轮。
// 奥卡姆重构把主脚本从 4630 行收敛到 4000 行以内；本闸防止其再膨胀回单体——
// 新增检查应优先进 scripts/governance/pattern-rules.mjs 规则表或独立模块。
// 上限只允许下调（棘轮），与项目 coding-style「文件 ≤800 行」的长期目标同向。
const GOVERNANCE_MAX_LINES = 4000;
function checkGovernanceFileBudget(errors) {
  const lines = readText('scripts/check-governance.mjs').split('\n').length;
  assert(
    lines <= GOVERNANCE_MAX_LINES,
    `H5 check-governance.mjs 已 ${lines} 行，超过棘轮上限 ${GOVERNANCE_MAX_LINES}（新增检查请进 pattern-rules 规则表或独立模块，勿再膨胀单体）`,
    errors,
  );
}

// H6（奥卡姆批次四·治理自我适用）：豁免 marker 统一命名空间。
// 历史上五种豁免文法并存（governance-allow / governance-branch-fallback / governance-field-gate…），
// 最弱的一种就是全体系的后门水位线；2026-07-05 起统一为 `governance-allow: <规则id>` 命名空间，
// 本闸防止新规则再发明第六种词根。
function checkAllowMarkerNamespace(errors) {
  for (const rule of PATTERN_RULES) {
    if (!rule.allowMarker) continue;
    const src = typeof rule.allowMarker === 'string' ? rule.allowMarker : rule.allowMarker.source;
    assert(
      src.includes('governance-allow:'),
      `H6 规则 ${rule.id} 的 allowMarker 未落 governance-allow: 命名空间：${src}`,
      errors,
    );
  }
}

function main() {
  if (process.env.HARNESS_SKIP === '1') {
    if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
      console.error('[harness] HARNESS_SKIP 在 CI 环境下被禁用');
      process.exit(1);
    }
    console.warn('[harness] HARNESS_SKIP=1，跳过 harness 静态检查（仅限本地调试）');
    return;
  }

  const errors = [];
  // H1（README 计数）已移除：本项目为 AI-native，命令/agent/skill 由各自 frontmatter
  // 的 description 自动注入上下文被发现，不再维护人类向 README 索引，故无需计数校验。
  checkMcpFilesystemTools(errors);
  checkPermissionsDeny(errors);
  checkStopHookDoesNotUseGitHistory(errors);
  checkGovernanceFileBudget(errors);
  checkAllowMarkerNamespace(errors);

  if (errors.length > 0) {
    console.error('[harness] 检查失败：');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log('[harness] H2-H6 检查通过');
}

main();
