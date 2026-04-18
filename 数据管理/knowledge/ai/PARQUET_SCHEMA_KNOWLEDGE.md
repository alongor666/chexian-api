# Parquet 表结构与字段值域知识库

**文档性质**: AI 必读知识源（NL2SQL 语义理解基础）
**更新时间**: 2026-04-09
**数据规模**: ~354万条原始记录（含交强商业分行）/ ~150万唯一保单 / 42个 PolicyFact 字段（4 个分片 Parquet，`warehouse/fact/policy/current/`）

---

## 0. 使用说明

本文档是 AI 识别用户自然语言查询的**核心知识库**。包含：
- ✅ 完整表结构与数据类型
- ✅ 每个字段的值域范围与枚举值
- ✅ 自然语言关键词 → 字段映射
- ✅ 常见表达方式与SQL转换

**AI 必须 100% 掌握本文档内容才能准确生成 SQL**。

### ⚠️ PolicyFact 视图字段可用性（CRITICAL）

> 本文档描述的是**原始 Parquet 数据**的完整字段。但 AI SQL 生成器查询的是 **PolicyFact 视图**，该视图**不包含所有字段**。

**PolicyFact 视图可用字段** (42个)：
```
policy_no, premium, policy_date, insurance_start_date,
underwriting_date, salesman_name, org_level_3, customer_category,
insurance_type, coverage_combination, is_renewal, is_new_car,
is_transfer, is_nev, is_telemarketing, tonnage_segment,
is_renewable, is_commercial_insure, terminal_source,
commercial_pricing_factor, vehicle_frame_no, is_quote,
claim_cases, reported_claims, fee_amount, renewal_mode,
insurance_grade,
is_cross_sell, cross_sell_premium_driver,
third_party_coverage, driver_coverage, passenger_coverage,
plate_no, seat_count,
driver_age_group, first_registration_date,
fuel_type,
```

**❌ 以下字段在 PolicyFact 视图中不可用**：
| 字段 | 原因 | 替代方案 |
|------|------|----------|
| `endorsement_no` | 批单号未包含在视图 | 无 |
| `endorsement_type` | 批改类型未包含在视图 | 无 |
| `renewal_policy_no` | 仅在 PolicyFactRenewal 视图可用 | 用 `is_renewal` 布尔字段 |
| `new_vehicle_price` | 新车购置价未包含在视图 | 无 |
| `team_name` | 团队名称未包含 | 用 `salesman_name` |
| `org_level_4` | 四级机构未包含 | 用 `org_level_3` |
| `insurance_end_date` | 保险止期未包含 | 用 `insurance_start_date` |
| `region_group` | 非物理字段，由 coefficient.ts 运行时 CASE 计算 | 用 `org_level_3` + CASE 表达式 |

---

## 1. 表结构总览 (PolicyFact)

### 1.1 主键与标识字段

| 字段名 | 类型 | 说明 | 值域/格式 |
|--------|------|------|-----------|
| `policy_no` | STRING | 保单号（主键） | 22位数字，如 `6102101030120240000857` |
| `renewal_policy_no` | STRING | 续保单号 | 同上，36.4%有值（空值=非续保） |
| `endorsement_no` | STRING | 批单号 | 保单号-序号，如 `xxx-001`，1.8%有值 |
| `vehicle_frame_no` | STRING | 车架号(VIN) | 17位，28万+唯一值 |
| `insurance_grade` | STRING | 车险风险等级 | A/B/C/D/E/F/G/X，~57%有值（合并原车险分等级/小货车评分/大货车评分） |

### 1.2 日期字段

| 字段名 | 类型 | 说明 | 值域 |
|--------|------|------|------|
| `policy_date` | DATE/STRING | 签单日期（transform.py 将源数据"缴费日期"重命名为"签单日期"，前后端统一使用"签单日期"） | 2020-01-01 ~ 2026-03-28 |
| `underwriting_date` | DATE/STRING | 提核日期（源数据原"签单日期"重命名为"提核日期"） | 2020-01-01 ~ 2026-03-28 |
| `insurance_start_date` | DATE/STRING | 保险起期 | 2020-01-01 ~ 2026-03-28 |

