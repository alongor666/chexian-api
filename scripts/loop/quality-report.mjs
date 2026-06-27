#!/usr/bin/env node
/**
 * Loop v2 质量账本聚合（quality-report）。
 *
 * 读 .claude/workflow/loop-quality-ledger.jsonl（append-only，merge=union），
 * 每行=一个任务收尾的结构化质量指标，聚合出北极星 + 趋势。
 *
 * 行 schema（见 .claude/rules/loop-orchestration.md §3）：
 *   完成行 {uid, round, ts, task, domain:[..], rounds_to_green, rework_count,
 *    codex_plan:{P0,P1,P2}, codex_done:{P0,P1,P2}, verifier_refuted,
 *    byte_safety_proof: "golden-baseline|by-construction|n/a",
 *    tests_added, governance_pass, pr, verdict: "pass|partial|reverted"}
 *   失败行（E1·dispatch 自动记账）{uid, ts, task, domain, verdict:"orphaned|blocked|abandoned",
 *    reason, claim_at?(orphaned 去重键), actor?}——无 rounds_to_green/governance_pass 等完成指标。
 *
 * E1 账本记失败（治幸存者偏差·2026-06-27）：verdict 归一（normalizeVerdict 单一事实源）后
 * 「非 pass 纳入分母」口径稳定；北极星不再只算幸存样本，新增放弃率/孤儿率/阻塞率。
 *
 * 用法：bun run loop:quality [--json]
 *
 * 纯函数 aggregate / normalizeVerdict 导出供单测与 dispatch 复用。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// 路径 env 可覆盖（默认真实账本；供 e2e / dispatch 失败记账 oracle 用 temp 路径隔离，与 dispatch.mjs 一致）。
const LEDGER_PATH = process.env.LOOP_LEDGER_PATH || path.join(ROOT, '.claude/workflow/loop-quality-ledger.jsonl');

export function parseLedger(lines) {
  const rows = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
  }
  return rows;
}

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const findings = (o) => (o ? (Number(o.P0) || 0) + (Number(o.P1) || 0) + (Number(o.P2) || 0) : 0);

/** 历史成功同义词（顶层极少；防御性归一为 pass，免未来顶层使用被误判非 pass）。 */
const SUCCESS_SYNONYMS = new Set(['all_fixed', 'mergeable']);
/** 「到达记账点的完成态」规范 verdict（accounted 守卫 / avg 只算完成行据此）。 */
export const COMPLETION_VERDICTS = new Set(['pass', 'partial', 'reverted']);

/**
 * verdict 归一（**单一事实源**，dispatch.failureLedgerRows 复用本函数避免分叉·codex 闸-1 P2-4）。
 * 把既有历史 pass-* 变体（实测 5 种顶层：pass-after-fix / pass-pending-user-merge / pass-after-gate2-fix /
 * pass-with-documented-residual / pass-scoped）+ 成功同义词（all_fixed/mergeable）归一到规范 `pass` + 子标记；
 * 非 pass 规范终态（partial/reverted/abandoned/orphaned/blocked）原样透传；未知值小写保留（不臆造）；
 * 空/缺失 → unknown。「非 pass 纳入分母」口径据归一后判定才稳（codex #812 P2）。
 * @param {string} raw 原始 verdict
 * @returns {{verdict:string, qualifier:(string|null)}}
 */
export function normalizeVerdict(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v) return { verdict: 'unknown', qualifier: null };
  if (v === 'pass') return { verdict: 'pass', qualifier: null };
  if (v.startsWith('pass-') || v.startsWith('pass_')) return { verdict: 'pass', qualifier: v.slice(5) };
  if (SUCCESS_SYNONYMS.has(v)) return { verdict: 'pass', qualifier: v };
  return { verdict: v, qualifier: null };
}

/** ledger 行的规范 uid（吸收 uid/backlog_uid schema 漂移·codex 闸-1 P1-6）。 */
export function ledgerUid(row) {
  return (row && (row.uid || row.backlog_uid)) || null;
}

