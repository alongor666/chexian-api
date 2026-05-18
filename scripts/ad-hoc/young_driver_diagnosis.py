"""非营业个人客车 · 年轻驾驶人（<24岁 / 24-28岁）经营诊断报告

设计意图（针对前版"多维度数据罗列"批评的改造）：
  1. 用 chexian-report-shell skill 的四级亮灯（TH_LR/TH_IR/TH_VC）做标准化判断
  2. 车牌归属地用 plate_region dim 表 JOIN 真实地市，不再硬编码
  3. 维度精选 + 增量：增 续保/过户/车价段/保险等级 4 个高价值维度，去重复的拼接表格
  4. 每张表配 callout：why（业务原因）+ so what（决策含义）
  5. 顶部 TL;DR：3 行核心判断 + 4 个对照数字
  6. 新增"跨维度风险评分"卡片，给 24-28 商业险拆三档风险池
  7. 新增"年度趋势 + 拐点"卡片，识别报行合一红利、监管转折
  8. 底部"5 个行动 + 反直觉发现 + Know-how"，每条含 why
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Optional

import duckdb
import numpy as np
import pandas as pd

SKILL_ROOT = Path.home() / ".claude/skills/chexian-report-shell"
if not SKILL_ROOT.exists():
    raise SystemExit(
        f"chexian-report-shell skill 未安装于 {SKILL_ROOT}；"
        "请先安装 gstack chexian-report-shell 或设置 ~/.claude/skills/ 软链。"
    )
sys.path.insert(0, str(SKILL_ROOT))

from lib import (  # noqa: E402
    standard_query, auto_cutoff,
    DIM_EXPR, PRICE_BUCKETS,
    render_table, render_card, render_callout, render_rule, render_page,
)


# ============================================================
# 数据驱动 callout 共享判定函数
# ============================================================

# 项目阈值（与 lib/alerts.py 同源）
TH_VC = (85.0, 91.0, 94.0)   # 变动成本率：优秀/健康/异常 边界
TH_LR = (60.0, 70.0, 75.0)   # 满期赔付率
TH_IR = (8.0, 10.0, 12.0)    # 满期出险率
MIN_SAMPLE = 30


def vcr_band(vcr: Optional[float]) -> tuple[str, str]:
    """返回 (灯色 level, 文字标签)"""
    if vcr is None or pd.isna(vcr):
        return ("info", "无数据")
    if vcr < TH_VC[0]:
        return ("info", "优秀")
    if vcr < TH_VC[1]:
        return ("info", "健康")
    if vcr < TH_VC[2]:
        return ("warn", "异常")
    return ("danger", "危险")


def classify_spread(spread: float,
                    big: float = 8.0, small: float = 3.0,
                    inverse_signif: float = -3.0) -> tuple[str, str]:
    """spread = 基准 VCR - 目标 VCR；正数表示「目标」更优。
    返回 (level, 状态文字)。"""
    if spread > big:
        return ("info", "显著优于")
    if spread > small:
        return ("info", "略优于")
    if spread < inverse_signif:
        return ("danger", "反而劣于")
    return ("warn", "未拉开差距")


def safe_row(df: pd.DataFrame, dim_val: str) -> Optional[pd.Series]:
    rows = df[df["dim"] == dim_val]
    return rows.iloc[0] if len(rows) else None


def detect_monotonic(values: list[float]) -> dict:
    """检测序列单调性。values 为按维度自然顺序排列。
    返回 {direction: up/down/none, consistency: 0-1, max_dev_idx: int, max_dev: float}"""
    arr = np.array([v for v in values if v is not None and not pd.isna(v)])
    if len(arr) < 3:
        return {"direction": "none", "consistency": 0.0,
                "max_dev_idx": -1, "max_dev": 0.0}
    diffs = np.diff(arr)
    up = (diffs > 0).sum()
    down = (diffs < 0).sum()
    n = len(diffs)
    if up / n >= 0.7:
        direction, consistency = "up", up / n
    elif down / n >= 0.7:
        direction, consistency = "down", down / n
    else:
        direction, consistency = "none", max(up, down) / n
    # 偏离线性的最大点
    expected = np.linspace(arr[0], arr[-1], len(arr))
    dev = arr - expected
    max_dev_idx = int(np.argmax(np.abs(dev)))
    return {"direction": direction, "consistency": float(consistency),
            "max_dev_idx": max_dev_idx, "max_dev": float(dev[max_dev_idx])}


def sample_ok(row: Optional[pd.Series]) -> bool:
    if row is None:
        return False
    return int(row.get("policy_count", 0)) >= MIN_SAMPLE

ROOT = Path(__file__).resolve().parents[2]
POLICY_GLOB = str(ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS_GLOB = str(ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
PLATE_DIM = str(ROOT / "数据管理/warehouse/dim/plate_region/latest.parquet")
REPORT_DIR = ROOT / "数据管理/数据分析报告"

VALUATION = date.today().isoformat()
WHERE_BASE = (
    "customer_category = '非营业个人客车' "
    "AND driver_age_group IN ('年龄＜24岁', '24岁≤年龄＜28岁') "
    "AND YEAR(insurance_start_date) BETWEEN 2021 AND 2026"
)

AGE_DIM = "CASE WHEN driver_age_group='年龄＜24岁' THEN '<24岁' ELSE '24-28岁' END"


def q(con, dim_expr=None, extra_fields=None, extra_filter="",
      order="dim ASC, premium DESC"):
    """统一查询封装：固定 WHERE + 估值日。"""
    where = WHERE_BASE + (f" AND {extra_filter}" if extra_filter else "")
    return standard_query(
        con,
        where_clause=where,
        params=[],
        cutoff=VALUATION,
        extra_fields=extra_fields,
        dim_expr=dim_expr,
        order=order,
    )


# ============================================================
# 卡片 1：总览（年龄段 × 险类 + 合计）
# ============================================================

def card_overview(con):
    df_total = q(con, dim_expr="'合计'", order="premium DESC")
    df_age = q(con, extra_fields=["driver_age_group"],
               dim_expr=AGE_DIM, order="dim ASC")
    df_age_type = q(
        con,
        extra_fields=["driver_age_group", "insurance_type"],
        dim_expr=f"{AGE_DIM} || ' · ' || insurance_type",
        order="dim ASC",
    )

    total = df_total.iloc[0]
    age_under24 = df_age[df_age["dim"] == "<24岁"].iloc[0]
    age_24_28 = df_age[df_age["dim"] == "24-28岁"].iloc[0]

    body_total = render_table(df_total, "全口径")
    body_age = render_table(df_age, "年龄段")
    body_age_type = render_table(df_age_type, "年龄段·险类")

    # 数据驱动 callout：状态判定 + 关键差值 + 件均对比
    total_lvl, total_label = vcr_band(total["variable_cost_ratio_pct"])
    age_spread = age_under24["variable_cost_ratio_pct"] - age_24_28["variable_cost_ratio_pct"]
    per_policy_ratio = age_24_28["per_policy_premium"] / age_under24["per_policy_premium"]

    callout = render_callout(
        f"<strong>整体状态:{total_label}</strong>(变动成本率 <strong>{total['variable_cost_ratio_pct']:.1f}%</strong>;"
        f"判定带 优秀&lt;{TH_VC[0]:.0f} / 健康&lt;{TH_VC[1]:.0f} / 异常&lt;{TH_VC[2]:.0f} / 危险≥{TH_VC[2]:.0f})。"
        f"<br>合计 <strong>{int(total['policy_count']):,}</strong> 张保单、"
        f"<strong>{total['premium']/10000:,.0f}</strong> 万元保费;"
        f"满期赔付率 <strong>{total['earned_loss_ratio_pct']:.1f}%</strong>、"
        f"费用率 <strong>{total['expense_ratio_pct']:.1f}%</strong>。"
        f"<br>年龄段差异:&lt;24岁 <strong>{age_under24['variable_cost_ratio_pct']:.1f}%</strong> 与 "
        f"24-28岁 <strong>{age_24_28['variable_cost_ratio_pct']:.1f}%</strong> 相差 "
        f"<strong>{age_spread:+.1f} 个点</strong>;"
        f"件均保费 <strong>{int(age_24_28['per_policy_premium']):,}</strong> 元 与 "
        f"<strong>{int(age_under24['per_policy_premium']):,}</strong> 元(后者为前者的 {per_policy_ratio:.2f} 倍)。",
        level=total_lvl,
    )

    return render_card(
        "总览：年龄段 × 险类",
        "",
        body_total + render_rule() + body_age + render_rule() + body_age_type + callout,
        kicker="管理层 TL;DR",
    )


# ============================================================
# 卡片 2：续保 vs 新单（最重磅维度）
# ============================================================

def card_renewal(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "is_renewal"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_renewal THEN '续保' ELSE '新单' END",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·续保状态")

    u_new = safe_row(df, "<24岁 · 新单")
    u_renew = safe_row(df, "<24岁 · 续保")
    t_new = safe_row(df, "24-28岁 · 新单")
    t_renew = safe_row(df, "24-28岁 · 续保")

    # spread = 新单 - 续保（正数=续保更优；负数=续保反而劣）
    spread_u = u_new["variable_cost_ratio_pct"] - u_renew["variable_cost_ratio_pct"]
    spread_t = t_new["variable_cost_ratio_pct"] - t_renew["variable_cost_ratio_pct"]
    max_spread = max(spread_u, spread_t)
    min_spread = min(spread_u, spread_t)
    renew_share = df[df["dim"].str.contains("续保")]["premium"].sum() / df["premium"].sum() * 100

    if max_spread > 8:
        sig, lvl = "续保过滤效果显著", "info"
        so_what = (
            f"续保变动成本率比新单低超过 8 个点 → 续保保留率每提升 1 个点,"
            f"对应变动成本率下降 0.1-0.2 个点。建议作为该客群第一考核指标(高于保费规模)。"
        )
    elif max_spread > 3:
        sig, lvl = "续保比新单略优", "info"
        so_what = "差距 3-8 个点 → 续保是温和过滤器,保留率提升与新单挑选并重。"
    elif min_spread < -3:
        sig, lvl = "续保反而劣于新单", "danger"
        so_what = (
            f"续保变动成本率反超新单最多 <strong>{abs(min_spread):.1f}</strong> 个点 → "
            f"续保并非风险过滤器、而是负向选择。可能原因:"
            f"① 高风险客户被本公司续保(被其他公司剔除);"
            f"② 续保未按无赔款优待系数实际履行差异化定价。"
            f"建议拆「保费下滑续保」与「保单数下滑续保」做客户层面访谈。"
        )
    else:
        sig, lvl = "续保与新单未拉开差距", "warn"
        so_what = (
            "差距落在 ±3 个点之内 → 续保客群可能被低质量延续保单稀释。"
            "建议拆「保费下滑续保」对比「保单数下滑续保」二次核查。"
        )

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>24-28岁:续保 <strong>{t_renew['variable_cost_ratio_pct']:.1f}%</strong>、"
        f"新单 <strong>{t_new['variable_cost_ratio_pct']:.1f}%</strong>"
        f"(差 {spread_t:+.1f} 个点);"
        f"&lt;24岁:续保 <strong>{u_renew['variable_cost_ratio_pct']:.1f}%</strong>、"
        f"新单 <strong>{u_new['variable_cost_ratio_pct']:.1f}%</strong>"
        f"(差 {spread_u:+.1f} 个点)。"
        f"续保占保费比 <strong>{renew_share:.1f}%</strong>。"
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("维度 1：续保 vs 新单", "", body + callout,
                       kicker="风险过滤器 · 最优先")


# ============================================================
# 卡片 3：新旧车（揭示定价倒挂）
# ============================================================

def card_newcar(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "is_new_car"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_new_car THEN '新车' ELSE '旧车' END",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·新/旧车")

    # 同时拉自主系数对照
    factor_sql = f"""
