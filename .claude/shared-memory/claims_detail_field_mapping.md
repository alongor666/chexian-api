# ClaimsDetail VIEW 完整字段映射

## 概述

**数据源**：`数据管理/warehouse/fact/claims_detail/latest.parquet`（254,338 赔案）

**VIEW 创建**：`server/src/services/duckdb.ts:createClaimsDetailView()`

**数据域**：赔案级明细（每行 = 一个赔案），包含出险原因/人伤/地点/时效链/金额细分

**特点**：
- 与 `claims/latest.parquet`（保单级聚合）互补，不替换
- 与 `PolicyFact` 通过 `policy_no` JOIN 关联业务维度（机构/客户类别等）

---

## 1. ClaimsDetail VIEW 完整字段列表

| 序号 | 英文字段名 | 数据类型 | 中文标签 | 说明 |
|------|-----------|---------|---------|------|
| 1 | `policy_no` | VARCHAR | 保单号 | 唯一保单标识，与 PolicyFact JOIN 键 |
| 2 | `vehicle_frame_no` | VARCHAR | 车架号 | 车辆识别码（VIN） |
| 3 | `vehicle_series` | VARCHAR | 车系 | 车辆系列/型号 |
| 4 | `insurance_start_date` | DATE | 保险起期 | 保险合同生效日期 |
| 5 | `report_no` | VARCHAR | 报案号 | 报案编号 |
| 6 | `claim_no` | VARCHAR | 赔案号 | 赔案唯一标识 |
| 7 | `accident_time` | TIMESTAMP | 出险时间 | 事故发生时刻（核心时间锚点） |
| 8 | `claim_status` | VARCHAR | 赔案类型 | 枚举值：`已业务结案` / `未业务结案` |
| 9 | `is_bodily_injury` | BOOLEAN | 是否人伤 | TRUE = 人伤案件，FALSE = 非人伤 |
| 10 | `liability_ratio` | INT | 责任系数 | 责任比例（整数百分比？） |
| 11 | `report_time` | TIMESTAMP | 报案时间 | 报案日期时间 |
| 12 | `case_open_time` | TIMESTAMP | 立案时间 | 赔案立案日期 |
| 13 | `settlement_time` | TIMESTAMP | 已决时间 | 赔案已决日期 |
| 14 | `payment_time` | TIMESTAMP | 支付时间 | 赔款支付日期 |
| 15 | `accident_province` | VARCHAR | 出险地点省份 | 事故省份代码（如"四川"） |
| 16 | `accident_city` | VARCHAR | 出险地点城市 | 事故城市代码（如"510100成都市"） |
| 17 | `accident_district` | VARCHAR | 出险地区 | 事故所在区县 |
| 18 | `accident_address` | VARCHAR | 出险地点 | 事故详细地址 |
| 19 | `accident_description` | VARCHAR | 出险经过 | 事故描述（≤500 字） |
| 20 | `accident_cause` | VARCHAR | 出险原因 | 事故原因分类（如"追尾"） |
| 21 | `scene_type` | VARCHAR | 现场类型 | 现场勘查类型 |
| 22 | `reserve_amount` | DOUBLE | 立案金额 | 总立案金额（元） |
| 23 | `reserve_bodily_amount` | DOUBLE | 立案金额-人 | 人伤立案金额（元） |
| 24 | `reserve_bodily_latest` | DOUBLE | 最近人伤立案金额 | 最新人伤立案金额（元） |
| 25 | `reserve_vehicle_amount` | DOUBLE | 立案金额-车物 | 车物损失立案金额（元） |
| 26 | `reserve_property_amount` | DOUBLE | 立案金额-物 | 第三者物损立案金额（元） |
| 27 | `reserve_fee_amount` | INT | 立案金额-费用 | 费用类立案金额（元） |

---

## 2. 时效链字段关系

```
出险 → 报案 → 立案 → 已决 → 支付
 │      │      │      │      │
 └──────┴──────┴──────┴──────┘
 accident_time → report_time → case_open_time → settlement_time → payment_time
```

**时效计算**（参考 `claims-detail.ts:generateClaimCycleQuery()`）：
- 报案延迟 = `DATEDIFF('day', accident_time, report_time)`
- 立案延迟 = `DATEDIFF('day', report_time, case_open_time)`
- 审核周期 = `DATEDIFF('day', case_open_time, settlement_time)`
- 支付延迟 = `DATEDIFF('day', settlement_time, payment_time)`
- **总周期** = `DATEDIFF('day', accident_time, payment_time)`（关键指标）

---

## 3. 金额字段关系

