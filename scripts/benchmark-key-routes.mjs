#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

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

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Math.round(sorted[index]);
}

function summarize(values) {
  if (values.length === 0) {
    return {
      p50: null,
      p95: null,
      p99: null,
      avg: null,
      max: null,
      min: null,
    };
  }

  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    avg: Math.round(values.reduce((sum, n) => sum + n, 0) / values.length),
    max: Math.max(...values),
    min: Math.min(...values),
  };
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function routeKey(route) {
  return route.split('?')[0] || route;
}

function readJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRetryAfterMs(response, body, fallbackMs) {
  const header = response.headers.get('retry-after');
  if (header) {
    const asSeconds = Number(header);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.max(asSeconds * 1000, 1000);
    }
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      return Math.max(asDate - Date.now(), 1000);
    }
  }

  if (body && typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter)) {
    return Math.max(body.retryAfter * 1000, 1000);
  }

  return fallbackMs;
}

function pickErrorMessage(body, status) {
  if (!body) return `HTTP ${status}`;
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  if (typeof body.message === 'string') return body.message;
  return `HTTP ${status}`;
}

function isBusinessSuccess(response, body) {
  if (!response.ok) return false;
  if (!body || typeof body !== 'object') return false;
  if ('success' in body) return Boolean(body.success);
  return true;
}

