#!/usr/bin/env node
/**
 * Loop v2 陈旧任务扫描器（stale-scan）—— 找出「实际已完成/被取代但 backlog 状态未流转」的假阳性。
 *
 * 动机：2026-06-21 并行波接触的前沿任务里 6ae4d7 / 90a92c / b246 / b330 共 4 个都是陈旧状态
 * （工作已在别的 PR 落地，status 没维护）→ dispatch 持续假阳性、险些重做已上线代码。本扫描器
 * 把「逐任务现实核查」机制化，输出疑似已完成清单供人工逐个确认（不自动改状态——状态流转需人定夺）。
 *
 * 三类信号：
 *  1. PR-合并信号（gh·最强·默认开）：任务的实现 PR 已 MERGED（head 分支含任务 uid 末段标识）→ 工作已落地、
 *     应置 DONE。补「note 仅说『PR #N 待合并』、合并后没人回填 DONE」的盲区（实证 7a2849：#640 已合一周
 *     仍在前沿被重复派单；b299/b261 合并后滞留 IN_PROGRESS）。一次 `gh pr list --state merged` 批量取，
 *     网络/gh 不可用（环境不可抗力）则降级跳过、不崩。
 *  2. note-完成信号（纯函数·强）：任务自身 notes 含完成语（完成/已落地/已交付/已合并…）+ 引用 PR 号。
 *     命中 status-lag（90a92c=IN_PROGRESS+6 批次完成 note；6ae4d7=PARTIAL+closeout note）。
 *  3. code-churn 信号（git·弱·--churn 开）：任务的 code 域文件自 create 后被 N+ 次已合并提交改动，
 *     疑被「旁路工作」覆盖（b246 的 kpi.ts 被立方体 PR 改；b330 的 features 被 #641-643 改）。低置信，需人核。
 *
 * 用法：
 *   bun run loop:stale-scan            # PR-合并信号(gh) + note 信号扫描（默认）
 *   bun run loop:stale-scan --no-pr    # 跳过 PR-合并信号（离线 / 无 gh 时）
 *   bun run loop:stale-scan --churn    # 叠加 git churn 信号（慢，逐任务 git log）
 *   bun run loop:stale-scan --json     # 机读
 *
 * 纯函数（scanNotes / classifyStale / scanStale）单独导出供单测，不碰文件系统/git；CLI main 仅做 I/O。
 */
import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fold, loadLog } from '../backlog/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'BACKLOG_LOG.jsonl');
const EVENTS_DIR = path.join(ROOT, 'backlog-events');

/** 视为「未完成、可推进」的状态——只有这些才可能「陈旧」（DONE/BLOCKED 不扫）。 */
export const SCANNABLE = new Set(['PROPOSED', 'TRIAGED', 'TODO', 'DOING', 'IN_PROGRESS', 'PARTIAL']);

/** 完成语标记（出现在 note 里强烈暗示「活已干完」）。 */
export const COMPLETION_MARKERS = ['已完成', '完成', '已落地', '已交付', '已合并', '已修复', '已上线', '已实现', '收口', 'DONE'];

/** churn 信号阈值：code 域文件被 ≥ 此数已合并提交改动 → 疑被旁路覆盖。 */
export const CHURN_THRESHOLD = 5;

