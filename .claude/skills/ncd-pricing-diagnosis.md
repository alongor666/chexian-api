---
name: ncd-pricing-diagnosis
description: NCD 定价诊断 — 横向分析商业/交强 NCD 档位的赔付表现与折扣扭曲，识别应提系数/健康/结构性风险三类；与 incident-rate-development(纵向发展) 形成互补。Use when 用户说"NCD 诊断/无赔款优待定价/NCD 档位赔付分析"时。
version: 1.1.0
---

# NCD 定价诊断技能

## 1. 技能定位与互补关系

| 技能 | 轴向 | 问"什么" | 输出 |
| ---- | ---- | -------- | ---- |
| **ncd-pricing-diagnosis**（本技能） | 横向 · 定价结构 | 同时段，不同 NCD 档的定价是否扭曲？真实风险分层是否有效？ | NCD 档 × 指标透视表 + 定价建议 |
| `incident-rate-development` | 纵向 · 时间发展 | 同维度，不同年份的发展速度对比 | 三角形（出险率/案均/赔付率） |

**典型组合**：先用本技能判出"0.8 档应提系数"，再用 development 查"0.8 档的出险率近年是否恶化"。

**触发关键词**：
- "NCD 定价"、"系数诊断"、"应提系数"、"定价扭曲"、"归一赔付率"
- "商业险 NCD 档"、"交强险 NCD 档"、"A0/A1/A2 档"
- "哪个档赔付率过高"、"折扣是否合理"

## 2. 核心口径

### 2.1 保单单位：车辆-起期

商业险和交强险是**两张不同 policy_no** 的保单，但同属一个车辆的一次承保。用 `(vehicle_frame_no, insurance_start_date)` 聚合为"车辆-起期"唯一单位。

### 2.2 主全识别

```sql
HAVING MAX(CASE WHEN insurance_type='商业保险' THEN 1 ELSE 0 END) = 1
   AND MAX(CASE WHEN insurance_type='交强险' THEN 1 ELSE 0 END) = 1
```

只有同时含商业+交强的车辆-起期才是"主全"。

### 2.3 NCD 档位

**商业险 NCD（监管强制 10 档，各公司统一，不可自主选择）**：
`0.5 / 0.6 / 0.7 / 0.8 / 1.0 / 1.2 / 1.4 / 1.6 / 1.8 / 2.0`（**无 0.9 档**）

**交强险 NCD（2026-04-23 用户确认权威表）**：

| 档位 | 描述 | 浮动系数 |
| ---- | ---- | -------- |
| A0 | 首年/初始基准 | **1.0** |
| A1 | 上年未出险 | 0.9 |
| A2 | 上两年未出险 | 0.8 |
| A3 | 上三年及以上未出险 | 0.7 |
| A4 | 上年 1 次有责不涉死 | **1.0** |
| A5 | 上年 2+ 次有责事故 | 1.1 |
| A6 | 上年有责致死 | 1.3 |

**禁忌**：A0 和 A4 系数都是 1.0 但档位含义相反（首年 vs 有责一次），SQL CASE WHEN 中必须保留原字符串档位，不能按系数聚合。

### 2.4 双口径赔付率

**整体口径（全历史已满期）**：
```sql
WHERE insurance_end_date < CURRENT_DATE
实际赔付率 = SUM(赔款) / SUM(签单保费)
```

**满期口径（含未满期近年数据）**：
```sql
policy_term = DATEDIFF('day', 起保日, 起保日 + INTERVAL 1 YEAR)  -- 365/366
earned_days = LEAST(DATEDIFF('day', 起保日, CURRENT_DATE), policy_term)
earned_premium = premium × earned_days / policy_term

满期赔付率 = SUM(赔款) / SUM(earned_premium)
年化出险率 = SUM(有赔 × policy_term / earned_days) / 保单数
```

### 2.5 归一赔付率（诊断工具）

```sql
归一满期赔付率 = SUM(赔款) / SUM(交强满期保费 + 商业满期保费 / 自主系数)
```

**诊断逻辑**：

| 对比 | 判读 |
|------|------|
| 归一 >> 实际 | 系数偏低（折扣过大），真实风险被掩盖 |
| 归一 << 实际 | 系数偏高（加费过重），实际风险没那么差 |
| 归一 ≈ 实际 | 系数≈1，定价中性 |

