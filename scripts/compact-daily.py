#!/usr/bin/env python3
"""
compact-daily.py — 将 daily/ 下的历史 Parquet 按年合并

用法：
  python3 scripts/compact-daily.py            # dry-run 预览（默认）
  python3 scripts/compact-daily.py --dry-run  # 同上，明确指定
  python3 scripts/compact-daily.py --execute  # 实际执行合并 + 删除原文件

规则：
  - 2025 年及之前：按年合并为 policy-YYYY.parquet，合并后删除原 daily 文件
  - 2026 年：保留不动（仍为 daily 增量）
  - 合并前后行数对比：不一致则回退（删除输出文件，保留原文件）
"""

import argparse
import sys
import os
from pathlib import Path
from collections import defaultdict

# ── 路径配置 ────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DAILY_DIR = PROJECT_ROOT / "数据管理/warehouse/fact/policy/daily"
OUTPUT_DIR = DAILY_DIR  # 合并文件也放在 daily/ 下，与原文件同目录

CUTOFF_YEAR = 2026  # 2026 年及以后保留 daily 不合并

# ── 工具函数 ─────────────────────────────────────────────────────────────────


def get_duckdb():
    """导入 duckdb，不存在时给出友好提示。"""
    try:
        import duckdb
        return duckdb
    except ImportError:
        print("ERROR: 缺少 duckdb 包，请先安装：pip install duckdb", file=sys.stderr)
        sys.exit(1)


def scan_daily_files(daily_dir: Path) -> dict[int, list[Path]]:
    """
    扫描 daily 目录，返回 {year: [sorted_paths]} 映射。
    只处理 YYYY-MM-DD.parquet 格式的文件。
    """
    year_files: dict[int, list[Path]] = defaultdict(list)
    for f in sorted(daily_dir.glob("*.parquet")):
        stem = f.stem  # e.g. "2021-01-15"
        # 跳过已经合并的年度文件（policy-YYYY.parquet）
        if stem.startswith("policy-"):
            continue
        parts = stem.split("-")
        if len(parts) != 3:
            continue
        try:
            year = int(parts[0])
        except ValueError:
            continue
        year_files[year].append(f)
    return dict(year_files)


def count_rows(duckdb, file_path: Path) -> int:
    """用 DuckDB 统计单个 Parquet 文件的行数。"""
    result = duckdb.execute(
        f"SELECT COUNT(*) FROM read_parquet('{file_path}')"
    ).fetchone()
    return result[0] if result else 0


def count_rows_glob(duckdb, glob_pattern: str) -> int:
    """用 DuckDB 统计多个 Parquet 文件的总行数（union_by_name）。"""
    result = duckdb.execute(
        f"SELECT COUNT(*) FROM read_parquet('{glob_pattern}', union_by_name=true)"
    ).fetchone()
    return result[0] if result else 0


def compact_year(duckdb, year: int, files: list[Path], output_dir: Path, dry_run: bool) -> bool:
    """
    合并指定年份的文件。

    Returns:
        True  — 成功（或 dry-run 预览完成）
        False — 失败（行数不一致，已回退）
    """
    output_path = output_dir / f"policy-{year}.parquet"
    n_files = len(files)

    # 收集所有文件路径（用于 glob 模式）
    file_list_sql = ", ".join(f"'{f}'" for f in files)
    glob_expr = f"[{file_list_sql}]"

    if dry_run:
        print(f"[DRY RUN] Would compact {n_files:>4} files from {year} → {output_path.name}")
        return True

    # ── 实际执行 ──────────────────────────────────────────────────────────
    print(f"[COMPACT] {year}: 统计原始行数 ({n_files} 个文件)...", end=" ", flush=True)

    # 统计合并前行数
    before_rows = count_rows_glob(duckdb, f"{output_dir}/{year}-*.parquet")
    print(f"{before_rows:,} 行")

    # 若输出文件已存在，先检查是否重复操作
    if output_path.exists():
        existing_rows = count_rows(duckdb, output_path)
        print(f"[WARN] 输出文件已存在（{existing_rows:,} 行），将覆盖重建...")
        output_path.unlink()

    # 执行合并 COPY
    print(f"[COMPACT] {year}: 写入 {output_path.name}...", end=" ", flush=True)
    duckdb.execute(f"""
        COPY (
            SELECT * FROM read_parquet({glob_expr}, union_by_name=true)
        ) TO '{output_path}'
        (FORMAT parquet, COMPRESSION zstd)
    """)
    print("完成")

    # ── 行数校验 ─────────────────────────────────────────────────────────
    print(f"[VERIFY] {year}: 校验行数...", end=" ", flush=True)
    after_rows = count_rows(duckdb, output_path)
    print(f"合并前={before_rows:,}  合并后={after_rows:,}", end="  ")

    if before_rows != after_rows:
        print(f"❌ 行数不一致！回退：删除 {output_path.name}")
        output_path.unlink(missing_ok=True)
        return False

    print("✓ 一致")

    # ── 删除原 daily 文件 ────────────────────────────────────────────────
    print(f"[DELETE] {year}: 删除 {n_files} 个 daily 原文件...", end=" ", flush=True)
    deleted = 0
    for f in files:
        try:
            f.unlink()
            deleted += 1
        except OSError as e:
            print(f"\n[WARN] 删除 {f.name} 失败: {e}")
    print(f"{deleted}/{n_files} 个已删除")

    return True


