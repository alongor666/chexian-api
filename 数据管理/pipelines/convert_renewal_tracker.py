#!/usr/bin/env python3
"""
续保追踪派生域 ETL（policy + quotes_conversion + salesman → renewal_tracker）

派生域：不读 xlsx，只 JOIN 现有 parquet 产出 renewal_tracker/latest.parquet。

Universe 口径：
  商业险 + insurance_start_date ∈ [SOURCE_YEAR-01-01, SOURCE_YEAR-12-31]
         + insurance_end_date   ∈ [RENEWAL_YEAR-01-01, RENEWAL_YEAR-12-31]
         + vehicle_frame_no NOT NULL

续保匹配：dual-key = (source_policy_no, vehicle_frame_no)
报价窗口：quote_time >= QUOTE_WINDOW_START

用法：
  python3 convert_renewal_tracker.py -o warehouse/fact/renewal_tracker/latest.parquet
  python3 convert_renewal_tracker.py -o ... --quote-window-start 2025-12-03
"""

import argparse
import sys
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parent

DEFAULT_POLICY_GLOB = str(DATA_ROOT / "warehouse" / "fact" / "policy" / "current" / "*.parquet")
DEFAULT_QUOTES_PATH = str(DATA_ROOT / "warehouse" / "fact" / "quotes_conversion" / "latest.parquet")
DEFAULT_SALESMAN_PATH = str(DATA_ROOT / "warehouse" / "dim" / "salesman" / "latest.parquet")

DEFAULT_QUOTE_WINDOW_START = "2025-12-03"
DEFAULT_SOURCE_YEAR = 2025
DEFAULT_RENEWAL_YEAR = 2026


