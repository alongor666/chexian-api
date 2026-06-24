#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

  if (errors.length > 0) {
    console.error('[harness] 检查失败：');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log('[harness] H2-H4 检查通过');
}

main();
