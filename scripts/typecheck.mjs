#!/usr/bin/env node
/**
 * 跨平台 TypeScript 类型检查脚本
 *
 * - macOS/Linux (>=8GB RAM): 直接运行 tsc --noEmit（增量编译）
 * - Windows 低内存 (<8GB): 跳过全量检查，提示用 VS Code 实时检查
 * - CI 环境: 始终运行全量检查
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

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

console.log(`[typecheck] 🔍 Running tsc --noEmit (heap: ${heapMB}MB)...`);

const localTsc = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const useLocalTsc = fs.existsSync(localTsc);
const tscCommand = useLocalTsc ? `node --max-old-space-size=${heapMB} ./${path.relative(process.cwd(), localTsc)} --noEmit` : 'tsc --noEmit';

if (!useLocalTsc) {
  console.log('[typecheck] ⚠️  local ./node_modules/.bin/tsc 未找到，回退到全局 tsc');
  console.log('[typecheck] 💡 全局 tsc 版本可能与项目锁定的 typescript 不一致（如全局 6.x 会对 baseUrl 报 TS5101，并非真实类型错误）。');
  console.log('[typecheck] 💡 全新 clone 请先运行 `bun install`（根目录）安装本地 typescript，结果才可靠。');
}

try {
  execSync(tscCommand, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  console.log('[typecheck] ✅ 类型检查通过');
} catch (e) {
  process.exit(e.status || 1);
}
