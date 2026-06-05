/**
 * 数据管理路由
 * Data Management Routes
 *
 * POST /api/data/upload - Parquet 文件上传
 * GET /api/data/metadata - 数据元信息
 * DELETE /api/data/clear - 清除当前数据
 * GET /api/data/files - 列出数据文件
 * POST /api/data/load/:filename - 加载已有文件
 *
 * 安全修复 (2026-02-03):
 * - 添加路径遍历防护 (sanitizeFilename + validatePathWithinDirectory)
 * - 添加 Parquet 文件魔数验证 (isValidParquetFile)
 * - 添加上传速率限制
 * - 添加文件清理机制
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { readonlyMiddleware } from '../middleware/readonly.js';
import { permissionMiddleware, requireRole, UserRole } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { duckdbService } from '../services/duckdb.js';
import { createPolicyFactView, dropAllDerivedTables } from '../services/duckdb-materialization.js';
import {
  escapeSqlValue,
  sanitizeFilename,
  validatePathWithinDirectory,
  isValidParquetFile,
  safeLog,
} from '../utils/security.js';
import { getDataDir, getKpiPlanConfigPath } from '../config/paths.js';
import { inspectParquetSource, getParquetLoadRejectionReason, getParquetLoadWarning } from '../utils/parquet-source.js';

const router = Router();

// ============================================
// 配置常量
// ============================================

const CONFIG = {
  DATA_DIR: getDataDir(),
  MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
  MAX_FILES_KEEP: 10, // 保留最近 10 个文件
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 分钟
  RATE_LIMIT_MAX: 10, // 最多 10 次上传
};

const KPI_PLAN_CONFIG_PATH = getKpiPlanConfigPath();
const CURRENT_DATA_SUBDIR = path.join(CONFIG.DATA_DIR, 'current');

// 确保数据目录存在
if (!fs.existsSync(CONFIG.DATA_DIR)) {
  fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CURRENT_DATA_SUBDIR)) {
  fs.mkdirSync(CURRENT_DATA_SUBDIR, { recursive: true });
}

function resolveManagedParquetPath(safeFilename: string): string | null {
  const candidateDirs = [CURRENT_DATA_SUBDIR, CONFIG.DATA_DIR];

  for (const dir of candidateDirs) {
    const candidatePath = path.join(dir, safeFilename);
    validatePathWithinDirectory(candidatePath, dir);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

// ============================================
// 简易速率限制（生产环境建议使用 express-rate-limit）
// ============================================

const uploadRateLimit = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(userId: string): void {
  const now = Date.now();
  const record = uploadRateLimit.get(userId);

  if (!record || now > record.resetTime) {
    uploadRateLimit.set(userId, {
      count: 1,
      resetTime: now + CONFIG.RATE_LIMIT_WINDOW,
    });
    return;
  }

  if (record.count >= CONFIG.RATE_LIMIT_MAX) {
    const waitMinutes = Math.ceil((record.resetTime - now) / 60000);
    throw new AppError(429, `上传过于频繁，请 ${waitMinutes} 分钟后再试`);
  }

  record.count++;
}

// ============================================
// Multer 配置：安全的文件上传
// ============================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CURRENT_DATA_SUBDIR);
  },
  filename: (req, file, cb) => {
    // 使用 UUID + 安全化的原文件名，避免冲突和注入
    const uuid = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50); // 限制长度
    cb(null, `${uuid}_${baseName}${ext}`);
  },
});

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // 1. 检查扩展名
  if (!file.originalname.toLowerCase().endsWith('.parquet')) {
    return cb(new Error('只支持 .parquet 文件扩展名'));
  }

  // 2. 检查 MIME 类型（虽然可伪造，但多一层防护）
  const allowedMimeTypes = [
    'application/octet-stream',
    'application/vnd.apache.parquet',
    'binary/octet-stream',
  ];

  // Multer 可能无法正确识别 MIME，所以不强制检查
  // 真正的验证在 isValidParquetFile() 中

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
    files: 1, // 只允许单文件上传
  },
});

// ============================================
// 文件清理机制
// ============================================

async function cleanupOldFiles(): Promise<void> {
  try {
    const files = fs.readdirSync(CONFIG.DATA_DIR)
      .filter((f) => f.endsWith('.parquet'))
      .map((filename) => {
        const filePath = path.join(CONFIG.DATA_DIR, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          path: filePath,
          mtime: stats.mtime,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // 保留最近的 N 个文件，删除其余
    const filesToDelete = files.slice(CONFIG.MAX_FILES_KEEP);

    for (const file of filesToDelete) {
      // 不删除当前正在使用的文件
      if (currentDataFile?.filename === file.filename) {
        continue;
      }

      fs.unlinkSync(file.path);
      safeLog('info', 'Data', `Cleaned up old file: ${file.filename}`);
    }
  } catch (err) {
    safeLog('error', 'Data', 'Cleanup error', { error: String(err) });
  }
}

function listManagedParquetFiles(): Array<{
  filename: string;
  sizeMB: number;
  modifiedTime: Date;
  isCurrent: boolean;
}> {
  const candidateDirs = [CURRENT_DATA_SUBDIR, CONFIG.DATA_DIR];
  const byFilename = new Map<string, {
    filename: string;
    sizeMB: number;
    modifiedTime: Date;
    isCurrent: boolean;
  }>();

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.parquet'))
      .map((filename) => {
        try {
          sanitizeFilename(filename);
        } catch {
          return null;
        }

        const filePath = path.join(dir, filename);
        validatePathWithinDirectory(filePath, dir);
        const stats = fs.statSync(filePath);
        return {
          filename,
          sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
          modifiedTime: stats.mtime,
          isCurrent: currentDataFile?.filename === filename,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    for (const file of files) {
      const existing = byFilename.get(file.filename);
      if (!existing || file.modifiedTime.getTime() > existing.modifiedTime.getTime()) {
        byFilename.set(file.filename, file);
      }
    }
  }

  const listed = Array.from(byFilename.values())
    .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());

  const activeDataFile = currentDataFile;
  if (activeDataFile && !listed.some(file => file.filename === activeDataFile.filename)) {
    listed.unshift({
      filename: activeDataFile.filename,
      sizeMB: Math.round(activeDataFile.fileSizeBytes / 1024 / 1024 * 100) / 100,
      modifiedTime: activeDataFile.uploadTime,
      isCurrent: true,
    });
  }

  return listed;
}

// ============================================
// 当前数据文件状态
// ============================================

let currentDataFile: {
  filename: string;
  originalName: string;
  uploadTime: Date;
  rowCount: number;
  fileSizeBytes: number;
} | null = null;

/**
 * 设置当前数据文件状态（供 app.ts 启动时调用）
 */
