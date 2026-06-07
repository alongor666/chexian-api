#!/usr/bin/env node
/**
 * ETL 发布前准入闸门 — 主编排
 *
 * 与 scripts/sentinel/ 的关系：
 *   sentinel  = 发布后监控（post-publish）：查 live API，异常时打扰人，不阻断。
 *   gate（本脚本）= 发布前准入（pre-publish）：查刚 ETL 出的本地 parquet，异常时
 *                  **fail-fast 阻断发布**，不让坏数据进 VPS 与生产 API。
 *
 * 数据流：
 *   1) inspectWarehouse：确认 parquet 存在；缺失时优先报错（数据未 ETL，谈不上 gate）
 *   2) fetchLocalSeries：DuckDB CLI 直查 warehouse，每指标拿到逐期序列
 *   3) evaluateMetricSeries（复用 sentinel/lib/stats.mjs）：确定性统计判定 + 成熟度过滤
 *   4) 触发任一指标 → 退出码 != 0（阻断 sync-and-reload Stage 3 sync-vps）
 *      无触发 → 写 verdict.json 后静默退出 0
 *
 * 设计原则：
 *   - 统计层是唯一裁决者，不引 LLM（gate 必须可复现、无外部依赖；归因留给后续 sentinel）
 *   - 不破坏现有流程：默认开启 + --skip-gate 应急旁路（带审计日志）
 *   - 所有阈值在 gate.config.json 中声明，禁止硬编码
 *
 * 用法：
 *   node scripts/prepublish-gate/prepublish-gate.mjs
 *   node scripts/prepublish-gate/prepublish-gate.mjs --warehouse-root /custom/path
 *   node scripts/prepublish-gate/prepublish-gate.mjs --config /custom/gate.config.json
 *   node scripts/prepublish-gate/prepublish-gate.mjs --skip-gate --skip-reason "已人工核对"
 *   PREPUBLISH_GATE_SKIP=1 PREPUBLISH_GATE_SKIP_REASON="..." node ...
 *
 * 退出码（fail-closed 原则：缺数据/取数失败一律阻断，只 --skip-gate 显式放行）：
 *   0  无异常 / --skip-gate（带审计）
 *   1  统计触发异常，阻断后续发布步骤
 *   2  配置 / IO / DuckDB 错误 / parquet 缺失或未就绪
 *      （codex PR #513 第6轮 P1：原 parquet 未就绪 exit 0 违反 fail-closed——ETL 静默
 *      失败 / 误删 → 仓库空 → 闸门放行 → sync-vps 把不完整 warehouse 推到生产；
 *      改为 exit 2 阻断，仅 --skip-gate 显式放行。）
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

import { evaluateMetricSeries } from '../sentinel/lib/stats.mjs';
import {
  inspectWarehouse,
  fetchLocalSeries,
  runDuckDBDefault,
} from './lib/fetch-local-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(color, msg) {
  process.stdout.write(`${COLORS[color] || ''}${msg}${COLORS.reset}\n`);
}

export function parseArgs(argv) {
  const opts = {
    config: null,
    warehouseRoot: null,
    outDir: null,
    skipGate: false,
    skipReason: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') opts.config = argv[++i];
    else if (a === '--warehouse-root') opts.warehouseRoot = argv[++i];
    else if (a === '--out-dir') opts.outDir = argv[++i];
    else if (a === '--skip-gate') opts.skipGate = true;
    else if (a === '--skip-reason') opts.skipReason = argv[++i] || '';
    else if (a === '--help' || a === '-h') {
      log('cyan',
        '用法：node scripts/prepublish-gate/prepublish-gate.mjs ' +
        '[--config <path>] [--warehouse-root <path>] [--out-dir <path>] ' +
        '[--skip-gate [--skip-reason "<理由>"]]'
      );
      process.exit(0);
    }
  }
  // 环境变量兜底（CI / cron / 紧急运维）
  if (!opts.skipGate && (process.env.PREPUBLISH_GATE_SKIP === '1' || process.env.PREPUBLISH_GATE_SKIP === 'true')) {
    opts.skipGate = true;
    if (!opts.skipReason) opts.skipReason = process.env.PREPUBLISH_GATE_SKIP_REASON || '(env PREPUBLISH_GATE_SKIP)';
  }
  return opts;
}

export function writeBypassAudit({ repoRoot, reason, source = 'cli' }) {
  const auditDir = join(repoRoot, 'logs');
  mkdirSync(auditDir, { recursive: true });
  const auditPath = join(auditDir, 'prepublish-gate-bypass.log');
  const entry = {
    timestamp: new Date().toISOString(),
    user: process.env.USER || process.env.USERNAME || 'unknown',
    hostname: os.hostname(),
    source,
    reason: reason || '(no reason given)',
    cwd: process.cwd(),
  };
  appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf-8');
  return auditPath;
}

/** 把可能是相对的路径解析为绝对路径（相对 repoRoot 解析） */
function resolveRelative(p, repoRoot) {
  if (!p) return p;
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}

