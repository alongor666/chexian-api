/**
 * ETL 全链路台账分析器 — 每次发布的环节耗时 / 断点 / 跨次趋势。
 *
 * 数据源：数据管理/ledger/etl-ledger.jsonl（recordEvent 写入，append-only）。
 * 依赖事件：
 *   - stage='run'      step='start'|'end'     run 级起止（trigger=watcher|ai|manual，end 带 duration_ms/终态/断点 note）
 *   - stage='pipeline' step=<环节 label>       每环节耗时与终态（sync-and-reload runCmd 统一打点，成功+失败都记）
 *   - 其余 stage（etl/validate/vps_sync/health/frontend）为域级明细事件，时间线视图一并展示
 *
 * 用法：
 *   node scripts/etl-ledger/analyze.mjs                 # 最近 14 天：逐 run 概览 + 环节耗时汇总
 *   node scripts/etl-ledger/analyze.mjs --days 30       # 放宽窗口
 *   node scripts/etl-ledger/analyze.mjs --run 20260711-081243   # 单次 run 的完整时间线
 *
 * 设计原则（2026-07-11 用户要求）：每一次跑（自动 watcher / AI 驱动 / 人工）都必须留痕，
 * 耗时与断点数据是后续「砍不必要环节 / 单点优化 / 全局优化」决策的输入——没有度量就没有优化。
 */
import { readFileSync, existsSync } from 'node:fs';
import { LEDGER_PATH } from './record.mjs';

function parseArgs(argv) {
  const opts = { days: 14, run: null, ledgerPath: LEDGER_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') opts.days = parseInt(argv[++i], 10) || 14;
    else if (a === '--run') opts.run = argv[++i];
    else if (a === '--ledger') opts.ledgerPath = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/etl-ledger/analyze.mjs [--days N] [--run <run_id>] [--ledger <路径>]');
      process.exit(0);
    }
  }
  return opts;
}

/** 读台账并按 run_id 分组（坏行跳过不中断） */
export function loadRuns(ledgerPath, { sinceMs = 0 } = {}) {
  if (!existsSync(ledgerPath)) return new Map();
  const runs = new Map(); // run_id → events[]
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = Date.parse(ev.ts);
    if (Number.isFinite(sinceMs) && sinceMs > 0 && (!Number.isFinite(t) || t < sinceMs)) continue;
    const id = ev.run_id || 'adhoc';
    if (!runs.has(id)) runs.set(id, []);
    runs.get(id).push(ev);
  }
  return runs;
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** 单 run 摘要：起止/时长/触发方式/终态/断点/各环节耗时 */
export function summarizeRun(runId, events) {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const start = sorted.find((e) => e.stage === 'run' && e.step === 'start');
  const end = sorted.find((e) => e.stage === 'run' && e.step === 'end');
  const steps = sorted.filter((e) => e.stage === 'pipeline');
  const failedSteps = sorted.filter((e) => e.status === 'failed');
  const firstTs = sorted[0]?.ts, lastTs = sorted[sorted.length - 1]?.ts;
  return {
    runId,
    firstTs, lastTs,
    trigger: end?.trigger ?? start?.trigger ?? '（旧数据未打点）',
    status: end ? end.status : (failedSteps.length ? 'failed' : '（无 run end 事件：旧数据或进程被杀）'),
    totalMs: end?.duration_ms ?? (firstTs && lastTs ? Date.parse(lastTs) - Date.parse(firstTs) : null),
    totalIsInferred: end?.duration_ms == null,
    breakpoint: end?.status === 'failed' ? (end.note ?? failedSteps[0]?.step ?? '未知') : null,
    steps: steps.map((e) => ({ step: e.step, status: e.status, ms: e.duration_ms ?? null, note: e.note, exit: e.exit_code })),
    eventCount: sorted.length,
    events: sorted,
  };
}

