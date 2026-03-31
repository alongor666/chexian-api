---
name: 满期公式闰年修正 + 出险率口径 + 定价系数条件
description: 满期天数用 policy_term(365/366) 替代硬编码 365；出险率用年化公式；定价系数仅商业险
type: feedback
---

三条公式修正规则（2026-03-31 用户明确要求）：

### 1. 满期保费闰年感知

```sql
-- 旧（错误）
premium * LEAST(elapsed_days, 365) / 365.0

-- 新（正确）
policy_term = DATEDIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR)  -- 365 或 366
earned_days = LEAST(DATEDIFF('day', 保险起期, CURRENT_DATE), policy_term)
earned_premium = premium * earned_days / policy_term
```

**Why:** 18.5% 的牵引车保单跨闰年（366天），硬编码 365 导致满期保费偏高。

### 2. 满期出险率年化公式

```
满期后: 出险率 = 赔案件数 / 保单件数
未满期: 出险率 = (赔案件数 / 保单件数) × (保险期限天数 / 满期天数)
```

SQL 聚合版：
```sql
SUM(赔案件数 × policy_term / earned_days) / COUNT(DISTINCT 保单号) × 100
```

**Why:** 旧口径（有赔案保单数/总保单数）忽略一保单多赔案和未满期年化。

### 3. 商车定价系数仅商业险

```sql
AVG(CASE WHEN 险类 = '商业保险' AND 商车自主定价系数 > 0 THEN 商车自主定价系数 END)
```

**Why:** 交强险无商车自主定价系数，虽然当前数据恰好全为 NULL，但其他客户类别可能有脏数据。

### How to apply

所有涉及满期保费/赔付率/出险率/定价系数的代码都必须用以上口径：
- `diagnose_vehicle.py` ✅ 已修正
- `diagnose_agent.py` ✅ 已修正
- `metric-registry/cost.ts` ✅ earned_premium v2.0 + earned_loss_frequency v2.0
- `server/src/sql/cost.ts` ⚠️ 待后续迭代修正（L4 复杂查询）
