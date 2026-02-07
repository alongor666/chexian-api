---
name: data-analysis
description: 车险数据多维度深度分析（KPI、趋势、续保、成本、系数、视角）
category: data-analysis
version: 2.1.0
author: "@claude"
tags: [insurance, analysis, kpi, trends, duckdb, parquet, cost, coefficient]
scope: project
requires:
  - DuckDB-WASM
  - bun
dependencies:
  - src/shared/duckdb/client.ts (PolicyFact视图)
  - src/shared/sql/*.ts
data_requirements:
  - 车险清单.parquet (607K+ 保单记录)
  - 业务员保费计划标准化数据.parquet (成本分析)
  - 必需字段: 保单号, 保费, 业务员, 签单日期, 三级机构
last_updated: "2026-01-16"
---

# 车险数据多维度深度分析

对车险业务数据执行全方位深度分析，生成业务洞察和决策支持报告。

**v2.1.0 新增**: 成本分析、商车系数监控、视角切换分析

---

## 🚀 快速使用子命令

**推荐**: 使用拆分后的子命令以获得更快的执行速度和更清晰的输出。

| 子命令 | 功能 | 使用场景 |
|--------|------|----------|
| `/data-profile` | 数据概览与质量检查 | 首次分析数据时 |
| `/data-kpi` | 业绩分析与排名 | 查看业务员/机构业绩 |
| `/data-trends` | 时间趋势分析 | 分析环比增长和异常 |
| `/data-export` | 数据导出 | 导出分析结果 |

**完整分析**: 使用本命令执行所有12个分析维度。

---

## 输入参数

```bash
/data-analysis [选项]
```

**示例**：
```bash
# 基础全量分析（推荐）
/data-analysis

# 指定分析维度
/data-analysis --dimensions 机构,险类,续保状态

# 指定时间范围（基于签单日期）
/data-analysis --start 2025-10-01 --end 2025-12-31

# 专项分析
/data-analysis --focus renewal      # 续保专项
/data-analysis --focus batch-type   # 批改类型专项
/data-analysis --focus vehicle      # 车型专项

# 成本分析（v2.1.0 新增）
/data-analysis --focus cost-claim           # 赔付率分析
/data-analysis --focus cost-expense         # 费用率分析
/data-analysis --focus cost-comprehensive   # 综合费用率分析
/data-analysis --focus cost-variable        # 变动成本率分析

# 商车系数监控（v2.1.0 新增）
/data-analysis --focus coefficient          # 商车自主定价系数分析

# 视角切换（v2.1.0 新增）
/data-analysis --perspective premium        # 保费口径分析
/data-analysis --perspective policy_count   # 件数口径分析

# 组合使用
/data-analysis --focus cost-claim --dimension 机构 --start 2025-10-01
```

---

## 数据源信息

**基于实际数据特征**（车险清单截至20260108.parquet）：
- **记录数**: 607,455 条保单（已去重）
- **业务员**: 322 人
- **机构数**: 14 个三级机构
- **字段数**: 23 个业务字段
- **时间跨度**: 2023-11-27 至 2026-01-08（签单日期）
- **总保费**: 4.99 亿元
- **文件大小**: 9.0 MB

**完整字段清单**：
```
核心业务字段：
1. 保单号           9. 是否续保         17. 厂牌车型
2. 业务员          10. 是否可续 [新增]  18. 吨位分段
3. 三级机构        11. 是否新车         19. 新车购置价
4. 签单日期        12. 是否新能源       20. 批单号
5. 保险起期        13. 是否过户车       21. 批改类型
6. 险类            14. 是否电销         22. 商车自主定价系数
7. 险别组合        15. 终端来源         23. 是否交商统保
8. 保费            16. 客户类别
```

---

## 分析流程

### 1. 数据概览（Data Profiling）

**基础统计**：

```sql
-- 数据全景
SELECT
    COUNT(*) as total_records,
    COUNT(DISTINCT 保单号) as unique_policies,
    COUNT(DISTINCT 业务员) as total_agents,
    COUNT(DISTINCT 三级机构) as total_departments,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    STDDEV(保费) as stddev_premium,
    MIN(签单日期) as start_date,
    MAX(签单日期) as end_date
FROM PolicyFact;

-- 字段完整性
SELECT
    COUNT(*) as total_rows,
    SUM(CASE WHEN 保单号 IS NULL THEN 1 ELSE 0 END) as missing_policy_no,
    SUM(CASE WHEN 保费 IS NULL THEN 1 ELSE 0 END) as missing_premium,
    SUM(CASE WHEN 业务员 IS NULL OR 业务员 = '' THEN 1 ELSE 0 END) as missing_agent,
    SUM(CASE WHEN 三级机构 IS NULL OR 三级机构 = '' THEN 1 ELSE 0 END) as missing_dept,
    SUM(CASE WHEN 签单日期 IS NULL THEN 1 ELSE 0 END) as missing_date,
    SUM(CASE WHEN 是否续保 IS NULL OR 是否续保 = '' THEN 1 ELSE 0 END) as missing_renewal,
    SUM(CASE WHEN 是否可续 IS NULL OR 是否可续 = '' THEN 1 ELSE 0 END) as missing_renewable
FROM PolicyFact;

-- 保费分布（百分位数）
SELECT
    MIN(保费) as min_premium,
    percentile_cont(0.05) WITHIN GROUP (ORDER BY 保费) as p05,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY 保费) as p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY 保费) as median,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY 保费) as p75,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY 保费) as p95,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY 保费) as p99,
    MAX(保费) as max_premium
FROM PolicyFact;
```

**输出**：
- 数据集规模：保单数、业务员数、机构数
- 字段完整性矩阵（缺失值统计）
- 保费分布摘要（含异常值标记）
- 时间跨度分析

---

### 2. 业绩排名与分布分析

**业务员排名（多维度）**：

```sql
-- Top 30 业务员（按保费）
SELECT
    业务员,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    STDDEV(保费) as stddev_premium,
    -- 续保指标
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    -- 可续保指标
    SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) as renewable_count,
    ROUND(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewable_rate,
    -- 新能源占比
    SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) as nev_count,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate,
    -- 新车占比
    SUM(CASE WHEN 是否新车 = '是' THEN 1 ELSE 0 END) as new_car_count,
    ROUND(SUM(CASE WHEN 是否新车 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as new_car_rate
FROM PolicyFact
GROUP BY 业务员
ORDER BY total_premium DESC
LIMIT 30;

-- 业务员保费区间分布
WITH agent_premium AS (
    SELECT 业务员, SUM(保费) as total_premium
    FROM PolicyFact
    GROUP BY 业务员
)
SELECT
    CASE
        WHEN total_premium < 500000 THEN '< 50万'
        WHEN total_premium < 1000000 THEN '50-100万'
        WHEN total_premium < 2000000 THEN '100-200万'
        WHEN total_premium < 5000000 THEN '200-500万'
        ELSE '>= 500万'
    END as premium_range,
    COUNT(*) as agent_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM agent_premium
GROUP BY
    CASE
        WHEN total_premium < 500000 THEN '< 50万'
        WHEN total_premium < 1000000 THEN '50-100万'
        WHEN total_premium < 2000000 THEN '100-200万'
        WHEN total_premium < 5000000 THEN '200-500万'
        ELSE '>= 500万'
    END
ORDER BY premium_range;
```

**机构业绩对比**：

```sql
-- 各机构全维度对比
SELECT
    三级机构,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT 业务员) as agent_count,
    ROUND(SUM(保费) / COUNT(DISTINCT 业务员), 2) as premium_per_agent,
    -- 续保指标
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    -- 新能源占比
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate,
    -- 电销占比
    ROUND(SUM(CASE WHEN 是否电销 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as telemarketing_rate,
    -- 批改业务占比
    ROUND(SUM(CASE WHEN 批改类型 IS NOT NULL AND 批改类型 != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as batch_rate
FROM PolicyFact
GROUP BY 三级机构
ORDER BY total_premium DESC;
```

**分析维度**：
- Top 30 业务员多维度排名
- 业务员保费分布区间统计
- 各机构业绩对比矩阵
- 人均产能分析

---

### 3. 时间趋势分析

**月度趋势与环比**：

```sql
-- 月度业绩趋势
SELECT
    strftime(CAST(签单日期 AS DATE), '%Y-%m') as month,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT 业务员) as active_agents,
    -- 续保相关
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    SUM(CASE WHEN 是否续保 = '是' THEN 保费 ELSE 0 END) as renewal_premium,
    -- 新能源
    SUM(CASE WHEN 是否新能源 = '是' THEN 保费 ELSE 0 END) as nev_premium
FROM PolicyFact
GROUP BY month
ORDER BY month;

-- 环比增长率（保费、件数）
WITH monthly_data AS (
    SELECT
        strftime(CAST(签单日期 AS DATE), '%Y-%m') as month,
        COUNT(*) as policy_count,
        SUM(保费) as total_premium
    FROM PolicyFact
    GROUP BY month
)
SELECT
    month,
    policy_count,
    total_premium,
    LAG(policy_count) OVER (ORDER BY month) as prev_month_count,
    LAG(total_premium) OVER (ORDER BY month) as prev_month_premium,
    ROUND((policy_count - LAG(policy_count) OVER (ORDER BY month)) * 100.0 /
        NULLIF(LAG(policy_count) OVER (ORDER BY month), 0), 2) as count_growth_rate,
    ROUND((total_premium - LAG(total_premium) OVER (ORDER BY month)) * 100.0 /
        NULLIF(LAG(total_premium) OVER (ORDER BY month), 0), 2) as premium_growth_rate
FROM monthly_data
ORDER BY month;

-- 周度趋势（自然周）
SELECT
    date_trunc('week', CAST(签单日期 AS DATE)) as week_start,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium
FROM PolicyFact
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 12;
```

**异常检测**：
- 环比增长率 > 100% 或 < -50% 标记为异常
- 单日保费超过 P99 百分位标记为高峰
- 连续3日保费为0标记为异常

---

### 4. 四象限分析（业务员分层）

```sql
-- 业务员四象限分类（保费规模 × 保单数量）
WITH agent_metrics AS (
    SELECT
        业务员,
        SUM(保费) as total_premium,
        COUNT(*) as policy_count,
        AVG(保费) as avg_premium
    FROM PolicyFact
    GROUP BY 业务员
),
thresholds AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_premium) as median_premium,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY policy_count) as median_count
    FROM agent_metrics
)
SELECT
    业务员,
    total_premium,
    policy_count,
    avg_premium,
    CASE
        WHEN total_premium >= median_premium AND policy_count >= median_count
            THEN 'Q1-明星业务员（高保费高保单）'
        WHEN total_premium >= median_premium AND policy_count < median_count
            THEN 'Q2-大单专家（高保费低保单）'
        WHEN total_premium < median_premium AND policy_count < median_count
            THEN 'Q3-新手待培养（低保费低保单）'
        ELSE 'Q4-效率待提升（低保费高保单）'
    END as quadrant,
    ROUND(total_premium / (SELECT SUM(total_premium) FROM agent_metrics) * 100, 2) as premium_share
FROM agent_metrics
CROSS JOIN thresholds
ORDER BY total_premium DESC;

-- 各象限统计
WITH agent_metrics AS (
    SELECT 业务员, SUM(保费) as total_premium, COUNT(*) as policy_count
    FROM PolicyFact GROUP BY 业务员
),
thresholds AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_premium) as median_premium,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY policy_count) as median_count
    FROM agent_metrics
)
SELECT
    CASE
        WHEN total_premium >= median_premium AND policy_count >= median_count THEN 'Q1-明星业务员'
        WHEN total_premium >= median_premium AND policy_count < median_count THEN 'Q2-大单专家'
        WHEN total_premium < median_premium AND policy_count < median_count THEN 'Q3-新手待培养'
        ELSE 'Q4-效率待提升'
    END as quadrant,
    COUNT(*) as agent_count,
    ROUND(SUM(total_premium), 2) as total_premium,
    ROUND(AVG(policy_count), 2) as avg_policy_count,
    ROUND(SUM(total_premium) * 100.0 / SUM(SUM(total_premium)) OVER (), 2) as premium_contribution
FROM agent_metrics
CROSS JOIN thresholds
GROUP BY quadrant
ORDER BY total_premium DESC;
```

**象限定义**：
- Q1 明星业务员：高保费高保单（核心骨干，占比约 25%）
- Q2 大单专家：高保费低保单（大客户经理，占比约 25%）
- Q3 新手待培养：低保费低保单（需要培训，占比约 25%）
- Q4 效率待提升：低保费高保单（需优化件均，占比约 25%）

---

### 5. 续保与可续保深度分析

```sql
-- 续保状态 × 可续保状态交叉分析
SELECT
    是否续保,
    是否可续,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM PolicyFact
GROUP BY 是否续保, 是否可续
ORDER BY 是否续保 DESC, 是否可续 DESC;

-- 各机构续保率与可续保率对比
SELECT
    三级机构,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) as renewable_count,
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    ROUND(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewable_rate,
    -- 续保潜力（可续但未续保的比例）
    ROUND(SUM(CASE WHEN 是否可续 = '是' AND 是否续保 != '是' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END), 0), 2) as renewal_potential
FROM PolicyFact
GROUP BY 三级机构
ORDER BY renewal_rate DESC;

-- 不可续保原因分析（关联批改类型）
SELECT
    批改类型,
    COUNT(*) as count,
    SUM(保费) as total_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM PolicyFact
WHERE 是否可续 != '是'
GROUP BY 批改类型
ORDER BY count DESC;

-- 续保保费贡献分析
SELECT
    是否续保,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as premium_contribution
FROM PolicyFact
GROUP BY 是否续保
ORDER BY total_premium DESC;
```

---

### 6. 批改类型专项分析

```sql
-- 批改类型分布与影响
SELECT
    COALESCE(NULLIF(批改类型, ''), '正常签单') as batch_type,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as policy_percentage,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as premium_percentage,
    -- 批改对可续保的影响
    SUM(CASE WHEN 是否可续 != '是' THEN 1 ELSE 0 END) as not_renewable_count,
    ROUND(SUM(CASE WHEN 是否可续 != '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as not_renewable_rate
FROM PolicyFact
GROUP BY batch_type
ORDER BY policy_count DESC;

-- 退保专项分析
SELECT
    三级机构,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 批改类型 LIKE '%退保%' THEN 1 ELSE 0 END) as refund_count,
    SUM(CASE WHEN 批改类型 LIKE '%退保%' THEN 保费 ELSE 0 END) as refund_premium,
    ROUND(SUM(CASE WHEN 批改类型 LIKE '%退保%' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as refund_rate
FROM PolicyFact
GROUP BY 三级机构
ORDER BY refund_count DESC;

-- 过户业务分析
SELECT
    三级机构,
    SUM(CASE WHEN 是否过户车 = '是' THEN 1 ELSE 0 END) as transfer_count,
    SUM(CASE WHEN 批改类型 LIKE '%过户%' THEN 1 ELSE 0 END) as transfer_batch_count,
    ROUND(SUM(CASE WHEN 是否过户车 = '是' THEN 保费 ELSE 0 END), 2) as transfer_premium
FROM PolicyFact
GROUP BY 三级机构
ORDER BY transfer_count DESC;
```

---

### 7. 险类与险别组合分析

```sql
-- 险类分布
SELECT
    险类,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as policy_percentage,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as premium_percentage
FROM PolicyFact
GROUP BY 险类
ORDER BY total_premium DESC;

-- 险别组合分布（预期：单交 54.33%, 交三 23%, 主全 22.67%）
SELECT
    险别组合,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as policy_percentage,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as premium_percentage
FROM PolicyFact
GROUP BY 险别组合
ORDER BY policy_count DESC;

-- 险类 × 机构交叉分析
SELECT
    三级机构,
    险类,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY 三级机构), 2) as dept_percentage
FROM PolicyFact
GROUP BY 三级机构, 险类
ORDER BY 三级机构, total_premium DESC;
```

---

### 8. 新能源与新车分析

```sql
-- 新能源车险分析
SELECT
    是否新能源,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as policy_percentage,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as premium_percentage
FROM PolicyFact
GROUP BY 是否新能源
ORDER BY total_premium DESC;

-- 各机构新能源渗透率
SELECT
    三级机构,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) as nev_count,
    SUM(CASE WHEN 是否新能源 = '是' THEN 保费 ELSE 0 END) as nev_premium,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 保费 ELSE 0 END) * 100.0 / SUM(保费), 2) as nev_premium_rate
FROM PolicyFact
GROUP BY 三级机构
ORDER BY nev_rate DESC;

-- Top 20 业务员新能源业务占比
SELECT
    业务员,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) as nev_count,
    SUM(CASE WHEN 是否新能源 = '是' THEN 保费 ELSE 0 END) as nev_premium,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate
FROM PolicyFact
WHERE 业务员 IN (
    SELECT 业务员 FROM PolicyFact GROUP BY 业务员 ORDER BY SUM(保费) DESC LIMIT 20
)
GROUP BY 业务员
ORDER BY nev_premium DESC;

-- 新车业务分析
SELECT
    是否新车,
    是否新能源,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium
FROM PolicyFact
GROUP BY 是否新车, 是否新能源
ORDER BY policy_count DESC;
```

---

### 9. 客户类别与渠道分析

```sql
-- 客户类别分布
SELECT
    客户类别,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM PolicyFact
GROUP BY 客户类别
ORDER BY total_premium DESC;

-- 终端来源分析
SELECT
    终端来源,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM PolicyFact
GROUP BY 终端来源
ORDER BY policy_count DESC;

-- 电销业务分析
SELECT
    三级机构,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 是否电销 = '是' THEN 1 ELSE 0 END) as telemarketing_count,
    SUM(CASE WHEN 是否电销 = '是' THEN 保费 ELSE 0 END) as telemarketing_premium,
    ROUND(SUM(CASE WHEN 是否电销 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as telemarketing_rate
FROM PolicyFact
GROUP BY 三级机构
ORDER BY telemarketing_rate DESC;
```

---

### 10. 车型与价格分析

```sql
-- Top 30 厂牌车型
SELECT
    厂牌车型,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    AVG(新车购置价) as avg_purchase_price
FROM PolicyFact
WHERE 厂牌车型 IS NOT NULL AND 厂牌车型 != ''
GROUP BY 厂牌车型
ORDER BY policy_count DESC
LIMIT 30;

-- 吨位分段分析（营业货车）
SELECT
    吨位分段,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium
FROM PolicyFact
WHERE 吨位分段 IS NOT NULL AND 吨位分段 != ''
GROUP BY 吨位分段
ORDER BY policy_count DESC;

-- 新车购置价与保费关系
WITH price_segments AS (
    SELECT
        CASE
            WHEN 新车购置价 < 100000 THEN '< 10万'
            WHEN 新车购置价 < 200000 THEN '10-20万'
            WHEN 新车购置价 < 300000 THEN '20-30万'
            WHEN 新车购置价 < 500000 THEN '30-50万'
            ELSE '>= 50万'
        END as price_segment,
        保费
    FROM PolicyFact
    WHERE 新车购置价 > 0
)
SELECT
    price_segment,
    COUNT(*) as policy_count,
    AVG(保费) as avg_premium,
    STDDEV(保费) as stddev_premium
FROM price_segments
GROUP BY price_segment
ORDER BY
    CASE price_segment
        WHEN '< 10万' THEN 1
        WHEN '10-20万' THEN 2
        WHEN '20-30万' THEN 3
        WHEN '30-50万' THEN 4
        ELSE 5
    END;
```

---

### 11. 异常值检测与风险预警

```sql
-- 超高保费保单（P99以上）
SELECT
    保单号,
    业务员,
    三级机构,
    保费,
    签单日期,
    险别组合,
    厂牌车型
FROM PolicyFact
WHERE 保费 > (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY 保费) FROM PolicyFact)
ORDER BY 保费 DESC
LIMIT 50;

-- 负保费保单（退保）
SELECT
    保单号,
    业务员,
    三级机构,
    保费,
    签单日期,
    批改类型
FROM PolicyFact
WHERE 保费 < 0
ORDER BY 保费 ASC
LIMIT 50;

-- 单日大量出单异常
SELECT
    签单日期,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    COUNT(DISTINCT 业务员) as agent_count
FROM PolicyFact
GROUP BY 签单日期
HAVING COUNT(*) > (
    SELECT AVG(daily_count) * 2
    FROM (SELECT COUNT(*) as daily_count FROM PolicyFact GROUP BY 签单日期)
)
ORDER BY policy_count DESC;

-- 业务员单日高产出异常
SELECT
    业务员,
    签单日期,
    COUNT(*) as daily_policy_count,
    SUM(保费) as daily_premium
FROM PolicyFact
GROUP BY 业务员, 签单日期
HAVING COUNT(*) > 50 OR SUM(保费) > 500000
ORDER BY daily_policy_count DESC
LIMIT 30;
```

---

### 12. 多维度交叉分析

**支持的维度组合**：

```sql
-- 机构 × 险类 × 续保状态
SELECT
    三级机构,
    险类,
    是否续保,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium
FROM PolicyFact
GROUP BY 三级机构, 险类, 是否续保
ORDER BY 三级机构, total_premium DESC;

-- 业务员 × 新能源 × 续保状态
SELECT
    业务员,
    是否新能源,
    是否续保,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium
FROM PolicyFact
WHERE 业务员 IN (
    SELECT 业务员 FROM PolicyFact GROUP BY 业务员 ORDER BY SUM(保费) DESC LIMIT 20
)
GROUP BY 业务员, 是否新能源, 是否续保
ORDER BY 业务员, total_premium DESC;

-- 时间 × 机构 × 险别组合
SELECT
    strftime(CAST(签单日期 AS DATE), '%Y-%m') as month,
    三级机构,
    险别组合,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium
FROM PolicyFact
GROUP BY month, 三级机构, 险别组合
ORDER BY month DESC, 三级机构, total_premium DESC;
```

---

## 输出格式

### 1. Markdown 分析报告

```markdown
# 车险数据深度分析报告

**生成时间**: {current_datetime}
**数据范围**: {start_date} 至 {end_date}

---

## 一、数据概况

### 1.1 基础统计
- **保单总数**: 607,455 条（已去重）
- **业务员数**: 322 人
- **机构数**: 14 个
- **总保费**: ¥499,921,526.89
- **平均保费**: ¥822.98
- **时间跨度**: 2023-11-27 至 2026-01-08

### 1.2 数据质量
- **字段完整性**: 核心字段无缺失
- **重复记录**: 已去重 13,182 条（2.12%）
- **异常保费**: 负保费 {negative_count} 条（退保）

---

## 二、核心业绩分析

### 2.1 Top 30 业务员
| 排名 | 业务员 | 保费（万元） | 保单数 | 续保率 | 新能源占比 |
|------|--------|-------------|--------|--------|-----------|
| 1    | xxx    | xxx         | xxx    | xx%    | xx%       |
| ...  | ...    | ...         | ...    | ...    | ...       |

### 2.2 机构业绩排名
| 排名 | 机构 | 保费（万元） | 业务员数 | 人均产能 | 续保率 |
|------|------|-------------|---------|---------|--------|
| 1    | xxx  | xxx         | xxx     | xxx     | xx%    |
| ...  | ...  | ...         | ...     | ...     | ...    |

---

## 三、续保与可续保分析

### 3.1 整体续保情况
- **续保率**: 36.31%（225,360 / 607,455）
- **可续保率**: 99.05%（601,691 / 607,455）
- **续保潜力**: 62.74%（可续但未续保）

### 3.2 不可续保原因
| 批改类型 | 数量 | 占比 |
|---------|------|------|
| 16退保  | 8,877 | 1.46% |
| ...     | ...   | ...   |

### 3.3 机构续保率对比
[表格：各机构续保率与续保潜力]

---

## 四、批改业务分析

### 4.1 批改类型分布
| 批改类型 | 保单数 | 占比 | 保费影响 | 不可续保率 |
|---------|--------|------|---------|-----------|
| 正常签单 | 602,793 | 99.23% | +++ | 0% |
| 16退保  | 8,877  | 1.46%  | --- | 100% |
| ...     | ...    | ...    | ...  | ...  |

---

## 五、险类与产品分析

### 5.1 险别组合分布
- **单交**: 330,038 条（54.33%）
- **交三**: 139,702 条（23.00%）
- **主全**: 137,683 条（22.67%）

### 5.2 新能源车险
- **新能源保单**: {nev_count} 条（占比 xx%）
- **新能源保费**: {nev_premium} 元（占比 xx%）
- **平均保费**: 新能源 vs 传统 = xxx vs xxx

---

## 六、业务员分层分析

### 6.1 四象限分布
| 象限 | 业务员数 | 保费贡献 | 平均保单数 |
|------|---------|---------|-----------|
| Q1-明星业务员 | xx | xx% | xxx |
| Q2-大单专家   | xx | xx% | xxx |
| Q3-新手待培养 | xx | xx% | xxx |
| Q4-效率待提升 | xx | xx% | xxx |

---

## 七、时间趋势分析

### 7.1 月度趋势
[图表：月度保费与件数趋势]

### 7.2 环比增长
- **最新月份**: {latest_month}
- **环比增长**: 保费 {premium_growth}%, 件数 {count_growth}%

---

## 八、异常与风险预警

### 8.1 异常保单
- **超高保费**: P99 = {p99_value}, 共 {outlier_count} 条
- **负保费**: {negative_count} 条（退保）

### 8.2 风险提示
- 机构 {dept_name} 续保率低于 50%
- 业务员 {agent_name} 单日出单异常

---

## 九、业务洞察与建议

### 9.1 续保提升机会
- 可续但未续保保单 {potential_count} 条
- 建议针对性营销，预计可增加保费 {potential_premium} 元

### 9.2 新能源市场机会
- 当前新能源占比 {nev_rate}%，低于行业平均
- 建议加强新能源产品培训

### 9.3 业务员培训重点
- Q3象限业务员需加强业务能力培训
- Q4象限业务员需优化件均保费

---

## 附录：SQL 查询集合

[完整的可执行 SQL 查询列表]
```

### 2. 可执行 SQL 查询集合

生成的SQL查询可以直接在浏览器控制台运行：

```javascript
// 在浏览器控制台执行（Chrome DevTools）
const result = await window.duckdb.query(`
  SELECT 业务员, SUM(保费) as total_premium
  FROM PolicyFact
  GROUP BY 业务员
  ORDER BY total_premium DESC
  LIMIT 10
`);
console.table(result);
```

---

## 技术实现

### 执行环境
- **DuckDB-WASM**: 浏览器内分析引擎
- **数据视图**: PolicyFact（已去重，MAX 保费）
- **数据传输**: Arrow IPC 格式
- **导出格式**: CSV / JSON / Excel

### 执行步骤
1. 打开 http://localhost:5173/
2. 上传 `车险清单截至20260108.parquet`
3. 在浏览器 Console 执行分析 SQL
4. 或使用 Dashboard 筛选功能进行交互式分析

### 性能优化（针对 60 万+记录）
- **索引**: DuckDB 自动优化查询计划
- **并行**: Worker 并行执行查询
- **分页**: 大结果集使用 LIMIT + OFFSET
- **缓存**: 中间结果缓存在 Worker 内存
- **采样**: 探索性分析可用 `SAMPLE 10%`

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| 数据未加载 | 提示先上传 Parquet 文件 |
| SQL语法错误 | 显示 DuckDB 错误信息，检查字段名 |
| 内存不足 | 建议使用 LIMIT 或采样，或分批查询 |
| 字段不存在 | 检查 PolicyFact 视图定义（src/shared/duckdb/client.ts:78-95） |

---

## 示例输出（基于实际数据）

```
✅ 数据加载完成：607,455 个保单（已去重）
✅ 数据验证通过
📊 开始深度分析...

【数据概况】
- 保单数: 607,455
- 业务员: 322 人
- 机构数: 14 个
- 总保费: ¥499,921,526.89
- 时间跨度: 2023-11-27 至 2026-01-08

【Top 5 业务员】
1. 业务员A - ¥15,234,567 (3.05%)
2. 业务员B - ¥12,876,543 (2.58%)
3. 业务员C - ¥11,234,876 (2.25%)
4. 业务员D - ¥9,876,543 (1.98%)
5. 业务员E - ¥8,765,432 (1.75%)

【续保分析】
- 续保率: 36.31% (225,360 / 607,455)
- 可续保率: 99.05% (601,691 / 607,455)
- 续保潜力: 62.74% (可续但未续保)

【险别组合】
- 单交: 330,038 (54.33%)
- 交三: 139,702 (23.00%)
- 主全: 137,683 (22.67%)

【批改业务】
- 正常签单: 602,793 (99.23%)
- 退保: 8,877 (1.46%)
- 车辆过户: 3,585 (0.59%)

【新能源车险】
- 新能源保单: 预估 5-10%
- 新能源保费: 预估 5-10%

📁 已生成分析报告（14 个分析维度）:
- § 1 数据概览
- § 2 业绩排名
- § 3 时间趋势
- § 4 四象限分析
- § 5 续保与可续保
- § 6 批改类型
- § 7 险类与险别
- § 8 新能源与新车
- § 9 客户类别与渠道
- § 10 车型与价格
- § 11 异常检测
- § 12 交叉分析

🔍 可复制的 SQL 查询集合已生成
```

---

## 使用指南

### 快速开始

```bash
# 1. 在 Claude Code CLI 输入
/data-analysis

# 2. 等待分析完成（预计 30-60 秒，取决于查询复杂度）

# 3. 查看生成的 Markdown 报告

# 4. 复制 SQL 查询到浏览器 Console 执行
```

### 专项分析

```bash
# 续保专项
/data-analysis --focus renewal

# 批改类型专项
/data-analysis --focus batch-type

# 车型专项
/data-analysis --focus vehicle
```

### 时间筛选

```bash
# 分析最近 3 个月
/data-analysis --start 2025-10-01 --end 2025-12-31

# 分析 2025 年全年
/data-analysis --start 2025-01-01 --end 2025-12-31
```

---

## 🆕 v2.1.0 新增分析维度

### 成本分析

**赔付率分析** (`--focus cost-claim`):
```sql
-- 满期赔付率计算
SELECT
  dimension,
  SUM(premium * MIN(DATE_DIFF('day', start_date, :cutoff_date), 365) / 365) as earned_premium,
  SUM(reported_claim_amount) as total_claims,
  SUM(reported_claim_amount) / SUM(premium * ...) as claim_ratio
FROM PolicyFact
GROUP BY dimension
```

**费用率分析** (`--focus cost-expense`):
```sql
-- 费用率计算
SELECT
  dimension,
  SUM(expense_amount) as total_expense,
  SUM(expense_amount) / SUM(premium) as expense_ratio
FROM PolicyFact
GROUP BY dimension
```

**综合费用率分析** (`--focus cost-comprehensive`):
```sql
-- 综合费用率 = (已报告赔款 + 费用金额) / 满期保费
SELECT
  dimension,
  (SUM(reported_claim_amount) + SUM(expense_amount)) /
  SUM(premium * MIN(DATE_DIFF('day', start_date, :cutoff_date), 365) / 365) as comprehensive_ratio
FROM PolicyFact
GROUP BY dimension
```

**使用示例**:
```bash
# 按机构分析赔付率
/data-analysis --focus cost-claim --dimension 机构

# 按客户类别分析费用率
/data-analysis --focus cost-expense --dimension 客户类别

# 综合费用率分析（指定截止日期）
/data-analysis --focus cost-comprehensive --cutoff-date "2026-01-15"
```

**相关命令**: [`/cost-analysis`](./cost-analysis.md) - 专门的成本分析命令

---

### 商车自主定价系数监控

**NCD 保费分析** (`--focus coefficient`):
```sql
-- 商车自主定价系数分析
SELECT
  CASE
    WHEN org_level_3 LIKE '%成都%' THEN 'chengdu'
    WHEN org_level_3 LIKE '%绵阳%' THEN 'remote'
    ELSE 'other'
  END as org_group,
  SUM(premium) / SUM(premium / commercial_pricing_factor) as avg_coefficient,
  COUNT(*) as policy_count
FROM PolicyFact
WHERE insurance_type = '商业保险'
  AND commercial_pricing_factor IS NOT NULL
  AND commercial_pricing_factor > 0
GROUP BY org_group
```

**使用示例**:
```bash
# 商车系数监控（按机构分组）
/data-analysis --focus coefficient --dimension 机构

# 商车系数监控（非营业个人客车）
/data-analysis --focus coefficient --filter "customer_category LIKE '%非营业个人客车%'"
```

**相关文件**:
- `src/shared/sql/coefficient.ts` - 商车系数 SQL 生成器
- `src/shared/config/coefficient-thresholds.ts` - 系数阈值配置

---

### 视角切换分析

**保费口径** (`--perspective premium`):
```sql
-- 按保费聚合
SELECT dimension, SUM(premium) as total_premium
FROM PolicyFact
GROUP BY dimension
```

**件数口径** (`--perspective policy_count`):
```sql
-- 按保单件数聚合
SELECT dimension, COUNT(*) as policy_count
FROM PolicyFact
GROUP BY dimension
```

**使用示例**:
```bash
# 保费视角分析
/data-analysis --perspective premium --dimension 机构

# 件数视角分析
/data-analysis --perspective policy_count --dimension 业务员

# 保费视角 + 趋势分析
/data-analysis --perspective premium --focus trend
```

**相关功能**:
- `src/shared/types/view-perspective.ts` - 视角类型定义
- `src/shared/sql/perspective-adapter.ts` - 视角适配器
- `src/features/dashboard/hooks/usePerspective.ts` - 视角切换 Hook

---

## 常见问题

**Q: 成本分析需要什么数据？**
A: 需要加载 `业务员保费计划标准化数据.parquet`，包含赔款和费用字段。

**Q: 如何同时分析保费和件数？**
A: 使用 `--perspective` 参数切换视角，或直接使用 `/cost-analysis` 命令。

**Q: 商车系数监控支持哪些机构分组？**
A: 支持成都、异地、其他三级机构分组。

**Q: 视角切换会影响哪些分析？**
A: 影响所有聚合查询（KPI、趋势、排名、对比）。

---

现在请执行车险数据多维度深度分析任务。
