# Copilot Instructions — chexian-api

车险数据分析平台。React + TypeScript + Vite 前端，Express + DuckDB 后端。

## 分域 Lakehouse 数据架构

数据拆分为 3 个独立域，DuckDB 启动时用 LEFT JOIN 合并为 PolicyFact 视图：

- `warehouse/fact/policy/daily/*.parquet` — 保单+保费，按日分区，每日增量追加
- `warehouse/fact/claims/latest.parquet` — 赔付+费用，每周全量替换
- `warehouse/fact/quotes/latest.parquet` — 报价状态，每日全量替换

服务器检测 `policy/daily/` 存在 → `duckdb.ts:loadDomainParquet()` 3路 JOIN；不存在 → 回退旧模式。

ETL 入口：`node 数据管理/daily.mjs`（智能检测，无参数自动判断）。

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
