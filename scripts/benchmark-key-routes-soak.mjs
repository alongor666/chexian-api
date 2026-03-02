#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
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

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
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

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Math.round(sorted[index]);
}

function summarize(values) {
  if (values.length === 0) {
    return { p50: null, p95: null, p99: null, avg: null, max: null, min: null };
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

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProcessRssMb(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return null;
  try {
    const output = execSync(`ps -o rss= -p ${Number(pid)}`, { encoding: 'utf-8' }).trim();
    const rssKb = Number(output.split(/\s+/)[0]);
    if (!Number.isFinite(rssKb) || rssKb <= 0) return null;
    return round2(rssKb / 1024);
  } catch {
    return null;
  }
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
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
  const duration = Math.round(performance.now() - start);
  const text = await response.text();
  const body = readJsonSafe(text);
  const ok = isBusinessSuccess(response, body);
  return {
    ts: Date.now(),
    route,
    routeKey: routeKey(route),
    status: response.status,
    ok,
    durationMs: duration,
    error: ok ? null : pickErrorMessage(body, response.status),
    retryAfterMs: response.status === 429
      ? parseRetryAfterMs(response, body, fallbackRetryAfterMs)
      : null,
  };
}

function buildWindowedStats(events, startedAtMs, windowMs) {
  if (events.length === 0) return [];
  const maxWindowIdx = Math.max(...events.map((evt) => Math.floor((evt.ts - startedAtMs) / windowMs)));
  const windows = [];
  for (let idx = 0; idx <= maxWindowIdx; idx += 1) {
    const from = startedAtMs + idx * windowMs;
    const to = from + windowMs;
    const bucket = events.filter((evt) => evt.ts >= from && evt.ts < to);
    const successDurations = bucket.filter((evt) => evt.ok).map((evt) => evt.durationMs);
    const statusCounts = {};
    for (const evt of bucket) {
      statusCounts[evt.status] = (statusCounts[evt.status] || 0) + 1;
    }
    const stats = summarize(successDurations);
    windows.push({
      index: idx,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      requests: bucket.length,
      failures: bucket.length - successDurations.length,
      p95: stats.p95,
      avg: stats.avg,
      statusCounts,
    });
  }
  return windows;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.baseUrl || process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000');
  const durationMinutes = asNumber(args.durationMinutes || process.env.BENCH_SOAK_DURATION_MINUTES, 15);
  const concurrency = asNumber(args.concurrency || process.env.BENCH_SOAK_CONCURRENCY, 4);
  const paceMs = asNumber(args.paceMs || process.env.BENCH_SOAK_PACE_MS, 0);
  const max429Retries = asNumber(args.max429Retries || process.env.BENCH_MAX_429_RETRIES, 1);
  const retryAfterMs = asNumber(args.retryAfterMs || process.env.BENCH_RETRY_AFTER_MS, 60_000);
  const windowSeconds = asNumber(args.windowSeconds || process.env.BENCH_SOAK_WINDOW_SECONDS, 60);
  const max5xx = asNumber(args.max5xx || process.env.BENCH_SOAK_MAX_5XX, 0);
  const maxP95DriftPct = asNumber(args.maxP95DriftPct || process.env.BENCH_SOAK_MAX_P95_DRIFT_PCT, 25);
  const maxRssMb = asNumber(args.maxRssMb || process.env.BENCH_GATE_MAX_RSS_MB, 1229);
  const serverPid = asNumber(args.serverPid || process.env.BENCH_SERVER_PID, NaN);
  const strictGate = asBoolean(args.strictGate ?? process.env.BENCH_STRICT_GATE, true);
  const sampleRssEveryMs = asNumber(args.sampleRssEveryMs || process.env.BENCH_SOAK_RSS_SAMPLE_MS, 5000);

  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${mm}-${dd}`;
  const yearStart = `${year}-01-01`;

  let token = String(args.token || process.env.BENCH_TOKEN || '');
  const username = String(args.username || process.env.BENCH_USERNAME || '');
  const password = String(args.password || process.env.BENCH_PASSWORD || '');
  if (!token && username && password) {
    token = await login(baseUrl, username, password);
  }
  if (!token) {
    console.warn('[soak] 未提供 token，若接口需要认证可能失败。可通过 --token 或 --username/--password 传入。');
  }

  const routes = [
    `/api/query/cross-sell-summary?dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger`,
    `/api/query/cross-sell-bundle?drillPath=%5B%5D&groupBy=org_level_3&dateField=policy_date&startDate=${yearStart}&endDate=${today}&vehicleCategory=passenger&granularity=monthly&timePeriod=monthly`,
    `/api/query/performance-summary?dateField=policy_date&startDate=${yearStart}&endDate=${today}&segmentTag=all&timePeriod=month&growthMode=mom&expandDims=none`,
    `/api/query/performance-bundle?drillPath=%5B%5D&groupBy=org_level_3&dateField=policy_date&startDate=${yearStart}&endDate=${today}&segmentTag=all&timePeriod=month&growthMode=mom&expandDims=none&granularity=monthly&limit=20`,
    `/api/query/dashboard-bundle?dateField=policy_date&startDate=${yearStart}&endDate=${today}&granularity=week&perspective=premium`,
  ];

  const durationMs = Math.max(1, durationMinutes) * 60 * 1000;
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + durationMs;
  const startedAt = new Date(startedAtMs).toISOString();

  const events = [];
  const rssSamples = [];
  let routeIdx = 0;

  const rssTimer = Number.isFinite(serverPid)
    ? setInterval(() => {
      const rssMb = getProcessRssMb(serverPid);
      if (rssMb !== null) {
        rssSamples.push({ ts: Date.now(), rssMb });
      }
    }, Math.max(1000, sampleRssEveryMs))
    : null;

  const worker = async () => {
    while (Date.now() < deadlineMs) {
      const route = routes[routeIdx % routes.length];
      routeIdx += 1;

      let retries = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await runOne(baseUrl, route, token, retryAfterMs);
        if (result.status === 429 && retries < max429Retries) {
          retries += 1;
          await sleep(result.retryAfterMs || retryAfterMs);
          continue;
        }
        events.push(result);
        break;
      }

      if (paceMs > 0) {
        await sleep(paceMs);
      }
    }
  };

  console.log(`[soak] start ${durationMinutes}m, concurrency=${concurrency}, routes=${routes.length}`);
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  if (rssTimer) clearInterval(rssTimer);

  const finishedAt = new Date().toISOString();
  const successDurations = events.filter((evt) => evt.ok).map((evt) => evt.durationMs);
  const overallStats = summarize(successDurations);
  const statusCounts = {};
  for (const evt of events) {
    statusCounts[evt.status] = (statusCounts[evt.status] || 0) + 1;
  }
  const total5xx = events.filter((evt) => evt.status >= 500).length;
  const windows = buildWindowedStats(events, startedAtMs, Math.max(1, windowSeconds) * 1000);
  const windowP95 = windows.map((w) => w.p95).filter((v) => v !== null);
  const baselineWindowP95 = average(windowP95.slice(0, 3));
  const tailWindowP95 = average(windowP95.slice(-3));
  const p95DriftPct = (baselineWindowP95 && tailWindowP95)
    ? round2(((tailWindowP95 - baselineWindowP95) / baselineWindowP95) * 100)
    : null;

  const maxObservedRssMb = rssSamples.length > 0
    ? Math.max(...rssSamples.map((sample) => sample.rssMb))
    : null;

  const violations = [];
  if (events.length === 0) {
    violations.push('no requests were completed during soak test');
  }
  if (total5xx > max5xx) {
    violations.push(`5xx count ${total5xx} > ${max5xx}`);
  }
  if (p95DriftPct !== null && p95DriftPct > maxP95DriftPct) {
    violations.push(`p95 drift ${p95DriftPct}% > ${maxP95DriftPct}%`);
  }
  if (maxObservedRssMb !== null && maxObservedRssMb > maxRssMb) {
    violations.push(`rss peak ${maxObservedRssMb}MB > ${maxRssMb}MB`);
  }

  const gatePassed = violations.length === 0;
  const payload = {
    startedAt,
    finishedAt,
    baseUrl,
    durationMinutes,
    concurrency,
    paceMs,
    max429Retries,
    retryAfterMs,
    windowSeconds,
    routes,
    totals: {
      requests: events.length,
      successes: successDurations.length,
      failures: events.length - successDurations.length,
      statusCounts,
      total5xx,
    },
    latency: {
      p50: overallStats.p50,
      p95: overallStats.p95,
      p99: overallStats.p99,
      avg: overallStats.avg,
      max: overallStats.max,
    },
    drift: {
      baselineWindowP95,
      tailWindowP95,
      p95DriftPct,
    },
    memory: {
      serverPid: Number.isFinite(serverPid) ? Number(serverPid) : null,
      maxRssMb: maxObservedRssMb,
      samples: rssSamples,
    },
    windows,
    gate: {
      strictGate,
      max5xx,
      maxP95DriftPct,
      maxRssMb,
      passed: gatePassed,
      violations,
    },
  };

  const outputDir = path.resolve(process.cwd(), 'artifacts/perf');
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `benchmark-key-routes-soak-${startedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.json`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(`[soak] report written: ${outputPath}`);
  console.log(`[soak] gate=${gatePassed ? 'PASS' : 'FAIL'} requests=${events.length} p95=${overallStats.p95 ?? 'n/a'}ms 5xx=${total5xx}`);
  if (violations.length > 0) {
    for (const item of violations) {
      console.warn(`[soak][gate] ${item}`);
    }
  }
  if (strictGate && !gatePassed) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[soak] failed:', err);
  process.exitCode = 1;
});