/** 跨 run 环节耗时聚合（仅 pipeline 事件） */
export function aggregateSteps(summaries) {
  const agg = new Map(); // step → { runs, fails, durations[] }
  for (const s of summaries) {
    for (const st of s.steps) {
      if (!agg.has(st.step)) agg.set(st.step, { runs: 0, fails: 0, durations: [] });
      const a = agg.get(st.step);
      a.runs++;
      if (st.status === 'failed') a.fails++;
      if (Number.isFinite(st.ms)) a.durations.push(st.ms);
    }
  }
  const rows = [];
  for (const [step, a] of agg.entries()) {
    const ds = a.durations.sort((x, y) => x - y);
    rows.push({
      step, runs: a.runs, fails: a.fails,
      p50: ds.length ? ds[Math.floor(ds.length / 2)] : null,
      max: ds.length ? ds[ds.length - 1] : null,
      sum: ds.reduce((x, y) => x + y, 0),
    });
  }
  return rows.sort((x, y) => y.sum - x.sum); // 按总耗时降序 = 优化优先级
}

function printRunTimeline(summary) {
  console.log(`\n═══ run ${summary.runId} 完整时间线（${summary.eventCount} 个事件）═══`);
  console.log(`触发方式: ${summary.trigger}  终态: ${summary.status}  总耗时: ${fmtMs(summary.totalMs)}${summary.totalIsInferred ? '【由首末事件推断】' : ''}`);
  if (summary.breakpoint) console.log(`断点: ${summary.breakpoint}`);
  let prevT = null;
  for (const e of summary.events) {
    const t = Date.parse(e.ts);
    const gap = prevT != null ? `（距上一事件 ${fmtMs(t - prevT)}）` : '';
    prevT = t;
    const dur = e.duration_ms != null ? ` 耗时=${fmtMs(e.duration_ms)}` : '';
    const mark = e.status === 'failed' ? '❌' : '·';
    console.log(`  ${mark} ${e.ts.slice(11, 19)} [${e.stage}] ${e.step}${e.domain ? ` (${e.domain})` : ''} ${e.status}${dur}${e.note ? ` | ${e.note}` : ''} ${gap}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sinceMs = opts.run ? 0 : Date.now() - opts.days * 86_400_000;
  const runs = loadRuns(opts.ledgerPath, { sinceMs });

  if (opts.run) {
    const events = runs.get(opts.run);
    if (!events) { console.error(`未找到 run ${opts.run}（检查 run_id 或放宽 --days）`); process.exit(1); }
    printRunTimeline(summarizeRun(opts.run, events));
    return;
  }

  const summaries = [...runs.entries()]
    .filter(([id]) => id !== 'adhoc')
    .map(([id, evs]) => summarizeRun(id, evs))
    .sort((a, b) => Date.parse(b.firstTs) - Date.parse(a.firstTs));

  console.log(`\n═══ 最近 ${opts.days} 天发布 run 概览（${summaries.length} 次，新→旧）═══`);
  console.log('run_id            | 触发     | 终态    | 总耗时  | 断点/备注');
  console.log('------------------|----------|---------|---------|----------');
  for (const s of summaries) {
    const status = s.status === 'success' ? '✅ 成功' : (s.status === 'failed' ? '❌ 失败' : s.status);
    console.log(`${s.runId.padEnd(17)} | ${String(s.trigger).padEnd(8)} | ${status} | ${fmtMs(s.totalMs).padStart(7)}${s.totalIsInferred ? '*' : ' '}| ${s.breakpoint ?? ''}`);
  }
  console.log('（* = 旧数据无 run end 打点，总耗时由首末事件时间推断，偏短）');

  const stepRows = aggregateSteps(summaries);
  if (stepRows.length) {
    console.log(`\n═══ 环节耗时汇总（按总耗时降序 = 优化优先级）═══`);
    console.log('环节                        | 次数 | 失败 | 中位耗时 | 最大耗时');
    console.log('----------------------------|------|------|----------|----------');
    for (const r of stepRows) {
      console.log(`${r.step.padEnd(27)} | ${String(r.runs).padStart(4)} | ${String(r.fails).padStart(4)} | ${fmtMs(r.p50).padStart(8)} | ${fmtMs(r.max).padStart(8)}`);
    }
  } else {
    console.log('\n（窗口内暂无 pipeline 环节耗时事件——打点自 2026-07-11 起生效，跑一次发布后再看）');
  }
  console.log('\n单次详情：node scripts/etl-ledger/analyze.mjs --run <run_id>');
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