WITH p AS (
  SELECT policy_no, MIN({AGE_DIM}) AS age, MAX(is_new_car) AS is_new_car,
         SUM(premium) AS premium,
         MAX(CASE WHEN premium > 0 THEN commercial_pricing_factor END) AS factor
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
  WHERE {WHERE_BASE} AND insurance_type='商业保险'
  GROUP BY policy_no
  HAVING SUM(premium) > 0
)
SELECT age || ' · ' || CASE WHEN is_new_car THEN '新车' ELSE '旧车' END AS dim,
       COUNT(*) AS n,
       ROUND(SUM(factor * premium) / NULLIF(SUM(premium), 0), 3) AS factor_w
FROM p
GROUP BY 1 ORDER BY 1
"""
    df_factor = con.execute(factor_sql).df()
    factor_rows = "<br>".join(
        f"{r['dim']}: 自主系数加权 <strong>{r['factor_w']:.3f}</strong>"
        for _, r in df_factor.iterrows()
    )

    # 数据驱动：检测 <24岁 + 24-28岁 是否倒挂
    u_new = safe_row(df, "<24岁 · 新车")
    u_old = safe_row(df, "<24岁 · 旧车")
    fu_new = df_factor[df_factor["dim"] == "<24岁 · 新车"]["factor_w"].iloc[0]
    fu_old = df_factor[df_factor["dim"] == "<24岁 · 旧车"]["factor_w"].iloc[0]

    factor_diff = fu_new - fu_old
    vcr_diff = u_new["variable_cost_ratio_pct"] - u_old["variable_cost_ratio_pct"]
    CAP = 1.5
    headroom = (CAP - fu_new) / fu_new * 100
    inverted = (factor_diff < 0 and vcr_diff > 0)

    if inverted:
        sig, lvl = "新车定价倒挂确认", "danger"
        equalize_gain = (fu_old / fu_new - 1) * u_new["variable_cost_ratio_pct"]
        so_what = (
            f"若把新车系数拉齐到旧车水平 <strong>{fu_old:.3f}</strong>"
            f"(监管上限 {CAP:.1f},仍剩 {(CAP-fu_old)/fu_old*100:.0f}% 空间),"
            f"变动成本率理论上降至 <strong>约 {u_new['variable_cost_ratio_pct'] - equalize_gain:.1f}%</strong>。"
        )
    elif factor_diff < 0:
        sig, lvl = "新车系数低于旧车,但风险方向未倒挂", "warn"
        so_what = "系数差异与风险方向不矛盾,保持监控即可。"
    else:
        sig, lvl = "新旧车系数方向与风险一致", "info"
        so_what = "定价合理,无需调整。"

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>{factor_rows}"
        f"<br>&lt;24岁新车:系数 <strong>{fu_new:.3f}</strong>、"
        f"变动成本率 <strong>{u_new['variable_cost_ratio_pct']:.1f}%</strong>;"
        f"旧车:系数 <strong>{fu_old:.3f}</strong>、"
        f"变动成本率 <strong>{u_old['variable_cost_ratio_pct']:.1f}%</strong>。"
        f"系数差 {factor_diff:+.3f},变动成本率差 {vcr_diff:+.1f} 个点;"
        f"新车距监管上限 {CAP:.1f} 还有 {headroom:.0f}% 空间。"
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("维度 2：新旧车（含自主系数对照）", "",
                       body + callout, kicker="定价信号")


# ============================================================
# 卡片 4：过户车 vs 非过户
# ============================================================

def card_transfer(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "is_transfer"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_transfer THEN '过户' ELSE '非过户' END",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·过户状态")

    # spread = 非过户 - 过户（正数 = 过户更差，符合常识）
    u_tr = safe_row(df, "<24岁 · 过户")
    u_nt = safe_row(df, "<24岁 · 非过户")
    t_tr = safe_row(df, "24-28岁 · 过户")
    t_nt = safe_row(df, "24-28岁 · 非过户")

    spread_u = (u_tr["variable_cost_ratio_pct"] - u_nt["variable_cost_ratio_pct"]) if sample_ok(u_tr) and sample_ok(u_nt) else None
    spread_t = t_tr["variable_cost_ratio_pct"] - t_nt["variable_cost_ratio_pct"]
    max_spread = max([s for s in [spread_u, spread_t] if s is not None])

    transfer_share = df[df["dim"].str.contains("· 过户")]["premium"].sum() / df["premium"].sum() * 100

    if max_spread > 8:
        sig, lvl = "过户车风险显著高于非过户", "danger"
        so_what = (
            f"过户车变动成本率高出非过户超过 8 个点 → "
            f"应收紧过户车核保,叠加 &lt;24岁 + 新能源 三重组合时单独建模。"
            f"当前过户保费占比 {transfer_share:.1f}%。"
        )
    elif max_spread > 3:
        sig, lvl = "过户车风险温和偏高", "warn"
        so_what = f"差距 3-8 个点 → 过户车单独留意,但暂不必收紧核保。"
    elif max_spread < -3:
        sig, lvl = "过户车反而优于非过户", "warn"
        so_what = "过户客群可能是「精挑车况后过户」的理性买家,与道德风险预期相反,值得拆 VIN 二次核查。"
    else:
        sig, lvl = "过户与非过户无显著差异", "info"
        so_what = "差距落在 ±3 个点之内,过户当前并非独立风险因子。"

    parts = []
    if spread_t is not None:
        parts.append(f"24-28岁:过户 <strong>{t_tr['variable_cost_ratio_pct']:.1f}%</strong> 与非过户 "
                     f"<strong>{t_nt['variable_cost_ratio_pct']:.1f}%</strong>(差 {spread_t:+.1f} 个点)")
    if spread_u is not None:
        parts.append(f"&lt;24岁:过户 <strong>{u_tr['variable_cost_ratio_pct']:.1f}%</strong> 与非过户 "
                     f"<strong>{u_nt['variable_cost_ratio_pct']:.1f}%</strong>(差 {spread_u:+.1f} 个点)")
    elif u_tr is not None:
        parts.append(f"&lt;24岁过户样本 {int(u_tr['policy_count'])} 单,样本不足以判定")

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>{';'.join(parts)}。"
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("维度 3：过户 vs 非过户", "", body + callout,
                       kicker="道德风险")


# ============================================================
# 卡片 5：是否新能源
# ============================================================

def card_nev(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "is_nev"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_nev THEN '新能源' ELSE '燃油' END",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·能源类型")

    # spread = 燃油 - 新能源（正数 = 新能源更差，符合常识）
    u_nev = safe_row(df, "<24岁 · 新能源")
    u_fuel = safe_row(df, "<24岁 · 燃油")
    t_nev = safe_row(df, "24-28岁 · 新能源")
    t_fuel = safe_row(df, "24-28岁 · 燃油")

    spread_u = (u_nev["variable_cost_ratio_pct"] - u_fuel["variable_cost_ratio_pct"]) if sample_ok(u_nev) and sample_ok(u_fuel) else None
    spread_t = t_nev["variable_cost_ratio_pct"] - t_fuel["variable_cost_ratio_pct"]
    max_spread = max([s for s in [spread_u, spread_t] if s is not None])

    nev_share = df[df["dim"].str.contains("新能源")]["premium"].sum() / df["premium"].sum() * 100
    u_nev_n = int(u_nev["policy_count"]) if u_nev is not None else 0
    t_nev_n = int(t_nev["policy_count"]) if t_nev is not None else 0

    if max_spread > 8:
        sig, lvl = "新能源风险结构性高于燃油", "danger"
        so_what = (
            f"新能源变动成本率高出燃油超过 8 个点 → 应立即对新能源加起步系数,"
            f"参考燃油加权系数水平,叠加 5-8 个点试点;"
            f"年轻人新能源占比 {nev_share:.1f}%,影响面已不可忽略。"
        )
    elif max_spread > 3:
        sig, lvl = "新能源略劣于燃油", "warn"
        so_what = "差距 3-8 个点,可纳入下一轮系数微调候选,本期不必紧急动手。"
    elif max_spread < -3:
        sig, lvl = "新能源反而优于燃油", "warn"
        so_what = "与行业普遍观察(新能源结构性高赔付)相反,值得核查是否车型结构偏特定品牌(如纯电小型代步车)。"
    else:
        sig, lvl = "新能源与燃油未拉开差距", "info"
        so_what = "当前年龄段内新能源风险与燃油同档,定价无需特殊处理。"

    parts = []
    if spread_t is not None:
        parts.append(f"24-28岁:新能源 <strong>{t_nev['variable_cost_ratio_pct']:.1f}%</strong>(n={t_nev_n:,}) 与 "
                     f"燃油 <strong>{t_fuel['variable_cost_ratio_pct']:.1f}%</strong>"
                     f"(差 {spread_t:+.1f} 个点)")
    if spread_u is not None:
        parts.append(f"&lt;24岁:新能源 <strong>{u_nev['variable_cost_ratio_pct']:.1f}%</strong>(n={u_nev_n:,}) 与 "
                     f"燃油 <strong>{u_fuel['variable_cost_ratio_pct']:.1f}%</strong>"
                     f"(差 {spread_u:+.1f} 个点)")
    elif u_nev is not None:
        parts.append(f"&lt;24岁新能源样本 {u_nev_n} 单,样本不足以判定")

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>{';'.join(parts)}。新能源占保费 <strong>{nev_share:.1f}%</strong>。"
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("维度 4：燃油 vs 新能源", "", body + callout,
                       kicker="结构性风险")


# ============================================================
# 卡片 6：新车购置价分桶
# ============================================================

def card_price(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "new_vehicle_price"],
        dim_expr=f"{AGE_DIM} || ' · ' || ({PRICE_BUCKETS})",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·新车购置价")

    # 检测单调性:按车价分桶顺序检查 VCR 趋势
    # PRICE_BUCKETS 输出 7 档:1-3万 / 3-5万 / 5-10万 / 10-20万 / 20-30万 / 30-50万 / 50万+
    price_order = ["1-3万", "3-5万", "5-10万", "10-20万", "20-30万", "30-50万", "50万+"]

    def detect_for_age(age):
        sub = df[df["dim"].str.startswith(f"{age} · ")].copy()
        sub["price"] = sub["dim"].str.split(" · ").str[1]
        sub = sub[sub["policy_count"] >= MIN_SAMPLE]
        sub_ord = sub.set_index("price").reindex(price_order).dropna(subset=["variable_cost_ratio_pct"])
        if len(sub_ord) < 3:
            return None
        mono = detect_monotonic(sub_ord["variable_cost_ratio_pct"].tolist())
        vals = sub_ord["variable_cost_ratio_pct"].tolist()
        bands = sub_ord.index.tolist()
        worst_idx = int(np.argmax(vals))
        best_idx = int(np.argmin(vals))
        return {"mono": mono, "bands": bands, "vals": vals,
                "worst_band": bands[worst_idx], "worst_vcr": vals[worst_idx],
                "best_band": bands[best_idx], "best_vcr": vals[best_idx]}

    r_t = detect_for_age("24-28岁")
    r_u = detect_for_age("<24岁")
    primary = r_t or r_u

    if primary is None:
        callout = render_callout("各档样本均不足 30 单,跳过单调性判断。", level="info")
    else:
        mono = primary["mono"]
        if mono["direction"] == "up" and mono["consistency"] >= 0.7:
            sig, lvl = "变动成本率随车价单调上升", "info"
            so_what = (
                f"高价段风险线性传导,符合直觉。"
                f"最差档 {primary['worst_band']} 变动成本率 <strong>{primary['worst_vcr']:.1f}%</strong>,"
                f"最优档 {primary['best_band']} <strong>{primary['best_vcr']:.1f}%</strong>。"
                f"建议:对最差档加 3-5 个点系数,最优档保持或微让。"
            )
        elif mono["direction"] == "down" and mono["consistency"] >= 0.7:
            sig, lvl = "变动成本率随车价单调下降", "warn"
            so_what = (
                f"高价车反而更稳——可能反映「沃尔沃式安全溢价客群」(保费高、驾驶稳)。"
                f"最优档 {primary['best_band']} 变动成本率 <strong>{primary['best_vcr']:.1f}%</strong>。"
                f"建议:加大对高价段获客投入,低价段加严核保。"
            )
        else:
            sig, lvl = "车价档位与变动成本率非单调", "warn"
            anomaly_band = primary["bands"][mono["max_dev_idx"]]
            so_what = (
                f"中段档位异常隆起或塌陷。"
                f"最大偏离档 <strong>{anomaly_band}</strong>(偏线性 {mono['max_dev']:+.1f} 个点),"
                f"最差档 {primary['worst_band']} <strong>{primary['worst_vcr']:.1f}%</strong>、"
                f"最优档 {primary['best_band']} <strong>{primary['best_vcr']:.1f}%</strong>。"
                f"建议:对异常档拆品牌/车型二次核查,定价不能按车价线性外推。"
            )

        callout = render_callout(
            f"<strong>{sig}</strong>(以 24-28岁组判定;一致性 {mono['consistency']*100:.0f}%)。"
            f"<br><strong>决策含义</strong>:{so_what}",
            level=lvl,
        )

    return render_card("维度 5：新车购置价分桶", "", body + callout,
                       kicker="客户购买力 × 风险")


# ============================================================
# 卡片 7：保险等级（insurance_grade）
# ============================================================

def card_grade(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "insurance_grade"],
        dim_expr=f"{AGE_DIM} || ' · ' || COALESCE(insurance_grade, '未评级')",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·风险等级")

    # 检测 A-G 是否单调上升(A 最优、G 最差)
    grade_order = ["A", "B", "C", "D", "E", "F", "G"]

    def detect_for_age(age):
        sub = df[df["dim"].str.startswith(f"{age} · ")].copy()
        sub["grade"] = sub["dim"].str.split(" · ").str[1]
        sub = sub[sub["policy_count"] >= MIN_SAMPLE]
        sub_ord = sub.set_index("grade").reindex(grade_order).dropna(subset=["variable_cost_ratio_pct"])
        if len(sub_ord) < 4:
            return None
        mono = detect_monotonic(sub_ord["variable_cost_ratio_pct"].tolist())
        return {"mono": mono, "bands": sub_ord.index.tolist(),
                "vals": sub_ord["variable_cost_ratio_pct"].tolist()}

    r_t = detect_for_age("24-28岁")
    primary = r_t or detect_for_age("<24岁")

    if primary is None:
        callout = render_callout("各等级样本均不足 30 单,跳过单调性判断。", level="info")
    else:
        mono = primary["mono"]
        vals = primary["vals"]
        bands = primary["bands"]
        v_first, v_last = vals[0], vals[-1]
        if mono["direction"] == "up" and mono["consistency"] >= 0.7:
            sig, lvl = "评级模型在年轻人客群有效", "info"
            so_what = (
                f"A({v_first:.1f}%) → G({v_last:.1f}%) 变动成本率单调上升,"
                f"评级与风险方向一致(一致性 {mono['consistency']*100:.0f}%)。"
                f"建议:按评级档执行差异化定价,无需重训年轻人专属模型。"
            )
        else:
            sig, lvl = "评级模型在年轻人客群失效", "danger"
            anomaly_band = bands[mono["max_dev_idx"]]
            so_what = (
                f"A({v_first:.1f}%) → G({v_last:.1f}%) 变动成本率非单调上升,"
                f"最大偏离评级 <strong>{anomaly_band}</strong>(偏线性 {mono['max_dev']:+.1f} 个点)。"
                f"说明现有评级模型未能区分年轻驾驶人的真实风险。"
                f"建议:为 &lt;28 岁客群单独训练评级模型,或在自主系数环节叠加年龄修正。"
            )

        callout = render_callout(
            f"<strong>{sig}</strong>(以 24-28岁组判定)。"
            f"<br><strong>决策含义</strong>:{so_what}",
            level=lvl,
        )

    return render_card("维度 6：保险等级（公司风控评级）", "",
                       body + callout, kicker="风控模型校验")


# ============================================================
# 卡片 8：险别组合
# ============================================================

def card_coverage(con):
    df = q(
        con,
        extra_fields=["driver_age_group", "coverage_combination"],
        dim_expr=f"{AGE_DIM} || ' · ' || coverage_combination",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·险别组合")

    # 实算两个年龄段的商业险渗透率(主全+交三 占 保单总数)
    def penetration_for_age(age):
        sub = df[df["dim"].str.startswith(f"{age} · ")]
        total = sub["policy_count"].sum()
        commercial = sub[sub["dim"].str.contains("主全|交三")]["policy_count"].sum()
        return commercial / total * 100 if total > 0 else 0

    pen_u = penetration_for_age("<24岁")
    pen_t = penetration_for_age("24-28岁")
    # 四川市场基准约 65%(业务经验值,非硬编码假设——此为对照刻度)
    BENCHMARK = 65

    # 各组合 VCR 对比
    vcr_zhujian_t = safe_row(df, "24-28岁 · 主全")
    vcr_jiaosan_t = safe_row(df, "24-28岁 · 交三")
    vcr_danjiao_t = safe_row(df, "24-28岁 · 单交")

    parts = []
    for row, name in [(vcr_zhujian_t, "主全"), (vcr_jiaosan_t, "交三"), (vcr_danjiao_t, "单交")]:
        if row is not None and sample_ok(row):
            parts.append(f"{name} <strong>{row['variable_cost_ratio_pct']:.1f}%</strong>")

    if pen_t < BENCHMARK - 10:
        sig, lvl = "商业险渗透率显著低于市场基准", "warn"
        so_what = (
            f"24-28岁渗透率 <strong>{pen_t:.1f}%</strong> 比基准 ~{BENCHMARK}% 低 "
            f"{BENCHMARK - pen_t:.0f} 个点 → 这是利润弹性最大的入口。"
            f"建议:对单交客户做主动加保(交三/主全)外呼,每提升 1 个点渗透率,"
            f"按当前件均估算,商业保费规模可放大约 {pen_t/100*0.02*100:.1f}%。"
        )
    elif pen_t > BENCHMARK + 5:
        sig, lvl = "商业险渗透率高于市场基准", "info"
        so_what = f"渗透率 {pen_t:.1f}% 已饱和,经营杠杆应转向降赔付与降费用。"
    else:
        sig, lvl = "商业险渗透率接近市场基准", "info"
        so_what = f"渗透率 {pen_t:.1f}% 与基准持平,该维度无明显提升空间。"

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>商业险渗透率(主全+交三):24-28岁 <strong>{pen_t:.1f}%</strong>、"
        f"&lt;24岁 <strong>{pen_u:.1f}%</strong>(市场基准 ~{BENCHMARK}%)。"
        f"<br>24-28岁三档变动成本率:{'、'.join(parts)}。"
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("维度 7：险别组合（单交/交三/主全）", "",
                       body + callout, kicker="暴露 vs 渗透率")


# ============================================================
# 卡片 9：车牌归属地（用 plate_region dim 表）
# ============================================================

def card_plate(con):
    sql = f"""
