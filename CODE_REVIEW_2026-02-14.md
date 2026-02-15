# Code Review - 2026-02-14

> 自动化审查报告 by Codex (gpt-5.3-codex)

## 变更概览

**分支**: `review/codex-review-2026-02-14`
**审查范围**: 最近代码变更 + 新增未跟踪文件

### 修改的文件
- `server/src/app.ts` - 添加审计日志中间件

### 新增的文件
- `server/src/middleware/audit.ts` - 审计日志中间件
- `deploy/vps-deploy.sh` - VPS 部署脚本
- `DEPLOYMENT_GUIDE.md` - 部署指南
- `vps.md` - VPS 信息文档
- `chexian-deploy.tar.gz` - 部署压缩包

---

## 发现的问题（按严重程度）

### 🔴 高风险

#### 1. 默认凭据被文档化和输出
- **位置**: `deploy/vps-deploy.sh:395`, `DEPLOYMENT_GUIDE.md:426`, `DEPLOYMENT_GUIDE.md:432`
- **问题**: 打印和使用 `admin / admin123` 作为默认密码
- **风险**: 鼓励使用弱密码，可能导致凭据复用和安全事故
- **建议**:
  - 使用环境变量或密钥管理服务
  - 首次登录强制修改密码
  - 生产环境禁止硬编码凭据

#### 2. 敏感基础设施信息以明文提交
- **位置**: `vps.md:13`, `vps.md:17`, `vps.md:26`, `vps.md:54`, `vps.md:55`, `vps.md:91`, `vps.md:142`
- **问题**: 包含公网 IP、实例 ID、root 登录配置、开放端口等敏感信息
- **风险**: 如果仓库被意外暴露，攻击面增大
- **建议**:
  - 将 `vps.md` 添加到 `.gitignore`
  - 使用私有文档系统存储基础设施信息
  - 定期轮换可能暴露的凭据

#### 3. 部署压缩包包含数据文件且未被忽略
- **位置**: `chexian-deploy.tar.gz` (22MB)
- **问题**: 包含 `dist/data/data.parquet` 和 `dist/data/premium-plan.parquet`，且 `.gitignore` 未忽略 `*.tar.gz`
- **风险**: 意外提交敏感数据文件
- **建议**:
  - 添加 `*.tar.gz` 到 `.gitignore`
  - 使用构建脚本在 CI/CD 中生成部署包
  - 不要将数据文件打包到代码仓库

---

### 🟡 中等风险

#### 4. 审计日志可能记录代理 IP 而非真实客户端 IP
- **位置**: `server/src/middleware/audit.ts:67`
- **问题**: 使用 `req.ip`，但 `server/src/app.ts` 未设置 `app.set('trust proxy', ...)`
- **风险**: 在 Nginx 反向代理后，日志可能只记录 127.0.0.1
- **建议**:
```typescript
// 在 app.ts 中添加
app.set('trust proxy', 1); // 信任第一层代理
```

#### 5. 审计路径过滤器可能遗漏请求
- **位置**: `server/src/middleware/audit.ts:56`
- **问题**: 在 `res.on('finish')` 回调中使用 `req.path.startsWith('/api/query')`
- **风险**: Express 路由可能重写 URL，导致 `req.path` 与原始路由不同
- **建议**:
```typescript
// 在中间件入口处捕获原始 URL
const originalPath = req.originalUrl;
res.on('finish', () => {
  if (originalPath.startsWith('/api/query')) {
    // 记录日志
  }
});
```

#### 6. 热路径中的同步文件系统操作
- **位置**: `server/src/middleware/audit.ts:80-81`
- **问题**: 每次请求完成时调用 `existsSync`/`mkdirSync`
- **风险**: 高负载下阻塞事件循环
- **建议**:
```typescript
// 在模块初始化时创建目录
const logsDir = path.dirname(AUDIT_LOG_PATH);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
```

---

### 🟢 低风险

#### 7. 行为与注释不匹配
- **位置**: `server/src/app.ts:45`
- **问题**: 注释说"生产环境"审计中间件，但实际无条件注册
- **建议**: 更新注释或添加环境判断

#### 8. 部署脚本与项目约定不一致
- **位置**: `deploy/vps-deploy.sh:103`, `DEPLOYMENT_GUIDE.md:116`
- **问题**: 使用 `npm install --production`，但项目强调使用 Bun
- **建议**: 统一使用 Bun 进行依赖安装

---

## 测试验证

- ✅ `server` 构建通过 (`npm run build`)
- ✅ `server` 测试通过 (`vitest`: 79/79)
- ⚠️ 未发现覆盖 `auditMiddleware` 的测试

---

## 待确认问题

1. `vps.md` 是否仅用于私有存储，还是应该对更广泛的仓库访问安全？
2. `admin/admin123` 是否仅为临时引导账户，是否实现了首次使用强制密码轮换？
3. 审计范围是否应仅包含 `/api/query/*`，还是应包含所有认证业务 API（`/api/data`, `/api/filters`, `/api/ai`）？

---

## 总结

本次审查发现了 3 个高风险、3 个中等风险和 2 个低风险问题。主要关注点是：
- 安全凭据管理
- 基础设施信息保护
- 审计日志的准确性
- 性能优化

建议在合并前解决高风险问题，并考虑添加审计中间件的单元测试。
