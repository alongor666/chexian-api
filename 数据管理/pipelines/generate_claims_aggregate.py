#!/usr/bin/env python3
"""
从 ClaimsDetail Parquet 聚合到保单级 → claims/latest.parquet

保单级赔付聚合（替代旧的 claims 域 transform.py --domain claims）。
输出 3 列：policy_no, claim_cases, reported_claims。

用法：
  python3 generate_claims_aggregate.py -i warehouse/fact/claims_detail/latest.parquet -o warehouse/fact/claims/latest.parquet
"""

import argparse
import sys
from pathlib import Path

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)


def parse_args():
    parser = argparse.ArgumentParser(description='ClaimsDetail → 保单级赔付聚合')
    parser.add_argument('-i', '--input', required=True, help='输入 ClaimsDetail Parquet')
    parser.add_argument('-o', '--output', required=True, help='输出 claims/latest.parquet')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 ClaimsDetail → 保单级赔付聚合")
    print(f"{'='*80}")
    print(f"   输入: {input_file}")

    from pipelines.etl_validation import validate_input_path, validate_output_path, verify_non_empty
    input_file = validate_input_path(str(input_file))
    output_file = validate_output_path(str(output_file))

    import duckdb

    conn = duckdb.connect()
    safe_input = str(input_file).replace("'", "''")

    # 聚合：按 policy_no 统计赔案件数 + 已报告赔款(已决+未决)
    result = conn.execute(f"""
        SELECT
            policy_no,
            COUNT(DISTINCT claim_no) AS claim_cases,
            SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0)) AS reported_claims
        FROM read_parquet('{safe_input}')
        WHERE policy_no IS NOT NULL
        GROUP BY policy_no
        HAVING claim_cases > 0 OR reported_claims > 0
    """).fetchdf()

    print(f"   聚合: {len(result):,} 保单（从 ClaimsDetail）")
    print(f"   赔案件数合计: {result['claim_cases'].sum():,}")
    print(f"   已报告赔款合计: {result['reported_claims'].sum()/1e8:.2f} 亿元")

    conn.close()

    # 输出 Parquet
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        result, output_file,
        source_file=str(args.input),
        processing_mode="generate_claims_aggregate",
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

    # 验证
    import pandas as pd
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

    print(f"{'='*80}")
    print(f"✅ 完成")


if __name__ == '__main__':
    main()
