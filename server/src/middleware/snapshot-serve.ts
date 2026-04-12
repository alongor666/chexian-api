/**
 * 静态快照服务中间件
 * Snapshot Serve Middleware
 *
 * 在 auth + permission 之后、子路由之前拦截 /api/query/* 请求。
 * 若对应 (bundleName, scope, paramHash) 的快照文件存在，则直接读文件返回（<5ms），
 * 否则 next() 回退到 DuckDB 实时查询。
 *
 * 响应头：X-Snapshot: hit | miss | stale | error
 */

import type { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSnapshotDirs } from '../config/paths.js';
import { logger } from '../utils/logger.js';

// ── 声明式快照清单 ─────────────────────────────
// governance 会校验此列表与实际 bundle 路由的一致性

export const SNAPSHOT_BUNDLES: readonly string[] = [
  'dashboard-bundle',
  'performance-bundle',
  'cross-sell-bundle',
  'filters-options',
  'customer-flow-summary',
  'customer-flow-inflow',
  'customer-flow-outflow',
  'customer-flow-trend',
  'customer-flow-metadata',
] as const;

// 使用全路径（baseUrl + path）匹配，防止跨 router 误命中
const ROUTE_BUNDLE_MAP: Record<string, string> = {
  '/api/query/dashboard-bundle': 'dashboard-bundle',
  '/api/query/performance-bundle': 'performance-bundle',
  '/api/query/cross-sell-bundle': 'cross-sell-bundle',
  '/api/filters/options': 'filters-options',
  '/api/query/customer-flow/summary': 'customer-flow-summary',
  '/api/query/customer-flow/inflow': 'customer-flow-inflow',
  '/api/query/customer-flow/outflow': 'customer-flow-outflow',
  '/api/query/customer-flow/trend': 'customer-flow-trend',
  '/api/query/customer-flow/metadata': 'customer-flow-metadata',
};

// ── 内存计数器（snapshot-health 端点使用）──────

let hitCount = 0;
let missCount = 0;
let staleCount = 0;
let errorCount = 0;

export function getSnapshotStats() {
  return { hit: hitCount, miss: missCount, stale: staleCount, error: errorCount };
}

export function resetSnapshotStats() {
  hitCount = 0;
  missCount = 0;
  staleCount = 0;
  errorCount = 0;
}

// ── 最新 ETL 日期（由 /api/data/version 更新或启动时检测）──

let latestEtlDate: string | null = null;

export function setLatestEtlDate(date: string) {
  latestEtlDate = date;
}

export function getLatestEtlDate(): string | null {
  return latestEtlDate;
}

// ── 工具函数 ───────────────────────────────────

/**
 * 从 query params 生成确定性哈希（排序后 SHA256 取前 12 位）
 */
export function computeParamHash(query: Record<string, unknown>): string {
  const sorted = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 12);
}

/**
 * 从权限过滤 SQL 反向解析权限域名称
 */
export function permissionToScope(permissionFilter: string | undefined): string {
  if (!permissionFilter || permissionFilter === '1=1') return 'all';
  const orgMatch = permissionFilter.match(/org_level_3\s*=\s*'(.+?)'/);
  if (orgMatch) return orgMatch[1];
  if (permissionFilter.includes('is_telemarketing')) return 'telemarketing';
  return 'unknown';
}

// ── 快照路径缓存（避免反复 stat，数据日更新一次即可） ──

const snapshotPathCache = new Map<string, string | null>();
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000; // 5 分钟后重新探测
let snapshotCacheExpiry = 0;

/** 清空快照路径缓存（数据更新后调用） */
export function invalidateSnapshotPathCache(): void {
  snapshotPathCache.clear();
  snapshotCacheExpiry = 0;
}

/**
 * 在候选快照目录中异步查找文件（带内存缓存）
 */
async function resolveSnapshotPath(bundleName: string, scope: string, paramHash: string): Promise<string | null> {
  // TTL 过期后清空缓存（数据可能已更新）
  if (Date.now() > snapshotCacheExpiry) {
    snapshotPathCache.clear();
    snapshotCacheExpiry = Date.now() + SNAPSHOT_CACHE_TTL;
  }

  const cacheKey = `${bundleName}/${scope}/${paramHash}`;
  if (snapshotPathCache.has(cacheKey)) {
    return snapshotPathCache.get(cacheKey)!;
  }

  for (const dir of getSnapshotDirs()) {
    const filePath = path.join(dir, bundleName, scope, `${paramHash}.json`);
    try {
      await fs.access(filePath);
      snapshotPathCache.set(cacheKey, filePath);
      return filePath;
    } catch {
      // 文件不存在，继续下一个目录
    }
  }

  snapshotPathCache.set(cacheKey, null);
  return null;
}

// ── 中间件 ─────────────────────────────────────

export function snapshotServe(req: Request, res: Response, next: NextFunction): void {
  const fullPath = req.baseUrl + req.path;
  const bundleName = ROUTE_BUNDLE_MAP[fullPath];
  if (!bundleName) {
    next();
    return;
  }

  const scope = permissionToScope(req.permissionFilter);
  const paramHash = computeParamHash(req.query as Record<string, unknown>);

  resolveSnapshotPath(bundleName, scope, paramHash)
    .then((snapshotPath) => {
      if (!snapshotPath) {
        missCount++;
        res.setHeader('X-Snapshot', 'miss');
        next();
        return;
      }

      return fs.readFile(snapshotPath, 'utf-8').then((content) => {
        const parsed = JSON.parse(content);
        const meta = parsed._meta;
        const data = parsed.data;

        // stale 检测：快照 ETL 日期 vs 服务端最新 ETL 日期
        const isStale = meta?.etlDate && latestEtlDate && meta.etlDate < latestEtlDate;

        if (isStale) {
          staleCount++;
          res.setHeader('X-Snapshot', 'stale');
        } else {
          hitCount++;
          res.setHeader('X-Snapshot', 'hit');
        }

        res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=60');
        res.json({
          success: true,
          data,
          meta: {
            snapshot: true,
            etlDate: meta?.etlDate || null,
            buildTime: meta?.buildTime || null,
            stale: !!isStale,
          },
        });
      });
    })
    .catch((err) => {
      errorCount++;
      logger.warn(`[snapshot-serve] Failed to serve snapshot`, err);
      res.setHeader('X-Snapshot', 'error');
      next();
    });
}
