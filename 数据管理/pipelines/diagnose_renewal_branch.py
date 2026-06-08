#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 分公司视角子报告（diagnose_renewal.py --branch-report 的实现模块）

面向分公司管理者的 7 张三级机构窗口对照表（以数据截止日当天所在月/年为窗口）：
  一、当月已到期续保表   到期日 ≤ 数据截止日（已成熟，续保率亮灯；9 列含未报价/流失/续保影响度）
  二、临期 7 天续保表    数据截止日后 7 天内到期（未到期·临期进度，续保率不亮灯；9 列同表一，结论用进度措辞）
  三、当月未到期续保表   到期日 > 数据截止日（续保率反映进度，不亮灯）
  四、当月续保表         当月全部（= 一 + 二未涵盖部分，按到期窗口）
  五、当年已到期续保表   年初 ~ 数据截止日已到期（截至最新日期成熟口径，续保率亮灯，不被未来未到期件稀释）
  六、当月首日续保情况   可续期首日 = 到期前 30 天当天（四川规则，例 6/1）累计报价/续回响应
  七、当月首周续保情况   可续期首周 = 到期前 30~24 天（含首日，例 6/1~6/7）累计报价/续回响应

口径单一事实源：数据源（RT）、应续=去重车架号、可续期锚点、亮灯阈值、率值聚合（rate）、
渲染（Report/fp/light_q/light_r）全部从 renewal_common 复用，本模块不重复定义，避免口径漂移。

已续回 = is_renewed（ETL convert_renewal_tracker.py:187：匹配到续保单号 renewed_policy_no 即已签单成交）。
renewed_date 是续保单保险起期（=原保单到期次日，ETL line 114），非签单时点，不参与「已续回」判断 ——
未到期保单已签单但起保日在未来仍属已续回。前后端口径一致（renewal-tracker.ts 已续回 C 指标同样直接用 is_renewed）。

首日/首周续保率口径 A（用户 2026-06-06 确认 + 2026-06-07 四川规则细化）：续回数 = 首日/首周窗口内
「已报价 且 已续回（is_renewed）」的件数 ÷ 应续件数。首日 = 可续期首日（到期前 30 天当天，例 6/1）截至该日累计已报价；
首周 = 可续期首周（到期前 30~24 天，例 6/1~6/7，含首日）截至首周末累计已报价。因续保成交日恒为到期前后（无提前成交信号），
不以续保日切片，而衡量「响应速度的成交转化」。

