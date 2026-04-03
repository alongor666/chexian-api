#!/usr/bin/env python3
"""
报价转化数据 ETL：Excel → 拆分业务员 → JOIN 团队 → Parquet

用法:
  python3 数据管理/pipelines/quote_etl.py --input "path/to/报价.xlsx"
  python3 数据管理/pipelines/quote_etl.py  # 自动检测 Downloads 目录
"""

import argparse
import re
import sys
from pathlib import Path

import duckdb
import pandas as pd


def find_input_file() -> Path:
    """自动检测报价 Excel 文件"""
    candidates = [
        Path.home() / "Downloads" / "旧车商业险报价20251201-20260330.xlsx",
        Path("数据管理") / "旧车商业险报价20251201-20260330.xlsx",
    ]
    # 也搜索 Downloads 下任意 旧车商业险报价*.xlsx
    dl = Path.home() / "Downloads"
    if dl.exists():
        for f in sorted(dl.glob("旧车商业险报价*.xlsx"), reverse=True):
            candidates.insert(0, f)

    for c in candidates:
        if c.exists():
            return c
    return None


def split_salesman(name: str):
    """拆分 '110031100周凡丁' → ('110031100', '周凡丁')"""
    if not isinstance(name, str):
        return ("", "")
    m = re.match(r"^(\d+)(.*)", name)
    if m:
        return (m.group(1), m.group(2))
    return ("", name)


def main():
    parser = argparse.ArgumentParser(description="报价转化数据 ETL")
    parser.add_argument("--input", "-i", help="输入 Excel 文件路径")
    parser.add_argument(
        "--output",
        "-o",
        default="数据管理/warehouse/fact/quotes_conversion",
        help="输出 Parquet 目录",
    )
    args = parser.parse_args()

    # 1. 定位输入文件
    if args.input:
        input_path = Path(args.input)
    else:
        input_path = find_input_file()

    if not input_path or not input_path.exists():
        print(f"❌ 找不到报价 Excel 文件: {args.input or '自动检测失败'}")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"📂 输入: {input_path}")
    print(f"📂 输出: {output_dir}")

    # 2. 读取 Excel
    print("📊 读取 Excel...")
    df = pd.read_excel(input_path)
    print(f"   {len(df):,d} 行, {len(df.columns)} 列")

    # 3. 拆分业务员字段
    print("🔧 拆分业务员字段...")
    splits = df["业务员"].apply(split_salesman)
    df["salesman_no"] = splits.apply(lambda x: x[0])
    df["salesman_name_display"] = splits.apply(lambda x: x[1])

    # 4. JOIN salesman dim 获取团队
    print("🔗 JOIN salesman dim 表...")
    dim_paths = [
        Path("数据管理/warehouse/dim/salesman/latest.parquet"),
        Path("server/data/dim/salesman/latest.parquet"),
    ]
    dim_path = next((p for p in dim_paths if p.exists()), None)

    con = duckdb.connect()
    con.register("quotes", df)

    if dim_path:
        print(f"   dim 表: {dim_path}")
        result = con.execute(
            f"""
            SELECT q.*,
                   COALESCE(s.team, '未分配团队') AS team
            FROM quotes q
            LEFT JOIN read_parquet('{dim_path}') s
              ON q.salesman_no = s.business_no
            """
        ).df()
        matched = (result["team"] != "未分配团队").sum()
        print(f"   匹配: {matched:,d}/{len(result):,d} ({matched/len(result)*100:.0f}%)")
    else:
        print("   ⚠️ salesman dim 表不存在，团队字段全部为'未分配团队'")
        df["team"] = "未分配团队"
        result = df

    # ── 列名英文化：中文 → 英文 snake_case ──
    import json
    etl_fields_path = Path(__file__).resolve().parent / 'etl_fields.json'
    try:
        with open(etl_fields_path) as f:
            cn_to_en = json.load(f).get('cn_to_en_mapping', {})
    except (FileNotFoundError, json.JSONDecodeError):
        cn_to_en = {}
    # 报价域专有映射
    quote_cn_to_en = {
        '报价时间': 'quote_time',
        '续保情况': 'renewal_status',
        '是否承保': 'is_underwritten',
        '折前保费': 'pre_discount_premium',
        '折后保费': 'post_discount_premium',
        'NCD基数': 'ncd_base',
        'NCD系数': 'ncd_coefficient',
        '交通风险评分等级': 'traffic_risk_grade',
    }
    full_mapping = {**cn_to_en, **quote_cn_to_en}
    rename_en = {k: v for k, v in full_mapping.items() if k in result.columns}
    if rename_en:
        result = result.rename(columns=rename_en)
        print(f"   列名英文化: {len(rename_en)}/{len(result.columns)} 列已重命名")

    # 5. 输出 Parquet（统一 L1 metadata）
    output_file = output_dir / "latest.parquet"
    print(f"💾 写入 Parquet: {output_file}")
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        result, output_file,
        source_file=str(input_path.name),
        processing_mode="quotes_conversion",
    )

    # 6. 验证
    verify = con.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN is_underwritten='承保' THEN 1 END) AS insured,
            COUNT(DISTINCT org_level_3) AS orgs,
            COUNT(DISTINCT team) AS teams,
            COUNT(DISTINCT salesman_no) AS salesmen
        FROM read_parquet('{output_file}')
        """
    ).fetchone()
    print(f"\n✅ 完成!")
    print(f"   总量: {verify[0]:,d} | 承保: {verify[1]:,d} | 转化率: {verify[1]/verify[0]*100:.1f}%")
    print(f"   机构: {verify[2]} | 团队: {verify[3]} | 业务员: {verify[4]}")
    print(f"   列数: {len(result.columns)} → {list(result.columns[-3:])}")

    # 7. 更新 data-sources.json
    try:
        from pipelines.data_sources_updater import update_data_sources
        update_data_sources('quotes_conversion', row_count=verify[0], field_count=len(result.columns))
    except Exception as e:
        print(f"  ⚠️ data-sources.json 更新跳过: {e}")


if __name__ == "__main__":
    main()
