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
    TARGET_MATURED_RENEWAL_RATE,
    Report,
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


def _win_dedup_cte(win_sql, pool_lead):
    """窗口内按车架号去重的 CTE 前缀（末 CTE 名 f）。

    先按窗口过滤 raw，再按车架号去重（MAX 报价/续回、MIN 到期/首次报价），最后算可续期锚点首日/首周标记。
    每个窗口独立去重 —— 与主报告单窗口「应续=去重车架号」口径一致，跨月重复车架号在各自到期窗口分别计入。
    已续回口径（renewed）已在 raw 表注入（is_renewed = 已签单成交，含起保日在未来的提前续保），此处仅 MAX 聚合。
    """
    anchor = f"CAST(expiry_date AS DATE) - {pool_lead}"
    return f"""
    WITH w AS (
      SELECT vehicle_frame_no, ANY_VALUE(org_level_3) AS org_level_3,
             MIN(expiry_date) AS expiry_date, MAX(quoted) AS quoted, MAX(renewed) AS renewed, MIN(fqt) AS fqt
      FROM raw WHERE {win_sql} GROUP BY vehicle_frame_no
    ),
    f AS (
      SELECT org_level_3, quoted, renewed,
             -- 首日 = 可续期首日（到期前 pool_lead 天当天，例 6/30 到期 → 6/1）：截至首日累计已报价
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1q,
             -- 首周 = 可续期首周（到期前 pool_lead~(pool_lead-6) 天，例 6/1~6/7，含首日）：截至首周末累计已报价
             -- 用户 2026-06-07 澄清：24~30 天、含首日、不用「进盘」措辞 → 即原递进口径（首日⊂首周，单调递增）
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1q,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1r,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1r
      FROM w
    )"""


