---
name: chexian-flow-analysis
description: 客户来源去向分析（转入来源、流出去向、竞品追踪、机构对标）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [insurance, flow, customer, competitor, churn]
scope: project
requires:
  - DuckDB (python3)
  - 数据管理/warehouse/fact/customer_flow/latest.parquet
  - 数据管理/warehouse/fact/policy/current/*.parquet
last_updated: "2026-04-13"
---

# 客户来源去向分析

根据用户的自然语言描述，翻译为 `analyze_flow.py` 的参数组合并执行。

## 工具路径

```
python3 数据管理/tools/analyze_flow.py --province <省份码> [参数]
```

## 参数映射规则

用户说的话 → 对应参数：

| 用户表述 | 参数 | 示例值 |
|---------|------|--------|
| 营业货车/个人客车/摩托车/… | `--category` | 营业货车, 非营业个人客车, 摩托车, 非营业货车, 特种车 |
| 10吨以上/1-2吨/… | `--tonnage` | 10吨以上, 1-2吨, 2-9吨, 9-10吨, 1吨以下 |
| 2025年/2026年 | `--year` | 2025, 2026 |
| 主全/交三/单交 | `--coverage` | 主全, 交三, 单交（逗号分隔多选） |
| 转入/从竞品来的 | `--direction inbound` | |
| 流出/被抢走的/流失 | `--direction outbound` | |
| 华农/中意/人保/… | `--insurer` | 华农, 中意, 人保, 平安, 太保（模糊匹配，逗号分隔） |
| 天府/新都/高新/… | `--org` | 天府, 新都, 高新（逗号分隔） |
| 流失归因/为什么丢的/主动还是被动 | `--sections loss` | loss（评级对比四象限 + 渠道/业务员归因） |
| 只看摘要/只看竞品 | `--sections` | summary, insurer, org, coverage, tonnage, risk, premium, trend, loss |
| TOP 5 / 前20 | `--top` | 5, 20（默认10） |

## 执行流程

1. 从用户描述中提取筛选条件
2. 映射为参数，组装命令
3. 执行命令，将终端输出展示给用户
4. 如果用户要求进一步下钻，追加参数重新执行

## 典型用法

```bash
# "看看营业货车的流向"
python3 数据管理/tools/analyze_flow.py --province SC --category 营业货车

# "2026年10吨以上营业货车，重点看转入来源和风险"
python3 数据管理/tools/analyze_flow.py --province SC --category 营业货车 --tonnage 10吨以上 --year 2026 --sections summary,insurer,risk

# "谁在抢我们的个人客车主全业务"
python3 数据管理/tools/analyze_flow.py --province SC --category 非营业个人客车 --coverage 主全 --direction outbound --sections summary,insurer,org

# "天府的摩托车流向"
python3 数据管理/tools/analyze_flow.py --province SC --category 摩托车 --org 天府

# "华农和中意抢走了哪些保单"
python3 数据管理/tools/analyze_flow.py --province SC --insurer 华农,中意 --direction outbound

# "个人客车流失归因，哪些是主动提价、哪些是可惜的"
python3 数据管理/tools/analyze_flow.py --province SC --category 非营业个人客车 --sections loss

# "营业货车流失，按业务员看谁丢的最多"
python3 数据管理/tools/analyze_flow.py --province SC --category 营业货车 --year 2025 --sections loss
```

## 输出解读提示

- **转入** = 上年在竞品、今年转到华安（previous_insurer 非空）
- **流出** = 今年在华安、次年去了竞品（next_insurer 非空）
- 2026年保单大部分还没到期，所以流出数据通常为 0，这是正常的
- 保费†单位为元（件均），汇总列单位为万元

### loss 板块四象限含义

| 分类 | 条件 | 含义 |
|------|------|------|
| 主动提价 | 评级恶化 且 报价评级∉ABC | 风控主动加价逼走，预期行为 |
| 目标流失 | 评级恶化 且 报价评级∈ABC | 评级虽恶化但仍属优质，流失可惜 |
| 优质流失 | 评级持平/优化 且 报价评级∈ABC | 不该丢的好客户 |
| 高风险留不住 | 评级持平/优化 且 报价评级∉ABC | 风险高且未改善，影响可控 |

- 评级序：A(最优) > B > C > D > E > F > G > X(最差)，无评级等同X
- **可惜率** = (目标流失 + 优质流失) / 流失总量，越高说明该机构/业务员丢了越多不该丢的业务

## 注意事项

- 参数之间是 AND 关系，每加一个参数范围缩小
- `--insurer` 是模糊匹配，输入"华农"会匹配"华农财产保险股份有限公司"
- 无参数执行 = 全量全板块（97万+保单，约15秒）
- 用 `$ARGUMENTS` 中的自然语言描述来推断参数
