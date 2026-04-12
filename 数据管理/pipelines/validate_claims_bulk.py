#!/usr/bin/env python3
"""
交叉验证：全量赔付数据 × 赔付率周报 × PolicyFact

用赔付率周报（聚合基准）验证全量赔付数据（保单级）的准确性。
验证指标：总赔款、满期保费、满期赔付率、满期出险频度。
精度要求：差异不超过万分之一 (0.01%)。

用法：
  python3 validate_claims_bulk.py \
    --claims  warehouse/fact/claims_bulk/latest.parquet \
    --report  "赔付率周报_（合订版）_0411.xlsx" \
    --policy  "warehouse/fact/policy/current/*.parquet" \
    --valuation-date 2026-04-11
"""

import argparse
import sys
from pathlib import Path
from datetime import date

import pandas as pd
import numpy as np
import duckdb

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.parquet_utils import write_parquet_with_metadata


# ═══════════════════════════════════════════════
# 1. 周报解析
# ═══════════════════════════════════════════════

# Sheet 1.1.1 的列布局（年份 → 起始列索引, 每年 11 列指标）
YEAR_COL_OFFSETS = {2026: 1, 2025: 12, 2024: 23}

# 每年 11 列的指标名（按周报第1行顺序）
METRIC_NAMES = [
    'written_premium_wan',      # 跟单保费(万)
    'avg_premium',              # 单均保费
    'earned_premium_wan',       # 满期保费(万)
    'earned_incident_rate',     # 满期出险频度
    'reported_cases',           # 已报件数
    'avg_claim',                # 案均赔款
    'total_claims_wan',         # 总赔款(万)
    'earned_loss_ratio',        # 满期赔付率
    'expense_ratio',            # 费用率
    'variable_cost_ratio',      # 变动成本率
    'avg_commercial_coeff',     # 商业险平均自主系数
]


def parse_weekly_report(report_path: str) -> dict[int, dict[str, float]]:
    """解析赔付率周报的合计行，返回 {year: {metric: value}}。"""
    df_raw = pd.read_excel(report_path, sheet_name=0, header=None)

    # 合计行 = 最后一个非空行
    total_row_idx = df_raw.dropna(how='all').index[-1]
    total_row = df_raw.iloc[total_row_idx]

    result = {}
    for year, col_start in YEAR_COL_OFFSETS.items():
        metrics = {}
        for i, name in enumerate(METRIC_NAMES):
            val = total_row.iloc[col_start + i]
            metrics[name] = float(val) if pd.notna(val) else None
        result[year] = metrics

    return result


# ═══════════════════════════════════════════════
# 2. DuckDB 系统侧计算
# ═══════════════════════════════════════════════

def compute_system_metrics(
    con: duckdb.DuckDBPyConnection,
    claims_path: str,
    policy_glob: str,
    valuation_date: str,
) -> pd.DataFrame:
    """从 PolicyFact + ClaimsBulk 计算系统侧指标。"""

    sql = f"""
    WITH policy_agg AS (
        SELECT
            policy_no,
            YEAR(ANY_VALUE(insurance_start_date))   AS policy_year,
            ANY_VALUE(insurance_start_date)          AS insurance_start_date,
            SUM(premium)                             AS net_premium,
            DATEDIFF('day',
                ANY_VALUE(insurance_start_date),
                ANY_VALUE(insurance_start_date) + INTERVAL 1 YEAR
            )                                        AS policy_term
        FROM read_parquet('{policy_glob}', union_by_name := true)
        WHERE premium != 0
        GROUP BY policy_no
    ),
    policy_earned AS (
        SELECT
            *,
            LEAST(
                GREATEST(DATEDIFF('day', insurance_start_date, '{valuation_date}'::DATE), 0),
                policy_term
            ) AS earned_days,
            net_premium
                * LEAST(
                    GREATEST(DATEDIFF('day', insurance_start_date, '{valuation_date}'::DATE), 0),
                    policy_term
                  )::DOUBLE
                / NULLIF(policy_term, 0)
              AS earned_premium
        FROM policy_agg
        WHERE policy_year IN (2024, 2025, 2026)
    ),
    joined AS (
        SELECT
            p.policy_year,
            p.policy_no,
            p.net_premium,
            p.earned_premium,
            p.policy_term,
            p.earned_days,
            COALESCE(c.total_claims,     0) AS total_claims,
            COALESCE(c.total_case_count, 0) AS total_case_count
        FROM policy_earned p
        LEFT JOIN read_parquet('{claims_path}') c
          ON p.policy_no = c.policy_no
    )
    SELECT
        policy_year,
        COUNT(DISTINCT policy_no)                                      AS policy_count,
        ROUND(SUM(net_premium) / 1e4, 4)                              AS written_premium_wan,
        ROUND(SUM(earned_premium) / 1e4, 4)                           AS earned_premium_wan,
        SUM(total_case_count)                                          AS reported_cases,
        ROUND(SUM(total_claims) / 1e4, 4)                             AS total_claims_wan,
        SUM(total_claims) / NULLIF(SUM(earned_premium), 0)            AS earned_loss_ratio,
        SUM(
            total_case_count * policy_term::DOUBLE
            / NULLIF(earned_days, 0)
        ) / NULLIF(COUNT(DISTINCT policy_no), 0)                      AS earned_incident_rate
    FROM joined
    WHERE earned_premium > 0
    GROUP BY policy_year
    ORDER BY policy_year
    """

    return con.execute(sql).df()


