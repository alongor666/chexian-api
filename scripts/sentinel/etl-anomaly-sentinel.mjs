#!/usr/bin/env node
/**
 * ETL 异常哨兵 — 主编排
 *
 * 发布后监控（post-publish，非准入闸门）：每日 ETL 后对核心业务指标做
 * 「当前 vs 历史」对比。统计层决定是否告警，LLM 仅归因。异常才打扰，无异常静默。
 *
 * 数据流（详见 scripts/sentinel/README.md 与计划 v3）：
 *   1) GET /api/data/version                 → etlDate（上下文）
 *   2) GET /api/query/comprehensive (If-None-Match:<lastEtag>)
 *        · 304 → 数据版本未变（getDataVersion 指纹），静默退出
 *        · 200 → 4 比率快照 + 逐期赔付率序列 + cutoffDate + timeProgress
 *   3) GET /api/query/trend ×2               → 保费/件数断崖序列
 *   4) GET /api/query/comprehensive(去年同期) → 赔付率 YoY 交叉
 *   5) 统计判定（确定性，唯一告警决策者）+ 成熟度排除（IBNR 防线）
 *   6) LLM 归因（仅对已触发项，temperature=0，不裁决）
 *   7) 产出 verdict.json + summary.md + run-log；GITHUB_OUTPUT 透出状态
 *
 * 不碰 GitHub（职责单一，可本地 dry-run）。GitHub issue/cache 由工作流负责。
 *
 * 用法：
 *   CX_PAT=cx_pat_xxx node scripts/sentinel/etl-anomaly-sentinel.mjs \
 *     [--dry-run] [--api-base <url>] [--config <path>] [--last-etag <etag>] [--out-dir <dir>]
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchDataVersion, fetchComprehensive, fetchTrend, lossTrendToSeries, fetchClaimRatioYoY,
} from './lib/fetch-metrics.mjs';
import { evaluateMetricSeries } from './lib/stats.mjs';
import { judgeAnomalies } from './lib/llm-judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, apiBase: null, config: null, lastEtag: null, outDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--api-base') args.apiBase = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--last-etag') args.lastEtag = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
  }
  return args;
}

function setGithubOutput(kv) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  appendFileSync(out, lines);
}

function buildSummaryMd({ cutoffDate, timeProgress, etlDate, triggered, judged, allVerdicts }) {
  const byMetric = new Map(judged.map((j) => [j.metric, j]));
  const lines = [];
  lines.push(`## 🚨 ETL 异常哨兵告警 — ${cutoffDate ?? '?'}`);
  lines.push('');
  lines.push(`- ETL 数据日期：\`${etlDate ?? '?'}\` · 当期已过：${timeProgress != null ? (timeProgress * 100).toFixed(1) + '%' : '?'}`);
  lines.push(`- 命中异常：**${triggered.length}** 项（统计层判定，LLM 归因）`);
  lines.push('');
  lines.push('| 指标 | 最新成熟期 | 当前值 | 基线均值 | Z | 环比% | 同比% | 严重度 | 归因 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const t of triggered) {
    const j = byMetric.get(t.metric) || {};
    const f = (x) => (Number.isFinite(x) ? x : '—');
    lines.push(
      `| ${t.name} | ${t.latestMaturePeriod ?? '—'} | ${f(t.latestMatureValue)} | ${f(t.baselineMean)} | ${f(t.z)} | ${f(t.mom)} | ${Number.isFinite(t.yoyDeviation) ? t.yoyDeviation : '—'} | ${j.severity ?? '—'} | ${j.one_line_cause ?? '—'} |`
    );
  }
  lines.push('');
  lines.push(`<details><summary>全部指标判定明细（含未触发）</summary>`);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(allVerdicts, null, 2));
  lines.push('```');
  lines.push('</details>');
  lines.push('');
  lines.push(`> 注：满期赔付率近期受赔款报告滞后(IBNR)影响系统性偏低，已排除未成熟近期；告警由统计层确定性触发，LLM 仅归因不裁决。`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  const configPath = args.config || join(__dirname, 'sentinel.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const apiBase = args.apiBase || process.env.SENTINEL_API_BASE || config.apiBase;
  const pat = process.env.CX_PAT;
  const outDir = args.outDir || join(process.cwd(), 'sentinel-out');
  mkdirSync(outDir, { recursive: true });

  if (!pat) {
    console.error('❌ 缺少 CX_PAT 环境变量（PAT 只读令牌）。');
    setGithubOutput({ error: 'missing_pat' });
    process.exit(1);
  }

  const log = (msg) => console.log(`[sentinel] ${msg}`);
  log(`api-base=${apiBase} dry-run=${args.dryRun} granularity=${config.granularity}`);

  // 1) 数据版本上下文
  let etlDate = null;
  try {
    const ver = await fetchDataVersion(apiBase, pat);
    etlDate = ver?.etlDate ?? null;
    log(`data/version etlDate=${etlDate}`);
  } catch (e) {
    log(`data/version 取数失败（继续）：${e.message}`);
  }

  // 2) comprehensive + 幂等（ETag 绑定 getDataVersion 指纹）
  const comp = await fetchComprehensive(apiBase, pat, {
    granularity: config.granularity,
    ifNoneMatch: args.lastEtag || undefined,
  });
  if (comp.notModified) {
    log('304 数据版本未变，静默退出（无新 ETL）。');
    setGithubOutput({ not_modified: 'true', has_anomalies: 'false', etag: args.lastEtag || '' });
    return;
  }
  const { etag, cutoffDate, timeProgress, summary, lossTrendRows } = comp;
  log(`comprehensive cutoffDate=${cutoffDate} timeProgress=${timeProgress} etag=${etag}`);

  // 3) 构建各指标序列并判定
  const verdicts = [];
  const triggered = [];

  const metricsCfg = config.metrics.filter((m) => m.alert);
  const excludeRecent = config?.maturity?.excludeRecent ?? 1;

  for (const mc of metricsCfg) {
    let series = null;

    if (mc.source === 'comprehensive.lossTrend' && mc.id === 'earned_claim_ratio') {
      series = lossTrendToSeries(lossTrendRows);
    } else if (mc.source === 'trend.premium') {
      try { series = await fetchTrend(apiBase, pat, { perspective: 'premium', granularity: config.granularity }); }
      catch (e) { log(`trend(premium) 取数失败（跳过 ${mc.id}）：${e.message}`); }
    } else if (mc.source === 'trend.policy_count') {
      try { series = await fetchTrend(apiBase, pat, { perspective: 'policy_count', granularity: config.granularity }); }
      catch (e) { log(`trend(policy_count) 取数失败（跳过 ${mc.id}）：${e.message}`); }
    } else if (mc.source === 'comprehensive.summarySnapshot') {
      // 无逐期序列指标（如费用率）：以快照值 + （暂无历史序列）→ 记录快照，P2 接序列源
      const snapKey = { expense_ratio: 'expenseRatio', variable_cost_ratio: 'variableCostRatio', comprehensive_expense_ratio: 'comprehensiveExpenseRatio' }[mc.id];
      const snapVal = snapKey ? Number(summary?.[snapKey]) : NaN;
      verdicts.push({ metric: mc.id, name: mc.name, snapshotOnly: true, value: Number.isFinite(snapVal) ? snapVal : null, triggered: false, note: '快照指标，缺逐期序列，P2 接历史序列后启用 Z 判定' });
      continue;
    }

    if (!series || series.length === 0) {
      verdicts.push({ metric: mc.id, name: mc.name, triggered: false, insufficientData: true });
      continue;
    }

    // YoY 交叉（仅赔付率）
    let yoy = null;
    if (mc.id === 'earned_claim_ratio') {
      const latestVal = series.length ? series[series.length - 1].value : null;
      yoy = await fetchClaimRatioYoY(apiBase, pat, cutoffDate, latestVal);
    }

    const v = evaluateMetricSeries(mc.id, series, {
      zThreshold: mc.zThreshold ?? 2,
      momThreshold: mc.momThreshold ?? null,
      direction: mc.direction ?? 'both',
      excludeRecent,
      yoy,
      yoyThreshold: mc.yoyThreshold ?? null,
    });
    v.name = mc.name;
    v.unit = mc.unit;
    verdicts.push(v);
    if (v.triggered) triggered.push(v);
  }

  log(`判定完成：触发 ${triggered.length} / ${metricsCfg.length}`);

  // 4) LLM 归因（仅对触发项）
  const judged = await judgeAnomalies(triggered, { cutoffDate, timeProgress }, config.llm);

  // 5) 产出
  const verdictObj = {
    generatedAt: new Date().toISOString(),
    apiBase,
    etlDate,
    cutoffDate,
    timeProgress,
    etag,
    triggeredCount: triggered.length,
    verdicts,
    judged,
  };
  const verdictPath = join(outDir, 'verdict.json');
  writeFileSync(verdictPath, JSON.stringify(verdictObj, null, 2));

  let summaryPath = '';
  if (triggered.length > 0) {
    const md = buildSummaryMd({ cutoffDate, timeProgress, etlDate, triggered, judged, allVerdicts: verdicts });
    summaryPath = join(outDir, 'summary.md');
    writeFileSync(summaryPath, md);
    if (args.dryRun) {
      log('=== DRY-RUN：以下为本应推送 GitHub issue 的告警 ===');
      console.log(md);
    }
  } else {
    log('无异常，静默（不写 issue）。');
  }

  setGithubOutput({
    not_modified: 'false',
    has_anomalies: String(triggered.length > 0),
    etag: etag || '',
    summary_path: summaryPath,
    verdict_path: verdictPath,
  });

  log(`done. verdict → ${verdictPath}`);
}

main().catch((err) => {
  console.error(`[sentinel] 致命错误：${err.stack || err.message}`);
  setGithubOutput({ error: String(err.message).slice(0, 200) });
  process.exit(1);
});
