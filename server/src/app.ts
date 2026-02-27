/**
 * Express 应用入口
 * Application Entry Point
 *
 * 车险业绩分析系统 - 后端服务（前后端分离架构）
 */

import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { corsConfig } from './config/cors.js';
import { getDataDir, getCandidateDataDirs, getSalesmanMappingPaths } from './config/paths.js';
import { duckdbService } from './services/duckdb.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

/**
 * 1. 安全中间件
 */
app.use(helmet()); // HTTP安全头
app.use(cors(corsConfig)); // 跨域配置

/**
 * 2. 请求解析中间件
 */
app.use(express.json({ limit: '10mb' })); // JSON解析（限制10MB）
app.use(express.urlencoded({ extended: true })); // URL编码解析

/**
 * 3. 日志中间件（开发环境）
 */
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

/**
 * 4. 审计日志中间件（生产环境）
 * 记录所有已认证用户的查询 API 操作
 */
import { auditMiddleware } from './middleware/audit.js';
app.use(auditMiddleware);

/**
 * 4.5 API 限流中间件
 * 防止恶意高频请求
 */
import { apiLimiter, loginLimiter, queryLimiter, aiLimiter } from './middleware/rateLimiter.js';
// 通用限流（兜底：100次/分钟）
app.use('/api', apiLimiter);
// 登录接口严格限流（5次/分钟）
app.use('/api/auth/login', loginLimiter);
// 查询接口限流（30次/分钟）
app.use('/api/query', queryLimiter);
// AI接口最严格限流（10次/分钟）
app.use('/api/ai', aiLimiter);

/**
 * 5. 健康检查路由
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * 6. API路由
 */
import authRoutes from './routes/auth.js';
import wecomAuthRoutes from './routes/wecom-auth.js';
import queryRoutes from './routes/query.js';
import filtersRoutes from './routes/filters.js';
import dataRoutes, { setCurrentDataFile } from './routes/data.js';
import aiRoutes from './routes/ai.js';

app.use('/api/auth/wecom', wecomAuthRoutes); // 放前面避免 loginLimiter 影响
app.use('/api/auth', authRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/filters', filtersRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/ai', aiRoutes);

/**
 * 7. 404处理
 */
app.use(notFoundHandler);

/**
 * 8. 全局错误处理
 */
app.use(errorHandler);

/**
 * 启动服务器
 */