**日期使用规则**:
- 业绩统计 → 用 `policy_date`（签单日期）
- 保险责任 → 用 `insurance_start_date`（起保日期）
- 提核/审批时间 → 用 `underwriting_date`（提核日期）
- 格式: `YYYY-MM-DD`
- Parquet 列名为"签单日期"，后端映射 policy_date，前后端统一显示为"签单日期"

### 1.3 金额字段

| 字段名 | 类型 | 说明 | 值域 | 聚合方式 |
|--------|------|------|------|----------|
| `premium` | FLOAT64 | 保费（元） | -18,902 ~ 30,185 | SUM |
| `new_vehicle_price` | FLOAT64 | 新车购置价（元） | 0 ~ 12,600,000 | AVG/MAX |
| `commercial_pricing_factor` | FLOAT64 | 商车自主定价系数 | 0.5 ~ 1.5 | AVG |
| `reported_claims` | FLOAT64 | 已报告赔款（元） | 0 ~ 高值 | SUM |
| `fee_amount` | FLOAT64 | 费用金额（元） | 0 ~ 高值 | SUM |
| `cross_sell_premium_driver` | FLOAT64 | 交叉销售保费-驾意（元） | 0 ~ 高值 | SUM |
| `claim_cases` | INT64 | 赔案件数 | 0 ~ N | SUM |
| `third_party_coverage` | FLOAT64 | 三者保额（元） | 0 ~ 高值 | AVG/MAX |
| `driver_coverage` | FLOAT64 | 司机保额（元） | 0 ~ 高值 | AVG/MAX |
| `passenger_coverage` | FLOAT64 | 乘客险保额（元） | 0 ~ 高值 | AVG/MAX |
| `plate_no` | STRING | 车牌号码 | 川A12345 格式 | — |
| `seat_count` | INT64 | 座位数 | 2 ~ 9（乘用车通常5座） | — |
| `driver_age_group` | STRING | 被保险人年龄分组 | `46岁≤年龄＜61岁` / `36岁≤年龄＜46岁` / `28岁≤年龄＜36岁` / `24岁≤年龄＜28岁` / `年龄≥61岁` / `年龄＜24岁` | — |
| `first_registration_date` | STRING | 初次登记年月 | `YYYY-MM-DD` 格式，可用于计算车龄 | — |
| `fuel_type` | STRING | 燃料种类 | 汽油/柴油/纯电动(精友)/两用燃料/天然气(NG/CNG/LNG)/其它混合动力/纯电动(行业)/插电式混合动力(精友)/其它/插电式混合动力(行业)/甲醇 | — |

**保费特殊规则**:
- `保费 > 0` = 正常承保
- `保费 < 0` = 批改退费
- 实收保费 = `SUM(premium)`（正负抵消）
- 毛保费 = `SUM(ABS(premium))`

### 1.4 布尔字段

| 字段名 | 说明 | True占比 | 含义 |
|--------|------|----------|------|
| `is_renewal` | 是否续保 | 36.4% | True=有续保单号 |
| `is_renewable` | 是否可续 | 99.1% | False=禁止续保 |
| `is_new_car` | 是否新车 | 5.4% | 新车首保 |
| `is_nev` | 是否新能源 | 3.4% | 新能源车 |
| `is_transfer` | 是否过户车 | 8.8% | 二手车过户 |
| `is_telemarketing` | 是否电销 | 8.3% | 电话销售渠道 |
| `is_quote` | 是否报价 | 17.9% | 报价记录（非正式保单） |
| `is_cross_sell` | 交叉销售标识 | ~36% | 有驾意险交叉销售 |

---

## 2. 枚举字段值域（完整列表）

### 2.1 险类 (insurance_type)

| 值 | 占比 | 说明 |
|----|------|------|
| `交强险` | 76.2% | 强制保险 |
| `商业保险` | 23.8% | 自愿购买 |

**关联规则**: `商车自主定价系数` 仅对商业保险有值