/**
 * 把 inspectWarehouse 结果转成"该放行还是 fail-closed 阻断"的决策。纯函数便于单测。
 *
 * fail-closed 策略（codex PR #513 第6轮 P1）：
 *   - ready=true → 放行（proceed=true）
 *   - ready=false → 阻断（proceed=false, exitCode=2）
 *     原始设计 exit 0 "视作非闸门职责"是错的——闸门跑在 ETL 之后、sync-vps 之前；
 *     ETL 静默失败 / 误 rm warehouse 后闸门若 exit 0 → sync-vps Stage 3 直接把不完整
 *     warehouse rsync 到生产。fail-closed 唯一安全语义：缺数据一律阻断，紧急放行用 --skip-gate。
 *
 * @param {{ready: boolean, missing: string[]}} inspection
 * @returns {{proceed: boolean, exitCode?: number, reason?: string, missing?: string[]}}
 */
export function evaluateInspection(inspection) {
  if (inspection?.ready) return { proceed: true };
  return {
    proceed: false,
    exitCode: 2,
    reason: 'warehouse-not-ready',
    missing: inspection?.missing ?? [],
  };
}

/**
 * 闸门核心：取数 + 判定。纯函数，便于单测（fetcher 注入）。
 *
 * @param {object} config - gate.config.json 内容
 * @param {object} ctx - { policyGlob, claimsGlob, duckdbBin }
 * @param {(ctx, source) => Promise<Array>} [fetcher=fetchLocalSeries] - 注入
 * @returns {Promise<{verdicts: Array, triggered: Array, errors: Array}>}
 */
/**
 * 当前业务月首日（YYYY-MM-01），固定按中国业务时区 Asia/Shanghai 计算，与发布机自身时区解耦。
 * 注入到 SQL 时间窗 cutoff，避免 DuckDB `current_date` 在 UTC 机器月初退到上月（codex PR #513 P2）。
 * @param {Date} [now] - 注入便于单测；默认取系统当前时刻。
 */
