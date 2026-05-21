"""
CLI 入口
=========
用法:
  python3 -m scripts.reconcile_loss_ratio_weekly --xlsx /path/to/xlsx
  python3 -m scripts.reconcile_loss_ratio_weekly --week 2026-05-16 --xlsx /path/to/xlsx
  python3 -m scripts.reconcile_loss_ratio_weekly --week 2026-05-16 --verbose

环境变量（CLI 参数优先）：
  CX_RECONCILE_XLSX     xlsx 权威表路径（推荐 iCloud 同步路径）
  CX_DATA_ROOT          parquet 数据根目录（默认 = 仓库根）
  CX_RECONCILE_OUTPUT   输出根目录（默认 = 仓库根/数据管理/validation/loss-ratio-weekly）
"""
from __future__ import annotations
import argparse
import datetime
import os
import sys
from pathlib import Path
from . import config as _config
from .xlsx_parser import parse_all as parse_xlsx
from .project_loader import query_all as query_project
from .reconcile import reconcile


def _last_saturday(today: datetime.date | None = None) -> str:
    """返回最近一个周六的 YYYY-MM-DD。"""
    d = today or datetime.date.today()
    delta = (d.weekday() - 5) % 7
    return (d - datetime.timedelta(days=delta)).isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='车险赔付率周报对账：xlsx 权威表 ↔ 项目 DuckDB 直查',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='环境变量：CX_RECONCILE_XLSX / CX_DATA_ROOT / CX_RECONCILE_OUTPUT',
    )
    parser.add_argument('--week', help='截至日期 YYYY-MM-DD（默认：最近周六）')
    parser.add_argument('--policy-year', default='2026',
                        help='对账的保单年度（默认 2026；起期+报案时间均限定 [year-01-01, cutoff]）')
    parser.add_argument('--xlsx', default=_config.XLSX_PATH,
                        help='xlsx 路径（默认读环境变量 CX_RECONCILE_XLSX）')
    parser.add_argument('--data-root', default=str(_config.DATA_REPO_ROOT),
                        help='parquet 数据根目录（默认读环境变量 CX_DATA_ROOT 或仓库根）')
    parser.add_argument('--output', default=str(_config.OUTPUT_BASE_DIR),
                        help='输出根目录（默认 = 数据管理/validation/loss-ratio-weekly）')
    parser.add_argument('--verbose', action='store_true', help='输出 WARN 详情')
    args = parser.parse_args(argv)

    # 必填校验：xlsx 路径
    if not args.xlsx:
        print('ERROR: 必须提供 xlsx 路径（--xlsx <path> 或环境变量 CX_RECONCILE_XLSX）',
              file=sys.stderr)
        return 2
    if not Path(args.xlsx).exists():
        print(f'ERROR: xlsx 文件不存在: {args.xlsx}', file=sys.stderr)
        return 2

    # 把 CLI 参数注入 config（让下游模块用统一来源）
    _config.XLSX_PATH = args.xlsx
    _config.DATA_REPO_ROOT = Path(args.data_root)
    _config.POLICY_PARQUET_GLOB = str(_config.DATA_REPO_ROOT / '数据管理/warehouse/fact/policy/current/*.parquet')
    _config.CLAIMS_PARQUET_GLOB = str(_config.DATA_REPO_ROOT / '数据管理/warehouse/fact/claims_detail/*.parquet')
    _config.OUTPUT_BASE_DIR = Path(args.output)

    week = args.week or _last_saturday()
    print(f'>>> 开始对账 周次={week} 保单年度={args.policy_year} YTD口径')
    print(f'    起期 ∈ [{args.policy_year}-01-01, {week}]')
    print(f'    报案 ∈ [{args.policy_year}-01-01, {week}]')
    print(f'    xlsx: {args.xlsx}')
    print(f'    data-root: {args.data_root}')

    print('[1/3] 解析 xlsx (1.1.1 → 客户类别 7 类) ...')
    external = parse_xlsx(args.xlsx, policy_year=args.policy_year)
    print(f'      → {len(external)} 条 records')

    print('[2/3] 项目侧 DuckDB 直查（客户类别 7 类 + 合计） ...')
    project = query_project(week, args.policy_year)
    print(f'      → {len(project)} 条 records')

    print('[3/3] 对账判定 + 输出 ...')
    summary = reconcile(external, project, week=week, policy_year=args.policy_year, verbose=args.verbose)

    return 1 if summary['overall'].get('FAIL', 0) > 0 else 0


if __name__ == '__main__':
    sys.exit(main())
