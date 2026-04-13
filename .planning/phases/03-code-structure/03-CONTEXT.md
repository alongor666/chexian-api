# Phase 3: 代码结构整理 - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

SQL 生成器大文件拆分（trend.ts + performance-analysis-shared.ts）+ 前端包体优化（visualizer 基线 + 压缩插件替换 + ECharts 懒加载验证）+ FilterContext 拆分。纯代码结构和构建优化，不涉及业务逻辑变更或新功能。

</domain>

<decisions>
## Implementation Decisions

### SQL-04: SQL 生成器模块拆分
- **D-01:** `trend.ts`（561行）拆为 `sql/trend/` 子目录模式，复用 `sql/cost/` 先例（shared.ts + 按功能分文件），单文件不超过 400 行。
- **D-02:** `performance-analysis-shared.ts`（545行）拆为 `sql/performance-analysis/` 子目录模式，同上。
- **D-03:** 拆分后原文件改为 re-export barrel（`export * from './trend/index.js'`），保持现有 import 路径不变，零调用方修改。

### FE-01: Bundle 基线测量
- **D-04:** 安装 `rollup-plugin-visualizer`，运行 `bun run build` 后生成 stats.html，存档到 `.planning/phases/03-code-structure/bundle-baseline.html` 作为优化前基线。

### FE-02: 压缩插件替换
- **D-05:** `vite-plugin-compression` 0.5.1（停更 4 年）替换为 `vite-plugin-compression2` 最新版。替换后 `bun run build` 零警告，brotli/gzip 产物正常生成。

### FE-03: ECharts 懒加载验证
- **D-06:** 验证 ECharts chunk 是否已按需加载（通过 visualizer 报告确认 chunk 分离状态）。若已分离，仅存档确认结论；若未分离，使用 `React.lazy` + dynamic import 将图表组件改为按需加载。

### FE-04: FilterContext 拆分
- **D-07:** `FilterContext.tsx` 拆分为两个 Context：`StableContext`（用户信息、权限、不常变的配置）和 `FilterContext`（筛选条件、日期范围等易变状态）。筛选条件变更不触发 StableContext 消费者重渲染。

### Claude's Discretion
- trend.ts 和 performance-analysis-shared.ts 内部函数的具体分组逻辑
- visualizer 插件的具体配置选项
- FilterContext 拆分后的具体 Provider 嵌套顺序
- ECharts 懒加载的具体 Suspense fallback UI

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SQL 拆分目标
- `server/src/sql/trend.ts` — 561 行，待拆分
- `server/src/sql/performance-analysis-shared.ts` — 545 行，待拆分
- `server/src/sql/cost/` — 已有子目录先例（shared.ts + earned-premium.ts + earned-premium-detail.ts + cost-ratios.ts）

### 前端包体
- `vite.config.ts` — Vite 构建配置，压缩插件注册位置
- `package.json` — `vite-plugin-compression` 0.5.1 当前依赖

### FilterContext
- `src/shared/contexts/FilterContext.tsx` — 当前混合 Context，待拆分
- `src/shared/contexts/AuthContext.tsx` — 认证 Context（参考模式）
- `src/shared/contexts/PermissionContext.tsx` — 权限 Context（参考模式）

### 治理
- `scripts/check-governance.mjs` — governance 检查 #21 校验 SQL 模块数与 CODE_INDEX 一致
- `开发文档/00_index/CODE_INDEX.md` — SQL 模块索引，拆分后需更新

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sql/cost/` 子目录模式 — 4 文件拆分先例，shared.ts 导出公共工具
- `sql/performance-analysis/` — 已有子目录（但 performance-analysis-shared.ts 还在外层）
- `sql/growth/` — 另一个子目录先例

### Established Patterns
- SQL 生成器 re-export barrel：`sql/cost.ts` 仅做 `export * from './cost/xxx.js'`
- FilterContext 使用 React Context + useReducer，所有筛选状态集中管理
- ECharts 通过 `import('echarts')` 动态加载（需验证是否生效）

### Integration Points
- `server/src/routes/query/` 各路由文件 import SQL 生成器 — 拆分后 barrel export 保持路径不变
- `src/app/App.tsx` 的 Provider 嵌套层级 — FilterContext 拆分后需调整
- `bun run governance` 检查 #21 — SQL 模块数需与 CODE_INDEX 一致

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-code-structure*
*Context gathered: 2026-04-13*
