# 车险数据快速参考 (~300 tokens)

**更新**: 2026-04-06 | **数据规模**: ~117 万条 / 43 字段 | **分片**: 4 个 Parquet（policy/current/）

## 核心字段

| 字段 | 说明 | 聚合 |
|------|------|------|
| `policy_no` | 保单号 | COUNT DISTINCT |
| `premium` | 保费(元，可负) | SUM |
| `org_level_3` | 机构 | GROUP BY |
| `salesman_name` | 业务员(含工号前缀) | GROUP BY |
| `policy_date` | 签单日期(业绩归属) | 筛选 |
| `insurance_start_date` | 起保日期(保险责任) | 满期计算 |
| `underwriting_date` | 提核日期 | 审批时间 |

## 赔付/费用/交叉销售字段

| 字段 | 说明 | 聚合 |
|------|------|------|
| `claim_cases` | 赔案件数 | SUM |
| `reported_claims` | 已报告赔款(元) | SUM |
| `fee_amount` | 费用金额(元) | SUM |
| `is_cross_sell` | 交叉销售标识(驾意险) | COUNT |
| `cross_sell_premium_driver` | 驾意险保费(元) | SUM |
| `insurance_grade` | 车险风险等级(A-G/X) | GROUP BY |

## 主要枚举值

**险别组合**: 单交54% | 交三23% | 主全23%
**客户类别**: 私家车59% | 摩托29% | 营业货车3%
**机构Top5**: 天府40% | 宜宾18% | 高新11% | 青羊8% | 泸州5%
**终端来源**: App68% | 融合销售17% | 门店9%

## 布尔字段

| 字段 | True占比 | 含义 |
|------|----------|------|
| `is_renewal` | 36% | 续保 |
| `is_new_car` | 5% | 新车 |
| `is_nev` | 3% | 新能源 |
| `is_telemarketing` | 8% | 电销 |
| `is_transfer` | ~2% | 过户 |
| `is_cross_sell` | ~15% | 有驾意险交叉销售 |

## 保额字段

| 字段 | 说明 |
|------|------|
| `third_party_coverage` | 三者保额 |
| `driver_coverage` | 司机保额 |
| `passenger_coverage` | 乘客险保额 |

## 隐私规则

- OK: `COUNT(DISTINCT policy_no)`
- NO: `SELECT policy_no` / `GROUP BY policy_no`

## 常用诊断命令

```bash
python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'"
python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"
node 数据管理/daily.mjs all && node scripts/sync-vps.mjs
```
