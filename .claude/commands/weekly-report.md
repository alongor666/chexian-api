---
name: weekly-report
description: 车险业务周报自动生成（董事会级，数据驱动，业务洞察型）
category: reporting
version: 2.1.0
author: "@claude"
tags: [report, weekly, kpi, trends, executive, insurance, cost, coefficient]
scope: project
requires:
  - DuckDB-WASM
  - bun
dependencies:
  - src/shared/duckdb/client.ts (PolicyFact视图)
  - src/shared/sql/kpi.ts
  - src/shared/sql/cost.ts
  - src/shared/sql/coefficient.ts
  - data-analysis命令
data_requirements:
  - 车险清单.parquet (607K+ 保单记录)
  - 业务员保费计划标准化数据.parquet (成本分析)
last_updated: "2026-01-16"
---

# 车险业务周报自动生成

根据已加载的车险业务数据生成董事会级周报（数据驱动，业务洞察型）。

**v2.1.0 新增**: 成本分析章节、商车系数监控章节

---

## 🚀 快速使用子命令

**推荐**: 根据报告类型使用专用子命令。

| 子命令 | 功能 | 时间维度 |
|--------|------|---------|
| `/report-weekly` | 周报生成 | 自然周 |
| `/report-monthly` | 月报生成 | 自然月 |
| `/report-custom` | 自定义报告 | 灵活范围 |

**董事会级周报**: 使用本命令生成完整的董事会级周报。

---

## 输入参数

```bash
# 默认：生成最近一周报告
/weekly-report

# 指定自然周（基于签单日期）
/weekly-report --period week --number 50

# 指定时间范围
/weekly-report --start 2025-12-01 --end 2025-12-31

# 生成月度报告
/weekly-report --period month --value 2025-12
```

---

## 数据源信息

**基于实际数据特征**（车险清单截至20260108.parquet）：
- **记录数**: 607,455 条保单（已去重）
- **业务员**: 322 人
- **机构数**: 14 个三级机构
- **总保费**: 4.99 亿元
- **时间跨度**: 2023-11-27 至 2026-01-08
- **字段数**: 23 个业务字段（含"是否可续"等新增字段）

**数据验证**：
- PolicyFact 视图可用（src/shared/duckdb/client.ts:78-95）
- 必需字段：保单号、业务员、保费、签单日期、三级机构
- 扩展字段：是否续保、是否可续、批改类型、是否新能源等

---

## 任务流程

### 1. 数据加载与验证

**验证SQL**：
```sql
-- 数据完整性检查
SELECT
    COUNT(*) as total_records,
    COUNT(DISTINCT 保单号) as unique_policies,
    COUNT(DISTINCT 业务员) as total_agents,
    COUNT(DISTINCT 三级机构) as total_departments,
    MIN(CAST(签单日期 AS DATE)) as earliest_date,
    MAX(CAST(签单日期 AS DATE)) as latest_date,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium
FROM PolicyFact;

-- 关键字段缺失检查
SELECT
    SUM(CASE WHEN 保单号 IS NULL THEN 1 ELSE 0 END) as missing_policy_no,
    SUM(CASE WHEN 保费 IS NULL THEN 1 ELSE 0 END) as missing_premium,
    SUM(CASE WHEN 业务员 IS NULL OR 业务员 = '' THEN 1 ELSE 0 END) as missing_agent,
    SUM(CASE WHEN 签单日期 IS NULL THEN 1 ELSE 0 END) as missing_date
FROM PolicyFact;
```

**预期结果**：
- 总记录数: 607,455
- 业务员数: 322
- 机构数: 14
- 总保费: ¥499,921,526.89
- 关键字段缺失: 0

---

### 2. 周期定义与数据筛选

**自然周计算**（周日至周六）：
```sql
-- 获取最近一周数据
WITH week_range AS (
    SELECT
        date_trunc('week', MAX(CAST(签单日期 AS DATE))) as week_start,
        MAX(CAST(签单日期 AS DATE)) as week_end
    FROM PolicyFact
)
SELECT
    week_start,
    week_end,
    week_start + INTERVAL 6 DAY as week_end_expected
FROM week_range;

-- 筛选指定周期数据
SELECT *
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) >= '2025-12-09'
  AND CAST(签单日期 AS DATE) <= '2025-12-15';
```

**时间维度支持**：
- 自然周（周日-周六）
- 自然月（月初-月末）
- 自定义时间范围

---

### 3. 核心KPI计算

**A. 业绩指标**

```sql
-- 周度核心KPI（当前周 vs 上周）
WITH current_week AS (
    SELECT
        COUNT(DISTINCT 保单号) as policy_count,
        SUM(保费) as total_premium,
        AVG(保费) as avg_premium,
        COUNT(DISTINCT 业务员) as active_agents,
        COUNT(DISTINCT 三级机构) as active_depts
    FROM PolicyFact
    WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
),
prev_week AS (
    SELECT
        COUNT(DISTINCT 保单号) as policy_count,
        SUM(保费) as total_premium,
        AVG(保费) as avg_premium
    FROM PolicyFact
    WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-02' AND '2025-12-08'
)
SELECT
    c.policy_count,
    c.total_premium,
    c.avg_premium,
    c.active_agents,
    c.active_depts,
    p.policy_count as prev_policy_count,
    p.total_premium as prev_total_premium,
    ROUND((c.policy_count - p.policy_count) * 100.0 / NULLIF(p.policy_count, 0), 2) as count_growth,
    ROUND((c.total_premium - p.total_premium) * 100.0 / NULLIF(p.total_premium, 0), 2) as premium_growth
FROM current_week c
CROSS JOIN prev_week p;
```

**B. 效率指标**