export function setCurrentDataFile(info: {
  filename: string;
  rowCount: number;
  fileSizeBytes: number;
}) {
  currentDataFile = {
    filename: info.filename,
    originalName: info.filename,
    uploadTime: new Date(),
    rowCount: info.rowCount,
    fileSizeBytes: info.fileSizeBytes,
  };
}

// ============================================
// 路由
// ============================================

/**
 * 应用认证、只读、行级权限中间件
 *
 * 权限分层：
 * - `authMiddleware` + `readonlyMiddleware`：所有 /api/data/* 共用（PAT 仅允许 GET）
 * - `permissionMiddleware`：注入 req.permissionFilter，供 GET /metadata 等读接口按行级过滤
 * - `requireRole(BRANCH_ADMIN)`：单路由叠加（upload / load / clear / download / files / kpi-plan-config PUT）
 *
 * 多分公司前置（0A 改造，详见 `/Users/alongor666/.claude/plans/indexed-tinkering-ritchie.md` §0A）：
 * 山西上线前 `/api/data/*` 必须把"全省机构列表 + 全省 Parquet 下载"收敛到 branch_admin 角色，
 * 避免 org_user 拿到非本机构数据；多省正式落地后由 0C 字段注册表 branch_code 提供更细粒度隔离。
 */
router.use(authMiddleware);
router.use(readonlyMiddleware);
router.use(permissionMiddleware);

