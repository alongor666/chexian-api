#!/usr/bin/env bun
/**
 * 一次性迁移：把 BACKLOG.md + BACKLOG_ARCHIVE.md 的现状「播种」为事件日志 BACKLOG_LOG.jsonl
 *
 * 设计：
 *  - 每个任务 → create 事件（定义）+ status 事件（当前状态 + 证据）
 *  - uid 由 legacy_id 确定性派生（${ts}-${slug}-${b244}）→ 幂等、可重放、内嵌曾用号
 *  - 各单元格逐字搬运（splitRow 处理转义 \|）→ 折叠+渲染后与原行字节等价
 *  - 内置等价校验：渲染回去逐任务逐列比对原文件，零数据丢失才算成功
 *
 * 用法：bun scripts/backlog/migrate.mjs [--apply]
 *   不加 --apply：dry-run，只跑等价校验、不写日志
 *   加 --apply：写入 BACKLOG_LOG.jsonl
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  splitRow, actorSlug, fold, renderRow, displayId,
  BACKLOG_PATH, ARCHIVE_PATH, LOG_PATH,
} from './lib.mjs';

const APPLY = process.argv.includes('--apply');

/**
 * 解析一个 MD 文件里的任务行 → cells[] 数组。
 * 铁律：任何任务行必须恰好 10 列；非 10 列一律收集为 defect 并由调用方 fail-fast，
 * 杜绝「静默跳过 / 截断」让任务蒸发（B294 曾因缺一根列分隔符被旧 governance 静默漏掉）。
 */
function parseTableRows(p, defects) {
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf-8').split('\n');
  const rows = [];
  let inTable = false;
  let sepPassed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('| ID |')) { inTable = true; continue; }
    if (inTable && !sepPassed && t.startsWith('|---')) { sepPassed = true; continue; }
    if (inTable && sepPassed) {
      if (t.startsWith('|')) {
        const cells = splitRow(line.replace(/\s+$/, ''));
        if (cells.length === 10) {
          rows.push(cells);
        } else {
          defects.push(`${p} 第 ${i + 1} 行 列数=${cells.length}（应为 10）ID=${cells[0] || '?'}：${t.slice(0, 80)}`);
        }
        continue;
      }
      if (t && !t.startsWith('|')) break;
    }
  }
  return rows;
}

/** cells[] → [create, status] 两个事件 */
function rowToEvents(cells) {
  const [id, ts, section, owner, desc, priority, status, docs, code, evidence] = cells;
  const uid = `${ts}-${actorSlug(owner)}-${id.toLowerCase()}`;
  return [
    { uid, kind: 'create', ts, actor: owner, section, priority, desc, docs, code, legacy_id: id },
    { uid, kind: 'status', ts, actor: owner, status, evidence },
  ];
}

// ── 解析现状 ──
const defects = [];
const activeRows = parseTableRows(BACKLOG_PATH, defects);
const archiveRows = parseTableRows(ARCHIVE_PATH, defects);
if (defects.length) {
  console.log(`\n❌ 源文件存在非 10 列的畸形任务行 ${defects.length} 处（拒绝静默漏行）：\n`);
  defects.forEach(d => console.log('  · ' + d));
  console.log('\n请先修正源行（补全/转义列分隔符）再迁移。');
  process.exit(1);
}
const allRows = [...activeRows, ...archiveRows];

// 原行（按显示 ID 索引，用于等价比对）
const originalById = new Map();
for (const cells of allRows) originalById.set(cells[0], cells);

// ── 生成事件 ──
const events = [];
for (const cells of allRows) events.push(...rowToEvents(cells));

// ── 等价校验：折叠 → 渲染 → 与原行逐列比对 ──
const tasks = [...fold(events).values()];
const renderedById = new Map();
for (const t of tasks) renderedById.set(displayId(t), t);

const mismatches = [];
const COLS = ['ID', '提出时间', '板块', '归属对象', '需求描述', '优先级', '状态', '关联文档', '关联代码', '验收/证据'];
for (const [id, origCells] of originalById) {
  const t = renderedById.get(id);
  if (!t) { mismatches.push(`${id}: 渲染后丢失`); continue; }
  const renderedCells = splitRow(renderRow(t));
  for (let c = 0; c < 10; c++) {
    if ((origCells[c] || '') !== (renderedCells[c] || '')) {
      mismatches.push(`${id} 列「${COLS[c]}」不一致:\n  原: ${JSON.stringify(origCells[c])}\n  新: ${JSON.stringify(renderedCells[c])}`);
    }
  }
}
// 反向：渲染出现了原本没有的任务？
for (const id of renderedById.keys()) {
  if (!originalById.has(id)) mismatches.push(`${id}: 渲染多出（原文件无）`);
}

console.log(`\n=== BACKLOG 迁移（可变表 → 事件日志）${APPLY ? '【APPLY】' : '【DRY-RUN】'} ===\n`);
console.log(`活跃任务行：${activeRows.length}`);
console.log(`归档任务行：${archiveRows.length}`);
console.log(`任务合计：${allRows.length} → 事件：${events.length}（每任务 create+status）`);
console.log(`折叠后任务：${tasks.length}`);

if (mismatches.length) {
  console.log(`\n❌ 等价校验失败：${mismatches.length} 处不一致\n`);
  mismatches.slice(0, 40).forEach(m => console.log('  · ' + m));
  console.log('\n迁移中止（未写日志）。修正解析/渲染逻辑后重试。');
  process.exit(1);
}
console.log(`\n✅ 等价校验通过：${allRows.length}/${allRows.length} 任务 × 10 列与原文件逐字一致，零数据丢失`);

if (APPLY) {
  const out = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(LOG_PATH, out, 'utf-8');
  console.log(`\n✅ 已写入 ${LOG_PATH}（${events.length} 事件）`);
  console.log('下一步：bun scripts/governance-backlog-curate.mjs --apply  渲染派生视图');
} else {
  console.log('\nℹ️  dry-run 未写日志。确认无误后加 --apply。');
}
