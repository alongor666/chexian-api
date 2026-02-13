# Parquet 表结构与字段值域知识库

**文档性质**: AI 必读知识源（NL2SQL 语义理解基础）
**更新时间**: 2026-02-01
**数据规模**: ~44万条记录 / 30个字段

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

**PolicyFact 视图可用字段** (31个)：
```
policy_no, premium, policy_date, insurance_start_date,
salesman_name, org_level_3, region_group, customer_category,
insurance_type, coverage_combination, is_renewal, is_new_car,
is_transfer, is_nev, is_telemarketing, tonnage_segment,
is_renewable, is_commercial_insure, terminal_source,
commercial_pricing_factor, vehicle_frame_no, is_quote,
claim_cases, reported_claims, fee_amount, renewal_mode,
insurance_grade, small_truck_score, large_truck_score,
is_cross_sell, cross_sell_premium_driver
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

---

## 1. 表结构总览 (PolicyFact)

### 1.1 主键与标识字段

| 字段名 | 类型 | 说明 | 值域/格式 |
|--------|------|------|-----------|
| `policy_no` | STRING | 保单号（主键） | 22位数字，如 `6102101030120240000857` |
| `renewal_policy_no` | STRING | 续保单号 | 同上，36.4%有值（空值=非续保） |
| `endorsement_no` | STRING | 批单号 | 保单号-序号，如 `xxx-001`，1.8%有值 |
| `vehicle_frame_no` | STRING | 车架号(VIN) | 17位，28万+唯一值 |
| `insurance_grade` | STRING | 车险分等级 | A/B/C/D/E/F/G/X，46.9%有值 |
| `small_truck_score` | STRING | 小货车评分 | A/B/C/D/E/X，4.8%有值 |
| `large_truck_score` | STRING | 大货车评分 | A/B/C/D/E/X，1.0%有值 |

### 1.2 日期字段

| 字段名 | 类型 | 说明 | 值域 |
|--------|------|------|------|
| `policy_date` | DATE/STRING | 签单日期 | 2023-12-05 ~ 2026-01-27 |
| `insurance_start_date` | DATE/STRING | 保险起期 | 2023-12-29 ~ 2026-01-27 |

**日期使用规则**:
- 业绩统计 → 用 `policy_date`（签单日期）
- 保险责任 → 用 `insurance_start_date`（起保日期）
- 格式: `YYYY-MM-DD`

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

> 注：§2.10 车险分等级 和 §2.11 货车评分 见下方

### 2.10 车险分等级 (insurance_grade)

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

**空值率**: ~46.9%（无等级数据）

### 2.11 货车评分 (small_truck_score / large_truck_score)

| 值 | 说明 |
|----|------|
| `A` | 优 |
| `B` | 良 |
| `C` | 中 |
| `D` | 差 |
| `E` | 极差 |
| `X` | 未评定/不适用 |

- `small_truck_score` 空值率 ~95.2%（仅小货车有值）
- `large_truck_score` 空值率 ~99.0%（仅大货车有值）

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
| 签单、出单 | 使用 `policy_date` |
| YTD、年累计 | `policy_date >= DATE_TRUNC('year', CURRENT_DATE)` |

### 3.2 指标表达

| 用户说法 | SQL 转换 |
|----------|----------|
| 保费、业绩、产能 | `SUM(premium)` |
| 件数、单数、保单数 | `COUNT(DISTINCT policy_no)` |
| 均保费、单均、件均 | `SUM(premium) / COUNT(DISTINCT policy_no)` |
| 续保率 | `COUNT(CASE WHEN is_renewal THEN 1 END) / COUNT(*)` |
| 新能源占比 | `COUNT(CASE WHEN is_nev THEN 1 END) / COUNT(*)` |
| 赔付率 | `SUM(reported_claims) / SUM(premium)` |
| 费用率 | `SUM(fee_amount) / SUM(premium)` |

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
| 电销 | `is_telemarketing = TRUE` |
| 私家车 | `customer_category = '非营业个人客车'` |
| 货车 | `customer_category LIKE '%货车%'` |
| 营业货车、商用货车 | `customer_category = '营业货车'` |
| 全险 | `coverage_combination = '主全'` |
| 交三 | `coverage_combination = '交三'` |
| 统保、套单 | `is_commercial_insure = '套单'` |
| 退保 | `endorsement_type = '16退保'` |
| 交叉销售、驾意 | `is_cross_sell = TRUE` |
| 车险等级A、优质车险 | `insurance_grade = 'A'` |
| 小货车评分 | `small_truck_score IS NOT NULL` |
| 大货车评分 | `large_truck_score IS NOT NULL` |
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

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.2 | 2026-02-12 | 新增5个字段：insurance_grade, small_truck_score, large_truck_score, is_cross_sell, cross_sell_premium_driver |
| v1.1 | 2026-02-01 | 添加 SalesmanPlanFact 视图说明；明确 PolicyFact 可用字段 |
| v1.0 | 2026-01-31 | 初始版本，整合业务规则字典与 AI SQL 需求 |
