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
import { existsSync } from 'fs';
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
] as const;

const ROUTE_BUNDLE_MAP: Record<string, string> = {
  '/dashboard-bundle': 'dashboard-bundle',
  '/performance-bundle': 'performance-bundle',
  '/cross-sell-bundle': 'cross-sell-bundle',
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

/**
 * 在候选快照目录中查找文件
 */
function resolveSnapshotPath(bundleName: string, scope: string, paramHash: string): string | null {
  for (const dir of getSnapshotDirs()) {
    const filePath = path.join(dir, bundleName, scope, `${paramHash}.json`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

// ── 中间件 ─────────────────────────────────────

export function snapshotServe(req: Request, res: Response, next: NextFunction): void {
  const bundleName = ROUTE_BUNDLE_MAP[req.path];
  if (!bundleName) {
    next();
    return;
  }

  const scope = permissionToScope(req.permissionFilter);
  const paramHash = computeParamHash(req.query as Record<string, unknown>);
  const snapshotPath = resolveSnapshotPath(bundleName, scope, paramHash);

  if (!snapshotPath) {
    missCount++;
    res.setHeader('X-Snapshot', 'miss');
    next();
    return;
  }

  // 异步读取快照文件
  fs.readFile(snapshotPath, 'utf-8')
    .then((content) => {
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
    })
    .catch((err) => {
      errorCount++;
      logger.warn(`[snapshot-serve] Failed to read snapshot: ${snapshotPath}`, err);
      res.setHeader('X-Snapshot', 'error');
      next();
    });
}
