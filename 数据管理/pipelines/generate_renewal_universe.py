#!/usr/bin/env python3
"""
续保宇宙 ETL — PolicyFact + Quotes + CustomerFlow → renewal_universe/latest.parquet

应续口径: 上年起保 + 交商同保(VIN级) + 排除摩托/挂车/拖拉机 + 排除退保(负保费)
方案: 本地 DuckDB 多表 JOIN 预计算扁平表，VPS 只加载

输出列(~31):
  VIN标识 | 2025保单代表行 | VIN级保费 | 续保状态 | 报价状态 | 竞争去向 | 漏斗派生

用法:
  python3 generate_renewal_universe.py \
    --policy-glob 'warehouse/fact/policy/current/*.parquet' \
    --quotes warehouse/fact/quotes/latest.parquet \
    --customer-flow warehouse/fact/customer_flow/latest.parquet \
    -o warehouse/fact/renewal_universe/latest.parquet \
    --due-year 2025
"""

import argparse
import sys
from pathlib import Path

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)


def parse_args():
    parser = argparse.ArgumentParser(description='续保宇宙 ETL (多源 JOIN 预计算)')
    parser.add_argument('--policy-glob', required=True,
                        help='PolicyFact parquet glob (e.g. warehouse/fact/policy/current/*.parquet)')
    parser.add_argument('--quotes', required=False, default=None,
                        help='报价 parquet (quotes/latest.parquet)')
    parser.add_argument('--customer-flow', required=False, default=None,
                        help='客户来源去向 parquet (customer_flow/latest.parquet)')
    parser.add_argument('-o', '--output', required=True, help='输出 parquet')
    parser.add_argument('--due-year', type=int, default=2025,
                        help='应续年份 (起保年，默认 2025)')
    return parser.parse_args()


# ── 商业险 insurance_type 值集 ──
COMMERCIAL_TYPES = "('商业险', '商业保险', '商车统保', '商业险+交强险')"
# ── 交强险 insurance_type 值集（含统保）──
COMPULSORY_TYPES = "('交强险', '商车统保', '商业险+交强险')"
# ── 排除客户类别 ──
EXCLUDED_CATEGORIES = "('摩托车', '挂车', '拖拉机')"


