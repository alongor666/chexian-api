"""
CLI 入口
=========
用法:
  python3 -m scripts.reconcile_loss_ratio_weekly             # 用本周六做 cutoff
  python3 -m scripts.reconcile_loss_ratio_weekly --week 2026-05-16
  python3 -m scripts.reconcile_loss_ratio_weekly --week 2026-05-16 --verbose
"""
from __future__ import annotations
import argparse
import datetime
import sys
from .config import XLSX_PATH
from .xlsx_parser import parse_all as parse_xlsx
from .project_loader import query_all as query_project
from .reconcile import reconcile


def _last_saturday(today: datetime.date | None = None) -> str:
    """返回最近一个周六的 YYYY-MM-DD。"""
    d = today or datetime.date.today()
    # weekday(): Mon=0..Sun=6, Sat=5
    delta = (d.weekday() - 5) % 7
    return (d - datetime.timedelta(days=delta)).isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='车险赔付率周报对账：xlsx 权威表 ↔ 项目 DuckDB 直查')
    parser.add_argument('--week', help='截至日期 YYYY-MM-DD（默认：最近周六）')
    parser.add_argument('--policy-year', default='2026',
                        help='对账的保单年度（默认 2026；起期+报案时间均限定 [year-01-01, cutoff]）')
    parser.add_argument('--xlsx', default=XLSX_PATH, help=f'xlsx 路径（默认 {XLSX_PATH}）')
    parser.add_argument('--verbose', action='store_true', help='输出 WARN 详情')
    args = parser.parse_args(argv)

    week = args.week or _last_saturday()
    print(f'>>> 开始对账 周次={week} 保单年度={args.policy_year} YTD口径')
    print(f'    起期 ∈ [{args.policy_year}-01-01, {week}]')
    print(f'    报案 ∈ [{args.policy_year}-01-01, {week}]')
    print(f'    xlsx: {args.xlsx}')

    print('[1/3] 解析 xlsx (1.1.1 → 客户类别 7 类) ...')
    external = parse_xlsx(args.xlsx, policy_year=args.policy_year)
    print(f'      → {len(external)} 条 records')

    print('[2/3] 项目侧 DuckDB 直查（客户类别 7 类 + 合计） ...')
    project = query_project(week, args.policy_year)
    print(f'      → {len(project)} 条 records')

    print('[3/3] 对账判定 + 输出 ...')
    summary = reconcile(external, project, week=week, verbose=args.verbose)

    return 1 if summary['overall'].get('FAIL', 0) > 0 else 0


if __name__ == '__main__':
    sys.exit(main())