### 2.2 险别组合 (coverage_combination)

| 值 | 占比 | 说明 | 自然语言别名 |
|----|------|------|--------------|
| `单交` | 54.3% | 仅交强险 | 单交、只买交强 |
| `交三` | 23.0% | 交强+三者 | 交三、交强加三者 |
| `主全` | 22.7% | 交强+商业全险 | 主全、全险、交商 |
| `其他` | 0.0% | 其他组合 | - |

### 2.3 统保类型 (is_commercial_insure)

| 值 | 占比 | 说明 | 自然语言别名 |
|----|------|------|--------------|
| `单交` | 54.3% | 仅交强险 | 单交 |
| `套单` | 44.1% | 交商统保 | 套单、统保、交商统保 |
| `单商` | 1.6% | 仅商业险 | 单商 |
| `其他` | 0.0% | - | - |

### 2.4 客户类别 (customer_category)

| 值 | 占比 | 说明 | 自然语言别名 |
|----|------|------|--------------|
| `非营业个人客车` | 58.8% | 私家车 | 私家车、个人车、家用车 |
| `摩托车` | 28.6% | 二轮/三轮 | 摩托、摩托车 |
| `非营业货车` | 4.8% | 个人货车 | 非营货、自用货车 |
| `非营业企业客车` | 4.8% | 公务车 | 企业车、公务车 |
| `营业货车` | 2.9% | **重点分析对象** | 营货、营业货车、商用货车 |
| `营业出租租赁` | 0.1% | 出租/网约车 | 出租车、网约车、滴滴 |
| `特种车` | 0.1% | 工程车等 | 特种车、工程车 |
| `营业公路客运` | 0.1% | 长途大巴 | 客运、大巴 |
| `挂车` | 0.0% | 半挂车 | 挂车、半挂 |
| `非营业机关客车` | 0.0% | 政府车辆 | 公车、机关车 |
| `营业城市公交` | 0.0% | 公交车 | 公交、公交车 |

### 2.5 吨位分段 (tonnage_segment)

| 值 | 占比 | 说明 | 适用场景 |
|----|------|------|----------|
| `1吨以下` | 95.5% | 小型车/摩托 | 默认值 |
| `1-2吨` | 2.8% | 轻型货车 | 营业货车分析 |
| `2-9吨` | 0.5% | 中型货车 | 营业货车分析 |
| `9-10吨` | 0.1% | 重型边界 | 营业货车分析 |
| `10吨以上` | 1.1% | 重型货车 | 营业货车分析 |

**使用规则**: 仅当 `customer_category = '营业货车'` 时有分析意义

### 2.6 终端来源/渠道 (terminal_source)

| 代码 | 名称 | 占比 | 自然语言别名 |
|------|------|------|--------------|
| `0106` | 移动展业(App) | 67.9% | App、移动端、展业 |
| `0101` | 柜面 | 12.1% | 柜面、门店、线下 |
| `0110` | 融合销售 | 8.3% | 电销、融合 |
| `0201` | PC | 7.1% | PC、网页、电脑端 |
| `0202` | APP | 2.8% | 自有APP |
| `0107` | B2B | 1.2% | B2B、企业合作 |
| `0112` | AI出单 | 0.7% | AI出单、智能 |
| `0105` | 微信 | 0.0% | 微信、小程序 |

### 2.7 三级机构 (org_level_3)

| 机构 | 占比 | 排名 |
|------|------|------|
| `天府` | 39.7% | 1 |
| `宜宾` | 18.1% | 2 |
| `高新` | 10.8% | 3 |
| `青羊` | 7.9% | 4 |
| `泸州` | 5.2% | 5 |
| `自贡` | 4.9% | 6 |
| `新都` | 3.9% | 7 |
| `资阳` | 2.7% | 8 |
| `武侯` | 2.6% | 9 |
| `德阳` | 2.2% | 10 |
| `乐山` | 1.5% | 11 |
| `达州` | 0.5% | 12 |
| `重客` | 0.0% | - |
| `本部` | 0.0% | - |

### 2.8 批改类型 (endorsement_type)

