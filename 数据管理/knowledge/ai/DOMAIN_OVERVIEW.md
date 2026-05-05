# 数据域全景 & 跨域 JOIN 速查

> **目的**: 活跃域的全景索引 + 域间 JOIN 条件，防止 AI 生成跨域 SQL 时出错。
>
> **更新**: 2026-05-05 | **域总数**: 11 活跃

---

## 1. 域全景表

### 事实表（Fact）

| 域 ID | 域名称 | DuckDB 关系 | 行数 | JOIN 键 | API 路由 | 前端页面 | 完整度 |
|--------|--------|-------------|------|---------|----------|----------|--------|
| premium | 保费（主数据） | PolicyFact → PolicyFactRealtime (TABLE) | 见 QUICK_REFERENCE | policy_no | /api/query/{kpi,trend,cost,growth,...} 21+ | 几乎所有页面 | 🟢 |
| claims_detail | 赔案明细 | ClaimsDetail (VIEW) + ClaimsAgg (TABLE) | 25.4万 | claim_no / policy_no | /api/query/claims-detail/* (10端点) | /#/claims-detail | 🟢 |
| cross_sell | 交叉销售 | CrossSellFact (TABLE) → CrossSellDailyAgg (TABLE) | ~40万 | policy_no | /api/query/cross-sell* (7端点) | /#/specialty (tab=cross-sell) | 🟢 |
| quotes_conversion | 报价转化 | QuoteConversion (VIEW) | ~67万 | vehicle_frame_no | /api/query/quote-conversion/* (7端点) | /#/quote-conversion | 🟢 |
| renewal_tracker | 续保追踪（派生域） | RenewalTrackerFact (VIEW) | ~12.8万 | source_policy_no / vehicle_frame_no | /api/query/renewal-tracker | /#/renewal-tracker | 🟢 |
| customer_flow | 客户来源去向 | CustomerFlow (VIEW) | — | policy_no | /api/query/customer-flow/* (5端点) | /#/customer-flow | 🟢 |

### 维度表（Dim）

| 域 ID | 域名称 | DuckDB 关系 | 行数 | JOIN 键 | API | 前端 | 完整度 |
|--------|--------|-------------|------|---------|-----|------|--------|
| salesman | 业务员 | SalesmanDim (TABLE) → SalesmanTeamMapping (TABLE) | 603 | business_no / full_name | 间接(achievement_cache) | 间接(排名/达成) | 🟢 |
| plan | 保费计划 | PlanFact (TABLE) → SalesmanPlanFact (VIEW) | 855 | business_no + plan_year | 间接(achievement_cache) | 间接(达成率) | 🟢 |
| brand | 品牌车型 | BrandDim (TABLE) | 3.78万 | 厂牌车型 | — | — | 🟡 无API/前端 |
| repair_resource | 维修资源 | RepairDim (TABLE) | — | repair_shop_name | /api/query/repair/* (4端点) | /#/repair | 🟢 |
| plate_region | 车牌归属地 | — (诊断工具直读) | 435 | plate_prefix | — | — | 🟡 无API/前端 |

## 2. 跨域 JOIN 速查表（CRITICAL）

> **规则**: 跨域 JOIN 前必须查此表确认 JOIN 条件和方向。错误的 JOIN 键会产出空结果集。

| # | 主表 | JOIN 方向 | 被 JOIN 表 | ON 条件 | 使用场景 | 陷阱 |
|---|------|-----------|-----------|---------|----------|------|
| J1 | PolicyFact (p) | LEFT JOIN | ClaimsAgg (c) | `p.policy_no = c.policy_no` | cost.ts — 赔付率/综合成本率 | ClaimsAgg 非全量覆盖，必须 LEFT JOIN |
| J2 | ClaimsDetail (c) | INNER JOIN | PolicyFact (p) | `c.policy_no = p.policy_no` | claims-detail.ts — 赔案维度补充保单属性 | 部分函数用 LEFT JOIN（loss-ratio, frequency） |
| J3 | CrossSellFact (cs) | LEFT JOIN | PolicyFact (p) | `cs.policy_no = p.policy_no` | duckdb.ts — 创建 CrossSellDailyAgg 物化表 | CrossSell 是主表（8域模式），不是 PolicyFact |
| J4 | CrossSellDailyAgg | LEFT JOIN | SalesmanTeamMapping (tm) | `salesman_name = tm.full_name` | cross-sell.ts — 业务员团队归属 | full_name 必须含工号前缀 |
| J5 | RenewalTrackerFact (r) | LEFT JOIN | SalesmanDim (s) | `r.salesman_name = s.full_name` | renewal-tracker.ts — 续保追踪 | 业务员维度来自派生 ETL |
| J6 | SalesmanDim (s) | LEFT JOIN | PlanFact (p) | `s.business_no = p.business_no` | duckdb.ts — 构建 SalesmanTeamMapping | 附加条件 `plan_year=2026 AND level='salesman'` |
| J7 | CustomerFlow | — (独立查询) | — | — | customer-flow.ts — 转入/流失分析 | 按 policy_no 去重（非 vehicle_frame_no） |

### JOIN 陷阱速查

| 陷阱 | 现象 | 原因 | 正确做法 |
|------|------|------|---------|
| full_name 缺工号 | JOIN 返回 0 行 | SalesmanTeamMapping.full_name 必须含 9 位工号前缀 | 从 Parquet 查完整值 |
| CrossSell 主表搞反 | 推介率分母错误 | 8 域模式 CrossSellFact 是主表，PolicyFact 是被 JOIN 表 | `CrossSellFact LEFT JOIN PolicyFact` |
| ClaimsAgg 用 INNER JOIN | 无赔付保单被排除 | ClaimsAgg 只含有赔付记录的保单 | `PolicyFact LEFT JOIN ClaimsAgg` |
| org_level_3 双源 | 同一人不同机构 | PolicyFact 用原始值，SalesmanTeamMapping 可覆盖 | 明确用哪个机构体系 |

---

## 3. 域血缘链路

```
域                Excel源              ETL脚本                    Parquet输出                    DuckDB关系               消费的SQL生成器
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
premium           01_签单清单_*.xlsx    transform.py               policy/current/*.parquet       PolicyFact(Realtime)     kpi/cost/trend/growth/...
claims_detail     02_理赔明细_*.xlsx    convert_claims_detail.py   claims_detail/claims_YYYY.parquet (年度分区) ClaimsDetail+ClaimsAgg   claims-detail.ts
cross_sell        03_交叉销售_*.xlsx    convert_cross_sell.py      cross_sell/latest.parquet       CrossSellFact→DailyAgg   cross-sell*.ts
quotes_conversion 04_报价清单_*.xlsx    quote_etl.py               quotes_conversion/latest.parquet QuoteConversion         quote-conversion.ts
renewal_tracker   派生(policy+quote)     convert_renewal_tracker.py renewal_tracker/latest.parquet  RenewalTrackerFact      renewal-tracker.ts
customer_flow     08_客户来源去向*.xlsx convert_customer_flow.py   customer_flow/latest.parquet   CustomerFlow             customer-flow.ts
brand             保单parquet提取       generate_brand_dim.py      dim/brand/latest.parquet       BrandDim                 (诊断工具)
repair_resource   07_维修资源*.xlsx     convert_repair.py          dim/repair/latest.parquet      RepairDim                repair.ts
salesman          川分销售人员名单*.xlsx generate_dim_tables.py     dim/salesman/latest.parquet    SalesmanDim              (间接,via mapping)
plan              计划xlsx+mapping      generate_dim_tables.py     dim/plan/latest.parquet        PlanFact                 (间接,via cache)
```

---

## 4. 报价/续保域过渡说明

### 报价/续保当前口径

| 域 ID | 性质 | 说明 |
|--------|------|------|
| quotes_conversion | 当前报价转化域 | 04_报价清单 → quote_etl.py → quotes_conversion/latest.parquet |
| renewal_tracker | 当前续保追踪域 | 派生 policy + quotes_conversion + salesman |

---

*配套文档*: [DATA_FLOW_KNOWLEDGE.md](./DATA_FLOW_KNOWLEDGE.md)（字段变换+Gotcha） · [ETL_PIPELINE_KNOWLEDGE.md](./ETL_PIPELINE_KNOWLEDGE.md)（分片架构+转换规则） · [../data-sources.json](../../data-sources.json)（域元数据注册表）
