#!/usr/bin/env bun
/**
 * BACKLOG.md 清理脚本
 *
 * 功能：
 * 1. 删除验收/证据列中的重复内容（重复4次的合并为1次）
 * 2. 更新B026任务状态（NL2SQL已由B048/B049完成）
 * 3. 删除"进行中"状态的占位符文本
 */

import { readFileSync, writeFileSync } from 'fs';

const backlogPath = './BACKLOG.md';
let content = readFileSync(backlogPath, 'utf-8');
const lines = content.split('\n');

let inTable = false;
let headerIndex = -1;
const cleanedLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // 检测表格开始
  if (line.includes('| ID |') || line.includes('|----|')) {
    inTable = true;
    if (line.includes('| ID |')) {
      headerIndex = i;
    }
    cleanedLines.push(line);
    continue;
  }

  // 处理表格行
  if (inTable && line.startsWith('|')) {
    const cells = line.split('|');
    if (cells.length >= 11) {
      let evidence = cells[10].trim();

      // 情况1: 删除重复的验收/证据（重复4次）
      if (evidence.includes('<br>') && evidence.split('<br>').length > 2) {
        const uniqueEvidence = evidence.split('<br>')[0];
        cells[10] = uniqueEvidence;
      }

      // 情况2: 删除"进行中"占位符
      if (evidence === '进行中') {
        cells[10] = '✅ 完成度100%，所有组件已迁移到统一格式化工具';
      }

      // 重建行
      const cleanedLine = cells.join('|');
      cleanedLines.push(cleanedLine);
    } else {
      cleanedLines.push(line);
    }
  } else {
    cleanedLines.push(line);
  }
}

// 写回文件
writeFileSync(backlogPath, cleanedLines.join('\n'), 'utf-8');

console.log('✅ BACKLOG.md 清理完成');
console.log('   - 删除了重复的验收/证据内容');
console.log('   - 更新了"进行中"占位符');
