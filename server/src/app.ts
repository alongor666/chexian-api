/**
 * Express 应用入口
 * Application Entry Point
 *
 * 车险业绩分析系统 - 后端服务（前后端分离架构）
 */

// 必须是第一条 import：ESM import 静态提升，env 加载须先于任何读 process.env 的模块执行
import './config/load-env.js';
import express, { Application } from 'express';
import compression from 'compression';
import { brotliMiddleware } from './middleware/brotli.js';
import cors from 'cors';
import helmet from 'helmet';
import { corsConfig } from './config/cors.js';
import { helmetOptions } from './config/csp.js';
import { serverEnv, dbEnv } from './config/env.js';
import { duckdbService } from './services/duckdb.js';
import { getTrendCubeState, getCostCubeState, getSalesmanCubeState } from './services/duckdb-cube.js';
import { getShadowStats, redactMismatchDetail } from './services/cube-shadow.js';
// state-db 仅在 STATE_STORE_BACKEND=sqlite 时动态加载（codex P1 修复 b85efba）：
// state-db.ts 顶部 import 'better-sqlite3'，虽然 binding.js 是 lazy（new Database
// 才 dlopen NAPI），不能依赖此隐性实现。dynamic import 把模块加载边界对齐到
// backend 分支，保证 backend=json + Bun runtime 永远不接触 better-sqlite3。
import type * as StateDbModule from './services/state-db.js';
let stateDb: typeof StateDbModule | null = null;
import { seedAccessControlData } from './services/access-control.js';
import { loadApiTokensIntoTable } from './services/personal-access-token-store.js';
import { DataBootstrapper } from './services/data-bootstrapper.js';
import { registerBootstrapper } from './services/bootstrapper-registry.js';
import { cacheWarmer } from './services/cache-warmer.js';
import { onDataVersionChange } from './services/data-version.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { startAuditLogMaintenance } from './skills/audit-log.js';
import { logger } from './utils/logger.js';

import type { Server } from 'http';

const app: Application = express();
const PORT = serverEnv.PORT;

/**
 * 反向代理信任（生产拓扑：客户端 → Nginx → PM2:3000）
 *
 * 不设置时 Express 默认 trust proxy=false，`req.ip` 取 socket 对端地址（Nginx 本机 127.0.0.1），
 * 不解析 `X-Forwarded-For`。后果是所有依赖 `req.ip` 的机制集体失真：
 *   - rateLimiter 按 IP 分桶退化为全站共享单桶
 *   - 登录 IP 白名单（USER_ALLOWED_IPS）对所有公网来源等效放行
 *   - 审计日志 IP 恒为 127.0.0.1，丧失溯源能力
 * 信任 1 跳（仅最前置 Nginx）；用具体数字而非 `true`，以通过 express-rate-limit 的
 * permissive-trust-proxy 校验（true 会被判为过度信任）。
 */
app.set('trust proxy', 1);

/**
 * 全局兜底：未捕获异常 / 未处理 Promise 拒绝
 *
 * 之前完全缺失 → 崩溃只留裸堆栈、无上下文、无告警钩子。
 * - uncaughtException：进程状态已不可信，记录后 exit(1) 交 PM2 重启
 *   （保持"崩溃即重启"语义，同时补上可观测性）。
 * - unhandledRejection：仅记录、不退出——本服务存在 fire-and-forget 异步
 *   （如 cube-shadow 影子对账），对单个游离拒绝直接退出会引入新的崩溃/重启环，
 *   故只提升可观测性、不改变存活性（注册处理器本身即抑制 Node 默认的进程终止）。
 */
process.on('uncaughtException', (err: Error) => {
  logger.error(`[uncaughtException] ${err?.name}: ${err?.message}`, err);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(`[unhandledRejection] ${err.name}: ${err.message}`, err);
});

/** 数据加载完成标志 — 健康检查依赖此状态 */
let dataReady = false;
/** HTTP server 引用，优雅关闭时先停止接收新请求 */
let httpServer: Server | null = null;
/** audit-log GC 维护任务停止函数 */
let stopAuditLogMaintenance: (() => void) | null = null;

/**
 * 1. 安全中间件
 */
