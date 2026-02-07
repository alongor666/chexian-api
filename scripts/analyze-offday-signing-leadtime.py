#!/usr/bin/env python3
"""
统计：指定签单日期区间内，落在周末/中国法定节假日（休息日）的保单，
按 三级机构 × 客户类别 × 险别组合 分组，计算"提前投保天数"的占比。

说明：
- 数据源：Parquet（本脚本直接读取用户给定路径）
- 休息日口径：周六/周日 + 2026 年法定节假日（从前端 holidayData.ts 抽取）
- 提前天数 = 保险起期(日期) - 签单日期(日期) + 1

输出：
- CSV：与 Parquet 同目录下生成 offday-signing-leadtime-<start>_<end>.csv
- Markdown：与 Parquet 同目录下生成 offday-signing-leadtime-<start>_<end>.md
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, List, Sequence, Tuple, cast

import duckdb


@dataclass(frozen=True)
class AnalysisParams:
    """分析参数集合（便于复用与审计复现）"""

    parquet_path: Path
    start_date: str
    end_date: str
    holiday_data_ts_path: Path


def extract_yyyy_mm_dd_from_ts_array(ts_file: Path, array_name: str) -> List[str]:
    """从 TypeScript 文件中抽取指定数组中的 YYYY-MM-DD 字符串列表"""

    content = ts_file.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"{re.escape(array_name)}\s*:\s*Holiday\[\]\s*=\s*\[(?P<body>[\s\S]*?)\]\s*;",
        re.MULTILINE,
    )
    m = pattern.search(content)
    if not m:
        return []

    body = m.group("body")
    return re.findall(r"'(\d{4}-\d{2}-\d{2})'", body)


def build_holiday_dates_in_range(params: AnalysisParams) -> List[str]:
    """构建分析区间内的法定节假日日期列表（YYYY-MM-DD）"""

    legal_holidays_2026 = extract_yyyy_mm_dd_from_ts_array(
        params.holiday_data_ts_path, "LEGAL_HOLIDAYS_2026"
    )
    return [d for d in legal_holidays_2026 if params.start_date <= d <= params.end_date]


def ensure_input_exists(params: AnalysisParams) -> None:
    """校验输入文件存在性，缺失时抛出可读错误"""

    if not params.parquet_path.exists():
        raise FileNotFoundError(f"Parquet 文件不存在: {params.parquet_path}")
    if not params.holiday_data_ts_path.exists():
        raise FileNotFoundError(f"holidayData.ts 不存在: {params.holiday_data_ts_path}")


def generate_holiday_values_sql(dates: Sequence[str]) -> str:
    """生成 DuckDB 可用的 VALUES 子句（用于构造 holiday_dates 临时表）"""

    if not dates:
        return "('1900-01-01')"
    return ", ".join(f"('{d}')" for d in dates)


def run_query_to_files(params: AnalysisParams) -> Tuple[Path, Path]:
    """执行统计 SQL 并写出 CSV/Markdown 文件，返回输出路径"""

    ensure_input_exists(params)
    holiday_dates = build_holiday_dates_in_range(params)
    holiday_values = generate_holiday_values_sql(holiday_dates)

    out_dir = params.parquet_path.parent
    out_base = f"offday-signing-leadtime-{params.start_date}_{params.end_date}"
    out_csv = out_dir / f"{out_base}.csv"
    out_md = out_dir / f"{out_base}.md"

    con = duckdb.connect(database=":memory:")
    try:
        sql = f"""
WITH
holiday_dates AS (
  SELECT CAST(date_str AS DATE) AS holiday_date
  FROM (VALUES {holiday_values}) AS h(date_str)
),
base AS (
  SELECT
    三级机构 AS org_level_3,
    客户类别 AS customer_category,
    险别组合 AS coverage_combination,
    CAST(签单日期 AS DATE) AS sign_date,
    CAST(保险起期 AS DATE) AS start_date,
    date_diff('day', CAST(签单日期 AS DATE), CAST(保险起期 AS DATE)) + 1 AS lead_days
  FROM read_parquet('{params.parquet_path.as_posix()}')
  WHERE CAST(签单日期 AS DATE) >= '{params.start_date}'
    AND CAST(签单日期 AS DATE) <= '{params.end_date}'
),
offday_policies AS (
  SELECT
    org_level_3,
    customer_category,
    coverage_combination,
    lead_days
  FROM base
  WHERE EXTRACT(dow FROM sign_date) IN (0, 6)
     OR sign_date IN (SELECT holiday_date FROM holiday_dates)
),
agg AS (
  SELECT
    org_level_3,
    customer_category,
    coverage_combination,
    COUNT(*) AS total_policies,

    -- 提前天数统计（累计口径）
    SUM(CASE WHEN lead_days <= 1 THEN 1 ELSE 0 END) AS cnt_le_1,
    SUM(CASE WHEN lead_days <= 3 THEN 1 ELSE 0 END) AS cnt_le_3,
    SUM(CASE WHEN lead_days <= 7 THEN 1 ELSE 0 END) AS cnt_le_7,
    SUM(CASE WHEN lead_days > 7 THEN 1 ELSE 0 END) AS cnt_gt_7
  FROM offday_policies
  GROUP BY org_level_3, customer_category, coverage_combination
)
SELECT
  org_level_3 AS "三级机构",
  customer_category AS "客户类别",
  coverage_combination AS "险别组合",
  total_policies AS "休息日签单保单数",

  -- 提前天数占比（累计口径）
  cnt_le_1 AS "≤1天_件数",
  ROUND(cnt_le_1 * 1.0 / NULLIF(total_policies, 0), 6) AS "≤1天_占比",
  cnt_le_3 AS "≤3天_件数",
  ROUND(cnt_le_3 * 1.0 / NULLIF(total_policies, 0), 6) AS "≤3天_占比",
  cnt_le_7 AS "≤7天_件数",
  ROUND(cnt_le_7 * 1.0 / NULLIF(total_policies, 0), 6) AS "≤7天_占比",
  cnt_gt_7 AS ">7天_件数",
  ROUND(cnt_gt_7 * 1.0 / NULLIF(total_policies, 0), 6) AS ">7天_占比"
