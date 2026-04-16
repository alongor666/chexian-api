#!/usr/bin/env python3
"""
报价数据快照管理器 — L1/L2 两层架构

L1 操作层（近2月）：行级明细，追踪在途报价
L2 分析层（历史）：VIN+报价年度+险类 = 1行，维度压缩为统计字段

架构：
  quotes_conversion/
  ├── latest.parquet           ← L1+L2 合并，服务端直读
  ├── _detail_recent.parquet   ← L1 近2月明细（ETL 缓存）
  ├── _snapshot_hist.parquet   ← L2 历史快照（ETL 缓存）
  └── _snapshot_meta.json      ← 元数据（最近明细月份、历史快照月份）

用法：
  # 从全量明细生成 L1+L2（首次或月度重建）
  python3 quote_snapshot_manager.py build -i detail.parquet -o quotes_conversion/ --recent-months 2

  # 查看状态
  python3 quote_snapshot_manager.py status -o quotes_conversion/
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import duckdb


def parse_args():
    parser = argparse.ArgumentParser(description='报价数据快照管理器')
    sub = parser.add_subparsers(dest='command', required=True)

    b = sub.add_parser('build', help='从全量明细生成 L1+L2')
    b.add_argument('-i', '--input', required=True, help='全量明细 parquet')
    b.add_argument('-o', '--output-dir', required=True, help='输出目录')
    b.add_argument('--recent-months', type=int, default=2, help='保留明细的近 N 月（默认 2）')

    s = sub.add_parser('status', help='查看快照状态')
    s.add_argument('-o', '--output-dir', required=True, help='快照目录')

    return parser.parse_args()


META_FILE = '_snapshot_meta.json'


def load_meta(d: Path) -> dict:
    p = d / META_FILE
    return json.loads(p.read_text()) if p.exists() else {}


def save_meta(d: Path, meta: dict):
    (d / META_FILE).write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str))


def do_build(args):
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    recent_n = args.recent_months
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        print(f'❌ 输入文件不存在: {input_path}')
        sys.exit(1)

    # 确定近 N 月的边界
    months = duckdb.sql(f"""
        SELECT DISTINCT STRFTIME('%Y-%m', CAST(quote_time AS DATE)) as m
        FROM read_parquet('{input_path}')
        ORDER BY m DESC
    """).fetchall()
    all_months = [r[0] for r in months]
    recent_months = set(all_months[:recent_n])
    hist_months = set(all_months[recent_n:])

    print(f'\n{"="*60}')
    print(f'📦 报价快照构建: L1 明细 + L2 历史快照')
    print(f'{"="*60}')
    print(f'  近期明细月份 (L1): {sorted(recent_months)}')
    if hist_months:
        print(f'  历史快照月份 (L2): {sorted(hist_months)[0]} ~ {sorted(hist_months)[-1]} ({len(hist_months)} 月)')
    else:
        print(f'  历史快照月份 (L2): 无（数据不足 {recent_n} 月，全部保留明细）')

    # ── L1: 近 N 月明细 ──
    l1_path = output_dir / '_detail_recent.parquet'
    l1_tmp = output_dir / '_detail_recent.parquet.tmp'
    month_list = ', '.join(f"'{m}'" for m in recent_months)
    duckdb.sql(f"""
        COPY (
            SELECT *, 1 AS quote_count, 1 AS salesman_count, 1 AS org_count,
                   quote_time AS first_quote_time, quote_time AS last_quote_time
            FROM read_parquet('{input_path}')
            WHERE STRFTIME('%Y-%m', CAST(quote_time AS DATE)) IN ({month_list})
        ) TO '{l1_tmp}' (FORMAT PARQUET, COMPRESSION SNAPPY)
    """)
    l1_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{l1_tmp}')").fetchone()[0]
    if l1_path.exists():
        l1_path.unlink()
    l1_tmp.rename(l1_path)
    l1_mb = l1_path.stat().st_size / 1024 / 1024
    print(f'\n  L1 明细: {l1_cnt:,} 行, {l1_mb:.1f} MB')

    # ── L2: 历史 VIN+年度+险类 快照 ──
    l2_path = output_dir / '_snapshot_hist.parquet'
    l2_cnt = 0
    l2_mb = 0.0

    if hist_months:
        l2_tmp = output_dir / '_snapshot_hist.parquet.tmp'
        hist_list = ', '.join(f"'{m}'" for m in hist_months)

        # 获取 L1 的列名（排除额外统计列），用于 L2 SELECT 对齐
        l1_cols = duckdb.sql(f"SELECT * FROM read_parquet('{l1_path}') LIMIT 0").columns
        # L2 用 LAST 聚合所有非主键、非统计列
        pk_cols = {'vehicle_frame_no', 'insurance_type'}
        stat_cols = {'quote_count', 'salesman_count', 'org_count', 'first_quote_time', 'last_quote_time'}
        agg_cols = [c for c in l1_cols if c not in pk_cols and c not in stat_cols]

        # 构造 LAST() 聚合表达式
        last_exprs = []
        for col in agg_cols:
            last_exprs.append(f"LAST({col} ORDER BY quote_time) AS {col}")
        last_sql = ',\n            '.join(last_exprs)

        duckdb.sql(f"""
            COPY (
                SELECT
                    vehicle_frame_no,
                    YEAR(CAST(quote_time AS DATE)) AS quote_year,
                    insurance_type,
                    {last_sql},
                    COUNT(*) AS quote_count,
                    COUNT(DISTINCT salesman_no) AS salesman_count,
                    COUNT(DISTINCT org_level_3) AS org_count,
                    MIN(quote_time) AS first_quote_time,
                    MAX(quote_time) AS last_quote_time
                FROM read_parquet('{input_path}')
                WHERE STRFTIME('%Y-%m', CAST(quote_time AS DATE)) IN ({hist_list})
                GROUP BY vehicle_frame_no, YEAR(CAST(quote_time AS DATE)), insurance_type
                ORDER BY vehicle_frame_no, quote_year
            ) TO '{l2_tmp}' (FORMAT PARQUET, COMPRESSION SNAPPY)
        """)
        l2_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{l2_tmp}')").fetchone()[0]
        if l2_path.exists():
            l2_path.unlink()
        l2_tmp.rename(l2_path)
        l2_mb = l2_path.stat().st_size / 1024 / 1024
        print(f'  L2 快照: {l2_cnt:,} 行, {l2_mb:.1f} MB')
    else:
        print(f'  L2 快照: 跳过（无历史月份）')
        if l2_path.exists():
            l2_path.unlink()

    # ── 合并 L1+L2 → latest.parquet ──
    latest_path = output_dir / 'latest.parquet'
    latest_tmp = output_dir / 'latest.parquet.tmp'
    if hist_months and l2_path.exists():
        duckdb.sql(f"""
            COPY (
                SELECT * FROM read_parquet('{l1_path}')
                UNION ALL BY NAME
                SELECT * FROM read_parquet('{l2_path}')
            ) TO '{latest_tmp}' (FORMAT PARQUET, COMPRESSION SNAPPY)
        """)
    else:
        # 只有 L1，直接复制
        import shutil
        shutil.copy2(str(l1_path), str(latest_tmp))

    total_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{latest_tmp}')").fetchone()[0]
    if latest_path.exists():
        latest_path.unlink()
    latest_tmp.rename(latest_path)
    total_mb = latest_path.stat().st_size / 1024 / 1024
    print(f'\n  合并 latest.parquet: {total_cnt:,} 行, {total_mb:.1f} MB')

    # 原始行数
    orig_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{input_path}')").fetchone()[0]
    orig_mb = input_path.stat().st_size / 1024 / 1024
    print(f'  原始:                {orig_cnt:,} 行, {orig_mb:.1f} MB')
    if total_cnt > 0:
        print(f'  压缩比:              {orig_cnt/total_cnt:.1f}x 行, {orig_mb/total_mb:.1f}x 体积')

    # 元数据
    meta = {
        'built_at': datetime.now().isoformat(),
        'recent_months': sorted(recent_months),
        'hist_months_range': f'{sorted(hist_months)[0]} ~ {sorted(hist_months)[-1]}' if hist_months else 'N/A',
        'l1_rows': l1_cnt,
        'l2_rows': l2_cnt,
        'total_rows': total_cnt,
        'original_rows': orig_cnt,
    }
    save_meta(output_dir, meta)
    print(f'\n✅ 快照构建完成')


def do_status(args):
    output_dir = Path(args.output_dir)
    meta = load_meta(output_dir)

    if not meta:
        print('❌ 无快照元数据')
        return

    print(f'\n{"="*60}')
    print(f'📊 报价快照状态')
    print(f'{"="*60}')
    print(f'  构建时间:   {meta.get("built_at", "N/A")[:16]}')
    print(f'  近期明细:   {meta.get("recent_months", [])}')
    print(f'  历史范围:   {meta.get("hist_months_range", "N/A")}')
    print(f'  L1 行数:    {meta.get("l1_rows", 0):,}')
    print(f'  L2 行数:    {meta.get("l2_rows", 0):,}')
    print(f'  合计:       {meta.get("total_rows", 0):,}')
    print(f'  原始:       {meta.get("original_rows", 0):,}')
    print()


def main():
    args = parse_args()
    if args.command == 'build':
        do_build(args)
    elif args.command == 'status':
        do_status(args)


if __name__ == '__main__':
    main()
