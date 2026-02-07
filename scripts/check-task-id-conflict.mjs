#!/usr/bin/env bun
/**
 * 任务ID冲突检测脚本
 *
 * 功能：
 * 1. 检查BACKLOG.md中的任务ID是否符合Agent专属范围
 * 2. 检测ID冲突（同一ID被多次使用）
 * 3. 检测归属对象与ID范围不匹配的情况
 * 4. 验证新增任务的ID是否超出分配范围
 *
 * 使用方法：
 *   bun run scripts/check-task-id-conflict.mjs
 */

import { readFileSync } from 'fs';

// Agent ID范围配置
const AGENT_RANGES = {
  '@user': { min: 1, max: 99 },
  '@claude': { min: 100, max: 199 },
  '@codex': { min: 200, max: 299 },
  '@gemini': { min: 300, max: 399 },
  '@trae': { min: 400, max: 499 },
  '@kilo': { min: 500, max: 599 },
  '@codebuddy': { min: 600, max: 699 },
};

/**
 * 解析任务ID（如 "B001" -> 1）
 */
function parseTaskId(idStr) {
  const match = idStr.match(/^B(\d{3})$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * 获取Agent的ID范围
 */
function getAgentForId(idNum) {
  for (const [agent, range] of Object.entries(AGENT_RANGES)) {
    if (idNum >= range.min && idNum <= range.max) {
      return agent;
    }
  }
  return null;
}

/**
 * 检查BACKLOG.md中的任务ID
 */
function checkTaskIds() {
  const backlogPath = './BACKLOG.md';
  const content = readFileSync(backlogPath, 'utf-8');
  const lines = content.split('\n');

  const errors = [];
  const warnings = [];
  const usedIds = new Map(); // ID -> 行号
  const agentUsage = new Map(); // Agent -> Set of IDs

  let inTable = false;
  let headerLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测表格开始
    if (line.includes('| ID |') || line.includes('|----|')) {
      inTable = true;
      if (line.includes('| ID |')) {
        headerLine = i;
      }
      continue;
    }

    // 解析表格行
    if (inTable && line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);

      if (cells.length < 4) continue; // 至少需要ID、归属对象等4列

      const taskIdStr = cells[0]; // 第1列：ID
      const owner = cells[3]; // 第4列：归属对象

      const taskIdNum = parseTaskId(taskIdStr);
      if (taskIdNum === null) continue;

      // 检查ID重复
      if (usedIds.has(taskIdNum)) {
        errors.push(
          `❌ 任务ID重复: ${taskIdStr} 在第 ${usedIds.get(taskIdNum)} 行和第 ${i + 1} 行`
        );
      } else {
        usedIds.set(taskIdNum, i + 1);
      }

      // 检查归属对象与ID范围是否匹配
      const expectedAgent = getAgentForId(taskIdNum);
      // 兼容历史数据：@xuechenglong 和 @user 视为相同
      const normalizedOwner = owner === '@xuechenglong' ? '@user' : owner;
      const normalizedExpected = expectedAgent === '@user' ? '@user' : expectedAgent;

      if (expectedAgent && normalizedOwner !== normalizedExpected && owner !== 'Backlog' && owner !== '@openai') {
        warnings.push(
          `⚠️  任务ID ${taskIdStr} (行${i + 1}) 属于 ${expectedAgent} 范围，但归属对象为 ${owner}`
        );
      }

      // 统计Agent使用情况
      if (!agentUsage.has(normalizedOwner)) {
        agentUsage.set(normalizedOwner, new Set());
      }
      agentUsage.get(normalizedOwner).add(taskIdNum);

      // 检查ID是否超出分配范围
      if (!expectedAgent) {
        errors.push(
          `❌ 任务ID ${taskIdStr} (行${i + 1}) 超出所有Agent的分配范围 (B001-B699)`
        );
      }
    }
  }

  // 打印检查结果
  console.log('🔍 任务ID冲突检测报告\n');
  console.log(`📊 共扫描 ${usedIds.size} 个任务\n`);

  // 打印错误
  if (errors.length > 0) {
    console.log('❌ 发现错误：');
    errors.forEach(err => console.log(`   ${err}`));
    console.log('');
  }

  // 打印警告
  if (warnings.length > 0) {
    console.log('⚠️  发现警告：');
    warnings.forEach(warn => console.log(`   ${warn}`));
    console.log('');
  }

  // 打印各Agent使用情况
  console.log('📋 Agent ID使用情况：');
  for (const [agent, range] of Object.entries(AGENT_RANGES)) {
    const used = agentUsage.get(agent) || new Set();
    const count = used.size;
    const nextId = count > 0 ? Math.max(...used) + 1 : range.min;

    console.log(
      `   ${agent.padEnd(12)} B${String(range.min).padStart(3, '0')}-B${String(range.max).padStart(3, '0')} ` +
      `已用 ${String(count).padStart(2, '0')}/${range.max - range.min + 1} ` +
      `(下一个ID: B${String(nextId).padStart(3, '0')})`
    );
  }

  console.log('');

  // 检查是否有@user的ID被其他Agent占用
  const userUsed = agentUsage.get('@user') || new Set();
  for (const id of userUsed) {
    const owner = Array.from(agentUsage.entries()).find(([_, ids]) =>
      ids.has(id) && _ !== '@user'
    );
    if (owner) {
      errors.push(
        `❌ 任务ID B${String(id).padStart(3, '0')} 属于 @user 范围，但被 ${owner[0]} 使用`
      );
    }
  }

  // 返回检查结果
  if (errors.length > 0) {
    console.log('❌ 检查失败：发现任务ID冲突或超出范围');
    process.exit(1);
  } else {
    console.log('✅ 检查通过：所有任务ID符合分配规则');
    process.exit(0);
  }
}

// 执行检查
try {
  checkTaskIds();
} catch (error) {
  console.error('❌ 脚本执行失败：', error.message);
  process.exit(1);
}
