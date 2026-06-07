#!/usr/bin/env bun
/**
 * BACKLOG 渲染器 — 折叠事件日志 → 派生视图（幂等、纯函数）
 *
 * 模型（道）：真相是 BACKLOG_LOG.jsonl（append-only 事件日志）；
 *   BACKLOG.md（活跃）+ BACKLOG_ARCHIVE.md（归档）是它的**派生视图**。
 *   本脚本 = 折叠日志 → 渲染两个视图。视图 = 纯函数(日志)，故：
 *     - 冲突时「重新渲染」而非手解
 *     - governance 守卫「视图 == 折叠(日志)」，杜绝手改漂移
 *
 * 上一代「状态校准 / 非标 ID 重编号 / 治理行注入」三块命令式逻辑已退役——
 * 它们是「可变表」时代的一次性补丁，现已固化进事件日志的播种（见 backlog/migrate.mjs）。
 *
 * 用法：
 *   bun scripts/governance-backlog-curate.mjs            # dry-run（默认，仅预览）
 *   bun scripts/governance-backlog-curate.mjs --apply    # 写入 BACKLOG.md + BACKLOG_ARCHIVE.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  loadLog, fold, validateLog, renderBacklog, renderArchive, isActive,
  LOG_PATH, BACKLOG_PATH, ARCHIVE_PATH,
} from './backlog/lib.mjs';

const APPLY = process.argv.includes('--apply');

if (!existsSync(LOG_PATH)) {
  console.error(`❌ 未找到事件日志 ${LOG_PATH}`);
  console.error('   首次请先播种：bun scripts/backlog/migrate.mjs --apply');
  process.exit(1);
}

const events = loadLog();
const { errors, warnings, stats } = validateLog(events);
if (errors.length) {
  console.error(`\n❌ 事件日志有 ${errors.length} 处错误，拒绝渲染：\n`);
  errors.forEach(e => console.error('  · ' + e));
  process.exit(1);
}

const tasks = [...fold(events).values()];
const active = tasks.filter(isActive);
const done = tasks.filter(t => !isActive(t));

const newBacklog = renderBacklog(tasks);
const newArchive = renderArchive(tasks);

const curBacklog = existsSync(BACKLOG_PATH) ? readFileSync(BACKLOG_PATH, 'utf-8') : '';
const curArchive = existsSync(ARCHIVE_PATH) ? readFileSync(ARCHIVE_PATH, 'utf-8') : '';
const backlogChanged = curBacklog !== newBacklog;
const archiveChanged = curArchive !== newArchive;

console.log(`\n=== BACKLOG 渲染（折叠日志 → 派生视图）${APPLY ? '【APPLY】' : '【DRY-RUN】'} ===\n`);
console.log(`事件：${stats.events}  任务：${stats.tasks}（活跃 ${active.length} / 归档 ${done.length}）`);
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 处提示：`);
  warnings.slice(0, 10).forEach(w => console.log('  · ' + w));
}
console.log(`\nBACKLOG.md：${backlogChanged ? '需更新' : '已是最新'}`);
console.log(`BACKLOG_ARCHIVE.md：${archiveChanged ? '需更新' : '已是最新'}`);

if (APPLY) {
  if (backlogChanged) writeFileSync(BACKLOG_PATH, newBacklog, 'utf-8');
  if (archiveChanged) writeFileSync(ARCHIVE_PATH, newArchive, 'utf-8');
  console.log(`\n✅ 已渲染（活跃 ${active.length} / 归档 ${done.length}）`);
} else {
  console.log('\nℹ️  dry-run 未写入。确认无误后加 --apply。');
}
