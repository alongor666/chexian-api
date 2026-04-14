---
phase: "04"
plan: "01"
subsystem: "duckdb-service"
tags: ["refactor", "duckdb", "materialization", "module-split"]
dependency_graph:
  requires: []
  provides: ["duckdb-parquet-loader", "duckdb-type-converter", "duckdb-init-tables", "duckdb-materialization"]
  affects: ["server/src/services/duckdb.ts", "server/src/routes/data.ts"]
tech_stack:
  added: []
  patterns: ["module-extraction", "dependency-injection", "single-responsibility"]
key_files:
  created:
    - "server/src/services/duckdb-parquet-loader.ts"
    - "server/src/services/duckdb-type-converter.ts"
    - "server/src/services/duckdb-init-tables.ts"
    - "server/src/services/duckdb-materialization.ts"
    - "server/src/services/duckdb-infra.ts"
    - "server/src/services/duckdb-types.ts"
  modified:
    - "server/src/services/duckdb.ts"
    - "server/src/routes/data.ts"
    - "server/src/services/__tests__/duckdb-derived-tables.test.ts"
    - "server/src/services/__tests__/duckdb-materialize-batches.test.ts"
    - "tests/api/data-load-raw-parquet-contract.test.ts"
decisions:
  - "duckdb.ts 精简到 110 行，仅保留 DuckDBService 类骨架和委托方法"
  - "物化逻辑（materializeInBatches/createPolicyFactView/dropAllDerivedTables）提取到独立 duckdb-materialization.ts"
  - "所有提取函数接收 DuckDBQueryable 接口，不依赖具体类（依赖注入）"
  - "测试和路由直接导入函数，不再通过 duckdbService 代理方法调用"
  - "契约测试 data-load-raw-parquet-contract.test.ts 同步更新指向 duckdb-infra.ts"
metrics:
  duration: "~30min"
  completed: "2026-04-14T05:28:40Z"
  tasks_completed: 3
  files_modified: 5
---

# Phase 04 Plan 01: DuckDB 服务模块拆分 Summary

**一句话总结**：将 DuckDB 服务从单体 600 行文件拆分为 6 个职责清晰的子模块，duckdb.ts 精简至 110 行，物化函数改为接收 DuckDBQueryable 接口的独立函数。

## 执行摘要

### Task 1 — 拆分子模块（commit: 2e31778）

从 `duckdb.ts` 提取三个新子模块：
- `duckdb-parquet-loader.ts` — Parquet 多文件加载逻辑
- `duckdb-type-converter.ts` — BigInt/Date 序列化转换
- `duckdb-init-tables.ts` — 启动时表初始化（KpiPlanConfig 等）
- `duckdb-types.ts` — `DuckDBQueryable` 接口定义
- `duckdb-infra.ts` — 连接池、查询缓存、dropRelationIfExists 等基础设施

### Task 2 — duckdb.ts 瘦身 + 删除代理方法（commit: 1a3bd3e）

- `duckdb.ts` 从 ~600 行精简到 110 行
- 删除 `createPolicyFactView`、`dropAllDerivedTables`、`materializeInBatches` 等代理方法
- `duckdb-materialization.ts` 中的函数签名改为 `fn(db: DuckDBQueryable, ...args)`

### Task 3 — 修复测试和路由调用点（commit: c0783d8）

- `duckdb-derived-tables.test.ts`：添加 `dropAllDerivedTables` 直接导入，替换所有 `duckdbService.dropAllDerivedTables()` 为 `dropAllDerivedTables(duckdbService)`
- `duckdb-materialize-batches.test.ts`：添加 `materializeInBatches` 直接导入，替换所有调用，在第一个参数位置插入 `duckdbService`
- `routes/data.ts`：添加 `createPolicyFactView, dropAllDerivedTables` 直接导入，替换两处代理调用
- `data-load-raw-parquet-contract.test.ts`：契约测试更新指向实际实现位置 `duckdb-infra.ts`

## 验证结果

```
bun run build  → 零 TS 错误
bun run test   → 86 个测试文件 / 1511 个测试，全部通过
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 更新契约测试 data-load-raw-parquet-contract.test.ts**
- **Found during:** Task 3 运行 `bun run test` 后
- **Issue:** 契约测试检查 `duckdb.ts` 中的 `dropRelationIfExists` 实现代码（`FROM information_schema.tables`、`DROP VIEW IF EXISTS` 等），但这些代码已在 Task 1 迁移到 `duckdb-infra.ts`
- **Fix:** 将测试分为两部分：检查 `duckdb-infra.ts` 的实际 DROP 逻辑 + 检查 `duckdb.ts` 的委托方法存在性
- **Files modified:** `tests/api/data-load-raw-parquet-contract.test.ts`
- **Commit:** c0783d8

## Known Stubs

无。

## Threat Flags

无新增网络端点或安全面。

## Self-Check: PASSED

- [x] `server/src/services/duckdb-materialization.ts` — 存在
- [x] `server/src/services/duckdb-infra.ts` — 存在
- [x] `server/src/services/duckdb.ts` — 存在（110 行）
- [x] commit 2e31778 — 存在
- [x] commit 1a3bd3e — 存在
- [x] commit c0783d8 — 存在
- [x] `bun run build` — 通过（零错误）
- [x] `bun run test` — 1511 个测试全部通过
