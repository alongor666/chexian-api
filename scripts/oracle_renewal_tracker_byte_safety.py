#!/usr/bin/env python3
"""P3-C renewal_tracker branch_code 派生化字节安全 oracle（含 schema diff）

复用 P3-D 模式（scripts/oracle_quote_etl_byte_safety.py 同结构）：在真实 SC
renewal_tracker latest.parquet 全量上重派生 → 业务字段 sha256 hash 全等 +
DESCRIBE 前后 schema 对比（codex 闸-1 P1.2：DuckDB↔pandas 类型保真不能凭口承诺）+
新增 branch_code 列契约（全 'SC' 零 NULL）。

跑法：
  python3 scripts/oracle_renewal_tracker_byte_safety.py
  python3 scripts/oracle_renewal_tracker_byte_safety.py --path <自定义 parquet>

退出码：
  0 = 字节安全 + schema 保真 + branch_code 契约全过
  1 = 任一项失败
"""
import argparse
import hashlib
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPELINES = ROOT / "数据管理" / "pipelines"
if str(PIPELINES) not in sys.path:
    sys.path.insert(0, str(PIPELINES))

import duckdb  # noqa: E402

from convert_renewal_tracker import derive_renewal_tracker_branch_code  # noqa: E402

DEFAULT_PATH = str(ROOT / "数据管理" / "warehouse" / "fact" / "renewal_tracker" / "latest.parquet")


def column_hash(series) -> str:
    """业务字段 sha256(CSV 序列化值)，对类型不敏感（pandas→str 表达）"""
    return hashlib.sha256(series.to_csv(index=False).encode("utf-8")).hexdigest()


def schema_snapshot(con, table_name: str) -> dict:
    """DESCRIBE 输出 dict[col_name → col_type]"""
    desc = con.execute(f"DESCRIBE SELECT * FROM {table_name}").fetchall()
    return {row[0]: row[1] for row in desc}


