---
phase: 03-code-structure
plan: "03"
subsystem: frontend-contexts
tags: [react-context, performance, refactor, filtercontext, stablecontext]
dependency_graph:
  requires: []
  provides: [StableContext, FilterContext-split]
  affects: [src/shared/contexts/FilterContext.tsx, src/shared/contexts/StableContext.tsx, src/app/App.tsx]
tech_stack:
  added: []
  patterns: [context-splitting, stable-vs-volatile-state]
key_files:
  created:
    - src/shared/contexts/StableContext.tsx
  modified:
    - src/shared/contexts/FilterContext.tsx
    - src/app/App.tsx
decisions:
  - "useGlobalFilters() 保持原有 11 字段接口不变，合并两个 Context，确保 48 个消费者零修改"
  - "maxDataDate/availableYears 使用 policy 口径直接派生（两口径在当前实现完全相同）"
  - "_internal.latestInitResult 桥接 StableProvider → FilterProvider 的初始日期同步"
metrics:
  duration: "~15min"
  completed: "2026-04-13"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 2
status: checkpoint-pending
---

# Phase 3 Plan 03: FilterContext 拆分 Summary

## 目标

FilterContext 拆分：将稳定状态（筛选选项/权限/日期元数据）与易变状态（筛选条件/折叠状态）分离为两个 Context，减少无效重渲染。筛选条件变更时仅订阅筛选状态的组件重渲染。

## 一句话总结

StableContext（筛选选项/团队映射/日期元数据）+ FilterContext（筛选条件/折叠状态）拆分，useGlobalFilters() 合并两个 Context 保持 48 个消费者向后兼容。

## 已完成任务

| 任务 | 状态 | Commit | 文件 |
|------|------|--------|------|
| Task 1: 创建 StableContext 并重构 FilterContext | 完成 | 4923571 | StableContext.tsx(新建), FilterContext.tsx, App.tsx |

## 待完成任务

| 任务 | 类型 | 状态 |
|------|------|------|
| Task 2: 验证 FilterContext 拆分后页面功能正常 | checkpoint:human-verify | 等待人工验证 |

## 实现细节

### StableContext.tsx（新建）

- 持有：`filterOptions`、`salesmanTeamMap`、`maxDataDate`、`availableYears`、`isLoading`、`initializeFilters`
- 将原 FilterContext 中的 API 加载逻辑（`loadFilterOptions`、`initializeFilters`）完整迁移
- 通过 `_internal.latestInitResult` 向 FilterProvider 暴露初始化结果（日期范围同步）
- 导出：`useStableContext()`、`StableProvider`

### FilterContext.tsx（重构）

- 仅持有易变状态：`filters`、`setFilters`、`isFilterCollapsed`、`toggleFilterCollapsed`、`availableSalesmen`
- `FilterProvider` 内部 `useStableContext()` 获取稳定数据，监听 `_internal.latestInitResult` 同步初始日期范围
- `useGlobalFilters()` 合并两个 Context，返回原有 11 字段接口（向后兼容）

### App.tsx（更新）

Provider 嵌套顺序：`ExportProvider > StableProvider > FilterProvider`

## 偏差记录

无偏差 — 按计划执行。

## Known Stubs

无。

## Threat Flags

无（纯前端 Context 重构，不涉及安全边界）。

## Self-Check

待 Task 2 人工验证通过后更新。

### 已验证项

- [x] `src/shared/contexts/StableContext.tsx` 存在，导出 `useStableContext` 和 `StableProvider`
- [x] `StableContext.tsx` 包含 `filterOptions: FilterOptions`
- [x] `StableContext.tsx` 包含 `salesmanTeamMap: Map<string, string>`
- [x] `FilterContext.tsx` 包含 `useStableContext` 导入（3 处引用）
- [x] `FilterContext.tsx` 仍导出 `useGlobalFilters` 和 `FilterProvider`
- [x] `App.tsx` 包含 `<StableProvider>` 和 `</StableProvider>`
- [x] `App.tsx` 包含 `import { StableProvider } from '../shared/contexts/StableContext'`
- [x] `bun run build` 零 TS 错误
- [x] `useGlobalFilters` 共 50 个引用（48 消费者 + 1 定义 + 1 导入）
