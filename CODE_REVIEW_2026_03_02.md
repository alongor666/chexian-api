# 代码审查报告（2026-03-02）

## 一、审查范围与变更摘要

### 1. 时间范围
- 审查提交时间：**2026-02-22 至 2026-03-01**（过去一周）

### 2. 重点审查文件（高频/高风险）
- 后端查询与权限：`server/src/routes/query.ts`、`server/src/middleware/permission.ts`
- 认证与会话：`server/src/routes/auth.ts`、`server/src/services/auth.ts`
- AI 路由：`server/src/routes/ai.ts`
- 前端 API 客户端：`src/shared/api/client.ts`
- DuckDB 服务与缓存：`server/src/services/duckdb.ts`

### 3. 本周主要改动主题
- 查询聚合端点和 Bundle 化（`/cross-sell-bundle`、`/plan-achievement`、`/comprehensive-bundle`）
- 多层缓存与性能优化（路由缓存、ETag、前端 GET 缓存、DuckDB 查询缓存）
- 权限与认证增强（角色过滤、电销过滤、Cookie 会话刷新）
- 交叉销售/绩效/综合分析功能扩展

---

## 二、Critical Issues（必须优先修复）

### 1) `premium-plan` / `plan-achievement` 端点未应用 `permissionFilter`，存在数据越权风险

- 位置：
  - `server/src/routes/query.ts:1630`
  - `server/src/routes/query.ts:1725`
- 问题：
  - 路由已经过 `permissionMiddleware`，但这两个端点生成 SQL 时仅依赖前端参数与 `org_user` 特例（`forcedOrg`），**未将 `req.permissionFilter` 注入查询条件**。
  - 对 `telemarketing_user`（`req.permissionFilter = 'is_telemarketing = true'`）没有强制过滤，若角色路由配置放行，会返回非电销数据。
- 影响：
  - 行级权限可能失效，属于高风险数据隔离漏洞。
- 建议：
  - 在这两个端点统一走 `parseFiltersAndBuildWhere/parseFiltersAndBuildBothWhere` 或显式将 `req.permissionFilter` 注入 SQL 生成器。
  - 为 `branch_admin/org_user/telemarketing_user` 三种角色补充 API 合同测试（尤其断言 `telemarketing_user` 数据隔离）。

### 2) 续保 `queryType=full` 的辅助查询未应用权限过滤，导致范围信息泄露

- 位置：
  - `server/src/routes/query.ts:1134`
  - `server/src/routes/query.ts:1144`
- 问题：
  - `availableMonthsSql` 与 `latestDateSql` 直接查询 `PolicyFact`，未附加 `req.permissionFilter` 或从 `filters` 派生的同等约束。
- 影响：
  - 受限账号可观察到全局数据覆盖月份/最新日期，属于数据范围旁路泄露。
- 建议：
  - 两条 SQL 都必须附加与详情查询一致的权限条件（建议复用统一 where builder，避免手写分叉）。

### 3) 前端响应缓存未按会话隔离且未在登出时清空，存在跨账号数据复用风险

- 位置：
  - `src/shared/api/client.ts:305`
  - `src/shared/api/client.ts:493`
  - `src/shared/api/client.ts:699`
- 问题：
  - GET 缓存 key 基于 `endpoint`，不含用户身份；`logout()` 只清 token，不清 `responseCache`。
  - 同浏览器切换账号时，1 分钟 TTL 内可能读到上一账号缓存响应。
- 影响：
  - 前端层面的数据隔离漏洞（尤其在共享终端或运维代登录场景）。
- 建议：
  - `logout()` 与登录成功后统一清空 `responseCache`。
  - 缓存 key 增加用户维度（如 `username/role/org` 哈希），或对敏感接口禁用前端缓存。

---

## 三、Warnings 与改进建议

### 1) AI 趋势分析缓存为无上限 Map，存在内存增长风险
- 位置：`server/src/routes/ai.ts:77`
- 说明：仅使用 `expiresAt` 判断命中，没有定期清理和容量上限，长时间运行会堆积过期键。
- 建议：使用 LRU + TTL（含最大容量）或定时清扫。