/**
 * POST /api/data/upload
 * 上传 Parquet 文件（带安全验证）
 *
 * 安全措施：
 * 1. 速率限制
 * 2. 文件扩展名检查
 * 3. Parquet 魔数验证
 * 4. 路径安全验证
 */
router.post(
  '/upload',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 速率限制检查
    const userId = (req as any).user?.userId || 'anonymous';
    checkRateLimit(userId);

    // 继续到 multer 中间件
    return new Promise<void>((resolve, reject) => {
      upload.single('file')(req, res, async (err) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              reject(new AppError(413, `文件过大，最大允许 ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`));
            } else {
              reject(new AppError(400, `上传错误: ${err.message}`));
            }
          } else {
            reject(new AppError(400, err.message));
          }
          return;
        }

        if (!req.file) {
          reject(new AppError(400, '未提供文件'));
          return;
        }

        const filePath = req.file.path;
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        safeLog('info', 'Data', `Uploading file: ${originalName}`);

        try {
          // 2. 验证 Parquet 文件格式（魔数检查）
          const validation = await isValidParquetFile(filePath);
          if (!validation.valid) {
            // 删除无效文件
            fs.unlinkSync(filePath);
            reject(new AppError(400, validation.error || '不是有效的 Parquet 文件'));
            return;
          }

          // 3. 整理相同前缀的旧文件并归档
          const ARCHIVE_DIR = path.join(CONFIG.DATA_DIR, 'archive');
          const timestampDir = path.join(ARCHIVE_DIR, `backup_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);

          const matchNew = originalName.match(/(.*?)(\d{8})(.*?)\.parquet$/i);
          if (matchNew) {
            const prefix = matchNew[1];
            const newDate = parseInt(matchNew[2], 10);
            const suffix = matchNew[3];

            const existingFiles = fs.readdirSync(CURRENT_DATA_SUBDIR).filter(f => f.endsWith('.parquet') && f !== req.file!.filename);
            for (const f of existingFiles) {
              const fullPathOld = path.join(CURRENT_DATA_SUBDIR, f);
              const matchOld = f.match(/(?:^[a-f0-9\-]{36}_)?(.*?)(\d{8})(.*?)\.parquet$/i);

              if (matchOld) {
                const oldPrefix = matchOld[1];
                const oldDate = parseInt(matchOld[2], 10);
                const oldSuffix = matchOld[3];

                if (oldPrefix === prefix && oldSuffix === suffix) {
                  if (oldDate <= newDate) {
                    if (!fs.existsSync(timestampDir)) {
                      fs.mkdirSync(timestampDir, { recursive: true });
                    }
                    fs.renameSync(fullPathOld, path.join(timestampDir, f));
                    safeLog('info', 'Data', `Archived old file: ${f} (replaced by ${originalName})`);
                  }
                }
              }
            }
          }

          // 4. 加载 current 目录下所有有效的 Parquet（跳过损坏/空文件，避免整批加载失败）
          const candidateFiles = fs.readdirSync(CURRENT_DATA_SUBDIR)
            .filter(f => f.endsWith('.parquet'))
            .map(f => path.join(CURRENT_DATA_SUBDIR, f));

          const validCandidateFiles: string[] = [];
          for (const candidateFile of candidateFiles) {
            const validation = await isValidParquetFile(candidateFile);
            if (!validation.valid) {
              safeLog('warn', 'Data', `Skip invalid parquet during merge-load: ${path.basename(candidateFile)} (${validation.error || 'unknown reason'})`);
              continue;
            }

            const inspection = await inspectParquetSource(candidateFile);
            const rejectionReason = getParquetLoadRejectionReason(inspection);
            if (rejectionReason) {
              safeLog('warn', 'Data', `Skip unsupported parquet during merge-load: ${path.basename(candidateFile)} (${rejectionReason})`);
              continue;
            }

            const warning = getParquetLoadWarning(inspection);
            if (warning) {
              safeLog('warn', 'Data', `Parquet load warning: ${path.basename(candidateFile)} (${warning})`);
            }

            validCandidateFiles.push(candidateFile);
          }

          if (validCandidateFiles.length > 1) {
            await duckdbService.loadMultipleParquet(validCandidateFiles);
          } else if (validCandidateFiles.length === 1) {
            await duckdbService.loadParquet(validCandidateFiles[0], 'raw_parquet');
          } else {
            throw new AppError(400, 'current 目录中没有有效的 Parquet 文件');
          }

          // 5. 创建 PolicyFact 视图
          await createPolicyFactView(duckdbService, 'raw_parquet');

          // 6. 获取数据统计
          const countResult = await duckdbService.query<{ count: number }>(
            'SELECT COUNT(*) as count FROM PolicyFact'
          );
          const rowCount = countResult[0]?.count || 0;

          // 7. 更新当前数据文件信息
          currentDataFile = {
            filename: req.file!.filename,
            originalName,
            uploadTime: new Date(),
            rowCount,
            fileSizeBytes: req.file!.size,
          };

          safeLog('info', 'Data', `File loaded: ${rowCount} rows`);

          // 8. 异步清理根目录旧文件
          cleanupOldFiles().catch(() => { });

          res.json({
            success: true,
            data: {
              filename: currentDataFile.filename,
              originalName: currentDataFile.originalName,
              rowCount,
              fileSizeMB: Math.round(req.file!.size / 1024 / 1024 * 100) / 100,
            },
            message: `成功合并加载最新数据，当前总计 ${rowCount.toLocaleString()} 条数据`,
          });

          resolve();
        } catch (loadErr) {
          // 清理上传的文件
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }

          const errorDetail = loadErr instanceof Error ? loadErr.message : '未知错误';
          console.error('[Data] 数据加载失败:', errorDetail);
          reject(new AppError(400, '数据加载失败，请检查文件格式后重试'));
        }
      });
    });
  })
);

/**
 * GET /api/data/metadata
 * 获取当前加载数据的元信息
 */
router.get(
  '/metadata',
  asyncHandler(async (req: Request, res: Response) => {
    // 行级过滤：org_user 只能看到本机构的机构列表/日期范围/汇总；branch_admin 看全量。
    // permissionMiddleware 已注入 req.permissionFilter；fail-closed 用 '1=0' 而非 '1=1'，
    // 避免某些路径上 permissionFilter 未生成时悄悄放开数据。
    const permissionWhere = req.permissionFilter || '1=0';
    try {
      // 检查 PolicyFact 是否存在
      let rowCount = 0;
      try {
        const countResult = await duckdbService.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM PolicyFact WHERE ${permissionWhere}`
        );
        rowCount = countResult[0]?.count || 0;
      } catch {
        throw new AppError(404, '当前没有加载的数据');
      }

      // 获取表结构（不含数据，无需过滤）
      const schema = await duckdbService.getTableSchema('PolicyFact');

      // 获取数据范围（如果有日期字段）
      let dateRange = null;
      try {
        const dateResult = await duckdbService.query<{ min_date: string; max_date: string }>(
          `SELECT
            MIN(policy_date)::VARCHAR as min_date,
            MAX(policy_date)::VARCHAR as max_date
          FROM PolicyFact
          WHERE policy_date IS NOT NULL AND ${permissionWhere}`
        );
        if (dateResult[0]?.min_date) {
          dateRange = {
            minDate: dateResult[0].min_date,
            maxDate: dateResult[0].max_date,
          };
        }
      } catch {
        // 日期字段可能不存在，记录警告但继续
        safeLog('warn', 'Data', 'Date range query failed, field may not exist');
      }

      // 获取机构列表（按行级过滤裁剪：org_user 仅看到自己机构）
      let organizations: string[] = [];
      try {
        const orgResult = await duckdbService.query<{ org_level_3: string }>(
          `SELECT DISTINCT org_level_3
          FROM PolicyFact
          WHERE org_level_3 IS NOT NULL AND ${permissionWhere}
          ORDER BY org_level_3`
        );
        organizations = orgResult.map((r) => r.org_level_3);
      } catch {
        safeLog('warn', 'Data', 'Organization query failed, field may not exist');
      }

      // 汇总统计（按行级过滤）
      let summaryStats = null;
      try {
        const statsResult = await duckdbService.query<{
          total_premium: number;
          avg_premium: number;
          policy_count: number;
        }>(
          `SELECT
            SUM(premium) as total_premium,
            AVG(premium) as avg_premium,
            COUNT(DISTINCT policy_no) as policy_count
          FROM PolicyFact
          WHERE ${permissionWhere}`
        );
        summaryStats = statsResult[0];
      } catch {
        safeLog('warn', 'Data', 'Summary stats query failed');
      }

      res.json({
        success: true,
        data: {
          file: currentDataFile ? {
            filename: currentDataFile.filename,
            originalName: currentDataFile.originalName,
            uploadTime: currentDataFile.uploadTime,
            rowCount: currentDataFile.rowCount,
            fileSizeMB: Math.round(currentDataFile.fileSizeBytes / 1024 / 1024 * 100) / 100,
          } : {
            filename: 'unknown',
            originalName: '启动时加载的数据',
            uploadTime: new Date(),
            rowCount,
            fileSizeMB: null,
          },
          schema: schema.map((col: any) => ({
            name: col.column_name,
            type: col.column_type,
            nullable: col.null === 'YES',
          })),
          dateRange,
          organizations,
          summaryStats,
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : '获取元信息失败';
      throw new AppError(500, errorMessage);
    }
  })
);