# ═══════════════════════════════════════════════
# 3. JOIN 覆盖率诊断
# ═══════════════════════════════════════════════

def compute_join_diagnostics(
    con: duckdb.DuckDBPyConnection,
    claims_path: str,
    policy_glob: str,
) -> dict:
    """诊断 ClaimsBulk 与 PolicyFact 的 JOIN 匹配率。"""

    sql = f"""
    WITH cb AS (
        SELECT policy_no, total_claims, total_case_count
        FROM read_parquet('{claims_path}')
        WHERE total_claims > 0 OR total_case_count > 0
    ),
    pf AS (
        SELECT DISTINCT policy_no FROM read_parquet('{policy_glob}', union_by_name := true)
    )
    SELECT
        COUNT(*)                                            AS claims_with_amount,
        COUNT(CASE WHEN pf.policy_no IS NOT NULL THEN 1 END) AS matched,
        COUNT(CASE WHEN pf.policy_no IS NULL     THEN 1 END) AS unmatched,
        ROUND(SUM(CASE WHEN pf.policy_no IS NULL THEN cb.total_claims ELSE 0 END) / 1e4, 2)
                                                            AS unmatched_claims_wan
    FROM cb
    LEFT JOIN pf ON cb.policy_no = pf.policy_no
    """

    row = con.execute(sql).df().iloc[0]
    return {
        'claims_with_amount': int(row['claims_with_amount']),
        'matched': int(row['matched']),
        'unmatched': int(row['unmatched']),
        'match_rate': row['matched'] / row['claims_with_amount'] if row['claims_with_amount'] > 0 else 0,
        'unmatched_claims_wan': float(row['unmatched_claims_wan']),
    }


# ═══════════════════════════════════════════════
# 4. 差异计算 + 报告输出
# ═══════════════════════════════════════════════

COMPARE_METRICS = [
    ('written_premium_wan', '跟单保费(万)', 'pct'),
    ('earned_premium_wan',  '满期保费(万)', 'pct'),
    ('total_claims_wan',    '总赔款(万)',   'pct'),
    ('reported_cases',      '已报件数',     'pct'),
    ('earned_loss_ratio',   '满期赔付率',   'pp'),
    ('earned_incident_rate','满期出险频度', 'pp'),
]


def format_value(val, metric_key: str) -> str:
    """按指标类型格式化输出。"""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return '  N/A   '
    if metric_key in ('earned_loss_ratio', 'earned_incident_rate'):
        return f'{val*100:>8.4f}%'
    if metric_key in ('reported_cases',):
        return f'{int(val):>8,}'
    return f'{val:>10,.2f}'


def compute_delta(sys_val, ref_val, mode: str) -> tuple[float | None, str]:
    """计算差异率/差异点。返回 (delta_number, formatted_string)。"""
    if sys_val is None or ref_val is None:
        return None, 'N/A'
    if isinstance(sys_val, float) and np.isnan(sys_val):
        return None, 'N/A'
    if isinstance(ref_val, float) and np.isnan(ref_val):
        return None, 'N/A'

    if mode == 'pct':
        if ref_val == 0:
            return None, 'div/0'
        delta = (sys_val - ref_val) / abs(ref_val)
        return delta, f'{delta*100:+.4f}%'
    else:  # pp (percentage points)
        delta = sys_val - ref_val
        return delta, f'{delta*100:+.4f}pp'


