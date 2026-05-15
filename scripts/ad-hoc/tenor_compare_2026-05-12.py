"""车险经营 · 短中长期对照 · 截至 2026-05-12

输入：本地 Parquet（policy/current + claims_detail）
输出：单页 HTML，含两张交互表
  · 表 1：7 时间窗 × 7 指标（可行列转置）
  · 表 2：客户类别 × 7 时间窗（单元格存 7 个指标值，可点选切换）

时间窗：当年起保 / 上年同期 / 滚动 6 / 12 / 24 / 36 / 48 个月

用法：
  python3 scripts/ad-hoc/tenor_compare_2026-05-12.py
  python3 scripts/ad-hoc/tenor_compare_2026-05-12.py --cutoff 2026-05-12 --output /tmp/x.html

依赖：duckdb（Python 包）+ pandas + ~/.claude/skills/diagnose-html-render
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from html import escape
from pathlib import Path
from typing import Optional

import duckdb
import pandas as pd

# 引入 skill 库（亮灯 / 格式化 / 整页外壳）
SKILL_DIR = Path("/Users/alongor666/.claude/skills/diagnose-html-render")
sys.path.insert(0, str(SKILL_DIR))
from lib.alerts import light  # noqa: E402
from lib.format import fmt_num  # noqa: E402
from lib.render import render_card, render_page, render_status_bar  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[2]
POLICY_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")

# 11 类（来自 src/shared/config/customer-categories.ts），实际数据多 1 类「拖拉机」
CUSTOMER_CATEGORIES_REGISTERED = [
    "非营业个人客车", "摩托车", "非营业货车", "非营业企业客车",
    "营业货车", "营业出租租赁", "特种车", "营业公路客运",
    "挂车", "非营业机关客车", "营业城市公交",
]


@dataclass(frozen=True)
class Period:
    label: str           # 列标签
    start_excl: date     # > 这一天
    end_incl: date       # <= 这一天


def build_periods(cutoff: date) -> list[Period]:
    """7 个窗口。所有窗口统一用 (start_excl, end_incl] 半开闭模式表达：
      - 当年起保：起=当年 1/1 → start_excl = 上年最后一天
      - 上年同期：与"当年起保"日历对称，整体平移一年
      - 滚动 N 月：start_excl = cutoff − N 月
    """
    def shift(months: int) -> date:
        m = cutoff.month - months
        y = cutoff.year
        while m <= 0:
            m += 12
            y -= 1
        try:
            return date(y, m, cutoff.day)
        except ValueError:
            return date(y, m, 28)

    last_day_prev_year = date(cutoff.year - 1, 12, 31)
    last_day_2years_ago = date(cutoff.year - 2, 12, 31)
    # 上年同期的右端：去年的 cutoff 同月同日（闰年时退化为 2/28）
    try:
        prev_year_cutoff = date(cutoff.year - 1, cutoff.month, cutoff.day)
    except ValueError:
        prev_year_cutoff = date(cutoff.year - 1, cutoff.month, 28)

    return [
        Period("当年起保",  last_day_prev_year,   cutoff),            # [当年 1/1, cutoff]
        Period("上年同期",  last_day_2years_ago,  prev_year_cutoff),  # [上年 1/1, 上年 cutoff]
        Period("滚动6个月",  shift(6),  cutoff),
        Period("滚动12个月", shift(12), cutoff),
        Period("滚动24个月", shift(24), cutoff),
        Period("滚动36个月", shift(36), cutoff),
        Period("滚动48个月", shift(48), cutoff),
    ]


# ─────────────────────────── SQL ───────────────────────────

def build_sql(cutoff: date, periods: list[Period]) -> str:
    """单条 SQL，输出 (period, customer_category | __ALL__, 全部聚合中间量)。"""
    earliest = min(p.start_excl for p in periods)  # 最大窗口的左端
    period_rows = ",\n    ".join(
        f"('{p.label}', DATE '{p.start_excl.isoformat()}', DATE '{p.end_incl.isoformat()}')"
        for p in periods
    )
    cutoff_str = cutoff.isoformat()

    return f"""
