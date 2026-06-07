#!/usr/bin/env bun
/**
 * BACKLOG event-log 核心库（唯一事实源：解析 + 折叠 + 渲染）
 *
 * 模型（道）：
 *   真相 = BACKLOG_LOG.jsonl（append-only 事件日志，merge=union）
 *   视图 = BACKLOG.md（活跃）+ BACKLOG_ARCHIVE.md（归档）—— 由本库折叠日志「渲染」得出，禁止手工编辑
 *
 * 为什么（根治上一代「可变表 + 并发」的三类病）：
 *   1. 碰号：写入方永不挑编号（uid 由创建时确定性生成）→ 无可碰撞之物
 *   2. 原地改行冲突：状态变更 = 追加一条 status 事件，从不回去改旧行 → union 永不产生重复行
 *   3. 手解派生文件：视图是日志的纯函数，冲突时「重新渲染」而非手解
 *
 * 事件种类（每行一个 JSON）：
 *   create {uid,kind,ts,actor,section,priority,desc,docs,code,legacy_id?}  任务诞生（uid=稳定身份）
 *   status {uid,kind,ts,actor,status,evidence}                            状态流转 + 证据
 *   note   {uid,kind,ts,actor,text}                                       追加上下文（渲染到证据列末尾）
 *   amend  {uid,kind,ts,actor,field,value}                                修订单字段
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const ROOT = process.cwd();
export const LOG_PATH = resolve(ROOT, 'BACKLOG_LOG.jsonl');
export const BACKLOG_PATH = resolve(ROOT, 'BACKLOG.md');
export const ARCHIVE_PATH = resolve(ROOT, 'BACKLOG_ARCHIVE.md');

export const EVENT_KINDS = ['create', 'status', 'note', 'amend'];
export const AMENDABLE_FIELDS = ['section', 'priority', 'desc', 'docs', 'code', 'owner'];
export const ACTIVE_STATUSES = ['PROPOSED', 'TRIAGED', 'IN_PROGRESS', 'PARTIAL', 'BLOCKED', 'TODO', 'DOING'];
export const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4'];

export const TABLE_HEADER = '| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |';
export const TABLE_SEP = '|----|----------|------|----------|----------|--------|------|----------|----------|-----------|';

/** 归属对象 → uid 用的 slug（@claude → claude） */
export function actorSlug(actor) {
  return String(actor || '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'anon';
}

/**
 * 把一行 Markdown 表格切成单元格（10 列），正确处理转义 `\|`，
 * 不被 desc/evidence 内部的竖线打乱列对齐。
 */
export function splitRow(line) {
  const parts = line.split(/(?<!\\)\|/);
  // 首尾各有一个因前导/尾随 `|` 产生的空串
  return parts.slice(1, -1).map(c => c.trim());
}

/** 解析事件日志文本 → 事件数组（带 __line 行号便于报错） */
export function parseLog(text) {
  const events = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch (e) {
      throw new Error(`BACKLOG_LOG.jsonl 第 ${i + 1} 行非法 JSON：${e.message}`);
    }
    ev.__line = i + 1;
    events.push(ev);
  }
  return events;
}

/** 从磁盘读日志（不存在 → 空数组） */
export function loadLog(p = LOG_PATH) {
  if (!existsSync(p)) return [];
  return parseLog(readFileSync(p, 'utf-8'));
}

/**
 * 折叠事件日志 → 任务状态 Map（uid -> task）。纯函数、确定性。
 * 时序：按 (ts, 日志内出现顺序) 升序应用，保证可重放、可收敛。
 */
export function fold(events) {
  const tasks = new Map();
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = String(a.e.ts || '');
      const tb = String(b.e.ts || '');
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.i - b.i;
    });

  for (const { e } of ordered) {
    const uid = e.uid;
    if (!uid) continue;
    if (e.kind === 'create') {
      if (!tasks.has(uid)) {
        tasks.set(uid, {
          uid,
          legacy_id: e.legacy_id || null,
          created: e.ts || '',
          owner: e.actor || '',
          section: e.section || '',
          priority: e.priority || 'P3',
          desc: e.desc || '',
          docs: e.docs || 'N/A',
          code: e.code || 'N/A',
          status: 'PROPOSED',
          evidence: '',
          notes: [],
        });
      }
      continue;
    }
    const t = tasks.get(uid);
    if (!t) continue; // 孤儿事件：governance checkBacklogLog 会报
    if (e.kind === 'status') {
      if (e.status) t.status = e.status;
      if (e.evidence != null) t.evidence = e.evidence;
    } else if (e.kind === 'note') {
      if (e.text) t.notes.push(e.text);
    } else if (e.kind === 'amend') {
      if (AMENDABLE_FIELDS.includes(e.field) && e.value != null) t[e.field] = e.value;
    }
  }
  return tasks;
}

