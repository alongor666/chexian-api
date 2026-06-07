#!/usr/bin/env bun
/**
 * BACKLOG 事件追加入口（唯一写路径，写入方永不挑号）
 *
 * 道：所有变更 = 向 BACKLOG_LOG.jsonl **追加一条事件**，绝不原地改行、绝不挑编号。
 *     追加完自动重渲染 BACKLOG.md + BACKLOG_ARCHIVE.md（保持视图与日志一致）。
 *     多分支并发各自 add → merge=union 自动并入，结构性无碰号、无重复行。
 *
 * 用法：
 *   bun scripts/backlog.mjs add --actor @claude --priority P2 --section "Bug/Backend" --desc "描述" [--docs "..."] [--code "..."]
 *   bun scripts/backlog.mjs status <id|uid> IN_PROGRESS [--actor @claude]
 *   bun scripts/backlog.mjs status <id|uid> DONE --evidence "PR/commit/测试证据" [--actor @claude]
 *   bun scripts/backlog.mjs note   <id|uid> "补充信息" [--actor @claude]
 *   bun scripts/backlog.mjs amend  <id|uid> --priority P1 [--actor @claude]   (可改 section/priority/desc/docs/code/owner)
 *   bun scripts/backlog.mjs list   [--all]
 *
 * 选择器 <id|uid>：曾用号(B244) / 完整 uid / uid 唯一后缀，皆可。
 */

import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import {
  loadLog, fold, validateLog, renderBacklog, renderArchive, displayId, isActive,
  ACTIVE_STATUSES, PRIORITY_ORDER, AMENDABLE_FIELDS,
  LOG_PATH, BACKLOG_PATH, ARCHIVE_PATH,
} from './backlog/lib.mjs';

const ALL_STATUSES = [...ACTIVE_STATUSES, 'DONE'];

// ── 参数解析：位置参数 + --flag value ──
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[key] = true; }
      else { flags[key] = next; i++; }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

/** MD 转义：内容里的竖线必须转义，否则破坏表格列对齐 */
function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function newUid(actor) {
  const slug = String(actor || '').replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'anon';
  return `${today()}-${slug}-${randomBytes(3).toString('hex')}`;
}

