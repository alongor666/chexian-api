#!/usr/bin/env python3
"""特殊域 branch_code 物化（无 policy_no 净域 + 维度）— 零刷新、域专用校验后仅追加列。

承接 backfill_derived_fields.py（policy_no 可信域：cross_sell/claims_detail/customer_flow）。
本脚本处理**通用 backfill 覆盖不了**的域（codex 闸-1 P1.3：禁盲常量、禁 ETL 重跑）：

  - salesman（维度·无 policy_no）：常量 'SC'（脚本仅消费四川源；生产者 generate_dim_tables.py
    已同步落列，本脚本物化当前 parquet）。
  - quotes_conversion（policy_no 92.5% NULL）：复用 quote_etl.derive_branch_code(df,'SC') warn 模式
    （非缺失行 prefix 校验全 610、缺失行 fillna 'SC'）。
  - renewal_tracker（无 policy_no，有 source/renewed_policy_no）：复用
    convert_renewal_tracker.derive_renewal_tracker_branch_code(df,'SC')。
  - new_energy_claims（policy_no 100% NULL）：vehicle_frame_no→policy/current branch_code JOIN
    校验全 SC + miss=0，再加常量 'SC'（不回填/改写 org_level_3，codex P1.3）。

**字节安全 by construction**：读原始 arrow table → 仅抽取派生出的 branch_code 列 → `append_column`
到**原始 table**（非 branch 列复用原 arrow 数组，零 pandas 往返漂移）→ 写回。原 schema metadata
（含 etl_*）随 append_column 自动保留。非 branch 列字节不变由 scripts/oracle_mpdata_byte_safety.py 复证。

用法：
  python3 数据管理/pipelines/materialize_branch_code_special.py --data-root <warehouse 绝对路径> [--dry-run] [--force]
  python3 数据管理/pipelines/materialize_branch_code_special.py --domains salesman,quotes_conversion ...

退出码：0 全部物化（或 dry-run）/ 1 域专用校验失败（fail-closed）。
"""
import argparse
import sys
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT_DEFAULT = ROOT / "数据管理/warehouse"
BRANCH_CODE = "SC"

# 复用各域已合并 derive 逻辑（worktree tracked，非 ETL 重跑）。
sys.path.insert(0, str(ROOT / "数据管理"))
from pipelines.quote_etl import derive_branch_code  # noqa: E402
from pipelines.convert_renewal_tracker import (  # noqa: E402
    derive_renewal_tracker_branch_code,
)


def _branch_series_salesman(table: pa.Table, _root: Path) -> pd.Series:
    """维度业务员：常量 'SC'（脚本仅消费四川源 xlsx）。"""
    return pd.Series([BRANCH_CODE] * table.num_rows, dtype="object")


def _branch_series_quotes(table: pa.Table, _root: Path) -> pd.Series:
    """报价：复用 quote_etl.derive_branch_code warn 模式（非缺失 prefix 校验 + 缺失 fillna）。"""
    df = table.to_pandas()
    out = derive_branch_code(df, BRANCH_CODE)
    return out["branch_code"].reset_index(drop=True).astype("object")


def _branch_series_renewal(table: pa.Table, _root: Path) -> pd.Series:
    """续保追踪：复用 derive_renewal_tracker_branch_code（source/renewed_policy_no 前缀派生）。"""
    df = table.to_pandas()
    out = derive_renewal_tracker_branch_code(df, BRANCH_CODE)
    return out["branch_code"].reset_index(drop=True).astype("object")


