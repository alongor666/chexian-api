#!/usr/bin/env node
/**
 * Loop v2 质量账本聚合（quality-report）。
 *
 * 读 .claude/workflow/loop-quality-ledger.jsonl（append-only，merge=union），
 * 每行=一个任务收尾的结构化质量指标，聚合出北极星 + 趋势。
 *
 * 行 schema（见 .claude/rules/loop-orchestration.md §3）：
 *   {uid, round, ts, task, domain:[..], rounds_to_green, rework_count,
 *    codex_plan:{P0,P1,P2}, codex_done:{P0,P1,P2}, verifier_refuted,
 *    byte_safety_proof: "golden-baseline|by-construction|n/a",
 *    tests_added, governance_pass, pr, verdict: "pass|partial|reverted"}
 *
 * 用法：bun run loop:quality [--json]
 *
 * 纯函数 aggregate 导出供单测。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LEDGER_PATH = path.join(ROOT, '.claude/workflow/loop-quality-ledger.jsonl');

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

/** 聚合质量指标。返回北极星 + 按域 + 按 round 趋势。 */
export function aggregate(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0 };
  const firstPass = rows.filter((r) => Number(r.rounds_to_green) === 1 && Number(r.rework_count || 0) === 0).length;
  const govPass = rows.filter((r) => r.governance_pass === true).length;
  const codexPlan = sum(rows, (r) => findings(r.codex_plan));
  const codexDone = sum(rows, (r) => findings(r.codex_done));
  const verifierRefuted = sum(rows, (r) => Number(r.verifier_refuted) || 0);
  const reverted = rows.filter((r) => r.verdict === 'reverted').length;

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
    avg_rounds_to_green: +(sum(rows, (r) => Number(r.rounds_to_green) || 0) / n).toFixed(2),
    avg_rework: +(sum(rows, (r) => Number(r.rework_count) || 0) / n).toFixed(2),
    governance_pass_rate: +(govPass / n).toFixed(3),
    codex_findings_total: codexPlan + codexDone,
    codex_plan_findings: codexPlan,
    codex_done_findings: codexDone,
    verifier_refuted_total: verifierRefuted,
    reverted_count: reverted,
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
  L.push(`- 平均转绿轮次 ${agg.avg_rounds_to_green} · 平均返工 ${agg.avg_rework}`);
  L.push(`- governance 通过率 ${(agg.governance_pass_rate * 100).toFixed(1)}% · 回滚 ${agg.reverted_count}`);
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
