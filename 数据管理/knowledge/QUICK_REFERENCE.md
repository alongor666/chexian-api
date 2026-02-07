# 车险数据快速参考 (~200 tokens)

## 核心字段

| 字段 | 说明 | 聚合 |
|------|------|------|
| `policy_no` | 保单号 | COUNT DISTINCT |
| `premium` | 保费(元，可负) | SUM |
| `org_level_3` | 机构 | GROUP BY |
| `salesman_name` | 业务员 | GROUP BY |
| `policy_date` | 签单日期 | 业绩归属 |
| `insurance_start_date` | 起保日期 | 保险责任 |

## 主要枚举值

**险别组合**: 单交54% | 交三23% | 主全23%
**客户类别**: 私家车59% | 摩托29% | 营业货车3%
**机构Top5**: 天府40% | 宜宾18% | 高新11% | 青羊8% | 泸州5%

## 布尔字段

| 字段 | True占比 | 含义 |
|------|----------|------|
| `is_renewal` | 36% | 续保 |
| `is_new_car` | 5% | 新车 |
| `is_nev` | 3% | 新能源 |
| `is_telemarketing` | 8% | 电销 |

## 隐私规则

- ✅ `COUNT(DISTINCT policy_no)`
- ❌ `SELECT policy_no` / `GROUP BY policy_no`