| 值 | 占比 | 说明 | 保费影响 |
|----|------|------|----------|
| `16退保` | 52.9% | 提前退保 | 负保费 |
| `51车辆过户` | 19.6% | 车主变更 | - |
| `42变更车辆基本信息` | 18.7% | 信息修改 | - |
| `01批改关系人` | 4.7% | 变更人员 | - |
| `37批改险别信息` | 2.0% | 增减险种 | 可能有保费变化 |
| `A5新车上牌` | 1.4% | 临牌转正 | - |
| 其他 | <1% | 停驶/解除等 | - |

### 2.9 续保模式 (renewal_mode)

### 2.10 车险风险等级 (insurance_grade)

由原三个互斥字段合并而来：车险分等级（非营业客车）、小货车评分（2吨以下货车）、大货车评分（2吨以上营业货车）。

| 值 | 说明 |
|----|------|
| `A` | 最优等级 |
| `B` | 优良 |
| `C` | 良好 |
| `D` | 一般 |
| `E` | 较差 |
| `F` | 差 |
| `G` | 最差 |
| `X` | 未评定/不适用 |

**空值率**: ~43%（主要是摩托车等无评级车型）

| 值 | 占比 | 说明 |
|----|------|------|
| `自留` | 18.1% | 原业务员续保 |
| `外呼` | 7.0% | 电销团队外呼 |
| 空值 | 74.9% | 非续保/新保 |

---

## 3. 自然语言关键词映射表

### 3.1 时间表达

| 用户说法 | SQL 转换 |
|----------|----------|
| 今年、本年度、2025年 | `policy_date >= '2025-01-01' AND policy_date < '2026-01-01'` |
| 上月、12月 | `EXTRACT(MONTH FROM policy_date) = 12` |
| 最近30天 | `policy_date >= CURRENT_DATE - INTERVAL '30 days'` |
| 起保、生效 | 使用 `insurance_start_date` |
| 签单、缴费、付款 | 使用 `policy_date` |
| 签单、出单、提核 | 使用 `underwriting_date` |
| YTD、年累计 | `policy_date >= DATE_TRUNC('year', CURRENT_DATE)` |

### 3.2 指标表达

| 用户说法 | SQL 转换 |
|----------|----------|
| 保费、业绩、产能 | `SUM(premium)` |
| 件数、单数、保单数 | `COUNT(DISTINCT policy_no)` |
| 均保费、单均、件均 | `SUM(premium) / COUNT(DISTINCT policy_no)` |
| 续保率 | `COUNT(CASE WHEN is_renewal THEN 1 END) / COUNT(*)` |
| 新能源占比 | `COUNT(CASE WHEN is_nev THEN 1 END) / COUNT(*)` |
| 满期赔付率 | `SUM(reported_claims) / SUM(premium * earned_days / policy_term)` |
| 费用率 | `SUM(fee_amount) / SUM(premium)` |
| 满期出险率 | `SUM(claim_cases * policy_term / earned_days) / COUNT(DISTINCT policy_no)`（年化，闰年感知） |
| 变动成本率 | `满期赔付率 + 费用率`（两个分母不同：满期 vs 签单） |
| 案均赔款 | `SUM(reported_claims) / SUM(claim_cases)` |
| 边际贡献额（满期） | `满期保费 × (1 - 赔付率/100 - 费用率/100)` |
| 边际贡献额（预估） | `签单保费 × (1 - 赔付率/100 - 费用率/100)` |
| 推介率、驾乘推介率 | `SUM(driver_count) / SUM(auto_count)`（仅交三+主全，排除单交）→ 查 CrossSellDailyAgg |
| 渗透率、驾乘渗透率 | 驾意险承保件数 / 商业险承保件数 |
| 满期保费 | `SUM(premium * LEAST(DATEDIFF(day,起保日,截止日), policy_term) / policy_term)`（闰年感知） |

### 3.3 维度表达