/**
 * DELETE /api/data/clear
 * 清除当前加载的数据
 */
router.delete(
  '/clear',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    if (!currentDataFile) {
      throw new AppError(404, '当前没有加载的数据');
    }

    try {
      // 删除 DuckDB 中所有派生表和视图（集中管理，避免遗漏）
      await dropAllDerivedTables(duckdbService);

      // 删除文件（兼容 current/ 与根目录）
      const filePath = resolveManagedParquetPath(currentDataFile.filename);
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const deletedFile = currentDataFile.originalName;
      currentDataFile = null;

      safeLog('info', 'Data', `Cleared data: ${deletedFile}`);

      res.json({
        success: true,
        message: `已清除数据: ${deletedFile}`,
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : '清除数据失败';
      throw new AppError(500, errorMessage);
    }
  })
);

/**
 * GET /api/data/files
 * 列出数据目录中的所有 Parquet 文件
 */
router.get(
  '/files',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const files = listManagedParquetFiles();

    res.json({
      success: true,
      data: files,
    });
  })
);

/**
 * POST /api/data/load/:filename
 * 加载数据目录中已有的 Parquet 文件
 *
 * 安全修复：
 * 1. 文件名验证（sanitizeFilename）
 * 2. 路径验证（validatePathWithinDirectory）
 * 3. Parquet 魔数验证（isValidParquetFile）
 */
