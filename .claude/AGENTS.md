# AGENTS.md

> GitHub Copilot / Codex 协作指南 — **chexian-api** 车险数据分析平台

## 项目概览

React + TypeScript + Vite 前端，Express + DuckDB 后端。生产环境 `https://chexian.cretvalu.com`。

## 技术栈

- **前端**: React 18 + TypeScript + Vite + ECharts + Tailwind CSS
- **后端**: Express + DuckDB (in-memory) + JWT 认证
- **运行时**: Node.js (tsx) — 后端不用 Bun 运行
- **包管理**: Bun（禁止 npm/yarn）
- **ETL**: Python 3 (pandas + pyarrow) + Node.js (daily.mjs)
- **部署**: GitHub Actions → VPS (PM2 + Nginx)

## 数据架构

数据统一存放于 `policy/current/`（4 个分片文件），服务器直接加载：

```
warehouse/fact/
├── policy/current/*.parquet          # 保单+保费（3层分片：static/weekly/daily）
├── claims/latest.parquet             # 赔付+费用（按保单号聚合去重）
└── quotes/latest.parquet             # 报价状态（续保单号去重）
```

### 数据加载流程

```
app.ts 启动
  ↓ 加载 policy/current/*.parquet → raw_parquet VIEW
  ↓
createPolicyFactView('raw_parquet') → 列名映射（中→英）→ PolicyFact VIEW
  ↓
materializePolicyFactWorkingSet() → PolicyFactRealtime TABLE + 3索引
  ↓
createCrossSellRealtimeView() → CrossSellDailyAgg（按月分批物化）
```

### ETL 命令

```bash
node 数据管理/daily.mjs            # 智能检测，自动判断需更新的域
node 数据管理/daily.mjs premium    # 保单+保费增量追加
node 数据管理/daily.mjs claims     # 赔付+费用全量替换
node 数据管理/daily.mjs quotes     # 报价状态全量替换
node 数据管理/daily.mjs all        # 全部重跑
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/app.ts` | 服务器入口，域拆分检测 |
| `server/src/services/duckdb.ts` | DuckDB 服务，加载 `policy/current/` 分片 |
| `server/src/config/paths.ts` | 路径配置，`getPolicyCurrentDir()` 等 |
| `server/src/normalize/mapping.ts` | 中文→英文列名映射 |
| `server/src/sql/*.ts` | 24 个 SQL 生成器 |
| `数据管理/daily.mjs` | 分域 ETL 入口（智能检测） |
| `数据管理/pipelines/transform.py` | Excel→Parquet 转换（`--domain`/`--after-date`） |
| `数据管理/pipelines/split_existing.py` | ~~一次性迁移脚本~~（已废弃，迁移已完成） |
| `数据管理/pipelines/merge_parquet.py` | Parquet 合并工具 |

## 指标注册表

新增/修改指标必须先改 `server/src/config/metric-registry/categories/*.ts`，再改 SQL 生成器。禁止硬编码新指标公式。详见 `metric-registry/types.ts`。

## 红线规则

1. **业务口径只追加不删改**: `duckdb.ts` 和 `query.ts` 已有逻辑禁止修改/删除
2. **current/ 分片架构不可合回单体**: policy 域用 3层分片（static/weekly/daily），禁止合回一个大 parquet
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

## 指标开发协议

指标注册表：`server/src/config/metric-registry/`（L1-L3 原子指标的唯一事实源）

新增指标：先 `grep -r "id: '${NEW_ID}'" server/src/config/metric-registry/` 确认不存在，然后在 `categories/*.ts` 中添加 MetricDefinition。L4 复杂查询留在 SQL 生成器中，但引用注册表中的原子指标。

禁止事项：禁止在 SQL 生成器中硬编码已注册指标 SQL · 禁止在前端硬编码新指标标签 · 修改公式必须更新 version 和 changelog。

## 生产环境

- 腾讯云 VPS: `162.14.113.44`
- 域名: `https://chexian.cretvalu.com`
- PM2 进程: `chexian-api` 端口 3000
- CI/CD: push main → GitHub Actions → 构建→部署→健康检查