```sql
-- 人均产能（本周）
WITH agent_stats AS (
    SELECT
        业务员,
        COUNT(*) as policy_count,
        SUM(保费) as total_premium
    FROM PolicyFact
    WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
    GROUP BY 业务员
)
SELECT
    COUNT(*) as active_agent_count,
    AVG(total_premium) as avg_premium_per_agent,
    AVG(policy_count) as avg_policies_per_agent,
    MAX(total_premium) as top_agent_premium,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY total_premium) as median_premium
FROM agent_stats;

-- 机构效率对比
SELECT
    三级机构,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    COUNT(DISTINCT 业务员) as agent_count,
    ROUND(SUM(保费) / COUNT(DISTINCT 业务员), 2) as premium_per_agent
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY 三级机构
ORDER BY total_premium DESC;
```

**C. 质量指标**

```sql
-- 续保与可续保分析（本周）
SELECT
    COUNT(*) as total_policies,
    -- 续保指标
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    SUM(CASE WHEN 是否续保 = '是' THEN 保费 ELSE 0 END) as renewal_premium,
    -- 可续保指标
    SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) as renewable_count,
    ROUND(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewable_rate,
    -- 续保潜力（可续但未续保）
    SUM(CASE WHEN 是否可续 = '是' AND 是否续保 != '是' THEN 1 ELSE 0 END) as renewal_potential_count,
    ROUND(SUM(CASE WHEN 是否可续 = '是' AND 是否续保 != '是' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END), 0), 2) as renewal_potential_rate,
    -- 新能源指标
    SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) as nev_count,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate,
    SUM(CASE WHEN 是否新能源 = '是' THEN 保费 ELSE 0 END) as nev_premium
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15';
```

**D. 批改业务分析**

```sql
-- 批改类型分布（本周）
SELECT
    COALESCE(NULLIF(批改类型, ''), '正常签单') as batch_type,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
    SUM(CASE WHEN 是否可续 != '是' THEN 1 ELSE 0 END) as not_renewable_count
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY batch_type
ORDER BY policy_count DESC;
```

---

### 4. 多维度排名分析

**A. Top 20 业务员（本周）**

```sql
SELECT
    业务员,
    三级机构,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    ROUND(SUM(保费) * 100.0 / SUM(SUM(保费)) OVER (), 2) as contribution_rate,
    -- 续保指标
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    -- 新能源指标
    SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) as nev_count,
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY 业务员, 三级机构
ORDER BY total_premium DESC
LIMIT 20;
```

**B. 机构排名（本周）**

```sql
SELECT
    三级机构,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT 业务员) as agent_count,
    ROUND(SUM(保费) / COUNT(DISTINCT 业务员), 2) as premium_per_agent,
    ROUND(COUNT(*) / COUNT(DISTINCT 业务员), 2) as policies_per_agent,
    -- 续保率
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate,
    -- 可续保率
    ROUND(SUM(CASE WHEN 是否可续 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewable_rate,
    -- 新能源占比
    ROUND(SUM(CASE WHEN 是否新能源 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as nev_rate
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY 三级机构
ORDER BY total_premium DESC;
```

**C. 四象限分类（本周）**

```sql
-- 业务员四象限分布
WITH agent_metrics AS (
    SELECT
        业务员,
        SUM(保费) as total_premium,
        COUNT(*) as policy_count
    FROM PolicyFact
    WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
    GROUP BY 业务员
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

---

### 5. 时间趋势分析

**A. 日度趋势（本周每日）**

```sql
-- 本周每日业绩
SELECT
    CAST(签单日期 AS DATE) as date,
    CASE dayofweek(CAST(签单日期 AS DATE))
        WHEN 0 THEN '周日'
        WHEN 1 THEN '周一'
        WHEN 2 THEN '周二'
        WHEN 3 THEN '周三'
        WHEN 4 THEN '周四'
        WHEN 5 THEN '周五'
        WHEN 6 THEN '周六'
    END as weekday,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT 业务员) as active_agents
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY date, dayofweek(CAST(签单日期 AS DATE))
ORDER BY date;
```

**B. 工作日 vs 周末对比**

```sql
-- 工作日与周末业绩对比
SELECT
    CASE
        WHEN dayofweek(CAST(签单日期 AS DATE)) IN (0, 6) THEN '周末'
        ELSE '工作日'
    END as day_type,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT CAST(签单日期 AS DATE)) as day_count,
    ROUND(COUNT(*) / COUNT(DISTINCT CAST(签单日期 AS DATE)), 2) as avg_policies_per_day,
    ROUND(SUM(保费) / COUNT(DISTINCT CAST(签单日期 AS DATE)), 2) as avg_premium_per_day
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY day_type;
```

**C. 周度环比趋势（最近8周）**

```sql
-- 近8周趋势
SELECT
    date_trunc('week', CAST(签单日期 AS DATE)) as week_start,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium,
    COUNT(DISTINCT 业务员) as active_agents,
    -- 环比增长
    LAG(COUNT(*)) OVER (ORDER BY date_trunc('week', CAST(签单日期 AS DATE))) as prev_week_count,
    ROUND((COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY date_trunc('week', CAST(签单日期 AS DATE)))) * 100.0 /
        NULLIF(LAG(COUNT(*)) OVER (ORDER BY date_trunc('week', CAST(签单日期 AS DATE))), 0), 2) as count_growth
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) >= CURRENT_DATE - INTERVAL '56 days'
GROUP BY week_start
ORDER BY week_start DESC;
```

---

### 6. 风险预警与异常检测

**A. 异常保单识别**

```sql
-- 超高保费保单（本周）
SELECT
    保单号,
    业务员,
    三级机构,
    保费,
    签单日期,
    险别组合
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
  AND 保费 > (
      SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY 保费)
      FROM PolicyFact
      WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
  )
ORDER BY 保费 DESC
LIMIT 10;

-- 负保费保单（退保）
SELECT
    保单号,
    业务员,
    三级机构,
    保费,
    签单日期,
    批改类型
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
  AND 保费 < 0
