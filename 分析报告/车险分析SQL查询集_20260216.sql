-- ============================================
-- 车险数据深度分析 SQL 查询集
-- 生成时间: 2026-02-16
-- 数据源: PolicyFact 视图
-- 用法: 通过 /api/query/custom 端点执行
-- ============================================

-- ============================================
-- 1. 数据概览 (Data Profiling)
-- ============================================

-- 1.1 数据全景
SELECT
    COUNT(*) AS "总记录数",
    COUNT(DISTINCT policy_no) AS "唯一保单数",
    COUNT(DISTINCT salesman_name) AS "业务员数",
    COUNT(DISTINCT org_level_3) AS "机构数",
    ROUND(SUM(premium) / 10000, 2) AS "总保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    MIN(CAST(policy_date AS VARCHAR)) AS "起始日期",
    MAX(CAST(policy_date AS VARCHAR)) AS "结束日期"
FROM PolicyFact;

-- 1.2 字段完整性检查
SELECT
    COUNT(*) AS "总行数",
    SUM(CASE WHEN policy_no IS NULL THEN 1 ELSE 0 END) AS "保单号缺失",
    SUM(CASE WHEN premium IS NULL THEN 1 ELSE 0 END) AS "保费缺失",
    SUM(CASE WHEN salesman_name IS NULL OR salesman_name = '' THEN 1 ELSE 0 END) AS "业务员缺失",
    SUM(CASE WHEN org_level_3 IS NULL OR org_level_3 = '' THEN 1 ELSE 0 END) AS "机构缺失",
    SUM(CASE WHEN policy_date IS NULL THEN 1 ELSE 0 END) AS "日期缺失",
    SUM(CASE WHEN is_renewal IS NULL THEN 1 ELSE 0 END) AS "续保标识缺失",
    SUM(CASE WHEN is_renewable IS NULL THEN 1 ELSE 0 END) AS "可续保标识缺失"
FROM PolicyFact;

-- 1.3 保费分布百分位数
SELECT
    ROUND(MIN(premium), 2) AS "最小值",
    ROUND(percentile_cont(0.05) WITHIN GROUP (ORDER BY premium), 2) AS "P5",
    ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY premium), 2) AS "P25",
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY premium), 2) AS "中位数",
    ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY premium), 2) AS "P75",
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY premium), 2) AS "P95",
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY premium), 2) AS "P99",
    ROUND(MAX(premium), 2) AS "最大值"
FROM PolicyFact;

-- ============================================
-- 2. 业绩排名与分布
-- ============================================

