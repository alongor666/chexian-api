---
paths: ["server/src/routes/**", "server/src/middleware/**", "server/src/utils/logger.ts"]
---

# API 路由规则

## 路由追加规则（RED LINE）

`server/src/routes/query.ts`：不得删除已有路由，只能追加新路由，需 BACKLOG.md 登记。

## JWT 认证

所有 `/api/*` 必须经过认证中间件，**禁止绕过**。

## ESM 部署三坑

1. TS → ESM 不自动加 `.js` 扩展名 — 导入路径需手动补 `.js`
2. ESM 无 `__dirname` — 用 `fileURLToPath(import.meta.url)` 替代
3. Express 路由用 `req.originalUrl`（非 `req.url`）

## 前端新增 API 方法

前端新增 apiClient 方法时，**必须确认后端路由存在**。

## 错误处理（统一收口于 `server/src/middleware/error.ts`）

> 通用 backend-patterns 第 6 项的项目落地。错误处理已在 `app.ts` 装配，新增路由禁止自造错误格式。

| 规则 | 做法 |
|------|------|
| 已知业务错误抛 `AppError` | `throw new AppError(statusCode, message)`，勿在路由里手写 `res.status(4xx).json(...)` 拼错误体 |
| 异步路由用 `asyncHandler` 包裹 | `asyncHandler(async (req,res)=>{…})` 自动 `.catch(next)` 转交 `errorHandler`，避免未捕获 Promise 拒绝 |
| 错误响应体固定信封 | `{ success:false, error:{ message, statusCode } }`，由 `errorHandler` 统一产出；前端按此解析 |
| 生产不泄漏堆栈 | `errorHandler` 在 `NODE_ENV=production` 把 message 隐藏为 `Internal Server Error`；禁止路由内 `res.json({ error: err.stack })` |
| 404 走 `notFoundHandler` | 不自造 404 体 |

## 日志（统一收口于 `server/src/utils/logger.ts`，禁裸 `console.log`）

> 通用 backend-patterns 第 11 项的项目落地。与全局 `typescript/coding-style.md`「禁生产 console.log」一致，此处给出本项目实现入口。

| 规则 | 做法 |
|------|------|
| 用统一 logger，禁生产裸 `console.log` | 从 `server/src/utils/logger.ts` 导入 `logger` / `createLogger`；模块级日志 `const log = createLogger('模块名')` |
| 分级输出 | `logger.debug/info/warn/error`；生产默认仅 `warn` 及以上（`logger.ts` 按 `NODE_ENV` 自动设级） |
| 访问审计勿手写 | 已认证查询 API 的访问审计由 `server/src/middleware/audit.ts`（`auditMiddleware`）自动落结构化 `logs/audit.log`（`AuditLogEntry`：request_id / route_key / query_hash / user / ip / cache_hit…）；新增审计字段改 `AuditLogEntry`，勿另起日志文件 |
