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
 * ── 4 条判定规则（确定性可复现，与项目 etl-anomaly-sentinel 同范式）──
 *   ① shadow.*.mismatch > 0   → CRITICAL  立方体算错，立刻暂停切流；根因 = 改写器口径漂移 / ETL 新字段值 / 立方体 bug
 *   ② shadow.*.error > 0      → WARN      立方体执行异常（构建失败 / 连接池耗尽 / 内存）
 *   ③ cubes.cost.exact=false  → INFO      跨格保单（**ETL 数据质量信号** — 同保单批改改了机构/起保日）
 *   ④ cubes.*.builtVersion    → WARN      立方体落后 /api/data/version（cache-warmer 路由未覆盖）
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

// ─────────────────────────── 判定规则 ───────────────────────────

const SEVERITY = { CRITICAL: 3, WARN: 2, INFO: 1 };

function buildAnomalies({ healthBody, dataVersion }) {
  const anomalies = [];
  const checks = [];
  const cubes = healthBody?.cubes ?? {};
  const shadow = healthBody?.cubeShadow ?? {};

  // 规则 ① mismatch > 0 → CRITICAL
  const mismatches = Object.entries(shadow)
    .map(([route, s]) => ({ route, n: Number(s?.mismatch ?? 0) }))
    .filter((x) => x.n > 0);
  checks.push({
    id: 'shadow_no_mismatch',
    ok: mismatches.length === 0,
    detail: mismatches.length === 0 ? '所有路由影子对账 mismatch=0' : `${mismatches.length} 条路由出现差异：${mismatches.map((m) => `${m.route}=${m.n}`).join(', ')}`,
  });
  for (const m of mismatches) {
    anomalies.push({
      severity: 'CRITICAL',
      kind: 'shadow_mismatch',
      route: m.route,
      message: `路由 ${m.route} 影子对账出现 ${m.n} 次差异 — 立方体结果与原路径不等，应立刻暂停灰度切流并排查（口径漂移 / 新字段值未识别 / 立方体逻辑 bug）`,
    });
  }

  // 规则 ② error > 0 → WARN
  const errors = Object.entries(shadow)
    .map(([route, s]) => ({ route, n: Number(s?.error ?? 0) }))
    .filter((x) => x.n > 0);
  checks.push({
    id: 'shadow_no_error',
    ok: errors.length === 0,
    detail: errors.length === 0 ? '所有路由影子对账 error=0' : errors.map((e) => `${e.route}=${e.n}`).join(', '),
  });
  for (const e of errors) {
    anomalies.push({
      severity: 'WARN',
      kind: 'shadow_error',
      route: e.route,
      message: `路由 ${e.route} 影子查询执行异常 ${e.n} 次 — 多见于立方体构建失败或连接池耗尽，查 PM2 日志 [CubeShadow]`,
    });
  }

  // 规则 ③ cost cube 探针降级 → INFO（业务数据质量信号）
  const costExact = cubes?.cost?.exact;
  if (costExact === false) {
    anomalies.push({
      severity: 'INFO',
      kind: 'cost_cube_degraded',
      route: 'cost',
      message: '成本立方体探针发现跨格保单（同一保单的批改行机构/起保日不一致）— 本数据版本 cost 路由保持原路径，**这是数据质量信号**：ETL 上游应复盘批改是否改了机构/起保日字段',
    });
  }
  checks.push({ id: 'cost_cube_exact', ok: costExact !== false, detail: costExact === false ? '探针发现跨格保单（exact=false）' : '探针通过（exact=true 或尚未构建）' });

  // 规则 ④ builtVersion 长期落后 dataVersion → WARN
  // 进程冷启动初期 builtVersion 可能为 null（lastBuildMs 也为 null），属正常；
  // 已尝试构建过但失败时 lastError 有内容，单独标记
  const lagged = [];
  for (const [name, state] of Object.entries(cubes)) {
    if (!state) continue;
    if (state.lastError) {
      anomalies.push({
        severity: 'WARN',
        kind: 'cube_build_error',
        route: name,
        message: `立方体 ${name} 最近一次构建失败：${state.lastError}`,
      });
    }
    if (dataVersion && state.builtVersion && state.builtVersion !== dataVersion) {
      lagged.push({ name, built: state.builtVersion, want: dataVersion });
    }
  }
  checks.push({
    id: 'cubes_fresh',
    ok: lagged.length === 0,
    detail: lagged.length === 0 ? '立方体已追上当前数据版本（或尚未构建）' : lagged.map((l) => `${l.name}: built=${l.built} want=${l.want}`).join('; '),
  });
  for (const l of lagged) {
    anomalies.push({
      severity: 'WARN',
      kind: 'cube_stale',
      route: l.name,
      message: `立方体 ${l.name} builtVersion=${l.built} 落后当前 dataVersion=${l.want} — 通常 ETL 后预热请求会自动追上，若长期落后排查 cache-warmer 是否覆盖该路由族`,
    });
  }

  return { anomalies, checks };
}