def build_sql(policy_glob: str, due_year: int,
              has_quotes: bool, has_customer_flow: bool) -> str:
    """构建续保宇宙主查询 SQL (DuckDB CTE 链)"""
    renewal_year = due_year + 1
    safe_glob = policy_glob.replace("'", "''")

    return f"""
    WITH
    -- ① 上年全量保单（含 expiry 计算）
    all_due_year AS (
        SELECT *,
            CAST(insurance_start_date AS DATE)
                + INTERVAL '1 year' - INTERVAL '1 day' AS expiry_date
        FROM read_parquet('{safe_glob}', union_by_name=true)
        WHERE YEAR(insurance_start_date) = {due_year}
          AND vehicle_frame_no IS NOT NULL
          AND TRIM(CAST(vehicle_frame_no AS VARCHAR)) != ''
    ),

    -- ② 交商同保资格：is_commercial_insure 标记 + 排除特殊类别 + 排除退保
    --    is_commercial_insure 是数据源层面原始标记，比 GROUP BY 双险种更准确
    vin_eligible AS (
        SELECT DISTINCT vehicle_frame_no
        FROM all_due_year
        WHERE customer_category NOT IN {EXCLUDED_CATEGORIES}
          AND premium > 0
          AND LOWER(TRIM(CAST(is_commercial_insure AS VARCHAR)))
              IN ('是', '1', 'true', 't', 'y', 'yes')
    ),

    -- ③ VIN 级保费聚合
    vin_premiums AS (
        SELECT
            vehicle_frame_no,
            SUM(CASE WHEN insurance_type IN {COMMERCIAL_TYPES}
                     THEN premium ELSE 0 END) AS commercial_premium,
            SUM(CASE WHEN insurance_type = '交强险'
                     THEN premium ELSE 0 END) AS compulsory_premium,
            SUM(premium) AS total_premium
        FROM all_due_year
        WHERE vehicle_frame_no IN (SELECT vehicle_frame_no FROM vin_eligible)
          AND premium > 0
        GROUP BY vehicle_frame_no
    ),

    -- ④ 每 VIN 选代表保单（仅商业险，保费最高）
    representative AS (
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY vehicle_frame_no
            ORDER BY premium DESC
        ) AS rn
        FROM all_due_year
        WHERE vehicle_frame_no IN (SELECT vehicle_frame_no FROM vin_eligible)
          AND premium > 0
          AND insurance_type IN {COMMERCIAL_TYPES}
    ),

    -- ⑤ 所有应续 VIN 的 policy_no 集（用于续保反查）
    vin_policy_nos AS (
        SELECT DISTINCT vehicle_frame_no, policy_no
        FROM all_due_year
        WHERE vehicle_frame_no IN (SELECT vehicle_frame_no FROM vin_eligible)
    ),

    -- ⑥ 次年续保反查：{renewal_year} 的 renewal_policy_no 指回 {due_year} policy_no
    renewed_raw AS (
        SELECT
            vpn.vehicle_frame_no,
            p_next.policy_no     AS renewed_policy_no,
            p_next.premium       AS renewed_premium,
            p_next.policy_date   AS renewed_date
        FROM vin_policy_nos vpn
        INNER JOIN (
            SELECT renewal_policy_no, policy_no, premium, policy_date
            FROM read_parquet('{safe_glob}', union_by_name=true)
            WHERE YEAR(insurance_start_date) = {renewal_year}
              AND renewal_policy_no IS NOT NULL
              AND TRIM(CAST(renewal_policy_no AS VARCHAR)) != ''
        ) p_next ON vpn.policy_no = p_next.renewal_policy_no
    ),

    renewed_per_vin AS (
        SELECT
            vehicle_frame_no,
            SUM(renewed_premium) AS renewed_premium,
            MIN(renewed_date)    AS renewed_date,
            FIRST(renewed_policy_no ORDER BY renewed_premium DESC) AS renewed_policy_no,
            COUNT(*)             AS renewed_count
        FROM renewed_raw
        GROUP BY vehicle_frame_no
    ),

    -- ⑦ 报价聚合（per VIN）
    quoted_per_vin AS (
        SELECT
            vehicle_frame_no AS quote_vin,
            MIN(quote_time)  AS first_quote_time,
            MAX(quote_time)  AS last_quote_time,
            COUNT(*)         AS quote_count,
            MAX(COALESCE(final_quote_premium, 0)) AS quote_premium
        FROM quotes_src
        WHERE vehicle_frame_no IS NOT NULL
          AND TRIM(CAST(vehicle_frame_no AS VARCHAR)) != ''
        GROUP BY vehicle_frame_no
    ),

    -- ⑧ 竞争去向（per VIN，取 next_insurer）
    competition AS (
        SELECT
            vehicle_frame_no AS comp_vin,
            FIRST(next_insurer) AS lost_to_insurer
        FROM customer_flow_src
        WHERE vehicle_frame_no IS NOT NULL
          AND TRIM(CAST(vehicle_frame_no AS VARCHAR)) != ''
          AND next_insurer IS NOT NULL
          AND TRIM(CAST(next_insurer AS VARCHAR)) != ''
        GROUP BY vehicle_frame_no
    )

    -- ⑨ 最终 JOIN
    SELECT
        r.vehicle_frame_no,
        r.policy_no,
        CAST(r.insurance_start_date AS DATE) AS insurance_start_date,
        CAST(r.expiry_date AS DATE)          AS expiry_date,
        EXTRACT(MONTH FROM r.expiry_date)::INTEGER AS expiry_month,
        vp.commercial_premium,
        vp.compulsory_premium,
        vp.total_premium,
        r.org_level_3,
        r.salesman_name,
        r.customer_category,
        r.coverage_combination,
        r.insurance_grade,
        COALESCE(r.is_new_car, false)        AS is_new_car,
        COALESCE(r.is_transfer, false)       AS is_transfer,
        COALESCE(r.is_nev, false)            AS is_nev,
        COALESCE(r.is_telemarketing, false)  AS is_telemarketing,
        r.tonnage_segment,

        -- 续保状态
        ren.renewed_policy_no IS NOT NULL    AS is_renewed,
        ren.renewed_policy_no,
        ren.renewed_premium,
        CAST(ren.renewed_date AS DATE)       AS renewed_date,

        -- 报价状态
        q.quote_vin IS NOT NULL              AS is_quoted,
        q.first_quote_time,
        q.last_quote_time,
        q.quote_count,
        q.quote_premium,

        -- 竞争去向
        c.lost_to_insurer,

        -- 漏斗阶段
        CASE
            WHEN ren.renewed_policy_no IS NOT NULL     THEN 'renewed'
            WHEN q.quote_vin IS NOT NULL               THEN 'quoted_not_renewed'
            ELSE 'not_quoted'
        END AS funnel_stage,

        -- 过期天数（正=已过期，负=未到期）
        DATE_DIFF('day', r.expiry_date, CURRENT_DATE) AS days_since_expiry,

        -- 行动优先级
        CASE
            WHEN r.expiry_date <= CURRENT_DATE
                 AND ren.renewed_policy_no IS NULL
                 AND q.quote_vin IS NOT NULL            THEN 'P1'
            WHEN r.expiry_date <= CURRENT_DATE
                 AND ren.renewed_policy_no IS NULL
                 AND q.quote_vin IS NULL                THEN 'P2'
            WHEN r.expiry_date > CURRENT_DATE
                 AND r.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'P3'
            ELSE 'P4'
        END AS action_priority

    FROM representative r
    INNER JOIN vin_premiums vp  ON r.vehicle_frame_no = vp.vehicle_frame_no
    LEFT  JOIN renewed_per_vin ren ON r.vehicle_frame_no = ren.vehicle_frame_no
    LEFT  JOIN quoted_per_vin q    ON r.vehicle_frame_no = q.quote_vin
    LEFT  JOIN competition c       ON r.vehicle_frame_no = c.comp_vin
    WHERE r.rn = 1
    """


