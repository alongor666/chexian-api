---
paths: ["server/src/routes/**"]
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