-- 2.1 Top 30 业务员多维度排名
SELECT
    salesman_name AS "业务员",
    org_level_3 AS "机构",
    COUNT(DISTINCT policy_no) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "总保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "续保率%",
    ROUND(SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "新能源占比%",
    ROUND(SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "新车占比%"
FROM PolicyFact
WHERE policy_date >= '2025-01-01'
GROUP BY salesman_name, org_level_3
ORDER BY SUM(premium) DESC
LIMIT 30;

-- 2.2 业务员保费区间分布
WITH agent_premium AS (
    SELECT salesman_name, SUM(premium) AS total_premium
    FROM PolicyFact
    GROUP BY salesman_name
)
SELECT
    CASE
        WHEN total_premium < 500000 THEN '< 50万'
        WHEN total_premium < 1000000 THEN '50-100万'
        WHEN total_premium < 2000000 THEN '100-200万'
        WHEN total_premium < 5000000 THEN '200-500万'
        ELSE '>= 500万'
    END AS "保费区间",
    COUNT(*) AS "业务员数",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "占比%"
FROM agent_premium
GROUP BY 1
ORDER BY 1;

-- 2.3 各机构全维度对比
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "总保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    COUNT(DISTINCT salesman_name) AS "业务员数",
    ROUND(SUM(premium) / COUNT(DISTINCT salesman_name) / 10000, 2) AS "人均保费(万)",
    ROUND(SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "续保率%",
    ROUND(SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "新能源占比%",
    ROUND(SUM(CASE WHEN is_telemarketing THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "电销占比%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY SUM(premium) DESC;

-- ============================================
-- 3. 时间趋势分析
-- ============================================

-- 3.1 月度业绩趋势
WITH monthly AS (
    SELECT
        strftime(CAST(policy_date AS DATE), '%Y-%m') AS "月份",
        COUNT(DISTINCT policy_no) AS "保单数",
        SUM(premium) AS "总保费",
        AVG(premium) AS "件均保费"
    FROM PolicyFact
    GROUP BY 1
)
SELECT
    "月份",
    "保单数",
    ROUND("总保费" / 10000, 2) AS "总保费(万)",
    ROUND("件均保费", 2) AS "件均保费",
    LAG("保单数") OVER (ORDER BY "月份") AS "上月保单数",
    ROUND(("保单数" - LAG("保单数") OVER (ORDER BY "月份")) * 100.0 /
        NULLIF(LAG("保单数") OVER (ORDER BY "月份"), 0), 2) AS "件数环比%",
    ROUND(("总保费" - LAG("总保费") OVER (ORDER BY "月份")) * 100.0 /
        NULLIF(LAG("总保费") OVER (ORDER BY "月份"), 0), 2) AS "保费环比%"
FROM monthly
ORDER BY "月份" DESC;

-- 3.2 周度趋势（最近12周）
SELECT
    date_trunc('week', CAST(policy_date AS DATE)) AS "周起始日",
    COUNT(DISTINCT policy_no) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "总保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费"
FROM PolicyFact
GROUP BY 1
ORDER BY 1 DESC
LIMIT 12;

-- ============================================
-- 4. 四象限分析（业务员分层）
-- ============================================

-- 4.1 业务员四象限分类
WITH agent_metrics AS (
    SELECT
        salesman_name,
        org_level_3,
        SUM(premium) AS total_premium,
        COUNT(DISTINCT policy_no) AS policy_count,
        AVG(premium) AS avg_premium
    FROM PolicyFact
    WHERE policy_date >= '2025-01-01'
    GROUP BY salesman_name, org_level_3
),
thresholds AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_premium) AS median_premium,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY policy_count) AS median_count
    FROM agent_metrics
)
SELECT
    m.salesman_name AS "业务员",
    m.org_level_3 AS "机构",
    ROUND(m.total_premium / 10000, 2) AS "总保费(万)",
    m.policy_count AS "保单数",
    ROUND(m.avg_premium, 2) AS "件均保费",
    CASE
        WHEN m.total_premium >= t.median_premium AND m.policy_count >= t.median_count
            THEN 'Q1-明星业务员'
        WHEN m.total_premium >= t.median_premium AND m.policy_count < t.median_count
            THEN 'Q2-大单专家'
        WHEN m.total_premium < t.median_premium AND m.policy_count < t.median_count
            THEN 'Q3-新手待培养'
        ELSE 'Q4-效率待提升'
    END AS "象限"
FROM agent_metrics m
CROSS JOIN thresholds t
ORDER BY m.total_premium DESC;

-- 4.2 各象限统计汇总
WITH agent_metrics AS (
    SELECT salesman_name, SUM(premium) AS total_premium, COUNT(*) AS policy_count
    FROM PolicyFact WHERE policy_date >= '2025-01-01' GROUP BY salesman_name
),
thresholds AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_premium) AS median_premium,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY policy_count) AS median_count
    FROM agent_metrics
)
SELECT
    CASE
        WHEN total_premium >= median_premium AND policy_count >= median_count THEN 'Q1-明星业务员'
        WHEN total_premium >= median_premium AND policy_count < median_count THEN 'Q2-大单专家'
        WHEN total_premium < median_premium AND policy_count < median_count THEN 'Q3-新手待培养'
        ELSE 'Q4-效率待提升'
    END AS "象限",
    COUNT(*) AS "业务员数",
    ROUND(SUM(total_premium) / 10000, 2) AS "总保费(万)",
    ROUND(AVG(policy_count), 2) AS "平均保单数",
    ROUND(SUM(total_premium) * 100.0 / SUM(SUM(total_premium)) OVER (), 2) AS "保费贡献%"