/** 从文本提取完成标记命中 + 引用的 PR/issue 号（去重）。纯函数。 */
export function scanNotes(text) {
  const s = String(text || '');
  // 否定语境剥离：「未完成/尚未完成/没有完成/不算完成」是未完成声明，不是完成信号。
  // 否定词与「完成」间允许 0-3 字插入语（「未能完成/没有办法完成」）；「完成度」是名词化用法
  // （「完成度不高」）先行剥离——两类均为 code review P2 实测误判反例
  let work = s
    .replace(/完成度/g, '')
    .replace(/(?:尚未|未|没有|没|不算)[^，。；、\s]{0,3}完成/g, '');
  // 最长优先 + 命中即剔除：防子串重叠虚增证据（「已完成」一处出现若同时计入「已完成」「完成」
  // 两条，会把 PROPOSED 的「≥2 条独立完成语」门槛架空成一处提及即过）
  const markers = [];
  for (const m of [...COMPLETION_MARKERS].sort((a, b) => b.length - a.length)) {
    if (work.includes(m)) { markers.push(m); work = work.split(m).join(''); }
  }
  const prRefs = [...new Set([...s.matchAll(/#(\d{2,5})\b/g)].map((m) => Number(m[1])))];
  return { completionHits: markers.length, markers, prRefs };
}

/**
 * 判定单个任务是否疑似陈旧。纯函数（churnCount / mergedPrRefs 由调用方算好传入，便于单测）。
 * @param {number[]} mergedPrRefs 该任务「实现 PR 已 MERGED」的 PR 号清单（CLI 经 gh 核实，head 分支含任务标识）。
 * @returns {object|null} null=不疑似 / 对象=疑似（含 confidence high|medium|low + reasons）
 */
export function classifyStale(task, noteText, churnCount = 0, mergedPrRefs = []) {
  const status = task.status || 'PROPOSED';
  if (!SCANNABLE.has(status)) return null; // DONE / BLOCKED / 未知 → 不扫

  const { completionHits, markers, prRefs } = scanNotes(noteText);
  const inProgress = status === 'PARTIAL' || status === 'IN_PROGRESS' || status === 'DOING';
  // 已在推进态：1 条完成语即足；纯 PROPOSED：需 ≥2 条完成语才算 note 信号（更保守）。
  const noteSignal = (inProgress && completionHits >= 1) || completionHits >= 2;
  const churnSignal = churnCount >= CHURN_THRESHOLD;
  const prMergedSignal = mergedPrRefs.length > 0; // 实现 PR 已合 = 最强陈旧信号（工作已落地）
  if (!noteSignal && !churnSignal && !prMergedSignal) return null;

  // PR 已合 → 最高置信；note+引用 PR 亦高；仅 note 中；仅 churn 低。
  let confidence = 'low';
  if (prMergedSignal || (noteSignal && prRefs.length)) confidence = 'high';
  else if (noteSignal) confidence = 'medium';

  const reasons = [];
  if (prMergedSignal) reasons.push(`实现 PR ${mergedPrRefs.map((n) => '#' + n).join(',')} 已 MERGED（head 分支含任务标识）→ 工作已落地，应置 DONE`);
  if (noteSignal) reasons.push(`notes 含完成语(${markers.join('/')})` + (prRefs.length ? ` + 引用 ${prRefs.map((n) => '#' + n).join(',')}` : ''));
  if (churnSignal) reasons.push(`code 域近 ${churnCount} 次已合并提交改动（疑被旁路工作覆盖，需人核）`);

  return {
    uid: task.uid,
    status,
    priority: task.priority || 'P?',
    confidence,
    completionHits,
    prRefs,
    mergedPrRefs,
    churnCount,
    reasons,
    desc: String(task.desc || '').slice(0, 90),
  };
}

/**
 * 扫描全部任务。纯函数：notesByUid / churnByUid / mergedPrsByUid（均 Map<uid,...>）由调用方备好。
 * @returns {Array<object>} 疑似陈旧清单，按 confidence(high>medium>low) 再按 churn 降序。
 */
export function scanStale(tasks, notesByUid, churnByUid = new Map(), mergedPrsByUid = new Map()) {
  const rank = { high: 0, medium: 1, low: 2 };
  const out = [];
  for (const t of tasks) {
    const hit = classifyStale(t, notesByUid.get(t.uid) || '', churnByUid.get(t.uid) || 0, mergedPrsByUid.get(t.uid) || []);
    if (hit) out.push(hit);
  }
  return out.sort((a, b) => (rank[a.confidence] - rank[b.confidence]) || (b.churnCount - a.churnCount) || (a.uid < b.uid ? -1 : 1));
}

/** 把事件折叠成任务态（委托权威 fold）+ 按 uid 聚合 note 文本。 */
export function loadTasksAndNotesFromEvents(events) {
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
    .split(/[,，\s;；、]+/)
    .map((c) => c.replace(/[`*]/g, '').replace(/<br\s*\/?>/gi, '').replace(/:\d+(?:[-:]\d+)*$/, '').trim())
    .filter((f) => f && f.includes('/'));
  let count = 0;
  for (const f of files) {
    try {
      // execFileSync 数组参数（不经 shell）：since/f 来自 backlog 自由文本（task.at/task.code），
      // 字符串拼接经 /bin/sh 可被 `"$()` 等元字符注入——本仓 spawn 参数引号安全闸同款要求
      const out = execFileSync('git', ['-C', ROOT, 'log', 'origin/main', `--since=${since}`, '--oneline', '--', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
      count += out.split('\n').filter(Boolean).length;
    } catch { /* 文件不存在/路径异常 → 忽略 */ }
  }
  return count;
}

/** 任务 uid 的末段标识（如 2026-05-30-user-b299 → b299；非 loop 分支 claude/fix-...-7a2849 也含之）。<4 字符太易误配 → 弃用。纯函数。 */
export function uidToken(uid) {
  const t = String(uid || '').split('-').pop() || '';
  return t.length >= 4 ? t : '';
}

/** 分支名是否以分隔符边界包含任务 uid 末段标识（边界匹配避免子串误配，如 b332 误命中无关分支）。纯函数。 */
export function branchMatchesUid(headRefName, uid) {
  const token = uidToken(uid);
  if (!token) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[/_-])${esc}($|[/_-])`).test(String(headRefName || ''));
}

/** best-effort：一次 gh 查近期已合 PR 的 head 分支，按任务 uidToken 匹配出「实现 PR 已合」清单。
 *  网络/gh 不可用（环境不可抗力）→ 返回空 Map 优雅降级，不抛错、不阻断扫描。仅 SCANNABLE 任务参与匹配。 */
function loadMergedPrsByUid(tasks) {
  const byUid = new Map();
  let merged = [];
  try {
    const out = execSync('gh pr list --state merged --limit 400 --json number,headRefName', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    merged = JSON.parse(out);
  } catch {
    return byUid; // 离线 / 无 gh / 限流 → 降级跳过 PR 信号
  }
  for (const t of tasks) {
    if (!SCANNABLE.has(t.status || 'PROPOSED')) continue;
    const nums = merged.filter((p) => branchMatchesUid(p.headRefName, t.uid)).map((p) => p.number);
    if (nums.length) byUid.set(t.uid, [...new Set(nums)]);
  }
  return byUid;
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
    L.push(`## ${c === 'high' ? '🔴 高置信（实现 PR 已合 或 notes 明示完成+引用 PR）' : c === 'medium' ? '🟡 中置信（notes 含完成语）' : '🔵 低置信（code 域被旁路改动）'}`);
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
  // 两源合并：冻结 jsonl（存量）+ backlog-events/ 目录（增量，每事件一文件）
  const { tasks, notesByUid } = loadTasksAndNotesFromEvents(loadLog(LOG_PATH, EVENTS_DIR));

  // PR-合并信号（默认开，--no-pr 关）：一次 gh 取近期已合 PR，按 uidToken 匹配实现分支。网络不可用自动降级。
  const mergedPrsByUid = args.includes('--no-pr') ? new Map() : loadMergedPrsByUid(tasks);

  const churnByUid = new Map();
  if (args.includes('--churn')) {
    for (const t of tasks) {
      if (!SCANNABLE.has(t.status || 'PROPOSED')) continue;
      churnByUid.set(t.uid, churnFor(t));
    }
  }

  const hits = scanStale(tasks, notesByUid, churnByUid, mergedPrsByUid);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(hits, null, 2) + '\n');
    return;
  }
  console.log(render(hits));
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时 import.meta.url 百分号编码，直接拼会失配）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