function die(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

/** 把选择器解析为已存在任务的 uid */
function resolveUid(sel, tasks) {
  if (!sel) die('缺少 <id|uid> 选择器');
  const list = [...tasks.values()];
  // 1) 曾用号精确
  let hit = list.filter(t => t.legacy_id === sel);
  // 2) uid 精确
  if (!hit.length) hit = list.filter(t => t.uid === sel);
  // 3) uid 后缀/子串唯一
  if (!hit.length) hit = list.filter(t => t.uid.endsWith(sel) || t.uid.includes(sel));
  if (!hit.length) die(`找不到任务：${sel}`);
  if (hit.length > 1) die(`选择器 "${sel}" 命中多个任务：${hit.map(displayId).join(', ')}（请用更精确的 uid）`);
  return hit[0].uid;
}

/** 追加事件并重渲染视图 */
function appendAndRerender(events) {
  const line = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(LOG_PATH, line, 'utf-8');
  // 校验 + 重渲染
  const all = loadLog();
  const { errors } = validateLog(all);
  if (errors.length) {
    console.error('\n❌ 追加后日志校验失败（已写入日志，但视图未刷新）：');
    errors.slice(0, 10).forEach(e => console.error('  · ' + e));
    process.exit(1);
  }
  const tasks = [...fold(all).values()];
  writeFileSync(BACKLOG_PATH, renderBacklog(tasks), 'utf-8');
  writeFileSync(ARCHIVE_PATH, renderArchive(tasks), 'utf-8');
}

// ── 子命令 ──
function cmdAdd(flags) {
  const actor = flags.actor || '@claude';
  const priority = flags.priority || 'P3';
  if (!PRIORITY_ORDER.includes(priority)) die(`优先级须为 ${PRIORITY_ORDER.join('/')}`);
  if (!flags.desc || flags.desc === true) die('缺少 --desc "描述"');
  const uid = newUid(actor);
  const ts = today();
  const create = {
    uid, kind: 'create', ts, actor,
    section: esc(flags.section || 'Chore'),
    priority,
    desc: esc(flags.desc),
    docs: esc(flags.docs || 'N/A'),
    code: esc(flags.code || 'N/A'),
  };
  const status = { uid, kind: 'status', ts, actor, status: 'PROPOSED', evidence: esc(flags.evidence || '') };
  appendAndRerender([create, status]);
  console.log(`✅ 新增任务 uid=${uid}（${priority} · ${actor}）`);
  console.log('   引用以 uid 为准；视图已刷新。');
}

function cmdStatus(pos, flags) {
  const [, sel, status] = pos;
  if (!ALL_STATUSES.includes(status)) die(`状态须为 ${ALL_STATUSES.join('/')}`);
  const tasks = fold(loadLog());
  const uid = resolveUid(sel, tasks);
  const actor = flags.actor || '@claude';
  const evidence = esc(flags.evidence || '');
  if (status === 'DONE' && !evidence) die('DONE 必须带 --evidence "PR/commit/测试证据"');
  appendAndRerender([{ uid, kind: 'status', ts: today(), actor, status, evidence }]);
  console.log(`✅ ${displayId(tasks.get(uid))} → ${status}（视图已刷新）`);
}

function cmdNote(pos, flags) {
  const [, sel, ...rest] = pos;
  const text = rest.join(' ').trim();
  if (!text) die('缺少 note 文本');
  const tasks = fold(loadLog());
  const uid = resolveUid(sel, tasks);
  appendAndRerender([{ uid, kind: 'note', ts: today(), actor: flags.actor || '@claude', text: esc(text) }]);
  console.log(`✅ ${displayId(tasks.get(uid))} 已追加 note（视图已刷新）`);
}

function cmdAmend(pos, flags) {
  const [, sel] = pos;
  const tasks = fold(loadLog());
  const uid = resolveUid(sel, tasks);
  const actor = flags.actor || '@claude';
  const events = [];
  for (const f of AMENDABLE_FIELDS) {
    if (flags[f] != null && flags[f] !== true) {
      events.push({ uid, kind: 'amend', ts: today(), actor, field: f, value: esc(flags[f]) });
    }
  }
  if (!events.length) die(`未指定要改的字段（可改：${AMENDABLE_FIELDS.join('/')}）`);
  appendAndRerender(events);
  console.log(`✅ ${displayId(tasks.get(uid))} 已修订 ${events.map(e => e.field).join(', ')}（视图已刷新）`);
}

function cmdList(flags) {
  const tasks = [...fold(loadLog()).values()];
  const show = flags.all ? tasks : tasks.filter(isActive);
  show.sort((a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
  for (const t of show) {
    console.log(`${t.priority}  ${displayId(t).padEnd(28)} ${t.status.padEnd(12)} ${t.desc.replace(/\*\*/g, '').slice(0, 50)}`);
  }
  console.log(`\n合计 ${show.length} 项（${flags.all ? '全部' : '活跃'}）`);
}

// ── 入口 ──
if (!existsSync(LOG_PATH)) die(`未找到事件日志 ${LOG_PATH}（首次请先 bun scripts/backlog/migrate.mjs --apply）`);

const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos[0];
switch (cmd) {
  case 'add': cmdAdd(flags); break;
  case 'status': cmdStatus(pos, flags); break;
  case 'note': cmdNote(pos, flags); break;
  case 'amend': cmdAmend(pos, flags); break;
  case 'list': cmdList(flags); break;
  default:
    console.log('用法：bun scripts/backlog.mjs <add|status|note|amend|list> ...');
    console.log('  add    --actor @x --priority Px --section "..." --desc "..." [--docs ...] [--code ...]');
    console.log('  status <id|uid> <STATUS> [--evidence "..."] [--actor @x]   STATUS ∈ ' + ALL_STATUSES.join('/'));
    console.log('  note   <id|uid> "..." [--actor @x]');
    console.log('  amend  <id|uid> --priority P1|--section ...|--desc ... [--actor @x]');
    console.log('  list   [--all]');
    process.exit(cmd ? 1 : 0);
}
