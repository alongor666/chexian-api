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
  /** 估算字节数（粗略，用于字节上限驱逐），set 时计算一次 */
  bytes: number;
}

/**
 * 粗略估算缓存值占用字节数。
 *
 * 不追求精确（JS 堆内存难以精确测量），只要"大结果显著大于小结果"即可驱动
 * 字节上限驱逐。用 JSON 序列化长度近似（×2 粗估 UTF-16 / 对象开销）。
 * 单条估算失败（循环引用等）退回一个保守常量，避免抛错破坏缓存写入。
 */
function estimateBytes(data: unknown): number {
  try {
    return JSON.stringify(data).length * 2;
  } catch {
    return 64 * 1024; // 兜底：当作 64KB
  }
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = Number(process.env.DUCKDB_QUERY_CACHE_MAX_ENTRIES) || 3000;
  // 字节上限：防止少量超大结果集（宽表全量导出等）撑爆堆内存——条数上限挡不住
  // "3000 条里有几条几十 MB"。默认 256MB，可经 env 调整。
  private maxBytes = Number(process.env.DUCKDB_QUERY_CACHE_MAX_BYTES) || 256 * 1024 * 1024;
  private currentBytes = 0;

  get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiry) {
      if (entry) { this.currentBytes -= entry.bytes; this.cache.delete(key); }
      return null;
    }
    // LRU: 访问时 delete→set 将 key 移到 Map 末尾（最近访问）
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  set(key: string, data: any, ttlMs: number): void {
    // 已存在则先删除（保证 set 后在末尾），扣回旧字节
    const existing = this.cache.get(key);
    if (existing) { this.currentBytes -= existing.bytes; this.cache.delete(key); }

    const bytes = estimateBytes(data);
    this.cache.set(key, { data, expiry: Date.now() + ttlMs, bytes });
    this.currentBytes += bytes;

    // 驱逐 Map 首元素（最久未访问）直到同时满足条数 + 字节双上限。
    // 始终保留刚写入的 key（不自我驱逐），避免单条超大值导致空写。
    while (
      this.cache.size > this.maxSize ||
      (this.currentBytes > this.maxBytes && this.cache.size > 1)
    ) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined || firstKey === key) break;
      const evicted = this.cache.get(firstKey);
      if (evicted) this.currentBytes -= evicted.bytes;
      this.cache.delete(firstKey);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  /** 当前估算缓存字节数（监控/测试用） */
  get bytes(): number {
    return this.currentBytes;
  }
}

// ============================================
// 连接池
// ============================================

