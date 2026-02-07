# 营销战报板块实现计划

## 📋 需求概述

在仪表盘和营业货车之间插入新的"营销战报"板块，实现假日营销分析功能。

### 核心功能

**表一：机构战报**
- 字段：三级机构、车险保费、商业险保费、车险开单率、商业险开单率
- 排序：支持按每个字段排序（点击表头切换升序/降序）
- 开单率定义：节假日内有出单的业务员数 / 总业务员数

**表二：业务员明细表**
- 字段：业务员、三级机构、团队、假日车险签单天数、假日天数、假日车险签单比例、假日商业险签单天数、假日商业险签单比例
- 排序：支持按每个字段排序（点击表头切换）
- 签单比例：签单天数 / 节假日天数
- 筛选条件：签单口径（签单日期/起保日期）、年度2026、起止日期
- 统计范围：仅显示筛选期间内的节假日

## 🗂️ 目录结构

```
src/features/
├── marketing-report/          # 新增板块
│   ├── components/
│   │   ├── OrganizationReportTable.tsx    # 表一：机构战报
│   │   ├── SalesmanDetailTable.tsx         # 表二：业务员明细
│   │   └── MarketingReportPanel.tsx        # 主面板（包含两个表）
│   ├── hooks/
│   │   ├── useMarketingReport.ts           # 数据加载Hook
│   │   └── useHolidayData.ts               # 节假日数据Hook
│   ├── sql/
│   │   ├── orgReport.ts                    # 机构战报SQL
│   │   └── salesmanDetail.ts                # 业务员明细SQL
│   ├── utils/
│   │   ├── holidayData.ts                   # 2026年节假日数据
│   │   └── holidayUtils.ts                  # 节假日计算工具
│   ├── types/
│   │   └── marketingReport.ts               # 类型定义
│   └── index.ts
├── pages/
│   └── MarketingReportPage.tsx              # 页面组件
```

## 🔧 核心实现步骤

### 阶段一：数据基础设施（优先级：HIGH）

#### 1.1 创建节假日数据
**文件**: `src/features/marketing-report/utils/holidayData.ts`

**内容**：
```typescript
// 2026年中国法定节假日列表
export const HOLIDAYS_2026 = [
  // 元旦
  { name: '元旦', date: '2026-01-01' },
  // 春节（1月28日-2月3日，共7天）
  { name: '春节', date: '2026-01-28' },
  { name: '春节', date: '2026-01-29' },
  { name: '春节', date: '2026-01-30' },
  { name: '春节', date: '2026-01-31' },
  { name: '春节', date: '2026-02-01' },
  { name: '春节', date: '2026-02-02' },
  { name: '春节', date: '2026-02-03' },
  // 清明节
  { name: '清明节', date: '2026-04-04' },
  // 劳动节（5月1日-5月5日，共5天）
  { name: '劳动节', date: '2026-05-01' },
  { name: '劳动节', date: '2026-05-02' },
  { name: '劳动节', date: '2026-05-03' },
  { name: '劳动节', date: '2026-05-04' },
  { name: '劳动节', date: '2026-05-05' },
  // 端午节
  { name: '端午节', date: '2026-06-02' },
  // 中秋节
  { name: '中秋节', date: '2026-09-29' },
  // 国庆节（10月1日-10月7日，共7天）
  { name: '国庆节', date: '2026-10-01' },
  { name: '国庆节', date: '2026-10-02' },
  { name: '国庆节', date: '2026-10-03' },
  { name: '国庆节', date: '2026-10-04' },
  { name: '国庆节', date: '2026-10-05' },
  { name: '国庆节', date: '2026-10-06' },
  { name: '国庆节', date: '2026-10-07' },
];

export const HOLIDAY_SET = new Set(HOLIDAYS_2026.map(h => h.date));
```

#### 1.2 创建节假日工具函数
**文件**: `src/features/marketing-report/utils/holidayUtils.ts`

**内容**：
```typescript
import { HOLIDAY_SET } from './holidayData';

// 判断是否为节假日
export function isHoliday(dateStr: string): boolean;

// 获取日期范围内的所有节假日
export function getHolidaysInRange(startDate: string, endDate: string): Holiday[];

// 计算日期范围内的节假日天数
export function countHolidaysInRange(startDate: string, endDate: string): number;
```

#### 1.3 创建类型定义
**文件**: `src/features/marketing-report/types/marketingReport.ts`