def _branch_series_new_energy(table: pa.Table, root: Path) -> pd.Series:
    """新能源：vehicle_frame_no→policy/current branch_code JOIN 校验全 SC + miss=0，再常量。"""
    df = table.to_pandas()
    if "vehicle_frame_no" not in df.columns:
        print("   ❌ new_energy 缺 vehicle_frame_no 列 — fail-fast")
        sys.exit(1)
    policy_glob = str(root / "fact/policy/current/*.parquet")
    con = duckdb.connect()
    con.register("ne", df[["vehicle_frame_no"]])
    safe = policy_glob.replace("'", "''")
    row = con.execute(
        f"""
        WITH ne_vin AS (SELECT DISTINCT vehicle_frame_no AS vin FROM ne WHERE vehicle_frame_no IS NOT NULL),
             pol AS (SELECT DISTINCT vehicle_frame_no AS vin, branch_code
                     FROM read_parquet('{safe}') WHERE vehicle_frame_no IS NOT NULL)
        SELECT (SELECT count(*) FROM ne_vin) AS ne_vins,
               count(p.vin) AS matched,
               count(*) FILTER (WHERE p.vin IS NULL) AS miss,
               string_agg(DISTINCT p.branch_code, ',') AS branches
        FROM ne_vin LEFT JOIN pol p ON ne_vin.vin = p.vin
        """
    ).fetchone()
    ne_vins, matched, miss, branches = row
    print(f"   🔎 new_energy VIN→policy: ne_vins={ne_vins} matched={matched} miss={miss} branches={branches}")
    if miss and miss > 0:
        print(f"   ❌ new_energy {miss} 个 VIN 未命中 policy/current — 无法证明全 SC，fail-fast")
        sys.exit(1)
    if branches != "SC":
        print(f"   ❌ new_energy 命中行 branch_code 非单省 SC（{branches}）— fail-fast")
        sys.exit(1)
    # 全部 VIN 命中 SC → 每行归 SC（policy_no 100% NULL，无 per-row prefix 可用，VIN 已证全 SC）
    return pd.Series([BRANCH_CODE] * table.num_rows, dtype="object")


DOMAINS = {
    "salesman": {"rel": "dim/salesman/latest.parquet", "fn": _branch_series_salesman},
    "quotes_conversion": {"rel": "fact/quotes_conversion/latest.parquet", "fn": _branch_series_quotes},
    "renewal_tracker": {"rel": "fact/renewal_tracker/latest.parquet", "fn": _branch_series_renewal},
    "new_energy_claims": {"rel": "fact/new_energy_claims/latest.parquet", "fn": _branch_series_new_energy},
}


def materialize_one(name: str, path: Path, root: Path, force: bool, dry_run: bool) -> bool:
    table = pq.read_table(path)
    if "branch_code" in table.column_names and not force:
        print(f"⏭️  {name}: 已含 branch_code 列（{path.name}），--force 覆盖")
        return False

    branch = DOMAINS[name]["fn"](table, root)
    if len(branch) != table.num_rows:
        print(f"   ❌ {name}: 派生 branch_code 长度 {len(branch)} ≠ 行数 {table.num_rows} — fail-fast")
        sys.exit(1)
    distinct = sorted(set(branch.tolist()))
    if distinct != [BRANCH_CODE]:
        print(f"   ❌ {name}: 派生 branch_code 非单省 {BRANCH_CODE}，实际 {distinct} — fail-fast")
        sys.exit(1)

    if dry_run:
        print(f"DRY-RUN ✅ {name}: {table.num_rows:,} 行 → 追加 branch_code='{BRANCH_CODE}'（{path.name}）")
        return True

    # 若已含 branch_code（--force）先移除原列，再追加新列（保持 append 语义、非 branch 列原 arrow 不变）
    out = table
    if "branch_code" in out.column_names:
        out = out.drop(["branch_code"])
    out = out.append_column("branch_code", pa.array(branch.tolist(), type=pa.string()))
    pq.write_table(out, str(path), compression="snappy")
    print(f"✅ {name}: {table.num_rows:,} 行 → branch_code='{BRANCH_CODE}' 已追加并写回（{path.name}）")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="特殊域 branch_code 物化（零刷新·仅追加列）")
    ap.add_argument("--data-root", default=str(DATA_ROOT_DEFAULT))
    ap.add_argument("--domains", default=",".join(DOMAINS), help="逗号分隔域子集")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    root = Path(args.data_root).resolve()
    if not root.exists():
        print(f"❌ data-root 不存在: {root}")
        return 1
    selected = [d.strip() for d in args.domains.split(",") if d.strip()]
    unknown = [d for d in selected if d not in DOMAINS]
    if unknown:
        print(f"❌ 未知域: {unknown}（合法: {list(DOMAINS)}）")
        return 1

    print(f"📁 data-root: {root}")
    print(f"🏷  物化域: {selected} → branch_code='{BRANCH_CODE}'{'（DRY-RUN）' if args.dry_run else ''}\n")
    changed = 0
    for name in selected:
        path = root / DOMAINS[name]["rel"]
        if not path.exists():
            print(f"⚠️  {name}: 文件不存在 {path} — 跳过")
            continue
        if materialize_one(name, path, root, args.force, args.dry_run):
            changed += 1
    print(f"\n{'='*60}\n✅ 完成: {changed}/{len(selected)} 域已物化"
          f"{'（dry-run，未写入）' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