def _branch_matured_section(con, rpt, num, title, win_sql, pool_lead, note, *, kind="matured", subject="本月已到期客户"):
    """9 列缺口分解表（表一「当月已到期」+ 临期 7 天表共用）。

    在基础漏斗上按 renewal_common 注册口径派生 未报价 / 流失 / 续保影响度，按「续保影响度从高至低」排序。
    续保影响度 = 流失件数 ÷ 合计应续件数（先聚合后计算，可加和至整体续保缺口）。
    表头用简称（去「件数」）；口径定义沉到报告末尾附录，正文不夹带口径解释。

    kind 决定语义与结论措辞（领域铁律：未到期窗口「流失」非真流失）：
      · 'matured'（已到期·成熟）：续保率亮灯 + 对标 TARGET_MATURED_RENEWAL_RATE 目标 + 「已流失」措辞；
      · 'approaching'（临期·未到期·进度）：续保率不亮灯 + 不套目标 + 「尚未续回 / 紧急冲刺」诚实措辞。
    subject = 结论主语（如「6 月已到期客户」/「未来 7 天将到期客户」）。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead) + """
        SELECT org_level_3, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM f WHERE org_level_3 IS NOT NULL
        GROUP BY 1
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    rpt.add(f"> {note}")
    rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return

    # 先聚合：合计应续件数 = 续保影响度的统一分母（什么分类就按什么合计）
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

    trows, tot_q, tot_r, tot_unq, tot_lost = [], 0, 0, 0, 0
    for e in enriched:
        tot_q += e["q"]; tot_r += e["r"]; tot_unq += e["unquoted"]; tot_lost += e["lost"]
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
    rpt.table(
        ["三级机构", "应续", "已报价", "已续保", "未报价", "流失",
         "续保影响度", "报价率", "续保率"],
        trows, ["---", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:"],
    )

    # 字段口径定义统一沉到报告末尾附录（见 build_branch_report），正文只讲业务结论。
    # 结论：只谈问题，每个问题一段
    top3 = enriched[:3]  # 已按续保影响度降序
    imp_str = "、".join(f"{e['org']}（{fp(e['impact'])}）" for e in top3)
    top3_sum = impact_rate(sum(e["lost"] for e in top3), tot_yc)
    by_unq = sorted(enriched, key=lambda e: e["unquoted"], reverse=True)[:3]
    unq_str = "、".join(f"{e['org']}（{e['unquoted']:,}）" for e in by_unq)
    unq_drag = impact_rate(tot_unq, tot_yc)

    if kind == "matured":
        gap = round(TARGET_MATURED_RENEWAL_RATE - (rr_t or 0), 1)
        rpt.add(f"**问题一 · 续保率缺口**：{subject}续保率 {fp(rr_t)}，"
                f"低于 {TARGET_MATURED_RENEWAL_RATE}% 的目标 {gap} 个百分点。"
                f"续保影响度前三的三级机构分别是 {imp_str}，"
                f"三家合计导致整体分公司流失 {fp(top3_sum)} 的客户。")
        rpt.add()
        rpt.add(f"**问题二 · 未报价即流失**：{subject}报价率仅 {fp(qr_t)}，"
                f"仍有 {tot_unq:,} 户至今未报价、已流失，直接拉低续保率 {fp(unq_drag)}"
                f"（{tot_unq:,} ÷ {tot_yc:,}）。未报价客户数前三机构是 {unq_str}。")
    else:  # approaching：临期·未到期·进度口径，诚实措辞（不说「已流失」）
        rpt.add(f"**问题一 · 临期续保进度**：{subject}共 {tot_yc:,} 户、当前续保率仅 {fp(rr_t)}"
                f"（未到期·临期进度，仍在续保动作窗口内，将随到期临近补齐）。"
                f"续保影响度（按当前尚未续回进度）前三的三级机构分别是 {imp_str}，"
                f"三家合计 {fp(top3_sum)} 的临期客户尚未续回，是最需紧急冲刺的盘子。")
        rpt.add()
        rpt.add(f"**问题二 · 临期未报价风险**：{subject}报价率仅 {fp(qr_t)}，"
                f"仍有 {tot_unq:,} 户至今未报价——距到期已不足 7 天、转化时间极短，"
                f"是流失风险最高的紧急派单对象（占应续 {fp(unq_drag)}）。未报价客户数前三机构是 {unq_str}。")
    rpt.add()


def _branch_funnel_section(con, rpt, num, title, win_sql, pool_lead, mature, note=""):
    """三级机构续保漏斗表（应续 / 已报价 / 已续保 / 报价率 / 续保率，表头用简称）。

    mature=True 表示窗口已成熟（到期日 ≤ 数据截止日），续保率即最终留存 → 亮灯；
    mature=False 表示窗口含未到期件，续保率反映进度 → 不亮灯，结论注明属进度。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead) + """
        SELECT org_level_3, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM f WHERE org_level_3 IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    if note:
        rpt.add(f"> {note}")
        rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return
    trows, tot_yc, tot_q, tot_r = [], 0, 0, 0
    for org, yc, q, r in rows:
        q, r = q or 0, r or 0
        tot_yc, tot_q, tot_r = tot_yc + yc, tot_q + q, tot_r + r
        qr, rr = rate(q, yc), rate(r, yc)
        rr_cell = f"{fp(rr)}{light_r(rr)}" if mature else fp(rr)
        trows.append([org, f"{yc:,}", f"{q:,}", f"{r:,}", f"{fp(qr)}{light_q(qr)}", rr_cell])
    qr_t, rr_t = rate(tot_q, tot_yc), rate(tot_r, tot_yc)
    trows.append(["**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**", f"**{fp(qr_t)}**", f"**{fp(rr_t)}**"])
    rpt.table(["三级机构", "应续", "已报价", "已续保", "报价率", "续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    big = rows[0]
    valid = [(o, rate(r, yc)) for o, yc, q, r in rows if yc]
    valid = [(o, v) for o, v in valid if v is not None]
    if valid:
        hi, lo = max(valid, key=lambda x: x[1]), min(valid, key=lambda x: x[1])
        # 进度口径已在表头 note 说明，结论不重复解释，仅以「（进度）」一词点出（R6 去口径教学）
        prog = "" if mature else "（进度）"
        rpt.concl(f"合计应续 {tot_yc:,} 件、报价率 {fp(qr_t)}、续保率 {fp(rr_t)}{prog}。"
                  f"续保率标杆 **{hi[0]}（{fp(hi[1])}）**、落后 {lo[0]}（{fp(lo[1])}）；"
                  f"盘子最大 **{big[0]}（{big[1]:,} 件）**，经营杠杆最大。")


def _branch_speed_section(con, rpt, num, title, prefix, qcol, rcol, win_sql, pool_lead, note):
    """三级机构首日/首周可续期响应速度表（无亮灯，速度子指标）。

    口径 A（用户 2026-06-06 确认）：{prefix}续回数 = 可续期{prefix}内已报价 且 最终续回的件数；
    {prefix}续保率 = {prefix}续回数 ÷ 应续件数。衡量快速响应客户的最终成交转化。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead) + f"""
        SELECT org_level_3, COUNT(*) yc, SUM({qcol}) sq, SUM({rcol}) sr
        FROM f WHERE org_level_3 IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    rpt.add(f"## {num}、{title}")
    rpt.add()
    rpt.add(f"> {note}")
    rpt.add()
    if not rows:
        rpt.add("（窗口内无数据）")
        rpt.add()
        return
    trows, tot_yc, tot_q, tot_r = [], 0, 0, 0
    for org, yc, sq, sr in rows:
        sq, sr = sq or 0, sr or 0
        tot_yc, tot_q, tot_r = tot_yc + yc, tot_q + sq, tot_r + sr
        trows.append([org, f"{yc:,}", f"{sq:,}", f"{sr:,}", fp(rate(sq, yc)), fp(rate(sr, yc))])
    trows.append(["**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**",
                  f"**{fp(rate(tot_q, tot_yc))}**", f"**{fp(rate(tot_r, tot_yc))}**"])
    rpt.table(["三级机构", "应续", f"{prefix}报价数", f"{prefix}续回数", f"{prefix}报价率", f"{prefix}续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    # 口径（口径 A）已在表头 note 说明，结论不重复定义，改为点名响应快慢机构（R3 白话 + R6 去口径教学）
    valid = [(o, rate(sr, yc)) for o, yc, sq, sr in rows if yc]
    valid = [(o, v) for o, v in valid if v is not None]
    extra = ""
    if valid:
        hi, lo = max(valid, key=lambda x: x[1]), min(valid, key=lambda x: x[1])
        extra = f"{prefix}续保率标杆 **{hi[0]}（{fp(hi[1])}）**、最低 {lo[0]}（{fp(lo[1])}）。"
    rpt.concl(f"合计{prefix}报价率 {fp(rate(tot_q, tot_yc))}、{prefix}续保率 {fp(rate(tot_r, tot_yc))}。{extra}")


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