ORDER BY 保费 ASC;
```

**B. 低产能预警**

```sql
-- 本周低产能业务员（保费 < 1000 元）
SELECT
    业务员,
    三级机构,
    COUNT(*) as policy_count,
    SUM(保费) as total_premium,
    AVG(保费) as avg_premium
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY 业务员, 三级机构
HAVING SUM(保费) < 1000
ORDER BY total_premium ASC;
```

**C. 机构续保率预警**

```sql
-- 续保率低于50%的机构（本周）
SELECT
    三级机构,
    COUNT(*) as total_policies,
    SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) as renewal_count,
    ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as renewal_rate
FROM PolicyFact
WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
GROUP BY 三级机构
HAVING ROUND(SUM(CASE WHEN 是否续保 = '是' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) < 50
ORDER BY renewal_rate ASC;
```

---

## 报告结构（董事会级）

### 1. 封面信息

```markdown
# 车险业务周报 - 第50周

**报告周期**: 2025-12-09（周日）至 2025-12-15（周六）
**生成时间**: 2025-12-16 10:30
**数据来源**: 车险清单截至20260108.parquet
**数据规模**: 607,455 个保单（全量）/ 8,456 个保单（本周）
**报告类型**: 董事会级业务洞察

---
```

### 2. 执行摘要（Executive Summary）

```markdown
## 📊 执行摘要

### 核心KPI

| 指标 | 本周数值 | 上周数值 | 环比变化 | 全年累计 |
|------|---------|---------|---------|---------|
| 总保费 | ¥6,543,210 | ¥6,234,567 | +5.0% ⬆️ | ¥499,921,527 |
| 保单数 | 8,456 | 8,123 | +4.1% ⬆️ | 607,455 |
| 活跃业务员 | 245 | 238 | +2.9% | 322（总数） |
| 人均产能 | ¥26,707 | ¥26,200 | +1.9% | ¥1,552,545 |
| 续保率 | 38.2% | 36.5% | +1.7pp ⬆️ | 37.1% |
| 可续保率 | 98.9% | 99.1% | -0.2pp | 99.0% |
| 新能源占比 | 9.2% | 8.5% | +0.7pp ⬆️ | 8.4% |
| 件均保费 | ¥774 | ¥767 | +0.9% | ¥823 |

### 关键发现 🔍

1. **业绩稳步增长**: 本周保费环比增长 5.0%（¥308,643），保单量增长 4.1%（+333 单），延续良好态势
2. **续保质量提升**: 续保率提升 1.7 个百分点至 38.2%，但续保潜力仍达 60.7%（可续但未续保）
3. **新能源突破**: 新能源保单占比首次突破 9%（9.2%），同比提升 2.3 个百分点
4. **批改业务正常**: 正常签单占比 99.1%，退保率控制在 0.8% 以内
5. **Top 20 集中度**: 前 20 名业务员贡献 57.8% 保费（¥3,781,875），较上周提升 1.5pp

### 趋势判断 📈

- ✅ **业绩趋势**: 连续 3 周环比增长，预计本月可达成目标
- ⚠️ **续保潜力**: 60.7% 可续保保单未实现续保，需加强客户维系
- ✅ **新能源增长**: 新能源业务保持快速增长，符合战略方向
- ✅ **人均效率**: 人均产能稳步提升，业务员积极性高
```

---

### 3. 业绩详细分析

```markdown
## 📈 业绩分析

### 3.1 周度趋势对比（近8周）

| 周次 | 周起止 | 保单数 | 保费（万元） | 环比增长 | 活跃业务员 |
|------|--------|--------|-------------|---------|-----------|
| 第50周 | 12/09-12/15 | 8,456 | 654.32 | +4.1% ⬆️ | 245 |
| 第49周 | 12/02-12/08 | 8,123 | 623.46 | +2.8% ⬆️ | 238 |
| 第48周 | 11/25-12/01 | 7,902 | 606.54 | -1.2% ⬇️ | 232 |
| 第47周 | 11/18-11/24 | 8,002 | 614.35 | +3.5% ⬆️ | 241 |
| 第46周 | 11/11-11/17 | 7,731 | 593.74 | +0.8% ⬆️ | 228 |
| 第45周 | 11/04-11/10 | 7,669 | 589.02 | +5.2% ⬆️ | 225 |
| 第44周 | 10/28-11/03 | 7,289 | 559.87 | -0.5% ⬇️ | 220 |
| 第43周 | 10/21-10/27 | 7,326 | 562.68 | +2.3% ⬆️ | 223 |

**趋势洞察**:
- 近8周平均保费: ¥600.50万，本周超平均 8.9%
- 最近3周连续增长，增长势头良好
- 活跃业务员数稳定在 220-245 人区间

### 3.2 日度业绩分布（本周）

| 日期 | 星期 | 保单数 | 保费（万元） | 件均保费 | 活跃业务员 |
|------|------|--------|-------------|---------|-----------|
| 12/09 | 周日 | 876 | 68.45 | ¥781 | 134 |
| 12/10 | 周一 | 1,234 | 95.32 | ¥772 | 189 |
| 12/11 | 周二 | 1,345 | 103.56 | ¥770 | 198 |
| 12/12 | 周三 | 1,289 | 99.87 | ¥775 | 192 |
| 12/13 | 周四 | 1,312 | 101.23 | ¥772 | 195 |
| 12/14 | 周五 | 1,456 | 112.34 | ¥771 | 205 |
| 12/15 | 周六 | 944 | 73.55 | ¥779 | 142 |

**日度洞察**:
- 工作日平均: 1,327 单/天，周末平均: 910 单/天
- 周五为高峰日（1,456 单），周日为低谷日（876 单）
- 件均保费稳定在 ¥770-781 区间，波动小于 1.5%

### 3.3 保费构成分析

| 业务类型 | 保单数 | 占比 | 保费（万元） | 占比 | 件均保费 |
|---------|--------|------|-------------|------|---------|
| 续保业务 | 3,230 | 38.2% | 258.76 | 39.6% | ¥801 |
| 新业务 | 5,226 | 61.8% | 395.56 | 60.4% | ¥757 |
| **按险别组合** |  |  |  |  |  |
| 单交 | 4,592 | 54.3% | 312.45 | 47.7% | ¥680 |
| 交三 | 1,946 | 23.0% | 168.32 | 25.7% | ¥865 |
| 主全 | 1,918 | 22.7% | 173.55 | 26.6% | ¥905 |
| **按车型** |  |  |  |  |  |
| 传统车 | 7,678 | 90.8% | 594.87 | 90.9% | ¥775 |
| 新能源 | 778 | 9.2% | 59.45 | 9.1% | ¥764 |

**构成洞察**:
- 续保业务件均保费（¥801）高于新业务（¥757）5.8%
- 主全险件均保费最高（¥905），是单交险（¥680）的 1.33 倍
- 新能源件均保费略低于传统车（-1.4%），但差距在缩小
```

---

### 4. 机构业绩分析

```markdown
## 🏢 机构业绩分析

### 4.1 Top 10 机构排名（本周）

| 排名 | 机构名称 | 保单数 | 保费（万元） | 占比 | 业务员数 | 人均保费 | 续保率 | 新能源占比 |
|------|----------|--------|-------------|------|----------|---------|--------|-----------|
| 1 | 成都市本级 | 2,145 | 167.32 | 25.6% | 58 | ¥28,848 | 41.2% | 11.3% |
| 2 | 绵阳市本级 | 1,234 | 95.67 | 14.6% | 35 | ¥27,334 | 36.8% | 8.9% |
| 3 | 南充市本级 | 987 | 76.45 | 11.7% | 28 | ¥27,304 | 35.4% | 7.2% |
| 4 | 德阳市本级 | 876 | 68.23 | 10.4% | 25 | ¥27,292 | 39.1% | 9.5% |
| 5 | 泸州市本级 | 765 | 59.34 | 9.1% | 22 | ¥26,973 | 37.9% | 6.8% |
| 6 | 宜宾市本级 | 698 | 54.12 | 8.3% | 20 | ¥27,060 | 34.2% | 8.1% |
| 7 | 达州市本级 | 543 | 42.15 | 6.4% | 18 | ¥23,417 | 33.5% | 5.9% |
| 8 | 乐山市本级 | 456 | 35.43 | 5.4% | 15 | ¥23,620 | 36.7% | 7.4% |
| 9 | 广元市本级 | 398 | 30.89 | 4.7% | 13 | ¥23,762 | 32.1% | 6.3% |
| 10 | 内江市本级 | 354 | 24.72 | 3.8% | 11 | ¥22,473 | 30.8% | 5.2% |

**机构洞察**:
- Top 3 机构贡献 51.9% 保费，集中度较高
- 成都市本级人均产能最高（¥28,848），领先第二名 5.5%
- 内江市本级续保率最低（30.8%），需重点关注
- 成都市本级新能源占比最高（11.3%），高于平均水平 2.1pp

### 4.2 机构环比增长TOP 5

| 机构名称 | 本周保费 | 上周保费 | 环比增长 | 件数增长 |
|---------|---------|---------|---------|---------|
| 德阳市本级 | ¥68.23万 | ¥62.15万 | +9.8% ⬆️ | +8.3% |
| 成都市本级 | ¥167.32万 | ¥155.67万 | +7.5% ⬆️ | +6.2% |
| 泸州市本级 | ¥59.34万 | ¥55.42万 | +7.1% ⬆️ | +5.9% |
| 南充市本级 | ¥76.45万 | ¥71.89万 | +6.3% ⬆️ | +5.1% |
| 绵阳市本级 | ¥95.67万 | ¥90.23万 | +6.0% ⬆️ | +4.8% |

### 4.3 机构预警清单

⚠️ **续保率低于35%的机构**（需改进）:
- 内江市本级: 30.8%
- 广元市本级: 32.1%
- 达州市本级: 33.5%

⚠️ **人均产能低于¥25,000的机构**:
- 内江市本级: ¥22,473
- 达州市本级: ¥23,417
- 乐山市本级: ¥23,620
```

---

### 6. 成本分析分析 🆕

**数据源**: `业务员保费计划标准化数据.parquet`

#### 6.1 满期赔付率分析

```sql
-- 按机构分析满期赔付率
SELECT
  org_name as 机构,
  SUM(premium * MIN(DATE_DIFF('day', start_date, CURRENT_DATE), 365) / 365) as 满期保费,
  SUM(reported_claim_amount) as 已报告赔款,
  SUM(reported_claim_amount) / SUM(premium * ...) as 满期赔付率,
  COUNT(*) FILTER (WHERE reported_claim_amount > 0) as 赔案件数
FROM PolicyFact
WHERE start_date <= CURRENT_DATE
GROUP BY org_name
ORDER BY 满期保费 DESC
```

**报告内容**:
- 整体满期赔付率
- 机构赔付率排名（Top 10 / Bottom 5）
- 赔付率预警（> 70% 标红）
- 案均赔款分析

#### 6.2 费用率分析

```sql
-- 按机构分析费用率
SELECT
  org_name as 机构,
  SUM(expense_amount) as 费用金额,
  SUM(expense_amount) / SUM(premium) as 费用率
FROM PolicyFact
GROUP BY org_name
ORDER BY 费用率 DESC
```

**报告内容**:
- 整体费用率
- 机构费用率对比
- 费用率优化建议

#### 6.3 综合费用率与盈利能力

```sql
-- 综合费用率 = (已报告赔款 + 费用金额) / 满期保费
SELECT
  org_name as 机构,
  (SUM(reported_claim_amount) + SUM(expense_amount)) /
  SUM(premium * MIN(DATE_DIFF('day', start_date, CURRENT_DATE), 365) / 365) as 综合费用率,
  1 - 综合费用率 as 承保利润率
FROM PolicyFact
GROUP BY org_name
ORDER BY 承保利润率 DESC
```

**报告内容**:
- 综合费用率排名
- 盈利机构数量与占比
- 亏损机构预警清单
- 边际贡献率分析

**相关命令**: [`/cost-analysis`](./cost-analysis.md)

---

### 7. 商车自主定价系数监控 🆕

**数据源**: `车险清单.parquet`（需包含 `commercial_pricing_factor` 字段）

#### 7.1 商车系数分布

```sql
-- 商车自主定价系数分布
SELECT
  CASE
    WHEN commercial_pricing_factor < 0.5 THEN '< 0.5'
    WHEN commercial_pricing_factor < 0.7 THEN '0.5-0.7'
    WHEN commercial_pricing_factor < 0.9 THEN '0.7-0.9'
    WHEN commercial_pricing_factor < 1.1 THEN '0.9-1.1'
    WHEN commercial_pricing_factor < 1.3 THEN '1.1-1.3'
    ELSE '>= 1.3'
  END as 系数区间,
  COUNT(*) as 保单数量,
  SUM(premium) as 总保费,
  AVG(commercial_pricing_factor) as 平均系数
FROM PolicyFact
WHERE insurance_type = '商业保险'
  AND commercial_pricing_factor IS NOT NULL
  AND commercial_pricing_factor > 0
GROUP BY 系数区间
ORDER BY MIN(commercial_pricing_factor)
```

**报告内容**:
- 商车系数分布直方图
- 各区间保费占比
- 系数使用合理性评估

#### 7.2 机构系数对比

```sql
-- 按机构分组分析商车系数
SELECT
  CASE
    WHEN org_level_3 LIKE '%成都%' THEN '成都'
    WHEN org_level_3 LIKE '%绵阳%' THEN '异地'
    ELSE '其他'
  END as 机构分组,
  SUM(premium) / SUM(premium / commercial_pricing_factor) as 加权平均系数,
  COUNT(*) as 保单数量,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY commercial_pricing_factor) as 中位数系数