```
立案金额总计 = 人伤 + 车物 + 第三者物损 + 费用
reserve_amount ≈ reserve_bodily_amount + reserve_vehicle_amount + reserve_property_amount + reserve_fee_amount
```

**分类统计**（参考 `generatePendingOverviewQuery()`）：
- 总立案金额（万元）：`SUM(reserve_amount) / 1e4`
- 人伤立案金额（万元）：`SUM(reserve_bodily_amount) / 1e4`
- 车物立案金额（万元）：`SUM(reserve_vehicle_amount) / 1e4`
- 物损立案金额（万元）：`SUM(reserve_property_amount) / 1e4`

---

## 4. 地理维度字段

### 4.1 出险地点维度
- `accident_province` — 事故省份（如"四川"）
- `accident_city` — 事故城市编码（如"510100成都市"）
- `accident_district` — 事故区县（细粒度）
- `accident_address` — 完整地址文本

### 4.2 车牌归属地维度（通过 PolicyFact JOIN）
来自 `PolicyFact.plate_no`，在 SQL 生成器中计算：
```sql
CASE
  WHEN p.plate_no LIKE '川A%' THEN '成都'
  WHEN p.plate_no LIKE '川B%' THEN '绵阳'
  ... (省市+渝)
  ELSE '其他'
END AS plate_city
```

**地理对比分析**：出险地 vs 车牌归属地，识别异地出险（高风险）

---

## 5. 核心分析维度

| 维度 | 字段 | 用途 | 聚合方式 |
|------|------|------|---------|
| **赔案状态** | `claim_status` | 已决 vs 未决分析 | GROUP BY |
| **人伤** | `is_bodily_injury` | 人伤率、人伤赔付 | SUM(CASE WHEN TRUE), COUNT(*) |
| **出险原因** | `accident_cause` | 原因分类风险排名 | GROUP BY, ORDER BY cases DESC |
| **地理** | `accident_city` + `plate_city` | 地域风险热力图 | GROUP BY |
| **机构** | `PolicyFact.org_level_3`（JOIN） | 组织维度分析 | LEFT JOIN PolicyFact |
| **客户类别** | `PolicyFact.customer_category`（JOIN） | 客户细分 | LEFT JOIN PolicyFact |
| **时间序列** | `accident_time` | 按天/周/月/季/年分析 | YEAR/QUARTER/MONTH |

---

## 6. API 端点与字段使用

### 6.1 未决赔案概览
**端点**：`GET /api/query/claims-detail/pending-overview`

**使用字段**：
- `claim_status` — 分组（已结 vs 未结）
- `reserve_amount`, `reserve_bodily_amount`, `reserve_vehicle_amount`, `reserve_property_amount` — 金额统计
- `is_bodily_injury` — 人伤分组

**关联维度**（JOIN PolicyFact）：
- `org_level_3` — 机构过滤
- `customer_category` — 客户类别过滤

---

### 6.2 未决赔案按机构分布
**端点**：`GET /api/query/claims-detail/pending-by-org`

**使用字段**：
- `reserve_amount` — 金额聚合
- `accident_time` — 账龄计算（待决天数）
- `is_bodily_injury` — 人伤统计

**GROUP BY**：`PolicyFact.org_level_3`（三级机构）

---

### 6.3 未决赔案账龄分布
**端点**：`GET /api/query/claims-detail/pending-aging`

**使用字段**：
- `accident_time` — 核心聚合键（按待决天数分组）
- `reserve_amount`, `is_bodily_injury` — 金额和人伤统计

**时间分组**：
```
0-30 天 / 31-90 天 / 91-180 天 / 181-365 天 / 365+ 天
```

---

### 6.4 出险原因分析
**端点**：`GET /api/query/claims-detail/cause-analysis`

**使用字段**：
- `accident_cause` — 分组维度（TOP N 原因）
- `reserve_amount` — 赔付金额和均值
- `is_bodily_injury` — 人伤率计算

---

### 6.5 地理风险 - 按出险地点
**端点**：`GET /api/query/claims-detail/geo-accident`

**使用字段**：
- `accident_province`, `accident_city` — GROUP BY
- `reserve_amount` — 金额聚合
- `payment_time` — 理赔周期计算

**输出**：TOP 100 出险地点（按赔案数 DESC）

---

### 6.6 地理风险 - 按车牌归属地
**端点**：`GET /api/query/claims-detail/geo-plate`

**使用字段**：
- `policy_no`（JOIN PolicyFact）— 获取 `plate_no`
- `reserve_amount`, `is_bodily_injury` — 金额和人伤统计

**计算维度**：由 `plate_no` 推导的 `plate_city`

---

### 6.7 地理对比分析
**端点**：`GET /api/query/claims-detail/geo-comparison`