每张表在自己窗口内按车架号去重（与主报告单窗口口径一致），跨月重复车架号（年内约 1099 个）
在各自到期窗口分别计入，避免被「年表 MIN 去重」误归月份。
"""

import sys
from calendar import monthrange
from datetime import date

# 共享口径/渲染原语单一来源：从 renewal_common（依赖叶子）导入，避免反向依赖主文件与 __main__ 双导入
from renewal_common import (
    MATURED_GLOSSARY,
    RT,
    SMALL_ORG_SALESMEN,
    TARGET_MATURED_RENEWAL_RATE,
    Report,
    customer_category_clause,
    customer_category_label,
    fp,
    funnel_derived,
    impact_rate,
    light_q,
    light_r,
    rate,
)


def _month_bounds(d: date):
    """返回 d 所在自然月的 (首日, 末日)。"""
    return d.replace(day=1), d.replace(day=monthrange(d.year, d.month)[1])


def _win_dedup_cte(win_sql, pool_lead, dim_col="org_level_3"):
    """窗口内按车架号去重的 CTE 前缀（末 CTE 名 f，分组维度统一输出别名 dim）。

    先按窗口过滤 raw，再按车架号去重（MAX 报价/续回、MIN 到期/首次报价），最后算可续期锚点首日/首周标记。
    每个窗口独立去重 —— 与主报告单窗口「应续=去重车架号」口径一致，跨月重复车架号在各自到期窗口分别计入。
    已续回口径（renewed）已在 raw 表注入（is_renewed = 已签单成交，含起保日在未来的提前续保），此处仅 MAX 聚合。

    dim_col = 分组维度列（分公司视角 org_level_3 / 三级机构视角 salesman_name）；下游 section 统一读别名 dim，
    维度无关，故 7 张表的取数 / 去重 / 锚点口径在两种视角间完全一致（单一事实源）。
    """
    anchor = f"CAST(expiry_date AS DATE) - {pool_lead}"
    return f"""
    WITH w AS (
      SELECT vehicle_frame_no, ANY_VALUE({dim_col}) AS dim,
             MIN(expiry_date) AS expiry_date, MAX(quoted) AS quoted, MAX(renewed) AS renewed, MIN(fqt) AS fqt
      FROM raw WHERE {win_sql} GROUP BY vehicle_frame_no
    ),
    f AS (
      SELECT dim, quoted, renewed,
             -- 首日 = 可续期首日（到期前 pool_lead 天当天，例 6/30 到期 → 6/1）：截至首日累计已报价
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1q,
             -- 首周 = 可续期首周（到期前 pool_lead~(pool_lead-6) 天，例 6/1~6/7，含首日）：截至首周末累计已报价
             -- 用户 2026-06-07 澄清：24~30 天、含首日、不用「进盘」措辞 → 即原递进口径（首日⊂首周，单调递增）
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1q,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1r,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1r
      FROM w
    )"""


def _branch_matured_section(con, rpt, num, title, win_sql, pool_lead, note, *,
                            kind="matured", subject="本月已到期客户",
                            dim_col="org_level_3", dim_header="三级机构",
                            dim_noun="机构", scope_noun="整体分公司",
                            unit_noun="家", keep_dims=None):
    """9 列缺口分解表（表一「当月已到期」+ 临期 7 天表共用）。

    在基础漏斗上按 renewal_common 注册口径派生 未报价 / 流失 / 续保影响度，按「续保影响度从高至低」排序。
    续保影响度 = 流失件数 ÷ 合计应续件数（先聚合后计算，可加和至整体续保缺口）。
    表头用简称（去「件数」）；口径定义沉到报告末尾附录，正文不夹带口径解释。

    kind 决定语义与结论措辞（领域铁律：未到期窗口「流失」非真流失）：
      · 'matured'（已到期·成熟）：续保率亮灯 + 对标 TARGET_MATURED_RENEWAL_RATE 目标 + 「已流失」措辞；
      · 'approaching'（临期·未到期·进度）：续保率不亮灯 + 不套目标 + 「尚未续回 / 紧急冲刺」诚实措辞。
    subject = 结论主语（如「6 月已到期客户」/「未来 7 天将到期客户」）。

    维度参数（默认 = 分公司视角 · 三级机构，行为逐字节不变）：
      · dim_col   分组列（org_level_3 / salesman_name）；dim_header 表头全称；dim_noun 结论简称；
      · scope_noun 合计范围名词（「导致 X 流失」）；unit_noun 前三量词（机构「家」/ 业务员「名」）；
      · keep_dims 仅展示这批维度值（None = 全展示）。续保影响度分母 tot_* 恒按全部维度行计 ——
        三级机构视角合计 = 该机构全部业务员真实整体，展示的 top10 各项之和 < 合计。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead, dim_col) + """
        SELECT dim, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM f WHERE dim IS NOT NULL
        GROUP BY 1
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return

    # 先聚合：合计应续件数 = 续保影响度的统一分母（什么分类就按什么合计；恒按全部维度 = 真实整体）
    tot_yc = sum(yc for _, yc, _, _ in rows)
    enriched = []
    for org, yc, q, r in rows:
        q, r = q or 0, r or 0
        d = funnel_derived(yc, q, r)
        enriched.append({
            "org": org, "yc": yc, "q": q, "r": r,
            "unquoted": d["unquoted"], "lost": d["lost"],
            "impact": impact_rate(d["lost"], tot_yc),
            "qr": rate(q, yc), "rr": rate(r, yc),
        })
    # 续保影响度从高至低（同分母下等价于流失件数降序）
    enriched.sort(key=lambda e: e["lost"], reverse=True)

    # 合计永远按全部维度行（真实整体）；展示行按 keep_dims 过滤（None = 全展示，分公司视角）
    tot_q = sum(e["q"] for e in enriched)
    tot_r = sum(e["r"] for e in enriched)
    tot_unq = sum(e["unquoted"] for e in enriched)
    tot_lost = sum(e["lost"] for e in enriched)
    shown = [e for e in enriched if e["org"] in keep_dims] if keep_dims is not None else enriched

    trows = []
    for e in shown:
        # 临期（approaching）续保率是进度，不亮灯（红色会被误读为危险；实为尚未到期）
        rr_cell = f"{fp(e['rr'])}{light_r(e['rr'])}" if kind == "matured" else fp(e["rr"])
        trows.append([
            e["org"], f"{e['yc']:,}", f"{e['q']:,}", f"{e['r']:,}",
            f"{e['unquoted']:,}", f"{e['lost']:,}", fp(e["impact"]),
            f"{fp(e['qr'])}{light_q(e['qr'])}", rr_cell,
        ])
    qr_t, rr_t, imp_t = rate(tot_q, tot_yc), rate(tot_r, tot_yc), impact_rate(tot_lost, tot_yc)
    trows.append([
        "**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**",
        f"**{tot_unq:,}**", f"**{tot_lost:,}**", f"**{fp(imp_t)}**",
        f"**{fp(qr_t)}**", f"**{fp(rr_t)}**",
    ])

    # 结论数据：top3 / by_unq 取展示集（shown）—— 与表格所列一致；
    # 分母 tot_* 恒为真实整体，故三级机构视角「前三业务员」指展示的 top10 中影响度前三。
    top3 = shown[:3]  # shown 随 enriched 已按续保影响度降序
    imp_str = "、".join(f"{e['org']}（{fp(e['impact'])}）" for e in top3)
    top3_sum = impact_rate(sum(e["lost"] for e in top3), tot_yc)
    by_unq = sorted(shown, key=lambda e: e["unquoted"], reverse=True)[:3]
    unq_str = "、".join(f"{e['org']}（{e['unquoted']:,}）" for e in by_unq)
    unq_drag = impact_rate(tot_unq, tot_yc)

    # === 布局（用户 2026-06-07）：结论先行（做判断·问题导向）→ 表格 → 备注 ===
    if kind == "matured":
        gap = round(TARGET_MATURED_RENEWAL_RATE - (rr_t or 0), 1)
        rpt.add(f"**问题一 · 续保率缺口**：{subject}续保率 {fp(rr_t)}，"
                f"低于 {TARGET_MATURED_RENEWAL_RATE}% 的目标 {gap} 个百分点。"
                f"续保影响度前三的{dim_noun}分别是 {imp_str}，"
                f"三{unit_noun}合计导致{scope_noun}流失 {fp(top3_sum)} 的客户。")
        rpt.add()
        rpt.add(f"**问题二 · 未报价即流失**：{subject}报价率仅 {fp(qr_t)}，"
                f"仍有 {tot_unq:,} 户至今未报价、已流失，直接拉低续保率 {fp(unq_drag)}"
                f"（{tot_unq:,} ÷ {tot_yc:,}）。未报价客户数前三{dim_noun}是 {unq_str}。")
    else:  # approaching：临期·未到期·进度口径，诚实措辞（不说「已流失」）
        rpt.add(f"**问题一 · 临期续保进度**：{subject}共 {tot_yc:,} 户、当前续保率仅 {fp(rr_t)}"
                f"（未到期·临期进度，仍在续保动作窗口内，将随到期临近补齐）。"
                f"续保影响度（按当前尚未续回进度）前三的{dim_noun}分别是 {imp_str}，"
                f"三{unit_noun}合计 {fp(top3_sum)} 的临期客户尚未续回，是最需紧急冲刺的盘子。")
        rpt.add()
        rpt.add(f"**问题二 · 临期未报价风险**：{subject}报价率仅 {fp(qr_t)}，"
                f"仍有 {tot_unq:,} 户至今未报价——距到期已不足 7 天、转化时间极短，"
                f"是流失风险最高的紧急派单对象（占应续 {fp(unq_drag)}）。未报价客户数前三{dim_noun}是 {unq_str}。")
    rpt.add()
    rpt.table(
        [dim_header, "应续", "已报价", "已续保", "未报价", "流失",
         "续保影响度", "报价率", "续保率"],
        trows, ["---", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:"],
    )
    # 备注（口径说明）置于表格之后；表一指标完整口径见报告末尾附录。
    rpt.add(f"> {note}")
    rpt.add()


def _branch_funnel_section(con, rpt, num, title, win_sql, pool_lead, mature, note="",
                           dim_col="org_level_3", dim_header="三级机构", keep_dims=None):
    """三级机构 / 业务员续保漏斗表（应续 / 已报价 / 已续保 / 报价率 / 续保率，表头用简称）。

    mature=True 表示窗口已成熟（到期日 ≤ 数据截止日），续保率即最终留存 → 亮灯；
    mature=False 表示窗口含未到期件，续保率反映进度 → 不亮灯，结论注明属进度。
    维度参数同 _branch_matured_section：合计恒按全部维度（真实整体），展示按 keep_dims 过滤（None = 全展示）。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead, dim_col) + """
        SELECT dim, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM f WHERE dim IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return
    # 合计恒按全部维度行（真实整体）；展示行按 keep_dims 过滤（rows 已按应续降序，过滤保序）
    tot_yc = sum(yc for _, yc, _, _ in rows)
    tot_q = sum((q or 0) for _, _, q, _ in rows)
    tot_r = sum((r or 0) for _, _, _, r in rows)
    shown = [r for r in rows if r[0] in keep_dims] if keep_dims is not None else rows
    trows = []
    for org, yc, q, r in shown:
        q, r = q or 0, r or 0
        qr, rr = rate(q, yc), rate(r, yc)
        rr_cell = f"{fp(rr)}{light_r(rr)}" if mature else fp(rr)
        trows.append([org, f"{yc:,}", f"{q:,}", f"{r:,}", f"{fp(qr)}{light_q(qr)}", rr_cell])
    qr_t, rr_t = rate(tot_q, tot_yc), rate(tot_r, tot_yc)
    trows.append(["**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**", f"**{fp(qr_t)}**", f"**{fp(rr_t)}**"])

    # === 布局：结论先行（做判断·问题导向）→ 表格 → 备注 ===
    # 结论点名最大短板（续保率最低）+ 经营杠杆攻坚点（盘子最大者），便于直接派活。
    rated = [(o, rate(r, yc)) for o, yc, q, r in shown if yc]
    rated = [(o, v) for o, v in rated if v is not None]
    if shown and rated:
        big = shown[0]  # rows 按应续降序、过滤保序 → 展示集盘子最大者
        big_rr = rate(big[3] or 0, big[1])
        hi, lo = max(rated, key=lambda x: x[1]), min(rated, key=lambda x: x[1])
        prog = "（进度）" if not mature else ""
        rpt.concl(
            f"合计应续 {tot_yc:,} 件、续保率 {fp(rr_t)}{prog}、报价率 {fp(qr_t)}。"
            f"最大短板 **{lo[0]}（续保率 {fp(lo[1])}）**、明显落后于标杆 {hi[0]}（{fp(hi[1])}），是首要补强对象；"
            f"盘子最大的 **{big[0]}（{big[1]:,} 件）**续保率仅 {fp(big_rr)}，经营杠杆最大、最该集中攻坚。")
    rpt.table([dim_header, "应续", "已报价", "已续保", "报价率", "续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    if note:
        rpt.add(f"> {note}")
        rpt.add()


def _branch_speed_section(con, rpt, num, title, prefix, qcol, rcol, win_sql, pool_lead, note,
                          dim_col="org_level_3", dim_header="三级机构", keep_dims=None):
    """三级机构 / 业务员首日/首周可续期响应速度表（无亮灯，速度子指标）。

    口径 A（用户 2026-06-06 确认）：{prefix}续回数 = 可续期{prefix}内已报价 且 最终续回的件数；
    {prefix}续保率 = {prefix}续回数 ÷ 应续件数。衡量快速响应客户的最终成交转化。
    维度参数同上：合计恒按全部维度（真实整体），展示按 keep_dims 过滤（None = 全展示）。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead, dim_col) + f"""
        SELECT dim, COUNT(*) yc, SUM({qcol}) sq, SUM({rcol}) sr
        FROM f WHERE dim IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return
    # 合计恒按全部维度行（真实整体）；展示行按 keep_dims 过滤
    tot_yc = sum(yc for _, yc, _, _ in rows)
    tot_q = sum((sq or 0) for _, _, sq, _ in rows)
    tot_r = sum((sr or 0) for _, _, _, sr in rows)
    shown = [r for r in rows if r[0] in keep_dims] if keep_dims is not None else rows
    trows = []
    for org, yc, sq, sr in shown:
        sq, sr = sq or 0, sr or 0
        trows.append([org, f"{yc:,}", f"{sq:,}", f"{sr:,}", fp(rate(sq, yc)), fp(rate(sr, yc))])
    trows.append(["**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**",
                  f"**{fp(rate(tot_q, tot_yc))}**", f"**{fp(rate(tot_r, tot_yc))}**"])

    # === 布局：结论先行（做判断·问题导向）→ 表格 → 备注 ===
    # 速度表点名响应最慢者（快速响应转化最弱）为提速首要对象，便于直接派活。
    rated = [(o, rate(sr, yc)) for o, yc, sq, sr in shown if yc]
    rated = [(o, v) for o, v in rated if v is not None]
    if rated:
        hi, lo = max(rated, key=lambda x: x[1]), min(rated, key=lambda x: x[1])
        rpt.concl(
            f"合计{prefix}续保率 {fp(rate(tot_r, tot_yc))}、{prefix}报价率 {fp(rate(tot_q, tot_yc))}。"
            f"{prefix}响应最快 **{hi[0]}（{fp(hi[1])}）**、最慢 **{lo[0]}（{fp(lo[1])}）**——"
            f"{lo[0]}快速响应转化最弱，是{prefix}提速的首要对象。")
    else:
        rpt.concl(f"合计{prefix}续保率 {fp(rate(tot_r, tot_yc))}、{prefix}报价率 {fp(rate(tot_q, tot_yc))}。")
    rpt.table([dim_header, "应续", f"{prefix}报价数", f"{prefix}续回数", f"{prefix}报价率", f"{prefix}续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    rpt.add(f"> {note}")
    rpt.add()


def run_branch_report(con, args, out_dir, ts):
    """分公司视角：7 张三级机构窗口表（当月已到期/临期7天/未到期/当月/当年已到期 + 首日/首周可续期响应）。"""
    today = date.today()
    pool_lead = args.pool_lead_days
    m_start, m_end = _month_bounds(today)
    y_start, y_end = date(today.year, 1, 1), date(today.year, 12, 31)

    where = [f"expiry_date >= DATE '{y_start}'", f"expiry_date <= DATE '{y_end}'"]
    if args.org:
        where.append(f"org_level_3 ILIKE '%{args.org}%'")
    if args.team:
        where.append(f"team_name ILIKE '%{args.team}%'")
    cc_clause = customer_category_clause(getattr(args, "customer_category", None))
    if cc_clause:
        where.append(cc_clause)
    where_sql = " AND ".join(where)

    # 原始年表（不去重）：各窗口在自己范围内按车架号去重，避免跨月重复车架号（年内 1099 个）被 MIN 误归月份
    # 已续回 = is_renewed（ETL：匹配到续保单号即已签单成交）；renewed_date 是起保日（=原保单到期次日）非签单时点，
    # 不参与「已续回」判断 —— 未到期保单已签单但起保日在未来仍属已续回。前后端口径一致（renewal-tracker.ts is_renewed）。
    con.execute(f"""
        CREATE TEMP TABLE raw AS
        SELECT vehicle_frame_no, org_level_3, expiry_date,
               is_quoted::INT AS quoted, is_renewed::INT AS renewed, first_quote_time AS fqt
        FROM read_parquet('{RT}')
        WHERE {where_sql}
    """)
    if not con.execute("SELECT COUNT(*) FROM raw").fetchone()[0]:
        sys.exit(f"❌ {today.year} 年无应续数据（检查 renewal_tracker expiry 覆盖范围）")

    scope = ""
    if args.org:
        scope += f" · 机构「{args.org}」"
    if args.team:
        scope += f" · 团队「{args.team}」"
    cc_label = customer_category_label(getattr(args, "customer_category", None))
    if cc_label:
        scope += f" · 客户类别「{cc_label}」"

    rpt = Report()
    rpt.add(f"# 续保诊断 · 分公司视角 · {today.year}年{today.month}月{scope}")
    rpt.add()
    rpt.add(f"> **数据截止日** {today} · **当月** [{m_start} ~ {m_end}] · **当年** [{y_start} ~ {y_end}] · **口径** 商业险 · 应续 = 去重车架号")
    rpt.add(f"> **可续期锚点（四川规则）** 可续期窗口 = 到期前 {pool_lead} 天起；首日 = 到期前 {pool_lead} 天当天（例 6/30 到期 → 6/1）、首周 = 到期前 {pool_lead}~{pool_lead - 6} 天即首日起 7 天（含首日，例 6/1 ~ 6/7）。其他省按实际可续期规则调整 `--pool-lead-days`。")
    rpt.add(f"> **生成** `diagnose_renewal.py --branch-report` · {ts}")
    rpt.add()
    rpt.add("> 7 张三级机构窗口表：①当月已到期 ②临期 7 天 ③当月未到期 ④当月 ⑤当年已到期 续保漏斗；⑥首日 ⑦首周 可续期响应速度。"
            "①已到期、⑤当年已到期续保率为已成熟的最终留存；②临期、③④含未到期，续保率反映**进度**"
            "（数据截止日早于到期日，未到期件尚未进入续保动作）。")
    rpt.add(">")
    rpt.add("> **已续回口径**：已签单续保（is_renewed，已匹配到续保单号）即计入，与前端续保追踪页面一致。"
            "未到期保单若已提前签单续保（新保单起保日在未来）同样计入已续回 —— ②临期、③当月未到期表续保率反映"
            "**已提前锁定的续保进度**，随到期临近逐月补齐；其报价率体现盘子是否已提前铺开。")
    rpt.add()

    _branch_matured_section(con, rpt, "一", "当月已到期续保表",
                            f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{today}'", pool_lead,
                            note=f"当月已到期（到期日 ≤ 数据截止日 {today}）保单 —— 续保率已成熟，是最接近最终留存的信号。",
                            kind="matured", subject=f"{today.month} 月已到期客户")
    _branch_matured_section(con, rpt, "二", "临期 7 天续保表",
                            f"expiry_date > DATE '{today}' AND expiry_date <= DATE '{today}' + 7", pool_lead,
                            note=f"未来 7 天将到期（{today} 之后 7 天内到期）保单 —— **未到期·临期盘子**，续保率/流失为进度口径"
                                 f"（含仍在续保动作窗口内尚未续的），非最终留存；字段与表一一致，重在锁定最紧急的派单与冲刺对象。",
                            kind="approaching", subject="未来 7 天将到期客户")
    _branch_funnel_section(con, rpt, "三", "当月未到期续保表",
                           f"expiry_date > DATE '{today}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月尚未到期保单 —— 续保率反映进度，随到期临近补齐，重点看报价率是否已提前铺开。")
    _branch_funnel_section(con, rpt, "四", "当月续保表",
                           f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月全部应续（已到期 + 未到期）—— 续保率含未到期属进度。")
    _branch_funnel_section(con, rpt, "五", "当年已到期续保表",
                           f"expiry_date >= DATE '{y_start}' AND expiry_date <= DATE '{today}'", pool_lead, mature=True,
                           note=f"当年已到期（年初 ~ 数据截止日 {today}）保单 —— 只取截至最新日期已成熟部分，续保率即最终留存，不被未来未到期件稀释（与已到期口径一致）。")
    _branch_speed_section(con, rpt, "六", "当月首日续保情况", "首日", "d1q", "d1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘**首日**（四川规则：到期前 {pool_lead} 天当天，例 6/30 到期 → 6/1）响应：首日报价数 = 截至首日已报价；首日续回数 = 其中最终续回（口径 A）。")
    _branch_speed_section(con, rpt, "七", "当月首周续保情况", "首周", "w1q", "w1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘**首周**（四川规则：到期前 {pool_lead}~{pool_lead - 6} 天，即可续期首日起 7 天、含首日，例 6/1 ~ 6/7）响应：首周报价数 = 截至首周末累计已报价；首周续回数 = 其中最终续回（口径 A）。")

    # 附录：表一派生指标口径定义统一沉到报告末尾（正文不夹带口径解释，只讲业务结论）。
    # 单一事实源 = renewal_common.MATURED_GLOSSARY，防同名异算漂移。
    rpt.add("## 附录 · 表一指标口径")
    rpt.add()
    rpt.add("> 「当月已到期续保表」派生指标定义，防口径漂移；单一事实源 = `renewal_common.MATURED_GLOSSARY`。"
            "表头用简称，下表「指标」列为完整口径名（简称 = 去「件数」）。")
    rpt.add()
    rpt.table(["指标", "含义", "计算逻辑"],
              [[n, d, c] for n, d, c in MATURED_GLOSSARY], ["---", "---", "---"])

    md_path = out_dir / f"续保分公司视角_{today.year}年{today.month:02d}月_{ts}.md"
    md_path.write_text(rpt.text(), encoding="utf-8")
    print(f"✅ 分公司视角报告 → {md_path}")
    return md_path


def _top_n_salesmen(con, win_sql, pool_lead, n):
    """按指定窗口的应续件数（去重车架号）降序，取前 n 名业务员，返回名单 set。

    选取基准与展示解耦：本函数仅按「当月应续」选定固定 top10，各窗口表统一展示这同一批人，
    便于横向追踪同一业务员在已到期 / 临期 / 未到期 / 首日 / 首周各窗口的表现。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead, "salesman_name") + f"""
        SELECT dim, COUNT(*) yc FROM f WHERE dim IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT {int(n)}
    """).fetchall()
    return {r[0] for r in rows}