WITH policy_dedup AS (
  -- 按 (policy_no, insurance_start_date) 去重，HAVING SUM(premium)>0（B252）
  SELECT
    policy_no,
    CAST(insurance_start_date AS DATE) AS insurance_start_date,
    SUM(premium)                       AS premium,
    SUM(COALESCE(fee_amount, 0))       AS fee_amount,
    ANY_VALUE(insurance_type)          AS insurance_type,
    ANY_VALUE(customer_category)       AS customer_category,
    -- 批改可变字段优先取原单（premium>0）
    COALESCE(
      ANY_VALUE(CASE WHEN premium > 0 THEN commercial_pricing_factor END),
      ANY_VALUE(commercial_pricing_factor)
    )                                  AS commercial_pricing_factor
  FROM read_parquet('{POLICY_GLOB}')
  WHERE insurance_start_date IS NOT NULL
    AND CAST(insurance_start_date AS DATE) >  DATE '{earliest.isoformat()}'
    AND CAST(insurance_start_date AS DATE) <= DATE '{cutoff_str}'
  GROUP BY policy_no, CAST(insurance_start_date AS DATE)
  HAVING SUM(premium) > 0
),
claims_agg AS (
  -- 截至 cutoff 的赔案聚合：已结案取 settled_amount，未结取 reserve_amount（同 metric-registry 口径）
  SELECT
    policy_no,
    COUNT(DISTINCT claim_no) AS claim_cases,
    SUM(
      CASE
        WHEN settlement_time IS NOT NULL
         AND CAST(settlement_time AS DATE) <= DATE '{cutoff_str}'
        THEN COALESCE(settled_amount, 0)
        ELSE COALESCE(reserve_amount, 0)
      END
    ) AS reported_claims
  FROM read_parquet('{CLAIMS_GLOB}')
  WHERE report_time IS NOT NULL
    AND CAST(report_time AS DATE) <= DATE '{cutoff_str}'
  GROUP BY policy_no
),
policy_exposure AS (
  SELECT
    p.policy_no,
    p.insurance_start_date,
    p.insurance_type,
    p.customer_category,
    p.premium,
    p.fee_amount,
    p.commercial_pricing_factor,
    COALESCE(c.reported_claims, 0) AS reported_claims,
    COALESCE(c.claim_cases, 0)     AS claim_cases,
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(DATEDIFF('day', p.insurance_start_date, DATE '{cutoff_str}'), 0),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days
  FROM policy_dedup p
  LEFT JOIN claims_agg c USING (policy_no)
),
periods(period_label, period_start_excl, period_end_incl) AS (
  VALUES
    {period_rows}
)
SELECT
  pr.period_label,
  COALESCE(pe.customer_category, '__ALL__') AS customer_category,
  COUNT(DISTINCT pe.policy_no)              AS policy_count,
  SUM(pe.reported_claims)                   AS reported_claims_sum,
  SUM(pe.premium * CAST(pe.earned_days AS DOUBLE)
      / NULLIF(CAST(pe.policy_term AS DOUBLE), 0))   AS earned_premium_sum,
  SUM(COALESCE(pe.fee_amount, 0))           AS fee_sum,
  SUM(pe.premium)                           AS premium_sum,
  SUM(CASE WHEN pe.insurance_type = '商业保险'
           THEN pe.premium END)             AS commercial_premium_sum,
  SUM(CASE WHEN pe.insurance_type = '商业保险'
            AND pe.commercial_pricing_factor > 0
           THEN pe.premium / pe.commercial_pricing_factor END)
                                            AS baseline_premium_sum,
  SUM(pe.claim_cases)                       AS claim_cases_sum,
  SUM(CAST(pe.claim_cases AS DOUBLE) * CAST(pe.policy_term AS DOUBLE)
      / NULLIF(CAST(pe.earned_days AS DOUBLE), 0))   AS annualized_claim_cases_sum
