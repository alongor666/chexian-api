# chexian-api 最近 10 次提交代码审查报告

审查范围：`HEAD~10..HEAD`（2026-02-27 当日的 10 个提交）  
重点维度：代码质量/最佳实践、潜在 Bug 与安全、性能、架构设计、测试与文档

---

## Executive Summary

### 总体结论
- 本轮改动在性能优化与功能扩展上推进明显（新增 bundle 接口、请求合并、多 parquet 加载、权限管理页面）。
- 但存在**高风险权限设计缺口**：多个“受限功能”仅在前端拦截，后端未强制校验，存在 API 直调绕过风险。
- 角色模型出现设计不一致：前端/管理接口支持自定义角色，但后端权限中间件仅支持 3 个固定角色，可能导致生产账号 403。
- 测试全部通过（`bun run test`：51 文件、786 用例），但新增高风险权限链路覆盖不足。

### 风险分级汇总
- Critical: 1
- High: 2
- Medium: 4
- Low: 2

---

## Detailed Findings By Category

## 1) 代码质量与最佳实践

### [Low] QL-01 新增权限管理页大量硬编码样式，未复用统一样式系统
**证据**
- `src/features/admin/AccessControlPage.tsx:105`
- `src/features/admin/AccessControlPage.tsx:111`

```tsx
<div className="mt-1 p-3 rounded-lg border border-neutral-200 bg-neutral-50">
...
className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-white transition-colors"
```

**影响**
- UI 一致性和后续维护成本上升；与仓库既有“统一样式入口”约束不一致。

**建议**
- 迁移到 `src/shared/styles` / `src/shared/ui` 的统一样式能力，减少页面内 Tailwind 常量散落。

---

### [Low] QL-02 最近提交混入运行产物与抓取日志
**证据**
- `.playwright-cli/*`（29 个文件）
- `artifacts/perf/*`（4 个 benchmark JSON）
- 当前目录体积：`.playwright-cli` 约 `1.1M`

**影响**
- 仓库噪音增大、评审信噪比下降，且可能泄露调试上下文。

**建议**
- 将临时抓取产物纳入 `.gitignore`；仅保留必要基准报告摘要（非原始日志）。

---

## 2) 潜在 Bug / 安全问题

### [Critical] SEC-01 受限功能仅前端守卫，后端可被 API 直调绕过
**证据**
- 前端白名单守卫：
  - `src/app/App.tsx:17-33`
  - `src/shared/config/organizations.ts:354-377`
- 后端对应接口无白名单校验：
  - `server/src/routes/query.ts:613-616` (`/cost`)
  - `server/src/routes/query.ts:2260-2263` (`/fee-analysis`)

```ts
// 前端
if (!canAccessCost(userPermission?.username)) return <Navigate to="/" replace />;

// 后端 /cost
router.get('/cost', asyncHandler(async (req, res) => { ... }));
```

**影响**
- 任意已登录用户可直接请求 `/api/query/cost` / `/api/query/fee-analysis` 获取数据（绕过前端限制）。

**建议**
- 在后端新增强制路由 ACL 中间件（基于 `req.user.username` + `allowedRoutes` + 特殊白名单）；
- 对 `query.ts` 的高敏接口统一挂载服务端权限断言。

---

### [High] BUG-01 角色模型不一致：支持自定义角色，但权限中间件只识别 3 种
**证据**
- 角色创建/更新允许任意 role 字符串：
  - `server/src/routes/auth.ts:121-123`
- 权限中间件遇到未知角色直接拒绝：
  - `server/src/middleware/permission.ts:53-68`
- 前端权限管理页暴露“角色编码”可编辑：
  - `src/features/admin/AccessControlPage.tsx:540-546`

```ts
// auth.ts
role: z.string().min(1, 'Role is required')

// permission.ts
else { throw new AppError(403, 'Invalid user role'); }
```

**影响**
- 管理员创建的自定义角色账号登录后可能在查询接口全部 403；
- RoleConfig 的可配置能力与运行时权限判定脱节。

**建议**
- 二选一并统一：
  1. 仅允许固定角色（schema 改为 enum，前后端同源）；  
  2. 权限中间件改为读取 RoleConfig 的 `data_scope` 动态判定。

---

### [Medium] SEC-02 Cookie 解析未防御非法编码，存在 500 风险
**证据**
- `server/src/routes/auth.ts:42`
- `server/src/middleware/auth.ts:53`

```ts
return decodeURIComponent(pair.slice(key.length + 1));
```

