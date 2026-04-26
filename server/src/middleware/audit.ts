/**
 * 审计日志中间件
 * Audit Logging Middleware
 *
 * 记录所有已认证用户的查询 API 操作，用于安全审计和合规要求
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRequestContext, getRequestContext, runWithRequestContext } from '../utils/request-context.js';
import { opsEnv } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 审计日志路径配置
 * 优先级：环境变量 > 默认路径
 */
const AUDIT_LOG_PATH = opsEnv.AUDIT_LOG_PATH || path.resolve(__dirname, '../../../logs/audit.log');

/**
 * 审计日志条目接口
 */
interface AuditLogEntry {
  timestamp: string;       // ISO 8601 时间戳
  request_id: string;      // 请求ID（链路追踪）
  route_key: string;       // 路由路径（不含 query）
  query_hash: string;      // query 参数哈希
  username: string;        // 用户名
  userId: string;          // 用户 ID
  role: string;            // 用户角色
  organization?: string;   // 所属机构
  ip: string;              // 客户端 IP
  method: string;          // HTTP 方法（GET/POST/PUT/DELETE）
  path: string;            // 请求路径
  query: Record<string, any>;  // 查询参数
  cache_hit: boolean;      // 本次请求是否命中缓存
  sql_time_ms: number;     // SQL 累计耗时
  total_time_ms: number;   // 总耗时
  status: number;          // HTTP 状态码
  duration: number;        // 响应时间（毫秒）
}

/** 需要记录审计日志的路径前缀 */
export const AUDITED_PATHS = ['/api/query', '/api/data', '/api/agent/diagnosis'] as const;

export function getAuditLogPath(): string {
  return AUDIT_LOG_PATH;
}

/**
 * 将日志条目写入文件（共用工具）
 */
function writeAuditLog(entry: AuditLogEntry): void {
  try {
    const logLine = JSON.stringify(entry) + '\n';
    const logDir = path.dirname(AUDIT_LOG_PATH);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }
    fs.appendFile(AUDIT_LOG_PATH, logLine, { mode: 0o600 }, (err) => {
      if (err) console.error('[Audit] 写入审计日志失败');
    });
  } catch {
    console.error('[Audit] 审计日志记录异常');
  }
}

/**
 * 审计日志中间件
 *
 * 功能：
 * - 记录已认证用户的查询 API（/api/query/*）和数据上传（/api/data/*）请求
 * - 以 JSON Lines 格式追加到日志文件
 * - 记录请求的关键信息和响应时间
 *
 * 安全考虑：
 * - 日志文件权限应设置为 600（仅 owner 可读写）
 * - 敏感信息（如密码）不应记录
 * - 定期轮转日志文件（通过 logrotate）
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestCtx = buildRequestContext(req);
  res.setHeader('X-Request-Id', requestCtx.requestId);

  runWithRequestContext(requestCtx, () => {
    res.on('finish', () => {
      try {
        // 过滤条件：已认证用户 + 受审计路径
        const isAudited = AUDITED_PATHS.some(p => req.originalUrl.startsWith(p));
        if (!req.user || !isAudited) return;

        const ctx = getRequestContext();
        const totalTimeMs = Date.now() - requestCtx.startedAt;
        writeAuditLog({
          timestamp: new Date().toISOString(),
          request_id: ctx?.requestId || requestCtx.requestId,
          route_key: ctx?.routeKey || requestCtx.routeKey,
          query_hash: ctx?.queryHash || requestCtx.queryHash,
          username: req.user.username,
          userId: req.user.userId,
          role: req.user.role,
          organization: req.user.organization,
          ip: req.ip || req.socket.remoteAddress || 'unknown',
          method: req.method,
          path: req.originalUrl,
          query: req.query,
          cache_hit: Boolean(ctx?.cacheHit),
          sql_time_ms: ctx?.sqlTimeMs || 0,
          total_time_ms: totalTimeMs,
          status: res.statusCode,
          duration: totalTimeMs,
        });
      } catch (error) {
        console.error('[Audit] 审计日志记录异常:', error);
      }
    });

    next();
  });
}

/**
 * 显式记录认证事件（登录成功/失败）
 * 在 auth 路由中主动调用，无需等待 req.user 挂载
 */
export function auditAuthEvent(params: {
  event: 'login_success' | 'login_failure' | 'login_ip_denied';
  username: string;
  ip: string;
  role?: string;
  organization?: string;
}): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    request_id: 'auth-event',
    route_key: '/api/auth/login',
    query_hash: `${params.event}:${params.username}`,
    username: params.username,
    userId: params.username,
    role: params.role ?? 'unknown',
    organization: params.organization,
    ip: params.ip,
    method: 'POST',
    path: '/api/auth/login',
    query: { event: params.event },
    cache_hit: false,
    sql_time_ms: 0,
    total_time_ms: 0,
    status: params.event === 'login_success' ? 200 : 401,
    duration: 0,
  });
}

/**
 * 审计日志查询辅助函数（可选）
 *
 * 用法示例：
 * ```bash
 * # 统计访问最多的用户
 * cat logs/audit.log | jq -r '.username' | sort | uniq -c | sort -rn
 *
 * # 统计查询最多的 API
 * cat logs/audit.log | jq -r '.path' | sort | uniq -c | sort -rn
 *
 * # 查看慢查询（>5秒）
 * cat logs/audit.log | jq 'select(.duration > 5000)'
 *
 * # 按用户查询日志
 * cat logs/audit.log | jq 'select(.username == "admin")'
 * ```
 */
