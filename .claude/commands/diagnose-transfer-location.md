---
name: diagnose-transfer-location
description: 过户车出险地点异常分析 — 车牌归属地 vs 实际出险地，识别假资料/挂靠欺诈
category: data-analysis
version: 2.0.0
author: "@claude"
tags: [diagnosis, transfer, location, fraud, claims, parquet]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_transfer_location.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims_detail/latest.parquet
  - 数据管理/warehouse/dim/plate_region/latest.parquet
last_updated: "2026-04-13"
---

# 过户车出险地点异常分析

> 车牌归属地维度表(435条) JOIN 赔案出险城市，识别异地出险异常模式。
> 赔案严格限保单期间内（起保日 ≤ 出险日 ≤ 止保日）。

## 使用

```bash
# 默认 2025 年全部板块
python3 数据管理/pipelines/diagnose_transfer_location.py

# 指定年度
python3 数据管理/pipelines/diagnose_transfer_location.py --year 2025

# 只跑特定板块
python3 数据管理/pipelines/diagnose_transfer_location.py --sections 1,5,8
```

## 10 个板块

| # | 板块 | 分析内容 |
|---|------|---------|
| 1 | 过户车 vs 非过户车 | 异地出险率、案均对比，量化过户车异常程度 |
| 2 | 车牌归属地排名 | 各川牌前缀的异地率、异地/本地案均倍率 |
| 3 | 异地出险流向 | 归属地→出险地 TOP 路径，案均、人伤率 |
| 4 | 承保机构 | 各机构异地率、异地案均倍率，识别风控薄弱机构 |
| 5 | 区县集中度 | 欺诈热点区县：少车牌+高案均+高人伤 = 🔴 |
| 6 | 多城市出险 | 流窜出险车辆（2+城市），TOP 15 高风险明细 |
| 7 | 赔案特征对比 | 异地/本地的案均、人伤率、深夜率、周末率 |
| 8 | 出险原因经过 | 出险原因×本地/异地分布 + 高额赔案经过样本 |
| 9 | 外省车牌专项 | 外省车在川投保，出险地在原省份 → 挂靠嫌疑 |
| 10 | 诊断总结 | 风险信号汇总 + 行动建议 |

## 数据源

| 数据 | 路径 | 用途 |
|------|------|------|
| 保单 | `warehouse/fact/policy/current/*.parquet` | 过户标识、车牌、机构、保单期间 |
| 赔案 | `warehouse/fact/claims_detail/latest.parquet` | 出险地点、原因、经过、赔款 |
| 车牌归属 | `warehouse/dim/plate_region/latest.parquet` | 435条 plate_prefix → province/city |

## 出险地点分类逻辑

```
车牌归属城市 = 出险城市  → 本地
车牌归属省 = 四川 且 城市不同 → 本省异地
车牌归属省 ≠ 四川          → 外省
```

## 关键指标

| 指标 | 公式 | 异常阈值 |
|------|------|---------|
| 省内异地出险率 | 本省异地赔案 / 总赔案 | 🔵>25% 🟡>35% 🔴>45% |
| 异地/本地案均倍率 | 异地案均 / 本地案均 | 🔵>1.3x 🟡>1.8x 🔴>2.5x |
| 区县欺诈风险 | 案均≥2万 or 人伤率≥25% | 🔴 |

## 产出

报告保存至 `数据管理/数据分析报告/过户车出险地点分析_{year}_{date}.md`

## 领域知识

- **过户车无风险等级**: 过户车因无历史出险数据，结构性无法获得风险等级，不是"漏评"
- **车架号关联**: 保单与赔案通过 vehicle_frame_no 关联（非 policy_no，后者跨年格式不一致）
- **保单期间过滤**: 赔案严格限制在保单起止日内，避免历史赔案错误关联

ARGUMENTS: {用户的分析需求，如"2025年过户车出险地点分析"或具体板块}
