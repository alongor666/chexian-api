#!/usr/bin/env bun
/**
 * BACKLOG 事件日志快速校验（event-log 模型，2026-06 治本后）
 *
 * 是 governance「BACKLOG事件日志」检查中「日志结构完整性」部分的独立入口，便于本地快速自检：
 *   - 每条事件 kind/uid/ts 合规
 *   - create uid 唯一、曾用号唯一（禁复用历史编号）
 *   - 无孤儿事件（status/note/amend 必须引用已存在的 create）
 *
 * 「视图 == 折叠(日志)」的陈旧守卫在 check-governance.mjs 中执行（需读取 BACKLOG.md/ARCHIVE 对比）。
 * 旧的「Agent 区间 / 全局 max+1」编号校验已随 event-log 重构退役（写入方不再挑号 → 无可冲突之物）。
 *
 * 用法：bun scripts/check-task-id-conflict.mjs
 */

import { existsSync } from 'fs';
import { loadLog, validateLog, LOG_PATH } from './backlog/lib.mjs';

if (!existsSync(LOG_PATH)) {
  console.error(`❌ 未找到事件日志 ${LOG_PATH}（首次请 bun scripts/backlog/migrate.mjs --apply）`);
  process.exit(1);
}

let events;
try {
  events = loadLog();
} catch (e) {
  console.error(`❌ BACKLOG_LOG.jsonl 解析失败：${e.message}`);
  process.exit(1);
}

const { errors, warnings, stats } = validateLog(events);

console.log('🔍 BACKLOG 事件日志校验\n');
console.log(`📊 ${stats.events} 事件 / ${stats.tasks} 任务\n`);

if (warnings.length) {
  console.log('⚠️  提示：');
  warnings.forEach(w => console.log(`   ${w}`));
  console.log('');
}

if (errors.length) {
  console.log('❌ 发现错误：');
  errors.forEach(e => console.log(`   ${e}`));
  console.log('\n❌ 校验失败');
  process.exit(1);
}

console.log('✅ 校验通过：事件结构完整、uid/曾用号唯一、无孤儿事件');
console.log('   （视图陈旧守卫见 bun run scripts/check-governance.mjs）');
process.exit(0);
