---
name: incident-rate-development
description: 出险率发展三角形分析 — 按客户类别/燃料/险别等维度，构建等发展天数出险率+案均+赔付率三角形，支持同比和趋势判断
version: 1.0.0
---

# 出险率发展三角形分析

## 1. 分析需求模式识别

用户的需求可以抽象为一个通用模式：

```
给定一批保单（按时间段 × 维度筛选），
追踪它们在不同发展阶段（N天后）的出险情况，
纵向对比不同年份同阶段的差异。
```

**触发关键词**: "出险率同比"、"发展三角形"、"不满期对比"、"等天数出险率"、"赔案发展"

## 2. 口径框架

### 标准口径：日历发展（默认，必须优先使用）

发展月 M_N 的观察窗口 = [年初, 年初+N个月)，累计扩展：
- M1: 起保+出险都在1月 → M2: 都在1-2月 → M12: 全年
- M13~M24: 保单固定为全年，出险窗口继续向次年扩展
- 保单范围：起保日在窗口内（M≤12逐月扩大，M>12为全年保单）
- 赔案范围：出险时间在窗口内 & 保单在窗口内
- 已赚保费 = 保费 × min(起保日到窗口末端天数, 保险期间) / 保险期间

参考实现：`moto_loss_ratio_development.py`、`server/src/sql/claims-detail.ts:generateLossRatioDevelopmentQuery()`

### 辅助口径：等天数里程碑（仅用于季度内精细对比）

| 参数 | 含义 | 示例 |
|------|------|------|
| `起保期` | 哪些保单纳入分析 | Q1(1-3月)、H1(1-6月)、全年 |
| `截断方式` | 如何定义"同口径" | 等天数(60/120/180/240/300/365天) |
| `里程碑` | 观察哪些发展节点 | 60/120/180/240/300/365(满期) |

### 选择2: 分子定义

| 方式 | 公式 | 适用场景 |
|------|------|---------|
| 出险率 | 有出险保单数 / 总保单数 | 频率分析 |
| 赔案频度 | 赔案总件数 / 总保单数 | 多次出险分析 |
| 赔付率 | 赔款总额 / 保费总额 | 盈亏分析 |

### 选择3: 维度切片

| 维度 | 字段 | 典型切片 |
|------|------|---------|
| 客户类别 | `customer_category` | 非营业个人客车、摩托车、营业货车 |
| 险别组合 | `coverage_combination` | 单交、交三、主全 |
| 吨位 | `tonnage_segment` | 10吨以上(牵引车) |
| 燃料 | `fuel_type` | 柴油、天然气 |
| 机构 | `org_level_3` | 天府、高新、宜宾... |
| 新车/续保 | `is_new_car` / `is_renewal` | 新车 vs 续保 |
| 新能源 | `is_nev` | 燃油 vs 新能源 |

## 3. SQL 模板

### 核心 CTE 结构

```sql
-- Step 1: 筛选目标保单
WITH target_policies AS (
    SELECT DISTINCT policy_no, insurance_start_date, premium,
           YEAR(insurance_start_date) AS yr,
           QUARTER(insurance_start_date) AS qtr
    FROM PolicyFact  -- 或 read_parquet(...)
    WHERE {维度筛选条件}
      AND {起保期条件}  -- e.g. MONTH(insurance_start_date) BETWEEN 1 AND 3
),

-- Step 2: 关联赔案，计算发展天数
claims AS (
    SELECT t.yr, t.qtr, t.policy_no, c.claim_no,
           c.reserve_amount, c.is_bodily_injury,
           DATEDIFF('day', t.insurance_start_date, c.accident_time) AS dev_days
    FROM target_policies t
    JOIN ClaimsDetail c ON t.policy_no = c.policy_no
    WHERE c.accident_time >= t.insurance_start_date  -- 排除起保前出险
),

-- Step 3: 统计各里程碑
policy_counts AS (
    SELECT yr, qtr, COUNT(DISTINCT policy_no) AS total,
           ROUND(SUM(premium)/1e4, 0) AS prem_wan,
           DATEDIFF('day', MAX(insurance_start_date), CURRENT_DATE) AS max_dev
    FROM target_policies GROUP BY yr, qtr
),

milestones AS (
    SELECT yr, qtr, milestone,
           COUNT(DISTINCT policy_no) AS claim_p,     -- 出险保单数
           COUNT(*) AS claim_n,                       -- 赔案件数
           ROUND(AVG(reserve_amount), 0) AS avg_amt,  -- 案均
           ROUND(SUM(reserve_amount)/1e4, 0) AS loss_wan  -- 赔款
    FROM claims
    CROSS JOIN (VALUES (60),(120),(180),(240),(300),(365)) AS t(milestone)
    WHERE dev_days <= milestone
    GROUP BY yr, qtr, milestone
)

-- Step 4: 透视输出（按窗口可用性截断）
SELECT
    pc.yr || 'Q' || pc.qtr AS 季度,
    pc.total AS 保单数,
    -- 出险率: CASE WHEN max_dev >= N THEN claim_p*100.0/total END
    -- 案均:   CASE WHEN max_dev >= N THEN avg_amt END
    -- 赔付率: CASE WHEN max_dev >= N THEN loss_wan*100.0/prem_wan END
FROM policy_counts pc
LEFT JOIN milestones m ON pc.yr = m.yr AND pc.qtr = m.qtr
GROUP BY ...
ORDER BY pc.yr, pc.qtr
```