router.post(
  '/load/:filename',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const { filename } = req.params;

    // 1. 安全验证：文件名清理（防止路径遍历）
    const safeFilename = sanitizeFilename(filename);

    // 2. 构建并验证路径（兼容 current/ 与根目录）
    const filePath = resolveManagedParquetPath(safeFilename);
    if (!filePath) {
      throw new AppError(404, `文件不存在: ${safeFilename}`);
    }

    // 4. 检查扩展名
    if (!safeFilename.endsWith('.parquet')) {
      throw new AppError(400, '只支持 Parquet 文件');
    }

    // 5. 验证 Parquet 文件格式
    const validation = await isValidParquetFile(filePath);
    if (!validation.valid) {
      throw new AppError(400, validation.error || '不是有效的 Parquet 文件');
    }
    const inspection = await inspectParquetSource(filePath);
    const rejectionReason = getParquetLoadRejectionReason(inspection);
    if (rejectionReason) {
      throw new AppError(400, rejectionReason);
    }

    const warning = getParquetLoadWarning(inspection);
    if (warning) {
      safeLog('warn', 'Data', `Parquet load warning: ${safeFilename} (${warning})`);
    }

    safeLog('info', 'Data', `Loading file: ${safeFilename}`);

    try {
      // 6. 加载到 DuckDB
      await duckdbService.loadParquet(filePath, 'raw_parquet');

      // 7. 创建 PolicyFact 视图
      await createPolicyFactView(duckdbService, 'raw_parquet');

      // 8. 获取数据统计
      const countResult = await duckdbService.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM PolicyFact'
      );
      const rowCount = countResult[0]?.count || 0;

      // 9. 更新当前数据文件信息
      const stats = fs.statSync(filePath);
      currentDataFile = {
        filename: safeFilename,
        originalName: safeFilename,
        uploadTime: new Date(),
        rowCount,
        fileSizeBytes: stats.size,
      };

      safeLog('info', 'Data', `File loaded: ${rowCount} rows`);

      res.json({
        success: true,
        data: {
          filename: safeFilename,
          rowCount,
          fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
        },
        message: `成功加载 ${rowCount.toLocaleString()} 条数据`,
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : '数据加载失败';
      throw new AppError(400, errorMessage);
    }
  })
);

