# 车险数据快速参考 (~300 tokens)

**更新**: 2026-04-20 | **数据规模**: ~0 万条 / 41 字段 | **分片**: 4 个 Parquet（policy/current/）

## 数据规模（三层口径）

| 口径 | 数值 | 说明 |
|------|------|------|
| 原始记录 | ~354 万行 | UNION ALL 含交强商业分行 |
| 唯一保单 | ~150 万 | COUNT DISTINCT policy_no |
| 2024+ 活跃 | ~88 万 | policy_date >= 2024-01-01 |

## 域全景速览

| 域 | DuckDB 关系 | 用途 |
|----|-------------|------|
| premium | PolicyFact(Realtime) | 保费/KPI/趋势/业绩/成本（主数据） |
| claims_detail | ClaimsDetail + ClaimsAgg | 赔案明细 + 保单级赔付聚合 |
| cross_sell | CrossSellFact → CrossSellDailyAgg | 驾意险推介率 |
| quotes_v2 | QuoteConversion | 报价转化分析 |
| renewal_v2 | PolicyFactRenewal | 续保跟踪 |
| customer_flow | CustomerFlow | 转入/流失分析 |
| repair_resource | RepairDim | 维修厂合作 |
| brand | BrandDim | 品牌维度（诊断工具用，无前端） |
| salesman/plan | SalesmanDim/PlanFact | 业务员+计划维度 |

> 完整域全景 + JOIN 条件: [ai/DOMAIN_OVERVIEW.md](./ai/DOMAIN_OVERVIEW.md)

## 主要枚举值

**险别组合**: 单交54% | 交三23% | 主全23%
**客户类别**: 私家车59% | 摩托29% | 营业货车3%
**机构Top5**: 天府40% | 宜宾18% | 高新11% | 青羊8% | 泸州5%
**终端来源**: App68% | 融合销售17% | 门店9%

## 核心 JOIN 键

| JOIN | 键 | 方向 |
|------|----|------|
| PolicyFact ↔ ClaimsAgg | policy_no | LEFT |
| ClaimsDetail ↔ PolicyFact | policy_no | INNER |
| CrossSellFact ↔ PolicyFact | policy_no | LEFT (CrossSell 为主表) |
| *TeamMapping ↔ PolicyFact | full_name = salesman_name | LEFT (含工号前缀!) |

## 隐私规则

- OK: `COUNT(DISTINCT policy_no)`
- NO: `SELECT policy_no` / `GROUP BY policy_no`

## 常用命令

```bash
node 数据管理/daily.mjs              # ETL（自动检测）
node 数据管理/daily.mjs all          # 全部 8 域
node scripts/sync-vps.mjs           # 同步 VPS
python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'"
python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"
```
