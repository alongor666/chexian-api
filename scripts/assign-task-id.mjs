#!/usr/bin/env bun
/**
 * 自动分配任务 ID
 *
 * 编号策略：全局连续递增（max+1），永不复用历史编号（含 BACKLOG_ARCHIVE.md 已归档的）。
 * 归属对象（@claude/@codex 等）仅用于追溯谁提出，不再绑定编号区间。
 *
 * 使用方法：
 *   bun run scripts/assign-task-id.mjs @claude
 *   bun run scripts/assign-task-id.mjs @codex
 *   bun run scripts/assign-task-id.mjs @gemini
 *   bun run scripts/assign-task-id.mjs @user
 *
 * 输出：下一个可用的任务 ID（如 B100）
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// 已知归属对象（仅校验调用方名称是否合法；编号全局连续，不再绑定区间）
const KNOWN_AGENTS = {
  '@user': '用户提出',
  '@claude': 'Claude 提出',
  '@codex': 'Codex 提出',
  '@gemini': 'Gemini 提出',
  '@trae': 'Trae 提出',
  '@kilo': 'Kilo 提出',
  '@codebuddy': 'CodeBuddy 提出',
  '@openai': 'OpenAI 提出',
};

/**
 * 从 BACKLOG.md + BACKLOG_ARCHIVE.md 收集全局最大任务编号。
 * 归档文件参与统计 → 编号永不被回收复用。兼容历史非标 ID（如 B256-update）。
 */
function collectMaxId() {
  const files = ['BACKLOG.md', 'BACKLOG_ARCHIVE.md'];
  // 匹配表格中的任务 ID（格式：| B001 | 或 | B256-update |）
  const idPattern = /\| B(\d{3,})(?:-\w+)? \|/g;
  let max = 0;

  for (const f of files) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');
    let match;
    while ((match = idPattern.exec(content)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }

  return max;
}

/**
 * 为指定 Agent 分配下一个可用的任务 ID
 */
function assignTaskId(agent) {
  if (!KNOWN_AGENTS[agent]) {
    console.error(`❌ 未知归属对象: ${agent}`);
    console.error(`\n可用的归属对象：`);
    Object.entries(KNOWN_AGENTS).forEach(([key, desc]) => {
      console.error(`  ${key.padEnd(12)} ${desc}`);
    });
    process.exit(1);
  }

  // 全局连续编号：取 BACKLOG.md + BACKLOG_ARCHIVE.md 的最大编号 + 1
  // agent 仅用于校验调用方名称有效（见上）；编号不再绑定 agent 区间，永不复用历史编号
  try {
    const max = collectMaxId();
    const next = max + 1;

    if (next > 999) {
      console.error(`❌ 全局编号已达上限 B999`);
      console.error(`\n建议：评估归档策略或扩展编号位数`);
      process.exit(1);
    }

    return `B${String(next).padStart(3, '0')}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      console.error(`❌ 未找到 BACKLOG.md 文件`);
      console.error(`\n请确保在项目根目录运行此脚本`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * 主函数
 */
function main() {
  // 检查命令行参数
  if (process.argv.length < 3) {
    console.error(`用法：bun run scripts/assign-task-id.mjs <agent>`);
    console.error(`\n示例：`);
    console.error(`  bun run scripts/assign-task-id.mjs @claude`);
    console.error(`  bun run scripts/assign-task-id.mjs @codex`);
    console.error(`\n可用的归属对象：`);
    Object.keys(KNOWN_AGENTS).forEach(key => console.error(`  ${key}`));
    process.exit(1);
  }

  const agent = process.argv[2];
  const taskId = assignTaskId(agent);

  // 输出结果（只输出 ID，方便脚本调用）
  console.log(taskId);
}

// 运行主函数
main();
