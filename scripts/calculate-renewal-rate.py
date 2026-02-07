#!/usr/bin/env python3
"""
直接计算续保率并验证SQL逻辑

统计 2026 年续保率：
- 应续保单（分母）：2025年起保的保单
- 已续保单（分子）：2025年起保保单的 policy_no 在 2026年起保保单的 renewal_policy_no 中
"""

import pandas as pd
from pathlib import Path

# 读取 Parquet 文件
parquet_file = Path(__file__).parent.parent / "签单清洗" / "优化处理后的业务数据_v2.parquet"

print("=" * 80)
print("🧮 直接计算续保率 - 2026年")
print("=" * 80)
print(f"读取文件: {parquet_file}\n")

df = pd.read_parquet(parquet_file)

# 转换日期
df['保险起期'] = pd.to_datetime(df['保险起期'])
df['起保年份'] = df['保险起期'].dt.year

print(f"总记录数: {len(df):,}\n")

# ============================================================================
# 1. 应续保单（2025年起保）
# ============================================================================
print("=" * 80)
print("1. 应续保单（分母）：2025年起保的保单")
print("=" * 80)

expiring_2025 = df[df['起保年份'] == 2025].copy()
print(f"2025年起保保单数: {len(expiring_2025):,}")
print(f"样本保单号（前5）:\n{expiring_2025['保单号'].head().tolist()}\n")

# ============================================================================
# 2. 2026年起保保单的续保单号集合
# ============================================================================
print("=" * 80)
print("2. 2026年起保保单的续保单号集合")
print("=" * 80)

renewal_2026 = df[df['起保年份'] == 2026].copy()
print(f"2026年起保保单数: {len(renewal_2026):,}")

# 筛选有效的续保单号
renewal_2026_with_no = renewal_2026[
    renewal_2026['续保单号'].notna() & (renewal_2026['续保单号'] != '')
]
print(f"2026年起保且有续保单号的保单数: {len(renewal_2026_with_no):,}")

# 续保单号集合
renewal_policy_nos = set(renewal_2026_with_no['续保单号'].unique())
print(f"唯一续保单号数: {len(renewal_policy_nos):,}")
print(f"样本续保单号（前5）:\n{list(renewal_policy_nos)[:5]}\n")

# ============================================================================
# 3. 匹配：2025年起保保单的 policy_no 在续保单号集合中
# ============================================================================
print("=" * 80)
print("3. 匹配逻辑：2025年起保保单的 policy_no 在 2026年续保单号集合中")
print("=" * 80)

# 已续保单：2025年起保保单的保单号在2026年续保单号集合中
renewed = expiring_2025[expiring_2025['保单号'].isin(renewal_policy_nos)]

print(f"已续保单数: {len(renewed):,}")
print(f"未续保单数: {len(expiring_2025) - len(renewed):,}")

# ============================================================================
# 4. 计算续保率
# ============================================================================
print("\n" + "=" * 80)
print("4. 续保率计算结果")
print("=" * 80)

due_for_renewal_count = len(expiring_2025)
renewed_count = len(renewed)
renewal_rate = renewed_count / due_for_renewal_count if due_for_renewal_count > 0 else 0

print(f"应续保单数（分母）: {due_for_renewal_count:,}")
print(f"已续保单数（分子）: {renewed_count:,}")
print(f"续保率: {renewal_rate:.2%}")

# ============================================================================
# 5. 详细验证示例
# ============================================================================
print("\n" + "=" * 80)
print("5. 详细验证示例（前10条已续保单）")
print("=" * 80)

if len(renewed) > 0:
    # 获取已续保单的详细信息
    renewed_details = renewed[['保单号', '保险起期', '保费', '业务员']].head(10)

    # 对于每个已续保单，找到对应的2026年保单
    for idx, row in renewed_details.iterrows():
        policy_no = row['保单号']
        # 在2026年保单中找到续保单号 = 当前保单号的记录
        new_policy = renewal_2026_with_no[renewal_2026_with_no['续保单号'] == policy_no]

        if len(new_policy) > 0:
            new_policy_row = new_policy.iloc[0]
            print(f"\n✅ 续保匹配成功:")
            print(f"   原保单号: {policy_no}")
            print(f"   原起保日: {row['保险起期'].strftime('%Y-%m-%d')}")
            print(f"   原保费: {row['保费']:,.2f}")
            print(f"   → 新保单号: {new_policy_row['保单号']}")
            print(f"   → 新起保日: {pd.to_datetime(new_policy_row['保险起期']).strftime('%Y-%m-%d')}")
            print(f"   → 新保费: {new_policy_row['保费']:,.2f}")
else:
    print("⚠️  没有找到已续保单")

# ============================================================================
# 6. 验证未续保单（为什么没续保？）
# ============================================================================
print("\n" + "=" * 80)
print("6. 未续保单分析（样本10条）")
print("=" * 80)

not_renewed = expiring_2025[~expiring_2025['保单号'].isin(renewal_policy_nos)]
if len(not_renewed) > 0:
    not_renewed_sample = not_renewed[['保单号', '保险起期', '保费', '业务员']].head(10)
    print(not_renewed_sample.to_string())

    # 检查这些保单号是否真的不在2026年续保单号中
    sample_policy_no = not_renewed.iloc[0]['保单号']
    print(f"\n检查第一个未续保单号 {sample_policy_no} 是否在2026年续保单号中:")
    print(f"   在续保单号集合中: {sample_policy_no in renewal_policy_nos}")
else:
    print("✅ 所有2025年起保保单都已续保！")

# ============================================================================
# 7. SQL逻辑对比
# ============================================================================
print("\n" + "=" * 80)
print("7. SQL逻辑验证")
print("=" * 80)

print("""
我们的SQL逻辑：
```sql
-- 应续保单：2025年起保
WITH expiring_policies AS (
  SELECT policy_no, premium
  FROM PolicyFactRenewal
  WHERE YEAR(insurance_start_date) = 2025
),

-- 2026年起保保单的续保单号集合
renewed_policy_nos AS (
  SELECT DISTINCT renewal_policy_no
  FROM PolicyFactRenewal
  WHERE YEAR(insurance_start_date) = 2026
    AND renewal_policy_no IS NOT NULL
    AND renewal_policy_no <> ''
),

-- 已续保单：应续保单中被续保的
renewed_policies AS (
  SELECT ep.*
  FROM expiring_policies ep
  INNER JOIN renewed_policy_nos rpn
    ON ep.policy_no = rpn.renewal_policy_no
)

SELECT
  COUNT(DISTINCT ep.policy_no) AS due_for_renewal_count,
  COUNT(DISTINCT rp.policy_no) AS renewed_count,
  COUNT(DISTINCT rp.policy_no) * 1.0 / COUNT(DISTINCT ep.policy_no) AS renewal_rate
FROM expiring_policies ep
LEFT JOIN renewed_policies rp ON ep.policy_no = rp.policy_no
```
""")

print(f"\nPython 计算结果:")
print(f"  应续保单数: {due_for_renewal_count:,}")
print(f"  已续保单数: {renewed_count:,}")
print(f"  续保率: {renewal_rate:.2%}")

print("\n✅ 计算完成！")
