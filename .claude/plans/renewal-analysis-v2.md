# 续保分析板块全面重构

> **当前状态**: PLANNED
> **分支**: `refactor/renewal-analysis-v2`
> **创建日期**: 2026-04-10
> **关联 BACKLOG**: 待登记

## Context

续保分析模块历经增量修补，形成 6 SQL 文件 + 2 数据源 + V1/V2 混合下钻 + 12 前端文件的零散架构。经 2026-04-10 数据验证确认：
- 续保清单（`renewal/latest.parquet`）**完全冗余**——所有字段可从 PolicyFact + 报价清单推导
- `RenewalFunnel`（35K 行静态文件）应废弃
- 应续口径 = **上年起保 + 交商同保 + 排除摩托/挂车/拖拉机 + 排除退保**
- 客户来源去向可补充竞争维度（流失去向覆盖率 6.7%，转保来源 25.4%）
- **VPS 2核4G 内存红线**——采用 ETL 预计算（方案 A），VPS 只加载扁平 parquet

详细推导过程见 memory: `domain_renewal_universe.md`

## 已验证基准（2026-04-10）

```
应续宇宙: 117,213 VINs（PolicyFact 推算 117,214，差 1）
1-4月漏斗: 应续 45,156 → 已报价 40,708(90.1%) → 已续保 21,930(48.6%)
未报价流失: 4,408(9.8%)  报价未续: 18,818(41.7%)
竞争: 流失 TOP3 人保981/平安892/华农417  转保来源 TOP3 人保5606/锦泰4403/平安3467
```

---

## Phase 0: 阻塞问题解决

- [ ] **C1**: ETL 预计算 — 不在 VPS 做 4-way JOIN，本地产出 `renewal_universe/latest.parquet` 扁平表
- [ ] **C2**: 不新建 QuotesV2 VIEW — 旧 QuoteConversion 保留不变，报价 JOIN 在本地 ETL 完成
- [ ] **C3**: 路由/导航指向正确文件 — `SidebarNavigation.tsx` + `App.tsx`

## Phase 1: 数据层

- [ ] **1.1** 新建 `数据管理/pipelines/generate_renewal_universe.py`
  - 输入: `policy/current/*.parquet` + `quotes/latest.parquet` + `customer_flow/latest.parquet`
  - 输出: `warehouse/fact/renewal_universe/latest.parquet`（~120K 行 × ~30 列）
  - 交商同保筛选 + 2026 反查续保 + 报价聚合 + 竞争去向 + 漏斗阶段/优先级派生
- [ ] **1.2** `daily.mjs` 添加子命令 `renewal_universe`
- [ ] **1.3** `sync-vps.mjs` 添加 `renewal_universe/` 同步目录
- [ ] **1.4** `paths.ts` 新增 `getRenewalUniversePaths()`
- [ ] **1.5** `duckdb-domain-loaders.ts` 新增 `loadRenewalUniverse()` → `RenewalUniverse` VIEW
- [ ] **1.6** `data-bootstrapper.ts` 添加 RenewalUniverse 加载
- [ ] **1.7** `duckdb-materialization.ts` DERIVED_RELATIONS 添加 `'RenewalUniverse'`
- [ ] **1.8** 新建 `server/src/sql/renewal-universe.ts` — 8 个查询生成函数，全部基于扁平 VIEW
- [ ] **1.9** 新建 `server/src/sql/__tests__/renewal-universe.test.ts` — 单元测试
- [ ] **1.10** 指标注册表检查+新增（`due_count` / `quoted_count` / `quote_coverage_rate` / `quote_to_renewal_rate`）

**Gate**: 单元测试通过 + 本地 parquet 行数/已续/已报价与基准吻合

## Phase 1.5: VPS 内存压测

- [ ] 同步 `renewal_universe/latest.parquet` 到 VPS
- [ ] 触发 API 请求，监控 RSS 峰值
- [ ] **Gate**: RSS < 1.5GB

## Phase 2: API 层

- [ ] **2.1** 新建 `server/src/routes/query/renewal-v2.ts`
  - `GET /api/query/renewal-v2/overview` — Tab 1 续保总览
  - `GET /api/query/renewal-v2/funnel` — Tab 2 转化漏斗
  - `GET /api/query/renewal-v2/competition` — Tab 3 竞争格局
  - `GET /api/query/renewal-v2/action` — Tab 4 行动看板（含分页: `PaginatedResponse`）