| 用户说法 | 字段映射 |
|----------|----------|
| 机构、网点、分公司 | `org_level_3` |
| 业务员、出单员、销售 | `salesman_name` |
| 险种、产品 | `insurance_type` 或 `coverage_combination` |
| 渠道、来源、终端 | `terminal_source` |
| 客户类型、车型分类 | `customer_category` |
| 吨位、载重 | `tonnage_segment` |

### 3.4 条件表达

| 用户说法 | SQL 转换 |
|----------|----------|
| 续保、老客户 | `is_renewal = TRUE` |
| 新保、新客户 | `is_renewal = FALSE` |
| 新车 | `is_new_car = TRUE` |
| 新能源、电车 | `is_nev = TRUE` |
| 纯电动 | `fuel_type LIKE '纯电动%'` |
| 混合动力、插电 | `fuel_type LIKE '%混合动力%' OR fuel_type LIKE '插电%'` |
| 柴油车 | `fuel_type = '柴油'` |
| 天然气、CNG、LNG | `fuel_type LIKE '天然气%'` |
| 燃料类型分布 | `GROUP BY fuel_type`（注：仅2020-2023数据有值，2024+为NULL） |
| 电销 | `is_telemarketing = TRUE` |
| 私家车 | `customer_category = '非营业个人客车'` |
| 货车 | `customer_category LIKE '%货车%'` |
| 营业货车、商用货车 | `customer_category = '营业货车'` |
| 全险 | `coverage_combination = '主全'` |
| 交三 | `coverage_combination = '交三'` |
| 统保、套单 | `is_commercial_insure = '套单'` |
| 退保 | `endorsement_type = '16退保'` |
| 交叉销售、驾意 | `is_cross_sell = TRUE` |
| 车险等级A、优质车险、风险A级 | `insurance_grade = 'A'` |
| 有风险等级 | `insurance_grade IS NOT NULL` |
| 交叉销售保费 | `SUM(cross_sell_premium_driver)` |

---

## 4. 常见查询模式

### 4.1 业绩统计模式

```sql
-- 机构业绩排名
SELECT org_level_3 AS "机构",
  SUM(premium) AS "总保费",
  COUNT(DISTINCT policy_no) AS "件数"
FROM PolicyFact
WHERE policy_date >= '2025-01-01'
GROUP BY org_level_3
ORDER BY "总保费" DESC
```

### 4.2 占比分析模式

```sql
-- 新能源占比
SELECT org_level_3 AS "机构",
  COUNT(DISTINCT policy_no) AS "总件数",
  COUNT(DISTINCT CASE WHEN is_nev THEN policy_no END) AS "新能源件数",
  ROUND(COUNT(DISTINCT CASE WHEN is_nev THEN policy_no END) * 100.0 /
    NULLIF(COUNT(DISTINCT policy_no), 0), 2) AS "新能源占比%"
FROM PolicyFact
GROUP BY org_level_3
```

### 4.3 趋势分析模式

```sql
-- 月度趋势
SELECT DATE_TRUNC('month', policy_date) AS "月份",
  SUM(premium) AS "保费",
  COUNT(DISTINCT policy_no) AS "件数"
FROM PolicyFact
GROUP BY DATE_TRUNC('month', policy_date)
ORDER BY "月份"
```

### 4.4 营业货车专项模式

```sql
-- 吨位分段分析
SELECT tonnage_segment AS "吨位",
  SUM(premium) AS "保费",
  COUNT(DISTINCT policy_no) AS "件数",
  AVG(premium) AS "件均保费"
FROM PolicyFact
WHERE customer_category = '营业货车'
GROUP BY tonnage_segment
ORDER BY
  CASE tonnage_segment
    WHEN '1吨以下' THEN 1
    WHEN '1-2吨' THEN 2
    WHEN '2-9吨' THEN 3
    WHEN '9-10吨' THEN 4
    WHEN '10吨以上' THEN 5
  END
```

---

## 5. 字段关联规则

### 5.1 一致性规则

