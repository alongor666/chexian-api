# 维修资源 + 理赔明细扩展 — 源表字段映射

## 概述

**重设计背景**：2026-04-18 重设计维修资源板块，核心目标是**识别"在合作网点之外维修的客户"并引导回流/转化**。

**涉及两个数据域**：
1. **repair_resource**（07_维修资源*.xlsx）— dim 表，当天网点快照
2. **claims_detail**（02_理赔明细*.xlsx）— fact 表，新增"标的汽修厂"列

---

## 1. 07_维修资源 源列（12 列，全部映射）

| 序号 | 中文列 | 英文字段 | 类型 | 说明 |
|------|--------|---------|------|------|
| 1 | 统计时间 | `report_date` | DATE | 当天快照日期 |
| 2 | 修理厂归属中支 | `org_level_3` | VARCHAR | 三级机构 |
| 3 | **当天合作状态** | `cooperation_status` | VARCHAR | **7 态枚举（见 §3）** |
| 4 | 渠道类型 | `channel_type` | VARCHAR | 渠道分类 |
| 5 | 修理厂名称 | `repair_shop_name` | VARCHAR | "**前 8 位=编码 + 名称**"格式 |
| 6 | 是否4S店 | `is_4s_shop` | BOOLEAN | 是/否 → true/false |
| 7 | 修理厂所在省 | `province` | VARCHAR | — |
| 8 | 修理厂所在市 | `city` | VARCHAR | — |
| 9 | 修理厂所在区 | `district` | VARCHAR | — |
| 10 | 核损金额 | `damage_assessment_amount` | DOUBLE | **= 维修产值（业务口径，见 §4.2 修保比）** |
| 11 | 换件折扣率 | `parts_discount_rate` | DOUBLE | 0-1 区间 |
| 12 | 签单净保费 | `net_premium` | DOUBLE | — |

### 1.1 ETL 派生字段

| 派生字段 | 派生规则 | 用途 |
|---------|---------|------|
| `shop_code` | `SUBSTR(repair_shop_name, 1, 8)` | JOIN ClaimsDetail 的稳定 key |
| `coop_tier` | CASE 映射（见 §3） | 三态分类：已合作/曾合作/未合作 |

---

## 2. 02_理赔明细 新增列：标的汽修厂

| 中文列 | 英文字段 | 类型 | 说明 |
|--------|---------|------|------|
| **标的汽修厂** | `subject_repair_shop` | VARCHAR | **我方车主送修的网点**（与 `third_party_repair` 区分） |

### 2.1 ETL 派生字段

| 派生字段 | 派生规则 |
|---------|---------|
| `subject_shop_code` | `SUBSTR(subject_repair_shop, 1, 8)` |

### 2.2 与既有字段的关系

| 字段 | 语义 | 用途 |
|------|------|------|
| `subject_repair_shop` (新) | 标的车送修网点 | **"在哪里维修"分析根基** |
| `third_party_repair` (既有) | 三者汽修厂 | 对方车定损网点（本次分析不用） |

---

## 3. cooperation_status 三态映射（业务权威）

| 源枚举值 | 三态分类 | coop_tier |
|---------|---------|-----------|
| `1生效中` | **已合作** | `active` |
| `0暂停合作` | **曾合作** | `past` |
| `7已撤销` | **曾合作** | `past` |
| `8失效` | **曾合作** | `past` |
| `3退回修改` | **未合作** | `none` |
| `5待复核` | **未合作** | `none` |
| `无合作` / NULL | **未合作** | `none` |
| ClaimsDetail 中出现但不在 RepairDim | **未合作（影子网点）** | `none_shadow` |

---

## 4. 核心业务口径

### 4.1 本地资源占比（L4 — 多表 JOIN）

```
本地资源占比 = 出险地在本区县 且 在该网点维修 的赔案数
             ────────────────────────────────────────────
             在该网点维修的赔案数
```

SQL 实现：

```sql
WITH shop_claims AS (
  SELECT
    r.shop_code,
    r.district AS shop_district,
    COUNT(DISTINCT c.claim_no) AS total_claims,
    COUNT(DISTINCT CASE WHEN c.accident_district = r.district THEN c.claim_no END) AS local_claims
  FROM RepairDim r
  LEFT JOIN ClaimsDetail c ON c.subject_shop_code = r.shop_code
  GROUP BY r.shop_code, r.district
)
SELECT
  shop_code,
  local_claims * 1.0 / NULLIF(total_claims, 0) AS local_resource_ratio
FROM shop_claims;
```

### 4.2 修保比（L2 — RepairDim 单表）

```
修保比 = 维修产值 (= 核损金额) / 签单净保费
```

SQL：`SUM(damage_assessment_amount) / NULLIF(SUM(net_premium), 0)`

**业务解读**：
- < 0.3 → 合作深度低，网点给我们的保费多但用我们的定损少（可挖掘）
- 0.3-0.7 → 健康
- > 0.7 → 定损偏重，保费贡献不足（需要业务员推动）

### 4.3 合作启用率（L2）

```
合作启用率 = 已合作网点数 / 所有在 RepairDim 的网点数
```

### 4.4 导流潜力（L4）

```
导流潜力保费 = Σ (保单净保费) WHERE 保单对应赔案的 subject_shop_code 属于"曾合作"或"未合作"
```

---

## 5. 网点名称匹配规则

### 5.1 JOIN Key

`shop_code = SUBSTR(shop_name, 1, 8)`（前 8 位编码）

### 5.2 排除条件（"非维修单位"）

| 关键词 | 匹配方式 | 原因 |
|-------|---------|------|
| `定损` | `LIKE '%定损%'` | 定损中心不是维修网点 |
| `自选` | `LIKE '%自选%'` | 非实体维修单位 |
| `无` | `= '无'`（精确匹配） | 源数据占位符，避免误杀"无锡XX厂" |

排除后网点才进入三态分类和散点图。

---

## 6. 时间口径

### 6.1 自然年度 YTD

```sql
WHERE YEAR(accident_time) = YEAR(CURRENT_DATE)
```

### 6.2 滚动 12 月

**基准日 = MAX(accident_time) IN ClaimsDetail**（不是 today()，避免数据滞后造成统计空窗）

```sql
WHERE accident_time >= (SELECT MAX(accident_time) FROM ClaimsDetail) - INTERVAL 12 MONTH
```

---

## 7. 下游依赖

| 消费者 | 用途 |
|-------|------|
| `server/src/config/metric-registry/categories/repair.ts` | 6 个原子指标注册 |
| `server/src/sql/repair.ts` | 8 个 SQL 生成器 |
| `server/src/routes/query/repair.ts` | 6 个新路由 |
| `src/features/repair/RepairPage.tsx` | 单页下钻前端 |
| `数据管理/knowledge/rules/车险数据业务规则字典.md` § 维修资源分析口径 | 业务文档 |

---

## 8. 变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-18 | 初版：01 维修 12 列 + 02 新增标的汽修厂 + 三态映射 + 核心口径 |
