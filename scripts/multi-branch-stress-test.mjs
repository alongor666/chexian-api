#!/usr/bin/env node
/**
 * 多分公司模拟压测（plan v2 Phase 0H）
 *
 * 用途：在没有真实山西（SX）数据的兼容期，模拟双 branch admin 并发请求，
 *      验证 cache key 按 branch 隔离 + 基线 RSS / 响应时间，为山西上线前
 *      VPS 扩容决策（8GB / 12GB / 双实例）提供数据支撑。
 *
 * 验证目标（plan v2 §0H）：
 *   1. cache key 隔离 — SC vs SX 双 token 同 query 命中各自 cache（PR #501 / #507）
 *   2. permissionFilter 注入 — flag on 后 SX token 请求 SQL where 含 branch_code='SX'
 *   3. 基线性能 — N 并发用户下 RSS 峰值 / DuckDB heap peak / 平均响应时间
 *   4. 串读断言 — Phase 2 自动校验 SX 请求无真实业务数据（realDataCount=0，兼容期）+ SC 有数据，不符 exit(1)
 *      （realDataCount 按"含正数业务度量的行"判定，非数组长度 — 聚合路由零行仍返回 1 行全零）
 *
 * 限制：
 *   - 本会话无真实 SX 数据（数据全部 branch_code='SC'），SX token 请求会返回空集
 *     （permission.ts 注入 branch_code='SX' WHERE 过滤掉所有行）。这是预期的 —
 *     脚本验证的是 cache 隔离 + permissionFilter 行为，不验证业务数据。
 *   - VPS 扩容决策需在生产环境跑真实 SC + SX 1 周样本，本脚本是开发环境基线。
 *
 * 用法：
 *   bun run scripts/multi-branch-stress-test.mjs                  # 默认 admin only 基线
 *   bun run scripts/multi-branch-stress-test.mjs --simulate-sx    # 加 SX token 模拟（需 BRANCH_RLS_ENABLED=true）
 *   bun run scripts/multi-branch-stress-test.mjs --concurrency 20 # 调并发数
 *
 * 配套文档：.claude/rules/multi-branch-day1-sop.md
 */

import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const simulateSx = args.includes('--simulate-sx');
const concIdx = args.indexOf('--concurrency');
const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 10;
const baseUrl = process.env.STRESS_BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * 0H codex P2-1：node:crypto 原生 HS256 JWT 签发，避免依赖根目录未声明的 jsonwebtoken
 * （它仅在 server/node_modules 下，根目录跑会 Cannot find package 报错）。
 * 与 server/src/services/cache-warmer.ts:signServiceToken 严格对齐（payload 字段 +
 * algorithm HS256 + 15min TTL）。
 */
function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signServiceToken(jwtSecret, branchCode) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId: 'admin',
    username: 'admin',
    role: 'branch_admin',
    iat: now,
    exp: now + 15 * 60, // 15 分钟 TTL，与 cache-warmer 一致
  };
  if (branchCode) {
    payload.branchCode = branchCode;
  }
  const headerSeg = base64UrlEncode(JSON.stringify(header));
  const payloadSeg = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = base64UrlEncode(createHmac('sha256', jwtSecret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('❌ 缺少 JWT_SECRET 环境变量（ecosystem.config.cjs 同款）');
    console.error('   用法: JWT_SECRET=<secret> bun run scripts/multi-branch-stress-test.mjs');
    process.exit(1);
  }
  return secret;
}

/**
 * 串读判定修复（2026-06-24）：聚合路由（KPI / comprehensive…）即便被 RLS 过滤到零行，
 * SUM/COUNT 仍返回 1 行（业务度量全零/全空）。旧断言用「data 数组长度 > 0」判「有数据」，
 * 把这「1 行全零」误判为串读 CRITICAL（假阳性）。正确口径：一行算「有真实业务数据」
 * 当且仅当其某个记录量/保费度量为正数。
 *
 * ⚠️ 计划/目标/比率字段不作为信号 —— 计划维度尚未省份化（dim 仍 SC-only），SX token
 *    也会看到 SC 的计划值（如 vehicle_plan_wan），那不是 SC 业务数据泄漏（已登记 follow-up）。
 */
const REAL_DATA_MEASURE_FIELDS = [
  'policy_count', 'count', 'org_count', 'salesman_count',
  'total_premium', 'signed_premium', 'matured_premium',
  'vehicle_premium', 'driver_premium', 'premium',
  'reported_claims', 'claim_cases',
];

/**
 * 返回一行中「真实业务数据」信号（度量字段为正数）。空数组 = 该行无真实数据。
 * @param {unknown} row
 * @returns {{field: string, value: number}[]}
 */
