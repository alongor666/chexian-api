# Phase 2: SQL 查询优化 - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

建立全接口黄金快照回归基线，删除系数监控板块（前后端全链路），清理关联依赖。不涉及 earned-premium-detail.ts 合并决策（用户明确搁置）。

**与 ROADMAP 原始描述的偏差：** ROADMAP 写的是"重写 coefficient.ts 消灭 2-5s 慢查询"，用户决策改为**直接删除系数监控功能**。原 SQL-02 需求（CTE 窗口函数重写）不再适用，替换为功能删除。

</domain>

<decisions>
## Implementation Decisions

### SQL-01: 黄金快照回归基线
- **D-01:** 全部 50+ 个 API 端点纳入回归基线，不做"核心/非核心"筛选。使用已有 `bun run snapshot:build` 基础设施。
- **D-02:** 回归验证精度要求**每个字段误差为零** — 严格精确匹配，不接受浮点容忍度。若浮点聚合字段因重构导致精度差异，视为回归 bug。

### SQL-02: 系数监控板块删除（替代原 CTE 重写）
- **D-03:** 系数监控功能从产品中**整体移除**，非重构。包含前端页面、后端 API 路由、SQL 生成器、单元测试全链路清理。
- **D-04:** 删除清单（后端）：
  - `server/src/sql/coefficient.ts`（494 行 SQL 生成器）
  - `server/src/routes/query/coefficient.ts`（API 路由）
  - `server/src/config/coefficient-thresholds.ts`（阈值配置）
  - `server/src/sql/__tests__/coefficient.test.ts`（单元测试）
  - `server/src/utils/coefficient-period.ts`（工具函数 — 需先迁移 `formatDate`）
  - `query.ts` 中的 `coefficientRoutes` 注册
- **D-05:** 删除清单（前端）：
  - `src/features/coefficient/` 整个目录（组件、hooks、utils、types）
  - `src/features/pages/CoefficientPage.tsx`（页面入口）
  - `src/shared/utils/coefficient-period.ts`（共享工具）
  - `App.tsx` 中的路由注册
  - `SidebarNavigation.tsx` 中的导航项
  - `src/shared/api/routes.ts`、`client.ts`、`query-keys.ts` 中的系数相关定义
- **D-06:** `formatDate` 函数（`server/src/utils/coefficient-period.ts`）被 `server/src/sql/cost/earned-premium.ts` 引用，删除前必须将其迁移到通用工具位置（如 `server/src/utils/date.ts`）。
- **D-07:** `performance-heatmap.ts` 中的 `avg_pricing_coefficient` 字段**保留不动** — 它直接用 `commercial_pricing_factor` 内联计算，不依赖 coefficient.ts 的任何导出。

### SQL-03: 满期保费明细
- **D-08:** 用户明确搁置，本阶段不处理 earned-premium-detail.ts 的 EXPLAIN ANALYZE 决策。

### Claude's Discretion
- `formatDate` 迁移的具体目标文件路径
- 黄金快照基线的存储格式和对比脚本实现细节
- 删除顺序（先建基线再删除，确保基线包含系数接口的最后一份快照）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 系数监控（待删除模块）
- `server/src/sql/coefficient.ts` — 494 行 SQL 生成器，6 个导出函数 + 12 路 UNION ALL 批量查询
- `server/src/routes/query/coefficient.ts` — API 路由处理器，3 种 queryType（byOrg/full/batch）
- `server/src/config/coefficient-thresholds.ts` — ORG_GROUPS 和阈值配置
- `server/src/utils/coefficient-period.ts` — formatDate / getLastDayOfMonth / DateRange 类型定义
- `src/features/coefficient/` — 前端完整模块（组件 × 5 + hooks × 1 + utils × 3 + types × 1）
- `src/features/pages/CoefficientPage.tsx` — 页面入口

### 关联引用（不删除但需检查）
- `server/src/sql/cost/earned-premium.ts` L11 — 引用 `formatDate`，删除 coefficient-period.ts 前必须迁移
- `server/src/sql/performance-heatmap.ts` L343 — 独立使用 `commercial_pricing_factor`，不依赖 coefficient 模块
- `server/src/routes/query.ts` L18 — coefficientRoutes 注册行，需移除
- `src/shared/api/routes.ts` / `client.ts` / `query-keys.ts` — 系数相关 API 定义

### 快照基础设施
- `scripts/build-snapshots.mjs` — 快照构建脚本入口
- `数据管理/warehouse/snapshots/` — 快照文件存储目录
- `server/src/middleware/snapshot-serve.ts` — Phase 1 已修复 scope 碰撞

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bun run snapshot:build` — 已有快照构建脚本，可直接用于黄金基线
- `bun run snapshot:verify` — 已有 dry-run + 健康检查，可扩展为回归对比

### Established Patterns
- SQL 生成器模块删除先例：项目中有过类似清理（如旧架构 `loadDomainParquet` 删除）
- 路由注册集中在 `query.ts`，删除路由只需移除 import + use 行
- 前端页面注册在 `App.tsx` 路由表 + `SidebarNavigation.tsx` 导航项

### Integration Points
- 系数路由在 `query.ts` L18 注册为 `coefficientRoutes`
- 前端导航在 `SidebarNavigation.tsx` 中有"系数监控"菜单项
- `AdvancedFilterPanel.tsx` 和 `SidebarFilterPanel.tsx` 可能有系数相关的筛选配置

</code_context>

<specifics>
## Specific Ideas

- 用户确认业绩分析热力图中的"平均自主系数"字段是独立计算的，保留不动
- 删除系数板块是产品决策（功能下线），不是技术重构
- 黄金快照应在删除系数接口之前建立，确保基线完整性

</specifics>

<deferred>
## Deferred Ideas

- **SQL-03 满期保费明细 EXPLAIN ANALYZE** — 用户暂时忘了具体上下文，搁置到后续阶段或需求明确后再处理
- **ROADMAP 更新** — Phase 2 的 Success Criteria 需要同步更新（移除 coefficient 响应时间指标，新增删除完整性验证）

</deferred>

---

*Phase: 02-sql*
*Context gathered: 2026-04-12*