def run_org_report(con, args, out_dir, ts):
    """三级机构视角（模板）：锁定单一三级机构（--org 必填），7 张窗口表按业务员分组。

    与分公司视角（run_branch_report）共用同一套 section 函数与 7 张窗口口径（单一事实源），仅两点不同：
      · scope 锁定单一三级机构（--org 必填），分组维度 三级机构 → 业务员；
      · 7 张表统一展示「当月应续 top10」固定同一批业务员（便于跨窗口追踪同一业务员），
        合计行 = 该机构全部业务员的真实整体（top10 各项之和 < 合计）。
    本模式定位为三级机构续保诊断模板（用户 2026-06-07）。
    """
    if not args.org:
        sys.exit("❌ --org-report 模式需 --org 指定一个三级机构（如 --org 高新）")
    today = date.today()
    pool_lead = args.pool_lead_days
    m_start, m_end = _month_bounds(today)
    y_start, y_end = date(today.year, 1, 1), date(today.year, 12, 31)
    top_n = SMALL_ORG_SALESMEN  # = 10，与小机构阈值同源（renewal_common），避免散落魔数

    where = [f"expiry_date >= DATE '{y_start}'", f"expiry_date <= DATE '{y_end}'",
             f"org_level_3 ILIKE '%{args.org}%'"]
    if args.team:
        where.append(f"team_name ILIKE '%{args.team}%'")
    cc_clause = customer_category_clause(getattr(args, "customer_category", None))
    if cc_clause:
        where.append(cc_clause)
    where_sql = " AND ".join(where)

    # 原始年表（含 salesman_name 维度列）：各窗口在自己范围内按车架号去重，口径与分公司视角一致。
    con.execute(f"""
        CREATE TEMP TABLE raw AS
        SELECT vehicle_frame_no, org_level_3,
               -- 业务员去数字编码（用户 2026-06-07）：姓名只保留中文，去掉前缀工号数字（如 200045244李晓琴 → 李晓琴）。
               -- 在 raw 层清洗 → top10 选取 / 表格展示 / 合计计数全程一致用去数字名。
               REGEXP_REPLACE(salesman_name, '[0-9]', '', 'g') AS salesman_name, expiry_date,
               is_quoted::INT AS quoted, is_renewed::INT AS renewed, first_quote_time AS fqt
        FROM read_parquet('{RT}')
        WHERE {where_sql}
    """)
    if not con.execute("SELECT COUNT(*) FROM raw").fetchone()[0]:
        sys.exit(f"❌ {today.year} 年机构「{args.org}」无应续数据（检查 --org 名称与 renewal_tracker 覆盖范围）")

    # ILIKE 模糊匹配可能命中多个三级机构 —— 落定实际机构名集合用于标题/文件名
    org_names = [r[0] for r in con.execute(
        "SELECT DISTINCT org_level_3 FROM raw WHERE org_level_3 IS NOT NULL ORDER BY 1").fetchall()]
    org_label = "、".join(org_names) if org_names else args.org

    # 固定 top10 业务员：按「当月应续」（去重车架号）降序选定，7 张表统一展示这同一批人
    keep = _top_n_salesmen(con, f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead, top_n)
    if not keep:
        sys.exit(f"❌ 机构「{args.org}」当月（{m_start}~{m_end}）无应续业务员，无法选 top{top_n}")
    sm_total = con.execute(
        "SELECT COUNT(DISTINCT salesman_name) FROM raw WHERE salesman_name IS NOT NULL").fetchone()[0]

    cc_label = customer_category_label(getattr(args, "customer_category", None))
    cc_suffix = f" · 客户类别「{cc_label}」" if cc_label else ""

    rpt = Report()
    rpt.add(f"# 续保诊断 · 三级机构视角 · {org_label} · {today.year}年{today.month}月{cc_suffix}")
    rpt.add()
    rpt.add(f"> **数据截止日** {today} · **当月** [{m_start} ~ {m_end}] · **当年** [{y_start} ~ {y_end}] · **口径** 商业险 · 应续件数 = 去重车架号")
    rpt.add(f"> **可续期锚点（四川规则）** 可续期窗口 = 到期前 {pool_lead} 天起；首日 = 到期前 {pool_lead} 天当天（例 6/30 到期 → 6/1）、首周 = 到期前 {pool_lead}~{pool_lead - 6} 天即首日起 7 天（含首日，例 6/1 ~ 6/7）。其他省按实际可续期规则调整 `--pool-lead-days`。")
    rpt.add(f"> **业务员口径** 7 张表统一展示「当月应续 top{top_n}」固定同一批业务员（按当月 [{m_start}~{m_end}] 应续去重车架号降序选定），便于横向追踪同一业务员在各窗口的表现。")
    rpt.add(f"> **合计行 = {org_label}全部 {sm_total} 名业务员的真实整体**，故所列 top{top_n} 各项之和 < 合计（其余 {sm_total - len(keep)} 名业务员计入合计、未单列）。续保影响度分母亦为该真实整体合计应续。")
    rpt.add(f"> **生成** `diagnose_renewal.py --org-report --org {args.org}` · {ts}")
    rpt.add()
    rpt.add(f"> 7 张业务员窗口表：①当月已到期 ②临期 7 天 ③当月未到期 ④当月 ⑤当年已到期 续保漏斗；⑥首日 ⑦首周 可续期响应速度。"
            "①已到期、⑤当年已到期续保率为已成熟的最终留存；②临期、③④含未到期，续保率反映**进度**"
            "（数据截止日早于到期日，未到期件尚未进入续保动作）。")
    rpt.add(">")
    rpt.add("> **已续回口径**：已签单续保（is_renewed，已匹配到续保单号）即计入，与前端续保追踪页面一致。"
            "未到期保单若已提前签单续保（新保单起保日在未来）同样计入已续回 —— ②临期、③当月未到期表续保率反映"
            "**已提前锁定的续保进度**，随到期临近逐月补齐；其报价率体现盘子是否已提前铺开。")
    rpt.add()

    dim_kw = dict(dim_col="salesman_name", dim_header="top10业务员", keep_dims=keep)
    matured_kw = dict(dim_noun="业务员", scope_noun=f"{org_label}整体", unit_noun="名", **dim_kw)
    _branch_matured_section(con, rpt, "一", "当月已到期续保表",
                            f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{today}'", pool_lead,
                            note=f"当月已到期（到期日 ≤ 数据截止日 {today}）保单 —— 续保率已成熟，是最接近最终留存的信号。所列为当月应续 top{top_n} 业务员，按续保影响度降序。",
                            kind="matured", subject=f"{today.month} 月已到期客户", **matured_kw)
    _branch_matured_section(con, rpt, "二", "临期 7 天续保表",
                            f"expiry_date > DATE '{today}' AND expiry_date <= DATE '{today}' + 7", pool_lead,
                            note=f"未来 7 天将到期（{today} 之后 7 天内到期）保单 —— **未到期·临期盘子**，续保率/流失为进度口径"
                                 f"（含仍在续保动作窗口内尚未续的），非最终留存；字段与表一一致，重在锁定最紧急的派单与冲刺对象。",
                            kind="approaching", subject="未来 7 天将到期客户", **matured_kw)
    _branch_funnel_section(con, rpt, "三", "当月未到期续保表",
                           f"expiry_date > DATE '{today}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月尚未到期保单 —— 续保率反映进度，随到期临近补齐，重点看报价率是否已提前铺开。", **dim_kw)
    _branch_funnel_section(con, rpt, "四", "当月续保表",
                           f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月全部应续（已到期 + 未到期）—— 续保率含未到期属进度。", **dim_kw)
    _branch_funnel_section(con, rpt, "五", "当年已到期续保表",
                           f"expiry_date >= DATE '{y_start}' AND expiry_date <= DATE '{today}'", pool_lead, mature=True,
                           note=f"当年已到期（年初 ~ 数据截止日 {today}）保单 —— 只取截至最新日期已成熟部分，续保率即最终留存，不被未来未到期件稀释（与已到期口径一致）。", **dim_kw)
    _branch_speed_section(con, rpt, "六", "当月首日续保情况", "首日", "d1q", "d1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘**首日**（四川规则：到期前 {pool_lead} 天当天，例 6/30 到期 → 6/1）响应：首日报价数 = 截至首日已报价；首日续回数 = 其中最终续回（口径 A）。", **dim_kw)
    _branch_speed_section(con, rpt, "七", "当月首周续保情况", "首周", "w1q", "w1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘**首周**（四川规则：到期前 {pool_lead}~{pool_lead - 6} 天，即可续期首日起 7 天、含首日，例 6/1 ~ 6/7）响应：首周报价数 = 截至首周末累计已报价；首周续回数 = 其中最终续回（口径 A）。", **dim_kw)

    # 附录：表一派生指标口径定义统一沉到报告末尾（与分公司视角共用，单一事实源 = MATURED_GLOSSARY）
    rpt.add("## 附录 · 表一指标口径")
    rpt.add()
    rpt.add("> 「当月已到期续保表」派生指标定义，防口径漂移；单一事实源 = `renewal_common.MATURED_GLOSSARY`。"
            "表头用简称，下表「指标」列为完整口径名（简称 = 去「件数」）。")
    rpt.add()
    rpt.table(["指标", "含义", "计算逻辑"],
              [[n, d, c] for n, d, c in MATURED_GLOSSARY], ["---", "---", "---"])

    safe_org = org_names[0] if len(org_names) == 1 else args.org
    md_path = out_dir / f"续保三级机构视角_{safe_org}_{today.year}年{today.month:02d}月_{ts}.md"
    md_path.write_text(rpt.text(), encoding="utf-8")
    print(f"✅ 三级机构视角报告 → {md_path}")
    return md_path