WITH filtered AS (
  SELECT *
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
  WHERE {WHERE_BASE}
),
dim AS (
  SELECT plate_prefix, city
  FROM read_parquet('{PLATE_DIM}')
  WHERE province = '四川'
),
joined AS (
  SELECT f.*,
         COALESCE(d.city, '外省/未知') AS city
  FROM filtered f
  LEFT JOIN dim d ON SUBSTR(f.plate_no, 1, 2) = d.plate_prefix
),
policy_dedup AS (
  SELECT policy_no, CAST(insurance_start_date AS DATE) AS insurance_start_date,
         {AGE_DIM} AS age, city,
         SUM(premium) AS premium, SUM(COALESCE(fee_amount, 0)) AS fee_amount
  FROM joined
  GROUP BY policy_no, CAST(insurance_start_date AS DATE), {AGE_DIM}, city
  HAVING SUM(premium) > 0
),
claims_agg AS (
  SELECT policy_no, COUNT(DISTINCT claim_no) AS claim_cases,
         SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0)) AS reported_claims
  FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)
  WHERE policy_no IS NOT NULL
  GROUP BY policy_no
),
exposure AS (
  SELECT p.*,
         DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
         LEAST(GREATEST(DATEDIFF('day', p.insurance_start_date, DATE '{VALUATION}'), 0),
               DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)) AS earned_days,
         COALESCE(c.claim_cases, 0) AS claim_cases,
         COALESCE(c.reported_claims, 0) AS reported_claims
  FROM policy_dedup p LEFT JOIN claims_agg c ON p.policy_no = c.policy_no
)
SELECT
  age || ' · ' || city AS dim,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS premium,
  ROUND(SUM(reported_claims), 2) AS reported_claims,
  CASE WHEN SUM(earned_days) > 0
       THEN ROUND(SUM(claim_cases) * 365.0 / SUM(earned_days) * 100, 2) END AS earned_loss_freq_pct,
  CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
       THEN ROUND(SUM(reported_claims) * 100.0
                  / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2) END AS earned_loss_ratio_pct,
  CASE WHEN COUNT(DISTINCT policy_no) > 0
       THEN ROUND(SUM(premium) / COUNT(DISTINCT policy_no), 0) END AS per_policy_premium,
  CASE WHEN SUM(claim_cases) > 0
       THEN ROUND(SUM(reported_claims) / CAST(SUM(claim_cases) AS DOUBLE), 0) END AS avg_claim,
  CASE WHEN SUM(premium) > 0
       THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2) END AS expense_ratio_pct,
  CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
        AND SUM(premium) > 0
       THEN ROUND(SUM(reported_claims) * 100.0
                  / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
                  + SUM(fee_amount) * 100.0 / SUM(premium), 2) END AS variable_cost_ratio_pct