/** 显示 ID：迁移任务用曾用号(legacy_id 如 B244)，新任务用 uid */
export function displayId(t) {
  return t.legacy_id || t.uid;
}

export function isActive(t) {
  return t.status !== 'DONE';
}

/** legacy_id 的数字部分（B244 → 244；无则 Infinity 排末尾） */
export function legacyNum(t) {
  const m = (t.legacy_id || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

/** 证据列：status 证据 + 各 note（按时序，用 <br> 连接） */
function evidenceCell(t) {
  const parts = [];
  if (t.evidence) parts.push(t.evidence);
  for (const n of t.notes) parts.push(n);
  return parts.join(' <br>');
}

/** 渲染一行 10 列 */
export function renderRow(t) {
  return `| ${displayId(t)} | ${t.created} | ${t.section} | ${t.owner} | ${t.desc} | ${t.priority} | ${t.status} | ${t.docs} | ${t.code} | ${evidenceCell(t)} |`;
}

/** 活跃排序：(created, uid) 升序 —— 确定性，使「视图 == 折叠(日志)」字节稳定 */
export function sortActive(list) {
  return [...list].sort((a, b) => {
    if (a.created !== b.created) return a.created < b.created ? -1 : 1;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

/** 归档排序：曾用号数字升序，再 created */
export function sortArchive(list) {
  return [...list].sort((a, b) => {
    const na = legacyNum(a);
    const nb = legacyNum(b);
    if (na !== nb) return na - nb;
    if (a.created !== b.created) return a.created < b.created ? -1 : 1;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

/** 数据戳 = 日志中最新事件日期（派生稳定，不用 wall-clock，避免守卫每天误报） */
export function latestTs(tasks) {
  let m = '';
  for (const t of tasks) if (t.created > m) m = t.created;
  return m || '—';
}

/** 速查看板：按优先级分组的活跃任务一览 */
export function buildDashboard(activeTasks, calDate) {
  const items = activeTasks.map(t => ({
    id: displayId(t),
    desc: t.desc.replace(/\*\*/g, '').replace(/`/g, '').split(/[：:。\n]/)[0].trim().slice(0, 44),
    pri: t.priority,
    status: t.status,
  }));
  const lines = [
    `## 📋 活跃任务速查（${items.length} 项 · 数据截至 ${calDate} · 由日志折叠自动生成，请勿手工编辑）`,
    '',
    '> 已完成任务见 [BACKLOG_ARCHIVE.md](./BACKLOG_ARCHIVE.md)。重新生成：`bun scripts/governance-backlog-curate.mjs --apply`',
    '',
  ];
  for (const p of PRIORITY_ORDER) {
    const group = items.filter(it => it.pri === p);
    if (!group.length) continue;
    lines.push(`**${p}（${group.length} 项）**`, '');
    for (const it of group) {
      const tag = it.status === 'PROPOSED' ? '' : ` \`${it.status}\``;
      lines.push(`- ${it.id}${tag} — ${it.desc}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function backlogHeader(dashboard) {
  return `# 需求账本 (BACKLOG)

**唯一真理来源**：所有需求登记在事件日志 [\`BACKLOG_LOG.jsonl\`](./BACKLOG_LOG.jsonl)（append-only 真相）。本文件是其**派生视图，禁止手工编辑**。

**模型（event-log）**：写入 = 向 \`BACKLOG_LOG.jsonl\` **追加事件**（永不原地改行、永不挑编号）；本看板与归档由 \`governance-backlog-curate.mjs\` 折叠日志渲染。多分支并发写因此**结构性地不再碰号、不再产生重复行**（\`.gitattributes\` 对日志设 merge=union，追加天然可交换）。

**更新规则**（一律走 \`bun scripts/backlog.mjs\`，写入方不挑号）：
- 新增需求：\`bun scripts/backlog.mjs add --actor @<agent> --priority Px --section "板块" --desc "描述" [--docs ...] [--code ...]\`
- 状态流转：\`bun scripts/backlog.mjs status <id> IN_PROGRESS\`；完成：\`bun scripts/backlog.mjs status <id> DONE --evidence "PR/commit/测试证据"\`（DONE 必须带证据）
- 补充信息：\`bun scripts/backlog.mjs note <id> "..."\`；修订字段：\`bun scripts/backlog.mjs amend <id> --priority P1\`
- 重新渲染：\`bun scripts/governance-backlog-curate.mjs --apply\`（折叠日志 → 刷新本文件 + 归档 + 看板）

**编号**：历史曾用号（B234…）对迁移任务保留显示以兼容旧引用；新任务用 uid（如 \`2026-06-07-claude-a3f\`，稳定身份，引用以 uid 为准）。

**校验**：\`bun run scripts/check-governance.mjs\` 校验日志完整性（事件字段 / 孤儿事件 / uid·曾用号唯一）+ DONE 证据链 +「视图 == 折叠(日志)」陈旧守卫。

---

${dashboard}
---

## 任务列表（活跃）

${TABLE_HEADER}
${TABLE_SEP}`;
}

function archiveHeader(count) {
  return `# 需求账本归档 (BACKLOG ARCHIVE)

**用途**：存放已完成（DONE）任务，完整保留 ID、描述、证据，供历史追溯。当前 ${count} 项。

**铁律**：
- 本文件是 [\`BACKLOG_LOG.jsonl\`](./BACKLOG_LOG.jsonl) 的**派生视图**，由 \`bun scripts/governance-backlog-curate.mjs --apply\` 折叠日志渲染，**禁止手工编辑**。
- 完成任务：\`bun scripts/backlog.mjs status <id> DONE --evidence "..."\`（追加 status 事件，再重新渲染）。
- 证据链同样受 \`check-governance.mjs\` 校验。

---

${TABLE_HEADER}
${TABLE_SEP}`;
}

/** 渲染完整 BACKLOG.md（活跃视图）—— 纯函数 */
export function renderBacklog(tasksAll) {
  const list = [...tasksAll];
  const active = sortActive(list.filter(isActive));
  const calDate = latestTs(list);
  const dashboard = buildDashboard(active, calDate);
  const body = active.map(renderRow).join('\n');
  return `${backlogHeader(dashboard)}\n${body}\n`;
}

/** 渲染完整 BACKLOG_ARCHIVE.md（归档视图）—— 纯函数 */
export function renderArchive(tasksAll) {
  const done = sortArchive([...tasksAll].filter(t => !isActive(t)));
  const body = done.map(renderRow).join('\n');
  return `${archiveHeader(done.length)}\n${body}\n`;
}

/** 校验事件日志结构完整性 → { errors:[], warnings:[], stats:{} } */
export function validateLog(events) {
  const errors = [];
  const warnings = [];
  const createUids = new Map(); // uid -> __line
  const legacyIds = new Map(); // legacy_id -> uid

  for (const e of events) {
    const at = `第 ${e.__line} 行`;
    if (!EVENT_KINDS.includes(e.kind)) {
      errors.push(`${at}：未知事件 kind="${e.kind}"`);
      continue;
    }
    if (!e.uid) errors.push(`${at}：缺 uid`);
    if (!e.ts || !/^\d{4}-\d{2}-\d{2}$/.test(e.ts)) errors.push(`${at}：ts 缺失或非 YYYY-MM-DD（${e.ts}）`);
    if (e.kind === 'create') {
      if (createUids.has(e.uid)) {
        errors.push(`${at}：create uid 重复（与第 ${createUids.get(e.uid)} 行撞）— uid 必须唯一`);
      } else {
        createUids.set(e.uid, e.__line);
      }
      if (e.legacy_id) {
        if (legacyIds.has(e.legacy_id) && legacyIds.get(e.legacy_id) !== e.uid) {
          errors.push(`${at}：曾用号 ${e.legacy_id} 被多个 uid 占用（禁止复用历史编号）`);
        } else {
          legacyIds.set(e.legacy_id, e.uid);
        }
      }
      if (!PRIORITY_ORDER.includes(e.priority)) warnings.push(`${at}：优先级 "${e.priority}" 非 P0-P4`);
    } else if (e.kind === 'status') {
      if (!e.status) errors.push(`${at}：status 事件缺 status 字段`);
    } else if (e.kind === 'amend') {
      if (!AMENDABLE_FIELDS.includes(e.field)) errors.push(`${at}：amend 字段 "${e.field}" 不可改（允许：${AMENDABLE_FIELDS.join('/')}）`);
    }
  }

  // 孤儿事件：status/note/amend 引用了不存在的 create uid
  for (const e of events) {
    if (e.kind !== 'create' && e.uid && !createUids.has(e.uid)) {
      errors.push(`第 ${e.__line} 行：${e.kind} 事件引用了不存在的任务 uid="${e.uid}"（孤儿事件）`);
    }
  }

  return {
    errors,
    warnings,
    stats: { events: events.length, tasks: createUids.size },
  };
}
