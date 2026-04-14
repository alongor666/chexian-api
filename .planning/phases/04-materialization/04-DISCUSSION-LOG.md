# Phase 4: 物化优化 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 04-materialization
**Areas discussed:** duckdb.ts 瘦身范围, 惰性加载触发机制

---

## duckdb.ts 瘦身范围

### Q1: 瘦身到 ≤100 行，哪些东西该移出？

| Option | Description | Selected |
|--------|-------------|----------|
| 最大瘦身 | 移出全部可拆分内容：Parquet 指纹+loadMultipleParquet → parquet-loader.ts，类型转换 → type-converter.ts，init() 中的建表逻辑 → init-tables.ts，表/视图工具 → duckdb-infra.ts。主类只保留初始化、query()、close() 和代理方法 | ✓ |
| 保守瘦身 | 只移出 Parquet 指纹/加载和类型转换，保留 init()、query()、表工具在主类中。约 200-300 行 | |
| 你来定 | Claude 自行判断哪些值得拆分，以达到 ≤100 行目标 | |

**User's choice:** 最大瘦身
**Notes:** 无额外说明

### Q2: 代理方法怎么处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 删除代理，直接引用 | 调用方直接 import duckdb-domain-loaders.ts 或 duckdb-materialization.ts，不再经过 DuckDBService 中转。破坏性改动，但代理方法本身零逻辑 | ✓ |
| 保留代理，放宽行数限制 | 保持现有调用方式不变，主类约 150-200 行，不强求 100 行目标 | |
| 删代理，但用 Facade | 创建 duckdb-facade.ts 统一导出所有子模块函数 | |

**User's choice:** 删除代理，直接引用
**Notes:** 无额外说明

### Q3: 确认破坏性接口变更可接受？

| Option | Description | Selected |
|--------|-------------|----------|
| 接受 | 代理方法零逻辑，只是转发。改 import 路径是机械操作，黄金快照可回归验证 | ✓ |
| 不接受，保留兼容层 | 保留 BootstrapDuckDB 接口不变，代理方法继续存在 | |

**User's choice:** 接受
**Notes:** 无额外说明

---

## 惰性加载触发机制

### Q1: 惰性加载应该在哪个层面触发？

| Option | Description | Selected |
|--------|-------------|----------|
| DataBootstrapper 内部 | bootstrapper 注册惰性加载器，各域的 load 函数包装为 lazy-on-first-query。首次查询触发加载，后续查询直接使用已加载的表。变更集中在 bootstrapper + 一个 lazy-loader 服务 | ✓ |
| 路由中间件 | 每个查询路由前加中间件检查表是否存在，不存在则触发加载。分散在各路由文件中 | |
| DuckDB 服务层 | query() 方法内部检测 SQL 引用的表名，若未加载则自动触发。最透明但最复杂 | |

**User's choice:** DataBootstrapper 内部
**Notes:** 无额外说明

### Q2: API 行为

| Option | Description | Selected |
|--------|-------------|----------|
| 阻塞等待 | 首次请求等待加载完成后返回数据，后续请求正常速度。前端不需要任何修改 | ✓ |
| 返回 503 + Retry-After | 立即返回"数据加载中，请稍后重试"，前端自动重试。需要前端配合 | |
| 返回空数据 + 加载提示 | API 返回 { data: [], loading: true }，前端显示加载状态 | |

**User's choice:** 阻塞等待
**Notes:** 无额外说明

### Q3: 惰性加载范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全部辅助域惰性 | 除 PolicyFact + 维度表外，其余所有域全部惰性加载 | |
| 仅 ROADMAP 列出的 4 个 | 只将 ClaimsDetail/CrossSellFact/CustomerFlow/RenewalUniverse 惰性化 | |
| Claude 判断 | 根据各域大小和使用频率决定 | ✓ |

**User's choice:** Claude 判断
**Notes:** 用户委托 Claude 根据域大小和使用频率决定具体划分

### Q4: PolicyFact 与 CrossSell 依赖

| Option | Description | Selected |
|--------|-------------|----------|
| PolicyFact 解耦 CrossSell | 修改 PolicyFact 视图定义，不再启动时引用 CrossSellFact。交叉销售字段在查询时动态 JOIN | ✓ |
| 保持依赖，CrossSell 跟随 eager | CrossSellFact 继续随 PolicyFact 同步加载，不惰性化 | |
| Claude 判断 | 查看实际 PolicyFact VIEW 定义后决定 | |

**User's choice:** PolicyFact 解耦 CrossSell
**Notes:** 无额外说明
