#!/usr/bin/env bun
/**
 * 自动分配任务 ID
 *
 * 根据 CLAUDE.md §9.2 多Agent协作协议，为不同 Agent 分配专属任务 ID 范围
 *
 * 使用方法：
 *   bun run scripts/assign-task-id.mjs @claude
 *   bun run scripts/assign-task-id.mjs @codex
 *   bun run scripts/assign-task-id.mjs @gemini
 *   bun run scripts/assign-task-id.mjs @user
 *
 * 输出：下一个可用的任务 ID（如 B100）
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Agent ID 范围定义（CLAUDE.md §9.2）
const AGENT_ID_RANGES = {
  '@user': { start: 1, end: 99, description: '用户专属任务' },
  '@claude': { start: 100, end: 199, description: 'Claude 专属任务' },
  '@codex': { start: 200, end: 299, description: 'Codex 专属任务' },
  '@gemini': { start: 300, end: 399, description: 'Gemini 专属任务' },
  '@future': { start: 400, end: 999, description: '未来扩展' },
};

/**
 * 从 BACKLOG.md 中提取已使用的任务 ID
 */
function extractUsedIds(backlogContent) {
  const usedIds = new Set();

  // 匹配 Markdown 表格中的任务 ID（格式：| B001 | ...）
  const idPattern = /\| B(\d{3}) \|/g;
  let match;

  while ((match = idPattern.exec(backlogContent)) !== null) {
    usedIds.add(`B${match[1]}`);
  }

  return usedIds;
}

/**
 * 为指定 Agent 分配下一个可用的任务 ID
 */
function assignTaskId(agent) {
  const range = AGENT_ID_RANGES[agent];

  if (!range) {
    console.error(`❌ 未知 Agent: ${agent}`);
    console.error(`\n可用的 Agent：`);
    Object.entries(AGENT_ID_RANGES).forEach(([key, value]) => {
      console.error(`  ${key}: B${String(value.start).padStart(3, '0')}-B${String(value.end).padStart(3, '0')} (${value.description})`);
    });
    process.exit(1);
  }

  // 读取 BACKLOG.md
  try {
    const backlogPath = resolve(process.cwd(), 'BACKLOG.md');
    const backlogContent = readFileSync(backlogPath, 'utf-8');
    const usedIds = extractUsedIds(backlogContent);

    // 在 Agent 的范围内找下一个可用 ID
    for (let i = range.start; i <= range.end; i++) {
      const id = `B${String(i).padStart(3, '0')}`;
      if (!usedIds.has(id)) {
        return id;
      }
    }

    // 如果范围内所有 ID 都已使用
    console.error(`❌ Agent ${agent} 的 ID 范围已满！`);
    console.error(`\n范围：B${String(range.start).padStart(3, '0')}-B${String(range.end).padStart(3, '0')}`);
    console.error(`已使用：${range.end - range.start + 1} 个 ID`);
    console.error(`\n建议：`);
    console.error(`  1. 清理已完成的旧任务`);
    console.error(`  2. 扩展 ID 范围（修改 CLAUDE.md §9.2）`);
    process.exit(1);
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
    console.error(`\n可用的 Agent：`);
    Object.entries(AGENT_ID_RANGES).forEach(([key, value]) => {
      console.error(`  ${key}: B${String(value.start).padStart(3, '0')}-B${String(value.end).padStart(3, '0')}`);
    });
    process.exit(1);
  }

  const agent = process.argv[2];
  const taskId = assignTaskId(agent);

  // 输出结果（只输出 ID，方便脚本调用）
  console.log(taskId);
}

// 运行主函数
main();
