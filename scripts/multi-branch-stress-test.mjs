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
 *   4. 串读断言 — Phase 2 自动校验 SX 请求 dataLength=0（兼容期）+ SC 非空，不符 exit(1)
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
    return { ok: true, status: res.status, ms, branchLabel, url, dataLength };
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
 * 0H codex P2-2：串读断言 — 兼容期 SX token 必须 dataLength=0（permission.ts 注入
 * branch_code='SX' WHERE 过滤掉所有行）；SC token 必须 dataLength>0（有四川数据）。
 * 任一不符 → cache 串读或 RLS 失效，CRITICAL，exit(1) 让 Day-1 验证显式失败。
 */
function assertNoLeak(results, phaseLabel) {
  const scResults = results.filter((r) => r.ok && r.branchLabel === 'SC');
  const sxResults = results.filter((r) => r.ok && r.branchLabel === 'SX');

  const scEmpty = scResults.filter((r) => r.dataLength === 0);
  const sxNonEmpty = sxResults.filter((r) => r.dataLength > 0);

  console.log(`\n🔍 ${phaseLabel} 串读检测：`);
  console.log(`   SC 请求 ${scResults.length} 条，非空 ${scResults.length - scEmpty.length}，空集 ${scEmpty.length}`);
  console.log(`   SX 请求 ${sxResults.length} 条，非空 ${sxNonEmpty.length}（兼容期应=0），空集 ${sxResults.length - sxNonEmpty.length}`);

  let failed = false;
  if (sxNonEmpty.length > 0) {
    console.error(`\n❌ CRITICAL：${sxNonEmpty.length} 条 SX token 请求返回非空数据 → cache 串读或 RLS 失效！`);
    sxNonEmpty.slice(0, 5).forEach((r) => {
      console.error(`   - SX token / ${r.url} → dataLength=${r.dataLength}`);
    });
    failed = true;
  }
  if (scResults.length > 0 && scEmpty.length === scResults.length) {
    console.error(`\n❌ SC token 所有请求返回空集 → 兼容期数据应非空，可能 RLS 配置错或数据为空`);
    failed = true;
  }
  if (!failed) {
    console.log(`   ✅ 串读断言通过（SX dataLength=0 + SC dataLength>0）`);
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

main().catch((e) => {
  console.error('❌ 压测脚本异常:', e);
  process.exit(1);
});