/**
 * GET /api/data/download/:filename
 * 下载 Parquet 文件（用于备份、调试或离线分析）
 *
 * 安全措施：
 * 1. 文件名验证
 * 2. 路径验证
 * 3. Parquet 格式验证
 */
router.get(
  '/download/:filename',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const { filename } = req.params;

    // 1. 安全验证：文件名清理
    const safeFilename = sanitizeFilename(filename);

    // 2. 构建并验证路径（兼容 current/ 与根目录）
    const filePath = resolveManagedParquetPath(safeFilename);
    if (!filePath) {
      throw new AppError(404, '文件不存在');
    }

    // 4. 验证 Parquet 格式
    const validation = await isValidParquetFile(filePath);
    if (!validation.valid) {
      throw new AppError(400, validation.error || '不是有效的 Parquet 文件');
    }

    // 5. 设置响应头并发送文件
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  })
);

const kpiPlanConfigSchema = z.array(z.object({
  plan_year: z.number().int(),
  business_line: z.string().min(1),
  level: z.string().min(1),
  level_key: z.string().min(1),
  plan_premium: z.number(),
}));

router.get(
  '/kpi-plan-config',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await duckdbService.query<{
      plan_year: number;
      business_line: string;
      level: string;
      level_key: string;
      plan_premium: number;
    }>(
      `SELECT plan_year, business_line, level, level_key, plan_premium
       FROM KpiPlanConfig
       ORDER BY plan_year DESC, business_line, level, level_key`
    );

    res.json({ success: true, data: rows });
  })
);

router.put(
  '/kpi-plan-config',
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = kpiPlanConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message || '参数错误');
    }

    const plans = parsed.data;

    fs.mkdirSync(path.dirname(KPI_PLAN_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(KPI_PLAN_CONFIG_PATH, JSON.stringify(plans, null, 2), 'utf-8');

    await duckdbService.query('DELETE FROM KpiPlanConfig');
    if (plans.length > 0) {
      const values = plans
        .map((p) => `(${p.plan_year}, '${escapeSqlValue(p.business_line)}', '${escapeSqlValue(p.level)}', '${escapeSqlValue(p.level_key)}', ${p.plan_premium})`)
        .join(',\n');
      await duckdbService.query(`INSERT INTO KpiPlanConfig VALUES\n${values}`);
    }

    res.json({ success: true, data: { count: plans.length } });
  })
);

// ============================================
// 数据版本（SW 轮询依赖此接口）
// ============================================

let latestEtlDate: string | null = null;
const serverStartTime = new Date().toISOString();

/**
 * GET /api/data/version
 * 返回当前 ETL 日期和构建时间（Service Worker 版本轮询依赖此接口）
 */
router.get(
  '/version',
  asyncHandler(async (req: Request, res: Response) => {
    if (!latestEtlDate) {
      try {
        const result = await duckdbService.query<{ max_date: string }>(
          `SELECT MAX(CAST(policy_date AS DATE))::VARCHAR AS max_date FROM PolicyFact`
        );
        latestEtlDate = result[0]?.max_date || new Date().toISOString().slice(0, 10);
      } catch {
        latestEtlDate = new Date().toISOString().slice(0, 10);
      }
    }

    res.json({
      success: true,
      data: {
        etlDate: latestEtlDate,
        buildTime: new Date().toISOString(),
        serverStartTime,
      },
    });
  })
);

export default router;
