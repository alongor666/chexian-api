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
import { getDataDir, SERVER_ROOT } from './config/paths.js';
import { duckdbService } from './services/duckdb.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

const app: Application = express();
const PORT = process.env.PORT || 3000;

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
import { apiLimiter, loginLimiter, queryLimiter } from './middleware/rateLimiter.js';
// 通用限流
app.use('/api', apiLimiter);
// 登录接口严格限流
app.use('/api/auth/login', loginLimiter);
// 查询接口限流
app.use('/api/query', queryLimiter);

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
import queryRoutes from './routes/query.js';
import filtersRoutes from './routes/filters.js';
import dataRoutes, { setCurrentDataFile } from './routes/data.js';
import aiRoutes from './routes/ai.js';

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

    // 自动加载 data/ 目录中最新的 Parquet 文件
    const dataDir = getDataDir();
    const parquetFiles = fs.existsSync(dataDir)
      ? fs.readdirSync(dataDir)
          .filter(f => f.endsWith('.parquet'))
          .map(f => ({
            name: f,
            path: path.join(dataDir, f),
            mtime: fs.statSync(path.join(dataDir, f)).mtimeMs,
            size: fs.statSync(path.join(dataDir, f)).size,
          }))
          .sort((a, b) => b.mtime - a.mtime) // 最新文件优先
      : [];

    // 优先选择非 test-data 的文件，否则回退到 test-data
    const dataFile = parquetFiles.find(f => !f.name.startsWith('test-data')) || parquetFiles[0];
    const dataPath = dataFile ? dataFile.path : path.join(dataDir, 'test-data.parquet');
    console.log('[Server] Loading data from:', dataPath, dataFile ? `(${(dataFile.size / 1024 / 1024).toFixed(1)} MB)` : '');
    try {
      await duckdbService.loadParquet(dataPath, 'raw_parquet');
      console.log('[Server] Data loaded successfully:', path.basename(dataPath));

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
      const teamMappingPath = path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json');
      try {
        await duckdbService.loadTeamMapping(teamMappingPath);
      } catch (err) {
        console.warn('[Server] Warning: Failed to load team mapping:', err);
      }

      // 注册当前数据文件（使 /api/data/files 返回 isCurrent: true）
      if (dataFile) {
        setCurrentDataFile({
          filename: dataFile.name,
          rowCount,
          fileSizeBytes: dataFile.size,
        });
        console.log(`[Server] Current data file set: ${dataFile.name}`);
      }
    } catch (error) {
      console.warn('[Server] Warning: Failed to load test data:', error);
      console.warn('[Server] Server will start without data. APIs will return empty results.');
    }

    // 启动HTTP服务器
    app.listen(PORT, () => {
      console.log(`[Server] 🚀 Server is running on http://localhost:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
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
