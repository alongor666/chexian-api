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
import fs from 'fs';
import path from 'path';
import { corsConfig } from './config/cors.js';
import { getDataDir, getCandidateDataDirs, getSalesmanMappingPaths, getSalesmanDimPaths, getPlanDimPaths, getRenewalFunnelPaths } from './config/paths.js';
import { duckdbService } from './services/duckdb.js';
import { seedAccessControlData } from './services/access-control.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { inspectParquetSource, getParquetLoadRejectionReason, getParquetLoadWarning } from './utils/parquet-source.js';
import { isValidParquetFile } from './utils/security.js';

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

/** 数据加载完成标志 — 健康检查依赖此状态 */
let dataReady = false;

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

    await seedAccessControlData();

    console.log('[Server] ⚡ Realtime-only mode enabled: all analytics query PolicyFact in realtime');

    // ---- 以下为标准（Mac 开发）启动路径 ----

    // 启动期健康检查：数据目录与映射路径可见性
    const candidateDirs = getCandidateDataDirs();
    const mappingCandidates = getSalesmanMappingPaths();
    const dimSalesmanCandidates = getSalesmanDimPaths();
    const dimPlanCandidates = getPlanDimPaths();
    console.log('[Server] Startup health check:');
    console.log('  - Parquet dirs:', candidateDirs.map(d => `${d}${fs.existsSync(d) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Dim salesman:', dimSalesmanCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Dim plan:', dimPlanCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));
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
          filesToLoad = realLegacyFiles.length > 0 ? realLegacyFiles : legacyFiles.slice(0, 1);
          console.warn(`[Server] current/ has no parquet, fallback to parquet files in ${legacyDataDir}`);
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

    if (filesToLoad.length > 0) {
      const validFiles: typeof filesToLoad = [];
      for (const file of filesToLoad) {
        const validation = await isValidParquetFile(file.path);
        if (validation.valid) {
          validFiles.push(file);
          continue;
        }

        console.warn(
          `[Server] Skip invalid parquet: ${file.path} (${validation.error || 'unknown reason'})`
        );
      }
      filesToLoad = validFiles;
    }

    if (filesToLoad.length === 0) {
      console.warn('[Server] No valid parquet files found after validation. Server will start without data.');
    }

    if (filesToLoad.length > 0) {
      const realtimeFiles: typeof filesToLoad = [];
      for (const file of filesToLoad) {
        const inspection = await inspectParquetSource(file.path);
        const rejectionReason = getParquetLoadRejectionReason(inspection);
        if (rejectionReason) {
          console.warn(`[Server] Skip unsupported parquet source: ${file.path} (${rejectionReason})`);
          continue;
        }

        const warning = getParquetLoadWarning(inspection);
        if (warning) {
          console.warn(`[Server] Parquet source warning: ${file.path} (${warning})`);
        }

        realtimeFiles.push(file);
      }
      filesToLoad = realtimeFiles;
    }

    if (filesToLoad.length === 0) {
      console.warn('[Server] No realtime row-level parquet files available. Server will start without data.');
    }

    console.log(`[Server] Found ${filesToLoad.length} parquet file(s) to load:`);
    filesToLoad.forEach((f, i) => console.log(`  [${i}] ${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MB)`));

    try {
      if (filesToLoad.length > 1) {
        // 兼容路径：多文件加载
        const { totalRows: multiRows } = await duckdbService.loadMultipleParquet(filesToLoad.map(f => f.path));
        console.log(`[Server] Multi-parquet loaded: ${filesToLoad.length} files, ${multiRows} total rows`);
      } else if (filesToLoad.length === 1) {
        // 兼容路径：单文件加载
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

      // 加载维度数据（业务员主数据 + 计划数据）
      // 优先使用 Parquet 维度表，回退到旧 JSON 映射
      let dimLoaded = false;

      // 策略 1：Parquet 维度表（新架构）
      const salesmanDimPath = getSalesmanDimPaths().find(p => fs.existsSync(p));
      const planDimPath = getPlanDimPaths().find(p => fs.existsSync(p));
      if (salesmanDimPath && planDimPath) {
        try {
          await duckdbService.loadDimParquet(salesmanDimPath, planDimPath);
          console.log('[Server] Dim tables loaded from Parquet:', salesmanDimPath, planDimPath);
          dimLoaded = true;
        } catch (err) {
          console.warn('[Server] Dim Parquet load failed, falling back to JSON:', err);
        }
      }

      // 策略 2：JSON 映射文件（回退）
      if (!dimLoaded) {
        const teamMappingCandidates = getSalesmanMappingPaths();
        for (const mappingPath of teamMappingCandidates) {
          if (!fs.existsSync(mappingPath)) continue;
          try {
            await duckdbService.loadTeamMapping(mappingPath);
            console.log('[Server] Team mapping loaded from JSON (fallback):', mappingPath);
            dimLoaded = true;
            break;
          } catch (err) {
            console.warn('[Server] Team mapping load failed:', mappingPath);
          }
        }
      }

      if (!dimLoaded) {
        console.warn('[Server] Warning: Dim data unavailable. Checked Parquet + JSON paths.');
        console.warn('[Server] Hint: run "python3 数据管理/warehouse/dim/generate_dim_tables.py" to generate dim Parquet files.');
      }

      // 加载续保漏斗数据（独立于 PolicyFact）
      const renewalFunnelPath = getRenewalFunnelPaths().find(p => fs.existsSync(p));
      if (renewalFunnelPath) {
        try {
          await duckdbService.loadRenewalFunnel(renewalFunnelPath);
        } catch (err) {
          console.warn('[Server] RenewalFunnel load failed (non-blocking):', err);
        }
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

    // 标记数据就绪
    dataReady = true;
    console.log('[Server] Data loading complete, marking server as ready');

    // 启动HTTP服务器（仅监听本地回环，禁止 0.0.0.0 暴露）
    const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
    app.listen(PORT, BIND_HOST, () => {
      console.log(`[Server] 🚀 Server is running on http://${BIND_HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Health check: http://${BIND_HOST}:${PORT}/health`);
      console.log(`[Server] API docs: See server/README.md`);

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