- [ ] **2.2** `server/src/routes/query.ts` 注册新路由
- [ ] **2.3** `src/shared/api/routes.ts` 新增 `RENEWAL_V2` 路由常量
- [ ] **2.4** 保留旧路由（过渡期）
- [ ] **2.5** 集成测试 — curl 4 端点对照基准

**Gate**: 4 端点返回 200 + 数据与基准吻合

## Phase 3: 前端

- [ ] **3.1** 新建 `src/features/pages/RenewalAnalysisPage.tsx` — 4 Tab 页面
- [ ] **3.2** 新建 `src/features/renewal-v2/tabs/RenewalOverviewTab.tsx` — KPI + 月度走势 + 排名下钻
- [ ] **3.3** 新建 `src/features/renewal-v2/tabs/RenewalFunnelTab.tsx` — 漏斗图 + 流失归因
- [ ] **3.4** 新建 `src/features/renewal-v2/tabs/RenewalCompetitionTab.tsx` — 竞品进出 + 净流动
- [ ] **3.5** 新建 `src/features/renewal-v2/tabs/RenewalActionTab.tsx` — 待办清单 + 分页
- [ ] **3.6** 新建 `src/features/renewal-v2/hooks/useRenewalV2.ts` — 4 个 React Query hooks
- [ ] **3.7** `src/shared/api/client.ts` 新增 4 个 API 方法
- [ ] **3.8** `src/app/App.tsx` 添加路由 `/renewal-analysis`
- [ ] **3.9** `src/components/layout/SidebarNavigation.tsx` 添加导航项

**Gate**: `bun run build` 零 TS 报错 + 4 Tab 数据加载正常

## Phase 4: 分步清理

### P4a: 删除 RenewalFunnel 数据层
- [ ] 删 `server/src/sql/renewal-funnel.ts`
- [ ] 删 `server/src/routes/query/renewal-funnel.ts`
- [ ] 删 `src/features/dashboard/renewal-funnel/`（5 文件）
- [ ] 删 `数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet`
- [ ] 改 `duckdb-domain-loaders.ts` 移除 `loadRenewalFunnel()`
- [ ] 改 `data-bootstrapper.ts` 移除 RenewalFunnel 加载
- [ ] **验证**: `bun run build && bun run governance`

### P4b: 删除旧续保 SQL + 路由
- [ ] 删 `server/src/sql/renewal.ts`
- [ ] 删 `server/src/sql/renewal-drilldown.ts`
- [ ] 删 `server/src/sql/renewal-free-drilldown.ts`
- [ ] 删 `server/src/sql/renewal-distribution.ts`
- [ ] 保留 `server/src/sql/renewal-drilldown-shared.ts`（新代码复用）
- [ ] 删 `server/src/routes/query/renewal.ts`
- [ ] **验证**: `bun run build && bun run governance`

### P4c: 删除旧前端 + PolicyFactRenewal
- [ ] 删 `src/features/pages/RenewalPage.tsx`
- [ ] 删 `src/features/dashboard/RenewalAnalysisPanel.tsx`
- [ ] 删 `src/features/dashboard/RenewalDrilldownPanel.tsx`
- [ ] 删 `src/features/dashboard/RenewalQuadrantView.tsx`
- [ ] 删 `src/features/dashboard/hooks/useRenewalAnalysis.ts`
- [ ] 删 `src/features/dashboard/hooks/useRenewalDrilldown.ts`
- [ ] 改 `duckdb-materialization.ts` 移除 `PolicyFactRenewal` VIEW
- [ ] 改 `DERIVED_RELATIONS` 移除 `PolicyFactRenewal`
- [ ] **验证**: `bun run build && bun run governance`

---

## 关键设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| VPS 数据策略 | 方案 A: ETL 预计算 | 4-way JOIN 会 OOM（历史 177 次重启） |
| QuotesV2 VIEW | 不新建 | Schema 不兼容，ETL 阶段完成 JOIN |
| WHERE 构建器 | 新建轻量版 | 旧 DrilldownDimension 签名过重 |
| 续保清单 | 保留 ETL 但不作分析数据源 | 完全冗余，已验证 |
| 页面路由 | 独立 `/renewal-analysis` | 从 specialty Tab 升级 |
| 旧代码 | 分 3 步清理 | 降低风险，每步 build+governance 验证 |

