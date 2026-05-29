# 架构专项审计报告

**项目**：chexian-api — 车险数据分析平台  
**审计日期**：2026-05-29  
**审计员**：架构专项 Agent  
**状态**：草稿（增量写入中）

---

## 目录

1. [Executive Recommendation](#1-executive-recommendation)
2. [Context and Assumptions](#2-context-and-assumptions)
3. [当前架构描述](#3-当前架构描述)
4. [议题一：2C4G VPS 内存预算与资源竞争](#4-议题一2c4g-vps-内存预算与资源竞争)
5. [议题二：SQL 生成器与指标注册表漂移](#5-议题二sql-生成器与指标注册表漂移)
6. [议题三：数据管道人工中间环节](#6-议题三数据管道人工中间环节)
7. [分阶段 Rollout 计划](#7-分阶段-rollout-计划)
8. [Observability 与测试策略](#8-observability-与测试策略)

---

<!-- SECTION:1 -->
## 1. Executive Recommendation

### 三条关键发现

| 优先级 | 议题 | 影响 | 建议行动 |
|--------|------|------|---------|
| **P0** | Node.js `--max-old-space-size=3072` + DuckDB `1536MB` 共用 4GB VPS，峰值窗口 < 500MB 安全边际 | 峰值查询可触发 PM2 `max_memory_restart`，冷启动窗口 30-120s 对用户不可见 | 将 Node 堆上限降至 2GB，将 DuckDB 降至 1.2GB，把 route-cache 上限从 400MB 调至 200MB；升级 VPS 至 4C8G 作长期解法 |
| **P1** | 50+ TypeScript SQL 生成器文件（6800+ 行）中的 L4 复杂查询**绕过指标注册表**直接内联 SQL 表达式，CI 集成测试被排除 | 指标公式悄然漂移（注册表与 SQL 生成器同一指标公式不一致），发现时需大范围追查 | 新增 governance check：扫描 SQL 生成器文件中未在注册表注册的聚合表达式；为 cost/performance-analysis 等高风险文件增加 DuckDB 内存快照测试 |
| **P2** | 日常数据发布依赖「Mac 本地 ETL → rsync 推 VPS」人工步骤，VPS 禁止访问原始 PolicyFact 的约束未文档化为代码约束 | 人工步骤阻断自动化；VPS 约束依赖工程师记忆，新加入者易违反导致 OOM 重蹈覆辙 | 在 CI 中集成预聚合导出脚本的 dry-run 验证；将「禁止 VPS 原始查询」护栏从文档规则升级为 governance check |

### 推荐路径

**短期（1-2 周）**：改 ecosystem.config.cjs 内存参数 + 新增 2 条 governance 检查 + 补全内存预算注释  
**中期（1-2 月）**：引入 SQL snapshot 测试（DuckDB in-memory）防止公式漂移  
**长期（3+ 月）**：VPS 升级至 4C8G + 数据发布管道半自动化（GitHub Actions ETL trigger）

---

<!-- SECTION:2 -->
## 2. Context and Assumptions

### 业务目标与用户价值

chexian-api 是一个**面向内部分析人员的车险经营数据平台**，核心价值：
- 将多来源 Excel 数据（签单/理赔/报价/续保/交叉销售）统一到 DuckDB 分析引擎
- 提供 50+ REST API 供 React 仪表盘即时查询：KPI 看板、趋势分析、成本分析、业绩排名、赔案监控
- 通过 PAT+CLI+MCP 三件套支持 AI 辅助分析（NL2SQL、Claude Desktop 集成）
- 日级数据发布（ETL → VPS 部署）确保数据时效性

### 系统约束识别

| 维度 | 约束 | 来源 |
|------|------|------|
| **Scale** | 保单事实表 ~258 万行，赔案 ~28.5 万行，报价数据单独域；预计年增量 50-80 万行 | `data-sources.json` |
| **Latency** | 仪表盘 bundle 首次加载目标 < 2s（Service Worker 二次访问 0ms）；DuckDB 连接池超时 2s | `duckdb-infra.ts` |
| **Availability** | 单 VPS 单 PM2 进程；`max_memory_restart=3500M`；冷启动 30-120s（Parquet 加载）；Service Worker cache-first 提供有限离线能力 | `ecosystem.config.cjs` |
| **Data Consistency** | 日级全量 ETL 刷新（无增量流式更新）；版本通过 `/api/data/version` + SW 5min 轮询同步 | `sw.js`, `data-version.ts` |
| **Security** | JWT（4h access / 7d refresh）+ PAT（Bearer 只读）；三级限流；SQL 白名单（sql-validator）；bcrypt 密码；Helmet HTTP 头 | `auth.ts`, `security.ts` |
| **Compliance** | 内部系统，数据不出 VPS；NL2SQL 经智谱 API（glm-4.7-flash），无 PII 发送策略文档 | 推断 |
| **Team Ownership** | 单人/小团队 + AI 协作（CLAUDE.md 说明 @user / @claude / @codex 任务分工）| `CLAUDE.md` |
| **Delivery Timeline** | BACKLOG.md 跟踪需求，PROGRESS.md 跟踪进展；无 sprint 固定节奏 | 推断 |

### Assumptions

- 本审计基于代码静态分析（无 VPS 运行时 profiling 数据），内存使用数字为估算值
- 用户并发：假设峰值 5-20 并发用户（内部系统），非公共互联网规模
- 数据增长：现有 3 层分片策略（static 2021-2023 / weekly 2024 / daily 当月）可支撑 3-5 年

---

<!-- SECTION:3 -->
## 3. 当前架构描述

### 3.1 完整请求链路

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 浏览器客户端                                                                  │
│  React 19 + ECharts + TanStack Query                                        │
│  src/features/* → src/shared/api/client.ts                                  │
│                    │ GET /api/query/*                                        │
│                    ▼                                                         │
│  public/sw.js (Service Worker)                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ cache-first 策略 (CACHE_TTL=24h, CACHE_NAME=chexian-api-v2)│            │
│  │ 缓存命中 + 未过期 → 直接返回 (0ms)                         │            │
│  │ 缓存过期/未命中 → 透传到网络                                │            │
│  │ 每 5min 轮询 /api/data/version → 版本变化 → 清空缓存       │            │
│  └─────────────────────────────────────────────────────────────┘            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTP (Nginx 反向代理)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Express 后端 (port 3000, 单 PM2 进程)                                        │
│                                                                              │
│  authMiddleware → readonlyMiddleware → permissionMiddleware                  │
│         │                                                                    │
│         ▼                                                                    │
│  server/src/routes/query.ts (聚合器, 22 个子路由挂载)                        │
│  ├─ kpi / kpi-detail / trend / growth / cost / comprehensive                │
│  ├─ salesman / performance / truck / premium-plan / report                  │
│  ├─ cross-sell (×6) / claims-detail / quote-conversion                      │
│  ├─ customer-flow / repair / policy-geo / renewal-tracker                   │
│  └─ pivot / sql-passthrough / bundles / patrol                              │
│         │                                                                    │
│         ▼                                                                    │
│  route-cache (LRU, max 400MB, key=路由+参数+dataVersion)                    │
│  ┌────────────────────────────┐                                              │
│  │ 命中 → sendCachedEntry()  │ 预序列化 JSON Buffer + brotli/gzip 压缩     │
│  │        (直接 res.end)     │                                              │
│  └──────────────┬─────────────┘                                             │
│                 │ 未命中                                                     │
│                 ▼                                                            │
│  server/src/sql/*.ts (50+ SQL 生成器文件)                                   │
│  ├─ sql-builder.ts: 公共 CTE (buildPolicyExposureCTE 等)                   │
│  ├─ perspective-adapter.ts: 视角 SQL 适配                                   │
│  └─ 28 个业务域生成器 + 子目录 (cost/trend/growth/performance-analysis)     │
│         │                                                                    │
│         ▼                                                                    │
│  server/src/services/duckdb.ts (DuckDB Service 单例)                        │
│  ├─ ConnectionPool (maxConn=8, acquireTimeout=2s, queue=32)                 │
│  ├─ QueryCache (3000 entries TTL)                                           │
│  ├─ inflight dedup (相同 SQL 并发折叠)                                      │
│  └─ loadMultipleParquet() → 3-way LEFT JOIN view                           │
│         │                                                                    │
│         ▼                                                                    │
│  DuckDB 1.4.4 (@duckdb/node-api)  [max_memory=1536MB, threads=2]            │
│  ├─ PolicyFact → PolicyFactRealtime (TABLE, 保单分片 UNION)                 │
│  ├─ ClaimsAgg (动态从 claims_*.parquet 聚合)                                │
│  └─ QuoteFact (latest.parquet)                                              │
│                                                                              │
│  server/data/fact/policy/current/*.parquet  (4 分片, VPS 运行时)            │
│  server/data/fact/claims_detail/*.parquet                                    │
│  server/data/fact/quotes/latest.parquet                                      │
│  server/data/dim/salesman/ + plan/                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 注册表体系（单一事实源）

```
字段注册表                          指标注册表
server/src/config/                  server/src/config/
  field-registry/fields.json          metric-registry/
  (42 字段, 唯一事实源)                 categories/*.ts (25 指标, L1-L3)
       │                                     │
       ▼ codegen                             ▼ codegen
  normalize/mapping.ts               scripts/metric-registry/
  normalize/validator.ts               generate-frontend-map.ts
  数据管理/etl_fields.json
       │
       ▼ ETL 消费
  数据管理/pipelines/transform.py
```

**L4 指标**（CTE/窗口函数/多表 JOIN）不在注册表中，直接在 SQL 生成器文件内实现，这是漂移的根源（见议题二）。

### 3.3 数据湖分域架构

```
数据管理/warehouse/
├── fact/
│   ├── policy/current/     # 保单 (3层分片: static+weekly+daily × 4文件)
│   │   ├── policy_static_2021_2023.parquet   # 2021-12-31 截止静态分片
│   │   ├── policy_weekly_2024_*.parquet       # 2024+ 周增量
│   │   └── policy_daily_current.parquet       # 当月日增量
│   ├── claims_detail/       # 赔案 (年度分区, 按报案时间)
│   ├── quotes/latest.parquet
│   ├── renewal/             # 续保 (下线: 2026-04-18)
│   └── customer_flow/
└── dim/
    ├── salesman_organization_mapping.json
    └── plan/
```

**3 层分片策略**的设计目的：避免每天重写全量 Parquet（258 万行），只追加增量。但代价是 VPS 启动时需 UNION 4 个分片重建 `PolicyFact` 视图。

### 3.4 ETL 管道

```
Mac 本地:
  01_签单清单_*.xlsx / 每日数据_*.xlsx
       │
       ▼  node 数据管理/daily.mjs
  pipelines/transform.py (Python, ETL)
       │ CN→EN 字段映射 (fields.json)
       ▼
  数据管理/warehouse/fact/policy/current/*.parquet
       │
       ▼  node scripts/sync-vps.mjs (rsync)
  VPS: server/data/fact/policy/current/
       │
       ▼  sudo deploy-chexian-api reload
  PM2 热重载 + DuckDB 重加载 Parquet
       │
       ▼  /api/data/version bump
  Service Worker 感知版本变化 → 清空缓存
```

**关键约束**：步骤 1-3 必须在 Mac 本地手动执行，VPS 上禁止运行 ETL（历史 OOM 原因，见议题三）。

### 3.5 PAT + CLI + MCP 三件套

```
外部 AI 工具 (Claude Desktop)
    │ CX_PAT=cx_pat_<id>.<secret>
    ▼
@chexian/mcp (stdio)
    │ 启动时拉 /api/auth/route-catalog → 转 MCP tools
    ▼
/api/* (readonlyMiddleware 拦截 POST/PUT/DELETE)
    │ PAT 校验: bcrypt(secret) → access-control-store
    ▼
DuckDB 查询 (同 JWT 用户路径)
```

PAT 元数据存储：`better-sqlite3` (state.db) 作主存，DuckDB 作 mirror（双写）。

### 3.6 缓存层设计

| 层 | 位置 | 策略 | 容量 | TTL |
|----|------|------|------|-----|
| Service Worker | 浏览器 | cache-first, revalidate-on-expiry | 浏览器存储配额 | 24h |
| route-cache (LRU) | Node.js 堆 | key=路由+参数+dataVersion，预压缩 br/gzip | 400MB / 5000 条 | 路由定义（分钟到小时） |
| DuckDB QueryCache | Node.js 堆 | Map LRU | 3000 条 | 路由定义 |
| DuckDB inflight dedup | Node.js 堆 | 相同 SQL 并发折叠 | 无上限 | 请求生命周期 |

### 3.7 部署链

```
git push main
    │
    ▼ GitHub Actions: Production Gate (单元测试 + 治理校验)
    │ 通过后触发 →
    ▼ Deploy workflow:
  bun install + vite build + server build
  State DB smoke (better-sqlite3 ABI)
  deploy-readiness check
  tar -czf deploy-bundle.tar.gz (dist/ + server/dist/ + ecosystem.config.cjs + wrapper)
  SSH to VPS:
    wrapper self-update
    deploy-chexian-api install (npm ci --omit=dev)
    deploy-chexian-api reload (PM2 热重载)
    health check: /health 200
  
  rollback: 5 对象完整还原 (dist/ + server/dist/ + ecosystem + node_modules + wrapper)
```

---

<!-- SECTION:4 -->
## 4. 议题一：2C4G VPS 内存预算与资源竞争

### 4.1 问题描述

当前 VPS 内存分配（来自 `ecosystem.config.cjs` 注释及环境变量默认值）：

```
组件                     分配/上限              备注
──────────────────────────────────────────────────────────────────
DuckDB max_memory       1,536 MB              DUCKDB_MAX_MEMORY
Node.js V8 堆           3,072 MB              --max-old-space-size=3072
  其中 route-cache (LRU)   ~400 MB            DEFAULT_MAX_TOTAL_BYTES
  其中 DuckDB query cache  ~100 MB            3000 entries × 平均 30KB
  其中业务逻辑/中间件       ~200 MB            估算
PM2 restart 触发阈值     3,500 MB              max_memory_restart
──────────────────────────────────────────────────────────────────
Node.js RSS 峰值估算    ~2,800 MB (稳态) → 3,500 MB+ (冷启动 Parquet 加载时)
OS + Nginx + 内核缓冲    ~300 MB
──────────────────────────────────────────────────────────────────
VPS 物理内存             4,096 MB             腾讯云 2C4G
潜在超额风险             DuckDB + Node 峰值合计可达 4.8 GB
```

**三个具体风险点**：

1. **启动时 Parquet 加载峰值**：`listen_timeout=120000ms` 说明 Parquet 加载耗时 30-120s。加载期间 Node.js 需同时持有 DuckDB 内存 + 旧实例未释放内存，峰值可超 3.5GB 触发 PM2 restart → 循环重启。
2. **route-cache 默认 400MB 上限设置在代码中，不在 `ecosystem.config.cjs`**：生产环境如未通过 `ROUTE_CACHE_MAX_BYTES` 环境变量覆盖，实际上限是代码默认值（400MB），与 PM2 注释期望的 400MB 一致，但这种隐式依赖是脆弱的。
3. **代码默认值 `DUCKDB_MAX_MEMORY='4GB'`（env.ts 第 76 行）vs 生产覆盖 `1536MB`**：本地开发如用 `bun run dev:full` 不设环境变量，DuckDB 会尝试用 4GB，超过开发机若内存有限会被 OOM Killer 杀掉。

### 4.2 可选方案

#### 方案 A：收紧参数边界（短期，低风险）

调整 `ecosystem.config.cjs` 和 `server/src/config/env.ts` 默认值：

| 参数 | 当前值 | 建议值 | 理由 |
|------|--------|--------|------|
| `DUCKDB_MAX_MEMORY` (生产) | `1536MB` | `1200MB` | 给 Node.js 峰值留更多空间 |
| `DUCKDB_MAX_MEMORY` (代码默认/开发) | `4GB` | `2GB` | 防止开发机 OOM |
| `--max-old-space-size` | `3072` | `2048` | Node 堆实际稳态 ~800MB，上限 3GB 没必要 |
| `ROUTE_CACHE_MAX_BYTES` (env 显式设置) | 未设置（代码默认 400MB） | 显式设 `200MB` | 避免隐式依赖；DashBoard bundle 单条 ~5MB，200MB 可缓存 40 条 |
| `max_memory_restart` | `3500M` | `3000M` | 与调低后的堆+DuckDB 对齐；早发现早重启好过 OOM |

**优点**：改动仅限配置文件，零代码风险；立即可上线  
**缺点**：治标不治本，数据增长后仍会面临压力

#### 方案 B：VPS 升级（中期，运营解法）

升级至腾讯云 4C8G（约 ¥100-200/月额外费用）：
- DuckDB 可用 3GB，支撑数据量 2x 增长
- Node.js 可用 4GB，route-cache 可扩到 800MB
- 2 vCPU 增到 4 vCPU，DuckDB threads 从 2 可调至 4

**优点**：根本解决内存紧张；为未来 3 年数据增长留空间  
**缺点**：持续费用增加；未解决 DuckDB 单进程无 HA 问题

#### 方案 C：预聚合减少 DuckDB 运行时内存（长期，架构改造）

将 `/api/query/kpi`、`/api/query/trend`、`/api/query/cost` 等高频路由的底层从原始 PolicyFact 迁移到预聚合 Parquet（已有 `DailyAggregated` / `PeriodAggregated` 表的雏形，但未全面应用）：

- 预聚合后 DuckDB 扫描行数降低 100x+，内存 peak 从 1.5GB 降到 200-400MB
- PolicyFact 仅保留给下钻/明细场景（10% 查询量）

**优点**：最彻底的内存优化；同时带来查询速度提升 5-10x  
**缺点**：需重构 SQL 生成器；需 Mac 本地预聚合脚本；ETL 管道复杂度增加；时间投入 2-4 周

### 4.3 方案对比矩阵

| 维度 | A (调参) | B (升级 VPS) | C (预聚合) |
|------|---------|-------------|-----------|
| Product Impact | 低（仅配置） | 无 | 高（查询 5-10x 提速） |
| Implementation Complexity | 低（1h） | 低（运营操作）| 高（2-4 周重构） |
| Operational Complexity | 低 | 低 | 中（ETL 脚本维护） |
| Maintainability | 好（参数化） | 不变 | 好（SQL 更简单） |
| Scalability | 有限（治标）| 中期可行 | 高（可支撑 10x 数据） |
| Cost | 零 | +¥100-200/月 | 开发人力成本 |
| Migration Risk | 极低 | 极低 | 中（需要 SQL 重写测试） |

### 4.4 推荐方案

**立即执行 A + 中期规划 B**：

1. 本周内：修改 `ecosystem.config.cjs` 中 `--max-old-space-size=2048`，显式设置 `ROUTE_CACHE_MAX_BYTES=209715200`（200MB），并将代码默认 `DUCKDB_MAX_MEMORY` 从 `4GB` 改为 `2GB`（保护开发环境）
2. 一个季度内：评估 VPS 升级，与业务增长预期对齐
3. 年度规划：若数据量突破 500 万行，启动方案 C 预聚合重构

### 4.5 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 降低 Node 堆后某路由 GC 压力增大导致延迟抖动 | 低 | 中 | 上线后监控 P99 延迟 + GC 频率；如有问题回滚 |
| DuckDB 降到 1.2GB 后大查询（cost.ts 全量聚合）触发 spill-to-disk | 低 | 低 | DuckDB spill 透明，只影响速度不影响正确性；监控 slow query 日志 |
| route-cache 降到 200MB 后命中率下降 | 中 | 低 | route-cache 当前缓存 key 含 dataVersion，每日 ETL 后全部失效，24h 内会重新填满；200MB 够放 40 条 5MB bundle |

### 4.6 Open Questions

- **Q1**: 当前 VPS 实测稳态内存是多少？（`pm2 describe chexian-api` 中的 `memory`）
- **Q2**: route-cache 当前命中率是多少？（`/api/admin/health` 或 `/api/admin/cache-stats` 是否暴露？）
- **Q3**: 最大单次查询（`cost.ts` 全表聚合）的 DuckDB 峰值内存是多少？

---

<!-- SECTION:5 -->
## 5. 议题二：SQL 生成器与指标注册表漂移

### 5.1 问题描述

**已建立的注册表体系**（强大）：
- `server/src/config/metric-registry/` 定义 25 个 L1-L3 原子指标（每个含 id + formula + sql.expression + display + testCase + changelog）
- `server/src/config/field-registry/fields.json` 定义 42 个字段（codegen 生成 mapping.ts + validator.ts）
- governance check 已验证注册表内部一致性

**漂移的根源**（结构性缺口）：
- L4 复杂指标（CTE/窗口函数/多表 JOIN）**不在注册表中**，直接内联在 SQL 生成器文件里
- 注册表的 SQL 表达式 vs SQL 生成器中对同名指标的实现**没有自动对比机制**
- CI 集成测试（`test:integration`）被从 Vitest 配置中 exclude，不在流水线中运行

**具体漂移场景（推断）**：

```typescript
// metric-registry/categories/cost.ts 中定义：
{
  id: 'loss_ratio',
  sql: { expression: 'SUM(claims_amount) / NULLIF(SUM(earned_premium), 0)' }
}

// server/src/sql/cost/cost-ratios.ts（312行）中可能存在：
// 类似但不同的实现，例如分母用 SUM(premium) 而非 earned_premium
// 或者分子包含/排除了某些赔款类型
// 这两处不一致时，注册表展示的公式与 API 实际返回值不符
```

**文件体积问题**：
- `performance-analysis/shared.ts`: **548 行**
- `cost/cost-ratios.ts`: **312 行**
- `cost/earned-premium-detail.ts`: **305 行**
- `sql-builder.ts`: **404 行**

这些文件超出"可在一次代码审查中完整理解"的阈值（通常 200-300 行）。每次修改都需要深入理解整个文件。

**「只能追加不能修改」护栏的负效应**：
- 历史上多次 append 导致同一个指标可能有多个版本的 SQL 分支（通过 `if/switch` 区分 mode/type）
- 旧逻辑无法被删除，文件越来越长，认知负荷持续上升

### 5.2 可选方案

#### 方案 A：SQL Snapshot 测试（高优先，低侵入）

在 CI 中增加一类测试：启动 DuckDB in-memory，对每个已注册的 L1-L3 指标，用注册表中的 `sql.expression` 和 `testCase` 数据验证实际计算结果：

```typescript
// tests/metric-registry/snapshot.test.ts
for (const metric of getAllMetrics()) {
  if (!metric.testCase) continue;
  it(`metric ${metric.id} 公式与注册表一致`, async () => {
    const result = await duckdb.query(
      `SELECT ${metric.sql.expression} AS value FROM test_data`
    );
    expect(result[0].value).toBeCloseTo(metric.testCase.expectedValue, 2);
  });
}
```

同时对高风险的 SQL 生成器路由（cost / performance / kpi）增加「输出字段 + 数值范围」的 snapshot：若某次改动导致 kpi 路由返回的 `loss_ratio` 字段值变化超过 5%，测试失败。

**优点**：不改变任何业务代码；直接用代码防止公式漂移  
**缺点**：需要构造 test fixture 数据（一次性投入）；不能完全覆盖 L4 复杂查询

#### 方案 B：Governance 检查：L4 查询显式注册（中优先，中侵入）

在 `scripts/check-governance.mjs` 中增加规则 #25：扫描 `server/src/sql/**/*.ts`，提取 SQL 字符串中出现的 `SUM(...)`, `COUNT(...)`, `AVG(...)` 等聚合表达式；若某个聚合表达式未出现在 `metric-registry` 任何指标的 `sql.expression` 中，则报 Warning（不报 Error，避免过于严苛）。

配合一个注释约定，允许显式豁免：
```typescript
// @metric-exempt: L4 CTE，see https://github.com/.../BACKLOG.md#B345
const earnedPremiumCte = `...`;
```

**优点**：通过机制防止静默引入新的未注册公式  
**缺点**：正则提取 SQL 字符串中的聚合表达式有误报风险；需要持续维护豁免列表

#### 方案 C：SQL 生成器重构为注册表驱动（长期，高价值）

将所有指标的 SQL 表达式集中在注册表，SQL 生成器只做 CTE 框架和 GROUP BY 的组装，不再内联指标公式：

```typescript
// 当前方式（生成器内联公式）：
const sql = `
  SELECT SUM(premium) AS total_premium,
         SUM(claims_amount) / NULLIF(SUM(earned_premium), 0) AS loss_ratio
  FROM PolicyFact ...
`;

// 目标方式（注册表驱动）：
const metrics = [getMetricSql('total_premium'), getMetricSql('loss_ratio')];
const sql = buildStandardQuery({ cte: buildPolicyExposureCTE(filters), metrics, groupBy });
```

**优点**：公式完全单一来源；前后端 label/threshold 自动从注册表派生  
**缺点**：重构工程量大（50 个文件，6800 行）；L4 复杂查询（CTE/窗口函数）难以注册表化；业务稳定性要求下难以整体推进

### 5.3 方案对比矩阵

| 维度 | A (Snapshot 测试) | B (Governance 检查) | C (注册表驱动重构) |
|------|------------------|--------------------|--------------------|
| Product Impact | 无（测试层） | 无（CI 层） | 高（查询统一化） |
| Implementation Complexity | 低（1-2 天） | 低（1 天） | 极高（4-6 周） |
| Operational Complexity | 低（CI 自动） | 低（CI 自动） | 高（持续维护） |
| Maintainability | 好（漂移早发现） | 好（新增时提醒）| 最好（单一来源） |
| Scalability | 好（新指标自动覆盖）| 中（豁免积累） | 好 |
| Cost | 开发 1-2 天 | 开发 1 天 | 开发 4-6 周 |
| Migration Risk | 极低 | 极低 | 高（需全量回归） |

### 5.4 推荐方案

**执行 A + B，放弃 C 的整体重构**（选择性推进 C）：

1. **本月**：实现方案 A（snapshot 测试），覆盖 25 个注册表指标的 `testCase`；为 `cost.ts`、`kpi.ts`、`performance-analysis/shared.ts` 三个高风险文件增加路由级 snapshot（输出字段断言）
2. **本月**：实现方案 B（governance #25），仅对新增文件强制要求，存量文件给出 Warning
3. **长期**：新增 L4 查询时，优先考虑是否能拆解为 L1-L3 原子指标的组合；逐步把能注册表化的部分迁移（不要整体重构）

### 5.5 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Snapshot 测试构造 fixture 数据工作量被低估 | 中 | 中 | 先用极简 fixture（10 行测试数据）验证公式形式正确；精确值可后续迭代 |
| Governance 检查误报导致 CI 噪音 | 中 | 低 | 初期设为 Warning 而非 Error；通过 2 周观察后再决定是否升级为 Error |
| 新增 SQL 生成器时遗忘加 @metric-exempt 注释 | 高 | 低 | Warning 级别不阻断，但会在 PR review 时触发作者审查 |

### 5.6 Open Questions

- **Q4**: 目前注册表 25 个指标的 `testCase` 完整性如何？是否所有指标都有测试用例？
- **Q5**: `cost/cost-ratios.ts` 和 `cost/earned-premium.ts` 中的赔付率公式与注册表 `loss_ratio` 的分母口径是否完全一致（`earned_premium` vs `premium`）？

---

<!-- SECTION:6 -->
## 6. 议题三：数据管道人工中间环节

### 6.1 问题描述

当前日常数据发布路径（来自 `CLAUDE.md §8`、`data-pipeline.md`、`sync-and-reload.mjs`）：

```
Excel 源文件 (Mac Downloads/)
     │
     ▼ 手动：node 数据管理/daily.mjs
Python ETL (transform.py)
     │
     ▼ 手动：node scripts/sync-vps.mjs
rsync → VPS server/data/fact/...
     │
     ▼ 手动：bun run release:daily
sudo deploy-chexian-api reload
     │
     ▼ 自动：Service Worker 感知版本变化
```

**三个结构性问题**：

**问题 1：VPS 禁用原始查询的约束仅在文档中**

`data-pipeline.md` 的"黄金规则"：「禁止在 VPS 上查询原始 PolicyFact 构建新功能」。但这个约束：
- 只记录在 `.claude/rules/data-pipeline.md`（AI 指引文档）
- 没有被 governance check 自动校验
- 新加入的开发者若未读 CLAUDE.md，极易在 VPS 上写查询原始 Parquet 的新功能，重演历史 OOM（「历史上原始 Parquet 在 VPS 聚合导致内存 800MB+、PM2 177 次重启」）

**问题 2：rsync 无原子交换保证**

`sync-vps.mjs` 用 rsync 推送 Parquet 文件到 VPS，但：
- rsync 是文件级增量，非原子操作
- 在推送进行中，VPS 上的 DuckDB 若同时读取 policy/current/，可能读到新旧混合分片
- PM2 热重载后 DuckDB 重加载 Parquet，但重载前的 in-flight 请求已读到的可能是半更新状态
- 目前用 `dataVersion` 后缀 cache key + ETL 后 version bump 来缓解，但 rsync 推送期间无保护窗口

**问题 3：data-sources.json 重复字段**

`data-sources.json` 中 premium 域存在两个 `last_updated` 和两个 `data_range` 字段（文件直接可见），说明元数据写入存在竞争或合并错误，唯一事实源机制在元数据层有空洞。

### 6.2 可选方案

#### 方案 A：Governance 检查覆盖 VPS 原始查询约束（低成本，立竿见影）

在 `scripts/check-governance.mjs` 新增检查 #26（或附加到已有 VPS 相关检查）：
- 扫描 `server/src/sql/**/*.ts` 中新增代码
- 检测是否出现 `PolicyFact` / `raw_parquet` / `policy/current/` 等原始数据访问模式
- 若新增文件（git diff 中新增行）包含上述模式，报 Warning + 提示"是否已在 Mac 本地预聚合？"

这不能完全阻止，但能在 CI / governance 运行时给出提醒，形成第二道防线。

**优点**：1 天实现；有效降低新成员违反约束的概率  
**缺点**：正则匹配有误报；老文件豁免逻辑需维护

#### 方案 B：原子数据切换（rsync → 暂存目录 + 符号链接 swap）

修改 `sync-vps.mjs` + `deploy-chexian-api` wrapper，实现蓝绿 Parquet 切换：

```bash
# 推送到暂存目录（不影响运行中的 DuckDB）
rsync ... server/data/fact/policy/incoming/

# 验证文件完整性（checksum 或行数验证）
node scripts/verify-parquet-incoming.mjs

# 原子符号链接切换
ln -sfn server/data/fact/policy/incoming server/data/fact/policy/current-new
mv -Tf server/data/fact/policy/current-new server/data/fact/policy/current

# 触发 PM2 热重载（DuckDB 重新加载 current/）
sudo deploy-chexian-api reload
```

**优点**：消除 rsync 推送窗口中的数据不一致风险；`incoming/` 目录可保留上一版本用于回滚  
**缺点**：VPS 磁盘需额外保留一份 Parquet 副本（约 300-500MB）；wrapper 脚本改动需走部署链 PR

#### 方案 C：GitHub Actions 触发 ETL（半自动化管道）

将 Mac 本地的手动步骤部分迁移到 GitHub Actions：
- 用户将 Excel 文件上传到指定 S3/OSS bucket（或 GitHub Release asset）
- Actions workflow 触发：下载 Excel → 运行 Python ETL（在 Actions runner 上，非 VPS）→ 生成 Parquet → rsync 到 VPS
- 保留 Mac 本地作为应急路径

**优点**：消除本地 Mac 依赖；ETL 过程可审计（Actions 日志）；不再需要本地配置 Python 环境  
**缺点**：Actions runner 存储 Excel 源文件（敏感数据）；Python ETL 依赖需在 Actions 上安装（启动慢）；架构复杂度增加；需要配置 OSS/S3 存储

### 6.3 方案对比矩阵

| 维度 | A (Governance 检查) | B (原子切换) | C (Actions ETL) |
|------|--------------------|-----------|-----------------|
| Product Impact | 无 | 无（可用性提升）| 低（流程自动化）|
| Implementation Complexity | 低（1 天） | 中（2-3 天）| 高（1-2 周）|
| Operational Complexity | 低 | 低（脚本维护）| 高（S3/Actions 维护）|
| Maintainability | 中（豁免列表） | 好（无状态脚本）| 中（Actions yaml 维护）|
| Scalability | 不适用 | 好（原子操作）| 好（去本地依赖）|
| Cost | 零 | 零 | S3 存储 + Actions 时间 |
| Migration Risk | 极低 | 低 | 中（数据流路径变化）|

### 6.4 推荐方案

**执行 A（立即），评估 B（一个月内）**：

1. **本周**：Governance #26 检查 VPS 原始查询约束，覆盖存量文件豁免表（cost/kpi/trend/growth 等现有文件加豁免注释）
2. **一月内**：实现方案 B 原子切换，修改 `sync-vps.mjs` 推送逻辑 + wrapper 加 verify 步骤
3. **暂不建议方案 C**：当前数据量和团队规模下 Mac 本地 ETL 已足够，Actions ETL 引入的运维复杂度超过收益

同时修复 `data-sources.json` 重复字段问题（运行 `refresh_metadata.py` 重新生成，删除重复 key）。

### 6.5 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 原子切换实现错误导致 VPS Parquet 丢失 | 低 | 高 | `incoming/` 保留上一版本；wrapper 增加 checksum 验证步骤；失败时 fallback 到旧符号链接 |
| Governance 误报豁免老文件遗漏 | 中 | 低 | 审计阶段用 Warning 不用 Error；豁免列表 PR review 覆盖 |
| data-sources.json 重复字段持续增长 | 中 | 低 | ETL 后自动用 `refresh_metadata.py` 覆写，避免手动编辑 |

### 6.6 Open Questions

- **Q6**: `sync-vps.mjs` rsync 推送期间，VPS DuckDB 是否会在 PolicyFact 上持有文件锁，使 rsync 写入被阻塞还是可并发？
- **Q7**: 当前 Mac 本地 ETL 成功率如何？是否有因为 Mac 环境问题（Python 版本、源文件格式变化）导致 ETL 失败的记录？

---

<!-- SECTION:7 -->
## 7. 分阶段 Rollout 计划

### Phase 0：MVP（1-2 周，零风险改动）

目标：消除已知的最高风险点，纯配置/文档/CI 改动，不触碰业务代码。

| 任务 | 文件 | 工时 | 风险 |
|------|------|------|------|
| 降低 Node 堆上限 `--max-old-space-size=3072→2048` | `server/ecosystem.config.cjs` | 0.5h | 极低 |
| 显式设置 `ROUTE_CACHE_MAX_BYTES=209715200`（200MB）| `server/ecosystem.config.cjs` | 0.5h | 极低 |
| 修改代码默认 `DUCKDB_MAX_MEMORY='4GB'→'2GB'` | `server/src/config/env.ts` L76 | 0.5h | 低 |
| 添加内存预算注释表（组件/分配/实测对比） | `server/ecosystem.config.cjs` | 0.5h | 极低 |
| Governance #26：VPS 原始查询约束检查 | `scripts/check-governance.mjs` | 1d | 极低 |
| 修复 `data-sources.json` 重复 key | 运行 `refresh_metadata.py` | 0.5h | 极低 |

**验收标准**：
- `bun run governance` 通过 + 新增 #26 检查在存量代码上无误报
- PM2 描述中 `node_args` 已更新

**Rollback**：git revert ecosystem.config.cjs 单个 commit 即可

---

### Phase 1：Hardening（2-4 周）

目标：引入自动化防漏机制，让漂移和约束违反在 CI 中被捕获。

| 任务 | 文件 | 工时 | 风险 |
|------|------|------|------|
| SQL Snapshot 测试框架（DuckDB in-memory）| `tests/metric-registry/snapshot.test.ts` | 2d | 低 |
| 25 个注册表指标 testCase 补全（补缺失的）| `metric-registry/categories/*.ts` | 1d | 极低 |
| cost / kpi / performance 路由输出字段断言 | `tests/snapshots/*.snap.ts` | 2d | 低 |
| 原子数据切换脚本（incoming + symlink swap）| `scripts/sync-vps-atomic.mjs` + `deploy/vps-wrapper/` | 2d | 中 |
| Governance #25：新增 SQL 文件聚合表达式检查 | `scripts/check-governance.mjs` | 1d | 低 |

**验收标准**：
- `bun run test` 包含 snapshot 测试，25 个指标全部通过
- `bun run release:daily` 使用新的原子切换脚本，health check 通过

**Rollback**：每项任务独立 PR，可单独回滚

---

### Phase 2：Scale-out（1-3 月）

目标：为 VPS 升级和数据量增长做好准备。

| 任务 | 工时 | 依赖 | 价值 |
|------|------|------|------|
| VPS 升级评估（4C8G 成本收益分析）| 1d | Phase 0 完成后的稳态内存监控数据 | 根本解决内存压力 |
| `/api/admin/metrics` 端点：暴露 route-cache 命中率 + DuckDB pool stats | 1d | 无 | 日常运维可观测性 |
| DuckDB slow query 日志结构化（JSON + 路由 key）| 0.5d | 无 | 慢查询追踪 |
| 高频路由预聚合可行性评估（kpi / trend 路由）| 2d | Phase 1 snapshot 测试提供安全网 | 查询性能 5-10x |

**验收标准**：
- `/api/admin/metrics` 返回内存 + 缓存统计
- 有 4 周运行时数据支撑 VPS 升级决策

---

### Phase 3：Migration & Rollback（3+ 月）

目标：长期架构改善，仅在数据量或性能要求超出现有架构时执行。

| 任务 | 触发条件 | 估计工时 |
|------|---------|---------|
| VPS 升级（4C8G）| 稳态内存 > 3GB 或 PM2 restart > 2 次/月 | 运营操作 |
| kpi / trend 路由迁移到预聚合 Parquet | 高频路由 P99 > 3s 或 DuckDB 内存 > 1.2GB | 4-6 周 |
| ETL 管道半自动化（GitHub Actions trigger）| 团队规模扩大或 Mac 本地 ETL 频率 > 每日 | 2-3 周 |
| state-db 迁移评估（better-sqlite3 → PostgreSQL）| PAT 用量 > 100 个或需要多实例共享状态 | 3-4 周 |

**注意**：Phase 3 任务互相独立，按触发条件分别评估，不需要整体推进。

---

### Rollback 总体策略

| 层级 | Rollback 机制 |
|------|--------------|
| 代码配置 | git revert + 走 CI/deploy 链 |
| VPS 部署 | `deploy-chexian-api reload` 完整 5 对象回滚 |
| 数据文件 | `sync-vps-atomic.mjs` 保留 incoming/ 副本，可重新 symlink |
| 指标注册表 | `changelog` 字段追踪版本，可定点回退 `sql.expression` |
| state-db | `STATE_STORE_BACKEND=json pm2 restart --update-env` 临时回退 JSON 模式 |

---

<!-- SECTION:8 -->
## 8. Observability 与测试策略

### 8.1 当前可观测性覆盖

| 组件 | 当前状态 | 缺口 |
|------|---------|------|
| HTTP 层 | `logs/audit.log`（JSON，含 auth_kind/token_id/route） | 无 P99 延迟聚合；无 error rate 仪表盘 |
| DuckDB 层 | `[DuckDB] ⚠️ Slow query (XXms)` console.warn | 无结构化 JSON 输出；无路由聚合慢查询排行 |
| route-cache 层 | `getRouteCacheStats()` 函数存在 | 无对外端点（`/api/admin/cache-stats`）暴露 |
| DuckDB 连接池 | `getPoolStats()` 函数存在 | 同上，无端点暴露；`saturatedRecently` 字段有价值但未用 |
| 内存使用 | PM2 `max_memory_restart` 被动触发 | 无主动告警（预警阈值 3.0GB 时发企微通知）|
| 数据版本 | `GET /api/data/version` 返回 ETL 日期 | ETL 失败时无告警 |
| ETL 管道 | `node 数据管理/daily.mjs` console 输出 | 无结构化日志；无失败通知 |

### 8.2 建议的可观测性增强（优先级排序）

#### 高优先（Phase 1）

**1. 内存预警企微通知**

在 `server/src/app.ts` 中增加定时任务（5min 间隔），当 Node.js `process.memoryUsage().rss > 2.5GB` 时，通过 `services/wecom.ts` 发送告警：

```typescript
setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > 2.5 * 1024 ** 3) {
    notifyWecom(`⚠️ chexian-api RSS=${(rss/1024**3).toFixed(2)}GB，接近 PM2 重启阈值`);
  }
}, 5 * 60 * 1000);
```

**2. `/api/admin/health` 扩展**

将 route-cache stats + DuckDB pool stats 集成到 `/health` 或新增 `/api/admin/metrics` 端点：

```json
{
  "status": "ok",
  "memory": { "rss": "1.8GB", "heapUsed": "1.2GB" },
  "routeCache": { "hits": 1234, "misses": 89, "size": 156, "totalBytes": "180MB" },
  "duckdb": { "active": 2, "idle": 6, "waiting": 0, "saturatedRecently": false }
}
```

**3. 慢查询结构化日志**

修改 `duckdb.ts` slow query 输出为 JSON：

```json
{ "level": "warn", "type": "slow_query", "durationMs": 4521, "routeKey": "kpi", "reqId": "abc123" }
```

便于 `grep '"type":"slow_query"' logs/api-out.log | jq '.durationMs' | sort -n | tail -10` 分析。

#### 中优先（Phase 2）

**4. ETL 失败通知**

在 `node 数据管理/daily.mjs` exit code 非 0 时，通过 `scripts/sync-and-reload.mjs` 的 `--wecom` 路径发送失败通知（已有企微集成基础设施）。

**5. 数据版本漂移监控**

`/api/data/version` 当前仅返回 ETL 日期。增加监控：若 `last_updated` 距今 > 2 天（非工作日除外），在 `/health` 响应中加 warning 字段。

### 8.3 测试策略

#### 当前测试层次

```
单元测试 (bun run test)
├─ 72 文件 / 892 测试
├─ SQL 校验器 / SQL 生成器单元逻辑
├─ 格式化函数 / 查询构建器
└─ 安全工具 / AI 洞察

集成测试 (bun run test:integration)  [仅本地]
└─ 4 文件 (DuckDB 原生二进制，CI 排除)

E2E 测试 (bun run test:e2e)
├─ 需先运行 dev:full
└─ Playwright 驱动
```

#### 建议补充的测试层次

| 层次 | 建议添加 | 目的 | CI 可行性 |
|------|---------|------|----------|
| **指标 Snapshot** | `tests/metric-registry/snapshot.test.ts` | 防止注册表公式与实现漂移 | ✅ DuckDB in-memory |
| **路由 Contract** | `tests/routes/contract.test.ts` | 断言路由返回字段集和数值范围 | ✅ mock DuckDB |
| **SQL 安全** | 补充 `sql-passthrough` 的 injection 用例 | NL2SQL 路径安全 | ✅ |
| **VPS 约束** | governance #26 自动检查 | 防止新代码违反 VPS 禁令 | ✅ CI |

#### 测试覆盖率目标

| 模块 | 当前覆盖 | 目标 | 备注 |
|------|---------|------|------|
| `server/src/sql/**/*.ts` | 低（主要是 SQL 字符串，难以纯单测） | 通过 snapshot 测试覆盖输出合理性 | Phase 1 |
| `server/src/config/metric-registry/` | 中（有 testCase 框架） | 100% testCase 完整率 | Phase 1 |
| `server/src/services/route-cache.ts` | 高（现有 `__tests__/`）| 维持 | — |
| `server/src/middleware/**` | 中 | 补 PAT 认证路径边界用例 | Phase 2 |

### 8.4 架构健康度仪表盘建议

建议在内部 Wiki 或 `docs/runbook.md` 中维护以下指标的每周快照，作为架构健康度基线：

| 指标 | 目标值 | 当前实测 | 告警阈值 |
|------|--------|---------|---------|
| VPS RSS 稳态 | < 2.5GB | 待测 | > 3GB |
| route-cache 命中率 | > 80% | 待测 | < 60% |
| DuckDB P99 查询延迟 | < 2s | 待测 | > 5s |
| ETL 发布成功率 | 100% | 未追踪 | 任何失败 |
| PM2 非计划重启次数/月 | 0 | 未追踪 | > 2 次 |
| 单元测试通过率 | 100% | 892/892 | 任何失败 |
| governance 检查通过率 | 100% | 通过 | 任何失败 |

---

## 附录：整体风险清单

| # | 风险 | 当前状态 | 建议缓解 | Phase |
|---|------|---------|---------|-------|
| R1 | VPS 内存峰值超 3.5GB 触发 PM2 循环重启 | **活跃** | 调低参数边界（方案 A）| P0 |
| R2 | 指标公式漂移（注册表 vs 实现不一致）| **潜在** | Snapshot 测试 + Governance #25 | P1 |
| R3 | 新功能在 VPS 违反"禁止原始查询"约束 | **潜在** | Governance #26 | P0 |
| R4 | rsync 推送期间读到新旧混合 Parquet | **潜在** | 原子切换脚本 | P1 |
| R5 | DuckDB 单进程无 HA，PM2 重启期间 30-120s 不可用 | **已知** | Service Worker 缓存提供部分缓解；长期 VPS 升级后考虑 read replica | P3 |
| R6 | better-sqlite3 ABI 不兼容（Node 升级时）| **已有保护**（CI smoke test）| 维持现状 | — |
| R7 | NL2SQL 路径注入（智谱 API 返回恶意 SQL）| **已有保护**（sql-validator 白名单）| 定期审计白名单完整性 | P2 |
| R8 | data-sources.json 重复 key 导致元数据错误 | **已发生**（文件可见两个 last_updated）| 运行 refresh_metadata.py 修复 | P0 |

<!-- AUDIT-COMPLETE -->
