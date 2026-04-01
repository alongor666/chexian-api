#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 9: 诊断总结 — 亮灯 + 关键发现 + 建议下一步

依赖板块 1/2/3/4 的产出数据，若 collected 中缺失则自动静默补全。
产出结构化 findings/next_steps/year_summary 供 --output-json 使用。
"""

from diagnose_common import GLOB, kpi_select, fw, fp


def _ensure_dep(ctx, rpt, collected, section_id):
    """确保依赖板块已执行，缺失则静默补全"""
    if section_id not in collected:
        from sections import SECTION_REGISTRY
        SECTION_REGISTRY[section_id].run(ctx, rpt, collected, silent=True)


def _add_finding(result, findings, level, tag, text):
    """同时追加结构化 finding 和 Markdown 文本"""
    result["findings"].append({"level": level, "tag": tag, "text": text})
    findings.append(f"{level} **{tag}**：{text}")


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years

    # 确保依赖
    _ensure_dep(ctx, rpt, collected, 1)
    _ensure_dep(ctx, rpt, collected, 2)
    _ensure_dep(ctx, rpt, collected, 3)
    _ensure_dep(ctx, rpt, collected, 4)

    yr_data = collected[1]["yr_data"]
    vt_data = collected[2]["vt_data"]
    vt_names = collected[2]["vt_names"]
    en_data = collected[3]["en_data"]
    gr_data = collected[4]["gr_data"]
    grade_names = collected[4]["grade_names"]

    result = {"findings": [], "next_steps": [], "year_summary": []}
    collected[9] = result

    # 年度总结（始终计算，silent 模式也需要）
    for yr in years:
        d = yr_data.get(yr, {})
        lr = d.get("loss_ratio") or 0
        fr = d.get("expense_ratio") or 0
        vc = lr + fr
        em = d.get("earned_margin") or 0
        pm = d.get("projected_margin") or 0
        ir = d.get("incident_rate") or 0
        light = "🔴" if vc > 94 else "🟡" if vc > 91 else "🔵" if vc > 85 else "🟢"
        result["year_summary"].append({
            "year": yr, "variable_cost_rate": round(vc, 1), "light": light,
            "earned_margin_wan": round(em, 1), "projected_margin_wan": round(pm, 1),
            "loss_ratio": round(lr, 1), "incident_rate": round(ir, 1),
            "expense_ratio": round(fr, 1),
        })

    # 关键发现规则引擎（始终计算）
    findings = []

    # ---- 边际贡献趋势 ----
    if len(years) >= 2:
        first_d = yr_data.get(years[0], {})
        last_d = yr_data.get(years[-1], {})
        first_em = first_d.get("earned_margin") or 0
        last_em = last_d.get("earned_margin") or 0
        if last_em < 0 and first_em > 0:
            _add_finding(result, findings, "🔴", "边际贡献转负",
                         f"从{years[0]}年{first_em:,.1f}万恶化至{years[-1]}年{last_em:,.1f}万，整体亏损")
        elif last_em < first_em * 0.5 and first_em > 0:
            _add_finding(result, findings, "🟡", "边际贡献萎缩",
                         f"从{years[0]}年{first_em:,.1f}万降至{years[-1]}年{last_em:,.1f}万")

    # ---- 件均保费下降 ----
    if len(years) >= 2:
        first_d = yr_data.get(years[0], {})
        last_d = yr_data.get(years[-1], {})
        first_ap = first_d.get("avg_premium") or 0
        last_ap = last_d.get("avg_premium") or 0
        if first_ap > 0 and last_ap > 0:
            drop_pct = (last_ap - first_ap) / first_ap * 100
            if drop_pct < -15:
                _add_finding(result, findings, "🔴", "件均保费持续下滑",
                             f"{first_ap:,d}元→{last_ap:,d}元（{drop_pct:+.1f}%），定价空间被压缩")
            elif drop_pct < -5:
                _add_finding(result, findings, "🟡", "件均保费下降",
                             f"{first_ap:,d}元→{last_ap:,d}元（{drop_pct:+.1f}%）")

        # ---- 赔付率恶化 ----
        first_lr = first_d.get("loss_ratio") or 0
        last_lr = last_d.get("loss_ratio") or 0
        if last_lr - first_lr > 15:
            _add_finding(result, findings, "🔴", "赔付率显著恶化",
                         f"{first_lr:.1f}%→{last_lr:.1f}%（+{last_lr - first_lr:.1f}pp）")

    # ---- 转保占比 ----
    transfer_d = vt_data.get("旧车转保", {})
    total_pol = sum((d.get("policy_count") or 0) for d in vt_data.values())
    transfer_pol = transfer_d.get("policy_count") or 0
    transfer_pct = transfer_pol / total_pol * 100 if total_pol > 0 else 0
    if transfer_pct > 50:
        transfer_lr = transfer_d.get("loss_ratio") or 0
        _add_finding(result, findings, "🔴", "转保占比过高",
                     f"{transfer_pol:,d}单（{transfer_pct:.0f}%），赔付率{transfer_lr:.1f}%——逆选择风险高")
    elif transfer_pct > 35:
        _add_finding(result, findings, "🟡", "转保占比较高",
                     f"{transfer_pol:,d}单（{transfer_pct:.0f}%），需关注风险质量")

    # ---- 新车亏损 ----
    new_d = vt_data.get("新车", {})
    new_lr = new_d.get("loss_ratio") or 0
    new_em = new_d.get("earned_margin") or 0
    if new_lr > 100 and new_em < -50:
        _add_finding(result, findings, "🔴", "新车业务亏损",
                     f"赔付率{new_lr:.1f}%，满期边际{new_em:,.1f}万")

    # ---- 风险评分覆盖率 ----
    no_grade_d = gr_data.get("无评分", {})
    no_grade_pol = no_grade_d.get("policy_count") or 0
    total_grade_pol = sum((d.get("policy_count") or 0) for d in gr_data.values())
    no_grade_pct = no_grade_pol / total_grade_pol * 100 if total_grade_pol > 0 else 0
    if no_grade_pct > 60:
        _add_finding(result, findings, "🟡", "风险评分覆盖不足",
                     f"{no_grade_pol:,d}单（{no_grade_pct:.0f}%）无评分，精准定价受限")

    # ---- 新能源亏损 ----
    nev_d = en_data.get("新能源", {})
    nev_lr = nev_d.get("loss_ratio") or 0
    nev_pol = nev_d.get("policy_count") or 0
    if nev_lr > 90:
        _add_finding(result, findings, "🟡", "新能源车亏损",
                     f"{nev_pol:,d}单，赔付率{nev_lr:.1f}%，出险率远高于燃油车")

    # ---- 费用率波动 ----
    if len(years) >= 3:
        frs = [(yr_data.get(y, {}).get("expense_ratio") or 0) for y in years]
        fr_range = max(frs) - min(frs)
        if fr_range > 8:
            _add_finding(result, findings, "🟡", "费用率波动大",
                         f"{min(frs):.1f}%~{max(frs):.1f}%（波幅{fr_range:.1f}pp），管控不稳定")

    # 建议下一步
    next_steps = []
    if transfer_pct > 50:
        next_steps.append("按经代/渠道拆分转保来源，识别高赔付经代")
    if no_grade_pct > 60:
        next_steps.append("提升风险评分覆盖率，优先对转保业务做风险分级")
    if nev_lr > 90:
        next_steps.append("单独出新能源诊断（按品牌/车型细分），制定差异化定价")
    if len(years) >= 2:
        last_d = yr_data.get(years[-1], {})
        first_d = yr_data.get(years[0], {})
        if (last_d.get("expense_ratio") or 0) > (first_d.get("expense_ratio") or 0) + 3:
            next_steps.append("按渠道/经代拆分费用率，定位费用失控环节")

    suggestions = con.execute(f"""
    SELECT COUNT(DISTINCT 三级机构), COUNT(DISTINCT 业务员), COUNT(DISTINCT 经代名)
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where}
    """).fetchone()
    if suggestions[2] > 3:
        next_steps.append(f"按经代公司（{suggestions[2]}个）拆分对比变动成本率")
    if suggestions[1] > 10:
        next_steps.append(f"Top 业务员（{suggestions[1]}人）产能和质量排名")
    if not next_steps:
        next_steps.append("各项指标稳定，可按季度持续监控")

    result["next_steps"] = next_steps

    if silent:
        return result

    # ---- Markdown 输出 ----
    rpt.add("## 9. 诊断总结\n")

    for ys in result["year_summary"]:
        rpt.add(f"- {ys['light']} {ys['year']}年 变动成本率 {ys['variable_cost_rate']:.1f}%，"
                f"满期边际 {ys['earned_margin_wan']:,.1f} 万，预估边际 {ys['projected_margin_wan']:,.1f} 万")
        if ys["loss_ratio"] > 75:
            rpt.add(f"  - 满期赔付率 {ys['loss_ratio']:.1f}%")
        if ys["incident_rate"] > 12:
            rpt.add(f"  - 满期出险率 {ys['incident_rate']:.1f}%")
    rpt.add()

    rpt.add("### 关键发现\n")
    if findings:
        for item in findings:
            rpt.add(f"- {item}")
    else:
        rpt.add("- 🟢 各项指标在合理范围内，未发现重大异常")
    rpt.add()

    rpt.add("**新转续过户**：")
    for vt in vt_names:
        d = vt_data.get(vt, {})
        p = d.get("written_premium") or 0
        lr = d.get("loss_ratio") or 0
        em = d.get("earned_margin") or 0
        vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
        rpt.add(f"- {vt}：保费 {p:,.1f} 万，赔付率 {lr:.1f}%，变动成本率 {vc:.1f}%，边际 {em:,.1f} 万")
    rpt.add()

    rpt.add("**风险评分**：")
    for g in grade_names:
        d = gr_data.get(g, {})
        p = d.get("written_premium") or 0
        if p > 0:
            lr = d.get("loss_ratio") or 0
            vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
            rpt.add(f"- 等级{g}：保费 {p:,.1f} 万，赔付率 {lr:.1f}%，变动成本率 {vc:.1f}%")
    rpt.add()

    rpt.add("### 建议下一步\n")
    for s in next_steps:
        rpt.add(f"- {s}")
    rpt.add()

    return result
