/**
 * DuckDB Parquet 增量加载器
 *
 * 包含：
 * - Parquet 指纹缓存（按文件 mtime 判断是否需要重建）
 * - loadMultipleParquet 增量/全量加载逻辑
 *
 * 从 duckdb.ts 拆出，接受 DuckDBTransactionalQueryable 接口，零主类依赖。
 */

import { createHash, randomUUID } from 'crypto';
import { statSync } from 'fs';
import type { DuckDBTransactionalQueryable } from './duckdb-types.js';
import { getRelationType } from './duckdb-infra.js';
import { escapeSqlValue, sanitizeTableName } from '../utils/security.js';
import { AppError } from '../middleware/error.js';
import { makeTimestampVersionToken } from './data-version.js';

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
 * 先完整物化唯一 staging 表，再在单连接事务内替换目标 relation。
 * staging 创建失败时目标表完全不动；换表失败时事务回滚，finally 仅清 staging。
 */
export async function replaceTableFromSelect(
  db: DuckDBTransactionalQueryable,
  tableName: string,
  selectSql: string,
): Promise<void> {
  const safeTableName = sanitizeTableName(tableName);
  const stagingSuffix = `__staging_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const stagingTableName = sanitizeTableName(
    `${safeTableName.slice(0, 64 - stagingSuffix.length)}${stagingSuffix}`,
  );
  let stagingExists = false;

  try {
    await db.query(`CREATE TABLE ${stagingTableName} AS ${selectSql}`);
    stagingExists = true;

    const relationType = await getRelationType(db, safeTableName);
    const swapStatements: string[] = [];
    if (relationType === 'VIEW') {
      swapStatements.push(`DROP VIEW ${safeTableName}`);
    } else if (relationType) {
      swapStatements.push(`DROP TABLE ${safeTableName}`);
    }
    swapStatements.push(`ALTER TABLE ${stagingTableName} RENAME TO ${safeTableName}`);

    await db.transaction(swapStatements);
    stagingExists = false;
  } finally {
    if (stagingExists) {
      try {
        await db.dropRelationIfExists(stagingTableName);
      } catch (cleanupError: unknown) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(`[DuckDB] Failed to clean staging table ${stagingTableName}: ${message}`);
      }
    }
  }
}

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
 * B311 延迟提交：本函数**不再内部调用 setDataVersion**，改为返回 versionToken，
 * 由编排方（data-bootstrapper / routes/data.ts）在 createPolicyFactView 物化完成后
 * 统一 setDataVersion(versionToken) 提交——否则版本 bump 会同步唤醒 onDataVersionChange
 * 监听者去预热查询中间态视图（raw_parquet 已重建、PolicyFact 尚未重建）。
 *
 * @param db - DuckDB 可查询实例
 * @param filePaths - Parquet 文件路径列表（至少 1 个）
 * @returns totalRows + versionToken（指纹或时间戳兜底 token；缓存命中时为当前指纹，提交为 no-op）
 */
export async function loadMultipleParquet(
  db: DuckDBTransactionalQueryable,
  filePaths: string[],
): Promise<{ totalRows: number; versionToken: string }> {
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
      // 数据未变：token = 当前指纹，编排方提交时 setDataVersion 对相同版本 no-op
      return { totalRows, versionToken: fpResult!.fingerprint };
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
        parquetFingerprintCache.set(TABLE_NAME, {
          fingerprint: fpResult!.fingerprint,
          fileSet: new Set(filePaths),
          fileMtimes: fpResult!.mtimes,
        });
        const totalResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
        const totalRows = totalResult[0]?.cnt ?? 0;
        console.log(`[DuckDB] loadMultipleParquet incremental INSERT — +${newFiles.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);
        return { totalRows, versionToken: fpResult!.fingerprint };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DuckDB] Incremental INSERT failed (${msg}), falling back to full rebuild`);
        // fall through to full rebuild below
      }
    }
  }

  // ── 全量重建（staging 构建成功后事务换表）──
  const escapedPaths = filePaths.map((p) => `'${escapeSqlValue(p)}'`).join(', ');

  try {
    await replaceTableFromSelect(db, TABLE_NAME, `
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

  // 更新指纹缓存 + 计算待提交的 versionToken（提交由编排方在物化完成后执行）
  let versionToken: string;
  if (fpResult !== null) {
    versionToken = fpResult.fingerprint;
    parquetFingerprintCache.set(TABLE_NAME, {
      fingerprint: fpResult.fingerprint,
      fileSet: new Set(filePaths),
      fileMtimes: fpResult.mtimes,
    });
  } else {
    // stat 失败时拿不到指纹，但表已重建——编排方必须用时间戳 token 兜底提交，
    // 否则旧 cache key 仍命中重建前数据。指纹缓存不写入，下次照常走全量重建。
    versionToken = makeTimestampVersionToken();
  }

  const totalResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
  const totalRows = totalResult[0]?.cnt ?? 0;
  const rebuildReason = cached === undefined ? 'cold start' : 'fingerprint changed';
  console.log(`[DuckDB] loadMultipleParquet full rebuild (${rebuildReason}) — ${filePaths.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);

  return { totalRows, versionToken };
}
