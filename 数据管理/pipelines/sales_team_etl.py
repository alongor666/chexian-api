#!/usr/bin/env python3
"""
销售队伍业绩域 ETL：标保核对表/BI 导出 Excel → Parquet 仓库 + 规则层验证

数据流：
  输入 xlsx（sheet"标保"A:K = BI 系统原始保单明细；sheet"车险折标因子"A:C = 规则表）
  → warehouse/fact/sales_team_performance/biaobao_policy.parquet
  → warehouse/dim/standard_coeff_factor/standard_coeff_factor.parquet
  → 用 sales_team_rules.sql 复算标保并跑回归断言（口径见 sales_portrait ADR-006）

用法:
  python3 数据管理/pipelines/sales_team_etl.py -i "标保核对表（新版）.xlsx"
  python3 数据管理/pipelines/sales_team_etl.py -i <xlsx> --verify-workbook
      （迁移验证模式：额外读取 sheet"标保宽表"R 列做 194k 行逐行对账）
"""

import argparse
import sys
from pathlib import Path

import duckdb
from data_sources_updater import update_data_sources

DATA_ROOT = Path(__file__).resolve().parent.parent
FACT_DIR = DATA_ROOT / 'warehouse' / 'fact' / 'sales_team_performance'
DIM_DIR = DATA_ROOT / 'warehouse' / 'dim' / 'standard_coeff_factor'
FACT_PARQUET = FACT_DIR / 'biaobao_policy.parquet'
ENRICHED_PARQUET = FACT_DIR / 'biaobao_enriched.parquet'  # 规则层算好的明细，服务端直读
DIM_PARQUET = DIM_DIR / 'standard_coeff_factor.parquet'
RULES_SQL = Path(__file__).with_name('sales_team_rules.sql')

# 回归基准（sales_portrait 验证基准 v2；数据刷新后合法变化时随 ADR 更新）
BASELINE_TOTAL = 150_327_494.46
BASELINE_GUO = 646_751.237500002  # 118050119郭保东 按业务员汇总
BASELINE_FACT_ROWS = 194_191
BASELINE_UNMATCHED_AUTO_ROWS = 15