def main():
    ap = argparse.ArgumentParser(description="续保追踪派生域 ETL")
    ap.add_argument("-o", "--output", required=True, help="输出 parquet 路径")
    ap.add_argument("--policy-glob", default=DEFAULT_POLICY_GLOB, help="保单 parquet glob")
    ap.add_argument("--quotes-path", default=DEFAULT_QUOTES_PATH, help="报价转化 parquet 路径")
    ap.add_argument("--salesman-path", default=DEFAULT_SALESMAN_PATH, help="业务员维度表 parquet 路径")
    ap.add_argument("--quote-window-start", default=DEFAULT_QUOTE_WINDOW_START,
                    help=f"报价窗口起点（YYYY-MM-DD），默认 {DEFAULT_QUOTE_WINDOW_START}")
    ap.add_argument("--source-year", type=int, default=DEFAULT_SOURCE_YEAR,
                    help=f"源保单起保年度，默认 {DEFAULT_SOURCE_YEAR}")
    ap.add_argument("--renewal-year", type=int, default=DEFAULT_RENEWAL_YEAR,
                    help=f"续保到期年度，默认 {DEFAULT_RENEWAL_YEAR}")
    args = ap.parse_args()

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("续保追踪派生域 ETL（policy + quotes_conversion + salesman → renewal_tracker）")
    print("=" * 80)
    print(f"   保单 glob:    {args.policy_glob}")
    print(f"   报价 parquet: {args.quotes_path}")
    print(f"   业务员维度:   {args.salesman_path}")
    print(f"   源年度/续保年度: {args.source_year} → {args.renewal_year}")
    print(f"   报价窗口起点: {args.quote_window_start}")
    print(f"   输出:         {out_path}")

    # 依赖检查
    for p in (args.quotes_path, args.salesman_path):
        if not Path(p).exists():
            print(f"❌ 依赖文件缺失: {p}")
            sys.exit(1)

    con = duckdb.connect(":memory:")
    con.execute("SET memory_limit='2GB'")

    # Step 1: base — 源年度起保的商业险 + 续保年度到期
    # 字符串维度字段统一 TRIM（治理计划 Phase 4，BACKLOG 9e1816）：
    # 上游 policy ETL 对这些列无 strip 机制保证（transform.py 只 strip 保单号等特定列），
    # 历史曾出现 customer_category='摩托车' 带尾空格的重复键（21 行）；防御性 TRIM
    # 同时让 salesman_name JOIN salesman_dim.full_name 的匹配不受脏空格干扰
    print("\n📊 Step 1: 构建 base（源年度起保 + 续保年度到期商业险）...")
    con.execute(f"""
        CREATE OR REPLACE TABLE base AS
        SELECT
            policy_no AS source_policy_no,
            vehicle_frame_no,
            insurance_start_date,
            insurance_end_date AS expiry_date,
            MONTH(insurance_end_date) AS expiry_month,
            (insurance_start_date + INTERVAL '1 year' - INTERVAL '1 day') AS expected_expiry_date,
            TRIM(org_level_3) AS org_level_3,
            TRIM(customer_category) AS customer_category,
            TRIM(salesman_name) AS salesman_name,
            TRIM(coverage_combination) AS coverage_combination,
            is_nev,
            is_new_car,
            is_transfer,
            is_renewal
        FROM read_parquet('{args.policy_glob}')
        WHERE insurance_type = '商业保险'
          AND insurance_start_date >= DATE '{args.source_year}-01-01'
          AND insurance_start_date <= DATE '{args.source_year}-12-31'
          AND vehicle_frame_no IS NOT NULL
          AND vehicle_frame_no != ''
          AND insurance_end_date >= DATE '{args.renewal_year}-01-01'
          AND insurance_end_date <= DATE '{args.renewal_year}-12-31'
    """)
    base_rows = con.execute("SELECT COUNT(*) FROM base").fetchone()[0]
    base_vins = con.execute("SELECT COUNT(DISTINCT vehicle_frame_no) FROM base").fetchone()[0]
    print(f"   base 行数: {base_rows:,} / 去重 VIN: {base_vins:,}")

    # Step 2: renewed — dual-key (policy_no + VIN) 匹配续保链
    print("\n📊 Step 2: 构建 renewed（dual-key: policy_no + VIN）...")
    con.execute(f"""
        CREATE OR REPLACE TABLE renewed AS
        SELECT DISTINCT
            r.renewal_policy_no AS source_policy_no,
            r.vehicle_frame_no,
            r.policy_no AS renewed_policy_no,
            r.insurance_start_date AS renewed_date
        FROM read_parquet('{args.policy_glob}') r
        WHERE r.insurance_type = '商业保险'
          AND r.is_renewal = true
          AND r.insurance_start_date >= DATE '{args.renewal_year}-01-01'
          AND r.insurance_start_date <= DATE '{args.renewal_year}-12-31'
          AND r.vehicle_frame_no IS NOT NULL
          AND r.vehicle_frame_no != ''
    """)
    renewed_rows = con.execute("SELECT COUNT(*) FROM renewed").fetchone()[0]
    print(f"   renewed 行数: {renewed_rows:,}")

    # Step 3: quoted — 报价窗口内按 VIN 聚合
    print(f"\n📊 Step 3: 构建 quoted（窗口起点 {args.quote_window_start}）...")
    con.execute(f"""
        CREATE OR REPLACE TABLE quoted AS
        SELECT
            vehicle_frame_no,
            MIN(quote_time) AS first_quote_time,
            MAX(quote_time) AS last_quote_time,
            COUNT(*) AS quote_count
        FROM read_parquet('{args.quotes_path}')
        WHERE insurance_type = '商业保险'
          AND CAST(quote_time AS DATE) >= DATE '{args.quote_window_start}'
          AND vehicle_frame_no IS NOT NULL
          AND vehicle_frame_no != ''
        GROUP BY vehicle_frame_no
    """)
    quoted_vins = con.execute("SELECT COUNT(*) FROM quoted").fetchone()[0]
    print(f"   quoted 去重 VIN: {quoted_vins:,}")

    # Step 4: salesman dim
    print("\n📊 Step 4: 构建 salesman_dim...")
    con.execute(f"""
        CREATE OR REPLACE TABLE salesman_dim AS
        SELECT full_name, team, organization
        FROM read_parquet('{args.salesman_path}')
    """)

    # Step 5: LEFT JOIN 四表，写 parquet
    # 派生维度字段：
    #   fuel_category: is_nev → 电 / 油（本期两分，气需专用字段，暂跳过）
    #   used_transfer_type: 新车 / 旧车过户 / 旧车非过户
    #   renewal_type:       新车 / 续保 / 转保
    print(f"\n📊 Step 5: JOIN 生成 universe → {out_path.name}...")
    con.execute(f"""
        COPY (
            SELECT
                b.source_policy_no,
                b.vehicle_frame_no,
                b.expiry_date,
                b.expiry_month,
                b.expected_expiry_date,
                b.org_level_3,
                COALESCE(s.team, '直管') AS team_name,
                b.salesman_name,
                b.customer_category,
                b.coverage_combination,
                CASE WHEN b.is_nev THEN '电' ELSE '油' END AS fuel_category,
                b.is_nev,
                b.is_new_car,
                b.is_transfer,
                b.is_renewal,
                CASE
                    WHEN b.is_new_car THEN '新车'
                    WHEN b.is_transfer THEN '旧车过户'
                    ELSE '旧车非过户'
                END AS used_transfer_type,
                CASE
                    WHEN b.is_new_car THEN '新车'
                    WHEN b.is_renewal THEN '续保'
                    ELSE '转保'
                END AS renewal_type,
                CASE WHEN r.renewed_policy_no IS NOT NULL THEN true ELSE false END AS is_renewed,
                r.renewed_policy_no,
                r.renewed_date,
                CASE WHEN q.first_quote_time IS NOT NULL THEN true ELSE false END AS is_quoted,
                q.first_quote_time,
                q.quote_count
            FROM base b
            LEFT JOIN renewed r
                ON r.source_policy_no = b.source_policy_no
                AND r.vehicle_frame_no = b.vehicle_frame_no
            LEFT JOIN quoted q
                ON b.vehicle_frame_no = q.vehicle_frame_no
            LEFT JOIN salesman_dim s
                ON b.salesman_name = s.full_name
        ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION 'zstd');
    """)

    # 校验 + 数据概览
    verify = con.execute(
        f"SELECT COUNT(*), COUNT(DISTINCT vehicle_frame_no), "
        f"SUM(CAST(is_renewed AS INT)), SUM(CAST(is_quoted AS INT)) "
        f"FROM read_parquet('{out_path}')"
    ).fetchone()

    print("\n   === 数据概览 ===")
    print(f"   记录数:     {verify[0]:,}")
    print(f"   去重 VIN:   {verify[1]:,}")
    print(f"   已续件数:   {verify[2] or 0:,}")
    print(f"   已报价件数: {verify[3] or 0:,}")
    if verify[1]:
        renewed_rate = (verify[2] or 0) / verify[1] * 100
        quoted_rate = (verify[3] or 0) / verify[1] * 100
        print(f"   续保率:     {renewed_rate:.1f}%")
        print(f"   报价率:     {quoted_rate:.1f}%")

    con.close()
    print(f"\n✅ renewal_tracker 派生域 ETL 完成")


if __name__ == "__main__":
    main()
