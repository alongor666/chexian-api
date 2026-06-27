/**
 * ETL 流转台账 — 报告生成器（JSONL → 中文 Markdown 三视角）。
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md §7
 * 派生视图禁手编：本文件全量重渲染 数据管理/ledger/数据流转台账.md。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STAGES = ['source', 'etl', 'validate', 'vps_sync', 'reload', 'health', 'frontend'];
const LIGHT = { success: '🟢', info: '🔵', warning: '🟡', failure: '🔴', skipped: '⚪' };

function groupBy(arr, keyFn) {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x);
    (m[k] ??= []).push(x);
  }
  return m;
}

/** '2026-06-27T10:00:00+08:00' → '06-27 10:00' */
function fmtTs(ts) {
  return typeof ts === 'string' && ts.length >= 16 ? `${ts.slice(5, 10)} ${ts.slice(11, 16)}` : (ts ?? '');
}

/** 千分位 */
function fmtNum(n) {
  return typeof n === 'number' ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';
}

/** 读 JSONL，逐行 parse，跳过坏行；文件不存在返回空数组 */
export function loadEvents(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function renderBreakpoints(events) {
  const bad = events
    .filter((e) => e.status === 'failure' || e.status === 'warning')
    .sort((a, b) => (a.ts < b.ts ? 1 : -1)); // 时间倒序
  let out = '## 🔴 断点告警\n\n';
  if (!bad.length) return out + '✅ 当前无断点告警。\n';
  out += '| 时间 | 运行 | 域 | 环节 | 状态 | 原因 |\n|---|---|---|---|---|---|\n';
  for (const e of bad) {
    out += `| ${fmtTs(e.ts)} | ${e.run_id ?? '—'} | ${e.domain ?? '—'} | ${e.stage ?? '—'} | ${LIGHT[e.status] ?? ''} ${e.status} | ${e.error ?? ''} |\n`;
  }
  return out;
}

function renderTimeline(events) {
  const runs = groupBy(events, (e) => e.run_id ?? 'adhoc');
  const rows = Object.entries(runs)
    .map(([runId, evs]) => {
      const cover = new Set(evs.map((e) => e.stage)).size;
      const hasF = evs.some((e) => e.status === 'failure');
      const hasW = evs.some((e) => e.status === 'warning');
      const light = hasF ? LIGHT.failure : hasW ? LIGHT.warning : LIGHT.success;
      const latestTs = evs.map((e) => e.ts).sort().at(-1);
      const firstBad = evs.find((e) => e.status === 'failure' || e.status === 'warning');
      const note = firstBad ? `${firstBad.stage}：${firstBad.error ?? ''}` : '';
      return { runId, latestTs, cover, light, note };
    })
    .sort((a, b) => (a.latestTs < b.latestTs ? 1 : -1)); // 最新 run 在前
  let out = '## 📅 最近运行时间线\n\n| 运行 | 时间 | 链路 | 状态 | 备注 |\n|---|---|---|---|---|\n';
  for (const r of rows) out += `| ${r.runId} | ${fmtTs(r.latestTs)} | ${r.cover}/${STAGES.length} | ${r.light} | ${r.note} |\n`;
  return out;
}

function renderDomainLifecycle(events) {
  const etl = events.filter((e) => e.stage === 'etl' && e.domain && typeof e.row_count === 'number');
  const byDomain = groupBy(etl, (e) => e.domain);
  let out = '## 📊 各域生命周期\n\n';
  const domains = Object.keys(byDomain).sort();
  if (!domains.length) return out + '（暂无 ETL 行数事件）\n';
  for (const domain of domains) {
    const sorted = [...byDomain[domain]].sort((a, b) => (a.ts < b.ts ? -1 : 1)); // 时间正序
    const latest = sorted.at(-1);
    out += `### ${domain}\n`;
    out += `- 当前：${fmtNum(latest.row_count)} 行 · ${latest.date_range ?? '—'} · 更新 ${fmtTs(latest.ts)}\n`;
    const deltas = [];
    for (let i = sorted.length - 1; i > 0 && deltas.length < 5; i--) {
      const d = sorted[i].row_count - sorted[i - 1].row_count;
      deltas.push(`${d >= 0 ? '+' : ''}${d}（${fmtTs(sorted[i].ts).slice(0, 5)}）`);
    }
    if (deltas.length) out += `- 最近变化：${deltas.join(', ')}\n`;
    out += '\n';
  }
  return out;
}

/** 渲染完整台账 Markdown（三视角） */
export function renderLedger(events) {
  const latestTs = events.map((e) => e.ts).filter(Boolean).sort().at(-1);
  const header =
    `# 数据流转台账\n\n` +
    `> 自动生成，请勿手编（由 scripts/etl-ledger/render.mjs 渲染）。\n` +
    `> 共 ${events.length} 笔事件 · 最后更新 ${fmtTs(latestTs)}\n`;
  return [header, renderBreakpoints(events), renderTimeline(events), renderDomainLifecycle(events)].join('\n');
}

/** 从台账 JSONL 重渲染并写出 Markdown 报告 */
export function writeReport(ledgerPath, mdPath) {
  const md = renderLedger(loadEvents(ledgerPath));
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, 'utf8');
  return md;
}
