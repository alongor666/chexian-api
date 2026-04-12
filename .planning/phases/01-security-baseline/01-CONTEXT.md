# Phase 1: 安全基线 - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

修复快照层 scope 碰撞漏洞，确保不同权限用户访问相同端点时命中各自独立的快照文件。同时构建 org scope 快照（已知机构列表），使 admin 和 leshan 各自命中独立快照。不涉及 SQL 重写、前端改动或新功能。

</domain>

<decisions>
## Implementation Decisions

### SEC-01: scope 碰撞修复
- **D-01:** `permissionToScope()` 返回类型从 `string` 改为 `string | null`。未知/无法识别的权限返回 `null`（而非当前的 `'unknown'` 字符串）。
- **D-02:** `snapshotServe` 中间件在 `scope === null` 时直接调用 `next()`，不尝试查找快照文件。类型系统强制调用方处理 null，编译器保证不遗漏。

### SEC-02: 权限隔离验证
- **D-03:** 扩展现有 `tests/e2e/verify-org-permissions.spec.ts`，新增测试场景：admin 登录请求 `/api/query/kpi` → 检查 `X-Snapshot` 头；leshan 登录请求同一端点 → 检查 `X-Snapshot` 头指向不同文件。验证端到端 auth→permission→snapshot 全链路隔离。
- **D-04:** 不新建测试文件，复用已有 E2E spec 中的 `loginAsUser` 辅助函数和 retry 逻辑。

### 快照构建范围
- **D-05:** 仅为已知机构（从 `preset-users.ts` 预配置用户列表提取）构建 org scope 快照，不动态查询 DuckDB 机构列表。
- **D-06:** admin（branch_admin 权限，scope=all）和 leshan（org 权限，scope=乐山）各自命中独立快照文件，不共享任何快照。

### Claude's Discretion
- 快照目录结构细节（`{bundle}/{scope}/{paramHash}.json` 已有模式，沿用即可）
- E2E 测试中具体 assertion 写法和 retry 策略

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 快照中间件
- `server/src/middleware/snapshot-serve.ts` — permissionToScope (L94) + snapshotServe (L146)，核心修复位置
- `server/src/config/preset-users.ts` — 预配置用户列表，决定哪些 scope 需要构建快照

### 现有测试
- `tests/e2e/verify-org-permissions.spec.ts` — 已有权限验证 E2E spec，SEC-02 在此扩展
- `tests/middleware/snapshot-serve.test.ts` — 已有单元测试，permissionToScope 返回值变更后需同步更新

### 快照构建
- `scripts/snapshot-build.ts` 或 `bun run snapshot:build` — 快照构建入口，需支持 org scope 构建
- `数据管理/warehouse/snapshots/` — 快照文件存储目录结构

### 权限系统
- `server/src/services/access-control.ts` — 权限控制服务，permissionFilter 生成逻辑
- `server/src/config/api-routes.ts` — API 路由配置

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `verify-org-permissions.spec.ts` — 已有 loginAsUser 辅助函数、cookie 注入、retry 逻辑
- `snapshot-serve.test.ts` — 已有 permissionToScope 和 computeParamHash 测试用例
- `snapshot-serve.ts` L117 `resolveSnapshotPath()` — 快照路径解析，scope 改 null 后此处自然短路

### Established Patterns
- 快照目录结构：`{snapshotDir}/{bundleName}/{scope}/{paramHash}.json`
- E2E 测试使用 `@playwright/test`，通过 `page.request.post` 做 API 调用
- 响应头 `X-Snapshot: hit|miss|stale|error` 用于区分快照命中状态

### Integration Points
- `permissionToScope()` 被 `snapshotServe` 调用（L154），返回值直接用于目录路径
- `bun run snapshot:build` 构建快照时也调用 `permissionToScope` 或类似逻辑确定 scope 目录

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求 admin 和 leshan 作为两个验证角色，对应 branch_admin (all) 和 leshan (org-level)
- 快照隔离的验证信号是 `X-Snapshot` 响应头中的路径信息
- 凭据：admin/CxAdmin@2026! 和 leshan/leshan123

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-security-baseline*
*Context gathered: 2026-04-12*