export function currentBusinessMonthStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}-01`;
}

export async function runGateChecks(config, ctx, fetcher = fetchLocalSeries) {
  const verdicts = [];
  const triggered = [];
  const errors = [];
  const globalExcludeRecent = config?.maturity?.excludeRecent ?? 1;
  const minMaturePeriods = config?.history?.minMaturePeriods ?? 3;

  const metricsCfg = (config.metrics || []).filter((m) => m.alert);

  for (const mc of metricsCfg) {
    let series;
    try {
      series = await fetcher(ctx, mc.source);
    } catch (e) {
      errors.push({ metric: mc.id, name: mc.name, error: e.message });
      verdicts.push({
        metric: mc.id, name: mc.name, triggered: false, fetchError: e.message,
      });
      continue;
    }
    // 空 series → fail-closed（codex PR #513 第7轮 P1）：
    // parquet 文件存在但 ETL 产出为空、只剩当前未完成月、或分区被误清到没有可用历史时，
    // fetchLocalSeries 会返回空数组；与缺 parquet/取数失败一样属于"闸门无法判定"。
    // 原始把它当 insufficientData 不进 errors → 主流程 exit 0 → 不完整 warehouse 被发布。
    if (!series || series.length === 0) {
      const msg = '取数返回空（parquet 存在但 ETL 产出无数据 / 分区被清 / 只剩未完成月）';
      errors.push({ metric: mc.id, name: mc.name, error: msg });
      verdicts.push({
        metric: mc.id, name: mc.name, triggered: false, fetchError: msg, seriesLength: 0,
      });
      continue;
    }
    const verdict = evaluateMetricSeries(mc.id, series, {
      zThreshold: mc.zThreshold ?? 2,
      momThreshold: mc.momThreshold ?? null,
      direction: mc.direction ?? 'both',
      excludeRecent: Number.isInteger(mc.excludeRecent) ? mc.excludeRecent : globalExcludeRecent,
      yoyThreshold: mc.yoyThreshold ?? null,
    });
    verdict.name = mc.name;
    verdict.unit = mc.unit;
    verdict.seriesLength = series.length;
    // 完整期数不足 < minMaturePeriods 也 fail-closed（codex PR #513 第7轮 P1 同根因延伸）：
    // 闸门无法做 Z-score 判定时不能"只记录不阻断"——发布前任一指标无法判定即视作环境异常。
    if (verdict.insufficientData) {
      const msg = `完整期数不足：仅 ${series.length} 期可用，少于最小 ${minMaturePeriods}（excludeRecent 后无足够基线）`;
      errors.push({ metric: mc.id, name: mc.name, error: msg });
      verdict.note = msg;
    }
    verdicts.push(verdict);
    if (verdict.triggered) triggered.push(verdict);
  }

  return { verdicts, triggered, errors };
}

function buildSummary({ generatedAt, warehouseRoot, verdicts, triggered, errors }) {
  const lines = [];
  lines.push(`# ETL 发布前准入闸门 — 报告`);
  lines.push('');
  lines.push(`- 生成时间：${generatedAt}`);
  lines.push(`- warehouseRoot：${warehouseRoot}`);
  lines.push(`- 触发指标：**${triggered.length}** / ${verdicts.length}`);
  lines.push(`- 取数错误：${errors.length}`);
  lines.push('');
  if (triggered.length > 0) {
    lines.push('## 🚨 阻断原因');
    lines.push('');
    lines.push('| 指标 | 最新成熟期 | 当前值 | 基线均值 | Z | 环比% | 原因 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const t of triggered) {
      const f = (x) => (Number.isFinite(x) ? x : '—');
      lines.push(
        `| ${t.name} | ${t.latestMaturePeriod ?? '—'} | ${f(t.latestMatureValue)} | ${f(t.baselineMean)} | ${f(t.z)} | ${f(t.mom)} | ${t.reasons.join('；')} |`
      );
    }
    lines.push('');
    lines.push('### 排查建议');
    lines.push('1. 核对源 xlsx 是否完整（看 ETL stdout 的行数 / 文件名 -1 天对齐）');
    lines.push('2. 对照 sentinel 上一份 verdict 是否预测过类似漂移');
    lines.push('3. 确认非业务真实变化后，可用 `--skip-gate --skip-reason "..."` 应急放行（审计入 logs/prepublish-gate-bypass.log）');
    lines.push('');
  } else {
    lines.push('## ✅ 全部指标在基线范围内');
    lines.push('');
  }
  if (errors.length > 0) {
    lines.push('## ⚠ 取数错误（不阻断但需排查）');
    for (const e of errors) lines.push(`- ${e.metric}（${e.name}）：${e.error}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('明细见 verdict.json。注：统计层确定性判定 + 成熟度过滤，复用 scripts/sentinel/lib/stats.mjs。');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  log('bold', '════════════════════════════════════════════════');
  log('bold', '  prepublish-gate：发布前准入闸门');
  log('bold', '════════════════════════════════════════════════');

  // ---- skip-gate 应急旁路 ----
  if (opts.skipGate) {
    const auditPath = writeBypassAudit({
      repoRoot: REPO_ROOT,
      reason: opts.skipReason,
      source: 'cli',
    });
    log('yellow', `⚠ 准入闸门已旁路（--skip-gate）`);
    log('yellow', `   原因：${opts.skipReason || '(未填)'}`);
    log('yellow', `   审计：${auditPath}`);
    log('yellow', `   注意：本次发布不做发布前 parquet 体检，依赖 sentinel 发布后监控兜底。`);
    process.exit(0);
  }

  // ---- 配置 ----
  const configPath = opts.config
    ? resolveRelative(opts.config, REPO_ROOT)
    : join(__dirname, 'gate.config.json');
  if (!existsSync(configPath)) {
    log('red', `❌ 配置文件不存在：${configPath}`);
    process.exit(2);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    log('red', `❌ 配置文件 JSON 解析失败：${e.message}`);
    process.exit(2);
  }

  const warehouseRoot = resolveRelative(
    opts.warehouseRoot || config.warehouseRoot || '数据管理/warehouse',
    REPO_ROOT
  );
  const duckdbBin = config.duckdbBin || 'duckdb';
  const outDir = opts.outDir
    ? resolveRelative(opts.outDir, REPO_ROOT)
    : join(REPO_ROOT, 'logs', 'prepublish-gate');
  mkdirSync(outDir, { recursive: true });

  log('cyan', `  config:         ${configPath}`);
  log('cyan', `  warehouseRoot:  ${warehouseRoot}`);
  log('cyan', `  duckdb:         ${duckdbBin}`);
  log('cyan', `  outDir:         ${outDir}`);
  log('cyan', `  metrics(alert): ${(config.metrics || []).filter((m) => m.alert).length}`);

  // ---- 校验仓库就绪（fail-closed：缺数据 exit 2 阻断 sync-vps，仅 --skip-gate 显式放行）----
  const inspection = inspectWarehouse(warehouseRoot);
  const inspectionVerdict = evaluateInspection(inspection);
  if (!inspectionVerdict.proceed) {
    log('red', `\n❌ parquet 未就绪 → fail-closed 阻断（退出码 ${inspectionVerdict.exitCode}，不 rsync、不 reload）：`);
    for (const m of inspectionVerdict.missing) log('red', `   - ${m}`);
    log('yellow', `   排查：数据管理/daily.mjs 输出 / ls 数据管理/warehouse/fact/`);
    log('yellow', `   确属环境问题（fresh worktree 无数据 / 仅跑闸门单测）需放行：`);
    log('yellow', `   node scripts/prepublish-gate/prepublish-gate.mjs --skip-gate --skip-reason "<原因>"`);
    process.exit(inspectionVerdict.exitCode);
  }
  log('green', `\n  ✓ warehouse 就绪`);

  // ---- 取数 + 判定 ----
  const ctx = {
    policyGlob: inspection.policyGlob,
    claimsGlob: inspection.claimsGlob,
    duckdbBin,
    monthStart: currentBusinessMonthStart(),
  };
  log('cyan', `  业务月 cutoff:   < ${ctx.monthStart}（Asia/Shanghai，与机器时区解耦）`);
  let result;
  try {
    result = await runGateChecks(config, ctx);
  } catch (e) {
    log('red', `\n❌ 闸门执行致命错误：${e.message}`);
    process.exit(2);
  }

  const generatedAt = new Date().toISOString();
  const verdictObj = {
    generatedAt,
    warehouseRoot,
    configPath,
    triggeredCount: result.triggered.length,
    fetchErrorCount: result.errors.length,
    verdicts: result.verdicts,
    errors: result.errors,
  };
  const verdictPath = join(outDir, 'verdict.json');
  writeFileSync(verdictPath, JSON.stringify(verdictObj, null, 2));

  const summaryPath = join(outDir, 'summary.md');
  const summaryMd = buildSummary({
    generatedAt,
    warehouseRoot,
    verdicts: result.verdicts,
    triggered: result.triggered,
    errors: result.errors,
  });
  writeFileSync(summaryPath, summaryMd);

  log('cyan', `\n  报告：${verdictPath}`);
  log('cyan', `        ${summaryPath}`);

  // 取数失败＝闸门无法判定该指标，按 fail-closed 阻断（退出码 2，与脚本头部「DuckDB 错误」语义一致）。
  // 否则只要没有其它指标触发就会走到 exit 0，sync-and-reload Stage 2.5 只看退出码 → 把没体检完的数据 rsync 出去（codex PR #513 P1）。
  if (result.errors.length > 0) {
    log('red', `\n❌ ${result.errors.length} 个取数错误 → fail-closed 阻断（退出码 2，不 rsync、不 reload）：`);
    for (const e of result.errors) log('red', `   - ${e.metric}：${e.error.slice(0, 200)}`);
    log('yellow', `\n📄 详情见 ${summaryPath}`);
    log('yellow', `   确属环境问题（如发布机无 duckdb / Parquet schema 漂移）需放行：`);
    log('yellow', `   node scripts/prepublish-gate/prepublish-gate.mjs --skip-gate --skip-reason "<原因>"`);
    process.exit(2);
  }

  if (result.triggered.length > 0) {
    log('red', `\n❌ 准入闸门阻断：${result.triggered.length} 个指标触发`);
    for (const t of result.triggered) {
      log('red', `   - ${t.name}（${t.metric}）@ ${t.latestMaturePeriod} = ${t.latestMatureValue} · ${t.reasons.join('；')}`);
    }
    log('yellow', `\n📄 详情见 ${summaryPath}`);
    log('yellow', `   人工确认后应急放行：`);
    log('yellow', `   node scripts/prepublish-gate/prepublish-gate.mjs --skip-gate --skip-reason "<原因>"`);
    log('yellow', `   或：bun run release:daily -- --skip-gate`);
    process.exit(1);
  }

  log('green', `\n✅ 准入闸门通过：${result.verdicts.length} 个指标全部正常`);
}

// 仅在直接执行时跑 main（被测试 import 时不跑）
// 用 pathToFileURL 而非裸 `file://` 拼接，避免相对路径调用时漏跑（如 node scripts/.../gate.mjs）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log('red', `\n❌ 未捕获异常：${err.stack || err.message}`);
    process.exit(2);
  });
}