**内容**：
```typescript
// 机构战报行
export interface OrganizationReportRow {
  org_level_3: string;
  车险保费: number;
  商业险保费: number;
  车险开单率: number;  // 车险出单业务员数 / 总业务员数
  商业险开单率: number;
}

// 业务员明细行
export interface SalesmanDetailRow {
  salesman_name: string;
  org_level_3: string;
  team_name: string;
  假日车险签单天数: number;
  假日天数: number;
  假日车险签单比例: number;
  假日商业险签单天数: number;
  假日商业险签单比例: number;
}

// 排序状态
export interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}
```

### 阶段二：SQL查询层（优先级：HIGH）

#### 2.1 机构战报SQL
**文件**: `src/features/marketing-report/sql/orgReport.ts`

**核心逻辑**：
```sql
WITH
-- 筛选日期范围内的节假日
holiday_dates AS (
  SELECT DISTINCT date_str
  FROM (VALUES -- 节假日列表
    ('2026-01-01'), ('2026-01-28'), ...
  ) AS h(date_str)
  WHERE date_str BETWEEN ${startDate} AND ${endDate}
),

-- 各机构的业务员总数
org_salesmen AS (
  SELECT
    org_level_3,
    COUNT(DISTINCT salesman_name) as total_salesmen
  FROM PolicyFact
  WHERE ${whereClause}
  GROUP BY org_level_3
),

-- 各机构在节假日的车险出单情况
org_car_holiday AS (
  SELECT
    p.org_level_3,
    COUNT(DISTINCT p.salesman_name) as car_holiday_salesmen
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.date_str
  WHERE p.is_commercial = false  -- 车险（非商业险）
    AND ${whereClause}
  GROUP BY p.org_level_3
),

-- 各机构在节假日的商业险出单情况
org_commercial_holiday AS (
  SELECT
    p.org_level_3,
    COUNT(DISTINCT p.salesman_name) as commercial_holiday_salesmen
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.date_str
  WHERE p.is_commercial = true  -- 商业险
    AND ${whereClause}
  GROUP BY p.org_level_3
)

-- 最终查询
SELECT
  o.org_level_3 as 三级机构,
  COALESCE(SUM(CASE WHEN p.is_commercial = false THEN p.premium ELSE 0 END), 0) as 车险保费,
  COALESCE(SUM(CASE WHEN p.is_commercial = true THEN p.premium ELSE 0 END), 0) as 商业险保费,
  COALESCE(ch.car_holiday_salesmen, 0) * 1.0 / NULLIF(o.total_salesmen, 0) as 车险开单率,
  COALESCE(cmh.commercial_holiday_salesmen, 0) * 1.0 / NULLIF(o.total_salesmen, 0) as 商业险开单率
FROM org_salesmen o
LEFT JOIN PolicyFact p ON o.org_level_3 = p.org_level_3 AND ${whereClause}
LEFT JOIN org_car_holiday ch ON o.org_level_3 = ch.org_level_3
LEFT JOIN org_commercial_holiday cmh ON o.org_level_3 = cmh.org_level_3
GROUP BY o.org_level_3, ch.car_holiday_salesmen, cmh.commercial_holiday_salesmen, o.total_salesmen
ORDER BY 车险保费 DESC
```

#### 2.2 业务员明细SQL
**文件**: `src/features/marketing-report/sql/salesmanDetail.ts`

**核心逻辑**：
```sql
WITH
-- 筛选日期范围内的节假日
holiday_dates AS (
  SELECT DISTINCT date_str
  FROM (VALUES -- 节假日列表)
  WHERE date_str BETWEEN ${startDate} AND ${endDate}
),

-- 业务员团队映射（从保费计划数据加载）
salesman_teams AS (
  SELECT salesman_name, org_level_3, team_name
  FROM salesman_premium_plan  -- 需要加载的表
  WHERE year = '2026'
),

-- 业务员节假日车险签单统计
salesman_car_holiday AS (
  SELECT
    p.salesman_name,
    COUNT(DISTINCT CAST(p.${dateField} AS DATE)) as holiday_car_days
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.date_str
  WHERE p.is_commercial = false
    AND ${whereClause}
  GROUP BY p.salesman_name
),

-- 业务员节假日商业险签单统计
salesman_commercial_holiday AS (
  SELECT
    p.salesman_name,
    COUNT(DISTINCT CAST(p.${dateField} AS DATE)) as holiday_commercial_days
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.date_str
  WHERE p.is_commercial = true
    AND ${whereClause}
  GROUP BY p.salesman_name
)

SELECT
  st.salesman_name as 业务员,
  st.org_level_3 as 三级机构,
  st.team_name as 团队,
  COALESCE(sch.holiday_car_days, 0) as 假日车险签单天数,
  (SELECT COUNT(*) FROM holiday_dates) as 假日天数,
  COALESCE(sch.holiday_car_days, 0) * 1.0 / NULLIF((SELECT COUNT(*) FROM holiday_dates), 0) as 假日车险签单比例,
  COALESCE(scm.holiday_commercial_days, 0) as 假日商业险签单天数,
  COALESCE(scm.holiday_commercial_days, 0) * 1.0 / NULLIF((SELECT COUNT(*) FROM holiday_dates), 0) as 假日商业险签单比例
FROM salesman_teams st
LEFT JOIN salesman_car_holiday sch ON st.salesman_name = sch.salesman_name
LEFT JOIN salesman_commercial_holiday scm ON st.salesman_name = scm.salesman_name
ORDER BY 假日车险签单天数 DESC
```