FROM agg
ORDER BY "休息日签单保单数" DESC, "三级机构", "客户类别", "险别组合"
"""

        df = con.execute(sql).df()
        df.to_csv(out_csv, index=False, encoding="utf-8-sig")

        total_offday_raw = con.execute(
            f"""
WITH holiday_dates AS (
  SELECT CAST(date_str AS DATE) AS holiday_date
  FROM (VALUES {holiday_values}) AS h(date_str)
),
base AS (
  SELECT
    CAST(签单日期 AS DATE) AS sign_date
  FROM read_parquet('{params.parquet_path.as_posix()}')
  WHERE CAST(签单日期 AS DATE) >= '{params.start_date}'
    AND CAST(签单日期 AS DATE) <= '{params.end_date}'
)
SELECT
  COUNT(*) AS total_in_range,
  SUM(CASE WHEN EXTRACT(dow FROM sign_date) IN (0, 6)
            OR sign_date IN (SELECT holiday_date FROM holiday_dates)
           THEN 1 ELSE 0 END) AS offday_in_range
FROM base
"""
        ).fetchone()

        total_offday = (
            cast(Tuple[Any, Any], total_offday_raw) if total_offday_raw is not None else (0, 0)
        )
        total_in_range = int(total_offday[0] or 0)
        offday_in_range = int(total_offday[1] or 0)

        md_lines = [
            f"# 休息日签单提前投保占比统计",
            "",
            f"- 数据源：`{params.parquet_path}`",
            f"- 签单日期区间：{params.start_date} ~ {params.end_date}（含）",
            f"- 休息日口径：周六/周日 + 法定节假日（从 `{params.holiday_data_ts_path}` 抽取 2026 年口径）",
            f"- 区间内保单总数：{total_in_range}",
            f"- 区间内休息日签单保单数：{offday_in_range}",
            "",
            "## 输出文件",
            "",
            f"- CSV：`{out_csv}`",
            "",
            "## 口径说明",
            "",
            "- 提前天数 = 保险起期(日期) - 签单日期(日期) + 1",
            "- 占比为累计口径：例如<=3天占比表示（提前天数 <= 3）的累计占比",
            "",
            "## Top 30（按休息日签单保单数排序）",
            "",
        ]

        top30 = df.head(30)
        md_lines.extend(dataframe_to_markdown_table_lines(top30))
        md_lines.append("")

        out_md.write_text("\n".join(md_lines), encoding="utf-8")
        return out_csv, out_md
    finally:
        con.close()


def dataframe_to_markdown_table_lines(df) -> List[str]:
    """将 DataFrame 转成 Markdown 表格行（不依赖 tabulate）"""

    columns = [str(c) for c in df.columns.tolist()]
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join(["---"] * len(columns)) + " |"

    lines: List[str] = [header, separator]
    for _, row in df.iterrows():
        cells = [str(row[c]) for c in columns]
        lines.append("| " + " | ".join(cells) + " |")
    return lines


def main() -> None:
    """脚本入口：使用默认参数执行一次统计"""

    params = AnalysisParams(
        parquet_path=Path(
            "/Users/xuechenglong/Downloads/01-正开发Git项目/chexianYJFX/数据管理/保单明细/车险保单综合明细表.parquet"
        ),
        start_date="2025-12-01",
        end_date="2026-01-14",
        holiday_data_ts_path=Path(
            "/Users/xuechenglong/Downloads/01-正开发Git项目/chexianYJFX/src/features/marketing-report/utils/holidayData.ts"
        ),
    )

    out_csv, out_md = run_query_to_files(params)
    print(f"✅ 统计完成\n- CSV: {out_csv}\n- Markdown: {out_md}")


if __name__ == "__main__":
    main()
