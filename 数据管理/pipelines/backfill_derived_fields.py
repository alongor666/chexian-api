#!/usr/bin/env python3
"""
派生字段 backfill — 从 fields.json 读派生规则，应用到现有 Parquet 分片

用途：
  首次引入派生字段时，历史分片需要一次性补齐。未来新增分片由 transform.py 直接物化。

规则来源：
  server/src/config/field-registry/fields.json 中 derived:true 的字段

支持的 derivation.type：
  - prefix_map: 按源列前缀 N 位映射到系数

用法：
  python3 数据管理/pipelines/backfill_derived_fields.py           # 执行（跳过已存在）
  python3 数据管理/pipelines/backfill_derived_fields.py --force   # 强制覆盖已存在的派生列
  python3 数据管理/pipelines/backfill_derived_fields.py --dry-run # 只打印计划不写入

扫描目录：数据管理/warehouse/fact/policy/current/*.parquet
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY_PATH = ROOT / "server/src/config/field-registry/fields.json"
POLICY_CURRENT = ROOT / "数据管理/warehouse/fact/policy/current"


def load_derived_rules() -> list[dict]:
    """读 fields.json 返回 derived:true 的字段列表。"""
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)
    return [fd for fd in registry.get("fields", []) if fd.get("derived")]


def apply_derivation(df: pd.DataFrame, field: dict, force: bool) -> tuple[pd.DataFrame, str]:
    """对 DataFrame 应用单个派生规则。返回 (新 df, 状态描述)。"""
    fid = field["id"]
    rule = field.get("derivation", {})
    rtype = rule.get("type")
    source = rule.get("source")

    if not source or source not in df.columns:
        return df, f"skip({fid}: source {source} missing)"

    if fid in df.columns and not force:
        nonnull = df[fid].notna().sum()
        return df, f"skip({fid}: already exists, {nonnull:,} non-null, use --force to overwrite)"

    if rtype == "prefix_map":
        prefix_len = rule.get("prefixLength", 2)
        mapping = rule.get("mapping", {})
        default_value = rule.get("defaultValue")
        df[fid] = df[source].astype(str).str[:prefix_len].map(mapping)
        if default_value is not None:
            df[fid] = df[fid].fillna(default_value)
        nonnull = df[fid].notna().sum()
        return df, f"ok({fid}: {nonnull:,}/{len(df):,} non-null)"

    return df, f"skip({fid}: unsupported derivation.type={rtype})"


def backfill_parquet(path: Path, derived_fields: list[dict], force: bool, dry_run: bool) -> dict:
    """处理单个 Parquet 文件。"""
    table = pq.read_table(path)
    df = table.to_pandas()
    original_cols = set(df.columns)
    statuses = []

    for field in derived_fields:
        df, status = apply_derivation(df, field, force)
        statuses.append(status)

    added_cols = set(df.columns) - original_cols
    if not added_cols and not force:
        return {"path": path.name, "changed": False, "statuses": statuses}

    if dry_run:
        return {"path": path.name, "changed": True, "dry_run": True, "statuses": statuses}

    # 重写 Parquet，合并原 L1 metadata（保留 etl_* 键）+ pyarrow 重建的 pandas metadata（反映新列）
    import pyarrow as pa

    new_table = pa.Table.from_pandas(df, preserve_index=False)
    fresh_metadata = dict(new_table.schema.metadata or {})
    original_metadata = dict(table.schema.metadata or {})
    for k, v in original_metadata.items():
        if k.startswith(b"etl_"):
            fresh_metadata[k] = v
    new_table = new_table.replace_schema_metadata(fresh_metadata)
    pq.write_table(new_table, str(path), compression="snappy")

    return {"path": path.name, "changed": True, "statuses": statuses, "rows": len(df)}


def main():
    parser = argparse.ArgumentParser(description="派生字段 backfill")
    parser.add_argument("--force", action="store_true", help="强制覆盖已存在的派生列")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划不写入")
    args = parser.parse_args()

    derived_fields = load_derived_rules()
    if not derived_fields:
        print("⚠️  fields.json 中没有 derived:true 字段，退出")
        return 0

    print(f"📋 派生字段规则: {len(derived_fields)} 个")
    for fd in derived_fields:
        print(f"   - {fd['id']} ({fd.get('derivation', {}).get('type', '?')})")

    if not POLICY_CURRENT.exists():
        print(f"❌ 分片目录不存在: {POLICY_CURRENT}")
        return 1

    parquet_files = sorted(POLICY_CURRENT.glob("*.parquet"))
    print(f"\n📁 扫描 {POLICY_CURRENT.relative_to(ROOT)}: {len(parquet_files)} 个分片\n")

    if not parquet_files:
        print("⚠️  无分片文件")
        return 0

    changed_count = 0
    total_rows = 0
    for path in parquet_files:
        result = backfill_parquet(path, derived_fields, args.force, args.dry_run)
        tag = "DRY-RUN" if result.get("dry_run") else ("✅" if result["changed"] else "⏭️ ")
        print(f"{tag} {result['path']}")
        for s in result["statuses"]:
            print(f"       {s}")
        if result["changed"]:
            changed_count += 1
            total_rows += result.get("rows", 0)

    print(f"\n{'=' * 60}")
    print(f"✅ 完成: {changed_count}/{len(parquet_files)} 分片已处理")
    if not args.dry_run and total_rows:
        print(f"   总记录数: {total_rows:,}")
    if args.dry_run:
        print("   (dry-run 模式，未实际写入)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