FROM agent_metrics
CROSS JOIN thresholds
GROUP BY 1
ORDER BY SUM(total_premium) DESC;

-- ============================================
-- 5. 续保与可续保分析
-- ============================================

-- 5.1 续保状态交叉分析
SELECT
    CASE WHEN is_renewal THEN '是' ELSE '否' END AS "是否续保",
    CASE WHEN is_renewable THEN '是' ELSE '否' END AS "是否可续",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "占比%"
FROM PolicyFact
GROUP BY 1, 2
ORDER BY 1 DESC, 2 DESC;

-- 5.2 各机构续保率对比
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "总保单",
    SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) AS "续保数",
    SUM(CASE WHEN is_renewable THEN 1 ELSE 0 END) AS "可续保数",
    ROUND(SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "续保率%",
    ROUND(SUM(CASE WHEN is_renewable THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "可续保率%",
    ROUND(SUM(CASE WHEN is_renewable AND NOT is_renewal THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN is_renewable THEN 1 ELSE 0 END), 0), 2) AS "续保潜力%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "续保率%" DESC;

-- 5.3 续保保费贡献分析
SELECT
    CASE WHEN is_renewal THEN '续保' ELSE '新保' END AS "业务类型",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(SUM(premium) * 100.0 / SUM(SUM(premium)) OVER (), 2) AS "保费贡献%"
FROM PolicyFact
GROUP BY 1
ORDER BY SUM(premium) DESC;

-- ============================================
-- 6. 险类与险别组合分析
-- ============================================

-- 6.1 险类分布
SELECT
    insurance_type AS "险类",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "保单占比%",
    ROUND(SUM(premium) * 100.0 / SUM(SUM(premium)) OVER (), 2) AS "保费占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY SUM(premium) DESC;

-- 6.2 险别组合分布
SELECT
    coverage_combination AS "险别组合",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "保单占比%",
    ROUND(SUM(premium) * 100.0 / SUM(SUM(premium)) OVER (), 2) AS "保费占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY COUNT(*) DESC;

-- 6.3 统保类型分布
SELECT
    is_commercial_insure AS "统保类型",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY COUNT(*) DESC;

-- ============================================
-- 7. 新能源与新车分析
-- ============================================

-- 7.1 新能源车险分析
SELECT
    CASE WHEN is_nev THEN '新能源' ELSE '传统' END AS "动力类型",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "保单占比%",
    ROUND(SUM(premium) * 100.0 / SUM(SUM(premium)) OVER (), 2) AS "保费占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY SUM(premium) DESC;

-- 7.2 各机构新能源渗透率
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "总保单",
    SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) AS "新能源保单",
    ROUND(SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "新能源占比%",
    ROUND(SUM(CASE WHEN is_nev THEN premium ELSE 0 END) / 10000, 2) AS "新能源保费(万)"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "新能源占比%" DESC;

-- 7.3 新车 vs 旧车 × 新能源 vs 传统
SELECT
    CASE WHEN is_new_car THEN '新车' ELSE '旧车' END AS "车辆类型",
    CASE WHEN is_nev THEN '新能源' ELSE '传统' END AS "动力类型",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费"
FROM PolicyFact
GROUP BY 1, 2
ORDER BY COUNT(*) DESC;

-- ============================================
-- 8. 客户类别与渠道分析
-- ============================================

-- 8.1 客户类别分布
SELECT
    customer_category AS "客户类别",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY SUM(premium) DESC;

-- 8.2 渠道（终端来源）分布
SELECT
    terminal_source AS "渠道代码",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS "占比%"
FROM PolicyFact
GROUP BY 1
ORDER BY COUNT(*) DESC;

-- 8.3 电销业务分析
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "总保单",
    SUM(CASE WHEN is_telemarketing THEN 1 ELSE 0 END) AS "电销保单",
    ROUND(SUM(CASE WHEN is_telemarketing THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "电销占比%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "电销占比%" DESC;

-- ============================================
-- 9. 营业货车专项分析
-- ============================================

-- 9.1 营业货车吨位分段分析
SELECT
    tonnage_segment AS "吨位分段",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(AVG(premium), 2) AS "件均保费"
FROM PolicyFact
WHERE customer_category = '营业货车'
GROUP BY 1
ORDER BY
    CASE tonnage_segment
        WHEN '1吨以下' THEN 1
        WHEN '1-2吨' THEN 2
        WHEN '2-9吨' THEN 3
        WHEN '9-10吨' THEN 4
        WHEN '10吨以上' THEN 5
        ELSE 6
    END;

-- ============================================
-- 10. 商车自主定价系数分析
-- ============================================

-- 10.1 机构商车系数对比
SELECT
    CASE
        WHEN org_level_3 IN ('天府', '高新', '青羊', '武侯', '新都') THEN '成都地区'
        ELSE '异地机构'
    END AS "机构分组",
    COUNT(*) AS "商业险保单数",
    ROUND(AVG(commercial_pricing_factor), 4) AS "平均系数",
    ROUND(SUM(premium) / SUM(premium / NULLIF(commercial_pricing_factor, 0)), 4) AS "NCD系数"
FROM PolicyFact
WHERE insurance_type = '商业保险'
  AND commercial_pricing_factor IS NOT NULL
  AND commercial_pricing_factor > 0
GROUP BY 1
ORDER BY "平均系数";

-- ============================================
-- 11. 成本分析
-- ============================================

-- 11.1 机构赔付率分析
SELECT
    org_level_3 AS "机构",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(SUM(COALESCE(reported_claims, 0)) / 10000, 2) AS "已报告赔款(万)",
    ROUND(SUM(COALESCE(reported_claims, 0)) / NULLIF(SUM(premium), 0) * 100, 2) AS "赔付率%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "赔付率%" DESC;

-- 11.2 机构费用率分析
SELECT
    org_level_3 AS "机构",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    ROUND(SUM(COALESCE(fee_amount, 0)) / 10000, 2) AS "费用金额(万)",
    ROUND(SUM(COALESCE(fee_amount, 0)) / NULLIF(SUM(premium), 0) * 100, 2) AS "费用率%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "费用率%" DESC;

-- ============================================
-- 12. 异常检测
-- ============================================

-- 12.1 负保费保单（退保）
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "退保数",
    ROUND(SUM(premium), 2) AS "退保金额合计"
FROM PolicyFact
WHERE premium < 0
GROUP BY org_level_3
ORDER BY SUM(premium) ASC;

-- 12.2 单日异常出单检测
SELECT
    CAST(policy_date AS VARCHAR) AS "日期",
    COUNT(*) AS "保单数",
    ROUND(SUM(premium) / 10000, 2) AS "保费(万)",
    COUNT(DISTINCT salesman_name) AS "涉及业务员数"
FROM PolicyFact
GROUP BY policy_date
HAVING COUNT(*) > (
    SELECT AVG(daily_count) * 2
    FROM (SELECT COUNT(*) AS daily_count FROM PolicyFact GROUP BY policy_date)
)
ORDER BY COUNT(*) DESC
LIMIT 10;

-- ============================================
-- 13. 过户车业务分析
-- ============================================

-- 13.1 各机构过户车业务
SELECT
    org_level_3 AS "机构",
    SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS "过户车数",
    ROUND(SUM(CASE WHEN is_transfer THEN premium ELSE 0 END) / 10000, 2) AS "过户车保费(万)",
    ROUND(SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "过户车占比%"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "过户车数" DESC;

-- ============================================
-- 14. 交叉销售分析
-- ============================================

-- 14.1 交叉销售概况
SELECT
    org_level_3 AS "机构",
    COUNT(*) AS "总保单",
    SUM(CASE WHEN is_cross_sell THEN 1 ELSE 0 END) AS "交叉销售保单",
    ROUND(SUM(CASE WHEN is_cross_sell THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS "交叉销售率%",
    ROUND(SUM(COALESCE(cross_sell_premium_driver, 0)) / 10000, 2) AS "驾意险保费(万)"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "交叉销售率%" DESC;