**影响**
- 构造非法 `%` 编码 Cookie 时，`decodeURIComponent` 抛异常，可能导致请求 500（可用于低成本干扰）。

**建议**
- 封装 `safeDecodeURIComponent`（try/catch，失败返回原值或 null）并统一替换。

---

### [Medium] BUG-02 `loadParquet` 未处理 “VIEW -> TABLE” 类型切换
**证据**
- 单文件加载直接 `CREATE OR REPLACE TABLE`：
  - `server/src/services/duckdb.ts:365`
- 多文件路径已显式 `DROP VIEW/TABLE` 做类型切换：
  - `server/src/services/duckdb.ts:437-441`

**影响**
- 多文件模式后切回单文件模式时，`raw_parquet` 类型切换存在失败风险（当前防护不对称）。

**建议**
- 在 `loadParquet` 前也加 `DROP VIEW IF EXISTS` + `DROP TABLE IF EXISTS`，与多文件路径保持一致。

---

## 3) 性能考虑

### [Medium] PERF-01 路由级响应缓存未在数据重载后清空，存在短时脏读
**证据**
- 路由缓存为模块级 Map：
  - `server/src/routes/query.ts:112-143`
- 数据重载仅清理 DuckDB 查询缓存：
  - `server/src/services/duckdb.ts:247`
  - `server/src/routes/data.ts:342-345,603-606`

**影响**
- 上传/切换数据后，`dashboard-bundle` / `cross-sell-bundle` / `performance-bundle` 仍可能返回旧数据（30-60 秒）。

**建议**
- 为 `query.ts` 暴露 `clearRouteResponseCache()`，在 `/api/data/upload` 与 `/api/data/load/:filename` 成功后调用。

---

### [Medium] PERF-02 多 parquet 临时表清理不完整，长期可能造成存储膨胀
**证据**
- 每次按 `raw_parquet_{i}` 创建，但未清理“历史更大批次”遗留表：
  - `server/src/services/duckdb.ts:398-407`

**影响**
- 若某次加载 20 文件、下一次加载 2 文件，`raw_parquet_2...19` 可能残留。

**建议**
- 记录本次临时表集合，加载前统一清理 `raw_parquet_%`。

---

## 4) 架构与设计模式

### [High] ARCH-01 路由权限控制逻辑前后端分裂，未形成单一可信源
**证据**
- 后端查询路由统一仅挂 `authMiddleware + permissionMiddleware`：
  - `server/src/routes/query.ts:177-178`
- `allowedRoutes` 判定存在于前端：
  - `src/shared/config/organizations.ts:288-301`

**影响**
- 权限策略被拆为“前端可见性规则 + 后端数据范围规则”，缺少后端路由授权层，安全边界不闭合。

**建议**
- 将“路由授权”下沉到后端（例如 `routeAccessMiddleware`），前端仅用于 UX 提示。

---

## 5) 测试覆盖与文档

### [Medium] TEST-01 新增权限链路缺少后端回归测试
**证据**
- 当前测试覆盖了 SQL、客户端、上下文等，但未看到 `/cost`、`/fee-analysis`、`/auth/roles` 与后端 ACL 的专门测试。
- `bun run test` 全量通过（51 文件/786 用例），但该风险点未被当前测试模型拦截。

**建议**
- 新增 API 集成测试至少覆盖：
  1. 非白名单用户请求 `/api/query/cost`、`/api/query/fee-analysis` 应 403；  
  2. 自定义角色用户行为（若支持）与 `data_scope` 一致；  
  3. `allowedRoutes` 在后端生效（而非仅前端）。

---

## Specific Recommendations (优先级)

1. **P0**：在后端实现统一路由 ACL，并立即保护 `/api/query/cost` 与 `/api/query/fee-analysis`。  
2. **P0**：统一角色模型（固定角色 or 动态 RoleConfig），消除“可配置但不可运行”的状态。  
3. **P1**：修复 Cookie 解码异常处理，避免恶意 Cookie 触发 500。  
4. **P1**：补齐 `loadParquet` 的对象类型切换保护，避免单/多文件模式切换失败。  
5. **P1**：增加路由缓存失效钩子，数据加载后立即清空 bundle 缓存。  
6. **P2**：清理并忽略运行产物日志；补充权限相关测试与文档。

---

## 附：本次验证动作

- 已执行：`bun run test`  
- 结果：**通过**（`51` test files，`786` tests）  
- 备注：现有用例未覆盖上述核心权限风险场景，建议补充 API 级别回归用例。