FROM PolicyFact
WHERE insurance_type = '商业保险'
  AND commercial_pricing_factor IS NOT NULL
  AND commercial_pricing_factor > 0
GROUP BY 机构分组
```

**报告内容**:
- 成都/异地/其他机构系数对比
- NCD 保费分析（保费 / 系数）
- 系数使用异常检测

**相关文件**:
- `src/shared/sql/coefficient.ts` - 商车系数 SQL 生成器

---

### 8. 业务员业绩分析

```markdown
## 👥 业务员业绩分析

### 5.1 Top 20 业务员排名（本周）

| 排名 | 业务员 | 机构 | 保单数 | 保费（万元） | 贡献率 | 续保率 | 新能源占比 |
|------|--------|------|--------|-------------|--------|--------|-----------|
| 1 | 张三 | 成都市本级 | 234 | 25.67 | 3.9% | 45.3% | 13.2% |
| 2 | 李四 | 绵阳市本级 | 198 | 22.34 | 3.4% | 42.1% | 10.6% |
| 3 | 王五 | 成都市本级 | 187 | 20.89 | 3.2% | 38.5% | 14.8% |
| 4 | 赵六 | 南充市本级 | 176 | 19.54 | 3.0% | 41.2% | 9.3% |
| 5 | 钱七 | 成都市本级 | 165 | 18.32 | 2.8% | 39.7% | 11.5% |
| ... | ... | ... | ... | ... | ... | ... | ... |
| 20 | 周二十 | 泸州市本级 | 98 | 10.23 | 1.6% | 35.2% | 7.1% |

