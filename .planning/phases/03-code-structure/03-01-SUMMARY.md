---
phase: 03-code-structure
plan: "01"
subsystem: sql-generators
tags: [refactor, sql, barrel-pattern, code-structure]
dependency_graph:
  requires: []
  provides: [SQL-04]
  affects:
    - server/src/sql/trend.ts
    - server/src/sql/trend/
    - server/src/sql/performance-analysis/shared.ts
    - server/src/sql/performance-analysis-shared.ts
tech_stack:
  added: []
  patterns:
    - barrel-re-export (established by cost.ts, extended to trend + performance-analysis)
key_files:
  created:
    - server/src/sql/trend/shared.ts
    - server/src/sql/trend/premium-trend.ts
    - server/src/sql/trend/total-trend.ts
    - server/src/sql/trend/quality-business.ts
    - server/src/sql/trend/dimension-queries.ts
    - server/src/sql/performance-analysis/shared.ts
  modified:
    - server/src/sql/trend.ts (barrel re-export, 561→18行)
    - server/src/sql/performance-analysis-shared.ts (转发 barrel, 545→7行)
    - server/src/sql/performance-analysis.ts (import路径更新)
    - server/src/sql/performance-analysis/trend.ts
    - server/src/sql/performance-analysis/drilldown.ts
    - server/src/sql/performance-analysis/top-salesman.ts
    - 开发文档/00_index/CODE_INDEX.md
decisions:
  - summary.ts 已在上一阶段更新为 ./shared.js，本次无需改动，属于预期情况
metrics:
  duration_minutes: 17
  tasks_completed: 2
  files_created: 6
  files_modified: 7
  completed_date: "2026-04-13"
---

# Phase 03 Plan 01: SQL 大文件拆分（trend + performance-analysis-shared）Summary

trend.ts（561行）按 cost.ts 先例拆分为 5 个子文件；performance-analysis-shared.ts（545行）移入 performance-analysis/ 子目录并改为转发 barrel，调用方零修改。

## What Was Built

### Task 1: trend.ts 拆分为 sql/trend/ 子目录

将 561 行的 `server/src/sql/trend.ts` 按功能拆分为 5 个聚焦文件：

| 文件 | 行数 | 职责 |
|------|------|------|
| `trend/shared.ts` | 35 | TimeView 类型 + QUALITY_BUSINESS_CONDITION 常量 + 共享 import re-export |
| `trend/premium-trend.ts` | 210 | generatePremiumTrendQuery（按机构分组趋势） |
| `trend/total-trend.ts` | 195 | generateTotalPremiumTrendQuery（总体趋势，不分机构） |
| `trend/quality-business.ts` | 108 | generateQualityBusinessTrendQuery（优质业务占比趋势） |
| `trend/dimension-queries.ts` | 40 | generateOrgListQuery + generateDimensionOptionsQuery |

`trend.ts` 改写为 18 行 barrel re-export，5 个 `export *` 语句覆盖所有原始导出。

### Task 2: performance-analysis-shared.ts 移入子目录

- 新建 `performance-analysis/shared.ts`（546 行），内容与原文件相同，仅将 import 路径从 `../utils/security.js` 更新为 `../../utils/security.js`
- 原 `performance-analysis-shared.ts` 改为转发 barrel（7 行）
- 更新 `performance-analysis.ts` barrel 中的两处 import 路径（从 `./performance-analysis-shared.js` → `./performance-analysis/shared.js`）
- 更新 `performance-analysis/trend.ts`、`drilldown.ts`、`top-salesman.ts` 的 import 路径（从 `../performance-analysis-shared.js` → `./shared.js`）
- `performance-analysis/summary.ts` 已在前序阶段更新，本次无需修改
- `performance-heatmap.ts` 通过转发 barrel 自动兼容，保持不变
- CODE_INDEX.md 同步更新趋势和业绩模块描述

## Verification Results

```
bun run build       → 零 TS 错误
bun run test        → 1353 passed (82 test files)
bun run governance  → 22/22 通过（含 #22 SQL 模块数一致性）
wc -l trend/*.ts    → 最大 210 行，全部 < 400 行
```

## Deviations from Plan

### Auto-noted Behavior

**performance-analysis/summary.ts 已提前更新**
- **Found during:** Task 2 初始读取
- **Issue:** summary.ts 第24行已是 `from './shared.js'`（已在前序 Phase 02 中更新）
- **Action:** 跳过修改，符合预期
- **Impact:** 无，不影响任务完成

## Known Stubs

None.

## Threat Flags

None — 纯代码结构重构，零 SQL 逻辑变更，零安全边界变更。

## Self-Check: PASSED

- [x] `server/src/sql/trend/shared.ts` — FOUND
- [x] `server/src/sql/trend/premium-trend.ts` — FOUND
- [x] `server/src/sql/trend/total-trend.ts` — FOUND
- [x] `server/src/sql/trend/quality-business.ts` — FOUND
- [x] `server/src/sql/trend/dimension-queries.ts` — FOUND
- [x] `server/src/sql/performance-analysis/shared.ts` — FOUND
- [x] commit `840a3e1` — Task 1 (trend split)
- [x] commit `290dd4a` — Task 2 (performance-analysis-shared move)
- [x] bun run test: 1353 passed
- [x] bun run governance: 22/22