**使用字段**：
- `accident_city` — 出险地
- `plate_no`（via PolicyFact JOIN） — 车牌归属地
- `reserve_amount` — 对比统计

**关键指标**：异地出险率和赔付差异

---

### 6.8 理赔时效分析
**端点**：`GET /api/query/claims-detail/claim-cycle`

**使用字段**：
- `accident_time`, `report_time`, `case_open_time`, `settlement_time`, `payment_time` — 时效链
- `is_bodily_injury` — 人伤 vs 非人伤分组

**计算**：
```
平均报案延迟 = AVG(DATEDIFF('day', accident_time, report_time))
平均立案延迟 = AVG(DATEDIFF('day', report_time, case_open_time))
平均审核周期 = AVG(DATEDIFF('day', case_open_time, settlement_time))
平均支付延迟 = AVG(DATEDIFF('day', settlement_time, payment_time))
总周期中位数 = MEDIAN(DATEDIFF('day', accident_time, payment_time))
```

---

### 6.9 出险频度同比分析
**端点**：`GET /api/query/claims-detail/frequency-yoy`

**使用字段**：
- `accident_time` — 按季度分组（YEAR/QUARTER）
- `is_bodily_injury` — 人伤统计
- `reserve_amount` — 赔付金额

**聚合**：
```
claim_count = COUNT(*)
injury_count = SUM(CASE WHEN is_bodily_injury THEN 1)
reserve_wan = SUM(reserve_amount) / 1e4
freq_per_1000 = claim_count * 1000 / policy_count
injury_pct = injury_count / claim_count
```

**对标**：与 PolicyFact 同期保单数关联（出险率年化）

---

## 7. 筛选器参数

**ClaimsDetailFilters 接口**（定义在 `server/src/sql/claims-detail.ts`）：

```typescript
interface ClaimsDetailFilters {
  dateStart?: string;        // 出险时间开始（YYYY-MM-DD）
  dateEnd?: string;          // 出险时间结束（YYYY-MM-DD）
  orgName?: string;          // 三级机构（来自 PolicyFact.org_level_3）
  claimStatus?: string;      // 赔案类型：'已业务结案' / '未业务结案'
  isBodilyInjury?: string;   // 是否人伤：'true' / 'false'
  accidentCause?: string;    // 出险原因（枚举值）
  accidentCity?: string;     // 出险城市（枚举值）
  customerCategory?: string; // 客户类别（来自 PolicyFact.customer_category）
}
```

**WHERE 子句生成**：
- ClaimsDetail 过滤：`accident_time`, `claim_status`, `is_bodily_injury`, `accident_cause`, `accident_city`
- PolicyFact 过滤（JOIN）：`org_level_3`, `customer_category`

---

## 8. 关键业务规则

### 8.1 赔案状态枚举
- `已业务结案` — 赔案已结案，通常可获取支付金额和周期
- `未业务结案` — 赔案待结案（"已决"但未支付，或待已决），通常用于"未决赔案监控"

### 8.2 人伤 vs 非人伤
- `is_bodily_injury = TRUE` — 人伤案件（涉及人身伤害赔偿）
- `is_bodily_injury = FALSE` — 非人伤案件（仅车物损失）

**关键指标**：人伤率 = `SUM(CASE WHEN is_bodily_injury) / COUNT(*)` × 100%

### 8.3 金额含义
- `reserve_amount` — "立案金额"（预期赔付，not 已支付），用于未决赔案监控
- 对比 `PolicyFact.claim_amount` — 已支付赔款（不重复，用于赔付率）

### 8.4 地理维度选择规则
- **出险地点** — 事故实际发生地（更精准，但可能残缺）
- **车牌归属地** — 车辆注册地（相对完整，但可能跨域用车）
  
**设计规则**：车牌是风险评估的一级要素（因为机构通常按地理分片管理），出险地用于二级分析（识别异地出险）。

---

## 9. 空值处理规则

| 字段 | 空值含义 | 处理方式 |
|------|---------|---------|
| `accident_time` | 缺失出险日期 | 一般不空（必填，若空则过滤） |
| `policy_no` | 赔案无法关联保单 | 过滤（191 条缺失） |
| `claim_no` | 赔案号缺失 | 过滤（ETL 阶段已去除） |
| `payment_time` | 赔案未支付或待支付 | 仅在"已业务结案"过滤中使用 |
| `accident_cause` | 出险原因未分类 | GROUP BY 时自动排除或作为"其他" |
| `reserve_bodily_amount` | 非人伤案件 | 保留 NULL（不填 0） |
| `plate_no`（via JOIN） | 车辆无牌或外地车 | CASE 表达式映射为"其他" |