def print_report(
    sys_df: pd.DataFrame,
    report_data: dict[int, dict],
    diagnostics: dict,
    tolerance: float,
    valuation_date: str,
):
    """打印交叉验证报告。"""

    years = sorted(sys_df['policy_year'].unique())

    print()
    print('═' * 90)
    print(f'  交叉验证报告  (valuation_date={valuation_date}, tolerance={tolerance*100:.2f}%)')
    print('═' * 90)

    # JOIN 覆盖率
    d = diagnostics
    print(f'\n【JOIN 覆盖率】')
    print(f'  有赔付保单: {d["claims_with_amount"]:,}')
    print(f'  匹配 PolicyFact: {d["matched"]:,} ({d["match_rate"]*100:.2f}%)')
    print(f'  未匹配: {d["unmatched"]:,} (未匹配赔款 {d["unmatched_claims_wan"]:.2f} 万)')

    # 对比表
    all_pass = True
    results = []

    print(f'\n{"─"*90}')
    print(f'{"保单年":>6} │ {"指标":<12} │ {"系统计算":>12} │ {"周报基准":>12} │ {"差异率":>10} │ 判定')
    print(f'{"─"*90}')

    for year in years:
        sys_row = sys_df[sys_df['policy_year'] == year].iloc[0]
        ref = report_data.get(year, {})

        for metric_key, label, mode in COMPARE_METRICS:
            sys_val = sys_row.get(metric_key)
            ref_val = ref.get(metric_key)

            sys_str = format_value(sys_val, metric_key)
            ref_str = format_value(ref_val, metric_key)
            delta, delta_str = compute_delta(sys_val, ref_val, mode)

            if delta is not None:
                passed = abs(delta) <= tolerance
            else:
                passed = False

            verdict = '✓ PASS' if passed else '✗ FAIL'
            if not passed:
                all_pass = False

            print(f'{year:>6} │ {label:<12} │ {sys_str} │ {ref_str} │ {delta_str:>10} │ {verdict}')

            results.append({
                'policy_year': year,
                'metric': metric_key,
                'metric_label': label,
                'system_value': float(sys_val) if sys_val is not None and not (isinstance(sys_val, float) and np.isnan(sys_val)) else None,
                'report_value': float(ref_val) if ref_val is not None else None,
                'delta': float(delta) if delta is not None else None,
                'passed': passed,
            })

        print(f'{"─"*90}')

    # 总结
    print()
    if all_pass:
        print(f'  ✅ 全部通过 — 差异均在万分之一以内，数据源可信')
    else:
        failed = [r for r in results if not r['passed']]
        print(f'  ❌ {len(failed)} 项未通过 — 需排查差异原因:')
        for r in failed:
            print(f'     {r["policy_year"]} {r["metric_label"]}: '
                  f'系统={r["system_value"]}, 周报={r["report_value"]}, '
                  f'差异={r["delta"]}')

    print()
    return results, all_pass


# ═══════════════════════════════════════════════
# 5. 主流程
# ═══════════════════════════════════════════════

def parse_args():
    p = argparse.ArgumentParser(description='交叉验证全量赔付数据')
    p.add_argument('--claims', '-c', required=True, help='claims_bulk Parquet 路径')
    p.add_argument('--report', '-r', required=True, help='赔付率周报 Excel 路径')
    p.add_argument('--policy', '-p', default=None,
                   help='PolicyFact glob (默认 warehouse/fact/policy/current/*.parquet)')
    p.add_argument('--valuation-date', '-d', default=None,
                   help='估值日期 YYYY-MM-DD (默认今天)')
    p.add_argument('--tolerance', '-t', type=float, default=0.0001,
                   help='差异率阈值 (默认 0.0001 = 万分之一)')
    p.add_argument('--output', '-o', default=None,
                   help='验证结果 Parquet 输出路径 (可选)')
    return p.parse_args()


def main():
    args = parse_args()

    data_root = Path(__file__).resolve().parent.parent
    claims_path = str(Path(args.claims).resolve())
    report_path = str(Path(args.report).resolve())
    policy_glob = args.policy or str(data_root / 'warehouse/fact/policy/current/*.parquet')

    val_date = args.valuation_date or date.today().isoformat()

    print(f'赔付数据: {claims_path}')
    print(f'赔付率周报: {report_path}')
    print(f'PolicyFact: {policy_glob}')
    print(f'估值日期: {val_date}')
    print(f'容忍度: {args.tolerance*100:.2f}% (万分之{int(args.tolerance*10000)})')

    # Step 1: 解析周报
    print('\n[1/3] 解析赔付率周报...')
    report_data = parse_weekly_report(report_path)
    for year in sorted(report_data.keys()):
        m = report_data[year]
        print(f'  {year}: 跟单保费={m["written_premium_wan"]:.2f}万, '
              f'满期保费={m["earned_premium_wan"]:.2f}万, '
              f'总赔款={m["total_claims_wan"]:.2f}万, '
              f'满期赔付率={m["earned_loss_ratio"]*100:.2f}%, '
              f'出险频度={m["earned_incident_rate"]*100:.4f}%')

    # Step 2: 系统侧计算
    print('\n[2/3] DuckDB 计算系统侧指标...')
    con = duckdb.connect()
    sys_df = compute_system_metrics(con, claims_path, policy_glob, val_date)

    # Step 3: JOIN 诊断
    print('\n[3/3] JOIN 覆盖率诊断...')
    diagnostics = compute_join_diagnostics(con, claims_path, policy_glob)

    con.close()

    # 报告
    results, all_pass = print_report(
        sys_df, report_data, diagnostics, args.tolerance, val_date)

    # 可选: 保存验证结果
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = data_root / f'warehouse/fact/validation/claims_bulk_validation_{val_date}.parquet'

    result_df = pd.DataFrame(results)
    result_df['valuation_date'] = val_date
    result_df['tolerance'] = args.tolerance
    write_parquet_with_metadata(
        result_df, out_path,
        source_file=Path(report_path).name,
        processing_mode='validate_claims_bulk',
    )
    print(f'验证结果已保存: {out_path}')

    sys.exit(0 if all_pass else 1)


if __name__ == '__main__':
    main()
