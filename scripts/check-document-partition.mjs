#!/usr/bin/env bun
/**
 * 文档分区检查
 *
 * 检测 Agent 是否违反文档分区协议（CLAUDE.md §9.1）
 *
 * 检查项：
 * 1. Agent 是否修改了其他 Agent 的专属 section
 * 2. CLAUDE.md §1-8 是否被 Agent 修改（仅 @user 可修改）
 * 3. 索引文件是否跨分区写入
 *
 * 使用方法：
 *   bun run scripts/check-document-partition.mjs
 *
 * 集成到 pre-commit hook：
 *   echo "bun run scripts/check-document-partition.mjs" >> .git/hooks/pre-commit
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 当前 Agent（通过环境变量设置，默认为 @unknown）
const CURRENT_AGENT = process.env.AGENT_NAME || process.env.AGENT_ID || '@unknown';

// 只读文档（只有 @user 可以修改）
const READONLY_DOCUMENTS = [
  {
    path: 'CLAUDE.md',
    sections: ['§1', '§2', '§3', '§4', '§5', '§6', '§7', '§8'],
    allowedAgent: '@user',
    reason: '核心协议文档，仅用户可修改',
  },
];

// 分区文档和对应的 section 标记
const PARTITIONED_DOCUMENTS = [
  {
    path: 'CLAUDE.md',
    partitions: [
      { name: '@claude-section', marker: '<!-- @claude-section-start -->' },
      { name: '@codex-section', marker: '<!-- @codex-section-start -->' },
      { name: '@gemini-section', marker: '<!-- @gemini-section-start -->' },
    ],
  },
  {
    path: '开发文档/DOC_INDEX.md',
    partitions: [
      { name: '@claude-section', marker: '<!-- @claude-section-start -->' },
      { name: '@codex-section', marker: '<!-- @codex-section-start -->' },
    ],
  },
];

/**
 * 获取当前分支修改的所有文件
 */
function getChangedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
    const files = output.trim().split('\n').filter(f => f.length > 0);

    // 如果没有暂存的文件，检查工作区的修改
    if (files.length === 0) {
      const output2 = execSync('git diff --name-only', { encoding: 'utf-8' });
      return output2.trim().split('\n').filter(f => f.length > 0);
    }

    return files;
  } catch (error) {
    // 如果不是 Git 仓库，返回空数组
    return [];
  }
}

/**
 * 检查文件是否是只读文档
 */
function checkReadonlyDocument(filePath, content) {
  const violations = [];

  for (const doc of READONLY_DOCUMENTS) {
    if (filePath.endsWith(doc.path)) {
      if (CURRENT_AGENT !== doc.allowedAgent) {
        violations.push(
          `❌ ${filePath} 是只读文档（${doc.reason}）\n` +
          `   当前 Agent: ${CURRENT_AGENT}\n` +
          `   允许修改: ${doc.allowedAgent}\n` +
          `   解决方案：联系 @user 修改，或在自己的文档中添加内容`
        );
      }
    }
  }

  return violations;
}

/**
 * 检查分区文档的违规修改
 */
function checkPartitionedDocument(filePath, content) {
  const violations = [];

  for (const doc of PARTITIONED_DOCUMENTS) {
    if (!filePath.endsWith(doc.path)) continue;

    // 检查文件是否有分区标记
    const hasPartitionMarkers = doc.partitions.some(p => content.includes(p.marker));

    if (!hasPartitionMarkers) {
      // 文档没有分区标记，跳过检查
      continue;
    }

    // 检查当前 Agent 是否有专属 section
    const mySection = doc.partitions.find(p => p.name.includes(CURRENT_AGENT));

    if (!mySection) {
      // 当前 Agent 没有专属 section，不应修改此文档
      violations.push(
        `⚠️  ${filePath} 是分区文档，但 ${CURRENT_AGENT} 没有专属 section\n` +
        `   解决方案：避免修改此文档，或联系 @user 添加专属分区`
      );
      continue;
    }

    // 检查是否修改了其他 Agent 的 section
    for (const partition of doc.partitions) {
      if (partition.name.includes(CURRENT_AGENT)) continue;

      const startMarker = partition.marker;
      const endMarker = startMarker.replace('start', 'end');

      const startIndex = content.indexOf(startMarker);
      const endIndex = content.indexOf(endMarker);

      if (startIndex === -1 || endIndex === -1) continue;

      // 检查修改的内容是否在其他 section 内
      // 这里简化处理：如果当前 Agent 不是 @user，就不应该修改此文档
      if (CURRENT_AGENT !== '@user') {
        violations.push(
          `⚠️  ${filePath} 包含其他 Agent 的分区\n` +
          `   当前 Agent: ${CURRENT_AGENT}\n` +
          `   解决方案：只修改自己的 section（${mySection.name}）`
        );
      }
    }
  }

  return violations;
}

/**
 * 检查 BACKLOG.md 的并发写入冲突
 */
function checkBacklogConflict(filePath, content) {
  const violations = [];

  if (!filePath.endsWith('BACKLOG.md')) return violations;

  // 统计任务 ID
  const idPattern = /\| B(\d{3}) \|/g;
  const ids = new Set();
  let match;

  while ((match = idPattern.exec(content)) !== null) {
    ids.add(`B${match[1]}`);
  }

  // 检查是否有重复的任务 ID
  const idCount = new Map();
  idPattern.lastIndex = 0; // 重置正则表达式

  while ((match = idPattern.exec(content)) !== null) {
    const id = `B${match[1]}`;
    idCount.set(id, (idCount.get(id) || 0) + 1);
  }

  const duplicates = Array.from(idCount.entries()).filter(([_, count]) => count > 1);

  if (duplicates.length > 0) {
    violations.push(
      `❌ BACKLOG.md 发现重复的任务 ID\n` +
      `   重复的 ID: ${duplicates.map(([id]) => id).join(', ')}\n` +
      `   解决方案：删除重复的行，保持每个任务 ID 唯一`
    );
  }

  return violations;
}

/**
 * 主函数
 */
function main() {
  console.log(`📋 文档分区检查 (Agent: ${CURRENT_AGENT})\n`);

  const changedFiles = getChangedFiles();
  const mdFiles = changedFiles.filter(f => f.endsWith('.md'));

  if (mdFiles.length === 0) {
    console.log('✅ 没有修改 Markdown 文档，跳过检查');
    process.exit(0);
  }

  console.log(`📝 检查 ${mdFiles.length} 个文档...\n`);

  const allViolations = [];

  for (const file of mdFiles) {
    try {
      const content = readFileSync(resolve(process.cwd(), file), 'utf-8');

      // 检查只读文档
      const readonlyViolations = checkReadonlyDocument(file, content);
      allViolations.push(...readonlyViolations);

      // 检查分区文档
      const partitionViolations = checkPartitionedDocument(file, content);
      allViolations.push(...partitionViolations);

      // 检查 BACKLOG.md 冲突
      const backlogViolations = checkBacklogConflict(file, content);
      allViolations.push(...backlogViolations);
    } catch (error) {
      console.error(`⚠️  无法读取文件: ${file}`);
      continue;
    }
  }

  // 输出结果
  if (allViolations.length > 0) {
    console.error('❌ 发现文档分区违规：\n');
    allViolations.forEach(v => console.error(`${v}\n`));
    console.error('请修复后再提交。参考 CLAUDE.md §9 多Agent协作协议\n');
    process.exit(1);
  }

  console.log('✅ 文档分区检查通过');
}

// 运行主函数
main();
