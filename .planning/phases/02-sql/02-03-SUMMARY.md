---
phase: 02-sql
plan: 03
subsystem: frontend
tags: [cleanup, coefficient, migration, dead-code-removal]
dependency_graph:
  requires: [02-02]
  provides: [coefficient-frontend-removed, org-groups-migrated, date-utils-migrated]
  affects: [src/features/dashboard, src/features/cost, src/app, src/components/layout, src/shared/api, src/shared/types]
tech_stack:
  added: []
  patterns: [dead-code-removal, dependency-migration-before-deletion]
key_files:
  created:
    - src/shared/config/org-groups.ts
    - src/shared/utils/date.ts
  modified:
    - src/features/dashboard/CrossSellOrgTrendChart.tsx
    - src/features/cost/components/CostAnalysisPanel.tsx
    - src/app/App.tsx
    - src/components/layout/SidebarNavigation.tsx
    - src/components/layout/SidebarFilterPanel.tsx
    - src/features/admin/AccessControlPage.tsx
    - src/features/file/ReportTemplatesModal.tsx
    - src/shared/api/routes.ts
    - src/shared/api/client.ts
    - src/shared/api/query-keys.ts
    - src/shared/types/filters.ts
    - src/shared/ai-insights/prompts.ts
    - src/shared/ai-insights/types.ts
    - 开发文档/00_index/CODE_INDEX.md
  deleted:
    - src/features/coefficient/ (11 files)
    - src/features/pages/CoefficientPage.tsx
    - src/shared/utils/coefficient-period.ts
    - src/shared/config/coefficient-thresholds.ts
decisions:
  - "SQL-03 搁置：用户决策 D-08，无需 EXPLAIN ANALYZE，书面结论存档于本计划 objective 章节"
  - "FilterPresetName 中 coefficient 联合类型及 preset 定义一并删除（Rule 2：死代码清理）"
  - "ai-insights types/prompts 中 coefficient 字面量一并清理（无调用路径）"
metrics:
  duration_minutes: 35
  tasks_completed: 3
  files_changed: 18
  files_deleted: 14
  completed_date: "2026-04-13"
---

# Phase 02 Plan 03: 前端系数监控模块全链路删除 Summary

前端系数监控功能全量清除 — ORG_GROUPS/formatDate 迁移到通用模块，coefficient 目录+页面+路由+导航+API 定义全部删除，build/governance 22/22 通过。

## Objective

彻底移除前端系数监控功能（组件目录 + 页面 + 路由注册 + 导航项 + API 客户端定义 + 所有 /coefficient 路径引用），同时保证交叉销售和成本分析模块的依赖正常工作。SQL-03 的搁置决策以书面结论形式存档。

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | 迁移 ORG_GROUPS/formatDate 到通用模块 | `3bfce4a` | org-groups.ts, date.ts, CrossSellOrgTrendChart.tsx, CostAnalysisPanel.tsx |
| 2a | 删除系数专属文件并清理 App/Sidebar/API | `408d812` | coefficient/(11 files), CoefficientPage.tsx, App.tsx, SidebarNavigation.tsx, routes.ts, client.ts, query-keys.ts |
| 2b | 清理三个额外文件 /coefficient 引用并更新索引 | `9c552f0` | SidebarFilterPanel.tsx, AccessControlPage.tsx, ReportTemplatesModal.tsx, filters.ts, ai-insights, CODE_INDEX.md |

## Verification Results

```
bun run build  →  ✓ built in 5.44s（零 TS 报错）
bun run governance  →  22/22 checks passed
grep -rn "coefficient" src/ (系数监控模块相关)  →  零输出
```

残余的 `coefficient` 字符串均属合法的热力图"系数均值"指标（`avgPricingCoefficient`，`PerformanceOrgHeatmapV2/`），与系数监控模块无关。

## SQL-03 搁置结论（书面存档）

**需求**：SQL-03 要求对 earned-premium-detail.ts 进行 EXPLAIN ANALYZE 验证，判断 12 月滚动查询是否适合 CTE 合并。

**用户决策（D-08）**：用户明确表示"暂时忘了具体上下文，搁置到后续阶段或需求明确后再处理"。

**结论**：SQL-03 在本次 Phase 2 执行中**跳过**，不执行 EXPLAIN ANALYZE 分析，也不修改 earned-premium-detail.ts 任何代码。该需求仍保留在 REQUIREMENTS.md SQL-03 条目中，待后续用户重新明确上下文后在独立阶段处理。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - 死代码清理] 删除 FilterPresetName 中 coefficient 联合类型及 preset 定义**
- **Found during:** Task 2b
- **Issue:** SidebarFilterPanel.tsx 中的 `/coefficient` 路由映射删除后，`filters.ts` 中 `FilterPresetName | 'coefficient'` 联合类型和对应 `coefficient: { ... }` preset 定义已无消费者
- **Fix:** 从 `FilterPresetName` 联合类型移除 `'coefficient'`，删除 `coefficient` preset 定义块（约 20 行）
- **Files modified:** `src/shared/types/filters.ts`
- **Commit:** `9c552f0`

**2. [Rule 2 - 死代码清理] 删除 ai-insights 中 coefficient 字面量**
- **Found during:** Task 2b
- **Issue:** `getPromptByType()` 函数签名和 `DataContext.type` 联合类型中包含 `'coefficient'`，但系数监控模块删除后该分支已无调用路径
- **Fix:** 从两处联合类型移除 `'coefficient'` 字面量
- **Files modified:** `src/shared/ai-insights/prompts.ts`, `src/shared/ai-insights/types.ts`
- **Commit:** `9c552f0`

## Known Stubs

None — 无任何 stub 或 placeholder 残留。

## Threat Surface Scan

无新增网络端点、认证路径或文件访问模式。本计划为纯删除操作，缩减了攻击面（/coefficient 路由已不可访问）。

## Self-Check

- [x] `src/shared/config/org-groups.ts` 存在
- [x] `src/shared/utils/date.ts` 存在
- [x] `src/features/coefficient/` 目录已删除
- [x] commit `3bfce4a` 存在（Task 1）
- [x] commit `408d812` 存在（Task 2a）
- [x] commit `9c552f0` 存在（Task 2b）
- [x] `bun run build` 零报错
- [x] `bun run governance` 22/22 通过