---

## 10. 前端展示配置（参考）

### 字段标签映射
```json
{
  "claim_no": "赔案号",
  "policy_no": "保单号",
  "accident_time": "出险日期",
  "claim_status": "赔案状态",
  "is_bodily_injury": "是否人伤",
  "accident_cause": "出险原因",
  "accident_city": "出险城市",
  "accident_province": "出险省份",
  "reserve_amount": "立案金额(元)",
  "reserve_bodily_amount": "人伤立案(元)",
  "reserve_vehicle_amount": "车物立案(元)",
  "reserve_property_amount": "物损立案(元)",
  "avg_pending_days": "平均待决天数",
  "max_pending_days": "最长待决天数",
  "avg_report_days": "平均报案延迟(天)",
  "avg_total_days": "平均周期(天)",
  "injury_pct": "人伤占比(%)",
  "cross_region_pct": "异地出险率(%)"
}
```

### 数值格式化
- **金额字段**（含立案金额）：万元显示 → `value / 10000`，保留 1-2 小位数
- **日期字段**：YYYY-MM-DD 格式（由 duckdb.ts 反序列化）
- **百分比字段**：乘以 100，保留 1 小数点

---

## 11. 常见查询模式

### 11.1 未决赔案监控（核心用途）
```sql
SELECT
  COUNT(*) AS pending_cases,
  SUM(reserve_amount) / 1e4 AS total_reserve_wan,
  AVG(DATEDIFF('day', accident_time, CURRENT_DATE)) AS avg_pending_days
FROM ClaimsDetail c
JOIN PolicyFact p ON c.policy_no = p.policy_no
WHERE c.claim_status = '未业务结案'
  AND c.accident_time >= '2024-01-01'
GROUP BY p.org_level_3
```

### 11.2 人伤赔付分析
```sql
SELECT
  SUM(CASE WHEN is_bodily_injury THEN reserve_bodily_amount ELSE 0 END) / 1e4 AS bodily_reserve_wan,
  SUM(CASE WHEN is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS injury_pct
FROM ClaimsDetail
WHERE accident_time BETWEEN ? AND ?
```

### 11.3 理赔周期排查
```sql
SELECT
  claim_no, policy_no,
  DATEDIFF('day', accident_time, payment_time) AS total_days,
  DATEDIFF('day', accident_time, report_time) AS report_days,
  DATEDIFF('day', case_open_time, settlement_time) AS settle_days
FROM ClaimsDetail
WHERE DATEDIFF('day', accident_time, payment_time) > 180  -- 超过 6 个月
  AND claim_status = '已业务结案'
ORDER BY total_days DESC
```

---

## 12. 更新与同步

**数据源**：车险报立结案清单 Excel（`车险报立结案清单_*.xlsx`）

**ETL 脚本**：`数据管理/pipelines/convert_claims_detail.py`

**更新命令**：
```bash
# 转换 Excel → Parquet
python3 数据管理/pipelines/convert_claims_detail.py \
  -i "车险报立结案清单_*.xlsx" \
  -o "数据管理/warehouse/fact/claims_detail/latest.parquet"

# 同步到 VPS
node scripts/sync-vps.mjs
```

**同步路径**（VPS）：
- 本地：`数据管理/warehouse/fact/claims_detail/latest.parquet`
- VPS：`server/data/fact/claims_detail/latest.parquet`

---

## 13. 文件位置总览

| 文件 | 路径 | 用途 |
|------|------|------|
| **Parquet 数据** | `数据管理/warehouse/fact/claims_detail/latest.parquet` | 赔案原始数据（254,338 行） |
| **ETL 脚本** | `数据管理/pipelines/convert_claims_detail.py` | Excel → Parquet 转换 |
| **SQL 生成器** | `server/src/sql/claims-detail.ts` | 9 个查询生成函数 |
| **API 路由** | `server/src/routes/query/claims-detail.ts` | 9 个端点注册 |
| **VIEW 创建** | `server/src/services/duckdb.ts:createClaimsDetailView()` | 在内存中创建 VIEW |
| **前端页面** | `src/#/claims-detail` | 赔案明细分析 UI（2 个 Tab） |

---

## 14. 文档与知识库

**关联文档**：
- [project_claims_embedded_in_policy.md](./project_claims_embedded_in_policy.md) — 赔付表分工
- [出险率发展三角形技能](./skill_incident_rate_development.md) — 出险率分析
- [赔案明细出险率发展分析_2026Q1.md](../../数据管理/数据分析报告/赔案明细出险率发展分析_2026Q1.md) — 首份报告