**禁忌**：不说"归一是应有赔付率"。归一是**诊断工具**，用于分离"真实风险底色"与"定价扭曲"。

### 2.6 过户车选项（关键，影响 1.0 档诊断）

**过户车机制**：过户后的车辆，首年商业 NCD 被监管强制设为 1.0（无历史记录可参考），与"真正的 NCD=1"（首年新车/主动满期无赔付）在档位上合并，但风险特征迥异。

**何时剔除 `is_transfer = FALSE`**：
- 分析"商业 NCD 定价折扣是否合理"时必须剔除，否则 1.0 档会被污染
- 典型案例：四川个人客车 24-05 至今口径中，过户车占 1.0 档 34.4%，剔除后 1.0 档满期赔付率从 71.34% 降至 65.04%（🔴 → 🟡）

**何时保留过户车**：
- 分析"整体主全业务健康度"时保留（过户车也是实际承保组合）
- 需单独画过户车客群的风险画像时

**推荐做法**：默认剔除过户车做 NCD 档诊断，作为独立维度单独建"过户车专项"报告。

## 3. SQL 模板

### 3.1 基础筛选 + 车辆聚合 + NCD 解析

```sql
-- Step 1: 筛选 + 满期计算
CREATE OR REPLACE VIEW F AS
SELECT *,
  DATEDIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
  LEAST(
    GREATEST(DATEDIFF('day', insurance_start_date, CURRENT_DATE), 0),
    DATEDIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR)
  ) AS earned_days
FROM read_parquet('{POLICY_PATH}', union_by_name=true)
WHERE insurance_start_date >= DATE '{START}' AND insurance_start_date <= CURRENT_DATE
  AND is_nev = FALSE                      -- 燃油(非新能源)
  AND customer_category = '非营业个人客车'   -- 可替换维度
  AND coverage_combination = '主全'          -- 主全口径
  -- AND is_transfer = FALSE               -- 过户车选项（见 §2.6）
  -- AND org_level_3 = '宜宾'               -- 可选三级机构
;

-- Step 2: 车辆-起期聚合 + NCD 档位解析
CREATE OR REPLACE VIEW U AS
SELECT 
  vehicle_frame_no, insurance_start_date,
  -- 商业 NCD 档位
  MAX(CASE WHEN insurance_type='商业保险' THEN 
    CASE 
      WHEN TRY_CAST(NULLIF(commercial_ncd,'NaN') AS DOUBLE) IN (0.5,0.6,0.7,0.8,1.0,1.2,1.4,1.6,1.8,2.0)
        THEN CAST(TRY_CAST(NULLIF(commercial_ncd,'NaN') AS DOUBLE) AS VARCHAR)
      ELSE NULL END
  END) AS c_ncd_band,
  -- 交强 NCD 档位（保留原字符串档位 A0-A6，不按系数聚合）
  MAX(CASE WHEN insurance_type='交强险' THEN 
    CASE WHEN compulsory_ncd LIKE 'A0%' THEN 'A0'
         WHEN compulsory_ncd LIKE 'A1%' THEN 'A1'
         WHEN compulsory_ncd LIKE 'A2%' THEN 'A2'
         WHEN compulsory_ncd LIKE 'A3%' THEN 'A3'
         WHEN compulsory_ncd LIKE 'A4%' THEN 'A4'
         WHEN compulsory_ncd LIKE 'A5%' THEN 'A5'
         WHEN compulsory_ncd LIKE 'A6%' THEN 'A6'
         ELSE NULL END
  END) AS p_ncd_band,
  MAX(CASE WHEN insurance_type='商业保险' THEN TRY_CAST(commercial_pricing_factor AS DOUBLE) END) AS factor,
  MAX(earned_days) AS earned_days,
  MAX(policy_term) AS policy_term,
  SUM(CASE WHEN insurance_type='商业保险' THEN premium ELSE 0 END) AS prem_comm,
  SUM(CASE WHEN insurance_type='交强险' THEN premium ELSE 0 END) AS prem_compul,
  SUM(CASE WHEN insurance_type='商业保险' THEN premium * earned_days / NULLIF(policy_term,0) ELSE 0 END) AS earned_prem_comm,
  SUM(CASE WHEN insurance_type='交强险' THEN premium * earned_days / NULLIF(policy_term,0) ELSE 0 END) AS earned_prem_compul,
  MAX(CASE WHEN insurance_type='商业保险' THEN 1 ELSE 0 END) AS has_comm,
  MAX(CASE WHEN insurance_type='交强险' THEN 1 ELSE 0 END) AS has_compul
FROM F
GROUP BY vehicle_frame_no, insurance_start_date
HAVING has_comm=1 AND has_compul=1
;

-- Step 3: 赔案关联
CREATE OR REPLACE VIEW CA AS
SELECT f.vehicle_frame_no, f.insurance_start_date, f.insurance_type, c.claim_no,
  -- 对齐项目 SSOT：剔除无责/零结/注销/拒赔；已结取已决赔款，否则取立案金额
  CASE
    WHEN COALESCE(c.liability_ratio, 100) > 0
     AND (c.case_type IS NULL OR c.case_type NOT IN ('零结', '注销', '拒赔'))
    THEN (CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
               ELSE COALESCE(c.reserve_amount, 0) END)
    ELSE 0 END AS amt
FROM F f 
JOIN read_parquet('{CLAIMS_PATH}', union_by_name=true) c ON f.policy_no = c.policy_no
WHERE COALESCE(c.settled_amount,0)+COALESCE(c.reserve_amount,0) > 0
;
```

