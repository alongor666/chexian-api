#!/usr/bin/env node
/**
 * cube-burnin.mjs — 立方体灰度 burn-in 流量生成器
 *
 * 生成边界 WHERE 组合请求，读取 /health cubeShadow delta，
 * 判定立方体计算正确性。
 *
 * 用法：
 *   node scripts/cube-burnin.mjs --base http://localhost:3000 --tier basic
 *   node scripts/cube-burnin.mjs --tier org --min-match 500 --concurrency 4
 *   node scripts/cube-burnin.mjs --dry-run --tier cross
 *
 * 退出码：FAIL=1，其他（PASS / WARN / INSUFFICIENT）=0
 */

import { buildWhereMatrix, TIER_BASIC, TIER_ORG, TIER_CROSS } from './cube-burnin/lib/where-matrix.mjs';
import { runFlight } from './cube-burnin/lib/route-runner.mjs';
import { snapshotShadow, computeDelta, judge } from './cube-burnin/lib/shadow-judge.mjs';

// ─── 参数解析 ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
立方体灰度 burn-in 流量生成器

用法：
  node scripts/cube-burnin.mjs [选项]

选项：
  --base <url>       服务基地址（默认：http://localhost:3000）
  --tier <tier>      矩阵层级：basic（99）| org（297）| cross（≈3564）
                     默认：basic
  --min-match <n>    每路由最低期望 match 增量（默认：1000）
  --concurrency <n>  并发请求数（默认：8）
  --dry-run          仅打印计划，不发请求
  --help             显示帮助

判定规则：
  FAIL         任一路由 mismatch_delta > 0（立方体算错）→ exit 1
  WARN         任一路由 error_delta > 0（执行异常）
  INSUFFICIENT 任一路由 match_delta < min-match（流量不足，提示延长）
  PASS         全部路由满足条件

示例：
  node scripts/cube-burnin.mjs --dry-run --tier basic
  node scripts/cube-burnin.mjs --base http://localhost:3000 --tier org --min-match 500
`.trim());
}

// ─── /health 取数 ────────────────────────────────────────────────

async function fetchHealth(baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`/health 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  const baseUrl     = String(args.base  || 'http://localhost:3000');
  const tier        = String(args.tier  || TIER_BASIC);
  const minMatch    = Number(args['min-match']  || 1000);
  const concurrency = Number(args.concurrency   || 8);
  const dryRun      = args['dry-run'] === true || args['dry-run'] === 'true';

  const validTiers = [TIER_BASIC, TIER_ORG, TIER_CROSS];
  if (!validTiers.includes(tier)) {
    console.error(`[cube-burnin] 错误：未知 tier="${tier}"，合法值：${validTiers.join(' | ')}`);
    process.exit(1);
  }

  const matrix = buildWhereMatrix(tier);

  console.log(`[cube-burnin] base=${baseUrl} tier=${tier} matrix=${matrix.length} minMatch=${minMatch} concurrency=${concurrency} dryRun=${dryRun}`);

  if (dryRun) {
    await runFlight({ baseUrl, tier, concurrency, dryRun: true, matrix });
    process.exit(0);
  }

  // 1. baseline
  console.log('[cube-burnin] 读取 /health baseline…');
  let beforeHealth;
  try {
    beforeHealth = await fetchHealth(baseUrl);
  } catch (err) {
    console.error(`[cube-burnin] 无法取 /health baseline：${err.message}`);
    process.exit(1);
  }
  const before = snapshotShadow(beforeHealth);

  // 2. 发流量（含预热）
  await runFlight({ baseUrl, tier, concurrency, dryRun: false, matrix });

  // 3. after
  console.log('[cube-burnin] 读取 /health after…');
  let afterHealth;
  try {
    afterHealth = await fetchHealth(baseUrl);
  } catch (err) {
    console.error(`[cube-burnin] 无法取 /health after：${err.message}`);
    process.exit(1);
  }
  const after = snapshotShadow(afterHealth);

  // 4. delta + 判定
  const delta = computeDelta(before, after);

  // 检查负 delta（after < before，属于异常）
  for (const [key, d] of Object.entries(delta)) {
    if (d.match < 0 || d.mismatch < 0 || d.error < 0) {
      console.warn(`[cube-burnin] 警告：${key} 出现负 delta（before/after 可能不属于同一计数器周期）`);
    }
  }

  const { verdict, perRoute, summary } = judge(delta, { minMatch });

  // 5. 结构化报告
  console.log('\n══════ cube-burnin 报告 ══════');
  console.log(summary);
  console.log('══════════════════════════════\n');

  if (verdict === 'INSUFFICIENT') {
    console.log(`[cube-burnin] 提示：match 增量不足 ${minMatch}，可延长 --min-match 或换更大 tier`);
  }

  // FAIL → exit 1，其他 → exit 0
  if (verdict === 'FAIL') {
    console.error('[cube-burnin] 结果：FAIL — 立方体计算结果与 SQL 不一致，禁止推进切流');
    process.exitCode = 1;
  } else {
    console.log(`[cube-burnin] 结果：${verdict}`);
  }
}

main().catch(err => {
  console.error(`[cube-burnin] 致命错误：${err.stack || err.message}`);
  process.exitCode = 1;
});
