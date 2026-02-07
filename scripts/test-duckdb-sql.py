#!/usr/bin/env python3
"""
测试DuckDB中的续保率SQL查询
"""

import duckdb
from pathlib import Path

parquet_file = Path(__file__).parent.parent / "签单清洗" / "优化处理后的业务数据_v2.parquet"

print("=" * 80)
print("🦆 测试 DuckDB SQL 查询")
print("=" * 80)

# 创建DuckDB连接
conn = duckdb.connect(':memory:')

# 加载Parquet
print(f"\n1. 加载 Parquet 文件...")
conn.execute(f"CREATE TABLE raw_parquet AS SELECT * FROM read_parquet('{parquet_file}')")
print(f"   ✅ 加载完成")

# 检查列名
print(f"\n2. 检查列名...")
columns = conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'raw_parquet' ORDER BY ordinal_position").fetchall()
print(f"   列名: {[c[0] for c in columns]}")

# 创建 PolicyFactRenewal 视图（模拟前端逻辑）
print(f"\n3. 创建 PolicyFactRenewal 视图...")
create_view_sql = """
CREATE OR REPLACE VIEW PolicyFactRenewal AS
SELECT
  保单号 as policy_no,
  保费 as premium,
  签单日期 as policy_date,
  保险起期 as insurance_start_date,
  业务员 as salesman_name,
  三级机构 as org_level_3,
  客户类别 as customer_category,
  险类 as insurance_type,
  险别组合 as coverage_combination,
  是否续保 as is_renewal,
  是否新车 as is_new_car,
  是否过户车 as is_transfer,
  是否新能源 as is_nev,
  是否电销 as is_telemarketing,
  吨位分段 as tonnage_segment,
  续保单号 as renewal_policy_no,
  是否交商统保 as is_commercial_insure
FROM raw_parquet
GROUP BY 保单号, 保费, 签单日期, 保险起期, 业务员, 三级机构, 客户类别, 险类, 险别组合,
         是否续保, 是否新车, 是否过户车, 是否新能源, 是否电销, 吨位分段, 续保单号, 是否交商统保
"""
conn.execute(create_view_sql)
print(f"   ✅ 视图创建完成")

# 测试视图
print(f"\n4. 测试 PolicyFactRenewal 视图...")
count = conn.execute("SELECT COUNT(*) FROM PolicyFactRenewal").fetchone()[0]
print(f"   视图记录数: {count:,}")

# 测试续保单号字段
renewal_no_count = conn.execute("""
    SELECT
        COUNT(*) as total,
        COUNT(renewal_policy_no) as has_renewal_no,
        COUNT(CASE WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> '' THEN 1 END) as valid_renewal_no
    FROM PolicyFactRenewal
""").fetchone()
print(f"   总记录: {renewal_no_count[0]:,}")
print(f"   有续保单号: {renewal_no_count[1]:,}")
print(f"   有效续保单号: {renewal_no_count[2]:,}")

# 执行我们的续保率SQL
print(f"\n5. 执行续保率SQL查询（2026年）...")
renewal_sql = """
-- 应续保单：2025年起保的保单
WITH expiring_policies AS (
  SELECT
    policy_no,
    premium,
    salesman_name,
    org_level_3,
    customer_category,
    insurance_type,
    insurance_start_date
  FROM PolicyFactRenewal
  WHERE YEAR(CAST(insurance_start_date AS DATE)) = 2025
),

-- 2026年起保保单的续保单号集合
renewed_policy_nos AS (
  SELECT DISTINCT renewal_policy_no
  FROM PolicyFactRenewal
  WHERE YEAR(CAST(insurance_start_date AS DATE)) = 2026
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

-- 计算续保率
SELECT
  COUNT(DISTINCT ep.policy_no) AS due_for_renewal_count,
  COUNT(DISTINCT rp.policy_no) AS renewed_count,
  SUM(ep.premium) AS due_for_renewal_premium,
  SUM(rp.premium) AS renewed_premium,
  CASE
    WHEN COUNT(DISTINCT ep.policy_no) = 0 THEN 0
    ELSE COUNT(DISTINCT rp.policy_no) * 1.0 / COUNT(DISTINCT ep.policy_no)
  END AS renewal_rate,
  CASE
    WHEN SUM(ep.premium) = 0 THEN 0
    ELSE SUM(rp.premium) * 1.0 / SUM(ep.premium)
  END AS renewal_premium_rate
FROM expiring_policies ep
LEFT JOIN renewed_policies rp ON ep.policy_no = rp.policy_no
"""

result = conn.execute(renewal_sql).fetchone()

print(f"\n   ✅ 查询结果:")
print(f"      应续保单数: {result[0]:,}")
print(f"      已续保单数: {result[1]:,}")
print(f"      应续保保费: {result[2]:,.2f}")
print(f"      已续保保费: {result[3]:,.2f}")
print(f"      续保率（件数）: {result[4]:.2%}")
print(f"      续保率（保费）: {result[5]:.2%}")

# 对比Python计算结果
print(f"\n6. 对比Python计算结果...")
print(f"   Python: 应续保单数 533,686, 已续保单数 14,729, 续保率 2.76%")
print(f"   DuckDB: 应续保单数 {result[0]:,}, 已续保单数 {result[1]:,}, 续保率 {result[4]:.2%}")

if result[0] == 533686 and result[1] == 14729:
    print(f"   ✅ 结果一致！SQL逻辑正确")
else:
    print(f"   ❌ 结果不一致，需要检查SQL")

conn.close()
print(f"\n✅ 测试完成")