def main():
    args = parse_args()
    output_file = Path(args.output)
    policy_glob = args.policy_glob
    due_year = args.due_year

    print(f"{'='*80}")
    print(f"📋 续保宇宙 ETL — {due_year} 年应续保单预计算")
    print(f"{'='*80}")
    print(f"   保单源: {policy_glob}")

    from pipelines.etl_validation import validate_output_path, verify_non_empty, safe_pct
    output_file = validate_output_path(str(output_file))

    import duckdb
    conn = duckdb.connect()
    try:
        # ── 注册可选数据源（缺失则创建空占位 VIEW）──

        has_quotes = False
        if args.quotes and Path(args.quotes).exists():
            safe_q = str(Path(args.quotes)).replace("'", "''")
            conn.execute(f"CREATE VIEW quotes_src AS SELECT * FROM read_parquet('{safe_q}')")
            qc = conn.execute("SELECT COUNT(*) FROM quotes_src").fetchone()[0]
            print(f"   报价源: {args.quotes} ({qc:,} 行)")
            has_quotes = True
        else:
            conn.execute("""
                CREATE VIEW quotes_src AS
                SELECT NULL::VARCHAR AS vehicle_frame_no,
                       NULL::TIMESTAMP AS quote_time,
                       0.0::DOUBLE AS final_quote_premium
                WHERE false
            """)
            print(f"   ⚠ 报价数据不可用，跳过报价 JOIN")

        has_customer_flow = False
        if args.customer_flow and Path(args.customer_flow).exists():
            safe_cf = str(Path(args.customer_flow)).replace("'", "''")
            conn.execute(f"CREATE VIEW customer_flow_src AS SELECT * FROM read_parquet('{safe_cf}')")
            cfc = conn.execute("SELECT COUNT(*) FROM customer_flow_src").fetchone()[0]
            print(f"   客户来源去向: {args.customer_flow} ({cfc:,} 行)")
            has_customer_flow = True
        else:
            conn.execute("""
                CREATE VIEW customer_flow_src AS
                SELECT NULL::VARCHAR AS vehicle_frame_no,
                       NULL::VARCHAR AS next_insurer
                WHERE false
            """)
            print(f"   ⚠ 客户来源去向不可用，跳过竞争 JOIN")

        # ── 执行主查询 ──

        sql = build_sql(policy_glob, due_year, has_quotes, has_customer_flow)
        print(f"\n   执行续保宇宙查询...")
        result = conn.execute(sql).fetchdf()
    except duckdb.Error as e:
        print(f"   ❌ DuckDB 执行失败: {e}")
        sys.exit(1)
    finally:
        conn.close()

    print(f"   结果: {len(result):,} VINs × {len(result.columns)} 列")

    # ── 统计 & 基准对照 ──

    total = len(result)
    renewed = int(result['is_renewed'].sum())
    quoted = int(result['is_quoted'].sum())

    print(f"\n   === 续保宇宙概览 ===")
    print(f"   应续 VINs: {total:,}")
    print(f"   已续保: {renewed:,} ({safe_pct(renewed, total):.1f}%)")
    print(f"   已报价: {quoted:,} ({safe_pct(quoted, total):.1f}%)")

    # 漏斗分布
    funnel = result['funnel_stage'].value_counts()
    for stage, cnt in funnel.items():
        print(f"   {stage}: {cnt:,} ({safe_pct(cnt, total):.1f}%)")

    # 行动优先级
    priority = result['action_priority'].value_counts().sort_index()
    for p, cnt in priority.items():
        print(f"   {p}: {cnt:,}")

    # 机构分布 TOP5
    if 'org_level_3' in result.columns:
        org_top = result.groupby('org_level_3').size().nlargest(5)
        print(f"\n   机构 TOP5: {org_top.to_dict()}")

    # 竞争去向 TOP5
    if has_customer_flow:
        lost_to = result[result['lost_to_insurer'].notna()]['lost_to_insurer'].value_counts().head(5)
        if len(lost_to) > 0:
            print(f"   流失去向 TOP5: {lost_to.to_dict()}")

    # ── 月度到期分布 ──
    monthly = result.groupby('expiry_month').agg(
        due=('vehicle_frame_no', 'count'),
        renewed=('is_renewed', 'sum'),
        quoted=('is_quoted', 'sum'),
    )
    print(f"\n   === 月度到期分布 ===")
    for month, row in monthly.iterrows():
        rr = safe_pct(row['renewed'], row['due'])
        qr = safe_pct(row['quoted'], row['due'])
        print(f"   {int(month):2d}月: 应续 {int(row['due']):,} | "
              f"已续 {int(row['renewed']):,}({rr:.1f}%) | "
              f"已报价 {int(row['quoted']):,}({qr:.1f}%)")

    # ── 输出 Parquet ──

    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        result, output_file,
        source_file=f"policy/current/*.parquet + quotes + customer_flow",
        processing_mode="generate_renewal_universe",
        extra_metadata={
            "due_year": str(due_year),
            "total_vins": str(total),
            "renewed_count": str(renewed),
            "quoted_count": str(quoted),
        },
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

    # ── 验证 ──
    import pandas as pd
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

    print(f"{'='*80}")
    print(f"✅ 完成 — 续保宇宙 {total:,} VINs")


if __name__ == '__main__':
    main()