// 严苛边界：双重对齐 —— CPU 物理上限 ∩ 应用 fanout 下限
// - 2s timeout：5s 排队对用户已无意义
// - queue=32：覆盖最坏 cold-start fanout（4 warmer × 10 query bundles - 8 active = 32）
// - SATURATION_WINDOW：用真实失败信号驱动 /health 503，避免瞬时排队误报
const ACQUIRE_TIMEOUT_MS = 2_000;
const MAX_WAIT_QUEUE = 32;
const SATURATION_WINDOW_MS = 5_000;
// 优雅关闭时等待活跃查询 drain 的上限。超过则放弃等待，关闭空闲连接收尾
// （卡死的查询连接交由 instance 释放兜底），避免 SIGTERM 后进程无限期挂起。
const DRAIN_TIMEOUT_MS = 10_000;
const DRAIN_POLL_MS = 50;

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
  // 真实饱和时间戳：仅在 acquire 真的失败（queue full / timeout）时才更新。
  // /health 用此判定 503，避免"active==maxSize 但都正常完成"的瞬时误报。
  private lastSaturationAt = 0;
  // 关闭中标志：closeAll() 期间为 true。此后归还的连接直接关闭而非回池，
  // 避免在 pool 已清空后 release 把连接重新塞进来造成泄漏。
  private closing = false;

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
      try {
        return await this.instance.connect();
      } catch (err) {
        // instance.connect() 抛错时必须回滚 activeCount，否则每次失败永久泄漏 1 点，
        // 累计到 maxSize 即进入"幽灵满载" —— 实际未持有连接却显示满载，永不自愈。
        // 典型触发：高并发下 DuckDB 内部瞬时失败、资源竞争、FFI 绑定错误等。
        this.activeCount--;
        throw err;
      }
    }
    // 队列已满 → fast-fail（标记真实饱和）
    if (this.waitQueue.length >= MAX_WAIT_QUEUE) {
      this.lastSaturationAt = Date.now();
      throw new Error('ConnectionPool: queue full, server too busy');
    }
    // 达上限，排队等待（带超时）
    return new Promise<DuckDBConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        // acquire 真的超时未拿到连接 → 标记真实饱和
        this.lastSaturationAt = Date.now();
        reject(new Error(`ConnectionPool: acquire timeout after ${ACQUIRE_TIMEOUT_MS}ms`));
      }, ACQUIRE_TIMEOUT_MS);
      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  release(conn: DuckDBConnection): void {
    // 防御：上游若在 acquire 失败路径误调 release(undefined) 会污染 pool/waiter，
    // 让下一个 acquire 拿到无效连接并崩溃，静默丢弃更安全。
    if (!conn) {
      console.warn('[ConnectionPool] release called with invalid connection, ignoring');
      return;
    }
    if (this.closing) {
      // 关闭中：不再回池、不再交给等待者（等待者已被 closeAll 拒绝并清空）。
      // 直接关闭连接并扣减活跃计数，让 closeAll 的 drain 循环能收敛到 0。
      this.activeCount--;
      try { conn.closeSync(); } catch { /* ignore */ }
      return;
    }
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

  /**
   * 池子状态快照，用于诊断和监控（/health, /api/debug/pool-stats 等）
   *
   * - active/idle/waiting/maxSize：原始计数
   * - saturatedRecently：最近 5s 内是否发生过真实 acquire 失败（queue full / timeout）
   *   /health 用此判定 503，避免"active==maxSize 但全部正常完成"的瞬时排队误报
   */
  stats(): {
    active: number;
    idle: number;
    waiting: number;
    maxSize: number;
    saturatedRecently: boolean;
  } {
    return {
      active: this.activeCount,
      idle: this.pool.length,
      waiting: this.waitQueue.length,
      maxSize: this.maxSize,
      saturatedRecently:
        this.lastSaturationAt > 0 && Date.now() - this.lastSaturationAt < SATURATION_WINDOW_MS,
    };
  }

  async closeAll(): Promise<void> {
    // 1. 进入关闭态：拒绝所有排队等待者，停止接纳新等待者归还入池
    this.closing = true;
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('ConnectionPool: closing'));
    }
    this.waitQueue = [];

    // 2. drain：等待已借出（in-flight）的连接执行完并 release。
    //    activeCount === 借出但未归还的连接数；release 在 closing 态会扣减它。
    //    带超时兜底：卡死的查询不应让 SIGTERM 后的进程永久挂起。
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (this.activeCount > 0) {
      console.warn(
        `[ConnectionPool] drain timeout: ${this.activeCount} active connection(s) still running after ${DRAIN_TIMEOUT_MS}ms, closing pool anyway`,
      );
    }

    // 3. 关闭所有空闲连接（drain 完成后，归还的连接已在 closing 态被即时关闭，
    //    此处主要处理 drain 开始前就空闲在池中的连接）
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

/** 查询同名 relation 的真实对象类型（BASE TABLE / VIEW）。 */
export async function getRelationType(db: DuckDBQueryable, relationName: string): Promise<string | null> {
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
  return tableType || null;
}

/** 按真实对象类型清理同名 relation（TABLE / VIEW）。 */
export async function dropRelationIfExists(db: DuckDBQueryable, relationName: string): Promise<void> {
  const safeRelationName = sanitizeTableName(relationName);
  const tableType = await getRelationType(db, safeRelationName);
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