| 规则 | 说明 |
|------|------|
| `is_renewal = TRUE` ↔ `renewal_policy_no IS NOT NULL` | 续保标识与续保单号一致 |
| `endorsement_no IS NOT NULL` ↔ `endorsement_type IS NOT NULL` | 批单号与批改类型一致 |
| `insurance_type = '商业保险'` ↔ `commercial_pricing_factor IS NOT NULL` | 商业险才有自主系数 |
| `premium < 0` → `endorsement_no IS NOT NULL` | 负保费必有批改 |

### 5.2 业务规则

| 场景 | 规则 |
|------|------|
| 营业货车分析 | 必须筛选 `customer_category = '营业货车'` 后再按 `tonnage_segment` 分组 |
| 自主系数分析 | 必须筛选 `insurance_type = '商业保险'` |
| 续保率计算 | 分母用 `COUNT(*)`，分子用 `COUNT(CASE WHEN is_renewal THEN 1 END)` |
| 实收保费 | `SUM(premium)`（含负保费抵消） |

---

## 6. 隐私保护规则

**强制遵守**：
- ✅ `policy_no` 只能在 `COUNT(DISTINCT policy_no)` 内使用
- ❌ 禁止 `SELECT policy_no`
- ❌ 禁止 `GROUP BY policy_no`
- ❌ 禁止 `ORDER BY policy_no`
- ❌ 禁止 `WHERE policy_no = 'xxx'`

**原因**: 保单号属于敏感信息，不得暴露明细数据。

---

## 7. SalesmanPlanFact 视图（业务员保费计划）

### 7.1 数据概述

| 属性 | 值 |
|------|------|
| 数据来源 | `数据管理/业务员保费计划标准化数据.parquet` |
| 记录数 | 473 条 |
| 业务员数 | 239 人 |
| 团队数 | 47 个 |
| 机构数 | 12 个 |
| 计划年度 | 2025, 2026 |

### 7.2 字段列表

| 字段名 | 类型 | 说明 | 值域/示例 |
|--------|------|------|-----------|
| `salesman_name` | STRING | 业务员姓名 | **与 PolicyFact JOIN 的 KEY** |
| `salesman_id` | STRING | 业务员工号 | 如 `200048468` |
| `team_name` | STRING | 团队名称 | 如 `宜宾业务二部`（47个团队） |
| `org_name` | STRING | 机构名称 | 天府/宜宾/高新/青羊/泸州/自贡/新都/资阳/武侯/德阳/乐山/达州 |
| `entry_date` | DATE | 入职日期 | 如 `2021-06-22` |
| `plan_year` | INT | 计划年度 | 2025 或 2026 |
| `plan_vehicle` | FLOAT | 车险计划（万元） | 0 ~ 500 |
| `plan_property` | FLOAT | 财产险计划（万元） | 0 ~ 200 |
| `plan_life` | FLOAT | 寿险计划（万元） | 0 ~ 200 |
| `plan_total` | FLOAT | 总计划（万元） | = plan_vehicle + plan_property + plan_life |
| `actual_vehicle` | FLOAT | 车险实际（万元） | 动态计算 |
| `actual_property` | FLOAT | 财产险实际（万元） | 动态计算 |
| `actual_life` | FLOAT | 寿险实际（万元） | 动态计算 |
| `actual_total` | FLOAT | 总实际（万元） | 动态计算 |
| `rate_vehicle` | FLOAT | 车险达成率 | 0 ~ N（1 = 100%） |
| `rate_property` | FLOAT | 财产险达成率 | 0 ~ N |
| `rate_life` | FLOAT | 寿险达成率 | 0 ~ N |
| `rate_total` | FLOAT | 总达成率 | 0 ~ N |
| `months_in_service` | FLOAT | 在职月数 | 1 ~ 60+ |

### 7.3 常用查询模式

```sql
-- 机构计划完成汇总
SELECT org_name AS "机构",
  SUM(plan_vehicle) AS "车险计划",
  SUM(actual_vehicle) AS "车险实际",
  ROUND(SUM(actual_vehicle)/NULLIF(SUM(plan_vehicle),0)*100, 2) AS "达成率%"
FROM SalesmanPlanFact
WHERE plan_year = 2026
GROUP BY org_name
ORDER BY "达成率%" DESC
```

