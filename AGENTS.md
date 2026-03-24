# AGENTS.md

> GitHub Copilot / Codex 协作指南 — **chexian-api** 车险数据分析平台

## 项目概览

React + TypeScript + Vite 前端，Express + DuckDB 后端。生产环境 `https://chexian.cretvalu.com`。

## 技术栈

- **前端**: React 18 + TypeScript + Vite + ECharts + Tailwind CSS
- **后端**: Express + DuckDB (in-memory) + JWT 认证
- **运行时**: Node.js (tsx) — 后端不用 Bun 运行
- **包管理**: Bun（禁止 npm/yarn）
- **ETL**: Python 3 (pandas + pyarrow) + Node.js (etl.mjs)
- **部署**: GitHub Actions → VPS (PM2 + Nginx)

## 分域 Lakehouse 数据架构

数据拆分为 3 个独立域，DuckDB 启动时用 LEFT JOIN 视图合并：

```
warehouse/fact/
├── policy/daily/YYYY-MM-DD.parquet   # 保单+保费（844+文件，按签单日期分区）
├── claims/latest.parquet             # 赔付+费用（按保单号聚合去重）
└── quotes/latest.parquet             # 报价状态（续保单号去重）
```

### 数据加载流程

```
app.ts 启动
  ↓ 检测 policy/daily/ 是否存在
  ↓ [是] → duckdb.ts:loadDomainParquet() → 3路 LEFT JOIN → raw_parquet VIEW
  ↓ [否] → 旧模式：加载 current/ 单体 parquet
  ↓
createPolicyFactView('raw_parquet') → 列名映射（中→英）→ PolicyFact VIEW
  ↓
materializePolicyFactWorkingSet() → PolicyFactRealtime TABLE + 3索引
  ↓
createCrossSellRealtimeView() → CrossSellDailyAgg（按月分批物化）
```

### ETL 命令

```bash
node 数据管理/etl.mjs            # 智能检测，自动判断需更新的域
node 数据管理/etl.mjs premium    # 保单+保费增量追加
node 数据管理/etl.mjs claims     # 赔付+费用全量替换
node 数据管理/etl.mjs quotes     # 报价状态全量替换
node 数据管理/etl.mjs all        # 全部重跑
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/app.ts` | 服务器入口，域拆分检测 |
| `server/src/services/duckdb.ts` | DuckDB 服务，`loadDomainParquet()` |
| `server/src/config/paths.ts` | 路径配置，`getPolicyDailyDirs()` 等 |
| `server/src/normalize/mapping.ts` | 中文→英文列名映射 |
| `server/src/sql/*.ts` | 24 个 SQL 生成器 |
| `数据管理/etl.mjs` | 分域 ETL 入口（智能检测） |
| `数据管理/pipelines/transform.py` | Excel→Parquet 转换（`--domain`/`--after-date`） |
| `数据管理/pipelines/split_existing.py` | 一次性迁移脚本 |
| `数据管理/pipelines/merge_parquet.py` | Parquet 合并工具 |

## 红线规则

1. **业务口径只追加不删改**: `duckdb.ts` 和 `query.ts` 已有逻辑禁止修改/删除
2. **分域架构不可合回单体**: 3 个域独立更新，禁止合回一个大 parquet
3. **报价数据口径待修正**: `是否报价` 字段不可靠，正确逻辑应以「续保单号非空」判定。用户待办，AI 不得擅自修改
4. **VPS 禁止查询原始 PolicyFact**（续保除外），只能查预聚合表
5. **安全**: JWT 禁止绕过，三级限流禁止降低，`security.ts` 黑名单支持中文

## 开发命令

```bash
bun install && bun run dev:full    # 安装+启动（前后端同时）
bun run build                      # 类型检查+构建
bun run test                       # 单元测试
bun run test:e2e                   # E2E（需先 dev:full）
bun run governance                 # 治理校验（push 前必跑）
```

## API 路由

- `/api/query/*` — KPI/趋势/排名/成本/系数/续保/交叉销售
- `/api/data/*` — 文件管理
- `/api/ai/*` — NL2SQL/需求识别
- `/api/auth/*` — 登录认证
- `/api/filters/*` — 筛选器选项

## 生产环境

- 腾讯云 VPS: `162.14.113.44`
- 域名: `https://chexian.cretvalu.com`
- PM2 进程: `chexian-api` 端口 3000
- CI/CD: push main → GitHub Actions → 构建→部署→健康检查
