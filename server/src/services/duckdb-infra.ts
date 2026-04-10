/**
 * DuckDB 基础设施 — 查询缓存 + 连接池
 *
 * 纯基础设施代码，零业务逻辑。从 duckdb.ts 拆出以降低 God File 行数。
 */

import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

// ============================================
// 查询缓存
// ============================================

interface CacheEntry<T = any> {
  data: T;
  expiry: number;
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 500;

  get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: any, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiry: Date.now() + ttlMs });
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================
// 连接池
// ============================================

export class ConnectionPool {
  private pool: DuckDBConnection[] = [];
  private activeCount = 0;
  private maxSize: number;
  private waitQueue: Array<(conn: DuckDBConnection) => void> = [];
  private instance: DuckDBInstance;

  constructor(instance: DuckDBInstance, maxSize: number = 10) {
    this.instance = instance;
    this.maxSize = maxSize;
  }

  async acquire(): Promise<DuckDBConnection> {
    // 优先从池中取
    if (this.pool.length > 0) {
      this.activeCount++;
      return this.pool.pop()!;
    }
    // 未达上限则新建
    if (this.activeCount < this.maxSize) {
      this.activeCount++;
      return await this.instance.connect();
    }
    // 达上限，排队等待
    return new Promise<DuckDBConnection>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(conn: DuckDBConnection): void {
    if (this.waitQueue.length > 0) {
      // 直接交给等待者
      const resolve = this.waitQueue.shift()!;
      resolve(conn);
    } else {
      // 归还到池中
      this.activeCount--;
      this.pool.push(conn);
    }
  }

  async closeAll(): Promise<void> {
    for (const conn of this.pool) {
      try { conn.closeSync(); } catch { /* ignore */ }
    }
    this.pool = [];
    this.activeCount = 0;
  }
}
