# 成本分析模块实现计划

## 需求概述

在增长率分析之后增加"成本分析"板块：
- 四个子板块（标签页切换）：变动成本率、赔付率、费用率、综合费用率
- **首期开发**：赔付率板块表格

### 赔付率表格需求
- 第1列：维度（默认客户类别，可切换：三级机构、险别组合，预留2个扩展维度）
- 指标列：保单件数、保费合计、赔案件数、已报告赔款、案均赔款、满期保费、满期天数、满期赔付率、满期出险率

### 关键公式
- 案均赔款 = 已报告赔款 / 赔案件数
- 满期保费 = SUM(保费 / 365 * 满期天数)
- 满期天数 = MIN(统计截止日 - 保险起期, 365)
- 满期赔付率 = 已报告赔款 / 满期保费
- 满期出险率 = (赔案件数/保单件数) / (满期天数/365) → 年化后 = 赔案件数 * 365 / 满期天数合计

---

## 文件结构

```
src/
├── features/cost/                       # 新建目录
│   ├── components/
│   │   ├── CostAnalysisPanel.tsx       # 主面板（Tab容器）
│   │   ├── CostAnalysisControlPanel.tsx # 控制面板（维度切换）
│   │   └── ClaimRatioTable.tsx         # 赔付率表格
│   ├── hooks/
│   │   └── useCostAnalysis.ts          # 数据Hook
│   └── types/
│       └── costTypes.ts                 # 类型定义
├── shared/sql/
│   └── cost.ts                          # 成本分析SQL生成器
└── features/dashboard/
    └── PremiumDashboard.tsx             # 修改：添加cost Tab入口
```

---

## 实现步骤（Phase 1）

### Step 1: 创建SQL生成器
**文件**: `src/shared/sql/cost.ts`

核心函数：
```typescript
export function generateClaimRatioQuery(config: {
  dimension: 'customer_category' | 'org_level_3' | 'coverage_combination';
  cutoffDate: string;
  whereClause?: string;
}): string;
```

### Step 2: 创建类型定义
**文件**: `src/features/cost/types/costTypes.ts`

```typescript
export interface ClaimRatioData {
  dim_key: string;
  policy_count: number;
  total_premium: number;
  total_claim_cases: number;
  total_reported_claims: number;
  avg_claim_amount: number | null;
  earned_premium: number;
  avg_exposure_days: number;
  earned_claim_ratio: number | null;
  earned_loss_frequency: number | null;
}
```

### Step 3: 创建数据Hook
**文件**: `src/features/cost/hooks/useCostAnalysis.ts`

参考 `useGrowthAnalysis.ts` 模式。

### Step 4: 创建控制面板组件
**文件**: `src/features/cost/components/CostAnalysisControlPanel.tsx`

包含：
- 子Tab切换（变动成本率/赔付率/费用率/综合费用率）
- 维度选择器（客户类别/三级机构/险别组合）
- 截止日期选择器

### Step 5: 创建赔付率表格
**文件**: `src/features/cost/components/ClaimRatioTable.tsx`

使用 `VirtualTable` 组件，列配置：
| 列 | 字段 | 宽度 |
|---|---|---|
| 维度 | dim_key | 150 |
| 保单件数 | policy_count | 100 |
| 保费合计 | total_premium | 120 |
| 赔案件数 | total_claim_cases | 100 |
| 已报告赔款 | total_reported_claims | 120 |
| 案均赔款 | avg_claim_amount | 100 |
| 满期保费 | earned_premium | 120 |
| 平均满期天数 | avg_exposure_days | 110 |
| 满期赔付率 | earned_claim_ratio | 110 |
| 满期出险率 | earned_loss_frequency | 110 |

### Step 6: 创建主面板
**文件**: `src/features/cost/components/CostAnalysisPanel.tsx`

组合控制面板 + 表格，处理子Tab切换逻辑。

### Step 7: 集成到仪表盘
**文件**: `src/features/dashboard/PremiumDashboard.tsx`

修改：
1. `activeTab` 类型添加 `'cost'`
2. 添加"成本分析"Tab按钮
3. 条件渲染 `<CostAnalysisPanel />`

### Step 8: 测试验证
1. `bun test` - 单元测试
2. 浏览器实测 - Chrome Console 验证SQL执行
3. 数据准确性检验

---

## 关键技术决策

1. **满期天数计算**：`LEAST(DATE_DIFF('day', start_date, cutoff_date), 365)`
2. **满期出险率年化**：`(赔案件数 * 365) / 满期天数合计`（性能优化）
3. **维度扩展**：配置驱动，通过 Map 支持单字段/多字段分组
4. **空值处理**：SQL中使用 `COALESCE` 处理 NULL

---

## 验证方法

1. **单元测试**：验证SQL生成逻辑
2. **浏览器实测**：打开Chrome Console，验证查询结果
3. **数据对账**：与Excel手算结果对比验证公式准确性

---

## 预留扩展

- 维度扩展：机构+客户类别、机构+险别组合
- Phase 2：费用率、综合费用率、变动成本率表格
- Phase 3：趋势图表、同比/环比对比、导出功能
