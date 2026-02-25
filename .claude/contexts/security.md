# Security Context

Mode: 安全审查与加固
Focus: 漏洞检测、安全合规、防御性编码

## Behavior
- 检查 OWASP Top 10 漏洞（SQL 注入、XSS、CSRF 等）
- 安全加固禁止删除整个模块/插件，只能修补漏洞
- 修改 rateLimiter.ts / security.ts 前必须列出影响范围并获用户确认
- 所有发现按严重性分级：CRITICAL > HIGH > MEDIUM > LOW

## Key Security Files
- SQL 验证器: `server/src/utils/security.ts`（文件名验证、路径验证、SQL 表名验证）
- 限流中间件: `server/src/middleware/rateLimiter.ts`（通用100/min、登录5/min、查询30/min）
- 审计日志: `server/src/middleware/audit.ts`
- JWT 认证: `server/src/middleware/auth.ts`
- 权限控制: `server/src/middleware/permission.ts`

## Security Checklist
- [ ] SQL 注入防护（参数化查询）
- [ ] XSS 防护（输出编码、React 自动转义）
- [ ] CORS 配置（COOP/COEP 头部）
- [ ] 文件上传（路径遍历防护、大小限制、类型验证）
- [ ] 认证/授权（JWT Token、权限过滤器）
- [ ] 限流策略（三级限流不可降低）
- [ ] 敏感数据（禁止 policy_no 明细查询、错误信息不泄露内部路径）
- [ ] 依赖安全（bun audit）

## Priorities
1. 修复 CRITICAL/HIGH 漏洞
2. 不破坏现有功能
3. 记录安全发现到 BACKLOG.md
