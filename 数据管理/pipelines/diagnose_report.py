#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断报告写入器 — 从 diagnose_vehicle.py 剥离的 Report 类

复用 diagnose_common 的公共函数，消除重复逻辑。
"""

from diagnose_common import (
    fw, fp, fi, fc, light,
    TH_VC, TH_MR, TH_LR, TH_IR, TH_AC_CARGO,
    kpi_rows as common_kpi_rows,
    sum_kpi_dicts,
    METRIC_KEYS, get_metric_value,
    trend_text,
)


class Report:
    """Markdown 报告生成器"""

    def __init__(self):
        self.lines = []

    def add(self, t=""):
        self.lines.append(t)

    # ------------------------------------------------------------------
    # KPI 行生成 — 委托 common
    # ------------------------------------------------------------------

    def kpi_rows(self, d: dict) -> list:
        """从标准 KPI dict 生成指标行列表，返回 [(label, value_str)]"""
        return common_kpi_rows(d)

    # ------------------------------------------------------------------
    # 按年份展开的 KPI 表（板块 1/2.x/4.x/6.x）
    # ------------------------------------------------------------------

    def write_year_table(self, data_by_year: dict, years: list, show_growth: bool = True):
        """data_by_year = {2021: kpi_dict, 2022: ...}"""
        sample = next(iter(data_by_year.values()), {})
        label_vals = self.kpi_rows(sample)
        labels = [lv[0] for lv in label_vals]

        cols_data = {}
        for yr in years:
            d = data_by_year.get(yr, {})
            cols_data[str(yr)] = self.kpi_rows(d)

        trends = self._compute_trends(data_by_year, years)

        growth_keys = [
            "earned_margin", "projected_margin", "_vc", "_mr",
            None,
            "loss_ratio", "reported_claims", "claim_cases", "avg_claim",
            None,
            "incident_rate", "claim_policies",
            None,
            "expense_ratio", "fee_amount",
            None,
            "policy_count", "written_premium", "earned_premium", "avg_premium",
            None,
            "pricing_coeff",
        ]

        def _yoy(prev, curr):
            if prev is None or curr is None or prev == 0:
                return "-"
            pct = (curr - prev) / abs(prev) * 100
            return f"+{pct:.1f}%" if pct > 0 else f"{pct:.1f}%"

        yr_headers = [str(y) for y in years]
        if show_growth and len(years) > 1:
            header_parts = [yr_headers[0]]
            align_parts = ["---:"]
            for j in range(1, len(years)):
                header_parts.append("YoY")
                header_parts.append(yr_headers[j])
                align_parts.append("---:")
                align_parts.append("---:")
            self.add("| 指标 | " + " | ".join(header_parts) + " | 趋势分析 |")
            self.add("| :--- | " + " | ".join(align_parts) + " | :--- |")
        else:
            self.add("| 指标 | " + " | ".join(yr_headers) + " | 趋势分析 |")
            self.add("| :--- | " + " | ".join(["---:"] * len(years)) + " | :--- |")

        for i, label in enumerate(labels):
            cells = []
            if show_growth and len(years) > 1:
                row_data_0 = cols_data.get(yr_headers[0], [])
                cells.append(row_data_0[i][1] if i < len(row_data_0) else "-")
                for j in range(1, len(years)):
                    gk = growth_keys[i] if i < len(growth_keys) else None
                    if gk is not None:
                        prev_d = data_by_year.get(years[j - 1], {})
                        curr_d = data_by_year.get(years[j], {})
                        yoy_str = _yoy(get_metric_value(prev_d, gk), get_metric_value(curr_d, gk))
                    else:
                        yoy_str = ""
                    row_data_j = cols_data.get(yr_headers[j], [])
                    cells.append(yoy_str)
                    cells.append(row_data_j[i][1] if i < len(row_data_j) else "-")
            else:
                for yr_str in yr_headers:
                    row_data = cols_data.get(yr_str, [])
                    cells.append(row_data[i][1] if i < len(row_data) else "-")
            trend = trends[i] if i < len(trends) else ""
            self.add(f"| {label} | " + " | ".join(cells) + f" | {trend} |")
        self.add()

    # ------------------------------------------------------------------
    # 按维度汇总的 KPI 表（板块 2.0/3.0/4.0）
    # ------------------------------------------------------------------

    def write_dim_summary_table(self, data_by_dim: dict, dim_names: list, analysis_col: str = "分析"):
        sample = next(iter(data_by_dim.values()), {})
        label_vals = self.kpi_rows(sample)
        labels = [lv[0] for lv in label_vals]

        cols_data = {}
        for dim in dim_names:
            d = data_by_dim.get(dim, {})
            cols_data[dim] = self.kpi_rows(d)

        total = sum_kpi_dicts(list(data_by_dim.values()))
        total_rows = self.kpi_rows(total)

        analyses = self._compute_dim_analysis(data_by_dim, dim_names)

        self.add("| 指标 | " + " | ".join(dim_names) + " | 汇总 | " + analysis_col + " |")
        self.add("| :--- | " + " | ".join(["---:"] * len(dim_names)) + " | ---: | :--- |")

        for i, label in enumerate(labels):
            cells = []
            for dim in dim_names:
                row_data = cols_data.get(dim, [])
                cells.append(row_data[i][1] if i < len(row_data) else "-")
            t_cell = total_rows[i][1] if i < len(total_rows) else "-"
            analysis = analyses[i] if i < len(analyses) else ""
            self.add(f"| {label} | " + " | ".join(cells) + f" | {t_cell} | {analysis} |")
        self.add()

    # ------------------------------------------------------------------
    # 季度趋势表（板块 5）
    # ------------------------------------------------------------------

    def write_quarter_table(self, rows: list, cols: list):
        self.add("| " + " | ".join(cols) + " |")
        self.add("| :--- | " + " | ".join(["---:"] * (len(cols) - 1)) + " |")
        for r in rows:
            cells = []
            for i, v in enumerate(r):
                if i == 0:
                    cells.append(str(v))
                elif v is None:
                    cells.append("-")
                elif isinstance(v, float):
                    cells.append(f"{v:,.1f}" if abs(v) < 1000 else f"{v:,.0f}")
                elif isinstance(v, int):
                    cells.append(f"{v:,d}")
                else:
                    cells.append(str(v))
            self.add("| " + " | ".join(cells) + " |")
        self.add()

    # ------------------------------------------------------------------
    # ASCII 条形图
    # ------------------------------------------------------------------

    def write_bar_chart(self, title: str, labels: list, values: list, unit: str = ""):
        self.add(f"### {title}\n")
        if not values or all(v is None for v in values):
            self.add("*无数据*\n")
            return
        safe_vals = [v or 0 for v in values]
        max_v = max(abs(v) for v in safe_vals) or 1
        self.add("```")
        for lbl, val in zip(labels, safe_vals):
            bar_len = max(1, int(abs(val) / max_v * 35))
            sign = "▓" if val >= 0 else "░"
            self.add(f"  {lbl} | {sign * bar_len} {val:>8,.1f}{unit}")
        self.add("```\n")

    # ------------------------------------------------------------------
    # 内部：趋势分析
    # ------------------------------------------------------------------

    def _compute_trends(self, data_by_year: dict, years: list) -> list:
        if len(years) < 2:
            return [""] * 22
        trends = []
        for m in METRIC_KEYS:
            if m is None:
                trends.append("")
                continue
            key, _name = m
            vals = [get_metric_value(data_by_year.get(yr, {}), key) for yr in years]
            trends.append(trend_text(vals, years))
        return trends

    # ------------------------------------------------------------------
    # 内部：维度分析
    # ------------------------------------------------------------------

    def _compute_dim_analysis(self, data_by_dim: dict, dim_names: list) -> list:
        analyses = []
        for m in METRIC_KEYS:
            if m is None:
                analyses.append("")
                continue
            key, _name = m
            valid = {}
            for dim in dim_names:
                v = get_metric_value(data_by_dim.get(dim, {}), key)
                if v is not None:
                    valid[dim] = v
            if not valid or len(valid) < 2:
                analyses.append("")
                continue
            best = max(valid, key=valid.get)
            worst = min(valid, key=valid.get)
            analyses.append(f"高:{best} 低:{worst}")
        return analyses