### 3.2 商业 NCD 档位透视（主全整体）

```sql
WITH base AS (
  SELECT u.c_ncd_band AS ncd, u.vehicle_frame_no, u.insurance_start_date,
    u.prem_comm + u.prem_compul AS prem,
    u.earned_prem_comm + u.earned_prem_compul AS earned_prem,
    CASE WHEN u.factor IS NULL OR u.factor = 0 THEN NULL 
         ELSE u.earned_prem_compul + u.earned_prem_comm / u.factor END AS earned_norm,
    u.factor, u.earned_days, u.policy_term
  FROM U u WHERE u.c_ncd_band IN ('0.5','0.6','0.7','0.8','1.0')
),
claim_agg AS (
  SELECT b.ncd,
    SUM(ca.amt) AS claim,
    COUNT(DISTINCT ca.claim_no) AS ncase,
    SUM(CASE WHEN ca.claim_no IS NOT NULL 
             THEN 1.0 * b.policy_term / NULLIF(b.earned_days,0) ELSE 0 END) AS annualized_w
  FROM base b LEFT JOIN CA ca USING (vehicle_frame_no, insurance_start_date)
  GROUP BY b.ncd
)
SELECT p.ncd, COUNT(*) AS n_pol,
  SUM(p.prem) AS prem, SUM(p.earned_prem) AS earned_prem, SUM(p.earned_norm) AS earned_norm,
  AVG(p.factor) AS factor,
  c.claim, c.ncase,
  c.claim / NULLIF(SUM(p.earned_prem),0) AS earned_lr,
  c.claim / NULLIF(SUM(p.earned_norm),0) AS norm_lr,
  c.annualized_w / COUNT(*) AS incident_rate
FROM base p LEFT JOIN claim_agg c USING (ncd)
GROUP BY p.ncd, c.claim, c.ncase, c.annualized_w
ORDER BY p.ncd;
```

### 3.3 大案分布（绝对金额门槛，**推荐**）

保险赔案服从幂律（肥尾）分布：少数案件吞掉多数赔款。但**大案的定义必须用绝对金额，不用百分位**——百分位法会把 2,000 元的案件也算成"顶 40% 大案"，站不住脚。

#### A. 推荐门槛（整千整万，业务友好）

| 门槛 | 业务含义 |
|---|---|
| ≥ 5,000 元 | 非小案（排除日常小剐蹭） |
| ≥ 10,000 元 | 中案（NCD 定价档的主战场） |
| ≥ 50,000 元 | 标准大案（保险实务大案定义） |
| ≥ 80,000 元 或 ≥ 100,000 元 | 顶级大案（需承保关注） |
| ≥ 500,000 元 | 巨灾（需再保险覆盖） |