async function login(baseUrl, username, password) {
  const url = `${baseUrl}/api/auth/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = readJsonSafe(await response.text());
  if (!response.ok || !payload?.success) {
    throw new Error(`Login failed (${response.status}): ${pickErrorMessage(payload, response.status)}`);
  }
  return payload?.data?.token || '';
}

async function runOne(baseUrl, route, token, fallbackRetryAfterMs) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const duration = performance.now() - start;
  const text = await response.text();
  const body = readJsonSafe(text);
  const ok = isBusinessSuccess(response, body);

  return {
    status: response.status,
    ok,
    durationMs: Math.round(duration),
    error: ok ? null : pickErrorMessage(body, response.status),
    retryAfterMs: response.status === 429
      ? parseRetryAfterMs(response, body, fallbackRetryAfterMs)
      : null,
  };
}

async function benchmarkRoute({
  baseUrl,
  route,
  iterations,
  warmup,
  token,
  paceMs,
  max429Retries,
  retryAfterMs,
}) {
  const statusCounts = {};
  const errorCounts = {};

  const runWith429Retry = async () => {
    let retries = 0;
    while (true) {
      const result = await runOne(baseUrl, route, token, retryAfterMs);
      if (result.status === 429 && retries < max429Retries) {
        retries += 1;
        await sleep(result.retryAfterMs || retryAfterMs);
        continue;
      }
      return { result, retried429: retries };
    }
  };

  for (let i = 0; i < warmup; i += 1) {
    await runWith429Retry();
    if (paceMs > 0 && i < warmup - 1) {
      await sleep(paceMs);
    }
  }

  const samplesAll = [];
  const samplesSuccess = [];
  let failures = 0;
  let retries429 = 0;

  for (let i = 0; i < iterations; i += 1) {
    const { result, retried429 } = await runWith429Retry();
    retries429 += retried429;

    samplesAll.push(result.durationMs);
    statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;

    if (result.ok) {
      samplesSuccess.push(result.durationMs);
    } else {
      failures += 1;
      const key = `${result.status} ${result.error || 'unknown error'}`;
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    }

    if (paceMs > 0 && i < iterations - 1) {
      await sleep(paceMs);
    }
  }

  const statsSuccess = summarize(samplesSuccess);
  const statsAll = summarize(samplesAll);

  return {
    route,
    routeKey: routeKey(route),
    iterations,
    warmup,
    retries429,
    failures,
    successes: samplesSuccess.length,
    statusCounts,
    errorCounts,
    p50: statsSuccess.p50,
    p95: statsSuccess.p95,
    p99: statsSuccess.p99,
    avg: statsSuccess.avg,
    max: statsSuccess.max,
    min: statsSuccess.min,
    p50All: statsAll.p50,
    p95All: statsAll.p95,
    p99All: statsAll.p99,
    avgAll: statsAll.avg,
    maxAll: statsAll.max,
    minAll: statsAll.min,
    samples: samplesSuccess,
    samplesAll,
  };
}

function parseAuditLine(line) {
  const parsed = readJsonSafe(line.trim());
  if (!parsed || typeof parsed !== 'object') return null;
  const method = String(parsed.method || '').toUpperCase();
  const rawPath = String(parsed.path || '');
  const status = Number(parsed.status);
  const duration = Number(
    parsed.total_time_ms
    ?? parsed.totalTimeMs
    ?? parsed.duration
    ?? parsed.duration_ms
    ?? NaN
  );
  const timestamp = String(parsed.timestamp || '');

  if (!method || !rawPath || !Number.isFinite(status) || !Number.isFinite(duration) || !timestamp) {
    return null;
  }

  return {
    method,
    routeKey: routeKey(rawPath),
    status,
    duration: Math.max(0, Math.round(duration)),
    timestamp,
  };
}

function collectBaselineFromAuditLog({ logPath, routeKeys, baselineDate }) {
  if (!logPath || !fs.existsSync(logPath)) {
    return {
      source: logPath,
      baselineDate,
      found: false,
      routes: {},
    };
  }

  const routeSet = new Set(routeKeys);
  const bucket = new Map();

  const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    const record = parseAuditLine(line);
    if (!record) continue;
    if (record.method !== 'GET') continue;
    if (!routeSet.has(record.routeKey)) continue;
    if (baselineDate && !record.timestamp.startsWith(`${baselineDate}T`)) continue;
    if (record.status < 200 || record.status >= 300) continue;

    const arr = bucket.get(record.routeKey) || [];
    arr.push(record.duration);
    bucket.set(record.routeKey, arr);
  }

  const routes = {};
  for (const key of routeKeys) {
    const samples = bucket.get(key) || [];
    const stats = summarize(samples);
    routes[key] = {
      count: samples.length,
      p50: stats.p50,
      p95: stats.p95,
      p99: stats.p99,
      avg: stats.avg,
      max: stats.max,
      min: stats.min,
    };
  }

  return {
    source: logPath,
    baselineDate,
    found: true,
    routes,
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function buildComparisons(results, baselineRoutes) {
  return results.map((result) => {
    const baseline = baselineRoutes?.[result.routeKey] || null;
    let p95ImprovementPct = null;
    if (baseline?.p95 !== null && baseline?.p95 !== undefined && result.p95 !== null && result.p95 !== undefined && baseline.p95 > 0) {
      p95ImprovementPct = round2(((baseline.p95 - result.p95) / baseline.p95) * 100);
    }

    return {
      route: result.route,
      routeKey: result.routeKey,
      baselineP95: baseline?.p95 ?? null,
      currentP95: result.p95,
      currentP95All: result.p95All,
      p95ImprovementPct,
      baselineCount: baseline?.count ?? 0,
      failures: result.failures,
      successes: result.successes,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.baseUrl || process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000');
  const iterations = asNumber(args.iterations || process.env.BENCH_ITERATIONS, 15);
  const warmup = asNumber(args.warmup || process.env.BENCH_WARMUP, 2);
  const paceMs = asNumber(args.paceMs || process.env.BENCH_PACE_MS, 0);
  const max429Retries = asNumber(args.max429Retries || process.env.BENCH_MAX_429_RETRIES, 1);
  const retryAfterMs = asNumber(args.retryAfterMs || process.env.BENCH_RETRY_AFTER_MS, 60_000);
  const routeCooldownMs = asNumber(args.routeCooldownMs || process.env.BENCH_ROUTE_COOLDOWN_MS, 0);

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
    console.warn('[benchmark] 未提供 token，若接口需要认证可能失败。可通过 --token 或 --username/--password 传入。');
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
  for (const [idx, route] of routes.entries()) {
    console.log(`[benchmark] (${idx + 1}/${routes.length}) ${route}`);
    // eslint-disable-next-line no-await-in-loop
    const report = await benchmarkRoute({
      baseUrl,
      route,
      iterations,
      warmup,
      token,
      paceMs,
      max429Retries,
      retryAfterMs,
    });
    results.push(report);

    const p95Label = report.p95 === null ? 'n/a' : `${report.p95}ms`;
    console.log(
      `  -> p95=${p95Label}, p95All=${report.p95All}ms, fail=${report.failures}/${report.iterations}, status=${JSON.stringify(report.statusCounts)}`
    );

    if (routeCooldownMs > 0 && idx < routes.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(routeCooldownMs);
    }
  }

  const baselineLog = String(args.baselineLog || process.env.BENCH_BASELINE_LOG || path.resolve(process.cwd(), 'logs/audit.log'));
  const baselineDate = String(args.baselineDate || process.env.BENCH_BASELINE_DATE || '2026-02-25');
  const disableBaseline = Boolean(args.noBaseline);

  const baseline = disableBaseline
    ? null
    : collectBaselineFromAuditLog({
      logPath: baselineLog,
      routeKeys: routes.map((route) => routeKey(route)),
      baselineDate,
    });

  const comparisons = buildComparisons(results, baseline?.routes || null);

  const payload = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    iterations,
    warmup,
    paceMs,
    max429Retries,
    retryAfterMs,
    routeCooldownMs,
    baselineDate: disableBaseline ? null : baselineDate,
    baselineLog: disableBaseline ? null : baselineLog,
    baseline,
    comparisons,
    results,
  };

  const outputDir = path.resolve(process.cwd(), 'artifacts/perf');
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `benchmark-key-routes-${startedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.json`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(`[benchmark] report written: ${outputPath}`);
  if (!disableBaseline && !baseline?.found) {
    console.warn(`[benchmark] baseline log not found: ${baselineLog}`);
  }
}

main().catch((err) => {
  console.error('[benchmark] failed:', err);
  process.exitCode = 1;
});