def main():
    ap = argparse.ArgumentParser(description="P3-C renewal_tracker 字节安全 oracle")
    ap.add_argument("--path", default=DEFAULT_PATH, help=f"parquet 路径（默认 {DEFAULT_PATH}）")
    ap.add_argument("--declared-branch", default="SC", help="声明省份代码（默认 SC）")
    args = ap.parse_args()

    parquet_path = Path(args.path).resolve()
    if not parquet_path.exists():
        print(f"❌ parquet 不存在: {parquet_path}")
        sys.exit(1)

    print(f"📂 读取 parquet: {parquet_path}")
    con = duckdb.connect(":memory:")
    con.execute(f"CREATE OR REPLACE VIEW src AS SELECT * FROM '{parquet_path}'")

    # 1. 现状 schema + 业务字段 hash
    schema_before = schema_snapshot(con, "src")
    df_before = con.execute("SELECT * FROM src").fetchdf()
    before_cols = list(df_before.columns)
    print(f"   现状: {len(df_before):,} 行 / {len(before_cols)} 列")
    if "branch_code" in before_cols:
        print("⚠️  parquet 已含 branch_code 列（说明本 oracle 跑在派生后的产物上）；")
        print("    将以现 branch_code 列为基线对比派生后是否字节一致；其它列同样 hash")

    before_hashes = {c: column_hash(df_before[c]) for c in before_cols}

    # 2. 重派生（用 copy 防 mutate 影响 before 基线）
    print(f"\n🔄 重派生 branch_code (declared='{args.declared_branch}')...")
    df_after = derive_renewal_tracker_branch_code(df_before.copy(), args.declared_branch)
    print(f"   派生后: {len(df_after):,} 行 / {len(df_after.columns)} 列")

    # 3. DESCRIBE 前后 schema 对比（codex 闸-1 P1.2 + 闸-2 P1.2）
    # 必须经真实 COPY → read_parquet 回读路径（生产 ETL 走的就是这条），
    # 而非仅 con.register(df_after) — 后者绕过 parquet 序列化，无法捕捉
    # arrow→parquet→arrow 路径上潜在的精度损失/类型变化（如 HUGEINT→DOUBLE）
    con.register("derived_view_inmem", df_after)
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        con.execute(
            f"COPY derived_view_inmem TO '{tmp_path}' (FORMAT PARQUET, COMPRESSION 'zstd')"
        )
        con.execute(f"CREATE OR REPLACE VIEW derived_view AS SELECT * FROM '{tmp_path}'")
        schema_after = schema_snapshot(con, "derived_view")
        # 回读后的 df 用于业务字段 hash 复核（替代 in-memory df_after）
        df_after = con.execute("SELECT * FROM derived_view").fetchdf()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    print("\n📊 Schema 对比 (DESCRIBE 前后):")
    schema_diff_failed = False
    for col in before_cols:
        if col not in schema_after:
            print(f"   ❌ 列 {col} 在派生后消失")
            schema_diff_failed = True
            continue
        if schema_before[col] != schema_after[col]:
            print(f"   ❌ 列 {col} 类型变化: {schema_before[col]} → {schema_after[col]}")
            schema_diff_failed = True
    new_cols = set(schema_after) - set(schema_before)
    if new_cols == {"branch_code"}:
        print(f"   ✅ 新增列符合预期: branch_code ({schema_after['branch_code']})")
    elif new_cols == set():
        # 若 src 已含 branch_code（重跑 oracle）→ 无新增列也正确
        print("   ℹ️  无新增列（src 已含 branch_code，oracle 跑在派生后产物上）")
    else:
        print(f"   ❌ 意外新增列: {new_cols}")
        schema_diff_failed = True

    # 4. 业务字段 hash 全等（branch_code 列单独验证）
    print("\n🔐 业务字段 sha256 hash 对比:")
    business_cols = [c for c in before_cols if c != "branch_code"]
    after_hashes = {c: column_hash(df_after[c]) for c in business_cols}
    mismatch = [c for c in business_cols if before_hashes[c] != after_hashes[c]]
    if mismatch:
        for c in mismatch:
            print(f"   ❌ 列 {c} hash 不等:")
            print(f"      before: {before_hashes[c][:16]}...")
            print(f"      after:  {after_hashes[c][:16]}...")
    else:
        print(f"   ✅ 业务字段 {len(business_cols)} 列 hash 全等")

    # 5. branch_code 契约
    print("\n🎯 branch_code 列契约:")
    branch_failed = False
    if "branch_code" not in df_after.columns:
        print("   ❌ 派生后 branch_code 列缺失")
        branch_failed = True
    else:
        nulls = int(df_after["branch_code"].isna().sum())
        unique_vals = set(df_after["branch_code"].dropna().unique())
        print(f"   行数: {len(df_after):,} / NULL: {nulls} / 唯一值: {sorted(unique_vals)}")
        if nulls != 0:
            print("   ❌ branch_code 含 NULL")
            branch_failed = True
        if unique_vals != {args.declared_branch}:
            print(f"   ❌ branch_code 唯一值 ≠ {{{args.declared_branch}}}")
            branch_failed = True
        if not branch_failed:
            print(f"   ✅ branch_code 全 {args.declared_branch} 零 NULL")

    # 6. 临时列必 drop
    print("\n🧹 临时列 drop:")
    tmp_left = [c for c in df_after.columns if c.startswith("__tmp_")]
    if tmp_left or "policy_no" in df_after.columns:
        print(f"   ❌ 临时列未 drop: {tmp_left} / 'policy_no' in cols: {'policy_no' in df_after.columns}")
        branch_failed = True
    else:
        print("   ✅ 临时列已 drop")

    print("\n" + "=" * 60)
    if mismatch or schema_diff_failed or branch_failed:
        print("❌ oracle 失败")
        sys.exit(1)
    print(f"✅ oracle 全过: {len(df_after):,} 行 / {len(business_cols)} 业务字段 hash 全等 / "
          f"schema 保真 / branch_code 全 {args.declared_branch} 零 NULL")
    sys.exit(0)


if __name__ == "__main__":
    main()
