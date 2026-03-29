---
paths: ["server/src/middleware/rateLimiter.ts", "server/src/utils/security.ts"]
---

# 安全配置规则

## 限流三级（禁止降低）

| 类别 | 限制 |
|------|------|
| 通用 | 100/min |
| 登录 | 5/min |
| 查询 | 200/min |

修改 `rateLimiter.ts` / `security.ts` 前，**必须列出影响范围并获得用户确认**。

## 文件名验证

`server/src/utils/security.ts` 使用危险字符黑名单（非白名单），支持中文。

## 生产无数据排查

检查 `/api/data/files` → 检查 `sanitizeFilename()` 是否拒绝了中文文件名。