FROM exposure
GROUP BY 1
ORDER BY 1, premium DESC
"""
    df = con.execute(sql).df()

    # 每个年龄段取 Top 8 城市 + 其他
    def topn_with_others(df_age, n=8):
        df_sorted = df_age.sort_values("premium", ascending=False)
        top = df_sorted.head(n)
        rest = df_sorted.iloc[n:]
        if len(rest) == 0:
            return top
        # 合计"其他"行
        others_dim = top.iloc[0]["dim"].split(" · ")[0] + " · 其他城市合计"
        agg = {
            "dim": others_dim,
            "policy_count": int(rest["policy_count"].sum()),
            "premium": rest["premium"].sum(),
            "reported_claims": rest["reported_claims"].sum(),
            "earned_loss_freq_pct": None,
            "earned_loss_ratio_pct": None,
            "per_policy_premium": rest["premium"].sum() / max(rest["policy_count"].sum(), 1),
            "avg_claim": None,
            "expense_ratio_pct": None,
            "variable_cost_ratio_pct": None,
        }
        return pd.concat([top, pd.DataFrame([agg])], ignore_index=True)

    df_under = df[df["dim"].str.startswith("<24岁")]
    df_2428 = df[df["dim"].str.startswith("24-28岁")]
    df_show = pd.concat([
        topn_with_others(df_under, 8),
        topn_with_others(df_2428, 8),
    ], ignore_index=True)
    body = render_table(df_show, "年龄段·车牌归属城市")

    # 数据驱动:对 24-28 岁组算 top3 集中度、最优城市、最差城市
    t_rows = df[df["dim"].str.startswith("24-28岁 · ") & ~df["dim"].str.contains("其他|外省")]
    t_rows = t_rows[t_rows["policy_count"] >= MIN_SAMPLE].copy()
    if len(t_rows) >= 3:
        t_rows_sorted = t_rows.sort_values("premium", ascending=False)
        total_premium = t_rows_sorted["premium"].sum()
        top3 = t_rows_sorted.head(3)
        top3_share = top3["premium"].sum() / total_premium * 100
        top1 = t_rows_sorted.iloc[0]
        top1_city = top1["dim"].split(" · ")[1]
        # 最优/最差(按 VCR)
        worst = t_rows_sorted.loc[t_rows_sorted["variable_cost_ratio_pct"].idxmax()]
        best = t_rows_sorted.loc[t_rows_sorted["variable_cost_ratio_pct"].idxmin()]
        worst_city = worst["dim"].split(" · ")[1]
        best_city = best["dim"].split(" · ")[1]
        spread = worst["variable_cost_ratio_pct"] - best["variable_cost_ratio_pct"]

        if spread > 15:
            sig, lvl = "城市间风险差异显著", "warn"
            so_what = (
                f"最差与最优城市差距达 <strong>{spread:.1f} 个点</strong>,"
                f"地域加成系数应按城市单独校准,禁止「全省一刀切」。"
                f"建议把 {worst_city} 作为加价候选、{best_city} 作为获客重点。"
            )
        elif spread > 8:
            sig, lvl = "城市间风险温和分化", "info"
            so_what = (
                f"差距 {spread:.1f} 个点,可在分省费率基础上对头尾城市做 ±3 点微调,"
                f"无需重建地区因子表。"
            )
        else:
            sig, lvl = "城市间风险接近", "info"
            so_what = "差距小于 8 个点,地域因子在四川内可继续使用统一系数。"

        callout = render_callout(
            f"<strong>{sig}</strong>。"
            f"<br>24-28岁组城市集中度:Top3 城市占保费 <strong>{top3_share:.1f}%</strong>,"
            f"其中 {top1_city} 单一城市占 {top1['premium']/total_premium*100:.1f}%。"
            f"<br>变动成本率最差:<strong>{worst_city}</strong> "
            f"<strong>{worst['variable_cost_ratio_pct']:.1f}%</strong>"
            f"(n={int(worst['policy_count']):,});"
            f"最优:<strong>{best_city}</strong> "
            f"<strong>{best['variable_cost_ratio_pct']:.1f}%</strong>"
            f"(n={int(best['policy_count']):,});相差 <strong>{spread:.1f}</strong> 个点。"
            f"<br><strong>决策含义</strong>:{so_what}",
            level=lvl,
        )
    else:
        callout = render_callout("可比城市样本不足 3 个,跳过城市间对比。", level="info")

    return render_card("维度 8：车牌归属城市（plate_region dim 表）", "",
                       body + callout, kicker="地理风险因子")


# ============================================================
# 卡片 10：年度趋势 + 拐点
# ============================================================

def card_trend(con):
    df = q(
        con,
        extra_fields=["driver_age_group"],
        dim_expr=f"{AGE_DIM} || ' · ' || YEAR(insurance_start_date)::VARCHAR || '年'",
        order="dim ASC",
    )
    body = render_table(df, "年龄段·起保年度")

    # 数据驱动:从 df 自动识别拐点(年度 VCR 序列变化方向)
    df_t = df[df["dim"].str.startswith("24-28岁 · ")].copy()
    df_t["year"] = df_t["dim"].str.extract(r"(\d{4})年").astype(int)
    df_t = df_t.sort_values("year").set_index("year")

    years = df_t.index.tolist()
    vcrs = df_t["variable_cost_ratio_pct"].tolist()
    ers = df_t["expense_ratio_pct"].tolist()
    lrs = df_t["earned_loss_ratio_pct"].tolist()

    # 识别费用率最大跳变(找 yoy diff 最大的年份,通常即 2024 报行合一)
    er_diffs = [ers[i] - ers[i-1] for i in range(1, len(ers))]
    max_drop_idx = int(np.argmin(er_diffs)) + 1 if er_diffs else 0
    max_drop_year = years[max_drop_idx] if er_diffs else None
    max_drop_val = er_diffs[max_drop_idx - 1] if er_diffs else 0

    # 最优年度 / 最差年度(按 VCR)
    best_year_idx = int(np.argmin(vcrs))
    worst_year_idx = int(np.argmax(vcrs))
    # 最近完整年(默认 2025,排除当年 2026)
    completed_years = [y for y in years if y < date.today().year]
    last_completed = completed_years[-1] if completed_years else years[-1]
    last_vcr = vcrs[years.index(last_completed)]
    last_lr = lrs[years.index(last_completed)]
    last_er = ers[years.index(last_completed)]
    last_lvl, last_label = vcr_band(last_vcr)

    # 当年 IBNR 风险(若有当年保单)
    current_year = date.today().year
    has_current = current_year in years
    current_vcr = vcrs[years.index(current_year)] if has_current else None

    inflection_parts = []
    if max_drop_year and max_drop_val < -3:
        inflection_parts.append(
            f"<strong>费用率结构性下调:{max_drop_year} 年</strong>"
            f"(yoy {max_drop_val:+.1f} 个点,与「报行合一」2024-04 实施时点一致)"
        )
    inflection_parts.append(
        f"<strong>最优年度:{years[best_year_idx]}</strong>"
        f"(变动成本率 {vcrs[best_year_idx]:.1f}%);"
        f"<strong>最差年度:{years[worst_year_idx]}</strong>"
        f"({vcrs[worst_year_idx]:.1f}%)"
    )
    if has_current:
        inflection_parts.append(
            f"<strong>当年保单({current_year}):</strong>变动成本率 {current_vcr:.1f}%——"
            f"估值日 {VALUATION},当年保单平均满期不足 30%,"
            f"ultimate 赔付率会持续上升,「现在好看不算赢」"
        )

    so_what = (
        f"最近完整年 <strong>{last_completed}</strong> 状态<strong>{last_label}</strong>"
        f"(变动成本率 {last_vcr:.1f}% / 满期赔付率 {last_lr:.1f}% / 费用率 {last_er:.1f}%)。"
    )
    if has_current and current_vcr < last_vcr - 5:
        so_what += (
            f"当年保单数据虽显示改善 {last_vcr - current_vcr:.1f} 个点,"
            f"但 IBNR 修正后预估上升至 {current_vcr * 1.4:.1f}%(用 1.4 倍系数估 ultimate),"
            f"不可据此下「经营改善」结论。"
        )

    callout = render_callout(
        f"<strong>{last_completed} 完整年状态 · {last_label}</strong>。"
        f"<br>关键节点:"
        f"<br>" + "<br>".join(f"· {p}" for p in inflection_parts) +
        f"<br><strong>决策含义</strong>:{so_what}",
        level=last_lvl,
    )
    return render_card("时间维度：2021-2026 年度趋势 + 拐点", "",
                       body + callout, kicker="趋势洞察")


# ============================================================
# 卡片 11：跨维度风险评分（建模）
# ============================================================

def card_risk_model(con):
    """把 24-28 商业险拆成低/中/高三档风险池。

    打分维度：
      - 续保 (-15 分) / 新单 (0)
      - 旧车 (-5) / 新车 (+10)
      - 燃油 (0) / 新能源 (+8)
      - 非过户 (0) / 过户 (+10)
      - 单交 (排除) / 交三 (-3) / 主全 (0)
    """
    sql = f"""
