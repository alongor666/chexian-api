#!/usr/bin/env node
/**
 * 立方体灰度哨兵（Cube Grayscale Sentinel）— AI agent 入口
 *
 * AI agent 想知道"立方体灰度系统现在健康吗"时跑这个脚本。不依赖任何 SOP 文档，
 * 全部判定逻辑就在本文件——读 /health 自己判断。
 *
 * 通用可加性立方体灰度阶段 1 的自动观测器（PR #604 引入 cubes+cubeShadow 后）。
 * 每小时 cron 跑一次（.github/workflows/cube-grayscale-sentinel.yml），异常自动追踪
 * GitHub issue「立方体灰度哨兵追踪」（label cube-grayscale-anomaly）。
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md
 * BACKLOG 主任务：uid=2026-06-11-claude-90a92c
 * BACKLOG 调频里程碑：uid=2026-06-12-claude-055a12
 *
 * ── 用法 ──
 *   节点本地：node scripts/sentinel/cube-grayscale-sentinel.mjs --api-base URL [--out-dir DIR]
 *   CI 跑：sentinel-out/cube-grayscale/ 自动上传为 artifact 保留 30 天
 *   离线烟测：--dry-run（仅把 summary 打到 stdout，verdict.json/summary.md 仍写）
 *
 * ── 判定规则（确定性可复现，与项目 etl-anomaly-sentinel 同范式）──
 *   ① shadow.*.mismatch > 0         → CRITICAL  立方体算错，立刻暂停切流
 *   ② shadow.*.error > 0            → WARN      立方体执行异常（构建失败 / 连接池耗尽）
 *   ③ cubes.cost.exact=false        → INFO      跨格保单（**ETL 数据质量信号**）
 *   ④ cubes.cost.lastError != null  → **CRITICAL**  cost 立方体失败影响 KPI 大盘 +
 *                                                  cost 分析（P95 大头），阻断切流推进
 *   ④' cubes.{trend,salesman}.lastError → WARN     其他立方体降级只影响特定路由
 *   ⑤ cubes.*.builtVersion 落后      → WARN      立方体未追上 /api/data/version
 *
 * 实现位置：判定纯函数在 lib/cube-grayscale-judge.mjs（可被测试直接 import），
 * 本文件只做 IO（fetch /health + 写 verdict.json/summary.md + GH_OUTPUT）
 *
 * 退出码：CRITICAL → 1（阻断 cron）；其他 → 0（INFO/WARN 通过 GITHUB_OUTPUT 透出但不算"红"）
 *
 * ── 异常时 AI agent 该做什么 ──
 *   CRITICAL  → 看 PM2 日志 [CubeShadow] MISMATCH 拿差异明细 → 改 sql/cube/<route>-cube.ts
 *               改写器或扩 servability.ts token 白名单 + 补集成测试 + 重跑哨兵
 *   WARN/INFO → 记到追踪 issue 里，当天解决（不阻断流程）
 *   误报想紧急关闭 → 跑 scripts/cube-rollback.mjs --target shadow
 *
 * ── 想推进到下一阶段（影子→正式切流 / 切流→调频）──
 *   跑 scripts/release/cube-promote.mjs → 自动读哨兵 7 天历史判定是否可推进
 *
 * ── 红线（governance check 自动兜底，不靠记忆）──
 *   - cube-shadow.ts 的 NUMERIC_TOLERANCE 不可放宽（governance「立方体影子对账容差」）
 *   - 改写器对模板演进有 fail-fast 断言（在 sql/cube/*-cube.ts 内）
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { buildAnomalies, maxSeverity, renderSummary } from './lib/cube-grayscale-judge.mjs';

// ─────────────────────────── 参数解析 ───────────────────────────

const argv = process.argv.slice(2);
const args = { dryRun: false, apiBase: 'https://chexian.cretvalu.com', outDir: 'sentinel-out/cube-grayscale' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') args.dryRun = true;
  else if (a === '--api-base') args.apiBase = argv[++i];
  else if (a.startsWith('--api-base=')) args.apiBase = a.slice('--api-base='.length);
  else if (a === '--out-dir') args.outDir = argv[++i];
  else if (a.startsWith('--out-dir=')) args.outDir = a.slice('--out-dir='.length);
  else if (a === '--help' || a === '-h') {
    console.log('用法：node scripts/sentinel/cube-grayscale-sentinel.mjs [--api-base URL] [--out-dir DIR] [--dry-run]');
    process.exit(0);
  }
}

const log = (msg) => console.log(`[cube-sentinel] ${msg}`);
const apiBase = args.apiBase.replace(/\/+$/, '');
const outDir = resolvePath(args.outDir);
mkdirSync(outDir, { recursive: true });

const ghOutput = process.env.GITHUB_OUTPUT;
const writeGhOutput = (key, value) => {
  if (!ghOutput) return;
  appendFileSync(ghOutput, `${key}=${value}\n`);
};

// ─────────────────────────── 取数 ───────────────────────────

async function fetchHealth() {
  const url = `${apiBase}/health`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`/health 返回非 JSON（status=${res.status}）：${text.slice(0, 200)}`); }
  return { status: res.status, body };
}

async function fetchDataVersion() {
  try {
    const res = await fetch(`${apiBase}/api/data/version`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.version ?? body?.version ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────── 主流程 ───────────────────────────
// 判定 / 报告渲染纯函数全部抽到 ./lib/cube-grayscale-judge.mjs，便于单元测试 import。

async function main() {
  const ranAt = new Date().toISOString();
  log(`api-base=${apiBase} out-dir=${outDir} dry-run=${args.dryRun}`);

  let healthBody = null;
  let healthStatus = null;
  try {
    const health = await fetchHealth();
    healthBody = health.body;
    healthStatus = health.status;
    log(`/health HTTP ${healthStatus} dataReady=${healthBody?.message ?? '?'}`);
  } catch (err) {
    log(`/health 取数失败：${err.message}`);
    const verdict = {
      version: 'cube-grayscale-sentinel/1.0',
      ranAt, apiBase,
      health: { status: null, error: err.message },
      anomalies: [{ severity: 'CRITICAL', kind: 'health_unreachable', route: 'health', message: `/health 端点不可达：${err.message}` }],
      hasAnomalies: true,
    };
    writeFileSync(`${outDir}/verdict.json`, JSON.stringify(verdict, null, 2));
    writeFileSync(`${outDir}/summary.md`, `# 立方体灰度哨兵报告\n\n❌ CRITICAL：/health 端点不可达\n\n\`\`\`\n${err.message}\n\`\`\`\n`);
    writeGhOutput('has_anomalies', 'true');
    writeGhOutput('max_severity', 'CRITICAL');
    writeGhOutput('summary_path', `${outDir}/summary.md`);
    writeGhOutput('verdict_path', `${outDir}/verdict.json`);
    process.exit(1);
  }

  const dataVersion = await fetchDataVersion();
  const { anomalies, checks } = buildAnomalies({ healthBody, dataVersion });
  const hasAnomalies = anomalies.length > 0;
  const sev = maxSeverity(anomalies);

  const verdict = {
    version: 'cube-grayscale-sentinel/1.0',
    ranAt, apiBase,
    health: { status: healthStatus, body: { message: healthBody?.message, dataReady: healthBody?.success } },
    dataVersion,
    cubes: healthBody?.cubes ?? {},
    shadow: healthBody?.cubeShadow ?? {},
    checks,
    anomalies,
    hasAnomalies,
    maxSeverity: sev,
  };
  writeFileSync(`${outDir}/verdict.json`, JSON.stringify(verdict, null, 2));

  const summaryMd = renderSummary({ ranAt, dataVersion, healthBody, anomalies, checks, apiBase });
  writeFileSync(`${outDir}/summary.md`, summaryMd);

  writeGhOutput('has_anomalies', hasAnomalies ? 'true' : 'false');
  writeGhOutput('max_severity', sev ?? 'NONE');
  writeGhOutput('summary_path', `${outDir}/summary.md`);
  writeGhOutput('verdict_path', `${outDir}/verdict.json`);

  if (args.dryRun) {
    log('=== DRY-RUN：以下为本应推送 GitHub issue 的报告 ===');
    console.log(summaryMd);
  }

  log(`done. verdict → ${outDir}/verdict.json (${hasAnomalies ? `${anomalies.length} 异常 / 最高 ${sev}` : '健康'})`);

  // CRITICAL 退出码 1，其他都 0（INFO/WARN 通过 GITHUB_OUTPUT 透出，不阻断 cron）
  if (sev === 'CRITICAL') process.exit(1);
}

main().catch((err) => {
  console.error(`[cube-sentinel] 致命错误：${err.stack || err.message}`);
  process.exit(1);
});