app.use(helmet(helmetOptions)); // HTTP安全头（含 CSP）— 唯一事实源：config/csp.ts（B320 移除 'unsafe-eval'）
app.use(cors(corsConfig)); // 跨域配置

/**
 * 1.5 HTTP 响应压缩
 * - 客户端支持 br → brotli q4（比 gzip 小 15-25%）
 * - 不支持 br → fallback 到 compression() 的 gzip
 */
app.use(brotliMiddleware());
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
// Agent 诊断接口会触发确定性分析查询，使用查询级限流
app.use('/api/agent/diagnosis', queryLimiter);
// Agent 解释接口会触发 LLM provider，使用查询级限流
app.use('/api/agent/explain', queryLimiter);
// Agent forecast 接口是确定性经营计算器，也使用查询级限流
app.use('/api/agent/forecast', queryLimiter);
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
  // 连接池过载判定：基于"最近 5s 是否真的发生过 acquire 失败"
  // 而非"瞬时 active==maxSize"——后者会因正常 fanout（如 bundles 单请求 10 query）误报。
  // saturatedRecently 由 ConnectionPool 在 queue full 或 acquire timeout 时打点。
  const pool = duckdbService.getPoolStats();
  const overloaded = pool !== null && pool.saturatedRecently;
  // 通用立方体灰度观测面（BACKLOG uid=2026-06-11-claude-90a92c）：
  // 立方体新鲜度状态 + 影子对账计数器。影子比对差异明细（含业务数值）只进
  // PM2 日志不上公开端点，此处仅暴露计数与构建元信息。
  const cubeShadow = Object.fromEntries(
    Object.entries(getShadowStats()).map(([route, s]) => [
      route,
      {
        match: s.match,
        mismatch: s.mismatch,
        error: s.error,
        // 脱敏摘要（业务数值打码，保留行号/字段名/日期形状）供远程诊断；完整明细在 PM2 日志
        lastMismatch: redactMismatchDetail(s.lastMismatchDetail),
      },
    ])
  );
  const cubeStateView = (s: { builtVersion: string | null; building: unknown; lastBuildMs: number | null; lastError: string | null; exact?: boolean | null }) => ({
    builtVersion: s.builtVersion,
    building: s.building !== null,
    lastBuildMs: s.lastBuildMs,
    lastError: s.lastError,
    ...(s.exact !== undefined ? { exact: s.exact } : {}),
  });
  res.status(overloaded ? 503 : 200).json({
    success: !overloaded,
    message: overloaded ? 'Server overloaded' : 'Server is running',
    pool,
    cubes: {
      trend: cubeStateView(getTrendCubeState()),
      cost: cubeStateView(getCostCubeState()),
      salesman: cubeStateView(getSalesmanCubeState()),
    },
    cubeShadow,
    timestamp: new Date().toISOString(),
  });
});

/**
 * 内部数据指纹（localhost-only，无鉴权）
 *
 * 供 scripts/sync-vps.mjs 的完整性闸门对比"本地 vs VPS 现役"的 policy maxDate + rowCount，
 * 防止某台 parquet 不全的机器把残缺数据 rsync 覆盖到生产。
 *
 * 2026-07-09 起还供 scripts/sync-vps.mjs 的 runSxAutoPromote() 真实核实生产
 * BRANCH_RLS_ENABLED 运行时取值（见 data.security.branchRlsEnabled）——SX premium
 * 数据从 validation/SX/ 自动晋升到 current/SX/ 前的安全闸，取代此前"人工每次手动
 * 声明 --rls-confirmed、没人记得做就悄悄用陈旧数据"的单点故障（详见
 * scripts/release/sx-promote.mjs 文件头「自动化接入」）。复用本端点而非新增，
 * 因为两者共享同一条"localhost-only 内部状态回显"防线，无需重复造安全检查。
 *
 * 安全：仅直连 PM2(localhost:3000) 可访问——经 Nginx 的外部请求会带 X-Forwarded-For /
 * X-Real-IP 头，一律 403。故意不放 /api/* 路径以遵守"所有 /api/* 必须鉴权"红线
 * （见 .claude/rules/api-routes.md）。数据已在内存连接池，毫秒级。
 */