export function realDataSignals(row) {
  if (row == null) return [];
  if (typeof row !== 'object') return [{ field: '(value)', value: 1 }]; // 原始值列表项 = 一条数据
  const signals = [];
  for (const f of REAL_DATA_MEASURE_FIELDS) {
    const v = row[f];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) signals.push({ field: f, value: v });
  }
  // 行内无任何已知度量字段（未知形状）→ 保守判为「有数据」，宁可误报不漏真串读
  if (signals.length === 0 && !REAL_DATA_MEASURE_FIELDS.some((f) => f in row) && Object.keys(row).length > 0) {
    signals.push({ field: '(unknown-shape)', value: 1 });
  }
  return signals;
}

/**
 * 统计响应体中「含真实业务数据」的行数 + 前 3 行信号样本（诊断用）。
 * 列表路由 = 有信号的行数；聚合单行路由 = 0 或 1。
 * @param {any} body
 * @returns {{count: number, sample: {field: string, value: number}[][]}}
 */
export function countRealDataRows(body) {
  const data = body?.data;
  const rows = Array.isArray(data) ? data : data != null ? [data] : [];
  let count = 0;
  const sample = [];
  for (const row of rows) {
    const sig = realDataSignals(row);
    if (sig.length > 0) {
      count++;
      if (sample.length < 3) sample.push(sig);
    }
  }
  return { count, sample };
}

const ROUTES = [
  '/api/query/kpi?dateField=policy_date&startDate=2026-01-01&endDate=2026-05-11',
  '/api/query/trend?dateField=policy_date&startDate=2026-01-01&endDate=2026-05-11&granularity=day&perspective=premium',
  '/api/query/cross-sell?dateField=policy_date&startDate=2026-01-01&endDate=2026-05-11',
];

async function runOne(token, url, branchLabel) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}${url}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      return { ok: false, status: res.status, ms, branchLabel, url };
    }
    const body = await res.json();
    const dataLength = Array.isArray(body?.data) ? body.data.length : body?.data ? 1 : 0;
    const { count: realDataCount, sample: realDataSample } = countRealDataRows(body);
    return { ok: true, status: res.status, ms, branchLabel, url, dataLength, realDataCount, realDataSample };
  } catch (e) {
    return { ok: false, status: 'ERR', ms: Date.now() - start, branchLabel, url, error: String(e?.message ?? e) };
  }
}

/**
 * 0H codex P2-2：runBatch 返回 results 数组（不止汇总），调用方可以做逐请求断言
 * （Phase 2 串读检测用）。
 */
async function runBatch(tasks, label) {
  console.log(`\n📊 ${label} — ${tasks.length} 任务 / 并发 ${concurrency}`);
  const startRss = process.memoryUsage().rss;
  const startTime = Date.now();
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const r = await tasks[i]();
      results.push(r);
    }
  });
  await Promise.all(workers);
  const durationMs = Date.now() - startTime;
  const endRss = process.memoryUsage().rss;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const avgMs = ok.length > 0 ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : 0;
  const p95Ms = ok.length > 0 ? ok.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length * 0.95)] : 0;

  console.log(`   ✅ 成功 ${ok.length} / 失败 ${failed.length} / 总耗时 ${durationMs}ms / avg ${avgMs}ms / p95 ${p95Ms}ms`);
  console.log(`   RSS: ${(startRss / 1024 / 1024).toFixed(0)}MB → ${(endRss / 1024 / 1024).toFixed(0)}MB (Δ ${((endRss - startRss) / 1024 / 1024).toFixed(0)}MB)`);

  if (failed.length > 0) {
    console.log(`   失败详情（前 5 条）:`);
    failed.slice(0, 5).forEach((f) => {
      console.log(`     - [${f.branchLabel}] ${f.url} → HTTP ${f.status} ${f.ms}ms ${f.error ?? ''}`);
    });
  }

  return { ok: ok.length, failed: failed.length, avgMs, p95Ms, durationMs, rssMbDelta: (endRss - startRss) / 1024 / 1024, results };
}

/**
 * 0H codex P2-2 串读断言 + 2026-06-24 假阳性修复：兼容期 SX token 必须「无真实业务数据」
 * （permission.ts 注入 branch_code='SX' WHERE 过滤掉所有 SC 行）；SC token 必须有真实数据。
 *
 * 判据用 realDataCount（含正数业务度量的行数）而非 data 数组长度 —— 聚合路由（KPI 等）
 * 被过滤到零行后仍返回 1 行全零，数组长度=1 但 realDataCount=0，那不是串读。
 * 任一不符 → cache 串读或 RLS 失效，CRITICAL，exit(1) 让 Day-1 验证显式失败。
 */
