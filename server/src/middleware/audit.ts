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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 审计日志路径配置
 * 优先级：环境变量 > 默认路径
 */
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.resolve(__dirname, '../../../logs/audit.log');

/**
 * 审计日志条目接口
 */
interface AuditLogEntry {
  timestamp: string;       // ISO 8601 时间戳
  username: string;        // 用户名
  userId: string;          // 用户 ID
  role: string;            // 用户角色
  organization?: string;   // 所属机构
  ip: string;              // 客户端 IP
  method: string;          // HTTP 方法（GET/POST/PUT/DELETE）
  path: string;            // 请求路径
  query: Record<string, any>;  // 查询参数
  status: number;          // HTTP 状态码
  duration: number;        // 响应时间（毫秒）
}

/**
 * 审计日志中间件
 *
 * 功能：
 * - 仅记录已认证用户的查询 API 请求（/api/query/*）
 * - 以 JSON Lines 格式追加到日志文件
 * - 记录请求的关键信息和响应时间
 *
 * 安全考虑：
 * - 日志文件权限应设置为 600（仅 owner 可读写）
 * - 敏感信息（如密码）不应记录
 * - 定期轮转日志文件（通过 logrotate）
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  // 记录请求开始时间
  const startTime = Date.now();

  // 监听响应完成事件
  res.on('finish', () => {
    try {
      // 过滤条件：仅记录已认证用户的查询 API
      if (!req.user || !req.originalUrl.startsWith('/api/query')) {
        return;
      }

      // 构建审计日志条目
      const logEntry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        username: req.user.username,
        userId: req.user.userId,
        role: req.user.role,
        organization: req.user.organization,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        method: req.method,
        path: req.originalUrl,
        query: req.query,
        status: res.statusCode,
        duration: Date.now() - startTime,
      };

      // 以 JSON Lines 格式追加到日志文件
      const logLine = JSON.stringify(logEntry) + '\n';

      // 确保日志目录存在
      const logDir = path.dirname(AUDIT_LOG_PATH);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      }

      // 追加到审计日志（异步，不阻塞响应）
      fs.appendFile(AUDIT_LOG_PATH, logLine, (err) => {
        if (err) {
          console.error('[Audit] 写入审计日志失败:', err);
        }
      });
    } catch (error) {
      // 审计日志失败不应影响业务请求
      console.error('[Audit] 审计日志记录异常:', error);
    }
  });

  next();
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
