#!/usr/bin/env python3
"""山西多省「生产数据就绪」字节安全 oracle — snapshot/verify 双模式（域无关）。

证明各域物化 branch_code **只新增 branch_code 列、非 branch 列逐字节不变**：
  1. `--snapshot <baseline.json>`：物化**前**对每个域每个 parquet 文件记录
     {row_count, 非 branch 列名(有序), 非 branch 列 DuckDB 类型, 非 branch 列逐列 sha256,
      branch_code 是否存在}。
  2. 物化（backfill_derived_fields.py + materialize_branch_code_special.py）。
  3. `--verify <baseline.json>`：物化**后**重算，断言
       非 branch 列名/序/类型/逐列 sha256 == baseline（codex 闸-1 P1.4）
       + branch_code 列存在且全 'SC'（单省）+ 行数不变。

回读路径用 DuckDB read_parquet（捕捉 arrow→parquet→arrow 序列化漂移，R31/R32 模板）。
列 sha256 用 DuckDB md5(string_agg) 在引擎内算（不 to_pandas，避开 dtype 强转噪声）。

用法：
  python3 scripts/oracle_mpdata_byte_safety.py --snapshot /tmp/mp_base.json --data-root <warehouse 绝对路径>
  ...物化...
  python3 scripts/oracle_mpdata_byte_safety.py --verify   /tmp/mp_base.json --data-root <warehouse 绝对路径>

--data-root 默认 仓库根/数据管理/warehouse（worktree 无数据时须显式指主仓绝对路径）。
退出码：0 通过 / 1 检出非 branch 列变更或 branch_code 异常。
"""
import argparse
import glob as globmod
import hashlib
import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT_DEFAULT = ROOT / "数据管理/warehouse"

# 域 → parquet 相对 glob（相对 data-root）。multi=True 表示多分区（逐文件独立校验）。
DOMAINS = [
    {"name": "salesman", "rel": "dim/salesman/latest.parquet", "multi": False},
    {"name": "cross_sell", "rel": "fact/cross_sell/latest.parquet", "multi": False},
    {"name": "claims_detail", "rel": "fact/claims_detail/claims_*.parquet", "multi": True},
    {"name": "customer_flow", "rel": "fact/customer_flow/latest.parquet", "multi": False},
    {"name": "quotes_conversion", "rel": "fact/quotes_conversion/latest.parquet", "multi": False},
    {"name": "renewal_tracker", "rel": "fact/renewal_tracker/latest.parquet", "multi": False},
    {"name": "new_energy_claims", "rel": "fact/new_energy_claims/latest.parquet", "multi": False},
]

BRANCH = "branch_code"


def _fingerprint_file(con: duckdb.DuckDBPyConnection, path: str) -> dict:
    """对单个 parquet 文件取指纹：行数 + 非 branch 列(名/类型/逐列 sha256) + branch_code 信息。"""
    safe = path.replace("'", "''")
    desc = con.execute(
        f"DESCRIBE SELECT * FROM read_parquet('{safe}')"
    ).fetchall()
    # desc 行: (column_name, column_type, null, key, default, extra)
    cols = [(r[0], r[1]) for r in desc]
    nonbranch = [(n, t) for (n, t) in cols if n != BRANCH]
    n = con.execute(f"SELECT count(*) FROM read_parquet('{safe}')").fetchone()[0]

    # 逐列 sha256：在引擎内 md5(string_agg(col ORDER BY rowid)) 取每列内容指纹。
    # 用 row_number 锚定文件物理行序（read_parquet 保序），COALESCE NULL→哨兵防 NULL 拼接歧义。
    col_hashes = {}
    base = f"(SELECT *, row_number() OVER () AS _rn FROM read_parquet('{safe}'))"
    for name, _t in nonbranch:
        qn = '"' + name.replace('"', '""') + '"'
        h = con.execute(
            f"SELECT md5(string_agg(COALESCE(CAST({qn} AS VARCHAR), '\\x00NULL'), '\\x1f' ORDER BY _rn)) "
            f"FROM {base}"
        ).fetchone()[0]
        col_hashes[name] = h

    branch_info = None
    if any(n == BRANCH for n, _ in cols):
        distinct = [
            r[0] for r in con.execute(
                f"SELECT DISTINCT {BRANCH} FROM read_parquet('{safe}') ORDER BY 1"
            ).fetchall()
        ]
        nulls = con.execute(
            f"SELECT count(*) FILTER (WHERE {BRANCH} IS NULL) FROM read_parquet('{safe}')"
        ).fetchone()[0]
        branch_info = {"distinct": distinct, "nulls": int(nulls)}

    return {
        "row_count": int(n),
        "nonbranch_cols": [n for n, _ in nonbranch],   # 有序
        "nonbranch_types": {n: t for n, t in nonbranch},
        "col_hashes": col_hashes,
        "has_branch": branch_info is not None,
        "branch_info": branch_info,
    }


