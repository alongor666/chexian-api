#!/usr/bin/env python3
"""Phase 4 backfill 字节安全 oracle — premium 可信域 branch_code 重派生 0 变更证明。

证明：对 policy/current（premium，已含 branch_code='SC'）跑可信域感知 backfill 重派生，
branch_code 逐行不变（SC→SC，变更==0）、所有业务列字节不变、行数不变、单省 SC。
回读路径用 DuckDB COPY→read_parquet（非内存 df 直比），捕捉 arrow→parquet→arrow 序列化损失
（R31/R32 模板）。

用法：
  python3 scripts/oracle_p4_backfill_byte_safety.py [--data-root <warehouse 绝对路径>]
默认 data-root = 仓库根/数据管理/warehouse（worktree 无数据时须显式指主目录绝对路径）。
退出码：0 字节安全 / 1 检出变更。
"""
import argparse
import hashlib
import sys
import tempfile
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT_DEFAULT = ROOT / "数据管理/warehouse"

sys.path.insert(0, str(ROOT / "数据管理"))
from pipelines.backfill_derived_fields import apply_derivation, load_derived_rules  # noqa: E402


def _hash_business_columns(df: pd.DataFrame, exclude: set[str]) -> dict[str, str]:
    """对每个业务列（排除 branch_code）算 sha256（按现有行序）。"""
    out = {}
    for col in sorted(c for c in df.columns if c not in exclude):
        ser = df[col].astype("string").fillna("\x00NULL\x00")
        out[col] = hashlib.sha256("\x1f".join(ser.tolist()).encode("utf-8")).hexdigest()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default=str(DATA_ROOT_DEFAULT))
    args = ap.parse_args()
    glob = f"{args.data_root}/fact/policy/current/*.parquet"

    rules = [fd for fd in load_derived_rules() if fd["id"] == "branch_code"]
    if not rules:
        print("❌ fields.json 无 branch_code 派生规则")
        return 1
    branch_rule = rules[0]

    con = duckdb.connect()
    before = con.execute(f"SELECT * FROM read_parquet('{glob}', union_by_name=true)").fetchdf()
    n = len(before)
    if n == 0:
        print(f"❌ 无数据：{glob}")
        return 1
    print(f"📥 premium 现状：{n:,} 行，含 branch_code={('branch_code' in before.columns)}")

    if "branch_code" not in before.columns:
        print("❌ premium 当前无 branch_code 列，无法做『重派生 0 变更』对照")
        return 1

    before_branch = before["branch_code"].tolist()
    before_hashes = _hash_business_columns(before, exclude={"branch_code"})

    # 重派生：可信域感知 backfill（force=True，断言 declared==推断 SC）
    after = before.copy()
    after, status = apply_derivation(after, branch_rule, force=True, declared_branch="SC")
    print(f"🔁 重派生 status: {status}")
    if not status.startswith("ok("):
        print("❌ 重派生未 ok")
        return 1

    # 经 COPY→read_parquet 回读（捕捉序列化损失）
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=True) as tmp:
        con.register("after_df", after)
        con.execute(f"COPY (SELECT * FROM after_df) TO '{tmp.name}' (FORMAT parquet)")
        roundtrip = con.execute(f"SELECT * FROM read_parquet('{tmp.name}')").fetchdf()

    fails = []
    if len(roundtrip) != n:
        fails.append(f"行数变更 {n}→{len(roundtrip)}")
    rt_branch = roundtrip["branch_code"].tolist()
    diff = sum(1 for a, b in zip(before_branch, rt_branch) if a != b)
    if diff != 0:
        fails.append(f"branch_code 变更 {diff:,} 行（应 0）")
    distinct = sorted(set(rt_branch))
    if distinct != ["SC"]:
        fails.append(f"branch_code 非单省 SC，实际 {distinct}")
    rt_hashes = _hash_business_columns(roundtrip, exclude={"branch_code"})
    if rt_hashes != before_hashes:
        changed = [c for c in before_hashes if before_hashes.get(c) != rt_hashes.get(c)]
        fails.append(f"业务列 hash 变更: {changed}")

    print(f"📊 业务列数={len(before_hashes)} | branch 变更={diff} | 单省={distinct}")
    if fails:
        print("❌ 字节安全 FAIL:")
        for f in fails:
            print(f"   - {f}")
        return 1
    print(f"✅ 字节安全：{n:,} 行 branch_code 重派生 0 变更 + {len(before_hashes)} 业务列 hash 全等 + 单省 SC")
    return 0


if __name__ == "__main__":
    sys.exit(main())
