# API-only 清理归档清单（2026-02）

## 归档策略

- 本次仅归档，不物理删除。
- 目标：移出运行链路外的过渡代码，避免后续误引用。
- 删除窗口：下一迭代（在回归验证稳定后执行）。

## 归档目录

`archive/legacy-code/2026-02-api-only/`

## 已归档文件

### 1) 历史图表实现（不再被主链路引用）

- `src/charts/BubbleChart.ts`
- `src/charts/ExpenseAnalysisChart.ts`
- `src/charts/PremiumProgressChart.ts`
- `src/charts/QuadrantChart.ts`
- `src/charts/StackedBarChart.ts`
- `src/charts/VariableCostChart.ts`

### 2) 历史图表服务层（旧 ChartService 体系）

- `src/services/ChartService.ts`
- `src/services/charts/AdvancedChartRenderer.ts`
- `src/services/charts/BaseChartService.ts`
- `src/services/charts/ChartOptionBuilder.ts`
- `src/services/charts/ChartService.ts`
- `src/services/charts/KpiCardRenderer.ts`
- `src/services/charts/index.ts`

### 3) 历史看板链路（已被 PremiumDashboard + PageFilterPanel 替代）

- `src/features/dashboard/Dashboard.tsx`
- `src/features/dashboard/components/DataErrorIndicator.tsx`
- `src/features/dashboard/hooks/useAlerts.ts`
- `src/features/dashboard/hooks/useBaseKpiData.ts`
- `src/features/dashboard/hooks/useDashboardData.ts`
- `src/features/dashboard/hooks/useDashboardFilters.ts`
- `src/features/dashboard/hooks/useDataQualityCheck.ts`
- `src/features/filters/FilterPanel.tsx`

## 归档前验证要点

- 以上文件在当前路由主链路中无运行时依赖。
- 归档后执行 `typecheck/governance/build` 及关键测试回归。

## 下一迭代删除条件

- 关键页面回归通过（dashboard/truck/renewal/growth/cost/coefficient/sql-query/premium-report/marketing-report）。
- 核心 API 验证通过（认证 + 查询 + 401 保护）。
- 导出功能验证通过（CSV/Excel/PDF）。
