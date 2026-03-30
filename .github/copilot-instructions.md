# Copilot Instructions — chexian-api

车险数据分析平台。React + TypeScript + Vite 前端，Express + DuckDB 后端。

## 数据架构

数据统一存放于 `policy/current/`（4 个分片），服务器直接加载：

- `warehouse/fact/policy/current/*.parquet` — 保单+保费，3层分片（static/weekly/daily）
- `warehouse/fact/claims/latest.parquet` — 赔付+费用，每周全量替换
- `warehouse/fact/quotes/latest.parquet` — 报价状态，每日全量替换

服务器启动直接加载 `policy/current/` 分片，无 daily/ 检测逻辑。

ETL 唯一入口：`node 数据管理/daily.mjs`（3层分片架构，无参数自动检测）。

## 红线

- 业务口径只追加不删改（duckdb.ts / query.ts）
- 分域架构不可合回单体 parquet
- 报价数据口径待修正（`是否报价` 不可靠，应以续保单号非空判定）— 用户待办
- VPS 禁止查原始 PolicyFact（续保除外）
- 包管理用 Bun，禁止 npm/yarn
- JWT 禁止绕过，三级限流禁止降低

## 关键路径

- `server/src/services/duckdb.ts` — 查询执行 + loadDomainParquet()
- `server/src/config/paths.ts` — 域路径函数
- `server/src/sql/*.ts` — 24 个 SQL 生成器
- `数据管理/daily.mjs` — 分域 ETL
- `数据管理/pipelines/transform.py` — Excel→Parquet（--domain/--after-date）

## 命令

```bash
bun run dev:full      # 启动前后端
bun run build         # 类型检查+构建
bun run governance    # push 前必跑
```

## 回复语言

所有回复使用中文，代码/命令/专有名词除外。