function assertNoLeak(results, phaseLabel) {
  const scResults = results.filter((r) => r.ok && r.branchLabel === 'SC');
  const sxResults = results.filter((r) => r.ok && r.branchLabel === 'SX');

  const scEmpty = scResults.filter((r) => (r.realDataCount ?? 0) === 0);
  const sxLeaked = sxResults.filter((r) => (r.realDataCount ?? 0) > 0);

  console.log(`\n🔍 ${phaseLabel} 串读检测（按真实业务数据行，非数组长度）：`);
  console.log(`   SC 请求 ${scResults.length} 条，有数据 ${scResults.length - scEmpty.length}，空 ${scEmpty.length}`);
  console.log(`   SX 请求 ${sxResults.length} 条，泄漏 ${sxLeaked.length}（兼容期应=0），空 ${sxResults.length - sxLeaked.length}`);

  let failed = false;
  if (sxLeaked.length > 0) {
    console.error(`\n❌ CRITICAL：${sxLeaked.length} 条 SX token 请求返回真实 SC 业务数据 → cache 串读或 RLS 失效！`);
    sxLeaked.slice(0, 5).forEach((r) => {
      const sig = (r.realDataSample?.[0] ?? []).map((s) => `${s.field}=${s.value}`).join(', ');
      console.error(`   - SX token / ${r.url} → realDataCount=${r.realDataCount}（泄漏度量: ${sig || '未知形状'}）`);
    });
    failed = true;
  }
  if (scResults.length > 0 && scEmpty.length === scResults.length) {
    console.error(`\n❌ SC token 所有请求无真实数据 → 兼容期 SC 应非空，可能 RLS 配置错或数据为空`);
    failed = true;
  }
  if (!failed) {
    console.log(`   ✅ 串读断言通过（SX 真实数据行=0 + SC 真实数据行>0）`);
  }
  return !failed;
}

async function main() {
  const jwtSecret = getJwtSecret();
  console.log(`🎯 多分公司模拟压测 — baseUrl=${baseUrl}`);

  const scToken = signServiceToken(jwtSecret, 'SC');
  const allBranches = simulateSx ? ['SC', 'SX'] : ['SC'];
  const tokens = Object.fromEntries(allBranches.map((b) => [b, signServiceToken(jwtSecret, b)]));

  // Phase 1: 单 branch 基线（SC × N 并发）
  const phase1Tasks = [];
  for (let i = 0; i < concurrency * 2; i++) {
    const url = ROUTES[i % ROUTES.length];
    phase1Tasks.push(() => runOne(scToken, url, 'SC'));
  }
  const phase1 = await runBatch(phase1Tasks, 'Phase 1: SC 单 branch 基线');

  // Phase 2: 双 branch 交错（SC + SX 模拟，验证 cache 隔离 + 串读断言）
  let phase2LeakOk = true;
  if (simulateSx) {
    const phase2Tasks = [];
    for (let i = 0; i < concurrency * 2; i++) {
      const url = ROUTES[i % ROUTES.length];
      const branch = i % 2 === 0 ? 'SC' : 'SX';
      phase2Tasks.push(() => runOne(tokens[branch], url, branch));
    }
    const phase2 = await runBatch(phase2Tasks, 'Phase 2: SC + SX 双 branch 交错（验证 cache 隔离）');
    // 0H codex P2-2：逐请求断言串读
    phase2LeakOk = assertNoLeak(phase2.results, 'Phase 2');
  }

  // Phase 3: cache 命中验证（重复 Phase 1 任务，所有请求应 < 10ms）
  const phase3Tasks = [];
  for (let i = 0; i < concurrency; i++) {
    const url = ROUTES[i % ROUTES.length];
    phase3Tasks.push(() => runOne(scToken, url, 'SC'));
  }
  const phase3 = await runBatch(phase3Tasks, 'Phase 3: cache 命中验证（重复 Phase 1）');

  if (phase3.avgMs > phase1.avgMs * 0.5) {
    console.log(`\n⚠️  cache 命中率可能偏低：Phase 3 avg ${phase3.avgMs}ms > Phase 1 avg ${phase1.avgMs}ms × 0.5`);
  } else {
    console.log(`\n✅ cache 工作正常：Phase 3 avg ${phase3.avgMs}ms ≪ Phase 1 avg ${phase1.avgMs}ms`);
  }

  console.log(`\n📋 总结`);
  console.log(`   Phase 1 (SC 基线): avg=${phase1.avgMs}ms p95=${phase1.p95Ms}ms`);
  if (simulateSx) console.log(`   Phase 2 (SC+SX 交错 + 串读断言): ${phase2LeakOk ? '✅' : '❌ FAILED'}`);
  console.log(`   Phase 3 (cache 命中): avg=${phase3.avgMs}ms p95=${phase3.p95Ms}ms`);
  console.log(`\n🎯 VPS 扩容建议：将本脚本在生产 VPS 跑真实 SC+SX 各 1 周样本后再决定（8GB / 12GB / 双实例）`);

  // 0H codex P2-2：串读断言失败时 exit(1) 让 Day-1 验证显式失败
  if (!phase2LeakOk) {
    console.error(`\n❌ 退出码 1：Phase 2 串读断言失败（见上方 CRITICAL 详情）`);
    process.exit(1);
  }
}

// 仅直接执行时跑 main()；被 import（单测）时不触发副作用
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error('❌ 压测脚本异常:', e);
    process.exit(1);
  });
}