def _resolve_files(data_root: Path, dom: dict) -> list[str]:
    pattern = str(data_root / dom["rel"])
    files = sorted(globmod.glob(pattern))
    return files


def snapshot(data_root: Path, out_path: Path) -> int:
    con = duckdb.connect()
    base = {}
    for dom in DOMAINS:
        files = _resolve_files(data_root, dom)
        if not files:
            print(f"⚠️  {dom['name']}: 无文件（{dom['rel']}）— 跳过快照")
            continue
        base[dom["name"]] = {f: _fingerprint_file(con, f) for f in files}
        rows = sum(v["row_count"] for v in base[dom["name"]].values())
        print(f"📸 {dom['name']}: {len(files)} 文件, {rows:,} 行, "
              f"{len(next(iter(base[dom['name']].values()))['nonbranch_cols'])} 非 branch 列")
    out_path.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ 基线已写 {out_path}（{len(base)} 域）")
    return 0


def verify(data_root: Path, base_path: Path) -> int:
    base = json.loads(base_path.read_text(encoding="utf-8"))
    con = duckdb.connect()
    fails = []
    for dom in DOMAINS:
        name = dom["name"]
        if name not in base:
            continue
        files = _resolve_files(data_root, dom)
        base_files = base[name]
        # 文件集合不变（防新增/丢分区）
        if set(files) != set(base_files):
            fails.append(f"{name}: 文件集合变更 base={sorted(base_files)} now={sorted(files)}")
            continue
        for f in files:
            now = _fingerprint_file(con, f)
            b = base_files[f]
            fn = Path(f).name
            if now["row_count"] != b["row_count"]:
                fails.append(f"{name}/{fn}: 行数 {b['row_count']}→{now['row_count']}")
            if now["nonbranch_cols"] != b["nonbranch_cols"]:
                fails.append(f"{name}/{fn}: 非 branch 列名/序变更")
            if now["nonbranch_types"] != b["nonbranch_types"]:
                diff = {k: (b["nonbranch_types"].get(k), now["nonbranch_types"].get(k))
                        for k in set(b["nonbranch_types"]) | set(now["nonbranch_types"])
                        if b["nonbranch_types"].get(k) != now["nonbranch_types"].get(k)}
                fails.append(f"{name}/{fn}: 非 branch 列类型变更 {diff}")
            changed = [c for c in b["col_hashes"] if b["col_hashes"].get(c) != now["col_hashes"].get(c)]
            if changed:
                fails.append(f"{name}/{fn}: 非 branch 列 sha256 变更 {changed}")
            # branch_code 物化断言：存在 + 全 'SC' + 0 NULL
            if not now["has_branch"]:
                fails.append(f"{name}/{fn}: 物化后仍无 branch_code 列")
            else:
                bi = now["branch_info"]
                if bi["distinct"] != ["SC"]:
                    fails.append(f"{name}/{fn}: branch_code 非单省 SC，实际 {bi['distinct']}")
                if bi["nulls"] != 0:
                    fails.append(f"{name}/{fn}: branch_code 有 {bi['nulls']} 行 NULL")
        if not [x for x in fails if x.startswith(name)]:
            rows = sum(_fingerprint_file(con, f)["row_count"] for f in files)
            print(f"✅ {name}: {len(files)} 文件 / {rows:,} 行 — 非 branch 列字节全等 + branch_code 全 SC")

    if fails:
        print("\n❌ 字节安全 FAIL:")
        for x in fails:
            print(f"   - {x}")
        return 1
    print("\n✅ 全域字节安全通过：只新增 branch_code 列、非 branch 列逐字节不变、branch_code 全 'SC'")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--snapshot", metavar="BASELINE_JSON")
    g.add_argument("--verify", metavar="BASELINE_JSON")
    ap.add_argument("--data-root", default=str(DATA_ROOT_DEFAULT))
    args = ap.parse_args()
    data_root = Path(args.data_root).resolve()
    if not data_root.exists():
        print(f"❌ data-root 不存在: {data_root}")
        return 1
    if args.snapshot:
        return snapshot(data_root, Path(args.snapshot))
    return verify(data_root, Path(args.verify))


if __name__ == "__main__":
    sys.exit(main())
