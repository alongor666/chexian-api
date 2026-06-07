#!/usr/bin/env bun
/**
 * [DEPRECATED 2026-06] BACKLOG 已迁移到 event-log 模型（见 BACKLOG_LOG.jsonl）。
 *
 * 旧职责「为 Agent 分配下一个任务编号」已不复存在 —— 写入方**永不挑号**：
 * 任务身份是创建时生成的稳定 uid，看板上的曾用号仅对历史任务保留显示。
 * 「全局 max+1」这种从本地读全局计数派生编号的做法，正是多分支并发碰号的根因，已被结构性根除。
 *
 * 新增任务请改用：
 *   bun scripts/backlog.mjs add --actor @<agent> --priority Px --section "板块" --desc "描述" [--docs ...] [--code ...]
 */

console.error('⚠️  scripts/assign-task-id.mjs 已弃用（BACKLOG 改为 event-log，写入方不再挑编号）。');
console.error('');
console.error('   新增任务：');
console.error('   bun scripts/backlog.mjs add --actor @<agent> --priority Px --section "板块" --desc "描述"');
console.error('');
console.error('   详见 BACKLOG.md 头部「更新规则」与 .claude/rules/worktree-setup.md「BACKLOG event-log」节。');
process.exit(1);