function maxSeverity(anomalies) {
  if (anomalies.length === 0) return null;
  let maxKey = null;
  let maxScore = 0;
  for (const a of anomalies) {
    const s = SEVERITY[a.severity] ?? 0;
    if (s > maxScore) { maxScore = s; maxKey = a.severity; }
  }
  return maxKey;
}

// ─────────────────────────── 报告生成 ───────────────────────────

function renderSummary({ ranAt, dataVersion, healthBody, anomalies, checks }) {
  const cubes = healthBody?.cubes ?? {};
  const shadow = healthBody?.cubeShadow ?? {};
  const overall = anomalies.length === 0 ? '✅ 健康' : `❌ ${maxSeverity(anomalies)}（${anomalies.length} 条）`;

  let md = `# 立方体灰度哨兵报告\n\n`;
  md += `- **时间**：${ranAt}\n`;
  md += `- **环境**：${apiBase}\n`;
  md += `- **数据版本**：${dataVersion ?? '(未取到)'}\n`;
  md += `- **总体状态**：${overall}\n\n`;

  md += `## 检查项\n\n`;
  md += `| 检查 | 结果 | 说明 |\n|---|---|---|\n`;
  for (const c of checks) {
    md += `| ${c.id} | ${c.ok ? '✅' : '❌'} | ${c.detail} |\n`;
  }
  md += `\n`;

  md += `## 立方体新鲜度\n\n`;
  md += `| 立方体 | builtVersion | building | lastBuildMs | exact | lastError |\n|---|---|---|---|---|---|\n`;
  for (const [name, s] of Object.entries(cubes)) {
    md += `| ${name} | ${s.builtVersion ?? '(null)'} | ${s.building ? '是' : '否'} | ${s.lastBuildMs ?? '-'} | ${s.exact === undefined ? '-' : s.exact} | ${s.lastError ?? '-'} |\n`;
  }
  md += `\n`;

  md += `## 影子对账计数（本进程累计，PM2 reload 重置）\n\n`;
  if (Object.keys(shadow).length === 0) {
    md += `_暂无路由触发过影子对账。这可能是正常的：影子对账只在请求满足"可服务 + 立方体就绪"时才双跑；进程刚启动 / 流量极低时为空属预期。_\n\n`;
  } else {
    md += `| 路由 | match | mismatch | error |\n|---|---:|---:|---:|\n`;
    for (const [route, s] of Object.entries(shadow)) {
      md += `| ${route} | ${s.match} | ${s.mismatch} | ${s.error} |\n`;
    }
    md += `\n`;
  }

  if (anomalies.length > 0) {
    md += `## 异常清单\n\n`;
    for (const a of anomalies) {
      md += `- **[${a.severity}] ${a.kind}** (${a.route})：${a.message}\n`;
    }
    md += `\n`;
  }

  md += `---\n`;
  md += `_产物：\`verdict.json\` 机器可读 · 本文 \`summary.md\` 人可读 · workflow artifact 保留 30 天 · 异常自动追踪 issue「立方体灰度哨兵追踪」（label \`cube-grayscale-anomaly\`）。设计文档与 BACKLOG uid=2026-06-11-claude-90a92c。_\n`;
  return md;
}

// ─────────────────────────── 主流程 ───────────────────────────

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

  const summaryMd = renderSummary({ ranAt, dataVersion, healthBody, anomalies, checks });
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