/**
 * 读时去重失败行（codex 闸-1 P1-1 并发安全）：并发 dispatch / git merge=union 可能让同一陈旧认领
 * 产生重复 orphaned/blocked 行；这里按 orphaned (uid,claim_at)、blocked uid 各只保留首条，使分母与
 * 放弃率/孤儿率不被重复行污染（写时去重只保串行常态，读时去重才是并发下的真保证）。完成行/未知行全保留
 * （每行=一次真实尝试，不去重）。
 */
function dedupeFailureRows(rawRows) {
  const out = [];
  const seenOrphan = new Set();
  const seenBlocked = new Set();
  for (const r of (rawRows || [])) {
    const v = normalizeVerdict(r && r.verdict).verdict;
    const uid = ledgerUid(r);
    // 仅 uid 存在才去重（codex 闸-2 P2）：缺 uid 的坏 schema 失败行**保留**（落 breakdown 可见），
    // 不归并到 `null@@…` 键——否则多条坏行被悄悄合并、隐藏账本污染。
    if (v === 'orphaned' && uid != null) {
      const key = `${uid}@@${(r && r.claim_at) || ''}`;
      if (seenOrphan.has(key)) continue;
      seenOrphan.add(key);
    } else if (v === 'blocked' && uid != null) {
      if (seenBlocked.has(uid)) continue;
      seenBlocked.add(uid);
    }
    out.push(r);
  }
  return out;
}

/** 聚合质量指标。返回北极星 + 失败记账（放弃率/孤儿率/阻塞率）+ 按域 + 按 round 趋势。 */
export function aggregate(rawRows) {
  // 读时去重失败行（codex 闸-1 P1-1）：并发/union 重复的 orphaned/blocked 只计一次，分母不被污染。
  const rows = dedupeFailureRows(rawRows);
  const n = rows.length;
  if (n === 0) return { n: 0 };

  const nv = (r) => normalizeVerdict(r.verdict).verdict;
  // 一次过 = 归一后 pass（partial/reverted/orphaned/blocked 即便 rtg=1 也不算）+ 首轮转绿 + 零返工。
  // 加 verdict==='pass' 谓词修正旧口径把 partial(rtg=1/rework=0) 误计一次过（codex #812 P2）。
  const firstPass = rows.filter((r) => nv(r) === 'pass' && Number(r.rounds_to_green) === 1 && Number(r.rework_count || 0) === 0).length;
  const govPass = rows.filter((r) => r.governance_pass === true).length;
  const codexPlan = sum(rows, (r) => findings(r.codex_plan));
  const codexDone = sum(rows, (r) => findings(r.codex_done));
  const verifierRefuted = sum(rows, (r) => Number(r.verifier_refuted) || 0);

  // verdict 分布（归一后）：规范六类 + other（未知/缺失不在分布里消失·codex 闸-1 P2-3）。
  const breakdown = { pass: 0, partial: 0, reverted: 0, abandoned: 0, orphaned: 0, blocked: 0, other: 0 };
  for (const r of rows) {
    const v = nv(r);
    if (Object.prototype.hasOwnProperty.call(breakdown, v) && v !== 'other') breakdown[v] += 1;
    else breakdown.other += 1;
  }

  // avg 转绿/返工只算「有完成指标」的行（缺失≠0·codex 闸-1 P2-5）：失败行无 rtg → 不拉低均值。
  const withRtg = rows.filter((r) => r.rounds_to_green != null && Number.isFinite(Number(r.rounds_to_green)));
  const withRework = rows.filter((r) => r.rework_count != null && Number.isFinite(Number(r.rework_count)));
  const avg = (arr, f) => (arr.length ? +(sum(arr, f) / arr.length).toFixed(2) : 0);

  // 按域
  const byDomain = {};
  for (const r of rows) {
    for (const d of (r.domain || ['(无域)'])) {
      byDomain[d] = byDomain[d] || { n: 0, codex: 0 };
      byDomain[d].n += 1;
      byDomain[d].codex += findings(r.codex_plan) + findings(r.codex_done);
    }
  }
  // 按 round（趋势）
  const byRound = {};
  for (const r of rows) {
    const k = r.round || '(无)';
    byRound[k] = byRound[k] || { n: 0, rtg: 0, rework: 0 };
    byRound[k].n += 1;
    byRound[k].rtg += Number(r.rounds_to_green) || 0;
    byRound[k].rework += Number(r.rework_count) || 0;
  }

  return {
    n,
    first_pass_rate: +(firstPass / n).toFixed(3),
    avg_rounds_to_green: avg(withRtg, (r) => Number(r.rounds_to_green)),
    avg_rework: avg(withRework, (r) => Number(r.rework_count)),
    governance_pass_rate: +(govPass / n).toFixed(3),
    codex_findings_total: codexPlan + codexDone,
    codex_plan_findings: codexPlan,
    codex_done_findings: codexDone,
    verifier_refuted_total: verifierRefuted,
    reverted_count: breakdown.reverted,
    // E1 失败记账：放弃率=（abandoned+orphaned）/n（blocked 不混入·codex 闸-1 P2-2，单列阻塞率）。
    abandonment_rate: +((breakdown.abandoned + breakdown.orphaned) / n).toFixed(3),
    orphan_rate: +(breakdown.orphaned / n).toFixed(3),
    blocked_rate: +(breakdown.blocked / n).toFixed(3),
    verdict_breakdown: breakdown,
    tests_added_total: sum(rows, (r) => Number(r.tests_added) || 0),
    byDomain,
    byRound,
  };
}

