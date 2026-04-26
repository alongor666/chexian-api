"""按起期月份导出 12 个 xlsx，列结构与企业微信智能表 H1/H2 一致。

用途
----
当单表行数过大、企业微信智能表渲染卡顿时，先在本地拆 12 张 xlsx，
由用户在企业微信「批量导入」面板逐月新建表 → 后续每日同步若需要时再
用 sync_renewal_v2.py 走 webhook 路径增量更新（也可改导 xlsx 全量替换）。

跨期排他规则与 sync_renewal_v2 保持一致：earliest_start_first，
exclusive_lower_bound = '2025-01-01'，确保 12 月之间 VIN 互斥。

输出
----
exports/sichuan_2025_m{01..12}.xlsx，每个文件 18 列：
姓名（空白人工填）/ 到期日 / 三级机构 / 销售团队 / 车牌号码 / 车架号 /
业务员 / 客户类别 / 险别组合 / 报价 / 上年折扣 / 上年保费 / 报价折扣 /
报价保费 / 是否续回 / 续保模式 / 续回日期 / 报价日期

CLI
---
python3 数据管理/integrations/wecom_smartsheet/export_monthly_xlsx.py \
  --year 2025 --province 四川 --premium-gt 200
"""
from __future__ import annotations

import argparse
import calendar
import json
import sys
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sync_renewal_v2 import InstanceConfig, build_source_rows  # noqa: E402

EXPORT_DIR = HERE / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

COLUMN_ORDER: list[tuple[str, str | None]] = [
    ("姓名", None),
    ("到期日", "insurance_end_date"),
    ("三级机构", "organization"),
    ("销售团队", "team"),
    ("车牌号码", "plate_no"),
    ("车架号", "vehicle_frame_no"),
    ("业务员", "salesman_name"),
    ("客户类别", "customer_category"),
    ("险别组合", "coverage_combination"),
    ("报价", "is_quoted"),
    ("上年折扣", "commercial_pricing_factor"),
    ("上年保费", "premium"),
    ("报价折扣", "quote_pricing_factor"),
    ("报价保费", "quote_premium"),
    ("是否续回", "is_renewed"),
    ("续保模式", "renewal_mode"),
    ("续回日期", "renewed_sign_date"),
    ("报价日期", "earliest_quote_date"),
]


def build_month_instance(
    year: int, month: int, premium_gt: float, exclusive_lower_bound: str | None
) -> InstanceConfig:
    last_day = calendar.monthrange(year, month)[1]
    return InstanceConfig(
        instance_name=f"sichuan_{year}_m{month:02d}",
        webhook_env="",
        batch_size=100,
        sheet_rpm=3000,
        doc_rpm=10000,
        rate_limit_sleep=60,
        filters={
            "insurance_type": "商业保险",
            "insurance_start_date_from": f"{year}-{month:02d}-01",
            "insurance_start_date_to": f"{year}-{month:02d}-{last_day:02d}",
            "premium_gt": premium_gt,
            "exclude_endorsement": True,
            "organization_in": None,
        },
        quote_window_start="2025-12-03",
        exclusive_vin_strategy="earliest_start_first",
        exclusive_lower_bound=exclusive_lower_bound,
        fields_enabled=[],
    )


def to_date_str(v: Any) -> str:
    if v is None or pd.isna(v):
        return ""
    if hasattr(v, "to_pydatetime"):
        v = v.to_pydatetime()
    if isinstance(v, datetime):
        v = v.date()
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    return str(v)


def to_yes_no(v: Any) -> str:
    if v is None or pd.isna(v):
        return "否"
    return "是" if bool(v) else "否"


def to_number(v: Any) -> Any:
    if v is None or pd.isna(v):
        return None
    return float(v)


def to_text(v: Any) -> str:
    if v is None or pd.isna(v):
        return ""
    return str(v)


RENDER_BY_COLUMN: dict[str, Any] = {
    "到期日": to_date_str,
    "续回日期": to_date_str,
    "报价日期": to_date_str,
    "报价": to_yes_no,
    "是否续回": to_yes_no,
    "上年折扣": to_number,
    "上年保费": to_number,
    "报价折扣": to_number,
    "报价保费": to_number,
}


def render_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for label, src_key in COLUMN_ORDER:
        if src_key is None:
            out[label] = ""
            continue
        v = row.get(src_key)
        renderer = RENDER_BY_COLUMN.get(label, to_text)
        out[label] = renderer(v)
    return out


def export_one_month(
    year: int, month: int, premium_gt: float, exclusive_lower_bound: str | None
) -> dict[str, Any]:
    inst = build_month_instance(year, month, premium_gt, exclusive_lower_bound)
    rows, audit = build_source_rows(inst)
    rendered = [render_row(r) for r in rows]
    df = pd.DataFrame(rendered, columns=[label for label, _ in COLUMN_ORDER])
    out_path = EXPORT_DIR / f"sichuan_{year}_m{month:02d}.xlsx"
    df.to_excel(out_path, index=False, engine="openpyxl")

    salesman_unmatched = sum(1 for r in rows if r.get("salesman_unmatched"))
    summary = {
        "month": month,
        "rows": len(rows),
        "duplicate_commercial_vin_count": audit["duplicate_commercial_vin_count"],
        "cross_batch_excluded_count": audit["cross_batch_excluded_count"],
        "salesman_unmatched": salesman_unmatched,
        "out": str(out_path),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--premium-gt", type=float, default=200)
    ap.add_argument(
        "--exclusive-lower-bound",
        default=None,
        help="跨月排他下界，默认本年 1 月 1 日，传 'none' 表示不启用历史排他",
    )
    ap.add_argument("--months", type=str, default="1-12", help="区间如 1-12 或单月 7")
    args = ap.parse_args()

    if "-" in args.months:
        a, b = args.months.split("-")
        month_list = list(range(int(a), int(b) + 1))
    else:
        month_list = [int(args.months)]

    if args.exclusive_lower_bound is None:
        lower = f"{args.year}-01-01"
    elif args.exclusive_lower_bound.lower() == "none":
        lower = None
    else:
        lower = args.exclusive_lower_bound

    summaries = []
    for m in month_list:
        summaries.append(
            export_one_month(args.year, m, args.premium_gt, lower)
        )

    total = sum(s["rows"] for s in summaries)
    unmatched = sum(s["salesman_unmatched"] for s in summaries)
    excluded = sum(s["cross_batch_excluded_count"] for s in summaries)
    duplicates = sum(s["duplicate_commercial_vin_count"] for s in summaries)
    print(
        json.dumps(
            {
                "total_rows": total,
                "salesman_unmatched_total": unmatched,
                "cross_batch_excluded_total": excluded,
                "duplicate_commercial_vin_total": duplicates,
                "files": [s["out"] for s in summaries],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
