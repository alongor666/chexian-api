---
name: cost-analysis
description: 成本分析深度审计（赔付率/费用率/综合费用率/变动成本率）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [cost, profitability, claims, expense]
scope: project
requires:
  - DuckDB
  - 数据管理/业务员保费计划标准化数据.parquet
dependencies:
  - server/src/sql/cost.ts
  - src/features/cost/
  - src/features/dashboard/PremiumDashboard.tsx
last_updated: "2026-01-16"
---

# /cost-analysis

成本分析深度审计命令，涵盖赔付率、费用率、综合费用率、变动成本率四大核心指标。

## 使用方法

```bash
# 完整成本分析（推荐）
/cost-analysis

# 仅分析赔付率
/cost-analysis --claim-ratio

# 仅分析费用率
/cost-analysis --expense-ratio

# 指定分析维度
/cost-analysis --dimension 机构
/cost-analysis --dimension 客户类别
/cost-analysis --dimension 险别组合

# 指定截止日期
/cost-analysis --cutoff-date "2026-01-15"
```

## 分析维度

### 1. 赔付率分析 (Claim Ratio)

**定义**: 已报告赔款 / 满期保费

**关键指标**:
- 满期赔付率 = 已报告赔款 / 满期保费
- 满期出险率 = 年化出险频率
- 案均赔款 = 已报告赔款 / 赔案件数

**SQL 查询**:
```sql
SELECT
  dimension,
  SUM(premium * MIN(DATE_DIFF('day', start_date, :cutoff_date), 365) / 365) as earned_premium,
  SUM(reported_claim_amount) as total_claims,
  SUM(reported_claim_amount) / SUM(premium * ...) as claim_ratio
FROM PolicyFact
GROUP BY dimension
```

### 2. 费用率分析 (Expense Ratio)

**定义**: 费用金额 / 保费

**关键指标**:
- 费用率 = 费用金额 / 保费
- 综合费用率 = (已报告赔款 + 费用金额) / 满期保费
- 变动成本率 = 已报告赔款 / 满期保费 + 费用金额 / 保费

**SQL 查询**:
```sql
SELECT
  dimension,
  SUM(expense_amount) as total_expense,
  SUM(expense_amount) / SUM(premium) as expense_ratio
FROM PolicyFact
GROUP BY dimension
```

### 3. 综合费用率分析 (Comprehensive Cost)

**定义**: (已报告赔款 + 费用金额) / 满期保费

**关键指标**:
- 综合费用率 = (已报告赔款 + 费用金额) / 满期保费
- 承保利润率 = 1 - 综合费用率
- 盈亏平衡点 = 综合费用率 = 100%

**分析维度**:
- 按机构对比
- 按客户类别对比
- 按险别组合对比
- 时间趋势分析

### 4. 变动成本率分析 (Variable Cost)

**定义**: 满期赔付率 + 费用率

**关键指标**:
- 变动成本率 = 满期赔付率 + 费用率
- 边际贡献率 = 1 - 变动成本率
- 盈利能力评级

## 分析流程

### 第 1 步：数据准备（30 秒）

```bash
# 检查必需数据文件
ls -lh 数据管理/业务员保费计划标准化数据.parquet

# 检查数据完整性
bun run scripts/check-cost-data.mjs
```

### 第 2 步：生成成本分析 SQL（1 分钟）

```typescript
// 生成赔付率查询
const claimRatioQuery = generateClaimRatioQuery({
  dimension: 'org_name',
  cutoffDate: '2026-01-15'
})

// 生成费用率查询
const expenseRatioQuery = generateExpenseRatioQuery({
  dimension: 'customer_category',
  cutoffDate: '2026-01-15'
})
```

### 第 3 步：执行查询与分析（1-2 分钟）

