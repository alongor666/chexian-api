#!/usr/bin/env node
/**
 * 黄金基线构建器 — Phase 2 SQL-01
 *
 * 在任何 SQL 代码修改前，对所有 API 端点（含即将删除的系数接口）
 * 完整抓取一次 JSON 响应，存入 .planning/golden-baseline/，
 * 作为后续回归对比的事实基准。
 *
 * 使用方法:
 *   node scripts/golden-baseline.mjs             # 等同 --build
 *   node scripts/golden-baseline.mjs --build     # 构建黄金基线
 *   node scripts/golden-baseline.mjs --compare   # 与基线对比
 *   node scripts/golden-baseline.mjs --dry-run   # 列出端点清单，不访问 server
 *   node scripts/golden-baseline.mjs --help      # 帮助
 *
 * 输出目录: .planning/golden-baseline/{endpointSlug}/{paramHash}.json
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const BASELINE_DIR = join(ROOT_DIR, '.planning/golden-baseline');
const SERVER_URL = process.env.SNAPSHOT_SERVER_URL || 'http://localhost:3000';

// 抓取并发上限：DuckDB 连接池有限，71 端点全并发会 "ConnectionPool: queue full / acquire timeout"
// → 大量 500，基线不完整。限流到小并发既保护池又足够快。可用 BASELINE_CONCURRENCY 覆盖。
const FETCH_CONCURRENCY = Number(process.env.BASELINE_CONCURRENCY) || 4;

// ── ANSI 颜色 ────────────────────────────────
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

// ── 端点定义 ─────────────────────────────────
//
// 格式: { slug, path, params, deprecated }
// slug: 唯一标识符（用作快照子目录名）
// path: 完整 API 路径（含 /api/xxx 前缀）
// params: 默认请求参数（空对象 = 无参数）
// deprecated: true 表示即将删除，仅用于存档，--compare 跳过

const ENDPOINT_DEFINITIONS = [
  // ── /api/query/kpi ────────────────────────
  { slug: 'kpi', path: '/api/query/kpi', params: {}, deprecated: false },
  { slug: 'kpi-detail', path: '/api/query/kpi-detail', params: {}, deprecated: false },

  // ── /api/query/trend ──────────────────────
  { slug: 'trend', path: '/api/query/trend', params: {}, deprecated: false },
  { slug: 'quality-business-trend', path: '/api/query/quality-business-trend', params: {}, deprecated: false },
  { slug: 'test', path: '/api/query/test', params: {}, deprecated: false, volatile: true }, // 回显本次 login 的 user/session，每次重登不同→非确定性

  // ── /api/query/truck ──────────────────────
  { slug: 'truck', path: '/api/query/truck', params: {}, deprecated: false },

  // ── /api/query/growth ─────────────────────
  { slug: 'growth', path: '/api/query/growth', params: {}, deprecated: false },

  // ── /api/query/coefficient（待删除）───────
  { slug: 'coefficient', path: '/api/query/coefficient', params: {}, deprecated: true },

  // ── /api/query/cost ───────────────────────
  // cost 端点接受多种 analysisType / type 请求形态，对应 useCostAnalysis 8 个 fetch
  // dimension 合法白名单（cost.ts:61 zod enum）：customer_category | org_level_3 | coverage_combination | org_customer | org_coverage
  { slug: 'cost-claim-ratio', path: '/api/query/cost', params: { analysisType: 'claimRatio', dimension: 'customer_category', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-expense-ratio', path: '/api/query/cost', params: { analysisType: 'expenseRatio', dimension: 'org_level_3', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-comprehensive', path: '/api/query/cost', params: { analysisType: 'comprehensiveCost', dimension: 'coverage_combination', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-variable', path: '/api/query/cost', params: { analysisType: 'variableCost', dimension: 'org_customer', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-variable-kpi', path: '/api/query/cost', params: { analysisType: 'variableCost', dimension: 'org_level_3', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-earned', path: '/api/query/cost', params: { type: 'earned', cutoffDate: '2026-04-29' }, deprecated: false },
  { slug: 'cost-earned-new', path: '/api/query/cost', params: { type: 'earned-new' }, deprecated: false },
  { slug: 'cost-expense-forecast', path: '/api/query/cost', params: { type: 'expense-forecast', operatingCostRate: '9' }, deprecated: false },

  // ── /api/query/comprehensive ──────────────
  { slug: 'comprehensive-bundle', path: '/api/query/comprehensive-bundle', params: {}, deprecated: false },
  { slug: 'comprehensive-analysis-bundle', path: '/api/query/comprehensive-analysis-bundle', params: {}, deprecated: false },

  // ── /api/query/cross-sell ─────────────────
  { slug: 'cross-sell', path: '/api/query/cross-sell', params: {}, deprecated: false },
  { slug: 'cross-sell-trend', path: '/api/query/cross-sell-trend', params: {}, deprecated: false },
  { slug: 'cross-sell-summary', path: '/api/query/cross-sell-summary', params: {}, deprecated: false },
  { slug: 'cross-sell-org-trend', path: '/api/query/cross-sell-org-trend', params: {}, deprecated: false },
  { slug: 'cross-sell-heatmap', path: '/api/query/cross-sell-heatmap', params: {}, deprecated: false },
  { slug: 'cross-sell-top-salesman', path: '/api/query/cross-sell-top-salesman', params: {}, deprecated: false },

  // ── /api/query/salesman ───────────────────
  { slug: 'salesman-ranking', path: '/api/query/salesman-ranking', params: {}, deprecated: false },

  // ── /api/query/report ─────────────────────
  { slug: 'marketing-report', path: '/api/query/marketing-report', params: {}, deprecated: false },
  { slug: 'holiday-drilldown', path: '/api/query/holiday-drilldown', params: { groupBy: 'org_level_3' }, deprecated: false },
  { slug: 'premium-report', path: '/api/query/premium-report', params: {}, deprecated: false },

  // ── /api/query/premium-plan ───────────────
  { slug: 'premium-plan', path: '/api/query/premium-plan', params: {}, deprecated: false },
  { slug: 'plan-achievement', path: '/api/query/plan-achievement', params: {}, deprecated: false },

  // ── /api/query/performance ────────────────
  { slug: 'performance-summary', path: '/api/query/performance-summary', params: { timePeriod: 'month', growthMode: 'mom', expandDims: 'none', limit: '20' }, deprecated: false },
  { slug: 'performance-trend', path: '/api/query/performance-trend', params: { timePeriod: 'month' }, deprecated: false },
  { slug: 'performance-drilldown', path: '/api/query/performance-drilldown', params: { timePeriod: 'month', dimension: 'org' }, deprecated: false },
  { slug: 'performance-org-heatmap', path: '/api/query/performance-org-heatmap', params: { timePeriod: 'month' }, deprecated: false },
  { slug: 'performance-top-salesman', path: '/api/query/performance-top-salesman', params: { timePeriod: 'month', limit: '20' }, deprecated: false },

  // ── /api/query/bundles ────────────────────
  { slug: 'cross-sell-bundle', path: '/api/query/cross-sell-bundle', params: { vehicleCategory: 'passenger', granularity: 'monthly', timePeriod: 'monthly' }, deprecated: false },
  { slug: 'performance-bundle', path: '/api/query/performance-bundle', params: { timePeriod: 'month', growthMode: 'mom', expandDims: 'none', limit: '20' }, deprecated: false },
  { slug: 'dashboard-bundle', path: '/api/query/dashboard-bundle', params: { timeView: 'daily', perspective: 'premium', rankingLimit: '10' }, deprecated: false },

  // ── /api/query/quote-conversion ───────────
  { slug: 'quote-conversion-kpi', path: '/api/query/quote-conversion/kpi', params: {}, deprecated: false },
  { slug: 'quote-conversion-funnel', path: '/api/query/quote-conversion/funnel', params: {}, deprecated: false },
  { slug: 'quote-conversion-drilldown', path: '/api/query/quote-conversion/drilldown', params: {}, deprecated: false },
  { slug: 'quote-conversion-heatmap', path: '/api/query/quote-conversion/heatmap', params: {}, deprecated: false },
  { slug: 'quote-conversion-price', path: '/api/query/quote-conversion/price', params: {}, deprecated: false },
  { slug: 'quote-conversion-ranking', path: '/api/query/quote-conversion/ranking', params: {}, deprecated: false },
  { slug: 'quote-conversion-trend', path: '/api/query/quote-conversion/trend', params: {}, deprecated: false },

  // ── /api/query/claims-detail ──────────────
  { slug: 'claims-detail-pending-overview', path: '/api/query/claims-detail/pending-overview', params: {}, deprecated: false },
  { slug: 'claims-detail-pending-by-org', path: '/api/query/claims-detail/pending-by-org', params: {}, deprecated: false },
  { slug: 'claims-detail-pending-aging', path: '/api/query/claims-detail/pending-aging', params: {}, deprecated: false },
  { slug: 'claims-detail-cause-analysis', path: '/api/query/claims-detail/cause-analysis', params: {}, deprecated: false },
  { slug: 'claims-detail-geo-accident', path: '/api/query/claims-detail/geo-accident', params: {}, deprecated: false },
  { slug: 'claims-detail-geo-plate', path: '/api/query/claims-detail/geo-plate', params: {}, deprecated: false },
  { slug: 'claims-detail-geo-comparison', path: '/api/query/claims-detail/geo-comparison', params: {}, deprecated: false },
  { slug: 'claims-detail-claim-cycle', path: '/api/query/claims-detail/claim-cycle', params: {}, deprecated: false },
  { slug: 'claims-detail-frequency-yoy', path: '/api/query/claims-detail/frequency-yoy', params: {}, deprecated: false },
  { slug: 'claims-detail-loss-ratio-development', path: '/api/query/claims-detail/loss-ratio-development', params: {}, deprecated: false },

  // ── /api/query/expense-development ───────
  { slug: 'expense-development', path: '/api/query/expense-development', params: {}, deprecated: false },

  // ── /api/query/repair ─────────────────────
  { slug: 'repair-overview', path: '/api/query/repair/overview', params: {}, deprecated: false },
  { slug: 'repair-detail', path: '/api/query/repair/detail', params: {}, deprecated: false },
  { slug: 'repair-status', path: '/api/query/repair/status', params: {}, deprecated: false },
  { slug: 'repair-metadata', path: '/api/query/repair/metadata', params: {}, deprecated: false },

  // ── /api/query/customer-flow ──────────────
  { slug: 'customer-flow-summary', path: '/api/query/customer-flow/summary', params: {}, deprecated: false },
  { slug: 'customer-flow-inflow', path: '/api/query/customer-flow/inflow', params: {}, deprecated: false },
  { slug: 'customer-flow-outflow', path: '/api/query/customer-flow/outflow', params: {}, deprecated: false },
  { slug: 'customer-flow-trend', path: '/api/query/customer-flow/trend', params: {}, deprecated: false },
  { slug: 'customer-flow-metadata', path: '/api/query/customer-flow/metadata', params: {}, deprecated: false },

  // ── /api/query/renewal-tracker ────────────
  {
    slug: 'renewal-tracker',
    path: '/api/query/renewal-tracker',
    params: { start: '2026-01-01', end: '2026-12-31', cutoff: '2026-04-29' },
    deprecated: false,
  },

  // ── /api/filters ──────────────────────────
  { slug: 'filters-options', path: '/api/filters/options', params: {}, deprecated: false },

  // ── /api/data（GET only）─────────────────
  { slug: 'data-metadata', path: '/api/data/metadata', params: {}, deprecated: false, volatile: true }, // 含运行时元信息→非确定性
  { slug: 'data-files', path: '/api/data/files', params: {}, deprecated: false, volatile: true }, // 含 modifiedTime=本次数据装载实时戳，跨服务重启必变→非确定性
  { slug: 'data-version', path: '/api/data/version', params: {}, deprecated: false, volatile: true }, // 含 buildTime/serverStartTime 实时戳→非确定性
  { slug: 'data-kpi-plan-config', path: '/api/data/kpi-plan-config', params: {}, deprecated: false },

  // ── /api/auth（GET only）─────────────────
  { slug: 'auth-me', path: '/api/auth/me', params: {}, deprecated: false },
  // auth-users / auth-roles 已摘除（2026-07-17）：权限管理模块白名单收口为
  // 薛成龙/杨杰/林霞 三人（preset-users.ts RESTRICTED_MODULES），基线账号 admin 访问恒 403。

  // ── /api/ai（GET only）───────────────────
  { slug: 'ai-capabilities', path: '/api/ai/capabilities', params: {}, deprecated: false },
  { slug: 'ai-quick-suggestions', path: '/api/ai/quick-suggestions', params: {}, deprecated: false },
];

// ── 工具函数 ─────────────────────────────────

function computeParamHash(params) {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 12);
}

function atomicWrite(filePath, content) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

// ── 登录获取 JWT ─────────────────────────────

async function login(username, password) {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${username}: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.data?.token || body.token;
}

// ── 抓取端点数据 ──────────────────────────────

async function fetchEndpoint(path, params, token) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  ).toString();
  const url = `${SERVER_URL}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  const body = await res.json();
  // 存储整个响应体（data 字段或完整 body）
  return body.data !== undefined ? body.data : body;
}

// ── 参数解析 ─────────────────────────────────

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { mode: 'build', help: false };
  for (const token of argv) {
    switch (token) {
      case '--build': parsed.mode = 'build'; break;
      case '--compare': parsed.mode = 'compare'; break;
      case '--dry-run': parsed.mode = 'dry-run'; break;
      case '--help': case '-h': parsed.help = true; break;
      default: throw new Error(`未知参数: ${token}`);
    }
  }
  return parsed;
}

// ── 模式：--dry-run ───────────────────────────

function runDryRun() {
  log('blue', '═══════════════════════════════════════════════════════');
  log('blue', '  黄金基线构建器 — DRY RUN（端点清单）');
  log('blue', '═══════════════════════════════════════════════════════');
  console.log('');

  const total = ENDPOINT_DEFINITIONS.length;
  const deprecated = ENDPOINT_DEFINITIONS.filter((e) => e.deprecated).length;
  const volatileCount = ENDPOINT_DEFINITIONS.filter((e) => e.volatile).length;

  log('cyan', `  总端点数: ${total}（含 ${deprecated} 个 deprecated + ${volatileCount} 个 volatile，均不纳入基线）`);
  console.log('');

  let idx = 1;
  for (const ep of ENDPOINT_DEFINITIONS) {
    const paramHash = computeParamHash(ep.params);
    const paramsStr = Object.entries(ep.params).length
      ? Object.entries(ep.params).map(([k, v]) => `${k}=${v}`).join('&')
      : '（无参数）';
    const depTag = ep.deprecated ? colors.yellow + ' [DEPRECATED]' + colors.reset
      : ep.volatile ? colors.yellow + ' [VOLATILE]' + colors.reset : '';
    console.log(
      `  ${String(idx).padStart(3)}. slug=${ep.slug}  path=${ep.path}  params=${paramsStr}  hash=${paramHash}${depTag}`
    );
    idx++;
  }

  console.log('');
  log('green', `  共 ${total} 个端点（--build/--compare 仅处理 ${total - deprecated - volatileCount} 个 oracle 端点，跳过 deprecated + volatile）`);
  process.exit(0);
}

/**
 * 限流并发执行，返回与 Promise.allSettled 同构的结果数组（{status,value}|{status,reason}）。
 * 保护 DuckDB 连接池：固定 `limit` 个 worker 轮流取任务，不一次性发射全部。
 */