FROM periods pr
LEFT JOIN policy_exposure pe
  ON pe.insurance_start_date >  pr.period_start_excl
 AND pe.insurance_start_date <= pr.period_end_incl
GROUP BY GROUPING SETS (
  (pr.period_label),                              -- 表 1：整体
  (pr.period_label, pe.customer_category)         -- 表 2：分客户类别
)
ORDER BY pr.period_label, customer_category;
"""


# ─────────────────────────── 派生指标 ───────────────────────────

METRIC_DEFS: list[tuple[str, str, str, Optional[str]]] = [
    # (列 key, 中文名, fmt kind, alerts.TH key 用于打灯；None=不打灯)
    ("variable_cost_ratio", "变动成本率",       "pct",    "variable_cost_ratio_pct"),
    ("policy_count",        "保单件数（万）",   "wan2",   None),
    ("earned_claim_ratio",  "满期赔付率",       "pct",    "earned_loss_ratio_pct"),
    ("earned_loss_frequency","满期出险率",     "pct",    "earned_loss_freq_pct"),
    ("avg_claim_amount",    "案均赔款",         "money0", None),
    ("claim_cases",         "赔案件数（万）",   "wan2",   None),
    ("weighted_pricing_factor","自主系数",      "coef",   None),
]


def derive_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """SUM(分子)/SUM(分母)，分母 0 时返回 NaN（渲染显示 —）。"""
    def safe_div(num, den):
        return num.where(den.fillna(0) > 0) / den.where(den.fillna(0) > 0)

    out = df.copy()
    out["earned_claim_ratio"]      = safe_div(out.reported_claims_sum, out.earned_premium_sum) * 100
    out["expense_ratio"]           = safe_div(out.fee_sum,             out.premium_sum)        * 100
    out["variable_cost_ratio"]     = out["earned_claim_ratio"] + out["expense_ratio"]
    out["earned_loss_frequency"]   = safe_div(out.annualized_claim_cases_sum, out.policy_count) * 100
    out["avg_claim_amount"]        = safe_div(out.reported_claims_sum, out.claim_cases_sum)
    out["weighted_pricing_factor"] = safe_div(out.commercial_premium_sum, out.baseline_premium_sum)
    out["claim_cases"]             = out.claim_cases_sum
    return out


# ─────────────────────────── HTML 渲染 ───────────────────────────

def _fmt_or_dash(v, kind: str) -> str:
    if v is None or pd.isna(v):
        return "—"
    if kind == "wan2":
        # 万 + 2 位小数；单位"万"已在表头/按钮 label 内体现，单元格只放数字
        return f"{v / 10000:,.2f}"
    return fmt_num(v, kind)


def _light_cls(metric_alert_key: Optional[str], val, n: int) -> str:
    if metric_alert_key is None:
        return ""
    cls, _ = light(metric_alert_key, val, int(n) if pd.notna(n) else 0)
    return cls


def render_table_1(overall: pd.DataFrame, periods: list[Period]) -> str:
    """表 1：正向（7 行指标 × 6 列时间窗）+ 转置（6 行 × 7 列），按钮切换。"""
    # 整体行已按 period_label 排序，但需要按 periods 自定义顺序重排
    overall = overall.set_index("period_label").reindex([p.label for p in periods])

    # ── 正向：行=指标, 列=时间窗 ──
    # 所有单元格都渲染 .dot 占位；无打灯指标用 .dot-empty（visibility:hidden）保留水平空间。
    th_normal = "".join(f"<th class='num-th'>{escape(p.label)}</th>" for p in periods)
    rows_normal = []
    for key, name, kind, alert in METRIC_DEFS:
        tds = []
        for p in periods:
            row = overall.loc[p.label]
            v = row.get(key)
            cls = _light_cls(alert, v, row["policy_count"])
            dot_cls = cls.replace("alert-", "dot-") if cls else "dot-empty"
            tds.append(
                f'<td class="num {cls} has-dot">'
                f'<span class="num-val">{_fmt_or_dash(v, kind)}</span>'
                f'<span class="dot {dot_cls}" aria-hidden="true"></span></td>'
            )
        rows_normal.append(f"<tr><td class='dim-cell'><strong>{escape(name)}</strong></td>{''.join(tds)}</tr>")

    table_normal = (
        f"<table class='data-table' id='table-1-normal'>"
        f"<thead><tr><th>指标</th>{th_normal}</tr></thead>"
        f"<tbody>{''.join(rows_normal)}</tbody></table>"
    )

    # ── 转置：行=时间窗, 列=指标 ──
    th_t = "".join(f"<th class='num-th'>{escape(name)}</th>" for _, name, _, _ in METRIC_DEFS)
    rows_t = []
    for p in periods:
        row = overall.loc[p.label]
        tds = []
        for key, _, kind, alert in METRIC_DEFS:
            v = row.get(key)
            cls = _light_cls(alert, v, row["policy_count"])
            dot_cls = cls.replace("alert-", "dot-") if cls else "dot-empty"
            tds.append(
                f'<td class="num {cls} has-dot">'
                f'<span class="num-val">{_fmt_or_dash(v, kind)}</span>'
                f'<span class="dot {dot_cls}" aria-hidden="true"></span></td>'
            )
        rows_t.append(f"<tr><td class='dim-cell'><strong>{escape(p.label)}</strong></td>{''.join(tds)}</tr>")

    table_t = (
        f"<table class='data-table' id='table-1-transposed' style='display:none'>"
        f"<thead><tr><th>时间窗</th>{th_t}</tr></thead>"
        f"<tbody>{''.join(rows_t)}</tbody></table>"
    )

    button = (
        "<div class='table-actions'>"
        "<button class='btn-toggle' id='btn-transpose' onclick='toggleTranspose1()'>"
        "⇄ 行列转置</button></div>"
    )
    return button + table_normal + table_t


def render_table_2(by_cat: pd.DataFrame, periods: list[Period],
                   category_order: list[str]) -> str:
    """表 2：行=客户类别, 列=时间窗。
    每个 td 在 data-* 属性上存全部 7 个指标值 + 对应亮灯 class。
    JS 切换指标时改 textContent + className。
    """
    by_cat = by_cat.set_index(["customer_category", "period_label"])

    # ── 顶部指标切换按钮组 ──
    btn_html = "<div class='table-actions metric-switcher'><span class='switcher-label'>切换指标：</span>"
    for i, (key, name, _, _) in enumerate(METRIC_DEFS):
        active = " active" if i == 0 else ""
        btn_html += (
            f"<button class='btn-metric{active}' data-metric='{key}' "
            f"onclick='switchMetric2(\"{key}\")'>{escape(name)}</button>"
        )
    btn_html += "</div>"

    # ── 表头 ──
    th = "".join(f"<th class='num-th'>{escape(p.label)}</th>" for p in periods)
    head_html = f"<thead><tr><th>客户类别</th>{th}</tr></thead>"

    # ── tbody ──
    rows_html = []
    for cat in category_order:
        cells = []
        for p in periods:
            try:
                row = by_cat.loc[(cat, p.label)]
            except KeyError:
                # 该 (类别, 时间窗) 组合无数据；色点也用 dot-empty 占位保对齐
                # 同时存全 7 个 data-* 占位，避免 JS 切换时 dataset[key] 为空
                placeholder_data = " ".join(f'data-{k}="—" data-light-{k}=""' for k, *_ in METRIC_DEFS)
                cells.append(
                    f"<td class='num data-cell has-dot' {placeholder_data}>"
                    f"<span class='num-val'>—</span>"
                    f"<span class='dot dot-empty' aria-hidden='true'></span></td>"
                )
                continue
            n = int(row["policy_count"]) if pd.notna(row["policy_count"]) else 0

            data_attrs = []
            light_attrs = []
            display_text = "—"
            display_cls = ""
            for i, (key, _, kind, alert) in enumerate(METRIC_DEFS):
                v = row.get(key)
                text = _fmt_or_dash(v, kind)
                data_attrs.append(f'data-{key}="{escape(text)}"')
                cls = _light_cls(alert, v, n)
                light_attrs.append(f'data-light-{key}="{cls}"')
                if i == 0:  # 默认显示第一个：变动成本率
                    display_text = text
                    display_cls = cls
            display_dot_cls = display_cls.replace("alert-", "dot-") if display_cls else "dot-empty"
            cells.append(
                f'<td class="num data-cell {display_cls} has-dot" '
                f'{" ".join(data_attrs)} {" ".join(light_attrs)}>'
                f'<span class="num-val">{display_text}</span>'
                f'<span class="dot {display_dot_cls}" aria-hidden="true"></span></td>'
            )
        rows_html.append(
            f"<tr><td class='dim-cell'><strong>{escape(cat)}</strong></td>{''.join(cells)}</tr>"
        )

    table = (
        f"<table class='data-table' id='table-2'>{head_html}"
        f"<tbody>{''.join(rows_html)}</tbody></table>"
    )
    return btn_html + table


# 注入的 JS（在 cards_html 末尾追加一段 <script>）
INTERACT_JS = """
<script>
(function() {
  // 表 1 转置
  let isTrans = false;
  window.toggleTranspose1 = function() {
    document.getElementById('table-1-normal').style.display      = isTrans ? '' : 'none';
    document.getElementById('table-1-transposed').style.display  = isTrans ? 'none' : '';
    isTrans = !isTrans;
  };

  // 表 2 指标切换：色点永远存在（dot-empty 占位），只改 class，不增删 DOM
  const ALERT_CLASSES = ['alert-green','alert-blue','alert-yellow','alert-red','alert-gray'];
  const DOT_CLASSES   = ['dot-green','dot-blue','dot-yellow','dot-red','dot-gray','dot-empty'];
  window.switchMetric2 = function(metric) {
    document.querySelectorAll('#table-2 td.data-cell').forEach(td => {
      const valText = td.dataset[metric] || '—';
      td.querySelector('.num-val').textContent = valText;

      // 清旧灯，加新灯（无灯时 td 不加 alert-* class，但 has-dot 永远保留以保位）
      ALERT_CLASSES.forEach(c => td.classList.remove(c));
      const raw = td.getAttribute('data-light-' + metric);
      if (raw) td.classList.add(raw);

      // 色点永远存在；无灯时切到 dot-empty 占位
      const dot = td.querySelector('.dot');
      DOT_CLASSES.forEach(c => dot.classList.remove(c));
      dot.classList.add(raw ? raw.replace('alert-','dot-') : 'dot-empty');
    });
    document.querySelectorAll('.btn-metric').forEach(b => {
      b.classList.toggle('active', b.dataset.metric === metric);
    });
  };
})();
</script>
<style>
/* 无打灯单元格的色点占位：保留水平位置但不可见，避免数字横向漂移 */
.dot-empty { visibility: hidden; }
.table-actions { margin: 8px 0 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.btn-toggle, .btn-metric {
  padding: 6px 12px; border: 1px solid var(--border-color, #d0d0d0);
  background: var(--card-bg, #fff); color: var(--text-color, #333);
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.btn-metric.active { background: var(--accent-bg, #1a4d8c); color: #fff; border-color: var(--accent-bg, #1a4d8c); }
.btn-toggle:hover, .btn-metric:hover { opacity: 0.85; }
.switcher-label { font-size: 13px; color: var(--text-muted, #666); }
</style>
"""


# ─────────────────────────── 主流程 ───────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff", default="2026-05-12", help="数据截止日期 YYYY-MM-DD")
    parser.add_argument("--output", default="/tmp/tenor_compare_2026-05-12.html",
                        help="HTML 输出路径")
    args = parser.parse_args()

    cutoff = date.fromisoformat(args.cutoff)
    periods = build_periods(cutoff)

    print(f"[1/4] 时间窗：")
    for p in periods:
        print(f"      {p.label:>12}  ({p.start_excl} , {p.end_incl}]")

    print(f"[2/4] 执行 DuckDB 查询 …")
    con = duckdb.connect(":memory:")
    df = con.execute(build_sql(cutoff, periods)).fetchdf()
    con.close()

    print(f"      返回 {len(df)} 行")
    df_metrics = derive_metrics(df)

    # 拆分：整体行（customer_category == '__ALL__'）vs 分类行
    overall = df_metrics[df_metrics["customer_category"] == "__ALL__"].copy()
    by_cat  = df_metrics[df_metrics["customer_category"] != "__ALL__"].copy()

    # ── QC 摘要 ──
    print("[3/4] 质检摘要：")
    print("      ── 整体行（表 1 数据源）──")
    qc_cols = ["period_label", "policy_count", "variable_cost_ratio",
               "earned_claim_ratio", "earned_loss_frequency",
               "avg_claim_amount", "claim_cases", "weighted_pricing_factor"]
    qc = overall[qc_cols].copy()
    qc["weighted_pricing_factor"] = qc["weighted_pricing_factor"].round(3)
    for c in ["variable_cost_ratio", "earned_claim_ratio", "earned_loss_frequency"]:
        qc[c] = qc[c].round(2)
    qc["avg_claim_amount"] = qc["avg_claim_amount"].round(0)
    # 件数按 万-2 位小数 展示，便于和报告核对
    qc["policy_count_wan"] = (qc["policy_count"] / 10000).round(2)
    qc["claim_cases_wan"]  = (qc["claim_cases"] / 10000).round(2)
    qc_display = qc[["period_label", "policy_count_wan", "variable_cost_ratio",
                     "earned_claim_ratio", "earned_loss_frequency",
                     "avg_claim_amount", "claim_cases_wan", "weighted_pricing_factor"]]
    qc_display = qc_display.set_index("period_label").reindex([p.label for p in periods]).reset_index()
    print(qc_display.to_string(index=False))

    # 校验：滚动窗（6/12/24/36/48 月）保单件数应单调不减
    rolling = qc[qc.period_label.str.startswith("滚动")].copy()
    rolling = rolling.set_index("period_label").reindex(
        [p.label for p in periods if p.label.startswith("滚动")]
    )
    rolling_counts = rolling["policy_count"].fillna(0).astype(int).tolist()
    print(f"      滚动窗保单件数：{rolling_counts} → " +
          ("单调不减 ✓" if all(rolling_counts[i] <= rolling_counts[i+1]
                              for i in range(len(rolling_counts)-1))
           else "⚠ 非单调（数据问题？）"))
    # 自主系数应在 [0.5, 1.5]
    facs = qc["weighted_pricing_factor"].dropna().tolist()
    if facs and (min(facs) < 0.5 or max(facs) > 1.5):
        print(f"      ⚠ 自主系数越界：{facs}")
    else:
        print(f"      自主系数范围：[{min(facs):.3f}, {max(facs):.3f}] ✓")

    # 分类完整性
    cats_seen = sorted(by_cat["customer_category"].unique().tolist())
    missing_in_ts = [c for c in cats_seen if c not in CUSTOMER_CATEGORIES_REGISTERED]
    print(f"      客户类别（数据中实际出现）：{len(cats_seen)} 类")
    if missing_in_ts:
        print(f"      ⚠ TS 枚举缺：{missing_in_ts}（已按数据顺序追加到末尾）")

    # ── 生成 HTML ──
    print("[4/4] 渲染 HTML …")
    category_order = CUSTOMER_CATEGORIES_REGISTERED + [c for c in cats_seen if c not in CUSTOMER_CATEGORIES_REGISTERED]
    # 仅保留实际有数据的类别
    category_order = [c for c in category_order if c in cats_seen]

    # 顶部状态条（取"当年起保"做 YTD 摘要）
    ytd_row = overall.loc[overall.period_label == "当年起保"].iloc[0]
    total_premium = float(ytd_row["premium_sum"] or 0)
    total_policies = int(ytd_row["policy_count"] or 0)
    status_bar = render_status_bar(
        items=[
            ("数据截止", cutoff.isoformat()),
            ("当年保单", f"{total_policies / 10000:,.2f} 万"),
            ("当年保费", f"{total_premium / 10000:,.0f} 万元"),
            ("客户类别", f"{len(category_order)} 类（数据实际出现）"),
        ],
    )

    card_1 = render_card(
        title="表 1 · 时间窗 × 指标（整体）",
        subtitle="7 个时间窗对照 7 个核心指标；点击「⇄ 行列转置」切换视图。",
        body=render_table_1(overall, periods),
    )

    card_2 = render_card(
        title="表 2 · 客户类别 × 时间窗",
        subtitle="默认展示变动成本率；点击顶部按钮切换其余 6 个指标，亮灯随之刷新。",
        body=render_table_2(by_cat, periods, category_order),
    )

    cards_html = status_bar + card_1 + card_2 + INTERACT_JS

    info_html = f"""
    <div class="card">
      <h2>数据口径</h2>
      <ul>
        <li><strong>时间锚</strong>：起保日期 <code>insurance_start_date</code>。</li>
        <li><strong>当年起保</strong>：[当年 1 月 1 日, {cutoff.isoformat()}]。</li>
        <li><strong>上年同期</strong>：与"当年起保"日历对称，整体平移一年 →
            [{cutoff.year - 1}-01-01, {cutoff.year - 1}-{cutoff.month:02d}-{cutoff.day:02d}]。</li>
        <li><strong>滚动 N 个月</strong>：(cutoff − N 月, cutoff]，左开右闭，避免左端日重复入两窗。</li>
        <li><strong>保单去重</strong>：按 (保单号, 起保日期) 聚合，<code>HAVING SUM(premium) &gt; 0</code>，排除全退保。</li>
        <li><strong>赔款</strong>：已结案取 <code>settled_amount</code>，未结案取 <code>reserve_amount</code>。</li>
        <li><strong>满期保费</strong>：<code>保费 × 满期天数 / 保险期限天数</code>（闰年感知 365/366）。</li>
        <li><strong>变动成本率</strong> = 满期赔付率（分母满期保费） + 费用率（分母签单保费）。</li>
        <li><strong>满期出险率</strong>：年化口径 <code>Σ(赔案 × 保险期限 / 满期天数) / 去重保单数</code>。</li>
        <li><strong>自主系数</strong>：仅商业险样本，调和加权 <code>Σ(商业险保费) / Σ(商业险基准保费)</code>，
            基准保费 = 商业险保费 / 自主系数。结果应落在 [0.5, 1.5]。</li>
        <li><strong>件数单位</strong>：保单件数和赔案件数以"万"为单位，保留 2 位小数（表头已标注）。</li>
        <li><strong>范围</strong>：不分险种、不排除任何客户类别。</li>
      </ul>
    </div>
    """

    html = render_page(
        title=f"车险经营 · 短中长期对照 · {cutoff.isoformat()}",
        cards_html=cards_html,
        info_html=info_html,
        kicker="车险经营 · 短中长期对照",
        footer_text=f"数据截止 {cutoff.isoformat()} · 由 scripts/ad-hoc/tenor_compare_2026-05-12.py 生成",
    )

    Path(args.output).write_text(html, encoding="utf-8")
    print(f"      已写入：{args.output}（{len(html):,} 字符）")
    print(f"      浏览器打开：open {args.output}")


if __name__ == "__main__":
    main()
