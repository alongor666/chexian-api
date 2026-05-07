/**
 * DuckDB Parquet 增量加载器
 *
 * 包含：
 * - Parquet 指纹缓存（按文件 mtime 判断是否需要重建）
 * - loadMultipleParquet 增量/全量加载逻辑
 *
 * 从 duckdb.ts 拆出，接受 DuckDBQueryable 接口，零主类依赖。
 */

import { createHash } from 'crypto';
import { statSync } from 'fs';
import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';
import { AppError } from '../middleware/error.js';
import { setDataVersion } from './data-version.js';

// ============================================
// Parquet 指纹缓存（按表名存储）
// ============================================

interface ParquetCacheEntry {
  fingerprint: string;
  fileSet: Set<string>;
  fileMtimes: Map<string, number>;
}

interface FingerprintResult {
  fingerprint: string;
  mtimes: Map<string, number>;
}

const parquetFingerprintCache = new Map<string, ParquetCacheEntry>();

/**
 * 计算文件路径列表的指纹：hash(排序后路径 + 各文件 mtime)
 * 同时返回每个文件的 mtimeMs 用于增量路径的精确比对
 * 若任何文件 stat 失败，返回 null（触发全量重建）
 */
export function computeParquetFingerprint(filePaths: string[]): FingerprintResult | null {
  try {
    const sorted = [...filePaths].sort();
    const hash = createHash('sha256');
    const mtimes = new Map<string, number>();
    for (const p of sorted) {
      const mtime = statSync(p).mtimeMs;
      mtimes.set(p, mtime);
      hash.update(`${p}:${mtime}\n`);
    }
    return { fingerprint: hash.digest('hex'), mtimes };
  } catch {
    return null;
  }
}

/**
 * 加载多个 Parquet 文件到 raw_parquet 表。
 * 支持增量追加（仅新增文件）和全量重建（文件变更或首次加载）。
 *
 * @param db - DuckDB 可查询实例
 * @param filePaths - Parquet 文件路径列表（至少 1 个）
 */
export async function loadMultipleParquet(
  db: DuckDBQueryable,
  filePaths: string[],
): Promise<{ totalRows: number }> {
  if (filePaths.length === 0) {
    throw new AppError(400, 'No parquet files provided');
  }

  const TABLE_NAME = 'raw_parquet';
  const t0 = Date.now();

  // ── 指纹计算（失败则 fallback 到全量重建）──
  const fpResult = computeParquetFingerprint(filePaths);
  const cached = parquetFingerprintCache.get(TABLE_NAME);

  if (fpResult !== null && cached !== undefined && cached.fingerprint === fpResult.fingerprint) {
    // 缓存命中：文件集合和 mtime 完全一致，验证表存在后复用
    if (await db.hasRelation(TABLE_NAME)) {
      const totalResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
      const totalRows = totalResult[0]?.cnt ?? 0;
      console.log(`[DuckDB] loadMultipleParquet cache HIT — skipping rebuild, ${totalRows} rows (${Date.now() - t0}ms)`);
      return { totalRows };
    }
    // 表不存在（内部状态异常），清除缓存 fallthrough 到全量重建
    parquetFingerprintCache.delete(TABLE_NAME);
  }

  // ── 判断是否可增量追加 ──
  const canIncremental =
    fpResult !== null &&
    cached !== undefined &&
    (await db.hasRelation(TABLE_NAME));

  if (canIncremental) {
    const filePathSet = new Set(filePaths);
    const newFiles = filePaths.filter((p) => !cached!.fileSet.has(p));
    const removedFiles = [...cached!.fileSet].filter((p) => !filePathSet.has(p));

    // 检查已有文件是否被修改（mtime 变化）
    const existingModified = [...cached!.fileSet]
      .filter((p) => filePathSet.has(p))
      .some((p) => cached!.fileMtimes.get(p) !== fpResult!.mtimes.get(p));

    if (removedFiles.length === 0 && newFiles.length > 0 && !existingModified) {
      // 仅新增文件且已有文件未变：INSERT INTO 增量加载
      const escapedNew = newFiles.map((p) => `'${escapeSqlValue(p)}'`).join(', ');
      try {
        await db.query(`
          INSERT INTO ${TABLE_NAME}
          SELECT * FROM read_parquet([${escapedNew}], union_by_name=true)
        `);
        db.invalidateCache();
        setDataVersion(fpResult!.fingerprint);
        parquetFingerprintCache.set(TABLE_NAME, {
          fingerprint: fpResult!.fingerprint,
          fileSet: new Set(filePaths),
          fileMtimes: fpResult!.mtimes,
        });
        const totalResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
        const totalRows = totalResult[0]?.cnt ?? 0;
        console.log(`[DuckDB] loadMultipleParquet incremental INSERT — +${newFiles.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);
        return { totalRows };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DuckDB] Incremental INSERT failed (${msg}), falling back to full rebuild`);
        // fall through to full rebuild below
      }
    }
  }

  // ── 全量重建（DROP + CREATE）──
  const escapedPaths = filePaths.map((p) => `'${escapeSqlValue(p)}'`).join(', ');

  await db.dropRelationIfExists('raw_parquet');

  try {
    await db.query(`
      CREATE TABLE ${TABLE_NAME} AS
      SELECT * FROM read_parquet([${escapedPaths}], union_by_name=true)
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DuckDB] ⚠️ read_parquet failed: ${msg}`);
    console.error(`[DuckDB] Files: ${filePaths.join(', ')}`);
    parquetFingerprintCache.delete(TABLE_NAME);
    throw new AppError(500, `Parquet loading failed (schema incompatible or file corrupted): ${msg}`);
  }

  db.invalidateCache();

  // 更新指纹缓存 + dataVersion（fpResult 为 null 时跳过，下次仍走全量）
  if (fpResult !== null) {
    setDataVersion(fpResult.fingerprint);
    parquetFingerprintCache.set(TABLE_NAME, {
      fingerprint: fpResult.fingerprint,
      fileSet: new Set(filePaths),
      fileMtimes: fpResult.mtimes,
    });
  }

  const totalResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
  const totalRows = totalResult[0]?.cnt ?? 0;
  const rebuildReason = cached === undefined ? 'cold start' : 'fingerprint changed';
  console.log(`[DuckDB] loadMultipleParquet full rebuild (${rebuildReason}) — ${filePaths.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);

  return { totalRows };
}