app.get('/internal/data-fingerprint', async (req, res) => {
  const remote = req.socket.remoteAddress || '';
  const isLoopback =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const viaProxy = Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (!isLoopback || viaProxy) {
    res.status(403).json({ success: false, message: 'localhost-only' });
    return;
  }
  if (!dataReady) {
    res.status(503).json({ success: false, message: 'data not loaded yet' });
    return;
  }
  try {
    const rows = await duckdbService.query<{ max_date: string | null; row_count: number }>(
      `SELECT MAX(CAST(policy_date AS DATE))::VARCHAR AS max_date, COUNT(*) AS row_count FROM PolicyFact`
    );
    res.json({
      success: true,
      data: {
        policy: {
          maxDate: rows[0]?.max_date ?? null,
          rowCount: Number(rows[0]?.row_count ?? 0),
        },
        // 运行时真实取值（非静态声明）：permission.ts 判定 RLS 是否生效用的同一严格字符串比较。
        security: {
          branchRlsEnabled: dbEnv.BRANCH_RLS_ENABLED === 'true',
        },
      },
    });
  } catch {
    res.status(503).json({ success: false, message: 'PolicyFact unavailable' });
  }
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
import feishuAuthRoutes from './routes/feishu-auth.js';
import queryRoutes from './routes/query.js';
import discoverRoutes from './routes/discover.js';
import filtersRoutes from './routes/filters.js';
import dataRoutes, { setCurrentDataFile } from './routes/data.js';
import aiRoutes from './routes/ai.js';
import agentAuditRoutes from './agent/routes/agent-audit.js';
import agentDiagnosisRoutes from './agent/routes/agent-diagnosis.js';
import agentExplainRoutes from './agent/routes/agent-explain.js';
import agentForecastRoutes from './agent/routes/agent-forecast.js';
import skillsRoutes from './routes/skills.js';
import workflowsRoutes from './routes/workflows.js';
import copilotRoutes from './routes/copilot.js';
import reportsRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

app.use('/api/auth/feishu', feishuAuthRoutes); // 放前面避免 loginLimiter 影响（扫码登录回调必须未登录可访问）
app.use('/api/auth', authRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/filters', filtersRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/agent/audit', agentAuditRoutes);
app.use('/api/agent/diagnosis', agentDiagnosisRoutes);
app.use('/api/agent/explain', agentExplainRoutes);
app.use('/api/agent/forecast', agentForecastRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/copilot', copilotRoutes);
app.use('/api/admin', adminRoutes);
// HTML 报告托管（authMiddleware 在路由内部守卫；放 /api 前缀避开前端 SPA 的 /reports 路由）
app.use('/api/reports', reportsRoutes);

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
    // State DB（v5 状态持久层 Phase 1）：仅 STATE_STORE_BACKEND=sqlite 时才动态加载并 init。
    // dynamic import 防止默认 backend=json 模式下意外加载 better-sqlite3 触发 Bun NAPI 错误。
    if (dbEnv.STATE_STORE_BACKEND === 'sqlite') {
      stateDb = await import('./services/state-db.js');
      stateDb.init();
    }
    await seedAccessControlData();
    // PAT 持久层：DuckDB 主库是 :memory:，PM2 reload 后必须从 api_tokens.json 重建
    await loadApiTokensIntoTable();
    console.log('[Server] ⚡ Realtime-only mode: all analytics query PolicyFact in realtime');

    // 2. 数据启动（发现→去重→验证→加载→维度）
    const bootstrapper = new DataBootstrapper(duckdbService);
    registerBootstrapper(bootstrapper); // 注册到全局注册中心，供路由中间件使用

    // 数据加载是否失败（抛异常）。仅"抛异常"视为失败 → /health 返回 503；
    // bootstrap 返回 null（未发现数据文件，但未报错）保持旧语义：照常启动、APIs 返回空集。
    let dataLoadFailed = false;
    try {
      const result = await bootstrapper.bootstrap();
      if (result) {
        setCurrentDataFile({
          filename: result.fileNames,
          rowCount: result.rowCount,
          fileSizeBytes: result.totalSize,
        });
        console.log(`[Server] Data ready: ${result.fileNames} (${result.fileCount} file(s), ${result.rowCount} rows)`);
        await cacheWarmer.warmStartupCritical();
      }
    } catch (error) {
      dataLoadFailed = true;
      console.warn('[Server] Data loading failed:', error);
      console.warn('[Server] Server will start but /health stays 503 until a successful ETL reload re-loads data.');
    }

    // 注册 ETL 后自动重新预热的监听者。
    // 在 bootstrap await 之后注册，确保启动期 setDataVersion(init0000→real) 不被监听
    // 拦截（已由上方 await 路径处理），消除竞态。bootstrap 失败时 await 路径不执行，
    // 但后续 reload/ETL 触发的 setDataVersion 仍会被监听者捕获并预热（消除 cold cliff）。
    onDataVersionChange(async (next, previous) => {
      console.log(`[Server] dataVersion ${previous}→${next}, re-warming cache...`);
      // 数据版本变更意味着数据已（重新）就绪：若启动期 bootstrap 曾失败导致 503，
      // 此处把节点恢复为健康，让负载均衡重新纳入流量（消除"启动失败后永久 503"）。
      dataReady = true;
      await cacheWarmer.warmStartupCritical();
      // 294022：CrossSell（CrossSellDailyAgg 物化）不再阻塞上方 await，改为异步链：
      // 先物化 CrossSell（最小化交叉销售路由的 503 降级窗口），完成后再跑笛卡尔预热。
      // 笛卡尔预热依赖 listen 端口，必须在 listen 后才能跑；
      // 监听者注册位置在 listen 之前，所以这里发起即可（首次 listen 完成后再触发也安全）
      cacheWarmer
        .warmPostListenDomains()
        .then(() => cacheWarmer.warmCommonRoutes())
        .catch((err) => console.warn('[Server] post-listen warming (post-ETL) failed:', err));
    });

    // 3. 标记就绪 + 启动 HTTP
    // bootstrap 抛异常 → dataReady=false：/health 返回 503，负载均衡不摘除进程但不导流，
    // 直到 onDataVersionChange 监听者在成功 ETL 后将其翻回 true。
    dataReady = !dataLoadFailed;
    const BIND_HOST = serverEnv.BIND_HOST;
    httpServer = app.listen(PORT, BIND_HOST, () => {
      console.log(`[Server] 🚀 Server is running on http://${BIND_HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Health check: http://${BIND_HOST}:${PORT}/health`);
      stopAuditLogMaintenance = startAuditLogMaintenance();

      // 通知 PM2 进程已就绪（配合 wait_ready: true）
      if (typeof process.send === 'function') {
        process.send('ready');
        console.log('[Server] PM2 ready signal sent');
      }

      // listen 后异步预热链（294022）：先 CrossSell 物化（曾在 listen 前阻塞 ~3 分钟
      // 造成 reload 期全站 502，现移到这里；物化期间交叉销售路由由惰性中间件兜底
      // 503+Retry-After，其余路由立即可服务），完成后再跑笛卡尔预热。
      // 内部 fetch 自调用，依赖 listen 已完成；setImmediate 让出当前 tick。
      setImmediate(() => {
        cacheWarmer
          .warmPostListenDomains()
          .then(() => cacheWarmer.warmCommonRoutes())
          .catch((err) => console.warn('[Server] post-listen warming (startup) failed:', err));
      });
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
  stopAuditLogMaintenance?.();
  stopAuditLogMaintenance = null;

  // 1. 停止接收新的 TCP 连接
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    console.log('[Server] HTTP server closed, no new connections accepted');
  }

  // 2. 关闭 DuckDB（内部会 drain 活跃查询 + 关闭连接池）
  await duckdbService.close();
  console.log('[Server] DuckDB closed');

  // 3. 关闭 state-db（如已 init）。stateDb 仅在 sqlite 模式被 dynamic import 赋值；
  // json 模式 stateDb 始终为 null，此分支直接跳过。
  if (stateDb?.isInitialized()) {
    stateDb.close();
    console.log('[Server] StateDB closed');
  }

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
