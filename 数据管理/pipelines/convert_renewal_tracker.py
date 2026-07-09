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
  python3 convert_renewal_tracker.py -o ... --branch-code SC   # 显式声明省份（默认从 BRANCH_CODE env 读，全空兜底 'SC'）

P3-C (2026-06-23)：派生 branch_code 列（CHAR(2)，'SC'/'SX'），从 policy_no 前 3 位
prefix_map 派生（610→SC, 618→SX）。renewal_tracker 输出 schema 无 policy_no 主列，
故先造临时列 __tmp_policy_no_for_branch = renewed_policy_no(if is_renewed) else
source_policy_no → 喂 apply_registry_derivations → drop 临时列。复用 strictNonNull +
assertDeclaredBranch guard（已 duckdb 实证 SC 链路 source/renewed 100% 非空+610 前缀）。
"""

import argparse
import sys
from pathlib import Path

import duckdb
import numpy as np

from derived_fields import apply_registry_derivations, resolve_declared_branch
from renewal_common import branch_paths, quote_window_start_for

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parent

# 保单/报价路径 + 报价窗口起点按省份路由：argparse default=None，main() 据 --branch-code 经
# renewal_common.branch_paths / quote_window_start_for 填充（多省 SSOT），杜绝省份盲默认值在 SX
# 模式静默读四川 fact/ 或用四川报价窗口截断数据（adversarial review HIGH-2/HIGH-3）。
# salesman 维度暂跨省共享单一 dim（dim 多省策略待 Phase B 确认），故仍保留固定默认路径。
DEFAULT_SALESMAN_PATH = str(DATA_ROOT / "warehouse" / "dim" / "salesman" / "latest.parquet")

DEFAULT_SOURCE_YEAR = 2025
DEFAULT_RENEWAL_YEAR = 2026

# 临时列名（P3-C codex 闸-1 P1.1）：renewal_tracker 输出 schema 不含 policy_no 列，
# 派生 branch_code 需用 source_policy_no/renewed_policy_no 二选一造临时列喂给
# apply_registry_derivations。用 dunder 前缀避免与未来业务字段冲突；已存在时 ValueError
# 拒绝继续，避免无声覆盖破坏字节安全（codex 闸-1 P1.1）。
_TMP_POLICY_NO_COL = "__tmp_policy_no_for_branch"


def derive_renewal_tracker_branch_code(df, declared_branch):
    """对 renewal_tracker DataFrame 派生 branch_code 列（mutate df 并新增列）。

    1. 造内部临时列 _TMP_POLICY_NO_COL = renewed_policy_no(if is_renewed) else source_policy_no
    2. 跨省登记（source 省 ≠ renewed 省 时 print 不静默，归 renewed=当前承保省）
    3. 复用 apply_registry_derivations 走 prefix_map + assertDeclaredBranch + strictNonNull guard
    4. drop 临时列

    Args:
        df: pandas DataFrame，需含 is_renewed/source_policy_no/renewed_policy_no
        declared_branch: 操作员声明的省份代码（CHAR(2)，'SC'/'SX'），不可为 None
                         （codex 闸-1 P0：直跑入口须 'SC' 默认兜底，避免漏 assertDeclaredBranch）

    Returns:
        pandas DataFrame：新增 branch_code 列、临时列已 drop
    """
    if _TMP_POLICY_NO_COL in df.columns:
        # 防御未来 schema 演进引入同名列（codex 闸-1 P1.1）
        raise ValueError(
            f"renewal_tracker 输出 schema 已含临时列 {_TMP_POLICY_NO_COL!r}，"
            f"可能与未来业务字段冲突；请重命名 _TMP_POLICY_NO_COL 避免无声覆盖"
        )
    if "policy_no" in df.columns:
        # 防御未来 schema 演进引入业务 policy_no 列（codex 闸-2 P1.1）：
        # 当前实现下方会写 df['policy_no'] = df[_TMP_POLICY_NO_COL] 喂 helper、再
        # drop 'policy_no'——若 df 已含业务 policy_no，会被无声覆盖并随后被 drop，
        # 破坏字节安全。renewal_tracker 输出 schema 当前不含 policy_no（仅
        # source_policy_no + renewed_policy_no），未来若新增 policy_no 业务字段须
        # 重新设计 helper 调用路径（如改用 df.rename 临时改列名 + 还原）。
        raise ValueError(
            "renewal_tracker 输出 schema 已含 'policy_no' 业务列；当前 helper "
            "通过 df['policy_no'] 喂 apply_registry_derivations 后会 drop，会无声"
            "覆盖业务列。请改造 helper（如临时 rename）以保护业务 policy_no 列"
        )
    df[_TMP_POLICY_NO_COL] = np.where(
        df["is_renewed"].astype(bool),
        df["renewed_policy_no"],
        df["source_policy_no"],
    )
    # 跨省续保登记（不静默，归 renewed=当前承保省）：现状 SC 链路 cross_province_cnt=0；
    # 山西 GATED 上线后若出现 source 省 ≠ renewed 省，本 print 提示数据质量
    if df["is_renewed"].any():
        renewed_df = df[df["is_renewed"].astype(bool)]
        src_prefix = renewed_df["source_policy_no"].astype(str).str[:3]
        rnw_prefix = renewed_df["renewed_policy_no"].astype(str).str[:3]
        cross_cnt = int((src_prefix != rnw_prefix).sum())
        if cross_cnt > 0:
            print(
                f"   ⚠️ 跨省续保登记 {cross_cnt:,} 行 "
                f"(source 省 ≠ renewed 省, 归 renewed=当前承保省)"
            )
    # apply_registry_derivations 用 fields.json branch_code 派生规则
    # (source=policy_no/prefixLength=3/mapping{610:SC,618:SX}+strictNonNull+assertDeclaredBranch)
    # 它读 df['policy_no'] 列；故我们临时把 _TMP_POLICY_NO_COL 复制成 policy_no 喂给 helper、
    # 之后两列一起 drop（registry 视图层无 policy_no 真业务字段）。
    df["policy_no"] = df[_TMP_POLICY_NO_COL]
    df = apply_registry_derivations(df, declared_branch)
    df.drop(columns=[_TMP_POLICY_NO_COL, "policy_no"], inplace=True)
    return df


def main():
    ap = argparse.ArgumentParser(description="续保追踪派生域 ETL")
    ap.add_argument("-o", "--output", required=True, help="输出 parquet 路径")
    ap.add_argument("--policy-glob", default=None,
                    help="保单 parquet glob（默认按 --branch-code 路由 fact/ 或 validation/<省>/）")
    ap.add_argument("--quotes-path", default=None,
                    help="报价转化 parquet 路径（默认按 --branch-code 路由）")
    ap.add_argument("--salesman-path", default=DEFAULT_SALESMAN_PATH, help="业务员维度表 parquet 路径")
    ap.add_argument("--quote-window-start", default=None,
                    help="报价窗口起点（YYYY-MM-DD），默认按 --branch-code 取 renewal_common.quote_window_start_for")
    ap.add_argument("--source-year", type=int, default=DEFAULT_SOURCE_YEAR,
                    help=f"源保单起保年度，默认 {DEFAULT_SOURCE_YEAR}")
    ap.add_argument("--renewal-year", type=int, default=DEFAULT_RENEWAL_YEAR,
                    help=f"续保到期年度，默认 {DEFAULT_RENEWAL_YEAR}")
    ap.add_argument("--branch-code", default=None,
                    help="部署省份代码（CHAR(2)，'SC'/'SX'），未指定时读 BRANCH_CODE env，"
                         "全空时默认 'SC'（codex 闸-1 P0：避免漏 assertDeclaredBranch 核对）")
    args = ap.parse_args()

    # 省份路由（review HIGH-2/HIGH-3）：--branch-code（CLI 优先 → BRANCH_CODE env → 'SC'）统一驱动
    # 「数据源路径 + 报价窗口 + Step 6 的 branch_code 列派生」，三者同省，杜绝路由漂移。
    # 仅在未显式传 --policy-glob/--quotes-path/--quote-window-start 时按 renewal_common SSOT 填充。
    declared_branch = resolve_declared_branch(args) or "SC"
    _paths = branch_paths(declared_branch, DATA_ROOT)  # fail-closed：未知省份立即 RuntimeError
    if args.policy_glob is None:
        args.policy_glob = _paths["policy_glob"]
    if args.quotes_path is None:
        args.quotes_path = _paths["quotes"]
    if args.quote_window_start is None:
        args.quote_window_start = quote_window_start_for(declared_branch)

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

    # Step 5: LEFT JOIN 四表，构建结果表（P3-C：先 CREATE TABLE 而非 COPY，
    # 便于读回 pandas df 派生 branch_code 后再 COPY 写 parquet）
    # 派生维度字段：
    #   fuel_category: is_nev → 电 / 油（本期两分，气需专用字段，暂跳过）
    #   used_transfer_type: 新车 / 旧车过户 / 旧车非过户
    #   renewal_type:       新车 / 续保 / 转保
    print(f"\n📊 Step 5: JOIN 生成 universe → 内存表 renewal_tracker_result...")
    con.execute("""
        CREATE OR REPLACE TABLE renewal_tracker_result AS
        SELECT
            b.source_policy_no,
            b.vehicle_frame_no,
            b.expiry_date,
            b.expiry_month,
            b.expected_expiry_date,
            b.org_level_3,
            -- CAST team→VARCHAR：SX 业务员维表 team 列可能全空被推断为 INTEGER，
            -- 直接 COALESCE(int, '直管') 会让 DuckDB 把中文默认值强转 INT32 而崩溃。
            -- 显式 CAST 钉死为 VARCHAR，对 SC（已是 VARCHAR）为恒等，对 SX 空列安全。
            COALESCE(CAST(s.team AS VARCHAR), '直管') AS team_name,
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
    """)

    # Step 6: 读回 df → 派生 branch_code → register → COPY 写 parquet
    # declared_branch 已在参数路由处统一解析（驱动数据源路径路由 + 本列派生，二者恒同省）；
    # codex 闸-1 P0：默认 'SC' 兜底，避免直跑入口漏 assertDeclaredBranch 核对。
    print(f"\n📊 Step 6: 派生 branch_code (declared='{declared_branch}') → {out_path.name}...")
    df = con.execute("SELECT * FROM renewal_tracker_result").fetchdf()
    df = derive_renewal_tracker_branch_code(df, declared_branch)
    con.register('renewal_tracker_with_branch', df)
    con.execute(f"""
        COPY renewal_tracker_with_branch
        TO '{out_path}' (FORMAT PARQUET, COMPRESSION 'zstd');
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
