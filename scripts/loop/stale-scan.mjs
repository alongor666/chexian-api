#!/usr/bin/env node
/**
 * Loop v2 陈旧任务扫描器（stale-scan）—— 找出「实际已完成/被取代但 backlog 状态未流转」的假阳性。
 *
 * 动机：2026-06-21 并行波接触的前沿任务里 6ae4d7 / 90a92c / b246 / b330 共 4 个都是陈旧状态
 * （工作已在别的 PR 落地，status 没维护）→ dispatch 持续假阳性、险些重做已上线代码。本扫描器
 * 把「逐任务现实核查」机制化，输出疑似已完成清单供人工逐个确认（不自动改状态——状态流转需人定夺）。
 *
 * 两类信号：
 *  1. note-完成信号（纯函数·强）：任务自身 notes 含完成语（完成/已落地/已交付/已合并…）+ 引用 PR 号。
 *     命中 status-lag（90a92c=IN_PROGRESS+6 批次完成 note；6ae4d7=PARTIAL+closeout note）。
 *  2. code-churn 信号（git·弱·--churn 开）：任务的 code 域文件自 create 后被 N+ 次已合并提交改动，
 *     疑被「旁路工作」覆盖（b246 的 kpi.ts 被立方体 PR 改；b330 的 features 被 #641-643 改）。低置信，需人核。
 *
 * 用法：
 *   bun run loop:stale-scan            # note 信号扫描（快）
 *   bun run loop:stale-scan --churn    # 叠加 git churn 信号（慢，逐任务 git log）
 *   bun run loop:stale-scan --json     # 机读
 *
 * 纯函数（scanNotes / classifyStale / scanStale）单独导出供单测，不碰文件系统/git；CLI main 仅做 I/O。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseLog, fold } from '../backlog/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'BACKLOG_LOG.jsonl');

/** 视为「未完成、可推进」的状态——只有这些才可能「陈旧」（DONE/BLOCKED 不扫）。 */
export const SCANNABLE = new Set(['PROPOSED', 'TRIAGED', 'TODO', 'DOING', 'IN_PROGRESS', 'PARTIAL']);

/** 完成语标记（出现在 note 里强烈暗示「活已干完」）。 */
export const COMPLETION_MARKERS = ['已完成', '完成', '已落地', '已交付', '已合并', '已修复', '已上线', '已实现', '收口', 'DONE'];

/** churn 信号阈值：code 域文件被 ≥ 此数已合并提交改动 → 疑被旁路覆盖。 */
export const CHURN_THRESHOLD = 5;

