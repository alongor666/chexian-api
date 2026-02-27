import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';

export interface RequestQueryMetric {
  sqlHash: string;
  sqlTimeMs: number;
  cacheHit: boolean;
}

export interface RequestContextState {
  requestId: string;
  routeKey: string;
  queryHash: string;
  startedAt: number;
  sqlTimeMs: number;
  cacheHit: boolean;
  queryCount: number;
  queryMetrics: RequestQueryMetric[];
}

const requestContextStore = new AsyncLocalStorage<RequestContextState>();

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function stableQueryString(query: Request['query']): string {
  const entries = Object.entries(query)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

export function buildRequestContext(req: Request): RequestContextState {
  const routeKey = req.originalUrl.split('?')[0] || req.path;
  const queryStr = stableQueryString(req.query);
  return {
    requestId: randomUUID(),
    routeKey,
    queryHash: hashText(`${routeKey}?${queryStr}`),
    startedAt: Date.now(),
    sqlTimeMs: 0,
    cacheHit: false,
    queryCount: 0,
    queryMetrics: [],
  };
}

export function runWithRequestContext<T>(ctx: RequestContextState, fn: () => T): T {
  return requestContextStore.run(ctx, fn);
}

export function getRequestContext(): RequestContextState | undefined {
  return requestContextStore.getStore();
}

export function recordQueryMetric(sql: string, sqlTimeMs: number, cacheHit: boolean): void {
  const ctx = requestContextStore.getStore();
  if (!ctx) return;

  const metric: RequestQueryMetric = {
    sqlHash: hashText(sql.replace(/\s+/g, ' ').trim()),
    sqlTimeMs: Math.max(0, Math.round(sqlTimeMs)),
    cacheHit,
  };

  ctx.queryMetrics.push(metric);
  ctx.queryCount += 1;
  ctx.sqlTimeMs += metric.sqlTimeMs;
  if (cacheHit) {
    ctx.cacheHit = true;
  }
}

export function getServerTimingValue(): string {
  const ctx = requestContextStore.getStore();
  if (!ctx) return '';

  const totalTimeMs = Math.max(0, Date.now() - ctx.startedAt);
  return `db;dur=${ctx.sqlTimeMs},app;dur=${totalTimeMs}`;
}
