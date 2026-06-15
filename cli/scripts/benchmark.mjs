#!/usr/bin/env node
/**
 * cx CLI 性能基准 — 四档指标 N=20 取 p50/p95，落库 cli/perf-baseline.json
 *
 * 档位：
 *   A 冷启动                 spawn cx --version
 *   B 首次远程 GET (含 TLS)  spawn cx health
 *   C 热复用 GET             同进程内 fetch /health，复用 Agent（参考下限）
 *   D 批量 100 次串行 GET    同进程内 fetch /health x100，复用 Agent
 *
 * 用法：
 *   node cli/scripts/benchmark.mjs          # 跑全部档位
 *   node cli/scripts/benchmark.mjs --write  # 覆盖 perf-baseline.json
 *   node cli/scripts/benchmark.mjs --check  # 对照 baseline，p95 退化 > 10% exit 1
 *   node cli/scripts/benchmark.mjs --base=https://other.example  # 覆盖 baseUrl
 *
 * 自净化：CI 用 --check 模式，超阈值 fail。
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = resolve(CLI_ROOT, 'perf-baseline.json');
const CLI_ENTRY = resolve(CLI_ROOT, 'src/index.ts');

const args = process.argv.slice(2);
const flags = {
  write: args.includes('--write'),
  check: args.includes('--check'),
  base:
    args.find((a) => a.startsWith('--base='))?.slice('--base='.length) ??
    process.env.CX_BENCH_BASE_URL ??
    'https://chexian.cretvalu.com',
  n: Number(args.find((a) => a.startsWith('--n='))?.slice('--n='.length) ?? 20),
  regressionPct: Number(
    args.find((a) => a.startsWith('--max-regression='))?.slice('--max-regression='.length) ?? 10,
  ),
  /** --only=A,B,E 等只跑指定档位（默认全跑） */
  only: (args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? 'A,B,C,D,E')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

const BASE_URL = flags.base.replace(/\/$/, '');
const HEALTH_URL = `${BASE_URL}/health`;

function quantile(arr, q) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function stats(samples) {
  return {
    n: samples.length,
    p50: Math.round(quantile(samples, 0.5)),
    p95: Math.round(quantile(samples, 0.95)),
    min: Math.round(Math.min(...samples)),
    max: Math.round(Math.max(...samples)),
  };
}

const COMPILED_BIN = resolve(CLI_ROOT, 'dist/cx');
const USE_COMPILED = existsSync(COMPILED_BIN);
const SPAWN_CMD = USE_COMPILED ? COMPILED_BIN : 'bun';
const SPAWN_PREFIX = USE_COMPILED ? [] : ['src/index.ts'];

