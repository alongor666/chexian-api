#!/usr/bin/env bun
/**
 * BACKLOG.md 智能合并工具
 *
 * 功能：
 * 1. 解析main和branch的BACKLOG.md为结构化数据
 * 2. 按任务ID去重（main优先）
 * 3. 智能合并状态（DONE > IN_PROGRESS > PROPOSED > BLOCKED）
 * 4. 合并验收证据（用<br>分隔）
 * 5. 生成合并后的BACKLOG.md
 *
 * 使用：
 * bun run scripts/merge-backlog.mjs \
 *   --main BACKLOG.main.md \
 *   --branch BACKLOG.branch.md \
 *   --output BACKLOG.merged.md
 *
 * @author @claude
 * @version 1.0.0
 * @date 2026-01-11
 */

import { readFileSync, writeFileSync } from 'fs';

// 状态优先级（数字越大优先级越高）
const STATUS_PRIORITY = {
  BLOCKED: 0,
  PROPOSED: 1,
  TRIAGED: 2,
  IN_PROGRESS: 3,
  DONE: 4,
};

/**
 * 解析BACKLOG.md表格为结构化数据
 */
function parseBacklogTable(content) {
  const lines = content.split('\n');
  const tasks = {};

  let inTable = false;
  for (const line of lines) {
    // 检测表格开始（包含ID列）
    if (line.includes('| ID |')) {
      inTable = true;
      continue;
    }

    // 跳过表格分隔线
    if (line.includes('|----') || line.includes('|----|')) {
      continue;
    }

    // 表格结束
    if (inTable && line.trim() && !line.startsWith('|')) {
      break;
    }

    // 解析任务行
    if (inTable && line.startsWith('|')) {
      const task = parseTaskLine(line);
      if (task && task.id) {
        tasks[task.id] = task;
      }
    }
  }

  return tasks;
}

/**
 * 解析单行任务
 * 格式：| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |
 */
function parseTaskLine(line) {
  const parts = line
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 10) {
    return null;
  }

  return {
    id: parts[0],
    proposedDate: parts[1],
    category: parts[2],
    assignee: parts[3],
    description: parts[4],
    priority: parts[5],
    status: parts[6],
    relatedDocs: parts[7],
    relatedCode: parts[8],
    evidence: parts[9],
  };
}

/**
 * 合并两个任务信息
 * 策略：
 * - 状态：取优先级更高的
 * - 证据：合并两边（用<br>分隔）
 * - 其他字段：main优先
 */
function mergeTaskInfo(mainTask, branchTask) {
  const mainPriority = STATUS_PRIORITY[mainTask.status] || 0;
  const branchPriority = STATUS_PRIORITY[branchTask.status] || 0;

  // 合并证据
  const evidences = [mainTask.evidence, branchTask.evidence]
    .filter((e) => e && e !== 'N/A')
    .join('<br>');

  return {
    ...mainTask,
    status: mainPriority >= branchPriority ? mainTask.status : branchTask.status,
    evidence: evidences || 'N/A',
    // 合并关联文档和代码
    relatedDocs: mergeField(mainTask.relatedDocs, branchTask.relatedDocs),
    relatedCode: mergeField(mainTask.relatedCode, branchTask.relatedCode),
  };
}

/**
 * 合并字段（去重）
 */
function mergeField(main, branch) {
  if (!main || main === 'N/A') return branch;
  if (!branch || branch === 'N/A') return main;

  // 按<br>分隔，合并，去重
  const mainItems = main.split('<br>').map((s) => s.trim());
  const branchItems = branch.split('<br>').map((s) => s.trim());

  const merged = [...new Set([...mainItems, ...branchItems])];
  return merged.join('<br>');
}

/**
 * 生成BACKLOG.md表格
 */
function generateBacklogTable(tasks) {
  const sortedTasks = Object.values(tasks).sort((a, b) => {
    const aNum = parseInt(a.id.slice(1));
    const bNum = parseInt(b.id.slice(1));
    return aNum - bNum;
  });

  const header = `| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |
|----|----------|------|----------|----------|--------|------|----------|----------|-----------|`;

  const rows = sortedTasks.map((task) =>
    [
      task.id,
      task.proposedDate,
      task.category,
      task.assignee,
      task.description,
      task.priority,
      task.status,
      task.relatedDocs,
      task.relatedCode,
      task.evidence,
    ]
      .map((field) => field || 'N/A')
      .join(' | ')
  );

  return `${header}\n${rows.map((r) => `| ${r} |`).join('\n')}`;
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const mainFile = args[args.indexOf('--main') + 1];
  const branchFile = args[args.indexOf('--branch') + 1];
  const outputFile = args[args.indexOf('--output') + 1];

  if (!mainFile || !branchFile || !outputFile) {
    console.error('用法: bun run scripts/merge-backlog.mjs --main <file> --branch <file> --output <file>');
    process.exit(1);
  }

  console.log('🔍 读取文件...');
  const mainContent = readFileSync(mainFile, 'utf-8');
  const branchContent = readFileSync(branchFile, 'utf-8');

  console.log('📊 解析BACKLOG表格...');
  const mainTasks = parseBacklogTable(mainContent);
  const branchTasks = parseBacklogTable(branchContent);

  console.log(`  - Main任务数: ${Object.keys(mainTasks).length}`);
  console.log(`  - Branch任务数: ${Object.keys(branchTasks).length}`);

  console.log('🔗 合并任务...');
  const merged = { ...mainTasks };

  let newTaskCount = 0;
  let mergedTaskCount = 0;

  for (const [id, branchTask] of Object.entries(branchTasks)) {
    if (merged[id]) {
      // 已存在，合并
      merged[id] = mergeTaskInfo(merged[id], branchTask);
      mergedTaskCount++;
      console.log(`  ✓ ${id}: 合并状态和证据`);
    } else {
      // 新任务，直接添加
      merged[id] = branchTask;
      newTaskCount++;
      console.log(`  + ${id}: 新增任务`);
    }
  }

  console.log(`\n📝 生成合并后的BACKLOG表格...`);
  const mergedTable = generateBacklogTable(merged);

  // 读取main的头部（直到表格之前的所有内容）
  const mainLines = mainContent.split('\n');
  let headerEndIndex = 0;
  for (let i = 0; i < mainLines.length; i++) {
    if (mainLines[i].includes('| ID |')) {
      headerEndIndex = i;
      break;
    }
  }

  const header = mainLines.slice(0, headerEndIndex).join('\n');
  const finalContent = `${header}\n${mergedTable}\n`;

  writeFileSync(outputFile, finalContent, 'utf-8');

  console.log(`\n✅ 合并完成！`);
  console.log(`  - 总任务数: ${Object.keys(merged).length}`);
  console.log(`  - 新增任务: ${newTaskCount}`);
  console.log(`  - 合并任务: ${mergedTaskCount}`);
  console.log(`  - 输出文件: ${outputFile}`);
}

main();