**业务员洞察**:
- Top 20 业务员贡献 57.8% 保费（¥378.19万），集中度高
- 张三连续 5 周排名第一，单周保费突破 ¥25 万
- 王五新能源占比最高（14.8%），超平均水平 5.6pp
- Top 20 平均续保率 40.3%，高于整体水平 2.1pp

### 5.2 四象限分布（本周活跃业务员）

| 象限 | 定义 | 业务员数 | 占比 | 保费贡献 | 平均保单数 | 平均保费 |
|------|------|---------|------|---------|-----------|---------|
| Q1 明星业务员 | 高保费高保单 | 62 | 25.3% | 45.2% | 132 | ¥47,654 |
| Q2 大单专家 | 高保费低保单 | 58 | 23.7% | 31.8% | 56 | ¥36,897 |
| Q3 新手待培养 | 低保费低保单 | 68 | 27.8% | 8.3% | 28 | ¥7,989 |
| Q4 效率待提升 | 低保费高保单 | 57 | 23.3% | 14.7% | 82 | ¥10,654 |

**四象限洞察**:
- Q1 明星业务员虽仅占 25.3%，但贡献 45.2% 保费
- Q3 新手待培养占比 27.8%，需加强培训和指导
- Q4 效率待提升业务员件均保费仅 ¥130（¥10,654÷82），远低于平均水平

### 5.3 业务员预警清单

⚠️ **本周零保费业务员**（77 人）:
- 需核实：是否休假/离职/其他原因
- 建议：HR 跟进确认状态

⚠️ **本周低产能业务员**（保费 < ¥1,000，32 人）:
- 典型代表：需提供针对性辅导
- 建议：安排带教或专项培训
```

---

### 6. 续保与可续保专项分析

```markdown
## 🔄 续保与可续保专项分析

### 6.1 续保核心指标（本周）

| 指标 | 数值 | 占比/率 | 全年对比 |
|------|------|---------|---------|
| 总保单数 | 8,456 | 100% | - |
| 续保保单 | 3,230 | 38.2% | +1.1pp ⬆️ |
| 新业务保单 | 5,226 | 61.8% | -1.1pp |
| 可续保保单 | 8,362 | 98.9% | -0.1pp |
| 不可续保保单 | 94 | 1.1% | +0.1pp |
| **续保潜力** |  |  |  |
| 可续但未续保 | 5,132 | 60.7% | -0.5pp |

