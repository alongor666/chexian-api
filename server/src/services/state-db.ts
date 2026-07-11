/**
 * State DB - SQLite 状态持久层（v5 状态持久层迁移 Phase 1）
 *
 * ⚠️ 访问契约（RED LINE）：
 *   ONLY {access-control,personal-access-token,activation-token}-store.ts may import this module.
 *   CLI / MCP 必须走 HTTP API，禁止 require('better-sqlite3')。
 *   理由：API server 持有唯一权威写入口，避免多进程并发与原生模块依赖污染。
 *
 * 单例：模块级单例，调用 init() 后所有 store 共享同一 Database 实例。
 * - 默认不启用：仅 dbEnv.STATE_STORE_BACKEND === 'sqlite' 才会被 init
 * - 启动失败 = fail-fast（不允许在 SQLite 模式下退化到 JSON 模式）
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { dbEnv } from '../config/env.js';
import { getStateDbPath } from '../config/paths.js';
import { applyMigrations, applyRecommendedPragmas } from './state-db-schema.js';

let dbInstance: Database.Database | null = null;
let dbPath: string | null = null;

/**
 * 初始化 state.db。
 * 幂等：重复调用直接返回；首次调用执行 PRAGMA + applyMigrations。
 *
 * @throws 若 backend != 'sqlite'（不应被错误调用）；若文件无法创建/打开（fail-fast）
 *         若运行在 Bun runtime（better-sqlite3 是 NAPI 原生模块，Bun 暂不支持）
 */
export function init(): void {
  if (dbInstance) return;

  if (dbEnv.STATE_STORE_BACKEND !== 'sqlite') {
    throw new Error(
      `[state-db] init() 仅在 STATE_STORE_BACKEND=sqlite 时允许，当前=${dbEnv.STATE_STORE_BACKEND}`,
    );
  }

  // Runtime 兼容性检测：better-sqlite3 是 NAPI 原生模块，Bun 暂不支持
  // （https://github.com/oven-sh/bun/issues/4290）。生产 (PM2+node) 工作正常；
  // 本地 `bun src/app.ts` 必须保持默认 STATE_STORE_BACKEND=json，或切换到 tsx/node。
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
    throw new Error(
      '[state-db] better-sqlite3 是 NAPI 原生模块，Bun runtime 暂不支持。\n' +
        '  - 本地开发：保持默认 STATE_STORE_BACKEND=json（不要显式设 sqlite）\n' +
        '  - 必须本地验证 sqlite 模式时：使用 vitest（基于 node）或 `node dist/app.js` 启动\n' +
        '  - VPS 生产：PM2 用 node 启动，不受影响',
    );
  }

  const resolvedPath = getStateDbPath(dbEnv.STATE_DB_PATH);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  applyRecommendedPragmas(db);
  const migrationResult = applyMigrations(db);

  dbInstance = db;
  dbPath = resolvedPath;
  console.log(
    `[StateDB] initialized at ${resolvedPath} (applied=${migrationResult.applied.length}, skipped=${migrationResult.skipped.length})`,
  );
}

/**
 * 关闭 state.db。优雅停机或测试隔离使用。
 */
export function close(): void {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
  dbPath = null;
}

/**
 * 获取 Database 实例。仅供同包 *-store.ts 使用（见文件头契约）。
 * @throws 若 init() 未被调用
 */
export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error('[state-db] getDb() called before init()');
  }
  return dbInstance;
}

/**
 * 当前是否已初始化。健康检查/诊断使用。
 */
export function isInitialized(): boolean {
  return dbInstance !== null;
}

/**
 * 获取当前 state.db 文件路径（已 resolve）。诊断/备份使用。
 */
export function getCurrentDbPath(): string | null {
  return dbPath;
}

/**
 * 在事务中执行 fn。fn 抛错则回滚，正常返回则提交。
 * better-sqlite3 transaction API 是同步的，因此 fn 必须是同步函数。
 */
export function withTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  const tx = db.transaction(fn);
  return tx(db);
}

/**
 * 备份 state.db 到指定路径（用 SQLite 原生 backup API，安全处理 WAL）。
 * 优于 cp（cp 可能复制到中间状态导致目标库损坏）。
 *
 * @param destPath 目标路径，父目录会被自动创建
 * @returns Promise<void> 备份成功 resolve；失败 reject 原始错误
 */
export async function backup(destPath: string): Promise<void> {
  const db = getDb();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await db.backup(destPath);
}