---

## 影响范围清单（2026-04-10 全量扫描）

重构涉及 **50+ 文件**，以下按类别列出。标记 `[计划已覆盖]` 或 `[计划遗漏]`。

### 服务端代码

| 文件 | 影响 | 状态 |
|------|------|------|
| `server/src/sql/renewal.ts` | 删除 | [计划已覆盖] |
| `server/src/sql/renewal-drilldown.ts` | 删除 | [计划已覆盖] |
| `server/src/sql/renewal-free-drilldown.ts` | 删除 | [计划已覆盖] |
| `server/src/sql/renewal-distribution.ts` | 删除 | [计划已覆盖] |
| `server/src/sql/renewal-funnel.ts` | 删除 | [计划已覆盖] |
| `server/src/sql/renewal-drilldown-shared.ts` | 保留（新代码复用） | [计划已覆盖] |
| `server/src/routes/query/renewal.ts` | 删除 | [计划已覆盖] |
| `server/src/routes/query/renewal-funnel.ts` | 删除 | [计划已覆盖] |
| `server/src/routes/query.ts` | 移除旧 import + 注册，添加新路由 | [计划已覆盖] |
| `server/src/services/duckdb-materialization.ts` | 移除 PolicyFactRenewal VIEW | [计划已覆盖] |
| `server/src/services/duckdb-domain-loaders.ts` | 移除 loadRenewalFunnel()，新增 loadRenewalUniverse() | [计划已覆盖] |
| `server/src/services/duckdb.ts` | 移除 loadRenewalFunnel() 委托方法 | [计划遗漏] |
| `server/src/services/data-bootstrapper.ts` | 移除 RenewalFunnel 加载，新增 RenewalUniverse | [计划已覆盖] |
| `server/src/config/paths.ts` | 移除 getRenewalFunnelPaths()，新增 getRenewalUniversePaths() | [计划已覆盖] |
| `server/src/config/api-routes.ts` | 移除 RENEWAL/RENEWAL_DRILLDOWN/RENEWAL_FUNNEL 常量，新增 RENEWAL_V2 | [计划遗漏] |
| `server/src/config/capability-registry.ts` | 更新 id:'renewal' 的 route 指向新页面 | [计划遗漏] |
| `server/src/utils/sql-validator.ts` | PolicyFactRenewal 白名单 → 改为 RenewalUniverse | [计划遗漏] |

### 前端代码 — 删除

| 文件 | 状态 |
|------|------|
| `src/features/pages/RenewalPage.tsx` | [计划已覆盖] |
| `src/features/pages/index.ts`（移除 RenewalPage 导出） | [计划遗漏] |
| `src/features/dashboard/RenewalAnalysisPanel.tsx` | [计划已覆盖] |
| `src/features/dashboard/RenewalDrilldownPanel.tsx` | [计划已覆盖] |
| `src/features/dashboard/RenewalQuadrantView.tsx` | [计划已覆盖] |
| `src/features/dashboard/hooks/useRenewalAnalysis.ts` | [计划已覆盖] |
| `src/features/dashboard/hooks/useRenewalDrilldown.ts` | [计划已覆盖] |
| `src/features/dashboard/renewal-funnel/`（5 文件） | [计划已覆盖] |

### 前端代码 — 必须修改

| 文件 | 影响 | 状态 |
|------|------|------|
| `src/features/pages/SpecialtyPage.tsx` | 移除 renewal tab + RenewalFunnelPanel 引用（L15-188） | [计划遗漏] |
| `src/app/App.tsx` | 更新 /renewal 重定向指向 /renewal-analysis | [计划已覆盖] |
| `src/shared/api/routes.ts` | 移除旧常量，新增 RENEWAL_V2 | [计划遗漏 — 只说了+8行] |
| `src/shared/api/client.ts` | 移除 10 个旧方法，新增 4 个新方法 | [计划遗漏 — 只说了+4] |
| `src/shared/api/query-keys.ts` | 移除 10 个旧 key，新增 4 个 | [计划遗漏] |
| `src/shared/config/organizations.ts` | 更新 `/renewal` 重定向映射 | [计划遗漏] |
| `src/shared/config/drilldown-dimensions.ts` | 评估 RENEWAL_DIMENSIONS 是否迁移到新代码 | [计划遗漏] |
| `src/shared/ui/RenewalStatusBadge.tsx` | 评估是否复用于新 Tab 1 排名表 | [计划遗漏] |
| `src/shared/components/QuickFilterBar.tsx` | renewalType 快捷筛选是否保留 | [计划遗漏] |