**关键洞察**:
- 续保率 38.2%，环比提升 1.7pp，但仍有 **60.7% 续保潜力**（5,132 单）
- 若续保潜力转化率提升 10%，可增加 513 单，约 ¥41 万保费
- 不可续保保单 94 单（1.1%），主要原因为退保（67 单，71.3%）

### 6.2 各机构续保率对比（本周）

| 机构 | 续保率 | 可续保率 | 续保潜力 | 续保保费占比 |
|------|--------|---------|---------|-------------|
| 成都市本级 | 41.2% | 99.1% | 57.9% | 42.3% |
| 德阳市本级 | 39.1% | 98.8% | 59.7% | 40.5% |
| 泸州市本级 | 37.9% | 99.0% | 61.1% | 39.2% |
| 绵阳市本级 | 36.8% | 98.9% | 62.1% | 38.1% |
| 乐山市本级 | 36.7% | 98.7% | 62.0% | 37.9% |
| 南充市本级 | 35.4% | 98.6% | 63.2% | 36.7% |
| 宜宾市本级 | 34.2% | 98.8% | 64.6% | 35.5% |
| 达州市本级 | 33.5% | 98.9% | 65.4% | 34.8% |
| 广元市本级 | 32.1% | 98.7% | 66.6% | 33.4% |
| 内江市本级 | 30.8% | 98.5% | 67.7% | 32.1% |

⚠️ **续保率低于35%的机构**需重点改进:
- 内江市本级（30.8%）: 续保潜力高达 67.7%，有较大提升空间
- 广元市本级（32.1%）: 建议加强客户维系工作
- 达州市本级（33.5%）: 需制定续保激励措施

### 6.3 不可续保原因分析（本周 94 单）

| 原因（批改类型） | 保单数 | 占比 | 保费影响 |
|----------------|--------|------|---------|
| 16退保 | 67 | 71.3% | -¥51,234 |
| 51车辆过户 | 18 | 19.1% | ¥0（中性） |
| 42变更车辆基本信息 | 9 | 9.6% | ¥0（中性） |

**不可续保洞察**:
- 退保是主要不可续保原因，占比 71.3%
- 退保造成保费损失 ¥51,234（平均每单 ¥765）
- 车辆过户占比 19.1%，属正常业务变动
```

---

### 7. 新能源专项分析

```markdown
## 🔋 新能源专项分析

### 7.1 新能源核心指标（本周）

| 指标 | 新能源 | 传统车 | 新能源占比 | 全年对比 |
|------|--------|--------|-----------|---------|
| 保单数 | 778 | 7,678 | 9.2% | +0.8pp ⬆️ |
| 保费（万元） | 59.45 | 594.87 | 9.1% | +0.7pp ⬆️ |
| 件均保费 | ¥764 | ¥775 | -1.4% | +0.3% |

**关键洞察**:
- 新能源保单占比首次突破 9%，达 9.2%
- 近 4 周新能源占比稳步提升：7.8% → 8.2% → 8.7% → 9.2%
- 新能源件均保费（¥764）略低于传统车（¥775），但差距在缩小

### 7.2 各机构新能源渗透率（本周）

| 机构 | 新能源保单 | 新能源占比 | 环比变化 |
|------|-----------|-----------|---------|
| 成都市本级 | 242 | 11.3% | +0.9pp ⬆️ |
| 德阳市本级 | 83 | 9.5% | +1.2pp ⬆️ |
| 绵阳市本级 | 110 | 8.9% | +0.6pp ⬆️ |
| 宜宾市本级 | 57 | 8.1% | +0.5pp ⬆️ |
| 乐山市本级 | 34 | 7.4% | +0.7pp ⬆️ |
| 南充市本级 | 71 | 7.2% | +0.4pp |
| 泸州市本级 | 52 | 6.8% | +0.3pp |
| 广元市本级 | 25 | 6.3% | +0.6pp ⬆️ |
| 达州市本级 | 32 | 5.9% | +0.4pp |
| 内江市本级 | 18 | 5.2% | +0.2pp |

**机构洞察**:
- 成都市本级新能源占比最高（11.3%），领先平均水平 2.1pp
- 所有机构新能源占比均环比上升，趋势良好
- 内江市本级新能源占比最低（5.2%），需加强推广

### 7.3 Top 10 新能源业务员（本周）

| 业务员 | 机构 | 新能源保单 | 新能源保费 | 新能源占比 |
|--------|------|-----------|-----------|-----------|
| 王五 | 成都市本级 | 28 | ¥21,456 | 14.8% |
| 张三 | 成都市本级 | 31 | ¥23,678 | 13.2% |
| 孙九 | 德阳市本级 | 19 | ¥14,532 | 12.7% |
| 周十 | 成都市本级 | 15 | ¥11,234 | 11.9% |
| 钱七 | 成都市本级 | 19 | ¥14,876 | 11.5% |
| 吴十一 | 绵阳市本级 | 22 | ¥16,543 | 11.1% |
| 郑十二 | 德阳市本级 | 17 | ¥12,987 | 10.9% |
| 李四 | 绵阳市本级 | 21 | ¥15,678 | 10.6% |
| 陈十四 | 南充市本级 | 16 | ¥11,897 | 10.3% |
| 刘十五 | 成都市本级 | 18 | ¥13,456 | 10.1% |

**业务员洞察**:
- 王五新能源占比最高（14.8%），高于平均水平 5.6pp
- Top 10 新能源业务员平均占比 11.7%，远高于整体水平（9.2%）
- 成都市本级占据 Top 10 中的 5 席，新能源推广效果显著
```

---

### 8. 批改业务分析

```markdown
## 📝 批改业务分析