### 2) 类型安全存在 `any` 扩散，降低回归防护
- 位置示例：
  - `server/src/routes/query.ts:1315`
  - `server/src/routes/query.ts:1876`
  - `src/shared/api/client.ts:843`
  - `src/shared/api/client.ts:865`
- 说明：多处 `Record<string, any>` / `Promise<any>` / `as any`。
- 建议：
  - 为 drillPath、聚合响应、计划达成响应建立显式 DTO 类型。
  - 优先消除路由层 `any`，因为这里是输入边界。

### 3) 提交产物治理回归
- 证据：本周 `test_output.txt`、`vitest_log.txt` 出现提交记录。
- 说明：与仓库治理规则冲突，会干扰代码审查焦点。
- 建议：继续通过 `.gitignore + pre-commit` 阻断调试产物入库。

### 4) 注释与实现存在轻微漂移
- 位置：`server/src/app.ts:67` 注释写“查询 30 次/分钟”，`rateLimiter` 实际是 200 次/分钟。
- 影响：运维和容量预估易误判。
- 建议：同步注释与配置，避免文档口径偏差。

---

## 四、按维度审查结论

### 1) 代码质量与最佳实践
- 优点：
  - 路由层普遍使用 `zod` 校验，错误处理统一 `AppError`。
  - 复杂查询拆到 SQL 生成器，整体可维护性较好。
- 问题：
  - `query.ts` 体量过大（单文件承载过多业务上下文），建议按域拆分 router 模块（renewal/cross-sell/performance/comprehensive）。

### 2) 安全（SQL 注入 / XSS / 认证）
- SQL 注入：
  - 大部分字符串过滤已做转义（`escapeSqlValue` / `escapeSqlString`），风险可控。
  - 主要风险不在注入，而在**权限过滤遗漏**（见 Critical）。
- XSS：
  - 本次审查范围内未发现明显 `dangerouslySetInnerHTML` 风险点。
- 认证：
  - Cookie 会话刷新链路可用，但前端缓存隔离问题会削弱整体安全边界。

### 3) 性能
- 优点：
  - Bundle 路由 + Promise.all + 预聚合读取，方向正确。
  - QueryCache/RouteCache/前端缓存形成分层缓存体系。
- 风险：
  - AI 缓存无上限；前端缓存会话不隔离。

### 4) TypeScript 类型安全
- 优点：
  - schema + enum 使用较广。
- 不足：
  - 边界层仍有较多 `any`，尤其 API client 返回值和 drillPath 解析。

### 5) 错误处理
- 优点：
  - 路由层失败路径多数有 4xx/5xx 明确反馈。
- 建议：
  - 前端 `request()` 里 `response.json()` 可补充非 JSON 响应兜底（避免上游异常页导致二次异常信息丢失）。

### 6) 组织与架构
- 优点：
  - API 模式、预聚合思路与性能目标一致。
- 建议：
  - 继续推进“权限注入 helper + contract tests”模板化，避免在各路由手工拼接权限。

---

## 五、最佳实践建议（落地优先级）

1. **P0（立即）**：修复 `premium-plan/plan-achievement/renewal(full)` 的权限过滤遗漏，并补角色隔离测试。  
2. **P0（立即）**：前端 `logout/login` 时清空 `responseCache`，并把缓存 key 绑定用户上下文。  
3. **P1（本周）**：为 `ai.ts` 趋势缓存加容量上限与过期清扫。  
4. **P1（本周）**：消除关键边界 `any`，先从 `query.ts` drillPath 与 `api/client.ts` 的 `Promise<any>` 入手。  
5. **P2（迭代）**：拆分 `query.ts` 为多域 router，降低变更冲突与回归面。  

---

## 六、结论

- 本周改动在性能工程和功能交付上推进明显，但存在**权限过滤一致性**与**缓存会话隔离**两类高风险问题。  
- 在修复上述 Critical 问题并补齐回归测试前，不建议将相关能力视为“权限安全已完成”。