def read_sheet(con, xlsx: str, sheet: str, cols: str, approx_rows: int):
    """读取指定 sheet 的列区间。approx_rows 只是上界，实际行数以内容为准。"""
    return con.execute(
        f"""SELECT row_number() OVER () AS src_row, *
            FROM read_xlsx('{xlsx}', sheet='{sheet}',
                           range='{cols[0]}1:{cols[-1]}{approx_rows}', header=true)"""
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-i', '--input', required=True, help='输入 xlsx 路径')
    ap.add_argument('--verify-workbook', action='store_true',
                    help='迁移验证：与工作簿宽表R列逐行对账')
    ap.add_argument('--max-rows', type=int, default=1_000_000)
    args = ap.parse_args()

    xlsx = str(Path(args.input).resolve())
    con = duckdb.connect()
    con.execute('INSTALL excel; LOAD excel;')

    # 1) 抽取
    # read_xlsx 会把 range 补齐为空行，按保单号非空截断
    con.execute(f"""CREATE TABLE fact AS
        SELECT row_number() OVER () AS src_row, *
        FROM read_xlsx('{xlsx}', sheet='标保', range='A1:K{args.max_rows}', header=true)
        WHERE 保单号 IS NOT NULL""")
    con.execute(f"""CREATE TABLE dim AS
        SELECT row_number() OVER () AS src_row, *
        FROM read_xlsx('{xlsx}', sheet='车险折标因子', range='A1:C{args.max_rows}', header=true)
        WHERE 保单号 IS NOT NULL""")
    n_fact = con.execute('SELECT count(*) FROM fact').fetchone()[0]
    n_dim = con.execute('SELECT count(*) FROM dim').fetchone()[0]
    print(f'[抽取] 标保 {n_fact:,} 行 | 车险折标因子 {n_dim:,} 行')
    assert n_fact > 0 and n_dim > 0, '抽取为空，检查 sheet 名/范围'
    assert n_fact == BASELINE_FACT_ROWS, (
        f'标保底表行数 {n_fact:,} ≠ 回归基准 {BASELINE_FACT_ROWS:,}；'
        '若为合法数据刷新，先写 ADR 再更新基准'
    )

    # 2) 规则层复算
    rules = RULES_SQL.read_text(encoding='utf-8')
    rules = rules.replace("'{fact}'", 'fact').replace("'{dim}'", 'dim')
    con.execute(f'CREATE TABLE enriched AS {rules}')

    # 3) 回归断言（不变式：任何一批数据都必须成立）
    nulls = con.execute('SELECT count(*) FROM enriched WHERE 标保 IS NULL').fetchone()[0]
    unknown_categories = con.execute("""SELECT string_agg(DISTINCT 折标分类, ', ' ORDER BY 折标分类)
        FROM enriched
        WHERE 险种大类='车险' AND 折标分类 IS NOT NULL AND 险种系数 IS NULL""").fetchone()[0]
    assert unknown_categories is None, (
        f'出现未登记的非空车险折标分类：{unknown_categories}；'
        '禁止静默按系数 1 计算，请先更新 sales_team_rules.sql 与口径依据'
    )
    assert nulls == 0, f'标保出现 {nulls} 个 NULL——规则层有未覆盖分支'
    unmatched = con.execute("""SELECT count(*) FROM enriched
        WHERE 险种大类='车险' AND 折标分类 IS NULL""").fetchone()[0]
    print(f'[断言] 标保 0 NULL ✅ | 未匹配折标的车险 {unmatched} 行（按1兜底）')
    assert unmatched == BASELINE_UNMATCHED_AUTO_ROWS, (
        f'未匹配折标车险 {unmatched} 行 ≠ 回归基准 {BASELINE_UNMATCHED_AUTO_ROWS} 行；'
        '请核查维表覆盖或先写 ADR 更新基准'
    )

    # 4) 基准对账（全量历史批次适用；增量批次刷新基准后调整此段）
    total = con.execute('SELECT round(sum(标保),2) FROM enriched').fetchone()[0]
    guo = con.execute(
        "SELECT sum(标保) FROM enriched WHERE 业务员='118050119郭保东'").fetchone()[0]
    print(f'[基准] 标保总额 {total:,}（基准 {BASELINE_TOTAL:,}）')
    print(f'[基准] 郭保东 {guo}（基准 {BASELINE_GUO}）')
    if abs(total - BASELINE_TOTAL) > 0.01 or abs(guo - BASELINE_GUO) > 0.01:
        print('⚠️ 基准不符：若为数据刷新导致的合法变化，先写 ADR 再更新本脚本基准', file=sys.stderr)
        sys.exit(1)

    # 5) 迁移验证模式：与 Excel 宽表 R 列逐行对账
    if args.verify_workbook:
        con.execute(f"""CREATE TABLE verify_r AS
            SELECT row_number() OVER () AS src_row, *
            FROM read_xlsx('{xlsx}', sheet='标保宽表', range='R1:R{args.max_rows}', header=true)
            WHERE "标保(修复后)" IS NOT NULL""")
        n_verify = con.execute('SELECT count(*) FROM verify_r').fetchone()[0]
        assert n_verify == n_fact, (
            f'工作簿对账行数 {n_verify:,} ≠ 标保事实行数 {n_fact:,}，存在缺失/多余行'
        )
        missing, bad = con.execute("""SELECT
              count(*) FILTER (WHERE e.src_row IS NULL OR v.src_row IS NULL) AS missing,
              count(*) FILTER (
                WHERE e.src_row IS NOT NULL AND v.src_row IS NOT NULL
                  AND abs(e.标保 - v."标保(修复后)") > 0.005
              ) AS bad
            FROM enriched e FULL OUTER JOIN verify_r v USING (src_row)""").fetchone()
        print(f'[对账] 与宽表R全覆盖比对：缺失/多余 {missing} 行 | 数值不符 {bad} 行')
        assert missing == 0, '工作簿宽表与规则层存在缺失/多余行'
        assert bad == 0, '与工作簿宽表口径不一致'

    # 6) 落仓（断言全过才写入）
    FACT_DIR.mkdir(parents=True, exist_ok=True)
    DIM_DIR.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY fact TO '{FACT_PARQUET}' (FORMAT parquet)")
    con.execute(f"COPY dim TO '{DIM_PARQUET}' (FORMAT parquet)")
    con.execute(f"COPY enriched TO '{ENRICHED_PARQUET}' (FORMAT parquet)")
    field_count = con.execute("SELECT count(*) FROM pragma_table_info('enriched')").fetchone()[0]
    min_date, max_date = con.execute(
        'SELECT min(CAST(承保确认时间 AS DATE)), max(CAST(承保确认时间 AS DATE)) FROM enriched'
    ).fetchone()
    data_range = f'{min_date} ~ {max_date}' if min_date is not None and max_date is not None else None
    assert update_data_sources(
        'sales_team_performance',
        row_count=n_fact,
        field_count=field_count,
        data_range=data_range,
    ), 'sales_team_performance 运行时状态写入失败'
    print(f'[落仓] {FACT_PARQUET}')
    print(f'[落仓] {DIM_PARQUET}')
    print(f'[落仓] {ENRICHED_PARQUET}')
    print('✅ ETL 完成')


if __name__ == '__main__':
    main()
