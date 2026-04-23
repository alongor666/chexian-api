---
name: diagnose-segment
description: 通用车型细分经营诊断 — 任意 WHERE 筛选 + 90/180/270/满期四桩发展口径 + 可插拔下钻
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [diagnosis, development-cohort, policy-age, segment, drilldown]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_segment.py
  - 数据管理/pipelines/policy_age_dev.py
  - 数据管理/knowledge/rules/segment-dictionary.json
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims_detail/claims_*.parquet
last_updated: "2026-04-22"
---

# 通用车型细分诊断（/diagnose-segment）

> 对任意满足 `WHERE` 条件的保单 cohort，按**保单年龄发展口径**（起保+90/180/270/满期）做经营分析，并下钻厂牌/地点/时间/原因。产出 Markdown 落到 `数据管理/数据分析报告/`。

---

## 使用场景

- 「2025-2026 承保的 **X 车型细分** 经营怎么样？」
- 「**新能源营业货车**的赔付发展曲线」
- 「**某吨位段牵引车**赔付率为什么高」

**不适合**：跨年度趋势对比（用 `/data-trends`）、机构级经营（用 `/diagnose-agent`）、摩托车专项（用 `/diagnose-motorcycle`）。

---

## 三种调用方式

### 方式 0：交互问卷（需求模糊时自动触发）⭐ 推荐首选

当 AI 判断需求描述不够精确（未明确险种/燃料/吨位等关键维度），自动触发：

```bash
python3 数据管理/pipelines/diagnose_segment.py --interactive
# 或：什么都不传，脚本自动检测并进入交互模式
python3 数据管理/pipelines/diagnose_segment.py
```

**问卷分两批，每批 ≤4 题（总 7-11 题）**：

| 批次 | 题目 | 触发条件 |
|------|------|----------|
| 第1批（必答） | 时间范围、客户类别、险种、下钻维度 | 始终 |
| 第2批（货车专项） | 燃料类型、新旧车、是否过户、吨位段 | 第1批选了「营业货车」 |
| 第3批（货车类型） | 货车结构类型（牵引/自卸/厢式…） | 第1批选了「营业货车」 |

**交互示例**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  基础参数（必答）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  【分析时间范围（起保日期）】
    1. 2025 全年
    2. 2026 以来
    3. 近 15 个月（2025-01-01 ~ 今天）
    4. 自定义
▶ [1-4, 回车=近15个月]: 3

  【客户类别（可多选编号，逗号分隔；直接回车=全部不过滤）】
    1. 营业货车
    2. 非营业个人客车
    ...
▶ [逗号分隔编号, 回车=全部]: 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  营业货车细化维度
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ...（燃料、新旧车等细化题目）...

  ✅ 参数确认
  时间:  2025-01-01 ~ 2026-04-22
  WHERE: (customer_category = '营业货车') AND (fuel_type = '天然气(NG/CNG/LNG)') AND ...
  slug:  近15个月_营业货车_天然气_新车_10吨以上_牵引车
▶ 确认执行？[Y/n]: Y
```

**词典驱动**：选项的 keyword 字段映射 `segment-dictionary.json`，确保 WHERE 枚举值 100% 准确。

---

### 方式 A：词典关键词（推荐）

```bash
python3 数据管理/pipelines/diagnose_segment.py \
  --start 2025-01-01 --end 2026-04-20 \
  --keywords "天然气,新车,牵引车,10吨以上"
```

- 关键词查 `数据管理/knowledge/rules/segment-dictionary.json`
- 未登记的关键词 → 脚本报错，必须先补词典或改用 `--where`
- `--slug` 可省略，默认用关键词拼接

### 方式 B：原生 WHERE（自由度最高）

```bash
python3 数据管理/pipelines/diagnose_segment.py \
  --start 2025-01-01 --end 2026-04-20 \
  --slug "天然气新车牵引车10吨+" \
  --where "is_new_car=TRUE AND tonnage_segment='10吨以上' \
           AND truck_type='牵引' AND fuel_type='天然气(NG/CNG/LNG)'"
