# Phase 4: 物化优化 - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

次要域惰性加载（仅 PolicyFact + 维度表 eager，其余首次请求触发）+ duckdb.ts 最大瘦身（≤100 行，删除代理方法，调用方直接引用拆分模块）。目标：启动内存 ~70% → ~50%，PM2 启动时间显著缩短。

</domain>

<decisions>
## Implementation Decisions

### MAT-02: duckdb.ts 关注点拆分（最大瘦身）
- **D-01:** duckdb.ts 瘦身到 ≤100 行。移出全部可拆分内容：
  - Parquet 指纹缓存 + `loadMultipleParquet` 增量逻辑 → `duckdb-parquet-loader.ts`（新文件）
  - `convertBigIntToNumber` → `duckdb-type-converter.ts`（新文件）
  - `init()` 中的建表逻辑（KpiPlanConfig / UserAccount / RoleConfig）→ `duckdb-init-tables.ts`（新文件）
  - 表/视图工具方法（`dropRelationIfExists` / `hasRelation` / `getTableSchema`）→ 合并到 `duckdb-infra.ts`
- **D-02:** 删除所有代理方法（~15 个 load*/materialize* 转发方法）。调用方（DataBootstrapper、测试文件）直接 import `duckdb-domain-loaders.ts` 或 `duckdb-materialization.ts`。**这是破坏性接口变更**，需要同步修改 `BootstrapDuckDB` 接口和所有调用方。
- **D-03:** 主类 DuckDBService 仅保留：构造函数、`init()`（委托到 init-tables）、`query()`、`invalidateCache()`、`close()`、`loadParquet()`（单文件，保留在主类）。
- **D-04:** 拆分后的文件结构：
  ```
  server/src/services/
  ├── duckdb.ts                    (≤100行，DuckDBService 主类 + 单例)
  ├── duckdb-types.ts              (13行，DuckDBQueryable 接口)
  ├── duckdb-infra.ts              (已有，ConnectionPool + QueryCache + 表工具)
  ├── duckdb-parquet-loader.ts     (新，指纹缓存 + loadMultipleParquet)
  ├── duckdb-type-converter.ts     (新，BigInt/DATE/TIMESTAMP 转换)
  ├── duckdb-init-tables.ts        (新，init 阶段建表逻辑)
  ├── duckdb-materialization.ts    (已有，478行，物化引擎)
  └── duckdb-domain-loaders.ts     (已有，490行，13个域加载器)
  ```

### MAT-01: 次要表惰性物化
- **D-05:** 惰性加载在 DataBootstrapper 层面实现。bootstrapper 注册各域的 lazy-loader，首次查询时触发加载。
- **D-06:** Eager 加载范围（启动时立即加载）：
  - `raw_parquet` → PolicyFact VIEW → PolicyFact 物化
  - SalesmanDim + PlanFact（维度表，体积小，所有页面都用）
- **D-07:** 惰性加载范围（首次请求触发）：由 Claude 根据各域大小和使用频率判断具体划分。参考原则：
  - 大体积域（ClaimsDetail ~254k行、ClaimsBulk、RenewalUniverse）必须惰性
  - 仅特定页面使用的域（CrossSell、CustomerFlow、QuoteConversion）惰性
  - 小体积维度表（PlateRegionDim、RepairDim、BrandDim）可根据实际内存影响决定
- **D-08:** API 行为：首次请求触发惰性加载时，**阻塞等待**加载完成后返回数据。前端不需要任何修改。后续请求正常速度。
- **D-09:** PolicyFact VIEW 解耦 CrossSellFact。修改 PolicyFact 视图定义，不再启动时引用 CrossSellFact。交叉销售相关字段在查询时动态 JOIN。这样 PolicyFact 可独立于 CrossSell 加载。
- **D-10:** 并发安全：两个请求同时触发同一张惰性表的加载时，使用 Promise 锁——第一个请求触发加载，第二个请求等待同一个 Promise 完成。

### Claude's Discretion
- 具体哪些小体积维度表保持 eager vs 惰性的最终判断
- lazy-loader 的内部实现细节（注册表结构、Promise 锁机制）
- PolicyFact VIEW 解耦 CrossSell 后，交叉销售字段的动态 JOIN SQL 设计
- 新拆分文件的内部组织和导出方式
- `BootstrapDuckDB` 接口重构的具体策略

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 核心拆分目标
- `server/src/services/duckdb.ts` — 666 行主类，待瘦身到 ≤100 行
- `server/src/services/duckdb-infra.ts` — 129 行，ConnectionPool + QueryCache，将合并表工具方法
- `server/src/services/duckdb-materialization.ts` — 478 行物化引擎，保持不变
- `server/src/services/duckdb-domain-loaders.ts` — 490 行域加载器，保持不变
- `server/src/services/duckdb-types.ts` — 13 行，DuckDBQueryable 接口

### 启动流程
- `server/src/services/data-bootstrapper.ts` — 420 行启动编排器，`loadAuxiliaryDomains()` 方法需重构为惰性模式
- `server/src/app.ts` L139-146 — 启动入口，调用 bootstrapper

### PolicyFact 视图定义
- `server/src/services/duckdb-materialization.ts` L160-223 — `createPolicyFactView` + `materializePolicyFactWorkingSet`，当前引用 CrossSellFact

### 测试文件（代理方法删除影响）
- `server/src/services/__tests__/duckdb-factory.test.ts`
- `server/src/services/__tests__/duckdb-derived-tables.test.ts`
- `server/src/services/__tests__/duckdb-materialize-batches.test.ts`

### 配置
- `server/src/config/database.ts` — databaseConfig + DUCKDB_INIT_OPTIONS
- `server/src/config/paths.ts` — 所有数据路径获取函数

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `duckdb-infra.ts` (ConnectionPool + QueryCache) — 已拆分，可扩展接收表工具方法
- `duckdb-domain-loaders.ts` — 13 个 load* 函数，已接收 DuckDBQueryable 接口，删除代理后调用方可直接使用
- `duckdb-materialization.ts` — 物化引擎已独立，`materializeInBatches` 支持 VPS 分批降内存

### Established Patterns
- 所有拆分模块函数签名第一个参数为 `db: DuckDBQueryable`，与主类解耦
- Phase 3 的 barrel re-export 先例：拆分后保持 import 路径兼容
- DataBootstrapper 使用 `BootstrapDuckDB` 接口抽象 DuckDB 依赖，但需重构

### Integration Points
- DataBootstrapper.loadAuxiliaryDomains() — 当前同步加载 7 个辅助域，需改为惰性注册
- PolicyFact VIEW 的 CrossSell 依赖 — bootstrap L297-304 先加载 CrossSell 再建视图
- duckdbService 单例 — 全局导出点，拆分后仍保留在 duckdb.ts

</code_context>

<specifics>
## Specific Ideas

- duckdb.ts 已经有良好的拆分基础（4 个辅助文件），本次是"最后一英里"瘦身
- DataBootstrapper 的 `BootstrapDuckDB` 接口需要重构——删除代理方法后，bootstrapper 直接 import 域加载器模块
- 内存监控验证：pm2 monit 观察启动后稳态内存变化

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-materialization*
*Context gathered: 2026-04-14*