### 8.1 批改类型分布（本周）

| 批改类型 | 保单数 | 占比 | 保费影响 | 不可续保率 |
|---------|--------|------|---------|-----------|
| 正常签单 | 8,379 | 99.1% | +¥6,594,444 | 0.0% |
| 16退保 | 67 | 0.8% | -¥51,234 | 100.0% |
| 51车辆过户 | 18 | 0.2% | ¥0 | 100.0% |
| 42变更车辆基本信息 | 9 | 0.1% | ¥0 | 100.0% |
| 其他批改 | 3 | 0.04% | ¥0 | 0.0% |

**批改洞察**:
- 正常签单占比 99.1%，业务质量良好
- 退保率 0.8%（67 单），处于正常范围
- 退保造成保费损失 ¥51,234，需关注退保原因
- 车辆过户 18 单，属正常业务变动

### 8.2 退保专项分析（本周 67 单）

| 机构 | 退保保单 | 退保率 | 退保保费 | 退保原因（主要） |
|------|---------|--------|---------|----------------|
| 成都市本级 | 18 | 0.84% | -¥13,897 | 客户要求 |
| 绵阳市本级 | 12 | 0.97% | -¥9,234 | 客户要求 |
| 南充市本级 | 9 | 0.91% | -¥6,987 | 客户要求 |
| 其他机构 | 28 | 0.75% | -¥21,116 | 客户要求 |

**退保洞察**:
- 退保率控制在 1% 以内，整体可控
- 成都市本级退保保单最多（18 单），但退保率不高（0.84%）
- 主要退保原因为"客户要求"，建议了解具体原因

### 8.3 过户业务分析（本周 18 单）

| 机构 | 过户保单 | 过户率 | 是否标记"是否过户车" | 一致性 |
|------|---------|--------|---------------------|--------|
| 成都市本级 | 5 | 0.23% | 5 | 100% |
| 绵阳市本级 | 4 | 0.32% | 4 | 100% |
| 其他机构 | 9 | 0.25% | 9 | 100% |

**过户洞察**:
- 过户业务数据一致性 100%（批改类型与"是否过户车"字段匹配）
- 过户率稳定在 0.2-0.3% 区间，属正常水平
```

---

### 9. 数据质量报告

```markdown
## ✅ 数据质量报告

### 9.1 数据完整性检查

| 检查项 | 结果 | 状态 |
|--------|------|------|
| 保单号缺失 | 0 | ✅ 通过 |
| 保费缺失 | 0 | ✅ 通过 |
| 业务员缺失 | 0 | ✅ 通过 |
| 签单日期缺失 | 0 | ✅ 通过 |
| 三级机构缺失 | 0 | ✅ 通过 |
| 是否续保缺失 | 0 | ✅ 通过 |
| 是否可续缺失 | 0 | ✅ 通过 |

### 9.2 异常值检测

**超高保费保单**（P99 以上，本周 10 单）:

| 保单号 | 业务员 | 机构 | 保费 | 险别组合 |
|--------|--------|------|------|---------|
| 610210... | 张三 | 成都市本级 | ¥5,234 | 主全 |
| 610210... | 李四 | 绵阳市本级 | ¥4,987 | 主全 |
| ... | ... | ... | ... | ... |

**负保费保单**（退保，本周 67 单）:

| 保单号 | 业务员 | 机构 | 保费 | 批改类型 |
|--------|--------|------|------|---------|
| 610210... | 王五 | 成都市本级 | -¥1,234 | 16退保 |
| 610210... | 赵六 | 绵阳市本级 | -¥987 | 16退保 |
| ... | ... | ... | ... | ... |

### 9.3 数据一致性验证

| 验证项 | 一致性 | 状态 |
|--------|--------|------|
| 批改类型 vs 是否可续 | 100% | ✅ 通过 |
| 过户批改 vs 是否过户车 | 100% | ✅ 通过 |
| 保费正负 vs 业务类型 | 100% | ✅ 通过 |

**结论**: 数据质量优秀，无重大质量问题
```

---

### 10. 风险预警与行动建议

```markdown
## ⚠️ 风险预警

### 10.1 机构风险

| 风险类型 | 机构 | 风险指标 | 风险等级 | 建议措施 |
|---------|------|---------|---------|---------|
| 续保率低 | 内江市本级 | 续保率 30.8% | 🔴 高 | 制定续保提升专项计划 |
| 续保率低 | 广元市本级 | 续保率 32.1% | 🔴 高 | 加强客户维系工作 |
| 人均产能低 | 内江市本级 | ¥22,473 | 🟡 中 | 优化业务员配置 |
| 新能源滞后 | 内江市本级 | 新能源占比 5.2% | 🟡 中 | 加强新能源培训推广 |

### 10.2 业务员风险

| 风险类型 | 人数 | 风险描述 | 建议措施 |
|---------|------|---------|---------|
| 零保费 | 77 人 | 本周无签单 | HR 核实状态（休假/离职） |
| 低产能 | 32 人 | 保费 < ¥1,000 | 安排带教或专项培训 |
| 零续保 | 45 人 | 续保率 0% | 强化续保意识培训 |

### 10.3 业务风险

| 风险类型 | 指标 | 风险描述 | 建议措施 |
|---------|------|---------|---------|
| 续保潜力未释放 | 60.7% | 可续但未续保 | 建立续保提醒机制 |
| 退保率波动 | 0.8% | 环比上升 0.2pp | 分析退保原因，改进服务 |
| 业绩集中度高 | 57.8% | Top 20 贡献过半 | 培养后备力量 |

---

## 💡 改进建议

### 建议 1: 提升续保率（优先级: 🔴 高）

**问题**: 续保率 38.2%，续保潜力 60.7%

**目标**: 续保率提升至 45%，释放 6.8pp 续保潜力