**门槛的场景化选择**：
- 非营业个人客车、摩托车 → ≥5千 / ≥1万 / ≥5万 / ≥8万
- 营业货车、牵引车 → ≥1万 / ≥5万 / ≥20万 / ≥50万（单案金额基数更大）
- 交强险 → 责任限额使单案普遍偏高，门槛可以整体上调

#### B. SQL 模板

```sql
SELECT ncd, 
  COUNT(*) AS n, SUM(amt) AS total,
  -- 赔款占比（大案吞了多少赔款）
  SUM(CASE WHEN amt >= 5000  THEN amt ELSE 0 END) / SUM(amt) AS pct_ge5k,
  SUM(CASE WHEN amt >= 10000 THEN amt ELSE 0 END) / SUM(amt) AS pct_ge10k,
  SUM(CASE WHEN amt >= 50000 THEN amt ELSE 0 END) / SUM(amt) AS pct_ge50k,
  SUM(CASE WHEN amt >= 80000 THEN amt ELSE 0 END) / SUM(amt) AS pct_ge80k,
  -- 件数占比（多少比例的案件是大案）
  SUM(CASE WHEN amt >= 50000 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS n_pct_ge50k,
  SUM(CASE WHEN amt >= 80000 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS n_pct_ge80k
FROM (
  SELECT b.ncd, ca.amt
  FROM base b JOIN CA ca USING (vehicle_frame_no, insurance_start_date)
) GROUP BY ncd ORDER BY ncd;
```

**报表列命名规范**：`≥5千 大案赔款占比` / `≥1万 大案赔款占比` / `≥5万 大案赔款占比` / `≥8万 大案赔款占比`

**避免的术语**：`≤P60` / `顶 40%` / `P80门槛`——抽象、不稳定、样本依赖。

#### C. 大案相关性诊断（**核心洞察**）

> 大案是概率事件，必然会发生。但如果持续发生在同一客户切片上，就是相关性而非偶然。

**判读逻辑**：看档位的"≥8 万赔款占比"vs 整体均值的偏离：

| 对比 | 判读 | 业务含义 |
|------|------|---------|
| 偏离 **< ±5 pp** | 符合整体分布 | 大案是随机事件，符合幂律预期 |
| **高于整体 > +5 pp** | **巨灾集中型** | 该档存在持续性巨灾风险源（车型/路段/驾驶场景），必须承保端审核 |
| **低于整体 < -5 pp** | **批量恶化型** | 赔付率上升**不是巨灾驱动**，是中小案件批量恶化，系数上调即可 |

#### D. 三类风险形态（定价-承保组合策略）

| 形态 | 特征 | 应对 |
|------|------|------|
| **批量恶化型** | 赔付率超标 + ≥8 万占比**偏低** + 案均正常 | 系数上调立即见效（折扣扭曲是主因），承保不动 |
| **巨灾集中型** | 赔付率超标 + ≥8 万占比**偏高** + 案均高 | 系数+承保双重加强（系数只能覆盖均值风险） |
| **全员偏贵型** | 赔付率中等 + ≥8 万占比符合整体 + 出险率最高 + 案均最高 | 承保筛选（不是大案问题，是高频问题） |

## 4. 亮灯与定价建议模板

### 4.1 亮灯规则

```
🔴 超警戒: 实际/满期赔付率 > 69%
🟠 临界:   65% < 实际/满期赔付率 ≤ 69%
🟡 健康:   实际/满期赔付率 ≤ 65% 且 归一赔付率 < 65%
```

### 4.2 定价建议四分类

| 类型 | 特征 | 建议 |
| ---- | ---- | ---- |
| 🔴 **应提系数** | 实际 > 69% AND 归一 < 实际 AND 差值 > 5pp AND ≥8万占比偏低 | 批量恶化型，上调 commercial_pricing_factor |
| 🟠 **加费+承保** | 实际 > 69% AND ≥8万占比 > 整体 +5pp | 巨灾集中型，既要提系数也要加承保门槛 |
| 🔵 **承保问题** | 实际 > 69% AND 归一 ≈ 实际 AND 出险率高 | 全员偏贵型，承保端筛选 |
| 🟡 **健康** | 实际 ≤ 65% | 维持现有折扣 |

## 5. 维度切片扩展

本技能默认分析"商业 NCD 5 档"，但可扩展：