function render(agg) {
  if (!agg.n) return 'Loop 质量账本为空（.claude/workflow/loop-quality-ledger.jsonl 无数据行）。';
  const L = [];
  L.push('# Loop 质量报告（quality-report）');
  L.push('');
  L.push(`- 任务样本 ${agg.n}`);
  L.push(`- 🌟 **一次过率** ${(agg.first_pass_rate * 100).toFixed(1)}%（rounds_to_green=1 且 零返工）`);
  L.push(`- 平均转绿轮次 ${agg.avg_rounds_to_green} · 平均返工 ${agg.avg_rework}（均只算有完成指标的行）`);
  L.push(`- 🛑 **放弃率** ${(agg.abandonment_rate * 100).toFixed(1)}%（abandoned+orphaned）· 孤儿率 ${(agg.orphan_rate * 100).toFixed(1)}% · 阻塞率 ${(agg.blocked_rate * 100).toFixed(1)}%`);
  const b = agg.verdict_breakdown || {};
  L.push(`- verdict 分布：pass ${b.pass || 0} · partial ${b.partial || 0} · reverted ${b.reverted || 0} · abandoned ${b.abandoned || 0} · orphaned ${b.orphaned || 0} · blocked ${b.blocked || 0}${b.other ? ` · other ${b.other}` : ''}`);
  L.push(`- governance 通过率 ${(agg.governance_pass_rate * 100).toFixed(1)}%（占全部尝试，失败行计未过）· 回滚 ${agg.reverted_count}`);
  L.push(`- 对抗命中：codex 计划 ${agg.codex_plan_findings} + 完成 ${agg.codex_done_findings} = ${agg.codex_findings_total}；verifier 证伪 ${agg.verifier_refuted_total}`);
  L.push(`- 新增测试合计 ${agg.tests_added_total}`);
  L.push('');
  L.push('## 按域');
  for (const [d, v] of Object.entries(agg.byDomain).sort((a, b) => b[1].n - a[1].n)) {
    L.push(`- ${d}: ${v.n} 任务 · 对抗命中 ${v.codex}`);
  }
  L.push('');
  L.push('## 按 round 趋势（平均转绿轮次 / 返工）');
  for (const [k, v] of Object.entries(agg.byRound)) {
    L.push(`- ${k}: n=${v.n} · 转绿 ${(v.rtg / v.n).toFixed(2)} · 返工 ${(v.rework / v.n).toFixed(2)}`);
  }
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let lines = [];
  try { lines = fs.readFileSync(LEDGER_PATH, 'utf-8').split('\n'); } catch { /* 文件不存在=空账本 */ }
  const agg = aggregate(parseLedger(lines));
  if (args.includes('--json')) { process.stdout.write(JSON.stringify(agg, null, 2) + '\n'); return; }
  console.log(render(agg));
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时直接拼 file://${argv[1]} 会失配）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