### 阶段三：数据加载逻辑（优先级：HIGH）

#### 3.1 创建自定义Hook
**文件**: `src/features/marketing-report/hooks/useMarketingReport.ts`

**功能**：
- 加载保费计划数据（获取团队信息）
- 计算筛选日期范围内的节假日
- 执行机构战报查询
- 执行业务员明细查询
- 返回数据和加载状态

**关键点**：
- 使用全局 FilterContext 获取筛选条件
- 使用 duckdbClient 执行查询
- 处理 Arrow IPC 数据转换

### 阶段四：UI组件实现（优先级：MEDIUM）

#### 4.1 机构战报表格
**文件**: `src/features/marketing-report/components/OrganizationReportTable.tsx`

**特性**：
- 使用 VirtualTable 组件（复用）
- 支持点击表头排序
- 格式化保费显示（千分位）
- 格式化开单率（百分比）
- 固定表头

**列定义**：
```typescript
const columns = [
  { key: 'org_level_3', header: '三级机构', width: 200 },
  { key: '车险保费', header: '车险保费', width: 150, format: formatCurrency },
  { key: '商业险保费', header: '商业险保费', width: 150, format: formatCurrency },
  { key: '车险开单率', header: '车险开单率', width: 150, format: formatPercent },
  { key: '商业险开单率', header: '商业险开单率', width: 150, format: formatPercent },
];
```

#### 4.2 业务员明细表格
**文件**: `src/features/marketing-report/components/SalesmanDetailTable.tsx`

**特性**：
- 使用 VirtualTable 组件（复用）
- 支持点击表头排序
- 格式化比例（百分比，保留2位小数）
- 高亮显示高比例业务员（可选）

#### 4.3 主面板组件
**文件**: `src/features/marketing-report/components/MarketingReportPanel.tsx`

**布局**：
```
┌─────────────────────────────────────────┐
│  筛选面板（复用全局筛选器）              │
├─────────────────────────────────────────┤
│  📊 假日营销战报                        │
├─────────────────────────────────────────┤
│  表一：机构战报                         │
│  ┌───────────────────────────────────┐  │
│  │  VirtualTable                     │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  表二：业务员明细表                     │
│  ┌───────────────────────────────────┐  │
│  │  VirtualTable                     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**内容**：
- 显示筛选日期范围内的节假日列表
- 显示节假日总天数
- 两个表格上下排列

### 阶段五：路由和导航集成（优先级：MEDIUM）

#### 5.1 创建页面组件
**文件**: `src/features/pages/MarketingReportPage.tsx`

**内容**：
```typescript
<DataGuard>
  <PageLayout>
    <FilterPanel />
    <MarketingReportPanel />
    <QueryAssistant />
  </PageLayout>