/** 从文本提取完成标记命中 + 引用的 PR/issue 号（去重）。纯函数。 */
export function scanNotes(text) {
  const s = String(text || '');
  const markers = COMPLETION_MARKERS.filter((m) => s.includes(m));
  const prRefs = [...new Set([...s.matchAll(/#(\d{2,5})\b/g)].map((m) => Number(m[1])))];
  return { completionHits: markers.length, markers, prRefs };
}

/**
 * 判定单个任务是否疑似陈旧。纯函数（churnCount 由调用方算好传入，便于单测）。
 * @returns {object|null} null=不疑似 / 对象=疑似（含 confidence high|medium|low + reasons）
 */
export function classifyStale(task, noteText, churnCount = 0) {
  const status = task.status || 'PROPOSED';
  if (!SCANNABLE.has(status)) return null; // DONE / BLOCKED / 未知 → 不扫

  const { completionHits, markers, prRefs } = scanNotes(noteText);
  const inProgress = status === 'PARTIAL' || status === 'IN_PROGRESS' || status === 'DOING';
  // 已在推进态：1 条完成语即足；纯 PROPOSED：需 ≥2 条完成语才算 note 信号（更保守）。
  const noteSignal = (inProgress && completionHits >= 1) || completionHits >= 2;
  const churnSignal = churnCount >= CHURN_THRESHOLD;
  if (!noteSignal && !churnSignal) return null;

  let confidence = 'low';
  if (noteSignal && prRefs.length) confidence = 'high';
  else if (noteSignal) confidence = 'medium';

  const reasons = [];
  if (noteSignal) reasons.push(`notes 含完成语(${markers.join('/')})` + (prRefs.length ? ` + 引用 ${prRefs.map((n) => '#' + n).join(',')}` : ''));
  if (churnSignal) reasons.push(`code 域近 ${churnCount} 次已合并提交改动（疑被旁路工作覆盖，需人核）`);

  return {
    uid: task.uid,
    status,
    priority: task.priority || 'P?',
    confidence,
    completionHits,
    prRefs,
    churnCount,
    reasons,
    desc: String(task.desc || '').slice(0, 90),
  };
}

/**
 * 扫描全部任务。纯函数：notesByUid（Map<uid,string>）与 churnByUid（Map<uid,number>）由调用方备好。
 * @returns {Array<object>} 疑似陈旧清单，按 confidence(high>medium>low) 再按 churn 降序。
 */
export function scanStale(tasks, notesByUid, churnByUid = new Map()) {
  const rank = { high: 0, medium: 1, low: 2 };
  const out = [];
  for (const t of tasks) {
    const hit = classifyStale(t, notesByUid.get(t.uid) || '', churnByUid.get(t.uid) || 0);
    if (hit) out.push(hit);
  }
  return out.sort((a, b) => (rank[a.confidence] - rank[b.confidence]) || (b.churnCount - a.churnCount) || (a.uid < b.uid ? -1 : 1));
}

/** 把日志行折叠成任务态（委托权威 fold）+ 按 uid 聚合 note 文本。 */
export function loadTasksAndNotes(lines) {
  const events = parseLog(lines.join('\n'));
  const tasks = [...fold(events).values()];
  const notesByUid = new Map();
  for (const e of events) {
    if (e.kind === 'note' && e.uid) {
      notesByUid.set(e.uid, (notesByUid.get(e.uid) || '') + '\n' + String(e.text || ''));
    }
  }
  return { tasks, notesByUid };
}

/** 算单任务的 code 域 churn（best-effort：自 create 后 origin/main 上改动其 code 文件的提交数）。仅 main 用。 */
function churnFor(task) {
  const since = task.at || task.ts;
  if (!since) return 0;
  const files = String(task.code || '')
    .split(/[,\s；;]+/)
    .map((c) => c.replace(/[`*]/g, '').replace(/<br\s*\/?>/gi, '').replace(/:\d+(?:[-:]\d+)*$/, '').trim())
    .filter((f) => f && f.includes('/'));
  let count = 0;
  for (const f of files) {
    try {
      const out = execSync(`git -C "${ROOT}" log origin/main --since="${since}" --oneline -- "${f}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      count += out.split('\n').filter(Boolean).length;
    } catch { /* 文件不存在/路径异常 → 忽略 */ }
  }
  return count;
}

function render(hits) {
  const L = [];
  L.push('# Loop 陈旧任务扫描（stale-scan）');
  L.push('');
  const byConf = (c) => hits.filter((h) => h.confidence === c);
  L.push(`- 疑似陈旧 **${hits.length}** 项：高置信 ${byConf('high').length} · 中 ${byConf('medium').length} · 低 ${byConf('low').length}`);
  L.push('- ⚠️ 仅提示，**不自动改状态**——逐项人工核实后用 `bun scripts/backlog.mjs status <uid> DONE` 流转。');
  L.push('');
  for (const c of ['high', 'medium', 'low']) {
    const g = byConf(c);
    if (!g.length) continue;
    L.push(`## ${c === 'high' ? '🔴 高置信（notes 明示完成 + 引用 PR）' : c === 'medium' ? '🟡 中置信（notes 含完成语）' : '🔵 低置信（code 域被旁路改动）'}`);
    for (const h of g) {
      L.push(`- \`${h.uid}\` [${h.priority}/${h.status}] — ${h.desc}`);
      for (const r of h.reasons) L.push(`    ↳ ${r}`);
    }
    L.push('');
  }
  if (!hits.length) L.push('（无疑似陈旧任务 🎉）');
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
  const { tasks, notesByUid } = loadTasksAndNotes(lines);

  const churnByUid = new Map();
  if (args.includes('--churn')) {
    for (const t of tasks) {
      if (!SCANNABLE.has(t.status || 'PROPOSED')) continue;
      churnByUid.set(t.uid, churnFor(t));
    }
  }

  const hits = scanStale(tasks, notesByUid, churnByUid);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(hits, null, 2) + '\n');
    return;
  }
  console.log(render(hits));
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时 import.meta.url 百分号编码，直接拼会失配）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
