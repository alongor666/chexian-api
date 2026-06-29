# GEMINI.md

> Google Gemini 协作指南 — **chexian-api** 车险数据分析平台

## 项目简介

车险经营管理系统，为保险公司提供 KPI 仪表盘、业绩分析、成本综合、续保追踪等数据分析能力。

- **前端**: React + TypeScript + Vite + ECharts
- **后端**: Express + DuckDB (内存数据库) + JWT
- **数据层**: 3层分片架构（Python + Node.js ETL），数据统一存放于 `policy/current/`
- **部署**: GitHub Actions → 腾讯云 VPS (PM2)
- **生产地址**: https://chexian.cretvalu.com

## 数据架构（核心）

### 数据架构

数据统一存放于 `policy/current/`（3层分片架构），各域独立更新频率：

| 域 | 路径 | 更新频率 | 内容 |
|---|---|---|---|
| Policy | `warehouse/fact/policy/current/*.parquet` | daily.mjs 3层分片 | 保单+保费（static/weekly/daily 分片） |
| Claims | `warehouse/fact/claims/latest.parquet` | 每周全量 | 赔付+费用（按保单号聚合） |
| Quotes | `warehouse/fact/quotes/latest.parquet` | 每日全量 | 报价状态（续保单号→上年保单） |

### 服务器加载链

```
启动 → 直接加载 policy/current/*.parquet → raw_parquet VIEW
→ createPolicyFactView() → 中文列名映射为英文 → PolicyFact VIEW
→ 物化为 PolicyFactRealtime TABLE（3索引）
→ 物化 CrossSellDailyAgg（按月分批，防 OOM）
```

### ETL 工具

```bash
# 智能模式（推荐）：自动检测哪些域需要更新
node 数据管理/daily.mjs

# 强制指定域
node 数据管理/daily.mjs premium    # 保费增量（秒级）
node 数据管理/daily.mjs claims     # 赔付费用（选最大xlsx）
node 数据管理/daily.mjs quotes     # 报价状态（选最大xlsx）
node 数据管理/daily.mjs all        # 全部重跑

# 底层工具
python3 数据管理/pipelines/transform.py -i input.xlsx -o output.parquet --domain policy --after-date 2026-03-22
# python3 数据管理/pipelines/split_existing.py  # 已废弃：一次性迁移已完成
```

## 索引与文档

| 索引 | 路径 |
|------|------|
| 文档索引 | `开发文档/00_index/DOC_INDEX.md` |
| 代码索引 | `开发文档/00_index/CODE_INDEX.md` |
| 进展索引 | `开发文档/00_index/PROGRESS_INDEX.md` |

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求）· [PROGRESS.md](./PROGRESS.md)（进展）

## 目录结构

```
chexian-api/
├── src/                          # 前端 React 应用
│   ├── shared/                   #   共享组件/工具/类型/样式
│   └── widgets/                  #   页面级组件
├── server/                       # 后端 Express API
│   └── src/
│       ├── services/duckdb.ts    #   DuckDB 服务 + loadDomainParquet()
│       ├── config/paths.ts       #   路径配置（域路径函数）
│       ├── sql/                  #   24 个 SQL 生成器
│       ├── normalize/mapping.ts  #   中→英列名映射
│       └── routes/               #   API 路由
├── 数据管理/                      # ETL + 数据仓库
│   ├── daily.mjs                 #   分域 ETL 入口
│   ├── pipelines/                #   transform.py, split_existing.py
│   └── warehouse/fact/           #   3域 parquet 存储
├── scripts/                      # 部署/同步脚本
└── tests/                        # 单元+E2E 测试
```

## 指标注册表

新增/修改指标必须先改 `server/src/config/metric-registry/categories/*.ts`，再改 SQL 生成器。禁止硬编码新指标公式。

## 红线规则（必须遵守）

1. **业务口径只追加不删改** — `duckdb.ts` 和 `query.ts` 已有 SQL 逻辑禁止修改/删除
2. **current/ 分片架构不可合回单体** — policy 域用 3层分片（static/weekly/daily），禁止合回一个大 parquet
3. **报价数据口径待修正** — 当前 `是否报价` 字段不可靠，正确应以「续保单号非空」判定。**用户待办，AI 不得修改**
4. **VPS 禁止查询原始 PolicyFact**（续保除外）— 只能查预聚合表
5. **包管理用 Bun** — 禁止 npm/yarn
6. **安全**: JWT 禁止绕过，三级限流禁止降低

## 开发命令

```bash
bun install && bun run dev:full    # 安装+启动前后端
bun run build                      # TypeScript 类型检查+构建
bun run test                       # 单元测试
bun run test:e2e                   # E2E 测试
bun run governance                 # 治理校验（push 前必跑）
```

## API 概览

| 前缀 | 功能 |
|------|------|
| `/api/query/*` | KPI、趋势、排名、成本、系数、续保、交叉销售 |
| `/api/data/*` | 文件管理 |
| `/api/ai/*` | NL2SQL、需求识别 |
| `/api/auth/*` | 登录认证 (JWT) |
| `/api/filters/*` | 筛选器选项 |

## 生产环境

- **VPS**: 腾讯云 4核4G `162.14.113.44`
- **域名**: https://chexian.cretvalu.com
- **进程管理**: PM2 `chexian-api` 端口 3000
- **前端**: Nginx 静态文件 `/var/www/chexian/frontend/dist`
- **数据路径**: `/var/www/chexian/server/data/fact/{policy/current,claims,quotes}`
- **CI/CD**: push main → GitHub Actions 自动构建部署

## 指标开发协议

指标注册表：`server/src/config/metric-registry/`（L1-L3 原子指标的唯一事实源）

新增指标：先搜索注册表确认不存在，然后在 `categories/*.ts` 中添加 MetricDefinition。L4 复杂查询留在 SQL 生成器中。禁止在 SQL 生成器中硬编码已注册指标 SQL，禁止在前端硬编码新指标标签。修改公式必须更新 version 和 changelog。

## 关键约束

- DuckDB 日期序列化：DATE → `{days:N}`，TIMESTAMP → `{micros:N}`，需在 `duckdb.ts` 中反序列化
- 后端运行在 Node.js (tsx)，不是 Bun（multer 文件上传在 Bun 下会出错）
- 前端样式必须使用 `src/shared/styles/index.ts` 的全局样式，禁止硬编码 Tailwind 颜色
- 所有回复使用中文，代码/命令/专有名词除外
