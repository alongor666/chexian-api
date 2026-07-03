#!/usr/bin/env node
/**
 * Loop v2 规则命中率审计（rule-hit-rate · E4 治茧房5+6「只增不减」）。
 *
 * 扫 loop 协议里可留下持久证据的机制/闸，统计每条在质量账本（ledger）/ 复盘
 * （pr-evolution.md）/ 调度配置（dispatch-config.json）/ 事件日志（BACKLOG_LOG.jsonl）
 * / 外部真相线（git 回滚反查 + owner 返工 sink）中的实际触发次数，输出三类：
 *   - alive          命中 > 0（规则在真实运转）
 *   - dead-candidate 命中 = 0（死规则/过度设计候选 —— 仅提示，meta-review 人工复核后
 *                    经 §4 append 显式撤项或降级，禁止据此自动删除 append-only 条目）
 *   - untestable     无持久证据可考（prompt 纪律类/纯报表类），诚实列出而非假装可测
 *
 * 与 automation-due 的分工：automation-due 催办「说好要机制化的项」；本脚本反向审计
 * 「已存在的机制是否真的被用到」。二者合成 E4「只增不减 → 可增可减」。
 *
 * 用法：bun run loop:rule-hit-rate [--json] [--no-git]
 *   --no-git  跳过 git 史回滚反查（CI/无 git 环境）
 *
 * 纯函数 ruleHits 导出供单测（不读文件、不 spawn git）。
 * env：LOOP_LEDGER_PATH / LOOP_REWORK_PATH / LOOP_GIT_DIR / LOOP_PR_EVO_PATH /
 *      LOOP_BACKLOG_LOG（与 quality-report/dispatch 同款，供 e2e 隔离）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLedger, normalizeVerdict, collectRevertedPrs, parseUserReworkLog } from './quality-report.mjs';
import { CLAIM_STATUSES } from './dispatch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LEDGER_PATH = process.env.LOOP_LEDGER_PATH || path.join(ROOT, '.claude/workflow/loop-quality-ledger.jsonl');
const PR_EVO_PATH = process.env.LOOP_PR_EVO_PATH || path.join(ROOT, '.claude/workflow/pr-evolution.md');
const REWORK_PATH = process.env.LOOP_REWORK_PATH || path.join(ROOT, '.claude/workflow/user-rework-log.jsonl');
const BACKLOG_LOG_PATH = process.env.LOOP_BACKLOG_LOG || path.join(ROOT, 'BACKLOG_LOG.jsonl');
const CONFIG_PATH = path.join(__dirname, 'dispatch-config.json');

const FAILURE_VERDICTS = new Set(['abandoned', 'orphaned', 'blocked']);

/** 数正则在文本中的命中次数（全局匹配）。 */
function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** codex 闸真实执行判定：{"skipped":…}/{"unavailable":…} 是未执行占位（账本实存），不算闸命中。 */
function codexGateRan(o) {
  return o != null && typeof o === 'object' && !('skipped' in o) && !('unavailable' in o);
}

/**
 * 规则清单（单一事实源）。每条 = 协议中一个可审计的机制/闸。
 * probe(ctx) → number（命中次数）或 null（untestable：无持久证据，禁止据此判死）。
 * ctx 由调用方注入（loadContext 或单测构造）：
 *   { ledger: object[], prEvo: string, config: object, backlogEvents: object[],
 *     reworkCount: number, revertedCount: number|null }
 */