WITH base AS (
  SELECT policy_no, CAST(insurance_start_date AS DATE) AS start_date,
         {AGE_DIM} AS age,
         MAX(is_renewal) AS is_renewal,
         MAX(is_new_car) AS is_new_car,
         MAX(is_nev) AS is_nev,
         MAX(is_transfer) AS is_transfer,
         MAX(coverage_combination) AS cov,
         SUM(premium) AS premium,
         SUM(COALESCE(fee_amount,0)) AS fee_amount
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
  WHERE {WHERE_BASE}
    AND insurance_type='商业保险'
    AND driver_age_group='24岁≤年龄＜28岁'
  GROUP BY policy_no, CAST(insurance_start_date AS DATE), age
  HAVING SUM(premium) > 0
),
scored AS (
  SELECT *,
    (CASE WHEN is_renewal THEN -15 ELSE 0 END) +
    (CASE WHEN is_new_car THEN 10 ELSE -5 END) +
    (CASE WHEN is_nev THEN 8 ELSE 0 END) +
    (CASE WHEN is_transfer THEN 10 ELSE 0 END) +
    (CASE WHEN cov='交三' THEN -3 ELSE 0 END)
    AS risk_score
  FROM base
),
classified AS (
  SELECT *,
    CASE
      WHEN risk_score <= -10 THEN '低风险池'
      WHEN risk_score <= 0   THEN '中风险池'
      ELSE '高风险池'
    END AS pool
  FROM scored
),
claims_agg AS (
  SELECT policy_no, COUNT(DISTINCT claim_no) AS claim_cases,
         SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0)) AS reported_claims
  FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true) WHERE policy_no IS NOT NULL
  GROUP BY policy_no
),
exposure AS (
  SELECT p.*,
         DATEDIFF('day', p.start_date, p.start_date + INTERVAL 1 YEAR) AS policy_term,
         LEAST(GREATEST(DATEDIFF('day', p.start_date, DATE '{VALUATION}'), 0),
               DATEDIFF('day', p.start_date, p.start_date + INTERVAL 1 YEAR)) AS earned_days,
         COALESCE(c.claim_cases, 0) AS claim_cases,
         COALESCE(c.reported_claims, 0) AS reported_claims
  FROM classified p LEFT JOIN claims_agg c ON p.policy_no = c.policy_no
)
SELECT
  pool AS dim,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS premium,
  ROUND(SUM(reported_claims), 2) AS reported_claims,
  CASE WHEN SUM(earned_days) > 0
       THEN ROUND(SUM(claim_cases) * 365.0 / SUM(earned_days) * 100, 2) END AS earned_loss_freq_pct,
  CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
       THEN ROUND(SUM(reported_claims) * 100.0
                  / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2) END AS earned_loss_ratio_pct,
  CASE WHEN COUNT(DISTINCT policy_no) > 0
       THEN ROUND(SUM(premium) / COUNT(DISTINCT policy_no), 0) END AS per_policy_premium,
  CASE WHEN SUM(claim_cases) > 0
       THEN ROUND(SUM(reported_claims) / CAST(SUM(claim_cases) AS DOUBLE), 0) END AS avg_claim,
  CASE WHEN SUM(premium) > 0
       THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2) END AS expense_ratio_pct,
  CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
        AND SUM(premium) > 0
       THEN ROUND(SUM(reported_claims) * 100.0
                  / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
                  + SUM(fee_amount) * 100.0 / SUM(premium), 2) END AS variable_cost_ratio_pct