async function startServer() {
  try {
    // 初始化DuckDB
    console.log('[Server] Initializing DuckDB...');
    await duckdbService.init();

    // 启动期健康检查：数据目录与映射路径可见性
    const candidateDirs = getCandidateDataDirs();
    const mappingCandidates = getSalesmanMappingPaths();
    console.log('[Server] Startup health check:');
    console.log('  - Parquet dirs:', candidateDirs.map(d => `${d}${fs.existsSync(d) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Team mapping paths:', mappingCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));

    // 优先扫描 current/ 子目录，加载活跃 Parquet 文件
    const parquetFiles = candidateDirs
      .flatMap(dir => {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
          .filter(f => f.endsWith('.parquet'))
          .map(f => ({
            name: f,
            path: path.join(dir, f),
            size: fs.statSync(path.join(dir, f)).size,
            mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs,
          }));
      });

    console.log('[Server] Parquet search dirs:', candidateDirs.filter(d => fs.existsSync(d)));

    // 若 current/ 为空，回退到 server/data 根目录，选最新 parquet（兼容历史上传路径）
    let filesToLoad = parquetFiles;
    if (filesToLoad.length === 0) {
      const legacyDataDir = getDataDir();
      if (fs.existsSync(legacyDataDir)) {
        const legacyFiles = fs.readdirSync(legacyDataDir)
          .filter(f => f.endsWith('.parquet'))
          .map(f => {
            const fullPath = path.join(legacyDataDir, f);
            const stat = fs.statSync(fullPath);
            return {
              name: f,
              path: fullPath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        if (legacyFiles.length > 0) {
          const realLegacyFiles = legacyFiles.filter(f => !f.name.startsWith('test-data'));
          filesToLoad = (realLegacyFiles.length > 0 ? realLegacyFiles : legacyFiles).slice(0, 1);
          console.warn(`[Server] current/ has no parquet, fallback to latest file in ${legacyDataDir}`);
        }
      }
    } else {
      // 有 current/ 数据时：筛选非 test-data；若只有测试文件则仅加载一个
      const realDataFiles = parquetFiles.filter(f => !f.name.startsWith('test-data'));
      filesToLoad = realDataFiles.length > 0 ? realDataFiles : parquetFiles.slice(0, 1);
    }

    if (filesToLoad.length === 0) {
      console.warn('[Server] No parquet files found. Server will start without data.');
    }

    console.log(`[Server] Found ${filesToLoad.length} parquet file(s) to load:`);
    filesToLoad.forEach((f, i) => console.log(`  [${i}] ${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MB)`));

    try {
      // 多文件或单文件加载
      if (filesToLoad.length > 1) {
        const { totalRows: multiRows } = await duckdbService.loadMultipleParquet(filesToLoad.map(f => f.path));
        console.log(`[Server] Multi-parquet loaded: ${filesToLoad.length} files, ${multiRows} total rows`);
      } else if (filesToLoad.length === 1) {
        await duckdbService.loadParquet(filesToLoad[0].path, 'raw_parquet');
        console.log('[Server] Data loaded successfully:', path.basename(filesToLoad[0].path));
      }

      // 创建PolicyFact视图（去重逻辑）
      console.log('[Server] Creating PolicyFact view...');
      await duckdbService.createPolicyFactView('raw_parquet');
      console.log('[Server] PolicyFact view created successfully');

      // 验证数据
      const countResult = await duckdbService.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM PolicyFact'
      );
      const rowCount = countResult[0]?.count || 0;
      console.log(`[Server] PolicyFact row count: ${rowCount}`);

      // 加载团队映射表（业务员 → 团队归属）
      // 本地开发路径优先，VPS 部署 fallback 到 server/data/
      const teamMappingCandidates = getSalesmanMappingPaths();
      let teamMappingLoaded = false;
      for (const mappingPath of teamMappingCandidates) {
        if (!fs.existsSync(mappingPath)) continue;
        try {
          await duckdbService.loadTeamMapping(mappingPath);
          console.log('[Server] Team mapping loaded from:', mappingPath);
          teamMappingLoaded = true;
          break;
        } catch (err) {
          console.warn('[Server] Team mapping load failed:', mappingPath);
        }
      }
      if (!teamMappingLoaded) {
        console.warn('[Server] Warning: Team mapping unavailable. Checked paths:', teamMappingCandidates.join(' , '));
        console.warn('[Server] Hint: ensure salesman_organization_mapping.json exists in warehouse dim or server/data.');
      }

      // 注册当前数据文件（使 /api/data/files 返回 isCurrent: true）
      if (filesToLoad.length > 0) {
        const totalSize = filesToLoad.reduce((sum, f) => sum + f.size, 0);
        const fileNames = filesToLoad.map(f => f.name).join(' + ');
        setCurrentDataFile({
          filename: fileNames,
          rowCount,
          fileSizeBytes: totalSize,
        });
        console.log(`[Server] Current data file set: ${fileNames} (${filesToLoad.length} file(s))`);
      }
    } catch (error) {
      console.warn('[Server] Warning: Failed to load test data:', error);
      console.warn('[Server] Server will start without data. APIs will return empty results.');
    }

    // 启动HTTP服务器（仅监听本地回环，禁止 0.0.0.0 暴露）
    const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
    app.listen(PORT, BIND_HOST, () => {
      console.log(`[Server] 🚀 Server is running on http://${BIND_HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Health check: http://${BIND_HOST}:${PORT}/health`);
      console.log(`[Server] API docs: See server/README.md`);
    });
  } catch (error) {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * 优雅关闭
 */
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  await duckdbService.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  await duckdbService.close();
  process.exit(0);
});

// 启动服务器
startServer();

export default app;