</DataGuard>
```

#### 5.2 更新路由配置
**文件**: `src/app/App.tsx`

**修改**：
1. 添加懒加载导入
2. 在 dashboard 和 truck 之间插入新路由
```typescript
<Route path="marketing-report" element={...} />
```

#### 5.3 更新导航菜单
**文件**: `src/components/layout/SidebarNavigation.tsx`

**修改**：在 dataNavItems 数组中，在 dashboard 和 truck 之间插入
```typescript
{ path: '/marketing-report', icon: '📊', label: '营销战报', shortLabel: '营销战报' }
```

#### 5.4 更新导出文件
**文件**: `src/features/pages/index.ts`

**修改**：添加新页面导出

#### 5.5 更新索引文档
**文件**: `src/features/INDEX.md`

**修改**：添加营销战报模块信息

### 阶段六：数据源集成（优先级：HIGH）

#### 6.1 加载保费计划数据
**文件**: `src/shared/duckdb/client.ts` 或新建加载逻辑

**功能**：
- 加载 `数据管理/业务员保费计划标准化数据.parquet`
- 创建 salesman_premium_plan 视图
- 提取字段：salesman_name, org_level_3, team_name

**字段映射**（需要查看实际数据结构调整）：
- 业务员姓名 → salesman_name
- 三级机构 → org_level_3
- 团队 → team_name

### 阶段七：测试和验证（优先级：MEDIUM）

#### 7.1 单元测试
**测试文件**：
- `src/features/marketing-report/sql/__tests__/orgReport.test.ts`
- `src/features/marketing-report/sql/__tests__/salesmanDetail.test.ts`

**测试内容**：
- SQL 生成语法正确
- 参数化查询工作正常
- 节假日计算正确

#### 7.2 浏览器实测
**验证步骤**：
1. 选择筛选条件（签单口径、日期范围）
2. 验证节假日列表正确显示
3. 验证表一数据：
   - 车险保费、商业险保费计算正确
   - 开单率计算正确（节假日有出单的业务员数 / 总业务员数）
4. 验证表二数据：
   - 假日天数正确
   - 签单天数正确
   - 签单比例计算正确
5. 验证排序功能：
   - 点击表头能正确排序
   - 再次点击能切换升序/降序

## 📦 需要修改的关键文件

### 新建文件
1. `src/features/marketing-report/` - 完整目录结构
2. `src/features/pages/MarketingReportPage.tsx`

### 修改文件
1. `src/app/App.tsx` - 添加路由
2. `src/components/layout/SidebarNavigation.tsx` - 添加导航项
3. `src/features/pages/index.ts` - 添加导出
4. `src/features/INDEX.md` - 添加文档

### 可能需要修改
1. `src/shared/duckdb/client.ts` - 加载保费计划数据
2. `src/shared/normalize/mapping.ts` - 如果需要添加新字段映射

## ✅ 验证清单

### 功能验证
- [ ] 节假日数据正确加载
- [ ] 保费计划数据正确加载
- [ ] 筛选条件正确应用到查询
- [ ] 表一（机构战报）数据正确显示
- [ ] 表二（业务员明细）数据正确显示
- [ ] 排序功能正常工作
- [ ] 保费格式化显示（千分位）
- [ ] 比例格式化显示（百分比）
- [ ] 加载状态正确显示

### 边界情况
- [ ] 筛选期间无节假日时显示空状态
- [ ] 节假日无签单数据时显示0
- [ ] 业务员数为0时开单率显示为N/A或0
- [ ] 大数据量时表格性能良好

### 用户体验
- [ ] 筛选条件变更时数据自动刷新
- [ ] 表格排序响应迅速
- [ ] 移动端适配正常
- [ ] 错误提示友好清晰

## 🎯 实施优先级

**Phase 1（核心数据）**：
1. 创建节假日数据
2. 创建节假日工具函数
3. 加载保费计划数据
4. 实现SQL查询逻辑

**Phase 2（核心功能）**：
5. 实现数据加载Hook
6. 实现机构战报表格
7. 实现业务员明细表格
8. 实现主面板组件

**Phase 3（集成）**：
9. 创建页面组件
10. 更新路由配置
11. 更新导航菜单
12. 更新文档

**Phase 4（验证）**：
13. 单元测试
14. 浏览器实测
15. 边界情况测试

## 🔍 技术要点

### 开单率计算逻辑
- **表一（机构战报）**：
  - 分子：节假日内该机构有出单记录的业务员数（DISTINCT）
  - 分母：该机构的总业务员数（DISTINCT）
  - 公式：`COUNT(DISTINCT salesman_name in holiday) / COUNT(DISTINCT salesman_name)`

- **表二（业务员明细）**：
  - 分子：该业务员在节假日的签单天数（DISTINCT date）
  - 分母：节假日总天数
  - 公式：`COUNT(DISTINCT date in holiday) / COUNT(holiday_dates)`

### 险别判断逻辑
- **车险**：交强险 OR （交强险 + 商业险）
- **商业险**：商业保险
- 数据字段：`insurance_type` 或 `is_commercial`

### 团队数据集成
- 从保费计划文件加载团队映射关系
- 字段：salesman_name → org_level_3 + team_name
- 需要在 DuckDB 中创建视图或临时表

### 性能优化
- 使用 DuckDB 的 CTE (WITH clause) 优化查询
- 使用 DISTINCT 避免重复计数
- 考虑添加索引（如果数据量大）

## 📝 后续扩展

- [ ] 支持自定义节假日范围
- [ ] 支持同比/环比分析
- [ ] 导出Excel功能
- [ ] 节假日趋势图表
- [ ] 业务员绩效排名