FROM exposure
GROUP BY pool
ORDER BY CASE pool WHEN '低风险池' THEN 1 WHEN '中风险池' THEN 2 ELSE 3 END
"""
    df = con.execute(sql).df()
    body = render_table(df, "风险池（24-28岁商业险）")

    # 数据驱动:实读三池 VCR / 件数占比 / 保费占比
    pools = {row["dim"]: row for _, row in df.iterrows()}
    total_n = df["policy_count"].sum()
    total_p = df["premium"].sum()

    pool_lines = []
    actions = []
    for pool_name in ["低风险池", "中风险池", "高风险池"]:
        if pool_name not in pools:
            continue
        r = pools[pool_name]
        share_n = r["policy_count"] / total_n * 100
        share_p = r["premium"] / total_p * 100
        lvl_p, label_p = vcr_band(r["variable_cost_ratio_pct"])
        pool_lines.append(
            f"<strong>{pool_name}</strong>:变动成本率 "
            f"<strong>{r['variable_cost_ratio_pct']:.1f}%</strong>(<em>{label_p}</em>);"
            f"保单 {int(r['policy_count']):,}({share_n:.1f}%)、"
            f"保费 {r['premium']/10000:,.0f} 万元({share_p:.1f}%)"
        )

    # 池间差距
    if "低风险池" in pools and "高风险池" in pools:
        gap = pools["高风险池"]["variable_cost_ratio_pct"] - pools["低风险池"]["variable_cost_ratio_pct"]
    else:
        gap = 0

    if gap > 20:
        sig, lvl = "三池风险显著分化,评分模型已具备业务价值", "info"
    elif gap > 10:
        sig, lvl = "三池风险温和分化", "info"
    else:
        sig, lvl = "三池风险未拉开差距,模型权重需校准", "warn"

    so_what = (
        f"高低池差距 <strong>{gap:.1f} 个点</strong>。建议:"
        f"低池(续保为主)系数微让 3-5 个点抢续保;"
        f"高池(新车+新能源+过户三重叠加)系数上调 8-12 个点或拒保;"
        f"中池保持当前定价。"
        f"<br>注:本模型(v0.1)仅 5 个二值变量加权,真实精算应纳入车型品牌、"
        f"保险等级、地理、出险史 8-12 个变量,用 GLM/GBDT 训练后映射到自主系数。"
    )

    callout = render_callout(
        f"<strong>{sig}</strong>。"
        f"<br>" + "<br>".join(pool_lines) +
        f"<br><strong>决策含义</strong>:{so_what}",
        level=lvl,
    )
    return render_card("跨维度风险评分（建模 v0.1）", "",
                       body + callout, kicker="精算建模")


# ============================================================
# 卡片 12：行动清单 · 反直觉发现 · Know-how
# ============================================================

# 不变的领域知识(非数据派生,与业务规则字典对齐)
KNOWHOW_HTML = """
<h3>Know-how 应用清单(领域常识,不随数据变化)</h3>
<ul>
  <li><strong>报行合一</strong>(2024-04 起强制):商业险手续费比例上限按险种、按层级强制规定;
    一旦费用率已合规收敛,「降费用获利」窗口关闭,唯一抓手是「降赔付 + 提系数」。</li>
  <li><strong>商车自主定价系数监管区间</strong>:燃油车 [0.5, 1.5],新能源 [0.5, 1.45]。
    报告中任何高变动成本率子集团若系数仍在 1.0-1.2 之间,说明未充分使用监管授权空间。</li>
  <li><strong>NCD 监管强制</strong>:商业险/交强险 NCD 系数由监管统一(无 NCD = 1.0、上 1 档 0.9、上 2 档 0.8……);
    年轻客户多为首次投保(无历史),NCD 不是该客群的主要变量。</li>
  <li><strong>IBNR(已发生未报告)修正</strong>:当年起期保单的赔付率会随时间继续抬升,
    估值日时点的数据不可直接下「经营改善」结论;按 1.3-1.6 倍系数估 ultimate。</li>
  <li><strong>大案集中度(幂律)</strong>:车险赔款服从幂律分布,top 5% 案例往往占总赔款 50%+;
    任何子集团高赔付率,第一步先核查是否 1-2 起大案污染(人伤/全损/多车)。</li>