**行动计划**:
1. 建立续保提醒机制（保险到期前 30/15/7 天提醒）
2. 针对续保率低于 35% 的 3 个机构制定专项改进计划
3. 设置续保专项激励（续保率提升奖励）
4. 分享成都市本级续保经验（续保率 41.2%）

**预期效果**: 若续保率提升至 45%，每周可增加约 574 单，保费约 ¥46 万

---

### 建议 2: 优化业务员培训（优先级: 🟡 中）

**问题**: 27.8% 业务员属 Q3 新手待培养，人均保费仅 ¥7,989

**目标**: Q3 业务员人均保费提升至 ¥15,000

**行动计划**:
1. 为 Q3 业务员安排 Q1 明星业务员带教（1 对 1）
2. 每周开展业务培训（产品知识、销售技巧、客户维系）
3. 设立"新手成长奖"（月度进步最快奖励）
4. Q4 效率待提升业务员专项辅导（提升件均保费）

**预期效果**: Q3 业务员产能提升 87.9%，每周可增加保费约 ¥54 万

---

### 建议 3: 拓展新能源业务（优先级: 🟡 中）

**问题**: 新能源占比 9.2%，部分机构低于 6%

**目标**: 新能源占比提升至 12%，追赶行业平均水平

**行动计划**:
1. 加大新能源产品培训力度（产品特点、定价优势）
2. 设置新能源专项激励（新能源保单额外奖励）
3. 分享 Top 新能源业务员经验（王五新能源占比 14.8%）
4. 针对新能源占比低于 6% 的机构制定提升计划

**预期效果**: 新能源占比提升至 12%，每周可增加新能源保单约 237 单

---

### 建议 4: 关注低产能业务员（优先级: 🟡 中）

**问题**: 77 人本周零保费，32 人保费低于 ¥1,000

**目标**: 降低零保费业务员占比至 15%（约 48 人）

**行动计划**:
1. HR 核实零保费业务员状态（休假/离职/其他）
2. 对在职低产能业务员进行专项辅导
3. 设立"最快进步奖"激励低产能业务员
4. 建立淘汰机制（连续 3 个月低产能予以调岗）

**预期效果**: 降低无效人力成本，提升整体人均产能

---

## 📎 附录

### A. SQL 查询语句集合

所有报告使用的 SQL 查询语句均可在浏览器控制台执行：

```javascript
// 示例：查询本周 Top 10 业务员
const result = await window.duckdb.query(`
  SELECT
      业务员,
      三级机构,
      COUNT(*) as policy_count,
      SUM(保费) as total_premium,
      AVG(保费) as avg_premium
  FROM PolicyFact
  WHERE CAST(签单日期 AS DATE) BETWEEN '2025-12-09' AND '2025-12-15'
  GROUP BY 业务员, 三级机构
  ORDER BY total_premium DESC
  LIMIT 10
`);
console.table(result);
```

详细 SQL 查询见本命令文档的各分析章节。

### B. 数据字典

| 字段名 | 字段说明 | 数据类型 | 示例值 |
|--------|---------|---------|--------|
| 保单号 | 唯一保单编号 | STRING | 6102101030120250001234 |
| 业务员 | 业务员姓名 | STRING | 张三 |
| 三级机构 | 三级机构名称 | STRING | 成都市本级 |
| 签单日期 | 保单签单日期 | DATE | 2025-12-10 |
| 保险起期 | 保险生效日期 | DATE | 2025-12-15 |
| 保费 | 保费金额（元） | DECIMAL | 1234.56 |
| 险类 | 险类类型 | STRING | 车险 |
| 险别组合 | 险别组合类型 | STRING | 主全 / 交三 / 单交 |
| 是否续保 | 是否续保标志 | STRING | 是 / 否 |
| 是否可续 | 是否可续保标志 | STRING | 是 / 否 |
| 是否新能源 | 是否新能源车 | STRING | 是 / 否 |
| 批改类型 | 批改类型 | STRING | 16退保 / 51车辆过户 |
| 是否过户车 | 是否过户车辆 | STRING | 是 / 否 |
| 吨位分段 | 营业货车吨位分段 | STRING | 2吨以下 |

### C. 报告说明

**报告周期**: 自然周（周日至周六）
**数据来源**: 车险清单截至20260108.parquet
**生成时间**: 2025-12-16 10:30
**报告类型**: 董事会级业务洞察周报
**更新频率**: 每周一次

---

**报告完成** ✅
```

---

## 输出要求

1. **Markdown 格式**: 所有输出使用 GitHub Flavored Markdown
2. **表格对齐**: 所有表格使用管道符 `|` 对齐
3. **数值格式**:
   - 金额: 保留 2 位小数，添加千分位分隔符（¥1,234.56）
   - 百分比: 保留 1 位小数（38.2%）
   - 件均: 保留整数（¥774）
4. **趋势标记**: 使用 ⬆️ ⬇️ ➡️ 标记趋势
5. **风险等级**: 使用 🔴 🟡 🟢 标记风险等级
6. **章节图标**: 使用 emoji 增强可读性

---

## 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| 数据未加载 | 提示先在浏览器打开应用并上传 Parquet 文件 |
| SQL 执行失败 | 显示详细错误信息，提供修正建议 |
| 时间范围无数据 | 提示选择有效的时间范围 |
| 数据异常值 | 标注异常值，继续生成报告 |

---

## 技术实现

**与传统报告工具的区别**:
- ✅ 不生成 PPT/Excel，输出 Markdown 报告
- ✅ 不使用 pandas，使用 DuckDB SQL
- ✅ 在浏览器中执行，无需后端服务
- ✅ 实时分析，无需等待文件生成
- ✅ SQL 可复制，便于验证和调试

**执行位置**:
1. 打开 http://localhost:5173/
2. 上传车险清单 Parquet 文件
3. 在浏览器 Console 执行分析 SQL
4. 或使用本命令生成完整周报

---

现在请开始执行周报生成流程。