### 关键设计决策

1. **`max_dev` 截断**: 通过 `DATEDIFF(MAX(insurance_start_date), CURRENT_DATE)` 判断该批保单的最大可用发展天数，窗口未关闭则输出 `—`，避免不公平对比
2. **`CROSS JOIN VALUES`**: 一次查询输出所有里程碑，避免多次扫表
3. **`DISTINCT policy_no`**: 出险率以保单去重（一个保单多次出险只算一次），赔案件数不去重

## 4. 分析流程（用户交互步骤）

```
1. 用户提出需求 → 识别"发展三角形"模式
2. 确认口径三选择:
   - 哪批保单？(起保期 + 维度)
   - 观察什么？(出险率 / 赔付率 / 案均)
   - 里程碑？(默认 6×60天，或用户指定)
3. 执行基础盘点:
   - 各批次保单量
   - 可用发展天数（判断哪些窗口已关闭）
   - 赔案匹配率
4. 输出三角形表格
5. 纵向对比 → 提取趋势信号
6. （可选）追加维度切片 → 定位风险来源
```

## 5. 迁移到其他客户类别的检查清单

将此分析迁移到新的客户类别时，检查以下项：

| 检查项 | 说明 |
|--------|------|
| 保单量是否足够 | 每批次 < 50 单统计意义弱，提示用户 |
| 保险期限是否统一 | 车险通常 365 天，但短期险/临时牌需调整满期定义 |
| 维度字段是否可用 | `fuel_type` 仅 2024+ 有值，旧数据为 NULL |
| 赔案匹配率 | JOIN 命中率 < 90% 需排查（历史保单可能不在当前 parquet 中） |
| 季节性 | 货车 Q2/Q4 量大（年审周期），摩托车夏季高，需注意基数效应 |
| 大案敏感性 | 样本少时一个大案拉高案均，建议同时看中位数 |

### 已验证可迁移的维度组合

| 客户类别 | 二级切片 | 保单量级 | 备注 |
|---------|---------|:---:|------|
| 非营业个人客车 | 险别(单交/交三/主全) | 万级 | ✅ 已验证 |
| 非营业个人客车 | 新能源/燃油 | 万级 | 待验证 |
| 营业货车-10t+ | 柴油/天然气 | 千级 | ✅ 已验证 |
| 摩托车 | — | 万级 | ✅ 已验证，但 fuel_type 单一 |
| 营业出租租赁 | — | 百级 | ⚠️ 量太小，波动大 |
| 非营业货车 | 吨位分段 | 万级 | 待验证 |
| 营业货车-其他吨位 | 吨位分段 | 千~万级 | 待验证 |

## 6. 产出物规范

分析完成后应生成:

1. **MD 报告**: `数据管理/数据分析报告/出险率发展分析_{客户类别}_{日期}.md`
2. **包含内容**:
   - 口径定义（精确到 SQL 层面）
   - 出险率三角形（表格）
   - 案均赔款三角形（表格）
   - 赔付率三角形（当保费数据可用时）
   - 纵向同比趋势提取
   - 关键结论和预警信号

## 7. 本轮分析的做法复盘

| 步骤 | 做了什么 | 为什么 |
|------|---------|--------|
| 基础盘点 | Q1保单×赔案匹配、dev_days 分布 | 确认数据可用性和对齐方式 |
| 两种方法对比 | 日历截断 vs 等天数 | 让用户选择口径 |
| 总览 → 细分 | 先5类总览 → 聚焦牵引车 | 从宽到窄，定位风险 |
| 三角形 | 出险率 + 案均 | 频率和严重程度两个维度 |
| 维度下钻 | 柴油 vs 天然气 | 用户关注的对比维度 |
| 加赔付率 | 保费/赔款/件均 | 回到经营视角（赚不赚钱） |
| 地理+省外 | 出险地分布+高速占比 | 解释风险差异的原因 |
| 影响预估 | 2025起保→2026经营 | 面向决策的前瞻分析 |