async function mapSettledWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// ── 模式：--build ─────────────────────────────

async function runBuild() {
  log('blue', '═══════════════════════════════════════════════════════');
  log('blue', '  黄金基线构建器 — BUILD');
  log('blue', '═══════════════════════════════════════════════════════');

  // 1. 检查 server 健康
  try {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    log('green', `  Server: ${SERVER_URL} ✓`);
  } catch {
    log('red', `  Server 不可用: ${SERVER_URL}`);
    log('yellow', '  请先启动: bun run dev:full');
    process.exit(1);
  }

  // 2. 登录获取 admin JWT
  log('yellow', '\n▶ 登录获取 admin JWT...');
  let token;
  try {
    token = await login(process.env.BASELINE_USER || 'admin', process.env.E2E_PASSWORD);
    log('green', '  ✓ admin 登录成功');
  } catch (err) {
    log('red', `  ✗ 登录失败: ${err.message}`);
    process.exit(1);
  }

  // 3. 限流抓取所有端点。跳过 deprecated（路由已删，抓取必失败）+ volatile（返回实时戳/会话态，
  //    --compare 必假阳，非 SQL/perf 重构 oracle）。两类都不纳入黄金基线。
  const buildTargets = ENDPOINT_DEFINITIONS.filter((ep) => !ep.deprecated && !ep.volatile);
  const skipped = ENDPOINT_DEFINITIONS.length - buildTargets.length;
  log('yellow', `\n▶ 抓取 ${buildTargets.length} 个端点${skipped ? `（跳过 ${skipped} 个 deprecated/volatile）` : ''}...`);
  const buildTime = new Date().toISOString();

  const fetchResults = await mapSettledWithConcurrency(
    buildTargets, FETCH_CONCURRENCY, async (ep) => {
      const paramHash = computeParamHash(ep.params);
      const data = await fetchEndpoint(ep.path, ep.params, token);

      const snapshot = {
        _meta: {
          buildTime,
          endpointSlug: ep.slug,
          params: ep.params,
          paramHash,
          deprecated: ep.deprecated,
        },
        data,
      };

      const filePath = join(BASELINE_DIR, ep.slug, `${paramHash}.json`);
      atomicWrite(filePath, JSON.stringify(snapshot, null, 2));
      return { ep, filePath, paramHash };
    }
  );

  // 4. 统计结果
  let successCount = 0;
  let failCount = 0;
  const manifestEndpoints = [];

  for (const result of fetchResults) {
    if (result.status === 'fulfilled') {
      successCount++;
      const { ep, paramHash } = result.value;
      const depTag = ep.deprecated ? colors.yellow + ' [deprecated]' + colors.reset : '';
      log('green', `  ✓ ${ep.slug}${depTag}`);
      manifestEndpoints.push({
        slug: ep.slug,
        path: ep.path,
        params: ep.params,
        paramHash,
        deprecated: ep.deprecated,
      });
    } else {
      failCount++;
      log('red', `  ✗ ${result.reason.message}`);
    }
  }

  // 5. 写入 _meta.json
  const meta = {
    buildTime,
    serverUrl: SERVER_URL,
    totalEndpoints: ENDPOINT_DEFINITIONS.length,
    successCount,
    failCount,
  };
  atomicWrite(join(BASELINE_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

  // 6. 写入 baseline-manifest.json
  const manifest = { endpoints: manifestEndpoints };
  atomicWrite(join(BASELINE_DIR, 'baseline-manifest.json'), JSON.stringify(manifest, null, 2));

  // 7. 汇总报告
  console.log('');
  log('blue', '═══════════════════════════════════════════════════════');
  log('green', `  成功: ${successCount}`);
  if (failCount > 0) log('red', `  失败: ${failCount}`);
  log('dim', `  基线目录: ${BASELINE_DIR}`);
  log('blue', '═══════════════════════════════════════════════════════');

  if (failCount > 0) {
    log('yellow', `\n  注意: ${failCount} 个端点抓取失败，基线不完整`);
    log('yellow', '  失败端点未写入 manifest，--compare 时将被跳过');
  }
}

// ── 模式：--compare ───────────────────────────

async function runCompare() {
  log('blue', '═══════════════════════════════════════════════════════');
  log('blue', '  黄金基线构建器 — COMPARE');
  log('blue', '═══════════════════════════════════════════════════════');

  // 1. 读取 manifest
  const manifestPath = join(BASELINE_DIR, 'baseline-manifest.json');
  if (!existsSync(manifestPath)) {
    log('red', `  基线不存在: ${manifestPath}`);
    log('yellow', '  请先运行: node scripts/golden-baseline.mjs --build');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  // 防旧 manifest：按当前定义剔除 deprecated + volatile（manifest 不带 volatile 标记，需回查定义）
  const excludedSlugs = new Set(
    ENDPOINT_DEFINITIONS.filter((e) => e.deprecated || e.volatile).map((e) => e.slug)
  );
  const activeEndpoints = manifest.endpoints.filter((ep) => !ep.deprecated && !excludedSlugs.has(ep.slug));

  log('cyan', `  加载基线: ${manifest.endpoints.length} 个端点（跳过 ${manifest.endpoints.length - activeEndpoints.length} 个 deprecated）`);

  // 2. 检查 server 健康
  try {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    log('green', `  Server: ${SERVER_URL} ✓`);
  } catch {
    log('red', `  Server 不可用: ${SERVER_URL}`);
    log('yellow', '  请先启动: bun run dev:full');
    process.exit(1);
  }

  // 3. 登录
  log('yellow', '\n▶ 登录获取 admin JWT...');
  let token;
  try {
    token = await login(process.env.BASELINE_USER || 'admin', process.env.E2E_PASSWORD);
    log('green', '  ✓ admin 登录成功');
  } catch (err) {
    log('red', `  ✗ 登录失败: ${err.message}`);
    process.exit(1);
  }

  // 4. 并行对比
  log('yellow', `\n▶ 比对 ${activeEndpoints.length} 个端点（D-02 严格精确匹配）...`);
  console.log('');

  const compareResults = await mapSettledWithConcurrency(
    activeEndpoints, FETCH_CONCURRENCY, async (ep) => {
      const baselinePath = join(BASELINE_DIR, ep.slug, `${ep.paramHash}.json`);
      if (!existsSync(baselinePath)) {
        throw new Error(`基线文件不存在: ${ep.slug}/${ep.paramHash}.json`);
      }

      const baselineSnapshot = JSON.parse(readFileSync(baselinePath, 'utf-8'));
      const baseline = baselineSnapshot.data;

      const current = await fetchEndpoint(ep.path, ep.params, token);

      try {
        assert.deepStrictEqual(current, baseline);
      } catch (err) {
        // 附上 slug：否则 allSettled 的 AssertionError 不含端点身份，FAIL 无法定位
        err.endpointSlug = ep.slug;
        throw err;
      }
      return { ep };
    }
  );

  // 5. 输出结果
  let passCount = 0;
  let failCount = 0;

  for (const result of compareResults) {
    if (result.status === 'fulfilled') {
      passCount++;
      log('green', `  PASS  ${result.value.ep.slug}`);
    } else {
      failCount++;
      const slug = result.reason?.endpointSlug ? `[${result.reason.endpointSlug}] ` : '';
      const errorMsg = result.reason?.message || String(result.reason);
      log('red', `  FAIL  ${slug}${errorMsg.slice(0, 120)}`);
      if (result.reason?.code === 'ERR_ASSERTION') {
        // assert.deepStrictEqual 错误，打印差异摘要
        console.error(colors.dim + '         ' + (result.reason.message || '').slice(0, 200) + colors.reset);
      }
      process.exitCode = 1;
    }
  }

  console.log('');
  log('blue', '═══════════════════════════════════════════════════════');
  log('green', `  PASS: ${passCount}`);
  if (failCount > 0) {
    log('red', `  FAIL: ${failCount}`);
    log('red', '  ✗ 回归检测到差异，请检查 SQL 修改是否引入变化');
  } else {
    log('green', `  ✓ 全部 ${passCount} 个端点通过，零差异`);
  }
  log('blue', '═══════════════════════════════════════════════════════');
}

// ── 主入口 ───────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (err) {
    log('red', `参数错误: ${err.message}`);
    log('yellow', '使用 --help 查看帮助');
    process.exit(1);
  }

  if (args.help) {
    console.log(`
用法:
  node scripts/golden-baseline.mjs             # 等同 --build
  node scripts/golden-baseline.mjs --build     # 构建黄金基线（需 dev:full 运行中）
  node scripts/golden-baseline.mjs --compare   # 与基线对比（D-02 零容忍）
  node scripts/golden-baseline.mjs --dry-run   # 列出端点清单，不访问 server
  node scripts/golden-baseline.mjs --help      # 帮助

环境变量:
  SNAPSHOT_SERVER_URL  server 地址（默认 http://localhost:3000）

输出目录:
  .planning/golden-baseline/{endpointSlug}/{paramHash}.json  端点快照
  .planning/golden-baseline/_meta.json                       构建元数据
  .planning/golden-baseline/baseline-manifest.json           端点清单
`);
    return;
  }

  switch (args.mode) {
    case 'dry-run': runDryRun(); break;
    case 'build': await runBuild(); break;
    case 'compare': await runCompare(); break;
  }
}

main().catch((err) => {
  log('red', `错误: ${err.message}`);
  process.exit(1);
});
