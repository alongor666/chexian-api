# SQL 模块索引

## SQL 生成器清单

### kpi.ts
**用途**: 基础 KPI SQL 查询生成器  
**状态**: 生效中  
**输出**: KPI 占比值（如 transfer_rate: 0.35）

**关键函数**:
- `generateKpiQuery()`: 生成 KPI 查询
- `generateTopNQuery()`: 生成 Top N 排名查询
- `generateSalesmanTableQuery()`: 生成业务员明细表查询
- `generateDimensionShareQuery()`: 生成维度占比查询

### kpi-detail.ts
**用途**: KPI 详细数据 SQL 查询生成器（用于环形图）  
**状态**: 生效中 (2026-01-09 新增)  
**输出**: KPI 占比分解数据（如 transfer_count: 175, non_transfer_count: 325）

**关键函数**:
- `generateKpiDetailQuery()`: 生成 KPI 详细数据查询
- `calculateRate()`: 计算占比百分比
- `extractDonutData()`: 从 KpiDetailResult 提取环形图数据

**接口定义**:
```typescript
export interface KpiDetailResult {
  // 基础 KPI
  total_premium: number;
  policy_count: number;
  per_capita_premium: number;

  // 占比类 KPI 分解数据
  transfer_count: number;
  non_transfer_count: number;
  telesales_count: number;
  non_telesales_count: number;
  renewal_count: number;
  non_renewal_count: number;
  commercial_premium: number;
  non_commercial_premium: number;
  nev_count: number;
  non_nev_count: number;
  new_car_count: number;
  non_new_car_count: number;
}
```

### trend.ts
**用途**: 趋势分析 SQL 查询生成器  
**状态**: 生效中  
**支持视图**: 日/周/月/年

**关键函数**:
- `generatePremiumTrendQuery()`: 生成保费趋势查询（按机构）
- `generateTotalPremiumTrendQuery()`: 生成总保费趋势查询（全局）
- `generateQualityBusinessTrendQuery()`: 生成优质业务趋势查询

### cross-sell-trend.ts
**用途**: 驾意险推介率趋势 SQL 查询生成器  
**状态**: 生效中（2026-02-25 新增）  
**支持视图**: 日/周/月/季度  
**输出字段**: `time_period`, `coverage_combination`, `rate`, `auto_count`

**关键函数**:
- `generateCrossSellTrendQuery()`: 生成交叉销售趋势查询
- `getTimeGroupExpr()`: 生成时间粒度分组表达式

### truck.ts
**用途**: 营业货车专项分析 SQL 查询生成器  
**状态**: 生效中  
**分段逻辑**: 0-2吨/2-5吨/5-10吨/10吨以上

**关键函数**:
- `generateTruckSegmentPremiumQuery()`: 生成吨位分段保费查询
- `generateTruckSegmentDetailQuery()`: 生成吨位分段详细查询

### growth.ts
**用途**: 增长分析 SQL 查询生成器  
**状态**: 生效中  
**支持对比**: 环比/同比

**关键函数**:
- `generateGrowthQuery()`: 生成增长对比查询

## 数据口径说明

### 承保口径（默认）
**定义**: 仅统计 `premium > 0` 的保单记录  
**适用**: 件数统计类 KPI、占比类 KPI 的分母

### 净额口径
**定义**: 包含正/零/负保费的所有保单记录  
**适用**: 保费统计类 KPI

**详细说明**: 参见 [开发文档/KPI口径说明.md](../../../开发文档/KPI口径说明.md)

## 护栏规则（禁止修改）

⚠️ **以下文件涉及业务口径定义，禁止擅自修改**：
- `kpi.ts`: KPI 计算逻辑
- `kpi-detail.ts`: KPI 详细数据逻辑

**如需变更**:
1. 在 `BACKLOG.md` 登记（状态=PROPOSED）
2. 提供证据（需求文档/产品确认）
3. 只能追加新模板，不得修改已有 SQL

## 测试覆盖

- `tests/kpi.test.ts` - KPI SQL 生成测试
- `tests/kpi-detail.test.ts` - KPI 详细数据 SQL 生成测试 (2026-01-09 新增)
- `tests/natural-week.test.ts` - 自然周计算逻辑测试

## 相关文档

- [KPI口径说明](../../../开发文档/KPI口径说明.md)
- [技术栈声明](../../../开发文档/TECH_STACK.md)
- [DuckDB 官方文档](https://duckdb.org/docs/)

## 变更记录

| 日期 | 文件 | 变更内容 |
|------|------|---------|
| 2026-02-25 | cross-sell-trend.ts | 新增驾意险推介率趋势 SQL 生成器（支持日/周/月/季度，含整体+主全/交三/单交） |
| 2026-01-09 | kpi-detail.ts | 新增 KPI 详细数据 SQL 生成器 |
| 2026-01-08 | truck.ts | 新增营业货车专项分析 SQL |
| 2026-01-08 | trend.ts | 新增自然周/月视图支持 |

### performance-analysis.ts
**用途**: 业绩分析独立页面 SQL 生成器（`/performance-analysis`）  
**状态**: 生效中（2026-02-26 新增）  
**输出范围**:
- 险别组合业绩环比（车险保费/车险件数/件均保费/增长率）
- 车险保费/车险件数趋势
- 下钻分组（达成率+增长率+结构占比）
- Top20 业务员

**关键函数**:
- `generatePerformanceSummaryQuery()`
- `generatePerformanceTrendQuery()`
- `generatePerformanceDrilldownQuery()`
- `generatePerformanceTopSalesmanQuery()`
- `getPerformanceVehicleCategoryFilter()`

| 2026-02-26 | performance-analysis.ts | 新增业绩分析独立页面 SQL 生成器与 4 个 performance 接口查询模板 |
| 2026-02-27 | performance-analysis.ts | 新增 `generatePerformancePeriodBoundsQuery` 与 period bounds 复用参数，供 `performance-bundle` 减少重复时间窗口扫描 |
| 2026-02-27 | cross-sell.ts / cross-sell-summary.ts / cross-sell-trend.ts / cross-sell-top-salesman.ts | 交叉销售热点查询切换到 `CrossSellDailyAgg` 预聚合表，减少运行时重复去重与布尔兼容计算 |
| 2026-03-04 | cross-sell-heatmap.ts | 新增交叉销售热力图 SQL 生成器，返回最近14天所有三级机构的推介率和件均保费数据 |
| 2026-03-08 | performance-analysis.ts | `generatePerformanceOrgHeatmapQuery` 新增 `prev_mom_premium` / `prev_yoy_premium` 输出列，支持前端按分公司总分母重算同比/环比，消除跨维度分公司增长率不一致 |

### comprehensive-analysis.ts
**用途**: 综合分析页 SQL 生成器（`/comprehensive-analysis`）  
**状态**: 生效中（2026-02-28 新增）  
**输出范围**:
- 综合汇总指标（签单保费/赔款/费用/变动成本率）
- 维度聚合明细（机构/客户类别/业务类型）
- 赔付趋势（日/周/月）
- 年计划（按机构）

**关键函数**:
- `generateComprehensiveSummaryQuery()`
- `generateComprehensiveDimensionMetricsQuery()`
- `generateComprehensiveLossTrendQuery()`
- `generateComprehensivePlanByOrgQuery()`
| 2026-03-03 | performance-analysis.ts | 新增 `generatePerformanceOrgHeatmapQuery`，支持三级机构连续15周期热力图（增长率/达成率/保费）查询 |
