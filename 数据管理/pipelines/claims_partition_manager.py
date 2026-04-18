#!/usr/bin/env python3
"""
赔案明细分区管理器 — 按保险起期年度分区 + CDC 变更捕获

架构设计：
  claims_detail/
  ├── claims_2019.parquet      ← frozen（全部已决）
  ├── claims_2020.parquet      ← frozen
  ├── ...
  ├── claims_2025.parquet      ← hot（每日 CDC）
  ├── claims_2026.parquet      ← hot（每日 CDC）
  └── _partition_meta.json     ← 分区元数据（冻结状态、行数、最后更新）

用法：
  # 初始迁移：单文件 latest.parquet → 年度分区
  python3 claims_partition_manager.py migrate -i latest.parquet -o claims_detail/

  # CDC 更新：新转换的 parquet 合入已有分区
  python3 claims_partition_manager.py update -i new_data.parquet -o claims_detail/

  # 查看分区状态
  python3 claims_partition_manager.py status -o claims_detail/

分区键：insurance_year（从 insurance_start_date 派生）
主键：claim_no（全局唯一，零重复）
冻结条件：分区内 claim_status 全部为 '已业务结案'
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import duckdb


def parse_args():
    parser = argparse.ArgumentParser(description='赔案明细分区管理器')
    sub = parser.add_subparsers(dest='command', required=True)

    # migrate: 单文件 → 分区
    m = sub.add_parser('migrate', help='初始迁移：单文件 → 年度分区')
    m.add_argument('-i', '--input', required=True, help='输入 parquet（含 insurance_year 列）')
    m.add_argument('-o', '--output-dir', required=True, help='输出目录')

    # update: CDC 合入
    u = sub.add_parser('update', help='CDC 更新：新数据合入已有分区')
    u.add_argument('-i', '--input', required=True, help='新数据 parquet（含 insurance_year 列）')
    u.add_argument('-o', '--output-dir', required=True, help='分区目录')

    # status: 查看
    s = sub.add_parser('status', help='查看分区状态')
    s.add_argument('-o', '--output-dir', required=True, help='分区目录')

    return parser.parse_args()


META_FILE = '_partition_meta.json'


def load_meta(output_dir: Path) -> dict:
    meta_path = output_dir / META_FILE
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return {'partitions': {}, 'cdc_logs': []}


def save_meta(output_dir: Path, meta: dict):
    meta_path = output_dir / META_FILE
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str))


def partition_filename(year: int) -> str:
    return f'claims_{year}.parquet'


def check_frozen(parquet_path: str) -> dict:
    """检查分区是否可冻结：所有赔案已业务结案。"""
    row = duckdb.sql(f"""
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE claim_status = '未业务结案') as pending,
            COALESCE(SUM(pending_amount) FILTER (WHERE claim_status = '未业务结案'), 0) as pending_amt
        FROM read_parquet('{parquet_path}')
    """).fetchone()
    return {
        'total': row[0],
        'pending_count': row[1],
        'pending_amount': float(row[2]),
        'frozen': row[1] == 0,
    }


def do_migrate(args):
    """初始迁移：单个 parquet → 按 insurance_year 分区。"""
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        print(f'❌ 输入文件不存在: {input_path}')
        sys.exit(1)

    # 确认 insurance_year 列存在
    cols = [r[0] for r in duckdb.sql(f"SELECT name FROM parquet_schema('{input_path}')").fetchall()]
    if 'insurance_year' not in cols:
        print(f'❌ 输入文件缺少 insurance_year 列。请先用 convert_claims_detail.py --policy-dir 生成。')
        sys.exit(1)

    # 获取年份分布
    years = duckdb.sql(f"""
        SELECT insurance_year, COUNT(*) as cnt
        FROM read_parquet('{input_path}')
        WHERE insurance_year IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """).fetchall()

    null_count = duckdb.sql(f"""
        SELECT COUNT(*) FROM read_parquet('{input_path}') WHERE insurance_year IS NULL
    """).fetchone()[0]
    if null_count > 0:
        print(f'⚠ {null_count:,} 行 insurance_year 为 NULL（将归入 unknown 分区）')

    print(f'\n{"="*60}')
    print(f'📦 初始迁移: {input_path.name} → {len(years)} 个年度分区')
    print(f'{"="*60}\n')

    meta = load_meta(output_dir)
    total_written = 0

    for year_val, cnt in years:
        year = int(year_val)
        filename = partition_filename(year)
        out_path = output_dir / filename
        tmp_path = output_dir / f'{filename}.tmp'

        # 原子写入：先写 tmp，再 rename
        duckdb.sql(f"""
            COPY (
                SELECT * FROM read_parquet('{input_path}')
                WHERE insurance_year = {year}
                ORDER BY report_time
            ) TO '{tmp_path}' (FORMAT PARQUET, COMPRESSION SNAPPY)
        """)
        if out_path.exists():
            out_path.unlink()
        tmp_path.rename(out_path)

        # 冻结检测
        status = check_frozen(str(out_path))
        frozen_tag = '🧊 FROZEN' if status['frozen'] else f'🔥 {status["pending_count"]} 件未决'

        meta['partitions'][str(year)] = {
            'file': filename,
            'rows': cnt,
            'frozen': status['frozen'],
            'pending_count': status['pending_count'],
            'pending_amount': status['pending_amount'],
            'last_updated': datetime.now().isoformat(),
        }

        size_mb = out_path.stat().st_size / 1024 / 1024
        print(f'  {year}: {cnt:>8,} 行, {size_mb:>5.1f} MB  {frozen_tag}')
        total_written += cnt

    # NULL 年份兜底
    if null_count > 0:
        filename = 'claims_unknown.parquet'
        out_path = output_dir / filename
        duckdb.sql(f"""
            COPY (
                SELECT * FROM read_parquet('{input_path}')
                WHERE insurance_year IS NULL
                ORDER BY report_time
            ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION SNAPPY)
        """)
        meta['partitions']['unknown'] = {
            'file': filename,
            'rows': null_count,
            'frozen': False,
            'last_updated': datetime.now().isoformat(),
        }
        total_written += null_count

    save_meta(output_dir, meta)

    print(f'\n  总计: {total_written:,} 行 → {len(years)} 个分区')
    print(f'  元数据: {output_dir / META_FILE}')
    print(f'✅ 迁移完成\n')


def do_update(args):
    """CDC 更新：新数据合入已有分区，生成变更日志。"""
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)

    if not input_path.exists():
        print(f'❌ 输入文件不存在: {input_path}')
        sys.exit(1)

    meta = load_meta(output_dir)
    if not meta['partitions']:
        print('❌ 目标目录无分区元数据。请先运行 migrate。')
        sys.exit(1)

    # 新数据按年份分布
    new_years = duckdb.sql(f"""
        SELECT insurance_year, COUNT(*) as cnt
        FROM read_parquet('{input_path}')
        WHERE insurance_year IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """).fetchall()

    print(f'\n{"="*60}')
    print(f'🔄 CDC 更新: {input_path.name}')
    print(f'{"="*60}\n')

    cdc_summary = {
        'timestamp': datetime.now().isoformat(),
        'source': input_path.name,
        'partitions': {},
    }

    for year_val, new_cnt in new_years:
        year = int(year_val)
        filename = partition_filename(year)
        existing_path = output_dir / filename
        tmp_path = output_dir / f'{filename}.tmp'

        year_key = str(year)
        partition_meta = meta['partitions'].get(year_key, {})

        # 冻结分区检测
        if partition_meta.get('frozen', False):
            # 即使冻结，如果新数据有该年份的赔案，解冻并合入
            print(f'  ⚠ {year}: 冻结分区收到 {new_cnt:,} 条新数据，自动解冻')

        if existing_path.exists():
            # ── CDC 变更检测 ──
            cdc = duckdb.sql(f"""
                WITH new_data AS (
                    SELECT * FROM read_parquet('{input_path}') WHERE insurance_year = {year}
                ),
                old_data AS (
                    SELECT * FROM read_parquet('{existing_path}')
                )
                SELECT
                    -- 新增：new 中有但 old 中没有的 claim_no
                    COUNT(*) FILTER (WHERE o.claim_no IS NULL) as inserted,
                    -- 状态变更：claim_status 不同
                    COUNT(*) FILTER (WHERE o.claim_no IS NOT NULL
                        AND n.claim_status != o.claim_status) as status_changed,
                    -- 金额变更：settled_amount 或 pending_amount 不同（状态相同）
                    COUNT(*) FILTER (WHERE o.claim_no IS NOT NULL
                        AND n.claim_status = o.claim_status
                        AND (COALESCE(n.settled_amount,0) != COALESCE(o.settled_amount,0)
                          OR COALESCE(n.pending_amount,0) != COALESCE(o.pending_amount,0))) as amount_changed,
                    -- 无变化
                    COUNT(*) FILTER (WHERE o.claim_no IS NOT NULL
                        AND n.claim_status = o.claim_status
                        AND COALESCE(n.settled_amount,0) = COALESCE(o.settled_amount,0)
                        AND COALESCE(n.pending_amount,0) = COALESCE(o.pending_amount,0)) as unchanged,
                    -- 已决→重开（特殊关注）
                    COUNT(*) FILTER (WHERE o.claim_no IS NOT NULL
                        AND o.claim_status = '已业务结案'
                        AND n.claim_status = '未业务结案') as reopened
                FROM new_data n
                LEFT JOIN old_data o USING (claim_no)
            """).fetchone()

            inserted, status_changed, amount_changed, unchanged, reopened = cdc

            # 保留 old 中不在 new 中的行（这些行的报案时间不在本次更新范围内）
            old_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{existing_path}')").fetchone()[0]

            # UNION ALL BY NAME 兼容新旧 schema 漂移（2025+ 无 settled_fee，新增 subject_repair）
            duckdb.sql(f"""
                COPY (
                    SELECT * FROM read_parquet('{input_path}') WHERE insurance_year = {year}
                    UNION ALL BY NAME
                    SELECT * FROM read_parquet('{existing_path}')
                    WHERE claim_no NOT IN (
                        SELECT claim_no FROM read_parquet('{input_path}') WHERE insurance_year = {year}
                    )
                    ORDER BY report_time
                ) TO '{tmp_path}' (FORMAT PARQUET, COMPRESSION SNAPPY)
            """)

            merged_cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{tmp_path}')").fetchone()[0]

            # 原子替换
            existing_path.unlink()
            tmp_path.rename(existing_path)

            # CDC 日志
            change_info = {
                'old_rows': old_cnt,
                'new_input': new_cnt,
                'merged_rows': merged_cnt,
                'inserted': inserted,
                'status_changed': status_changed,
                'amount_changed': amount_changed,
                'unchanged': unchanged,
                'reopened': reopened,
            }
            cdc_summary['partitions'][year_key] = change_info

            # 状态行
            changes = []
            if inserted: changes.append(f'+{inserted} 新增')
            if status_changed: changes.append(f'↔{status_changed} 状态变更')
            if amount_changed: changes.append(f'${amount_changed} 金额调整')
            if reopened: changes.append(f'⚠{reopened} 已决重开')
            change_str = ', '.join(changes) if changes else '无变化'

            print(f'  {year}: {old_cnt:,}→{merged_cnt:,} ({change_str})')
            if reopened > 0:
                print(f'       🚨 警告: {reopened} 件已决赔案被重新打开为未决！')

        else:
            # 全新年份分区
            duckdb.sql(f"""
                COPY (
                    SELECT * FROM read_parquet('{input_path}') WHERE insurance_year = {year}
                    ORDER BY report_time
                ) TO '{tmp_path}' (FORMAT PARQUET, COMPRESSION SNAPPY)
            """)
            tmp_path.rename(existing_path)

            cdc_summary['partitions'][year_key] = {
                'old_rows': 0,
                'new_input': new_cnt,
                'merged_rows': new_cnt,
                'inserted': new_cnt,
                'status_changed': 0, 'amount_changed': 0, 'unchanged': 0, 'reopened': 0,
            }
            print(f'  {year}: 新建分区, {new_cnt:,} 行')

        # 更新冻结状态
        status = check_frozen(str(existing_path))
        frozen_tag = ' 🧊' if status['frozen'] else ''
        size_mb = existing_path.stat().st_size / 1024 / 1024
        meta['partitions'][year_key] = {
            'file': filename,
            'rows': duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{existing_path}')").fetchone()[0],
            'frozen': status['frozen'],
            'pending_count': status['pending_count'],
            'pending_amount': status['pending_amount'],
            'last_updated': datetime.now().isoformat(),
        }
        if frozen_tag:
            print(f'       → 全部已决，标记为冻结{frozen_tag}')

    # 保存 CDC 日志
    meta['cdc_logs'].append(cdc_summary)
    # 只保留最近 30 条日志
    meta['cdc_logs'] = meta['cdc_logs'][-30:]
    save_meta(output_dir, meta)

    # 汇总
    total_inserted = sum(p.get('inserted', 0) for p in cdc_summary['partitions'].values())
    total_changed = sum(p.get('status_changed', 0) + p.get('amount_changed', 0)
                        for p in cdc_summary['partitions'].values())
    total_reopened = sum(p.get('reopened', 0) for p in cdc_summary['partitions'].values())
    print(f'\n  CDC 汇总: +{total_inserted} 新增, ~{total_changed} 变更, ⚠{total_reopened} 重开')
    print(f'✅ CDC 更新完成\n')


def do_status(args):
    """查看所有分区的状态。"""
    output_dir = Path(args.output_dir)
    meta = load_meta(output_dir)

    if not meta['partitions']:
        # 回退：扫描目录中的 parquet 文件
        files = sorted(output_dir.glob('claims_*.parquet'))
        if not files:
            print('❌ 目录为空')
            return
        print('⚠ 无元数据，从文件扫描:')
        for f in files:
            cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{f}')").fetchone()[0]
            status = check_frozen(str(f))
            tag = '🧊 FROZEN' if status['frozen'] else f'🔥 {status["pending_count"]} 件未决'
            print(f'  {f.name}: {cnt:,} 行  {tag}')
        return

    print(f'\n{"="*60}')
    print(f'📊 赔案明细分区状态')
    print(f'{"="*60}\n')
    print(f'  {"年度":<8} {"行数":>10} {"状态":<12} {"未决件":>8} {"未决金额":>14} {"最后更新":<20}')
    print(f'  {"─"*8} {"─"*10} {"─"*12} {"─"*8} {"─"*14} {"─"*20}')

    total_rows = 0
    total_pending = 0
    for year_key in sorted(meta['partitions'].keys()):
        p = meta['partitions'][year_key]
        rows = p.get('rows', 0)
        frozen = p.get('frozen', False)
        pending = p.get('pending_count', 0)
        pending_amt = p.get('pending_amount', 0)
        updated = p.get('last_updated', '')[:16]
        tag = '🧊 冻结' if frozen else '🔥 活跃'

        print(f'  {year_key:<8} {rows:>10,} {tag:<12} {pending:>8,} {pending_amt:>14,.0f} {updated:<20}')
        total_rows += rows
        total_pending += pending

    print(f'  {"─"*8} {"─"*10} {"─"*12} {"─"*8}')
    print(f'  {"合计":<8} {total_rows:>10,} {"":12} {total_pending:>8,}')

    # 最近 CDC 日志
    if meta.get('cdc_logs'):
        last = meta['cdc_logs'][-1]
        print(f'\n  最近 CDC: {last["timestamp"][:16]} ({last["source"]})')
        for yk, info in sorted(last.get('partitions', {}).items()):
            parts = []
            if info.get('inserted'): parts.append(f'+{info["inserted"]}')
            if info.get('status_changed'): parts.append(f'↔{info["status_changed"]}')
            if info.get('reopened'): parts.append(f'⚠{info["reopened"]}')
            if parts:
                print(f'    {yk}: {", ".join(parts)}')

    print()


def main():
    args = parse_args()
    if args.command == 'migrate':
        do_migrate(args)
    elif args.command == 'update':
        do_update(args)
    elif args.command == 'status':
        do_status(args)


if __name__ == '__main__':
    main()
