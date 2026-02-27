#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Math.round(sorted[index]);
}

async function login(baseUrl, username, password) {
  const url = `${baseUrl}/api/auth/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`Login failed (${response.status}): ${payload?.error?.message || payload?.error || 'unknown'}`);
  }
  return payload?.data?.token || '';
}

async function runOne(baseUrl, route, token) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const duration = performance.now() - start;
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    ok: response.ok && Boolean(body?.success),
    durationMs: Math.round(duration),
  };
}

async function benchmarkRoute({ baseUrl, route, iterations, warmup, token }) {
  for (let i = 0; i < warmup; i += 1) {
    await runOne(baseUrl, route, token);
  }

  const samples = [];
  let failures = 0;
  for (let i = 0; i < iterations; i += 1) {
    const result = await runOne(baseUrl, route, token);
    if (!result.ok) failures += 1;
    samples.push(result.durationMs);
  }

  return {
    route,
    iterations,
    failures,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    avg: Math.round(samples.reduce((sum, n) => sum + n, 0) / Math.max(samples.length, 1)),
    max: Math.max(...samples),
    min: Math.min(...samples),
    samples,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.baseUrl || process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000');
  const iterations = Number(args.iterations || process.env.BENCH_ITERATIONS || 15);
  const warmup = Number(args.warmup || process.env.BENCH_WARMUP || 2);
  const now = new Date();
  const y = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${mm}-${dd}`;
  const yearStart = `${y}-01-01`;

  let token = String(args.token || process.env.BENCH_TOKEN || '');
  const username = String(args.username || process.env.BENCH_USERNAME || '');
  const password = String(args.password || process.env.BENCH_PASSWORD || '');
  if (!token && username && password) {
    token = await login(baseUrl, username, password);
  }

  if (!token) {
    console.warn('[benchmark] 未提供 token，若接口需要认证可能全部失败。可通过 --token 或 --username/--password 传入。');
  }

  const routes = [
    `/api/query/cross-sell-summary?dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger`,
    `/api/query/cross-sell?drillPath=%5B%5D&groupBy=org_level_3&dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger`,
    `/api/query/cross-sell-trend?dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger&granularity=monthly`,
    `/api/query/cross-sell-bundle?drillPath=%5B%5D&groupBy=org_level_3&dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger&granularity=monthly&timePeriod=monthly`,
    `/api/query/performance-summary?dateField=policy_date&startDate=${yearStart}&endDate=${today}&segmentTag=all&timePeriod=month&growthMode=mom&expandDims=none`,
    `/api/query/performance-top-salesman?dateField=policy_date&startDate=${yearStart}&endDate=${today}&segmentTag=all&timePeriod=month&growthMode=mom&limit=20`,
    `/api/query/performance-bundle?drillPath=%5B%5D&groupBy=org_level_3&dateField=policy_date&startDate=${yearStart}&endDate=${today}&segmentTag=all&timePeriod=month&growthMode=mom&expandDims=none&granularity=monthly&limit=20`,
    `/api/query/dashboard-bundle?dateField=policy_date&startDate=${yearStart}&endDate=${today}&granularity=week&perspective=premium`,
  ];

  const startedAt = new Date().toISOString();
  const results = [];
  for (const route of routes) {
    console.log(`[benchmark] ${route}`);
    // eslint-disable-next-line no-await-in-loop
    const report = await benchmarkRoute({ baseUrl, route, iterations, warmup, token });
    results.push(report);
    console.log(`  -> p95=${report.p95}ms, p99=${report.p99}ms, fail=${report.failures}/${report.iterations}`);
  }

  const payload = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    iterations,
    warmup,
    results,
  };

  const outputDir = path.resolve(process.cwd(), 'artifacts/perf');
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `benchmark-key-routes-${startedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.json`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`[benchmark] report written: ${outputPath}`);
}

main().catch((err) => {
  console.error('[benchmark] failed:', err);
  process.exitCode = 1;
});