export const RULES = [
  {
    id: 'codex-gate1',
    title: 'codex 闸-1（计划对抗·2026-06-29 起默认关闭）',
    source: 'loop-orchestration.md §2',
    probe: (ctx) => ctx.ledger.filter((r) => r && codexGateRan(r.codex_plan)).length,
  },
  {
    id: 'codex-gate2',
    title: 'codex 闸-2（完成对抗·2026-06-29 起默认关闭）',
    source: 'loop-orchestration.md §2',
    probe: (ctx) => ctx.ledger.filter((r) => r && codexGateRan(r.codex_done)).length,
  },
  {
    id: 'e1-failure-accounting',
    title: 'E1 失败记账（abandoned/orphaned/blocked 入账）',
    source: 'loop-orchestration.md §3 E1',
    probe: (ctx) => ctx.ledger.filter((r) => FAILURE_VERDICTS.has(normalizeVerdict(r?.verdict).verdict)).length,
  },
  {
    id: 'e2-revert-lookup',
    title: 'E2① git 史事后回滚反查',
    source: 'loop-orchestration.md §3 E2',
    probe: (ctx) => ctx.revertedCount, // null = 本次跳过 git（--no-git），untestable
  },
  {
    id: 'e2-rework-sink',
    title: 'E2② owner 返工 sink（user-rework-log.jsonl）',
    source: 'loop-orchestration.md §3 E2',
    probe: (ctx) => ctx.reworkCount,
  },
  {
    id: 'e5-overfit-tagging',
    title: 'E5 集中度打标「待跨域验证」被 meta-review 实际使用',
    source: 'loop-orchestration.md §3 E5 + §4 meta 写法约定',
    probe: (ctx) => countMatches(ctx.prEvo, /待跨域验证/g),
  },
  {
    id: 'claim-lock',
    title: '跨会话认领锁（event-log IN_PROGRESS 认领）',
    source: 'loop-orchestration.md §4 2026-06-22 认领锁',
    probe: (ctx) => ctx.backlogEvents.filter((e) => e && e.kind === 'status' && CLAIM_STATUSES.has(e.status) && e.actor).length,
  },
  {
    id: 'merge-gate',
    title: '合并门串行化闸（--merge-gate slot holder）',
    source: 'loop-orchestration.md §4 2026-06-22 方案B配套',
    probe: (ctx) => countMatches(ctx.prEvo, /merge-gate|slot holder|合并门/gi),
  },
  {
    id: 'gated-cutover',
    title: 'GATED 终局闸（config gated:true 任务永不入前沿）',
    source: 'loop-orchestration.md §5',
    probe: (ctx) => Object.values(ctx.config?.tasks || {}).filter((t) => t && t.gated === true).length,
  },
  {
    id: 'deps-declaration',
    title: '任务前置依赖声明（config deps）',
    source: 'loop-orchestration.md §1',
    probe: (ctx) => Object.keys(ctx.config?.deps || {}).length,
  },
  {
    id: 'domain-override',
    title: '文件域细调覆盖（config tasks.<uid>.domain）',
    source: 'loop-orchestration.md §1',
    probe: (ctx) => Object.values(ctx.config?.tasks || {}).filter((t) => t && t.domain != null).length,
  },
  {
    id: 'needs-automation-loop',
    title: '自进化催办回路（needs_automation → expires → automation-due）',
    source: 'loop-orchestration.md §4',
    probe: (ctx) => countMatches(ctx.prEvo, /needs_automation:\s*true/g),
  },
  {
    id: 'stale-scan',
    title: 'stale-scan 陈旧任务扫描（纯报表，运行不留持久痕迹）',
    source: 'loop-orchestration.md §6',
    probe: () => null,
  },
  {
    id: 'session-prompt-discipline',
    title: 'sessionPrompt 纪律类条款（认领先于实现/bundle 一次推完/prompt 自包含）',
    source: 'dispatch.mjs sessionPrompt · 遵从依赖会话（feedback_prompt_needs_code_backup）',
    probe: () => null,
  },
];

/** 对每条规则跑 probe → {id,title,source,hits,verdict}。纯函数。 */
export function ruleHits(ctx) {
  return RULES.map((r) => {
    let hits = null;
    try {
      hits = r.probe(ctx);
    } catch {
      hits = null; // probe 崩溃视为不可测而非 0，避免把数据缺失误判成死规则
    }
    const verdict = hits == null ? 'untestable' : hits === 0 ? 'dead-candidate' : 'alive';
    return { id: r.id, title: r.title, source: r.source, hits, verdict };
  });
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

function parseJsonl(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/** 读取真实数据源组装 ctx（IO 层，与纯函数 ruleHits 分离）。 */
export function loadContext({ noGit = false } = {}) {
  const ledger = parseLedger(readFileSafe(LEDGER_PATH).split('\n'));
  const prEvo = readFileSafe(PR_EVO_PATH);
  let config = {};
  try { config = JSON.parse(readFileSafe(CONFIG_PATH) || '{}'); } catch { config = {}; }
  const backlogEvents = parseJsonl(readFileSafe(BACKLOG_LOG_PATH));
  const reworkCount = parseUserReworkLog(readFileSafe(REWORK_PATH).split('\n')).length;
  let revertedCount = null;
  if (!noGit) {
    try { revertedCount = collectRevertedPrs().size; } catch { revertedCount = null; }
  }
  return { ledger, prEvo, config, backlogEvents, reworkCount, revertedCount };
}

function render(results) {
  const alive = results.filter((r) => r.verdict === 'alive');
  const dead = results.filter((r) => r.verdict === 'dead-candidate');
  const unt = results.filter((r) => r.verdict === 'untestable');
  const L = [];
  L.push('# Loop 规则命中率审计（rule-hit-rate · E4）');
  L.push('');
  L.push(`- 规则 ${results.length} 条：alive ${alive.length} · 死规则候选 ${dead.length} · 不可测 ${unt.length}`);
  L.push('');
  L.push('## 🔴 死规则候选（命中 0 —— meta-review 人工复核后经 §4 显式撤项/降级，禁止自动删）');
  if (!dead.length) L.push('（无）');
  for (const r of dead) L.push(`- \`${r.id}\` ${r.title} — 来源 ${r.source}`);
  L.push('');
  L.push('## ✅ alive（按命中次数降序）');
  for (const r of [...alive].sort((a, b) => b.hits - a.hits)) L.push(`- \`${r.id}\` ×${r.hits} — ${r.title}`);
  L.push('');
  L.push('## ⚪ 不可测（无持久证据 —— 诚实边界，不能据此判死）');
  for (const r of unt) L.push(`- \`${r.id}\` ${r.title}`);
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const ctx = loadContext({ noGit: args.includes('--no-git') });
  const results = ruleHits(ctx);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
    return;
  }
  console.log(render(results));
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时直接拼 file://${argv[1]} 会失配）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