```sql
-- 示例：分机构赔付率分析
SELECT
  org_name as 机构,
  SUM(premium * MIN(DATE_DIFF('day', start_date, '2026-01-15'), 365) / 365) as 满期保费,
  SUM(reported_claim_amount) as 已报告赔款,
  SUM(reported_claim_amount) / SUM(premium * ...) as 满期赔付率,
  COUNT(*) FILTER (WHERE reported_claim_amount > 0) as 赔案件数,
  SUM(reported_claim_amount) / COUNT(*) FILTER (WHERE reported_claim_amount > 0) as 案均赔款
FROM PolicyFact
WHERE start_date <= '2026-01-15'
GROUP BY org_name
ORDER BY 满期保费 DESC
```

### 第 4 步：生成分析报告（1 分钟）

```markdown
## 成本分析报告

### 赔付率分析
- 整体满期赔付率: 65.2%
- 最高赔付率机构: XX机构 (78.5%)
- 最低赔付率机构: YY机构 (52.3%)
- 案均赔款: 8,500 元

**洞察**:
1. 赔付率 > 70% 的机构占 30%，需重点关注
2. 商业险赔付率 (68%) 高于交强险 (62%)
3. 续保业务赔付率 (58%) 低于新业务 (72%)

### 费用率分析
- 整体费用率: 15.8%
- 最高费用率机构: XX机构 (22.3%)
- 最低费用率机构: YY机构 (11.2%)

**洞察**:
1. 费用率与机构规模呈负相关
2. 小型机构费用率普遍 > 20%
3. 建议优化小型机构费用结构

### 综合费用率分析
- 整体综合费用率: 81.0%
- 盈利机构: 15 家 (占比 65%)
- 亏损机构: 8 家 (占比 35%)

**洞察**:
1. 综合费用率 < 100% 的机构可继续承保
2. 综合费用率 > 100% 的机构需限制业务
3. 建议调整亏损机构承保政策

### 变动成本率分析
- 整体变动成本率: 81.0%
- 边际贡献率: 19.0%
- 盈利能力评级: B (良好)

**建议**:
1. 优化高赔付率机构业务结构
2. 降低小型机构费用率
3. 加强续保业务拓展
```

## 可视化建议

```typescript
// 1. 赔付率对比（柱状图）
<BarChart
  data={claimRatioData}
  xKey="org_name"
  yKey="claim_ratio"
  threshold={0.7}  // 警戒线
/>

// 2. 费用率趋势（折线图）
<LineChart
  data={expenseTrendData}
  xKey="month"
  yKey="expense_ratio"
/>

// 3. 综合费用率散点图
<ScatterChart
  data={comprehensiveData}
  xKey="claim_ratio"
  yKey="expense_ratio"
  sizeKey="premium"
/>

// 4. 盈亏分析（瀑布图）
<WaterfallChart
  data={profitabilityData}
  items={["保费", "赔款", "费用", "利润"]}
/>
```

## 优化建议

```sql
-- 1. 识别高风险机构
SELECT org_name, claim_ratio
FROM claim_ratio_analysis
WHERE claim_ratio > 0.7
ORDER BY claim_ratio DESC

-- 2. 识别高费用机构
SELECT org_name, expense_ratio
FROM expense_ratio_analysis
WHERE expense_ratio > 0.2
ORDER BY expense_ratio DESC

-- 3. 计算盈利能力
SELECT
  org_name,
  1 - (claim_ratio + expense_ratio) as profit_margin
FROM comprehensive_cost_analysis
ORDER BY profit_margin ASC
```

## 相关文件

- `server/src/sql/cost.ts` - 成本分析 SQL 生成器
- `src/features/cost/` - 成本分析面板组件
- `开发文档/业务员计划数据集成说明.md` - 数据集成文档

## 常见问题

**Q: 赔付率和费用率的区别是什么？**
A: 赔付率 = 赔款 / 保费，费用率 = 费用 / 保费。综合费用率 = 赔付率 + 费用率。

**Q: 如何判断机构盈利能力？**
A: 综合费用率 < 100% 表示盈利，> 100% 表示亏损。

**Q: 满期保费如何计算？**
A: 满期保费 = 保费 × MIN(统计截止日 - 起保日, 365) / 365。

**Q: 如何降低赔付率？**
A: 优化业务结构、提高核保标准、加强风险管控。

---

**维护者**: @claude
**版本**: 1.0.0
**最后更新**: 2026-01-16
