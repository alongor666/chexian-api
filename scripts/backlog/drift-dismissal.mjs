#!/usr/bin/env bun
/**
 * check-merged-drift 的误报压制（dismissal）判定 —— 纯函数层
 *
 * 病：漂移检测是启发式（引用 uid 短后缀 + 改非账本文件 + 命中 code 路径），命中的提交
 *   可能只是「记账/引用」了事项（squash 信息提及 uid、PR 正文声明"分离为后续项"），
 *   并未实现。2026-07-06 逐条权威核实：当轮全部 6 条命中均属此类误报，且事项 note 里
 *   已登记「系误报」后复跑仍原样再报——无压制通道（先例：b714a7 早有"命中 PR #874
 *   系误报" note，每轮仍被报）。
 *
 * 治：把「系误报」note 变成机器可读的压制声明，**精确到 (uid, 提交) 对**：
 *   - 压制声明 = 该任务的 note 中含标记「系误报」、且点名了具体提交短 SHA（≥7 位
 *     十六进制）或 PR 号（`#123` / `PR #123`）的条目。
 *   - 单条候选提交被压制，当且仅当任一压制声明点名了它的 SHA（前缀互含）**或**它
 *     subject 中出现的 PR 号（squash 惯例 `(#882)`）。
 *   - 同 uid 出现**新的不同实现提交**（SHA、PR 号均未被点名）仍照常上报——压制不是
 *     按 uid 整体静音，是按 (uid, 提交) 逐对豁免。
 *
 * 精度取舍：SHA 至少 7 位十六进制——6 位会撞现代 uid 短后缀（如 03f6f0），note 里
 *   提及 uid 不应被误读为提交。仅含「系误报」但未点名任何 SHA/PR 的 note 不构成
 *   压制声明（宁可再报一轮，不做 uid 级全量静音）。
 */

const DISMISS_MARKER = '系误报';
// ≥7 位十六进制才认作提交 SHA（6 位是 uid 短后缀的长度，禁止混淆）
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;
const PR_RE = /#(\d+)\b/g;

/**
 * 从任务 notes 提取误报压制声明。
 * 仅「含标记且点名了至少一个 SHA/PR 号」的 note 生效。
 * @param {string[]} notes 折叠后任务的 notes（时序）
 * @returns {{shas: string[], prs: string[], text: string}[]}
 */
export function extractDismissals(notes = []) {
  const out = [];
  for (const text of notes) {
    if (typeof text !== 'string' || !text.includes(DISMISS_MARKER)) continue;
    const shas = (text.match(SHA_RE) || []).map(s => s.toLowerCase());
    const prs = [...text.matchAll(PR_RE)].map(m => m[1]);
    if (shas.length > 0 || prs.length > 0) out.push({ shas, prs, text });
  }
  return out;
}

/** 提交 subject 中出现的 PR 号（squash 合并惯例 "... (#882)"） */
function subjectPrNumbers(subject) {
  return [...String(subject || '').matchAll(PR_RE)].map(m => m[1]);
}

/**
 * 单条候选提交是否被压制：任一压制声明点名了它的 SHA（前缀互含，兼容 note 里写
 * 短 SHA 而检测器持全 SHA、或反之）或其 subject 中的 PR 号。
 * @param {{hash: string, subject: string}} commit
 * @param {{shas: string[], prs: string[]}[]} dismissals extractDismissals 的产出
 */
export function isDismissed(commit, dismissals) {
  const hash = String(commit.hash || '').toLowerCase();
  if (!hash) return false;
  const commitPrs = subjectPrNumbers(commit.subject);
  return dismissals.some(d =>
    d.shas.some(s => hash.startsWith(s) || s.startsWith(hash)) ||
    d.prs.some(p => commitPrs.includes(p))
  );
}

/**
 * 把候选提交按压制声明切成 { kept, dismissed }。
 * kept 中的提交（含同 uid 新出现的不同实现提交）仍会被上报。
 * @param {{hash: string, subject: string}[]} commits
 * @param {string[]} notes
 */
export function partitionByDismissal(commits, notes) {
  const dismissals = extractDismissals(notes);
  const kept = [];
  const dismissed = [];
  for (const c of commits) {
    (isDismissed(c, dismissals) ? dismissed : kept).push(c);
  }
  return { kept, dismissed };
}