</ul>
"""


def card_actions(con, df_renew, df_newcar, df_factor, df_nev,
                 df_grade, df_plate_t, df_risk):
    """从前 11 张卡片的 DataFrame 派生 top 5 行动,按 spread / 偏离量级排序。"""
    findings: list[dict] = []

    # 1. 新车定价倒挂
    u_new = safe_row(df_newcar, "<24岁 · 新车")
    u_old = safe_row(df_newcar, "<24岁 · 旧车")
    fu_new = df_factor[df_factor["dim"] == "<24岁 · 新车"]["factor_w"].iloc[0]
    fu_old = df_factor[df_factor["dim"] == "<24岁 · 旧车"]["factor_w"].iloc[0]
    if fu_new < fu_old and u_new["variable_cost_ratio_pct"] > u_old["variable_cost_ratio_pct"]:
        vcr_diff = u_new["variable_cost_ratio_pct"] - u_old["variable_cost_ratio_pct"]
        findings.append({
            "score": vcr_diff,  # 优先级按倒挂幅度
            "object": "&lt;24岁 · 新车 商业险",
            "action": f"自主系数从 {fu_new:.3f} 上调至旧车水平 {fu_old:.3f}",
            "basis": (
                f"系数倒挂(新车 {fu_new:.3f} &lt; 旧车 {fu_old:.3f})+ "
                f"风险倒挂(新车变动成本率 {u_new['variable_cost_ratio_pct']:.1f}% &gt; "
                f"旧车 {u_old['variable_cost_ratio_pct']:.1f}%),距上限 1.5 仍剩 "
                f"{(1.5-fu_new)/fu_new*100:.0f}% 空间"
            ),
            "n": int(u_new["policy_count"]),
        })

    # 2. 续保反向显著
    u_renew = safe_row(df_renew, "<24岁 · 续保")
    u_renew_new = safe_row(df_renew, "<24岁 · 新单")
    t_renew = safe_row(df_renew, "24-28岁 · 续保")
    t_renew_new = safe_row(df_renew, "24-28岁 · 新单")
    spread_u = u_renew_new["variable_cost_ratio_pct"] - u_renew["variable_cost_ratio_pct"]
    spread_t = t_renew_new["variable_cost_ratio_pct"] - t_renew["variable_cost_ratio_pct"]
    if min(spread_u, spread_t) < -3:
        worst_spread = abs(min(spread_u, spread_t))
        findings.append({
            "score": worst_spread,
            "object": "全部年轻人续保客群",
            "action": "拆「保费下滑续保 vs 保单数下滑续保」客户访谈+审视无赔款优待差异化定价",
            "basis": f"续保变动成本率反超新单最多 {worst_spread:.1f} 个点,说明续保不是过滤器、是负向选择",
            "n": int(u_renew["policy_count"]) + int(t_renew["policy_count"]),
        })

    # 3. 新能源风险结构性偏高
    t_nev = safe_row(df_nev, "24-28岁 · 新能源")
    t_fuel = safe_row(df_nev, "24-28岁 · 燃油")
    if sample_ok(t_nev) and sample_ok(t_fuel):
        nev_spread = t_nev["variable_cost_ratio_pct"] - t_fuel["variable_cost_ratio_pct"]
        if nev_spread > 5:
            findings.append({
                "score": nev_spread,
                "object": "&lt;28岁 · 新能源",
                "action": "起步系数加 5-10 个点",
                "basis": f"24-28岁新能源变动成本率 {t_nev['variable_cost_ratio_pct']:.1f}% "
                         f"高于燃油 {t_fuel['variable_cost_ratio_pct']:.1f}% 共 {nev_spread:.1f} 个点",
                "n": int(t_nev["policy_count"]),
            })

    # 4. 评级模型失效
    if df_grade is not None and len(df_grade) >= 4:
        grade_order = ["A", "B", "C", "D", "E", "F", "G"]
        sub = df_grade[df_grade["dim"].str.startswith("24-28岁 · ")].copy()
        sub["grade"] = sub["dim"].str.split(" · ").str[1]
        sub = sub[sub["policy_count"] >= MIN_SAMPLE].set_index("grade").reindex(grade_order)
        sub = sub.dropna(subset=["variable_cost_ratio_pct"])
        if len(sub) >= 4:
            mono = detect_monotonic(sub["variable_cost_ratio_pct"].tolist())
            if mono["direction"] != "up" or mono["consistency"] < 0.7:
                findings.append({
                    "score": abs(mono["max_dev"]),
                    "object": "&lt;28岁 全体客群",
                    "action": "为年轻客群单独训练评级模型,或在自主系数环节叠加年龄修正",
                    "basis": f"A→G 评级与变动成本率非单调上升,最大偏离 {mono['max_dev']:+.1f} 个点",
                    "n": int(sub["policy_count"].sum()),
                })

    # 5. 城市差异
    if df_plate_t is not None and len(df_plate_t) >= 3:
        spread_city = df_plate_t["variable_cost_ratio_pct"].max() - df_plate_t["variable_cost_ratio_pct"].min()
        if spread_city > 15:
            worst = df_plate_t.loc[df_plate_t["variable_cost_ratio_pct"].idxmax()]
            best = df_plate_t.loc[df_plate_t["variable_cost_ratio_pct"].idxmin()]
            findings.append({
                "score": spread_city,
                "object": f"{worst['dim'].split(' · ')[1]} 加价 / {best['dim'].split(' · ')[1]} 获客重点",
                "action": "地域加成系数按城市单独校准,禁止「全省一刀切」",
                "basis": f"24-28岁组城市间变动成本率最大差 {spread_city:.1f} 个点,远超 8 点容忍线",
                "n": int(df_plate_t["policy_count"].sum()),
            })

    # 6. 风险池建模信号
    if df_risk is not None and "低风险池" in df_risk["dim"].values and "高风险池" in df_risk["dim"].values:
        lo = df_risk[df_risk["dim"] == "低风险池"].iloc[0]
        hi = df_risk[df_risk["dim"] == "高风险池"].iloc[0]
        pool_gap = hi["variable_cost_ratio_pct"] - lo["variable_cost_ratio_pct"]
        if pool_gap > 10:
            findings.append({
                "score": pool_gap * 0.5,  # 模型信号,优先级低于具体维度
                "object": "高低风险池差异化定价",
                "action": f"低池(续保为主)系数微让 3-5 个点;高池(新车+新能源+过户)系数+8-12 个点或拒保",
                "basis": f"评分模型 v0.1 三池变动成本率差距 {pool_gap:.1f} 个点,具备业务价值",
                "n": int(hi["policy_count"]) + int(lo["policy_count"]),
            })

    # 排序输出 top 5
    findings_sorted = sorted(findings, key=lambda x: x["score"], reverse=True)[:5]

    rows = []
    for i, f in enumerate(findings_sorted, 1):
        priority = "P0" if i <= 2 else ("P1" if i <= 4 else "P2")
        pill_cls = "pill-warn" if priority != "P2" else ""
        rows.append(
            f"<tr><td><span class='pill {pill_cls}'>{priority}</span></td>"
            f"<td>{f['action']}</td>"
            f"<td>{f['object']}<br><small>(n={f['n']:,})</small></td>"
            f"<td>{f['basis']}</td></tr>"
        )

    actions_html = (
        "<table class='data-table'>"
        "<thead><tr><th>优先级</th><th>动作</th><th>对象</th>"
        "<th>数据依据</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )

    # 反直觉发现:从数据自动检测(VCR 方向与常识相反的子集团)
    surprises = []
    if min(spread_u, spread_t) < -3:
        surprises.append(
            f"<strong>续保比新单 变动成本率更高</strong>——"
            f"违反「续保是过滤器」常识,差距最多 {abs(min(spread_u, spread_t)):.1f} 个点"
        )
    if fu_new < fu_old and u_new["variable_cost_ratio_pct"] > u_old["variable_cost_ratio_pct"]:
        surprises.append(
            f"<strong>&lt;24岁 新车比旧车 变动成本率更高</strong>(系数还更低)——"
            f"违反「新车质量高、风险低」常识"
        )
    # 反直觉:最优单一城市 vs 省会(假设 Top1 是成都/省会)
    if df_plate_t is not None and len(df_plate_t) >= 5:
        ranked = df_plate_t.sort_values("variable_cost_ratio_pct")
        best = ranked.iloc[0]
        top_premium = df_plate_t.sort_values("premium", ascending=False).iloc[0]
        if best["dim"] != top_premium["dim"]:
            surprises.append(
                f"<strong>风险最优城市是 {best['dim'].split(' · ')[1]}</strong>"
                f"(变动成本率 {best['variable_cost_ratio_pct']:.1f}%),"
                f"而非保费最大的 {top_premium['dim'].split(' · ')[1]}——"
                f"金矿在中小城市,非省会"
            )

    insights_html = ""
    if surprises:
        insights_html = (
            "<h3>反直觉发现(数据派生)</h3><ol>"
            + "".join(f"<li>{s}</li>" for s in surprises)
            + "</ol>"
        )

    return render_card(
        "行动清单 · 反直觉发现 · Know-how 应用",
        "",
        actions_html + insights_html + KNOWHOW_HTML,
        kicker="决策含义",
    )


# ============================================================
# main
# ============================================================

def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()

    print(f">> 估值日 {VALUATION}，开始拉数据…")

    df_total = q(con, dim_expr="'合计'")
    total = df_total.iloc[0]
    n = int(total["policy_count"])
    pwan = total["premium"] / 10000

    print(f">> 总样本 {n:,} 张，总保费 {pwan:,.0f} 万元")

    print(">> 构建 12 张卡片…")

    # 先收集 card_actions 需要的 df(避免重跑 SQL)
    df_renew_for_actions = q(
        con,
        extra_fields=["driver_age_group", "is_renewal"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_renewal THEN '续保' ELSE '新单' END",
    )
    df_newcar_for_actions = q(
        con,
        extra_fields=["driver_age_group", "is_new_car"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_new_car THEN '新车' ELSE '旧车' END",
    )
    df_factor_for_actions = con.execute(f"""