```sql
-- 业务员达成率排名（与 PolicyFact JOIN）
SELECT
  p.salesman_name AS "业务员",
  p.team_name AS "团队",
  p.plan_vehicle AS "车险计划",
  COALESCE(SUM(f.premium)/10000, 0) AS "实际保费",
  ROUND(COALESCE(SUM(f.premium)/10000, 0)/NULLIF(p.plan_vehicle, 0)*100, 2) AS "达成率%"
FROM SalesmanPlanFact p
LEFT JOIN PolicyFact f ON p.salesman_name = f.salesman_name
  AND f.policy_date >= '2026-01-01'
WHERE p.plan_year = 2026
GROUP BY p.salesman_name, p.team_name, p.plan_vehicle
ORDER BY "达成率%" DESC
```

### 7.4 关键注意事项

1. **金额单位**：SalesmanPlanFact 中的金额字段已经是**万元**，PolicyFact 中的 premium 是**元**
2. **JOIN 字段**：使用 `salesman_name` 关联两表
3. **机构名称差异**：SalesmanPlanFact 用 `org_name`，PolicyFact 用 `org_level_3`，值相同
4. **团队字段**：`team_name` 仅在 SalesmanPlanFact 中可用

---

## 8. DuckDB 预聚合视图（非 PolicyFact 查询场景）

以下视图/表不在 PolicyFact 中，需直接查询：

### 8.1 CrossSellDailyAgg — 交叉销售预聚合

| 字段 | 说明 |
|------|------|
| `policy_date`, `org_level_3`, `salesman_name`, `customer_category`, `coverage_combination` | 维度字段（共 19 个 GROUP BY 列） |
| `auto_count` | 车险件数（去重车架号） |
| `driver_count` | 驾意险件数（去重车架号，is_cross_sell=true） |
| `driver_premium` | 驾意险保费 |
| `commercial_premium`, `compulsory_premium`, `auto_premium` | 商业/交强/车险保费 |

**使用场景**: 推介率查询（`SUM(driver_count)/SUM(auto_count)`）。注意 org_level_3 是原始值，不经映射表覆盖。

### 8.2 achievement_cache — 业绩达成缓存

| 字段 | 说明 |
|------|------|
| `full_name` | 业务员全名（含工号前缀） |
| `salesman_name_short` | 业务员中文名 |
| `team_name`, `org_name` | 团队/机构 |
| `plan_vehicle` | 车险计划（万元） |
| `actual_vehicle` | 当年 YTD 实际（万元） |
| `achievement_rate` | 达成率（已考虑时间进度） |
| `yoy_rate` | 同比增长率 |
| `prev_year_actual`, `prev_year_full` | 上年同期/全年 |

**使用场景**: 业务员/团队/机构业绩排名。

### 8.3 RenewalFunnel — 续保漏斗

动态计算 `days_since_expiry`、`days_to_expiry`、`in_quote_window`、`maturity`（mature/pending/future）、`action_priority`（P1-P4）。

### 8.4 QuoteConversion — 报价转化

透传 `quotes_conversion/latest.parquet`，含业务员维度表 JOIN 后的团队字段。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0 | 2026-03-31 | 数据规模更新至 62 万+；新增 §8 DuckDB 预聚合视图；补充成本/推介率/边际贡献额指标映射；日期值域扩展至 2020-2026 |
| v1.4 | 2026-02-27 | 新增2个字段：plate_no（车牌号码）、seat_count（座位数）；字段总数34→36 |
| v1.3 | 2026-02-26 | 新增4个字段：underwriting_date, third_party_coverage, driver_coverage, passenger_coverage；前后端统一"签单日期"命名；支持多 Parquet 文件 UNION ALL 加载 |
| v1.2 | 2026-02-12 | 新增5个字段：insurance_grade, is_cross_sell, cross_sell_premium_driver |
| v1.1 | 2026-02-01 | 添加 SalesmanPlanFact 视图说明；明确 PolicyFact 可用字段 |
| v1.0 | 2026-01-31 | 初始版本，整合业务规则字典与 AI SQL 需求 |