```

- 字段名必须是英文（查 `server/src/config/field-registry/fields.json`）
- 枚举值必须与 Parquet 完全一致（如 `天然气(NG/CNG/LNG)` 含括号后缀）
- **未指定 `--slug` 会报错**（需要明确的报告文件名）

---

## 参数速查

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `--start` | ✅ | 起保日期下限 | `2025-01-01` |
| `--end` | ✅ | 起保日期上限 | `2026-04-20` |
| `--keywords` | ⚪ | 词典关键词，逗号分隔 | `天然气,新车,牵引车` |
| `--where` | ⚪ | 原生 SQL WHERE（与 keywords 互斥） | `is_new_car=TRUE AND ...` |
| `--slug` | ⚪ | 报告 slug（文件名前缀） | `天然气新车牵引车10吨+` |
| `--drill` | ⚪ | 下钻维度，逗号分隔 | `vehicle_model,accident_province` |
| `--valuation-date` | ⚪ | 估值日 | 默认 `2026-04-21` |
| `--dry-run` | ⚪ | 只解析参数不跑查询 | — |
| `--interactive` | ⚪ | 强制进入交互问卷（默认：无 --where/--keywords 时自动触发） | — |

### 可用下钻维度（默认全部启用）

| 维度 | 产出 |
|------|------|
| `vehicle_model` | 厂牌车型（件数 ≥20 Top15）+ 满期赔付率/出险率 |
| `accident_province` | 出险省/市 Top20 |
| `accident_month` | 事故月份趋势 |
| `accident_hour` | 事故时段（一天 24 小时四分段） |
| `accident_cause` | 事故原因 Top15（按赔款金额） |
| `loss_category` | 损失类别分布 |
| `large_cases` | Top10 大案 |

---

## 口径说明（RED LINE）

| 概念 | 公式 |
|------|------|
| 件数 | 保单级去重（policy_no distinct），HAVING SUM(premium)>0 剔除纯退保 |
| 保费 | SUM(premium) 保单级净额，单位万元 |
| 已赚保费 | `premium × min(N, policy_term) / policy_term`；满期=全额 |
| 已赚暴露 | `min(N, policy_term) / 365`（年化可比） |
| 赔案数 | `COUNT(DISTINCT claim_no)`，accident_time ∈ [start_date, start_date+N) 且 ≤估值日 |
| 赔款 | 已结案 `settled_amount` + 未结案 `reserve_amount`（不重复） |
| 案均赔款 | 赔款 / 赔案数 |
| 满期出险率 | 赔案数 / 已赚暴露（年化 %） |
| 满期赔付率 | 赔款 / 已赚保费（%） |

**四桩 cohort 独立不等大**（递减）：
- 90 天桩：起期 ≤ 估值日 − 90 的保单
- 180 天桩：起期 ≤ 估值日 − 180
- 270 天桩：起期 ≤ 估值日 − 270
- 满期桩：保险止期 ≤ 估值日

> ⚠️ 不是同一批车随时间递增成熟，**不能做纯递进解读**。

---

## Pre-flight 确认协议

### 自动决策树

```
用户需求
  ├─ 关键词全部在词典中 + 时间范围明确 → 方式 A（--keywords）直接执行
  ├─ 字段/枚举已知但复杂 → 方式 B（--where）直接执行
  └─ 需求模糊（缺险种/燃料/吨位等关键维度）
       → 触发 --interactive 问卷（自动，无需用户输入额外指令）
```

**触发 --interactive 的信号**：
- 只说「营业货车经营」未给燃料/吨位
- 只说「某段时间」未给客户类别
- 使用「分析一下」「看看经营」等泛称
- 明确说「帮我填一下」

AI 在调用前需确认以下 3 项（词典关键词能覆盖则无需问）：

1. **时间范围**：`--start` / `--end` 都明确（或问卷第1题填写）
2. **筛选口径**：词典关键词全部存在于字典；否则**必须向用户确认**新增条目含义
3. **估值日**：默认今天，特殊场景（历史评估）需用户指定

---

## 常用组合示例

### 例 1：天然气新车牵引车 10 吨以上
```bash
python3 数据管理/pipelines/diagnose_segment.py \
  --start 2025-01-01 --end 2026-04-20 \
  --keywords "天然气,新车,牵引车,10吨以上"
```
也等价于：
```bash
python3 数据管理/pipelines/diagnose_lng_tractor.py   # 预设参数 wrapper
```

### 例 2：某吨位段全货车（不限燃料）
```bash
python3 数据管理/pipelines/diagnose_segment.py \
  --start 2025-01-01 --end 2026-04-20 \
  --keywords "大货车,牵引车" \
  --drill vehicle_model,accident_province,accident_cause
```

### 例 3：2026 新能源营业货车
```bash
python3 数据管理/pipelines/diagnose_segment.py \
  --start 2026-01-01 --end 2026-04-20 \
  --keywords "2026年以来,新能源,营业货车"
```

---

## 与其他诊断命令的分工

| 命令 | 适用场景 | 产出粒度 |
|------|----------|---------|
| **`/diagnose-segment`**（本命令） | 任意 WHERE 定义的车型细分 | 单 cohort 多桩发展 |
| `/diagnose-motorcycle` | 摩托车专项（交强+人身险捆绑） | 全公司摩托车 + 机构 A/B 类成本模型 |
| `/diagnose-agent` | 机构级经营诊断 | 逐机构 KPI + 三级机构排名 |
| `/diagnose-transfer-location` | 过户车车牌归属地 vs 出险地异常 | 欺诈识别 |

---

## 扩展词典

当需要新的业务关键词（如"冷链车"、"挂车带主车"）：

1. **DuckDB 探查字段实际枚举值**（禁止凭记忆）
2. **字段名从 field-registry/fields.json 取英文 id**
3. **优先等值查询**（而非 LIKE）
4. **更新 `数据管理/knowledge/rules/segment-dictionary.json`**
5. **_changelog 登记**

---

ARGUMENTS: {诊断需求的自然语言描述}
