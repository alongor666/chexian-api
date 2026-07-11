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
 *   bun scripts/backlog.mjs status <id|uid> CANCELLED|WONTFIX --evidence "弃置理由" [--actor @claude]
 *   bun scripts/backlog.mjs note   <id|uid> "补充信息" [--actor @claude]
 *   bun scripts/backlog.mjs amend  <id|uid> --priority P1 [--actor @claude]   (可改 section/priority/desc/docs/code/owner)
 *   bun scripts/backlog.mjs claim  <id|uid> [--agent "认领方"] [--note "..."] [--actor @claude]   (派发即登记：置 DOING + owner + note；已认领则拒绝)
 *   bun scripts/backlog.mjs release <id|uid> "撤回理由" [--actor @claude]                          (撤回认领：DOING → PROPOSED)
 *   bun scripts/backlog.mjs list   [--all]
 *
 * 派发纪律（防重复派发 · 见 .claude/rules/backlog-eventlog.md §11）：
 *   spawn_task 派发任务卡『之前』必须先 `claim`——把「已派发/在做」实时写回 backlog（status=DOING + owner=认领方）。
 *   claim 对已 DOING/IN_PROGRESS 的任务 fail-closed 拒绝，从机制上杜绝两个 Agent 认领同一任务撞车。
 *   撤回任务卡时对称 `release`，把 DOING 退回 PROPOSED，交还队列。
 *
 * 选择器 <id|uid>：曾用号(B244) / 完整 uid / uid 唯一后缀，皆可。
 *
 * 终态（DONE/CANCELLED/WONTFIX）均移出活跃看板、渲染进 BACKLOG_ARCHIVE.md，且均须带 --evidence
 * （DONE=完成证据，CANCELLED/WONTFIX=弃置理由）—— 同一强制机制，缺证据/理由一律拒绝写入。
 */

import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import {
  loadLog, fold, validateLog, renderBacklog, renderArchive, displayId, isActive,
  ACTIVE_STATUSES, TERMINAL_STATUSES, PRIORITY_ORDER, AMENDABLE_FIELDS,
  LOG_PATH, BACKLOG_PATH, ARCHIVE_PATH,
} from './backlog/lib.mjs';
import { evaluateClaim, evaluateRelease } from './backlog/claim-gate.mjs';

const ALL_STATUSES = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];

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

