#!/usr/bin/env node

/**
 * BACKLOG.md 任务归档脚本
 *
 * 功能：将指定日期之前的已完成任务（DONE）归档到 BACKLOG_ARCHIVE.md
 *
 * 用法：
 *   node scripts/archive-backlog.mjs              # 归档今天之前的任务
 *   node scripts/archive-backlog.mjs 2026-01-15  # 归档指定日期之前的任务
 *   node scripts/archive-backlog.mjs --dry-run   # 预览模式，不实际修改文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

const BACKLOG_PATH = path.join(ROOT_DIR, 'BACKLOG.md');
const ARCHIVE_PATH = path.join(ROOT_DIR, 'BACKLOG_ARCHIVE.md');

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dateArg = args.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));

// 归档截止日期（默认今天）
const today = new Date().toISOString().split('T')[0];
const cutoffDate = dateArg || today;

console.log('📦 BACKLOG 任务归档工具');
console.log('━'.repeat(50));
console.log(`📅 归档截止日期: ${cutoffDate} (不含当天)`);
console.log(`📄 源文件: ${BACKLOG_PATH}`);
console.log(`📁 归档文件: ${ARCHIVE_PATH}`);
if (dryRun) console.log('🔍 预览模式: 不实际修改文件');
console.log('━'.repeat(50));

// 读取文件
const backlogContent = fs.readFileSync(BACKLOG_PATH, 'utf-8');
const archiveContent = fs.readFileSync(ARCHIVE_PATH, 'utf-8');

// 解析 BACKLOG.md
const lines = backlogContent.split('\n');

// 找到表格开始位置
const headerIndex = lines.findIndex(line =>
  line.includes('| ID |') && line.includes('| 提出时间 |')
);

if (headerIndex === -1) {
  console.error('❌ 未找到 BACKLOG.md 表格头');
  process.exit(1);
}

// 分离头部、表格头、分隔符、数据行
const headerSection = lines.slice(0, headerIndex);
const tableHeader = lines[headerIndex];
const tableSeparator = lines[headerIndex + 1];
const dataLines = lines.slice(headerIndex + 2);

// 解析数据行
const toArchive = [];
const toKeep = [];

for (const line of dataLines) {
  // 跳过空行或非表格行
  if (!line.startsWith('|') || line.trim() === '') {
    toKeep.push(line);
    continue;
  }

  // 解析表格行
  const cells = line.split('|').map(cell => cell.trim());
  // cells[0] 是空的（行首的 |）
  // cells[1] = ID, cells[2] = 提出时间, cells[7] = 状态

  const taskId = cells[1];
  const submitDate = cells[2];
  const status = cells[7];

  // 验证日期格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(submitDate)) {
    toKeep.push(line);
    continue;
  }

  // 判断是否归档
  // 条件：日期 < cutoffDate 且 状态 = DONE
  const shouldArchive = submitDate < cutoffDate && status === 'DONE';

  if (shouldArchive) {
    toArchive.push({
      line,
      id: taskId,
      date: submitDate,
      status
    });
  } else {
    toKeep.push(line);
  }
}

console.log(`\n📊 分析结果:`);
console.log(`  - 待归档任务: ${toArchive.length} 个`);
console.log(`  - 保留任务: ${toKeep.filter(l => l.startsWith('|')).length} 个`);

if (toArchive.length === 0) {
  console.log('\n✅ 没有需要归档的任务');
  process.exit(0);
}

// 显示待归档任务
console.log('\n📋 待归档任务列表:');
for (const task of toArchive) {
  console.log(`  ${task.id} (${task.date}) - ${task.status}`);
}

if (dryRun) {
  console.log('\n🔍 预览模式完成，未修改任何文件');
  console.log('  移除 --dry-run 参数以执行实际归档');
  process.exit(0);
}

// 生成归档条目
const archiveDate = today;
let nextArchiveId = 'A';

// 从现有归档文件中获取下一个归档ID
const existingArchiveIds = archiveContent.match(/\| A(\d+) \|/g) || [];
if (existingArchiveIds.length > 0) {
  const maxId = Math.max(...existingArchiveIds.map(m => parseInt(m.match(/A(\d+)/)[1])));
  nextArchiveId = maxId + 1;
} else {
  nextArchiveId = 11; // 从 A011 开始（A001-A010 已存在）
}

// 生成新的归档行
const archiveEntries = toArchive.map((task, index) => {
  const archiveId = `A${String(nextArchiveId + index).padStart(3, '0')}`;
  const cells = task.line.split('|').map(cell => cell.trim());
  const taskId = cells[1];
  const submitDate = cells[2];
  const category = cells[3]; // 板块
  const description = cells[5]; // 需求描述
  const evidence = cells[10]; // 验收/证据（可能很长）

  // 截取证据摘要（最多100字符）
  const evidenceSummary = evidence.length > 100
    ? evidence.substring(0, 100) + '...'
    : evidence;

  return `| ${archiveId} | ${taskId} | ${submitDate} | ${category} | ${description.substring(0, 50)}${description.length > 50 ? '...' : ''} | ${evidenceSummary} |`;
});

// 更新 BACKLOG.md
const newBacklogContent = [
  ...headerSection,
  tableHeader,
  tableSeparator,
  ...toKeep
].join('\n');

// 更新 BACKLOG_ARCHIVE.md
// 在"基础设施类"表格后添加新的归档条目
const archiveLines = archiveContent.split('\n');

// 找到合适的插入位置（在"基础设施类"表格最后一行之后）
const insertIndex = archiveLines.findIndex((line, index) => {
  // 找到"按Agent分类归档"章节
  return line.includes('## 按Agent分类归档');
});

// 生成新的归档章节
const newArchiveSection = `
### ${archiveDate} 批量归档 (${toArchive.length} 个任务)

| 归档ID | 原ID | 完成时间 | 类别 | 核心价值 | 证据摘要 |
|--------|------|----------|------|----------|----------|
${archiveEntries.join('\n')}
`;

let newArchiveContent;
if (insertIndex !== -1) {
  // 在"按Agent分类归档"之前插入
  newArchiveContent = [
    ...archiveLines.slice(0, insertIndex),
    newArchiveSection,
    ...archiveLines.slice(insertIndex)
  ].join('\n');
} else {
  // 追加到文件末尾
  newArchiveContent = archiveContent + '\n' + newArchiveSection;
}

// 写入文件
fs.writeFileSync(BACKLOG_PATH, newBacklogContent, 'utf-8');
fs.writeFileSync(ARCHIVE_PATH, newArchiveContent, 'utf-8');

console.log('\n✅ 归档完成!');
console.log(`  - BACKLOG.md 已更新 (移除 ${toArchive.length} 个任务)`);
console.log(`  - BACKLOG_ARCHIVE.md 已更新 (新增 ${toArchive.length} 个归档条目)`);
console.log(`  - 归档ID范围: A${String(nextArchiveId).padStart(3, '0')} - A${String(nextArchiveId + toArchive.length - 1).padStart(3, '0')}`);

// 统计信息
const remainingTasks = toKeep.filter(l => l.startsWith('|')).length;
const proposedTasks = toKeep.filter(l => l.includes('PROPOSED')).length;
const inProgressTasks = toKeep.filter(l => l.includes('IN_PROGRESS')).length;
const todayTasks = toKeep.filter(l => l.includes(cutoffDate)).length;

console.log('\n📊 BACKLOG.md 当前状态:');
console.log(`  - 剩余任务总数: ${remainingTasks}`);
console.log(`  - PROPOSED 状态: ${proposedTasks}`);
console.log(`  - IN_PROGRESS 状态: ${inProgressTasks}`);
console.log(`  - ${cutoffDate} 当天任务: ${todayTasks}`);
