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

<!-- PLACEHOLDER -->

---

<!-- SECTION:5 -->
## 5. 议题二：SQL 生成器与指标注册表漂移

<!-- PLACEHOLDER -->

---

<!-- SECTION:6 -->
## 6. 议题三：数据管道人工中间环节

<!-- PLACEHOLDER -->

---

<!-- SECTION:7 -->
## 7. 分阶段 Rollout 计划

<!-- PLACEHOLDER -->

---

<!-- SECTION:8 -->
## 8. Observability 与测试策略

<!-- PLACEHOLDER -->

---

*报告生成中，最终版本追加 `<!-- AUDIT-COMPLETE -->` 哨兵*