### AI Insights 模块（完全遗漏）

| 文件 | 影响 | 状态 |
|------|------|------|
| `src/shared/ai-insights/types.ts` | `RenewalDataContext` 类型定义 | [计划遗漏] |
| `src/shared/ai-insights/context-builder.ts` | `buildRenewalContext()` 函数 | [计划遗漏] |
| `src/shared/ai-insights/prompts.ts` | `RENEWAL_INSIGHT_PROMPT` 常量 | [计划遗漏] |
| `src/shared/ai-insights/index.ts` | 续保相关导出 | [计划遗漏] |
| `src/shared/ai-insights/hooks/usePageInsights.ts` | `RenewalDataContext` 使用 | [计划遗漏] |
| `src/shared/ai-insights/insight-generator.ts` | `RenewalDataContext` 使用 | [计划遗漏] |

### 测试文件

| 文件 | 影响 | 状态 |
|------|------|------|
| `server/src/sql/__tests__/drilldown-contract.renewal.test.ts` | 删除（测旧 SQL） | [计划遗漏] |
| `server/src/services/__tests__/duckdb-derived-tables.test.ts` | 更新 PolicyFactRenewal 断言 | [计划遗漏] |
| `tests/api/client.test.ts` | 移除 getRenewalAnalysis 测试 | [计划遗漏] |
| `tests/e2e/03-cleanup-zero-downtime-gate.spec.ts` | 更新 tab=renewal 路径 | [计划遗漏] |
| `tests/e2e/04-subpage-no-refresh.spec.ts` | 更新 /renewal 路径 | [计划遗漏] |
| `tests/route-redirect-guards.test.tsx` | 更新 /renewal 守卫测试 | [计划遗漏] |
| `src/shared/utils/__tests__/sql-validator.test.ts` | 更新 PolicyFactRenewal 白名单 | [计划遗漏] |
| `src/shared/ai-insights/__tests__/`（3 个测试文件） | 更新 RenewalDataContext 相关 | [计划遗漏] |

### 配置与注册表

| 文件 | 影响 | 状态 |
|------|------|------|
| `数据管理/data-sources.json` | 更新 renewal_funnel/renewal_v2 域元数据 | [计划遗漏] |
| `server/src/config/metric-registry/categories/ratio.ts` | 评估 renewal_rate 是否更新 | [计划已覆盖] |
| `server/src/config/field-registry/fields.json` | 保留（is_renewal 等字段不变） | 安全 |

### 文档

| 文件 | 影响 | 状态 |
|------|------|------|
| `CLAUDE.md` | 更新 API 前缀清单、关键文件列表 | [计划遗漏] |
| `PROGRESS.md` | 登记续保重构进展 | [计划遗漏] |
| `BACKLOG.md` | 登记任务 | [计划已提及] |
| `开发文档/00_index/CODE_INDEX.md` | 更新 SQL/路由索引 | [计划遗漏] |

### 数据管理层

| 文件 | 影响 | 状态 |
|------|------|------|
| `数据管理/daily.mjs` | 新增 renewal_universe 子命令 | [计划已覆盖] |
| `scripts/sync-vps.mjs` | 新增 renewal_universe 同步 | [计划已覆盖] |
| `数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet` | 删除 | [计划已覆盖] |

### 不受影响（安全）

以下文件含 `renewal` 引用但属于通用字段/工具，不因重构而改变：
- `src/shared/utils/queryBuilder.ts`（通用 is_renewal 筛选）
- `src/shared/utils/filterParams.ts`（通用参数序列化）
- `src/shared/utils/alertChecker.ts`（独立工具函数）
- `src/shared/types/kpi.ts`、`alert.ts`（字段类型定义）
- `tests/performance-sql.test.ts`、`cross-sell-sql.test.ts`（通用字段测试）
- `tests/fixtures/realData.ts`（fixture 数据）