/** 追加事件并重渲染视图。每条事件补 at（全时间戳）+ eid（唯一键）→ 折叠分支无关确定性 */
function appendAndRerender(events) {
  const stamped = events.map(e => ({
    ...e,
    at: e.at || new Date().toISOString(),
    eid: e.eid || randomBytes(4).toString('hex'),
  }));
  const line = stamped.map(e => JSON.stringify(e)).join('\n') + '\n';
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
  if (TERMINAL_STATUSES.includes(status) && !evidence) {
    die(`${status} 是终态，必须带 --evidence "${status === 'DONE' ? 'PR/commit/测试证据' : '弃置理由'}"`);
  }
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

/**
 * claim：派发即登记（防重复派发的核心闸）。
 *
 * 根治的病：spawn_task 派发任务卡与 backlog 状态是两套互不联动的系统——PROPOSED 任务被派发后，
 * 看板毫无痕迹，别的 Agent（或同一循环再跑一次）会重复认领撞车（实证：2026-07-10 山西维修域
 * 2815e4 已有 Agent 在做，backlog 仍 PROPOSED 被重复 spawn）。
 *
 * 语义：把「已派发/在做」原子写回 backlog —— status→DOING + owner→认领方 + 一条认领 note。
 * fail-closed：目标已是 DOING/IN_PROGRESS（有人在做）或终态 → 拒绝，杜绝两人认领同一任务。
 */
function cmdClaim(pos, flags) {
  const [, sel] = pos;
  const tasks = fold(loadLog());
  const uid = resolveUid(sel, tasks);
  const task = tasks.get(uid);
  const actor = flags.actor || '@claude';
  const verdict = evaluateClaim(task, TERMINAL_STATUSES);
  if (!verdict.allowed) {
    if (verdict.code === 'already-claimed') {
      die(`任务 ${displayId(task)} ${verdict.reason} —— 勿重复派发。\n` +
          `   · 确需接手：先与现 owner 对齐；\n` +
          `   · 该认领已废弃：先 \`release ${displayId(task)} "理由"\` 交还队列，再 claim。`);
    }
    die(`任务 ${displayId(task)} ${verdict.reason}，不可认领。`);
  }
  const agent = (flags.agent != null && flags.agent !== true) ? String(flags.agent) : actor;
  const extra = (flags.note != null && flags.note !== true) ? `；${flags.note}` : '';
  const stamp = new Date().toISOString();
  const claimNote = `【认领·派发登记】${agent} 于 ${stamp} 接手（派发即登记，防重复派发）${extra}`;
  appendAndRerender([
    { uid, kind: 'status', ts: today(), actor, status: 'DOING' },
    { uid, kind: 'amend', ts: today(), actor, field: 'owner', value: esc(agent) },
    { uid, kind: 'note', ts: today(), actor, text: esc(claimNote) },
  ]);
  console.log(`✅ ${displayId(task)} 已认领 → DOING（owner=${agent}；视图已刷新）`);
  console.log('   ▶ 纪律：spawn_task 派发任务卡『之前』先跑本命令，让 backlog 实时反映在做的任务。');
}

/**
 * release：撤回认领（claim 的对称操作）。把 claim 产生的 DOING 退回 PROPOSED，交还队列。
 * 只针对 DOING —— IN_PROGRESS/PARTIAL 是实质进展态，用 status 正常流转，不该被 release 简单退回。
 */
function cmdRelease(pos, flags) {
  const [, sel, ...rest] = pos;
  const reason = rest.join(' ').trim() || ((flags.reason != null && flags.reason !== true) ? String(flags.reason) : '');
  const tasks = fold(loadLog());
  const uid = resolveUid(sel, tasks);
  const task = tasks.get(uid);
  const actor = flags.actor || '@claude';
  const verdict = evaluateRelease(task);
  if (!verdict.allowed) {
    die(`任务 ${displayId(task)} ${verdict.reason}，无需 release。\n` +
        `   （IN_PROGRESS/PARTIAL 是实质进展态，请用 \`status\` 正常流转，不用 release 退回。）`);
  }
  if (!reason) die('release 必须说明撤回理由：release <id> "理由" 或 --reason "理由"');
  appendAndRerender([
    { uid, kind: 'status', ts: today(), actor, status: 'PROPOSED' },
    { uid, kind: 'note', ts: today(), actor, text: esc(`【撤回认领】${actor}：${reason}`) },
  ]);
  console.log(`✅ ${displayId(task)} 已撤回认领 → PROPOSED（重新开放；视图已刷新）`);
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
  case 'claim': cmdClaim(pos, flags); break;
  case 'release': cmdRelease(pos, flags); break;
  case 'list': cmdList(flags); break;
  default:
    console.log('用法：bun scripts/backlog.mjs <add|status|note|amend|list> ...');
    console.log('  add    --actor @x --priority Px --section "..." --desc "..." [--docs ...] [--code ...]');
    console.log('  status <id|uid> <STATUS> [--evidence "..."] [--actor @x]   STATUS ∈ ' + ALL_STATUSES.join('/'));
    console.log('         终态 ' + TERMINAL_STATUSES.join('/') + ' 必须带 --evidence（DONE=完成证据，CANCELLED/WONTFIX=弃置理由）');
    console.log('  note   <id|uid> "..." [--actor @x]');
    console.log('  amend  <id|uid> --priority P1|--section ...|--desc ... [--actor @x]');
    console.log('  claim  <id|uid> [--agent "认领方"] [--note "..."] [--actor @x]   派发即登记：置 DOING+owner+note（已认领则拒绝）');
    console.log('  release <id|uid> "撤回理由" [--actor @x]                        撤回认领：DOING → PROPOSED');
    console.log('  list   [--all]');
    process.exit(cmd ? 1 : 0);
}
