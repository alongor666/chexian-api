#!/usr/bin/env node
/**
 * 跨平台 TypeScript 类型检查脚本
 *
 * 覆盖**两个** TS 工程（BACKLOG 2026-07-15-claude-1cbed5）：
 *   1. 前端 —— 根 tsconfig.json（其 include 仅 ["src"]）
 *   2. 服务端 —— server/tsconfig.json
 *
 * 为什么两个都要跑：根 tsconfig 的 include 只有 ["src"]，服务端类型检查实际由
 * server/package.json 的 `build: tsc` 承担。此前本脚本只跑根 tsconfig，于是
 * `bun run typecheck`（CLAUDE.md §5 记载的类型检查入口）与 `verify:quick`
 * （= preflight + governance + typecheck）**都不覆盖 server/**。
 * 实证（2026-07-15）：在 server/src/services/access-control.ts 引入一处 TS2352 后，
 * `bun run typecheck` 报「✅ 类型检查通过」、5427 个单测全绿、governance 59/59 全绿，
 * 而 `cd server && bun run build` 直接编译失败 —— 迭代期自查拿到的是**假绿**。
 * （提交闸 scripts/hooks/pre-commit 与 CI 一直跑 server tsc，并非"完全没有闸"；
 *   缺的是"写代码当下用来自查的那条命令"的覆盖面与其名字/文档承诺一致。）
 *
 * - macOS/Linux (>=8GB RAM): 直接运行 tsc --noEmit（增量编译）
 * - Windows 低内存 (<8GB): 跳过全量检查，提示用 VS Code 实时检查
 * - CI 环境: 始终运行全量检查
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 待检查的 TS 工程（单一事实源）。
 * 将来若有子包拆出独立 tsconfig（如 cli/ mcp/ 独立类型边界），**加进本数组**，
 * 不要另写一条并列命令 —— 否则又会退回"某个入口漏检"的老问题。
 */
const PROJECTS = [
  { label: '前端 (tsconfig.json)', projectPath: null },
  { label: 'server (server/tsconfig.json)', projectPath: 'server/tsconfig.json' },
];

const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
const platform = os.platform();
const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
const forceRun = process.argv.includes('--force');

// CI 环境或 --force 参数：始终运行
// 本地环境：内存 >= 8GB 才运行
const memThreshold = 8;
const canRun = isCI || forceRun || totalMemGB >= memThreshold;

console.log(`[typecheck] Platform: ${platform}, RAM: ${totalMemGB.toFixed(1)}GB, CI: ${isCI}`);

if (!canRun) {
  console.log('');
  console.log(`[typecheck] ⚠️  内存不足 ${memThreshold}GB (当前 ${totalMemGB.toFixed(1)}GB)，跳过全量类型检查`);
  console.log('[typecheck] 💡 类型错误由 VS Code / IDE 实时检查');
  console.log('[typecheck] 💡 全量检查在 GitHub Actions CI 中自动执行');
  console.log('[typecheck] 💡 强制运行: bun run typecheck -- --force');
  console.log('');
  process.exit(0);
}

// 根据可用内存动态计算堆上限（留 4GB 给系统）
const heapMB = Math.min(Math.round((totalMemGB - 4) * 1024), 16384);

const localTsc = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const useLocalTsc = fs.existsSync(localTsc);

if (!useLocalTsc) {
  console.log('[typecheck] ⚠️  local ./node_modules/.bin/tsc 未找到，回退到全局 tsc');
  console.log('[typecheck] 💡 全局 tsc 版本可能与项目锁定的 typescript 不一致（如全局 6.x 会对 baseUrl 报 TS5101，并非真实类型错误）。');
  console.log('[typecheck] 💡 全新 clone 请先运行 `bun install`（根目录）安装本地 typescript，结果才可靠。');
}

/** 组装单个工程的 tsc 命令 */
function buildCommand(projectPath) {
  const base = useLocalTsc
    ? `node --max-old-space-size=${heapMB} ./${path.relative(process.cwd(), localTsc)} --noEmit`
    : 'tsc --noEmit';
  return projectPath ? `${base} --project ${projectPath}` : base;
}

// 逐工程检查：**不 fail-fast**，跑完全部再汇总，避免"修完前端才发现 server 也红"的来回。
const failed = [];
for (const { label, projectPath } of PROJECTS) {
  // 工程配置缺失 → 显式失败，而不是静默跳过（静默跳过 = 又一次假绿）
  if (projectPath && !fs.existsSync(path.join(process.cwd(), projectPath))) {
    console.error(`[typecheck] ✗ ${label}: 找不到 ${projectPath}（工程配置缺失，拒绝静默跳过）`);
    failed.push(label);
    continue;
  }
  console.log(`[typecheck] 🔍 检查 ${label} (heap: ${heapMB}MB)...`);
  try {
    execSync(buildCommand(projectPath), { stdio: 'inherit', cwd: process.cwd() });
    console.log(`[typecheck] ✅ ${label} 通过`);
  } catch {
    console.error(`[typecheck] ✗ ${label} 类型检查失败`);
    failed.push(label);
  }
}

if (failed.length > 0) {
  console.error('');
  console.error(`[typecheck] ❌ 类型检查失败：${failed.join('、')}`);
  process.exit(1);
}

console.log('');
console.log(`[typecheck] ✅ 类型检查通过（${PROJECTS.length} 个工程：${PROJECTS.map((p) => p.label).join('、')}）`);