| 扩展维度 | 代码改动 | 典型场景 |
| -------- | -------- | -------- |
| 交强 NCD A0-A6 | `u.p_ncd_band` 替代 `u.c_ncd_band` | 主全交强险单看 |
| 商业×交强组合矩阵 | `(u.c_ncd_band, u.p_ncd_band)` GROUP BY | 双维定价相互作用 |
| 细到三级机构 | 增加 `org_level_3` GROUP BY 列 | 地市公司定价诊断 |
| 客户类别切片 | 改 `customer_category` WHERE | 摩托车/货车诊断 |
| 年度切片（纵向） | `YEAR(insurance_start_date)` GROUP BY | 对比各年定价有效性 |

## 6. 报告输出模板

```markdown
# [第X层] [范围] × NCD 定价诊断

## 一、核心表
| NCD | 保单数 | [实际/满期]赔付率 | 归一赔付率 | 自主系数 | 件均保费 | 案均赔款 | 出险率 | ≥5千 大案赔款占比 | ≥1万 大案赔款占比 | ≥5万 大案赔款占比 | ≥8万 大案赔款占比 |

## 二、亮灯清单（按严重度排序）
- 🔴 档位 X: [现象 → 诊断 → 建议]

## 三、跨档结构性观察
- NCD 与风险强度的单调性
- 折扣扭曲的机制
- 大案分布形态（批量恶化 / 巨灾集中 / 全员偏贵）

## 四、行动建议
| 优先级 P0/P1/P2 | 对象 | 动作 | 理由 |

## 五、口径脚注
- 满期公式、归一公式、率值聚合规则、NCD 监管定义、过户车处理、大案门槛定义
```

## 7. 迁移检查清单

新场景应用本技能前必查：

- [ ] 数据路径：`policy/current/*.parquet` 和 `claims_detail/claims_YYYY.parquet`
- [ ] `insurance_type` 取值：`'商业保险'` / `'交强险'`（不是 `is_commercial_insure`）
- [ ] `is_nev` 是 BOOLEAN（`FALSE` = 燃油非新能源；避免用 `fuel_type`）
- [ ] `coverage_combination = '主全'`（其他值：`'单交'`、`'交三'`、`'未知'`）
- [ ] `is_transfer` 处理：默认剔除 `is_transfer = FALSE`（§2.6）
- [ ] `commercial_ncd` 是 VARCHAR，有 'NaN' 值，需 `TRY_CAST(NULLIF(...,'NaN') AS DOUBLE)`
- [ ] `compulsory_ncd` 可能带后缀（'A0 1.0%'、'A3'），用 `LIKE 'AX%'` 提档
- [ ] 率值必须 SUM(分子)/SUM(分母)，禁止均值/加权平均
- [ ] "21-25 年"默认整体合计，不分年；"24-05 至今"默认满期口径
- [ ] 平均暴露 < 90% 时，出险率必须年化
- [ ] 大案门槛按场景选：个人客车 `≥5千/1万/5万/8万`；货车 `≥1万/5万/20万/50万`

## 8. 首次产出（参考样例）

- `Desktop/车险NCD组合分析_20260423.md`（商业 NCD × 交强 NCD 矩阵 + 4 分类定价建议）
- `Desktop/车险NCD商业档_主全整体_20260423.md`（5 档单维诊断）
- `Desktop/车险NCD商业档_满期口径验证_20260423.md`（24-05 至今满期口径双口径对比）
- `Desktop/车险NCD_大案肥尾分析_20260423.md`（绝对金额门槛的大案相关性分析）

## 9. See Also

- `feedback_earned_formulas.md` — 满期公式闰年感知
- `feedback_earned_incident_rate.md` — 出险率年化
- `domain_normalized_loss_ratio.md` — 归一赔付率诊断逻辑
- `domain_compulsory_ncd_coefficients.md` — 交强险 NCD A0-A6 官方系数
- `project_ncd_is_mandatory.md` — NCD 监管强制性
- `project_main_coverage_three_layer_analysis.md` — 主全三层分析
- `feedback_multi_year_aggregate_not_avg.md` — 多年合计必须绝对值加总
- `feedback_rate_no_weighted_avg.md` — 率值禁加权平均
- `skill_incident_rate_development.md` — 互补技能（纵向发展）
