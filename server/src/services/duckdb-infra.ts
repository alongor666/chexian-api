/**
 * DuckDB 基础设施 — 查询缓存 + 连接池 + 表/视图工具方法
 *
 * 纯基础设施代码，零业务逻辑。从 duckdb.ts 拆出以降低 God File 行数。
 */

import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';
import type { DuckDBQueryable } from './duckdb-types.js';

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
    // LRU: 访问时 delete→set 将 key 移到 Map 末尾（最近访问）
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  set(key: string, data: any, ttlMs: number): void {
    // 已存在则先删除（保证 set 后在末尾）
    this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      // 驱逐 Map 首元素（最久未访问）
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

const ACQUIRE_TIMEOUT_MS = 5_000;
const MAX_WAIT_QUEUE = 20;

export class ConnectionPool {
  private pool: DuckDBConnection[] = [];
  private activeCount = 0;
  private maxSize: number;
  private waitQueue: Array<{
    resolve: (conn: DuckDBConnection) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
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
    // 队列已满 → fast-fail
    if (this.waitQueue.length >= MAX_WAIT_QUEUE) {
      throw new Error('ConnectionPool: queue full, server too busy');
    }
    // 达上限，排队等待（带超时）
    return new Promise<DuckDBConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`ConnectionPool: acquire timeout after ${ACQUIRE_TIMEOUT_MS}ms`));
      }, ACQUIRE_TIMEOUT_MS);
      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  release(conn: DuckDBConnection): void {
    if (this.waitQueue.length > 0) {
      // 直接交给等待者
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(conn);
    } else {
      // 归还到池中
      this.activeCount--;
      this.pool.push(conn);
    }
  }

  async closeAll(): Promise<void> {
    // 清理所有等待者
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('ConnectionPool: closing'));
    }
    this.waitQueue = [];
    for (const conn of this.pool) {
      try { conn.closeSync(); } catch { /* ignore */ }
    }
    this.pool = [];
    this.activeCount = 0;
  }
}

// ============================================
// 表/视图工具方法（从 duckdb.ts 迁移）
// ============================================

/**
 * 按真实对象类型清理同名 relation（TABLE / VIEW）。
 */
export async function dropRelationIfExists(db: DuckDBQueryable, relationName: string): Promise<void> {
  const safeRelationName = sanitizeTableName(relationName);
  const escapedRelationName = escapeSqlValue(safeRelationName);

  const rows = await db.query<{ table_type: string }>(`
    SELECT table_type
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = '${escapedRelationName}'
    LIMIT 1
  `);

  const tableType = (rows[0]?.table_type || '').toUpperCase();
  if (tableType === 'VIEW') {
    await db.query(`DROP VIEW IF EXISTS ${safeRelationName}`);
    return;
  }

  if (tableType) {
    await db.query(`DROP TABLE IF EXISTS ${safeRelationName}`);
  }
}

export async function hasRelation(db: DuckDBQueryable, relationName: string): Promise<boolean> {
  const safeRelationName = sanitizeTableName(relationName);
  const escapedRelationName = escapeSqlValue(safeRelationName);
  const rows = await db.query<{ cnt: number }>(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = '${escapedRelationName}'
  `);
  return (rows[0]?.cnt ?? 0) > 0;
}

export async function getTableSchema(db: DuckDBQueryable, tableName: string): Promise<any[]> {
  const safeTableName = sanitizeTableName(tableName);
  const sql = `DESCRIBE ${safeTableName}`;
  return db.query(sql);
}