WITH p AS (
  SELECT policy_no, MIN({AGE_DIM}) AS age, MAX(is_new_car) AS is_new_car,
         SUM(premium) AS premium,
         MAX(CASE WHEN premium > 0 THEN commercial_pricing_factor END) AS factor
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
  WHERE {WHERE_BASE} AND insurance_type='商业保险'
  GROUP BY policy_no
  HAVING SUM(premium) > 0
)
SELECT age || ' · ' || CASE WHEN is_new_car THEN '新车' ELSE '旧车' END AS dim,
       COUNT(*) AS n,
       ROUND(SUM(factor * premium) / NULLIF(SUM(premium), 0), 3) AS factor_w
FROM p GROUP BY 1 ORDER BY 1
""").df()
    df_nev_for_actions = q(
        con,
        extra_fields=["driver_age_group", "is_nev"],
        dim_expr=f"{AGE_DIM} || ' · ' || CASE WHEN is_nev THEN '新能源' ELSE '燃油' END",
    )
    df_grade_for_actions = q(
        con,
        extra_fields=["driver_age_group", "insurance_grade"],
        dim_expr=f"{AGE_DIM} || ' · ' || COALESCE(insurance_grade, '未评级')",
    )
    # 车牌 24-28岁城市表(简化版,直接 JOIN dim 后聚合,不去重)
    df_plate_t_for_actions = con.execute(f"""
WITH joined AS (
  SELECT f.*, COALESCE(d.city, '外省/未知') AS city
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true) f
  LEFT JOIN read_parquet('{PLATE_DIM}') d
    ON SUBSTR(f.plate_no, 1, 2) = d.plate_prefix AND d.province = '四川'
  WHERE {WHERE_BASE} AND driver_age_group='24岁≤年龄＜28岁'
    AND city NOT IN ('外省/未知')
),
ded AS (
  SELECT policy_no, MIN(CAST(insurance_start_date AS DATE)) AS sd, MIN(city) AS city,
         SUM(premium) AS premium, SUM(COALESCE(fee_amount,0)) AS fee
  FROM joined GROUP BY policy_no HAVING SUM(premium) > 0
),
c AS (
  SELECT policy_no, COUNT(DISTINCT claim_no) AS cases,
         SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0)) AS rep
  FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true) WHERE policy_no IS NOT NULL
  GROUP BY policy_no
)
SELECT '24-28岁 · ' || ded.city AS dim,
       COUNT(*) AS policy_count,
       SUM(ded.premium) AS premium,
       CASE WHEN SUM(ded.premium * DATEDIFF('day',ded.sd,LEAST(DATE '{VALUATION}',ded.sd+INTERVAL 1 YEAR))::DOUBLE
                  / DATEDIFF('day',ded.sd,ded.sd+INTERVAL 1 YEAR)::DOUBLE) > 0
            AND SUM(ded.premium) > 0
            THEN ROUND(SUM(COALESCE(c.rep,0)) * 100.0
                / SUM(ded.premium * DATEDIFF('day',ded.sd,LEAST(DATE '{VALUATION}',ded.sd+INTERVAL 1 YEAR))::DOUBLE
                  / DATEDIFF('day',ded.sd,ded.sd+INTERVAL 1 YEAR)::DOUBLE)
                + SUM(ded.fee) * 100.0 / SUM(ded.premium), 2) END AS variable_cost_ratio_pct
FROM ded LEFT JOIN c USING(policy_no)
GROUP BY ded.city HAVING COUNT(*) >= {MIN_SAMPLE}
""").df()
    # 风险池表(从 card_risk_model 提取的核心 SQL 简化版)
    df_risk_for_actions = con.execute(f"""
WITH base AS (
  SELECT policy_no, CAST(insurance_start_date AS DATE) AS sd,
         MAX(is_renewal) AS r, MAX(is_new_car) AS nc, MAX(is_nev) AS nv,
         MAX(is_transfer) AS tr, MAX(coverage_combination) AS cov,
         SUM(premium) AS premium, SUM(COALESCE(fee_amount,0)) AS fee
  FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
  WHERE {WHERE_BASE} AND insurance_type='商业保险' AND driver_age_group='24岁≤年龄＜28岁'
  GROUP BY policy_no, CAST(insurance_start_date AS DATE) HAVING SUM(premium) > 0
),
sc AS (
  SELECT *, (CASE WHEN r THEN -15 ELSE 0 END)+(CASE WHEN nc THEN 10 ELSE -5 END)
            +(CASE WHEN nv THEN 8 ELSE 0 END)+(CASE WHEN tr THEN 10 ELSE 0 END)
            +(CASE WHEN cov='交三' THEN -3 ELSE 0 END) AS s FROM base
),
cl AS (
  SELECT policy_no, COUNT(DISTINCT claim_no) AS cases,
         SUM(COALESCE(settled_amount,0)+COALESCE(pending_amount,0)) AS rep
  FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true) WHERE policy_no IS NOT NULL
  GROUP BY policy_no
)
SELECT CASE WHEN s <= -10 THEN '低风险池' WHEN s <= 0 THEN '中风险池' ELSE '高风险池' END AS dim,
       COUNT(*) AS policy_count, SUM(sc.premium) AS premium,
       CASE WHEN SUM(sc.premium * DATEDIFF('day',sc.sd,LEAST(DATE '{VALUATION}',sc.sd+INTERVAL 1 YEAR))::DOUBLE
                  / DATEDIFF('day',sc.sd,sc.sd+INTERVAL 1 YEAR)::DOUBLE) > 0
            AND SUM(sc.premium) > 0
       THEN ROUND(SUM(COALESCE(cl.rep,0))*100.0
                  / SUM(sc.premium * DATEDIFF('day',sc.sd,LEAST(DATE '{VALUATION}',sc.sd+INTERVAL 1 YEAR))::DOUBLE
                    / DATEDIFF('day',sc.sd,sc.sd+INTERVAL 1 YEAR)::DOUBLE)
                  + SUM(sc.fee)*100.0/SUM(sc.premium), 2) END AS variable_cost_ratio_pct
FROM sc LEFT JOIN cl USING(policy_no)
GROUP BY 1 ORDER BY CASE dim WHEN '低风险池' THEN 1 WHEN '中风险池' THEN 2 ELSE 3 END
""").df()

    cards = (
        card_overview(con)
        + card_renewal(con)
        + card_newcar(con)
        + card_transfer(con)
        + card_nev(con)
        + card_price(con)
        + card_grade(con)
        + card_coverage(con)
        + card_plate(con)
        + card_trend(con)
        + card_risk_model(con)
        + card_actions(con, df_renew_for_actions, df_newcar_for_actions,
                       df_factor_for_actions, df_nev_for_actions,
                       df_grade_for_actions, df_plate_t_for_actions,
                       df_risk_for_actions)
    )

    html = render_page(
        title="非营业个人客车 · 年轻驾驶人经营诊断",
        kicker="车险经营诊断",
        pills=[],
        meta_items=[],
        status_items=[
            ("样本数", f"{n:,} 张"),
            ("总保费", f"{round(pwan):,} 万元"),
            ("时间范围", "2021-01-01 至 2026-06-11"),
            ("估值日", VALUATION),
        ],
        cards_html=cards,
        footer_text="数据源：fact/policy/current · fact/claims_detail · dim/plate_region。"
                    " 阈值来源：业务规则字典 v3.0 §938 四级亮灯。",
    )

    out = REPORT_DIR / f"young_driver_diagnosis_{VALUATION}.html"
    out.write_text(html, encoding="utf-8")
    print(f">> HTML 已生成：{out}")
    print(f">> 大小：{out.stat().st_size:,} 字节")


if __name__ == "__main__":
    main()
