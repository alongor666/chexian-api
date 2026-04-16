/**
 * Express 应用入口
 * Application Entry Point
 *
 * 车险业绩分析系统 - 后端服务（前后端分离架构）
 */

import 'dotenv/config';
import express, { Application } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { corsConfig } from './config/cors.js';
import { serverEnv } from './config/env.js';
import { duckdbService } from './services/duckdb.js';
import { seedAccessControlData } from './services/access-control.js';
import { DataBootstrapper } from './services/data-bootstrapper.js';
import { registerBootstrapper } from './services/bootstrapper-registry.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import type { Server } from 'http';

const app: Application = express();
const PORT = serverEnv.PORT;

/** 数据加载完成标志 — 健康检查依赖此状态 */
let dataReady = false;
/** HTTP server 引用，优雅关闭时先停止接收新请求 */
let httpServer: Server | null = null;

/**
 * 1. 安全中间件
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://open.bigmodel.cn", "https://openrouter.ai"],
    },
  },
  crossOriginEmbedderPolicy: false,
})); // HTTP安全头（含 CSP）
app.use(cors(corsConfig)); // 跨域配置

/**
 * 1.5 HTTP 响应压缩（gzip，>1KB 自动压缩）
 */
app.use(compression({ level: 6, threshold: 1024 }));

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
  if (!dataReady) {
    res.status(503).json({
      success: false,
      message: 'Server is starting, data not loaded yet',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * 5.1 内部状态详情（需认证，供运维监控）
 */
import { getRouteCacheStats } from './services/route-cache.js';
import { authMiddleware } from './middleware/auth.js';
app.get('/api/health/detail', authMiddleware, (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    success: true,
    dataReady,
    cache: {
      queryCache: { size: duckdbService.cacheSize },
      routeCache: getRouteCacheStats(),
    },
    memory: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
    },
    uptime: Math.round(process.uptime()),
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
    // 1. 初始化 DuckDB + 权限
    console.log('[Server] Initializing DuckDB...');
    await duckdbService.init();
    await seedAccessControlData();
    console.log('[Server] ⚡ Realtime-only mode: all analytics query PolicyFact in realtime');

    // 2. 数据启动（发现→去重→验证→加载→维度）
    const bootstrapper = new DataBootstrapper(duckdbService);
    registerBootstrapper(bootstrapper); // 注册到全局注册中心，供路由中间件使用
    try {
      const result = await bootstrapper.bootstrap();
      if (result) {
        setCurrentDataFile({
          filename: result.fileNames,
          rowCount: result.rowCount,
          fileSizeBytes: result.totalSize,
        });
        console.log(`[Server] Data ready: ${result.fileNames} (${result.fileCount} file(s), ${result.rowCount} rows)`);
      }
    } catch (error) {
      console.warn('[Server] Data loading failed (non-fatal):', error);
      console.warn('[Server] Server will start without data. APIs will return empty results.');
    }

    // 3. 标记就绪 + 启动 HTTP
    dataReady = true;
    const BIND_HOST = serverEnv.BIND_HOST;
    httpServer = app.listen(PORT, BIND_HOST, () => {
      console.log(`[Server] 🚀 Server is running on http://${BIND_HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Health check: http://${BIND_HOST}:${PORT}/health`);

      // 通知 PM2 进程已就绪（配合 wait_ready: true）
      if (typeof process.send === 'function') {
        process.send('ready');
        console.log('[Server] PM2 ready signal sent');
      }
    });
  } catch (error) {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * 优雅关闭：先停止接收新请求 → 等待活跃查询完成 → 关闭 DuckDB
 */
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  dataReady = false; // 健康检查立即返回 503，通知负载均衡器摘除节点

  // 1. 停止接收新的 TCP 连接
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    console.log('[Server] HTTP server closed, no new connections accepted');
  }

  // 2. 关闭 DuckDB（内部会 drain 活跃查询 + 关闭连接池）
  await duckdbService.close();
  console.log('[Server] DuckDB closed');

  process.exit(0);
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((err) => {
    console.error('[Server] Graceful shutdown failed:', err);
    process.exit(1);
  });
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((err) => {
    console.error('[Server] Graceful shutdown failed:', err);
    process.exit(1);
  });
});

// 启动服务器
startServer();

export default app;
