#!/usr/bin/env python3
"""
维修合作网络质量 P0 验证脚本

用途：
- 直查 RepairDim 与 ClaimsDetail 的 Parquet 源数据
- 输出合作网络质量的首版治理底表
- 在不改 API / 页面前，先把 shadow、金额、JOIN 聚合口径校准

示例：
  python3 scripts/verify-repair-network.py --window rolling12 --top-n 10
  python3 scripts/verify-repair-network.py --window ytd --top-n 10
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: 需要安装 duckdb: pip3 install duckdb", file=sys.stderr)
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPAIR_PATH = PROJECT_ROOT / "数据管理/warehouse/dim/repair/latest.parquet"
CLAIMS_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")


def fi(value: object) -> str:
    if value is None:
        return "-"
    try:
        return f"{int(value):,}"
    except Exception:
        return str(value)


def fp(value: object, digits: int = 2) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value):,.{digits}f}"
    except Exception:
        return str(value)


def pct(value: object, digits: int = 2) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value) * 100:,.{digits}f}%"
    except Exception:
        return str(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="维修合作网络质量 P0 验证")
    parser.add_argument(
        "--window",
        default="rolling12",
        choices=["rolling12", "ytd", "all"],
        help="时间窗口，基于 ClaimsDetail.accident_time 计算",
    )
    parser.add_argument("--top-n", type=int, default=10, help="榜单行数")
    parser.add_argument("--org", help="可选，限定某个 repair org_level_3")
    return parser.parse_args()


def build_claims_window(window: str) -> str:
    if window == "all":
        return "1=1"
    if window == "ytd":
        return "YEAR(accident_time) = YEAR((SELECT MAX(accident_time) FROM claims_all))"
    return "accident_time >= (SELECT MAX(accident_time) FROM claims_all) - INTERVAL 12 MONTH"


def setup_views(con: duckdb.DuckDBPyConnection, org: str | None, window: str) -> None:
    if not REPAIR_PATH.exists():
        raise SystemExit(f"找不到维修资源文件: {REPAIR_PATH}")

    org_filter = ""
    if org:
        escaped = org.replace("'", "''")
        org_filter = f" AND org_level_3 = '{escaped}'"

    con.execute(
        f"""
        CREATE OR REPLACE VIEW repair_all AS
        SELECT
          COALESCE(shop_code, SUBSTR(repair_shop_name, 1, 8)) AS shop_code,
          repair_shop_name,
          org_level_3,
          cooperation_status,
          CASE
            WHEN cooperation_status = '1生效中' THEN 'active'
            WHEN cooperation_status IN ('0暂停合作', '7已撤销', '8失效') THEN 'past'
            ELSE 'none'
          END AS coop_tier,
          COALESCE(is_4s_shop, false) AS is_4s_shop,
          province,
          city,
          district,
          COALESCE(damage_assessment_amount, 0) AS damage_assessment_amount,
          COALESCE(net_premium, 0) AS net_premium,
          CASE
            WHEN repair_shop_name IS NULL THEN 'missing_name'
            WHEN TRIM(repair_shop_name) = '' THEN 'missing_name'
            WHEN repair_shop_name = '无' THEN 'exact_no'
            WHEN repair_shop_name LIKE '%自选%' THEN 'self_selected'
            WHEN repair_shop_name LIKE '%无车损%' OR repair_shop_name LIKE '%无损失%' THEN 'no_vehicle_damage'
            WHEN repair_shop_name LIKE '%外观定损%' THEN 'appearance_assessment'
            WHEN repair_shop_name LIKE '%现场定损%' THEN 'field_assessment'
            WHEN repair_shop_name LIKE '%定损%' THEN 'damage_assessment'
            ELSE NULL
          END AS exclusion_reason
        FROM read_parquet('{REPAIR_PATH.as_posix()}')
        WHERE repair_shop_name IS NOT NULL
          AND COALESCE(shop_code, SUBSTR(repair_shop_name, 1, 8)) IS NOT NULL
        """
    )

    con.execute(
        """
        CREATE OR REPLACE VIEW repair_effective_all AS
        SELECT *
        FROM repair_all
        WHERE exclusion_reason IS NULL
        """
    )

    con.execute(
        f"""
        CREATE OR REPLACE VIEW repair_base AS
        SELECT *
        FROM repair_effective_all
        WHERE 1=1
          {org_filter}
        """
    )

    con.execute(
        """
        CREATE OR REPLACE VIEW process_excluded_all AS
        SELECT *
        FROM repair_all
        WHERE exclusion_reason IS NOT NULL
        """
    )

    con.execute(
        f"""
        CREATE OR REPLACE VIEW process_excluded_shops AS
        SELECT *
        FROM process_excluded_all
        WHERE 1=1
          {org_filter}
        """
    )

    con.execute(
        f"""
        CREATE OR REPLACE VIEW claims_all AS
        SELECT
          claim_no,
          policy_no,
          subject_shop_code,
          subject_repair_shop,
          accident_district AS accident_district_raw,
          NULLIF(REGEXP_REPLACE(CAST(accident_district AS VARCHAR), '^[0-9]+', ''), '') AS accident_district,
          CAST(accident_time AS DATE) AS accident_time,
          COALESCE(settled_vehicle_amount, 0) AS vehicle_settled_amount,
          COALESCE(settled_amount, 0) AS settled_amount_check,
          CASE
            WHEN subject_repair_shop IS NULL THEN NULL
            WHEN subject_repair_shop LIKE '%自选%' THEN 'self_selected'
            WHEN subject_repair_shop LIKE '%无车损%' OR subject_repair_shop LIKE '%无损失%' THEN 'no_vehicle_damage'
            WHEN subject_repair_shop LIKE '%外观定损%' THEN 'appearance_assessment'
            WHEN subject_repair_shop LIKE '%现场定损%' THEN 'field_assessment'
            WHEN subject_repair_shop LIKE '%定损%' THEN 'damage_assessment'
            ELSE NULL
          END AS claim_exclusion_reason
        FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)
        WHERE subject_shop_code IS NOT NULL
          AND accident_time IS NOT NULL
        """
    )

    claims_window = build_claims_window(window)
    con.execute(
        f"""
        CREATE OR REPLACE VIEW claims_scope AS
        SELECT *
        FROM claims_all
        WHERE {claims_window}
        """
    )

    con.execute(
        """
        CREATE OR REPLACE VIEW claim_shop_classification AS
        SELECT
          c.*,
          CASE
            WHEN c.claim_exclusion_reason IS NOT NULL THEN 'excluded_process_shop'
            WHEN c.subject_shop_code IN (SELECT DISTINCT shop_code FROM process_excluded_all) THEN 'excluded_process_shop'
            WHEN c.subject_shop_code IN (SELECT DISTINCT shop_code FROM repair_effective_all) THEN 'effective_registered'
            WHEN c.subject_shop_code IN (SELECT DISTINCT shop_code FROM repair_all) THEN 'registered_not_effective'
            ELSE 'unregistered_shadow'
          END AS shop_class
        FROM claims_scope c
        """
    )


def fetch_overview(con: duckdb.DuckDBPyConnection):
    return con.execute(
        """
        WITH registered_stats AS (
          SELECT
            COUNT(DISTINCT shop_code) AS registered_shop_count,
            COUNT(DISTINCT CASE WHEN exclusion_reason IS NOT NULL THEN shop_code END) AS process_excluded_shop_count
          FROM repair_all
        ),
        repair_stats AS (
          SELECT
            COUNT(DISTINCT shop_code) AS effective_shop_count,
            COUNT(DISTINCT CASE WHEN coop_tier = 'active' THEN shop_code END) AS active_shop_count,
            COUNT(DISTINCT CASE WHEN coop_tier <> 'active' THEN shop_code END) AS risk_shop_count,
            COUNT(DISTINCT CASE WHEN is_4s_shop THEN shop_code END) AS shop_4s_count,
            SUM(damage_assessment_amount) AS total_damage_amount,
            SUM(net_premium) AS total_net_premium
          FROM repair_base
        ),
        claim_stats AS (
          SELECT COUNT(DISTINCT claim_no) AS total_claim_count
          FROM claims_scope
        ),
        class_stats AS (
          SELECT
            COUNT(DISTINCT CASE WHEN shop_class = 'effective_registered' THEN claim_no END) AS effective_registered_claims,
            COUNT(DISTINCT CASE WHEN shop_class = 'excluded_process_shop' THEN claim_no END) AS excluded_process_claims,
            COUNT(DISTINCT CASE WHEN shop_class = 'unregistered_shadow' THEN claim_no END) AS unregistered_shadow_claims,
            COUNT(DISTINCT CASE WHEN shop_class = 'unregistered_shadow' THEN subject_shop_code END) AS unregistered_shadow_shops
          FROM claim_shop_classification
        ),
        local_stats AS (
          SELECT
            COUNT(DISTINCT c.claim_no) AS total_joined_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district = r.district THEN c.claim_no END) AS local_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district_raw = r.district THEN c.claim_no END) AS raw_local_claims
          FROM repair_base r
          LEFT JOIN claims_scope c ON c.subject_shop_code = r.shop_code
        )
        SELECT
          registered_shop_count,
          effective_shop_count,
          process_excluded_shop_count,
          active_shop_count,
          risk_shop_count,
          CASE WHEN effective_shop_count > 0 THEN active_shop_count * 1.0 / effective_shop_count END AS active_rate,
          CASE WHEN effective_shop_count > 0 THEN risk_shop_count * 1.0 / effective_shop_count END AS risk_rate,
          shop_4s_count,
          CASE WHEN effective_shop_count > 0 THEN shop_4s_count * 1.0 / effective_shop_count END AS repair_4s_share,
          total_claim_count,
          effective_registered_claims,
          excluded_process_claims,
          CASE WHEN total_claim_count > 0 THEN excluded_process_claims * 1.0 / total_claim_count END AS excluded_process_claim_share,
          unregistered_shadow_shops,
          unregistered_shadow_claims,
          CASE WHEN total_claim_count > 0 THEN unregistered_shadow_claims * 1.0 / total_claim_count END AS unregistered_shadow_claim_share,
          total_damage_amount,
          total_net_premium,
          CASE WHEN total_net_premium > 0 THEN total_damage_amount * 1.0 / total_net_premium END AS repair_to_premium_ratio,
          total_joined_claims,
          local_claims,
          CASE WHEN total_joined_claims > 0 THEN local_claims * 1.0 / total_joined_claims END AS local_resource_ratio,
          raw_local_claims,
          CASE WHEN total_joined_claims > 0 THEN raw_local_claims * 1.0 / total_joined_claims END AS raw_local_resource_ratio
        FROM registered_stats, repair_stats, claim_stats, class_stats, local_stats
        """
    ).fetchdf()


def fetch_org_ranking(con: duckdb.DuckDBPyConnection):
    return con.execute(
        """
        WITH resource_agg AS (
          SELECT
            org_level_3,
            COUNT(DISTINCT shop_code) AS shop_count,
            COUNT(DISTINCT CASE WHEN coop_tier = 'active' THEN shop_code END) AS active_shop_count,
            SUM(damage_assessment_amount) AS damage_amount,
            SUM(net_premium) AS net_premium
          FROM repair_base
          WHERE org_level_3 IS NOT NULL
          GROUP BY org_level_3
        ),
        claim_agg AS (
          SELECT
            r.org_level_3,
            COUNT(DISTINCT c.claim_no) AS total_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district = r.district THEN c.claim_no END) AS local_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district_raw = r.district THEN c.claim_no END) AS raw_local_claims
          FROM repair_base r
          LEFT JOIN claims_scope c ON c.subject_shop_code = r.shop_code
          WHERE r.org_level_3 IS NOT NULL
          GROUP BY r.org_level_3
        )
        SELECT
          r.org_level_3,
          r.shop_count,
          ROUND(r.active_shop_count * 1.0 / NULLIF(r.shop_count, 0), 4) AS active_rate,
          ROUND(r.damage_amount, 2) AS damage_amount,
          ROUND(r.net_premium, 2) AS net_premium,
          ROUND(r.damage_amount * 1.0 / NULLIF(r.net_premium, 0), 4) AS repair_to_premium_ratio,
          c.total_claims,
          c.local_claims,
          ROUND(c.local_claims * 1.0 / NULLIF(c.total_claims, 0), 4) AS local_resource_ratio,
          ROUND(c.raw_local_claims * 1.0 / NULLIF(c.total_claims, 0), 4) AS raw_local_resource_ratio
        FROM resource_agg r
        LEFT JOIN claim_agg c ON c.org_level_3 = r.org_level_3
        ORDER BY active_rate DESC NULLS LAST, repair_to_premium_ratio DESC NULLS LAST, net_premium DESC NULLS LAST
        """
    ).fetchdf()


def fetch_4s_compare(con: duckdb.DuckDBPyConnection):
    return con.execute(
        """
        WITH base AS (
          SELECT
            CASE WHEN is_4s_shop THEN '4S' ELSE '非4S' END AS shop_type,
            shop_code,
            coop_tier,
            district,
            damage_assessment_amount,
            net_premium
          FROM repair_base
        ),
        resource_agg AS (
          SELECT
            shop_type,
            COUNT(DISTINCT shop_code) AS shop_count,
            COUNT(DISTINCT CASE WHEN coop_tier = 'active' THEN shop_code END) AS active_shop_count,
            SUM(damage_assessment_amount) AS damage_amount,
            SUM(net_premium) AS net_premium
          FROM base
          GROUP BY shop_type
        ),
        claim_agg AS (
          SELECT
            b.shop_type,
            COUNT(DISTINCT c.claim_no) AS total_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district = b.district THEN c.claim_no END) AS local_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district_raw = b.district THEN c.claim_no END) AS raw_local_claims
          FROM base b
          LEFT JOIN claims_scope c ON c.subject_shop_code = b.shop_code
          GROUP BY b.shop_type
        )
        SELECT
          r.shop_type,
          r.shop_count,
          ROUND(r.active_shop_count * 1.0 / NULLIF(r.shop_count, 0), 4) AS active_rate,
          ROUND(r.net_premium / NULLIF(r.shop_count, 0), 2) AS avg_net_premium_per_shop,
          ROUND(r.damage_amount / NULLIF(r.shop_count, 0), 2) AS avg_damage_amount_per_shop,
          ROUND(r.net_premium, 2) AS net_premium,
          ROUND(r.damage_amount, 2) AS damage_amount,
          ROUND(r.damage_amount * 1.0 / NULLIF(r.net_premium, 0), 4) AS repair_to_premium_ratio,
          c.total_claims,
          c.local_claims,
          ROUND(c.local_claims * 1.0 / NULLIF(c.total_claims, 0), 4) AS local_resource_ratio,
          ROUND(c.raw_local_claims * 1.0 / NULLIF(c.total_claims, 0), 4) AS raw_local_resource_ratio
        FROM resource_agg r
        LEFT JOIN claim_agg c ON c.shop_type = r.shop_type
        ORDER BY r.shop_type
        """
    ).fetchdf()


def fetch_low_local_districts(con: duckdb.DuckDBPyConnection, top_n: int):
    return con.execute(
        f"""
        WITH district_stats AS (
          SELECT
            r.org_level_3,
            r.district AS shop_district,
            COUNT(DISTINCT r.shop_code) AS shop_count,
            COUNT(DISTINCT c.claim_no) AS total_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district = r.district THEN c.claim_no END) AS local_claims,
            COUNT(DISTINCT CASE WHEN c.accident_district_raw = r.district THEN c.claim_no END) AS raw_local_claims
          FROM repair_base r
          LEFT JOIN claims_scope c ON c.subject_shop_code = r.shop_code
          WHERE r.district IS NOT NULL
          GROUP BY r.org_level_3, r.district
        )
        SELECT
          org_level_3,
          shop_district,
          shop_count,
          total_claims,
          local_claims,
          ROUND(local_claims * 1.0 / NULLIF(total_claims, 0), 4) AS local_resource_ratio,
          ROUND(raw_local_claims * 1.0 / NULLIF(total_claims, 0), 4) AS raw_local_resource_ratio
        FROM district_stats
        WHERE total_claims > 0
        ORDER BY local_resource_ratio ASC NULLS LAST, total_claims DESC
        LIMIT {top_n}
        """
    ).fetchdf()


def fetch_risk_shops(con: duckdb.DuckDBPyConnection, top_n: int):
    return con.execute(
        f"""
        SELECT
          org_level_3,
          shop_code,
          repair_shop_name,
          coop_tier,
          CASE WHEN is_4s_shop THEN '4S' ELSE '非4S' END AS shop_type,
          district,
          ROUND(net_premium, 2) AS net_premium,
          ROUND(damage_assessment_amount, 2) AS damage_assessment_amount,
          ROUND(damage_assessment_amount * 1.0 / NULLIF(net_premium, 0), 4) AS repair_to_premium_ratio
        FROM repair_base
        WHERE coop_tier <> 'active'
        ORDER BY net_premium DESC NULLS LAST, damage_assessment_amount DESC NULLS LAST
        LIMIT {top_n}
        """
    ).fetchdf()


def fetch_unregistered_shadow_shops(con: duckdb.DuckDBPyConnection, top_n: int):
    return con.execute(
        f"""
        SELECT
          c.subject_shop_code AS shop_code,
          ANY_VALUE(c.subject_repair_shop) AS subject_repair_shop,
          COUNT(DISTINCT c.claim_no) AS claim_count,
          ROUND(SUM(c.vehicle_settled_amount), 2) AS vehicle_settled_amount,
          ROUND(SUM(c.settled_amount_check), 2) AS settled_amount_check,
          ANY_VALUE(c.accident_district) AS sample_district
        FROM claim_shop_classification c
        WHERE c.shop_class = 'unregistered_shadow'
        GROUP BY c.subject_shop_code
        ORDER BY claim_count DESC, vehicle_settled_amount DESC
        LIMIT {top_n}
        """
    ).fetchdf()


def fetch_process_excluded_shops(con: duckdb.DuckDBPyConnection, top_n: int):
    return con.execute(
        f"""
        SELECT
          c.subject_shop_code AS shop_code,
          ANY_VALUE(c.subject_repair_shop) AS subject_repair_shop,
          CASE WHEN COUNT(DISTINCT p.shop_code) > 0 THEN 'registered' ELSE 'unregistered' END AS registered_status,
          ANY_VALUE(COALESCE(c.claim_exclusion_reason, p.exclusion_reason)) AS exclusion_reason,
          COUNT(DISTINCT c.claim_no) AS claim_count,
          ROUND(SUM(c.vehicle_settled_amount), 2) AS vehicle_settled_amount,
          ROUND(SUM(c.settled_amount_check), 2) AS settled_amount_check,
          ANY_VALUE(c.accident_district) AS sample_district
        FROM claim_shop_classification c
        LEFT JOIN process_excluded_all p ON p.shop_code = c.subject_shop_code
        WHERE c.shop_class = 'excluded_process_shop'
        GROUP BY c.subject_shop_code
        ORDER BY claim_count DESC, vehicle_settled_amount DESC
        LIMIT {top_n}
        """
    ).fetchdf()


def run_assertions(con: duckdb.DuckDBPyConnection) -> list[str]:
    messages: list[str] = []

    net_totals = con.execute(
        """
        WITH overall AS (
          SELECT COALESCE(SUM(net_premium), 0) AS net_premium FROM repair_base
        ),
        by_4s AS (
          SELECT COALESCE(SUM(net_premium), 0) AS net_premium
          FROM (
            SELECT CASE WHEN is_4s_shop THEN '4S' ELSE '非4S' END AS shop_type,
                   SUM(net_premium) AS net_premium
            FROM repair_base
            GROUP BY shop_type
          )
        ),
        by_org AS (
          SELECT COALESCE(SUM(net_premium), 0) AS net_premium
          FROM (
            SELECT org_level_3, SUM(net_premium) AS net_premium
            FROM repair_base
            WHERE org_level_3 IS NOT NULL
            GROUP BY org_level_3
          )
        )
        SELECT overall.net_premium, by_4s.net_premium, by_org.net_premium
        FROM overall, by_4s, by_org
        """
    ).fetchone()
    total_net, by_4s_net, by_org_net = [float(v or 0) for v in net_totals]
    if abs(total_net - by_4s_net) > 0.01:
        raise AssertionError(f"4S 分组净保费合计不等于整体: overall={total_net}, by_4s={by_4s_net}")
    if by_org_net - total_net > 0.01:
        raise AssertionError(f"机构分组净保费合计大于整体: overall={total_net}, by_org={by_org_net}")
    messages.append("资源侧净保费聚合未发生赔案 JOIN 放大")

    claim_totals = con.execute(
        """
        WITH total AS (
          SELECT COUNT(DISTINCT claim_no) AS total_claims FROM claims_scope
        ),
        classes AS (
          SELECT shop_class, COUNT(DISTINCT claim_no) AS claim_count
          FROM claim_shop_classification
          WHERE shop_class IN ('effective_registered', 'excluded_process_shop', 'unregistered_shadow')
          GROUP BY shop_class
        )
        SELECT
          total_claims,
          COALESCE(SUM(claim_count), 0) AS classified_claims
        FROM total, classes
        GROUP BY total_claims
        """
    ).fetchone()
    total_claims, classified_claims = [int(v or 0) for v in claim_totals]
    if classified_claims > total_claims:
        raise AssertionError(
            "effective_registered + excluded_process_shop + unregistered_shadow "
            f"超过 claims_scope 去重赔案数: classified={classified_claims}, total={total_claims}"
        )
    messages.append("赔案三类拆分未超过 claims_scope 去重赔案数")

    local_check = con.execute(
        """
        SELECT
          COUNT(DISTINCT CASE WHEN c.accident_district = r.district THEN c.claim_no END) AS normalized_local_claims,
          COUNT(DISTINCT CASE WHEN c.accident_district_raw = r.district THEN c.claim_no END) AS raw_local_claims
        FROM repair_base r
        LEFT JOIN claims_scope c ON c.subject_shop_code = r.shop_code
        """
    ).fetchone()
    normalized_local, raw_local = [int(v or 0) for v in local_check]
    if normalized_local < raw_local:
        raise AssertionError(
            f"归一化本地承接数小于 raw 比较: normalized={normalized_local}, raw={raw_local}"
        )
    messages.append("本地资源占比使用归一化区县，raw 比较仅作诊断")

    return messages


def print_df(title: str, df) -> None:
    print(f"\n## {title}")
    if df is None or df.empty:
        print("(无数据)")
        return
    print(df.to_string(index=False))


def print_overview(df) -> None:
    print("\n## 整体总览")
    if df is None or df.empty:
        print("(无数据)")
        return
    row = df.iloc[0].to_dict()
    labels = [
        ("登记网点数", fi(row.get("registered_shop_count"))),
        ("有效网点数", fi(row.get("effective_shop_count"))),
        ("流程占位网点数", fi(row.get("process_excluded_shop_count"))),
        ("活跃网点数", fi(row.get("active_shop_count"))),
        ("风险网点数", fi(row.get("risk_shop_count"))),
        ("活跃率", pct(row.get("active_rate"))),
        ("风险率", pct(row.get("risk_rate"))),
        ("4S网点数", fi(row.get("shop_4s_count"))),
        ("4S占比", pct(row.get("repair_4s_share"))),
        ("赔案样本数", fi(row.get("total_claim_count"))),
        ("有效登记网点赔案数", fi(row.get("effective_registered_claims"))),
        ("流程占位赔案数", fi(row.get("excluded_process_claims"))),
        ("流程占位赔案占比", pct(row.get("excluded_process_claim_share"))),
        ("未登记影子网点数", fi(row.get("unregistered_shadow_shops"))),
        ("未登记影子赔案数", fi(row.get("unregistered_shadow_claims"))),
        ("未登记影子赔案占比", pct(row.get("unregistered_shadow_claim_share"))),
        ("核损金额", fp(row.get("total_damage_amount"))),
        ("签单净保费", fp(row.get("total_net_premium"))),
        ("修保比", fp(row.get("repair_to_premium_ratio"), 4)),
        ("承接赔案数", fi(row.get("total_joined_claims"))),
        ("本地承接赔案数", fi(row.get("local_claims"))),
        ("本地资源占比", pct(row.get("local_resource_ratio"))),
        ("Raw本地承接赔案数", fi(row.get("raw_local_claims"))),
        ("Raw本地资源占比", pct(row.get("raw_local_resource_ratio"))),
    ]
    width = max(len(label) for label, _ in labels)
    for label, value in labels:
        print(f"{label:<{width}} : {value}")


def main() -> None:
    args = parse_args()
    con = duckdb.connect(":memory:")
    setup_views(con, args.org, args.window)

    anchor_date = con.execute("SELECT MAX(accident_time) FROM claims_all").fetchone()[0]
    scope_claims = con.execute("SELECT COUNT(DISTINCT claim_no) FROM claims_scope").fetchone()[0]

    print("=" * 72)
    print("维修合作网络质量 P0 验证")
    print("=" * 72)
    print(f"时间窗口     : {args.window}")
    print(f"锚点日期     : {anchor_date}")
    print(f"赔案样本数   : {fi(scope_claims)}")
    print(f"机构筛选     : {args.org or '全部'}")
    print("区县口径     : accident_district 已去除前缀行政编码后再与 repair.district 比较")
    print("金额口径     : 维修承接金额使用 settled_vehicle_amount；settled_amount 仅作核对列")
    print("shadow口径   : 未登记影子与已登记流程占位分开输出")

    assertions = run_assertions(con)
    print("\n## 回归断言")
    for item in assertions:
        print(f"- PASS: {item}")

    print_overview(fetch_overview(con))
    print_df("机构质量排名", fetch_org_ranking(con))
    print_df("4S 对比", fetch_4s_compare(con))
    print_df("低本地承接区县 TOP", fetch_low_local_districts(con, args.top_n))
    print_df("高风险网点 TOP", fetch_risk_shops(con, args.top_n))
    print_df("未登记影子网点 TOP", fetch_unregistered_shadow_shops(con, args.top_n))
    print_df("流程占位/伪网点 TOP", fetch_process_excluded_shops(con, args.top_n))


if __name__ == "__main__":
    main()