function spawnOnce(args) {
  return new Promise((resolveP, reject) => {
    const start = performance.now();
    const proc = spawn(SPAWN_CMD, [...SPAWN_PREFIX, ...args], {
      cwd: CLI_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const elapsed = performance.now() - start;
      if (code !== 0) {
        reject(new Error(`cx ${args.join(' ')} exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolveP(elapsed);
    });
  });
}

async function benchSpawn(label, args, n) {
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    try {
      samples.push(await spawnOnce(args));
    } catch (err) {
      console.error(`[${label}] iter ${i} failed:`, err.message);
      throw err;
    }
  }
  return stats(samples);
}

async function benchInProcessReuse(n) {
  // 模拟最佳情况：keep-alive + 全局 Agent（Node 原生 fetch 不复用，这里只能近似）。
  const samples = [];
  // 预热一次拿到 TLS session
  await fetch(HEALTH_URL).then((r) => r.text());
  for (let i = 0; i < n; i += 1) {
    const start = performance.now();
    const res = await fetch(HEALTH_URL);
    await res.text();
    samples.push(performance.now() - start);
  }
  return stats(samples);
}

async function benchBatch100() {
  const start = performance.now();
  for (let i = 0; i < 100; i += 1) {
    const res = await fetch(HEALTH_URL);
    await res.text();
  }
  const total = performance.now() - start;
  return { total_ms: Math.round(total), avg_ms: Math.round(total / 100) };
}

/**
 * E 档：模拟 cx batch 的网络层（启用 undici keep-alive dispatcher，concurrency=8）。
 * 与 D 档同样调用 100 次 /health，对照看 dispatcher 收益。
 */
async function benchBatch100WithDispatcher(concurrency = 8) {
  let undici;
  try {
    undici = await import('undici');
  } catch {
    return { skipped: true, reason: 'undici not installed (run: cd cli && bun add undici)' };
  }
  const agent = new undici.Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    pipelining: 10,
    allowH2: true,
    connections: 16,
  });
  undici.setGlobalDispatcher(agent);

  const start = performance.now();
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= 100) return;
      const res = await fetch(HEALTH_URL);
      await res.text();
    }
  });
  await Promise.all(workers);
  const total = performance.now() - start;
  await agent.close();
  return { total_ms: Math.round(total), avg_ms: Math.round(total / 100), concurrency };
}

async function getRuntimeVersions() {
  let bunVer = 'n/a';
  try {
    const { execSync } = await import('node:child_process');
    bunVer = execSync('bun --version').toString().trim();
  } catch {}
  return { node: process.version, bun: bunVer };
}

async function main() {
  console.error(`[bench] baseUrl=${BASE_URL} N=${flags.n} mode=${USE_COMPILED ? 'compiled-bin' : 'bun-src'}`);
  const versions = await getRuntimeVersions();

  const wants = (label) => flags.only.includes(label);
  const SKIPPED = { skipped: true };

  let A = SKIPPED;
  if (wants('A')) {
    console.error('[bench] A 冷启动 cx --version ...');
    A = await benchSpawn('A', ['--version'], flags.n);
  }

  let B = SKIPPED;
  if (wants('B')) {
    console.error('[bench] B 首次远程 cx health ...');
    B = await benchSpawn('B', ['health', '-q'], flags.n);
  }

  let C = SKIPPED;
  if (wants('C')) {
    console.error('[bench] C 热复用 fetch /health（同进程 N 次） ...');
    C = await benchInProcessReuse(flags.n);
  }

  let D = SKIPPED;
  if (wants('D')) {
    console.error('[bench] D 批量 100 次串行（无 dispatcher） ...');
    D = await benchBatch100();
  }

  let E = SKIPPED;
  if (wants('E')) {
    console.error('[bench] E 批量 100 次（undici keep-alive + HTTP/2 + 并发 8） ...');
    E = await benchBatch100WithDispatcher(8);
  }

  const result = {
    version: 1,
    measured_at: new Date().toISOString(),
    base_url: BASE_URL,
    runtime: versions,
    mode: USE_COMPILED ? 'compiled-bin' : 'bun-src',
    samples: flags.n,
    metrics: {
      A_cold_start_ms: A,
      B_first_remote_ms: B,
      C_warm_reuse_ms: C,
      D_batch_100: D,
      E_batch_100_keepalive: E,
    },
    targets: {
      A_cold_start_p95_ms: 50,
      B_first_remote_p95_ms: 150,
      C_warm_reuse_p95_ms: 50,
      D_batch_100_total_ms: 1500,
      E_batch_100_keepalive_total_ms: 1500,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (flags.write) {
    writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2) + '\n');
    console.error(`[bench] wrote ${BASELINE_PATH}`);
  }

  if (flags.check) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(`[bench] --check 失败：${BASELINE_PATH} 不存在，先 --write 落基线`);
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const pairs = [
      ['A_cold_start_ms', 'p95'],
      ['B_first_remote_ms', 'p95'],
      ['C_warm_reuse_ms', 'p95'],
    ];
    const regressions = [];
    for (const [key, field] of pairs) {
      const cur = result.metrics[key][field];
      const base = baseline.metrics?.[key]?.[field];
      if (typeof base !== 'number') continue;
      const pct = ((cur - base) / base) * 100;
      if (pct > flags.regressionPct) {
        regressions.push({ metric: `${key}.${field}`, baseline: base, current: cur, pct });
      }
    }
    const dCur = result.metrics.D_batch_100.total_ms;
    const dBase = baseline.metrics?.D_batch_100?.total_ms;
    if (typeof dBase === 'number') {
      const pct = ((dCur - dBase) / dBase) * 100;
      if (pct > flags.regressionPct) {
        regressions.push({ metric: 'D_batch_100.total_ms', baseline: dBase, current: dCur, pct });
      }
    }
    if (regressions.length > 0) {
      console.error('[bench] ❌ 性能退化超阈值：');
      for (const r of regressions) {
        console.error(
          `  - ${r.metric}: ${r.baseline}ms → ${r.current}ms (${r.pct.toFixed(1)}%, 阈值 ${flags.regressionPct}%)`,
        );
      }
      process.exit(1);
    }
    console.error('[bench] ✅ 全部档位在阈值内');
  }
}

main().catch((err) => {
  console.error('[bench] 失败:', err);
  process.exit(1);
});