# ── 主程序 ───────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="将 daily/ 下历史 Parquet 按年合并（2025 及之前）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="仅预览，不执行任何写入/删除（默认）",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="实际执行合并和删除",
    )
    args = parser.parse_args()

    dry_run = not args.execute

    # ── 检查目录 ─────────────────────────────────────────────────────────
    if not DAILY_DIR.exists():
        print(f"ERROR: daily 目录不存在: {DAILY_DIR}", file=sys.stderr)
        sys.exit(1)

    # ── 扫描文件 ─────────────────────────────────────────────────────────
    year_files = scan_daily_files(DAILY_DIR)
    if not year_files:
        print("没有找到任何 YYYY-MM-DD.parquet 文件，退出。")
        sys.exit(0)

    # 分离：需要合并的年份 vs 保留的年份
    archive_years = sorted(y for y in year_files if y < CUTOFF_YEAR)
    keep_years = sorted(y for y in year_files if y >= CUTOFF_YEAR)

    mode_label = "[DRY RUN]" if dry_run else "[EXECUTE]"
    print(f"{mode_label} compact-daily.py")
    print(f"  daily 目录  : {DAILY_DIR}")
    print(f"  归档年份    : {archive_years if archive_years else '（无）'}")
    print(f"  保留年份    : {keep_years if keep_years else '（无）'}")
    print()

    if not archive_years:
        print("没有需要归档的年份（2025 及之前），退出。")
        sys.exit(0)

    # ── 预览/执行摘要 ────────────────────────────────────────────────────
    total_files = sum(len(year_files[y]) for y in archive_years)
    if dry_run:
        for year in archive_years:
            files = year_files[year]
            output_path = OUTPUT_DIR / f"policy-{year}.parquet"
            print(
                f"[DRY RUN] Would compact {len(files):>4} files from {year} "
                f"→ {output_path.name}"
            )
        print()
        print(
            f"[DRY RUN] 合计: {len(archive_years)} 个年份 / {total_files} 个文件 "
            f"将被合并并删除"
        )
        print()
        print("提示：运行 --execute 参数执行实际操作：")
        print(f"  python3 scripts/compact-daily.py --execute")
        return

    # ── 实际执行 ─────────────────────────────────────────────────────────
    duckdb = get_duckdb()
    con = duckdb.connect()  # 内存模式，无持久化

    success_years = []
    failed_years = []

    for year in archive_years:
        files = year_files[year]
        print(f"\n{'─' * 60}")
        ok = compact_year(con, year, files, OUTPUT_DIR, dry_run=False)
        if ok:
            success_years.append(year)
        else:
            failed_years.append(year)

    con.close()

    # ── 最终汇总 ─────────────────────────────────────────────────────────
    print(f"\n{'═' * 60}")
    print(f"[DONE] 成功: {len(success_years)} 个年份 {success_years}")
    if failed_years:
        print(f"[FAIL] 失败（已回退）: {len(failed_years)} 个年份 {failed_years}")
        sys.exit(1)
    else:
        print("[DONE] 所有年份合并校验通过 ✓")


if __name__ == "__main__":
    main()
