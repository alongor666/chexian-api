#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 分公司视角子报告（diagnose_renewal.py --branch-report 的实现模块）

面向分公司管理者的 6 张三级机构窗口对照表（以数据截止日当天所在月/年为窗口）：
  一、当月已到期续保表   到期日 ≤ 数据截止日（已成熟，续保率亮灯）
  二、当月未到期续保表   到期日 > 数据截止日（续保率反映进度，不亮灯）
  三、当月续保表         当月全部（= 一 + 二）
  四、当年续保表         当年全部
  五、当月首日续保情况   进盘后首日（到期前约 29 天）报价/续回响应
  六、当月首周续保情况   进盘后首周（到期前约 23-30 天）报价/续回响应

口径单一事实源：数据源（RT）、应续=去重车架号、进盘锚点、亮灯阈值、率值聚合（rate）、
渲染（Report/fp/light_q/light_r）全部从 renewal_common 复用，本模块不重复定义，避免口径漂移。

已续回 = is_renewed（ETL convert_renewal_tracker.py:187：匹配到续保单号 renewed_policy_no 即已签单成交）。
renewed_date 是续保单保险起期（=原保单到期次日，ETL line 114），非签单时点，不参与「已续回」判断 ——
未到期保单已签单但起保日在未来仍属已续回。前后端口径一致（renewal-tracker.ts 已续回 C 指标同样直接用 is_renewed）。

首日/首周续保率口径 A（用户 2026-06-06 确认）：续回数 = 进盘后首日/首周内「已报价 且 已续回（is_renewed）」
的件数 ÷ 应续件数。因续保成交日恒为到期前后（无提前成交信号），不以续保日切片，
而衡量「快速响应客户的成交转化」。

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

    先按窗口过滤 raw，再按车架号去重（MAX 报价/续回、MIN 到期/首次报价），最后算进盘锚点首日/首周标记。
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
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1q,
             CASE WHEN quoted=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1q,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 1 THEN 1 ELSE 0 END AS d1r,
             CASE WHEN quoted=1 AND renewed=1 AND CAST(fqt AS DATE) <= {anchor} + 7 THEN 1 ELSE 0 END AS w1r
      FROM w
    )"""


def _branch_matured_section(con, rpt, win_sql, pool_lead, note):
    """表一专属：当月已到期续保表（最终留存）。

    在基础漏斗 6 列上，按 renewal_common 注册口径派生 未报价件数 / 流失件数 / 续保影响度，
    按「续保影响度从高至低」排序（谁拖累整体续保率最多排最前）。
    续保影响度 = 流失件数 ÷ 合计应续件数（先聚合后计算，可加和至整体续保缺口）。
    结论只谈问题、每个问题一段：①续保率缺口 + 影响度前三机构；②未报价即流失 + 未报价前三机构。
    """
    rows = con.execute(_win_dedup_cte(win_sql, pool_lead) + """
        SELECT org_level_3, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM f WHERE org_level_3 IS NOT NULL
        GROUP BY 1
    """).fetchall()
    rpt.add("## 一、当月已到期续保表")
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
        trows.append([
            e["org"], f"{e['yc']:,}", f"{e['q']:,}", f"{e['r']:,}",
            f"{e['unquoted']:,}", f"{e['lost']:,}", fp(e["impact"]),
            f"{fp(e['qr'])}{light_q(e['qr'])}", f"{fp(e['rr'])}{light_r(e['rr'])}",
        ])
    qr_t, rr_t, imp_t = rate(tot_q, tot_yc), rate(tot_r, tot_yc), impact_rate(tot_lost, tot_yc)
    trows.append([
        "**合计**", f"**{tot_yc:,}**", f"**{tot_q:,}**", f"**{tot_r:,}**",
        f"**{tot_unq:,}**", f"**{tot_lost:,}**", f"**{fp(imp_t)}**",
        f"**{fp(qr_t)}**", f"**{fp(rr_t)}**",
    ])
    rpt.table(
        ["三级机构", "应续件数", "已报价件数", "已续保件数", "未报价件数", "流失件数",
         "续保影响度", "报价率", "续保率"],
        trows, ["---", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:"],
    )

    # 指标口径映射表（防漂移；定义单一事实源 = renewal_common.MATURED_GLOSSARY）
    rpt.add("> **指标口径**（防口径漂移，定义见 `renewal_common.MATURED_GLOSSARY`）")
    rpt.add()
    rpt.table(["指标", "含义", "计算逻辑"],
              [[n, d, c] for n, d, c in MATURED_GLOSSARY], ["---", "---", "---"])

    # 结论：只谈问题，每个问题一段
    top3 = enriched[:3]  # 已按续保影响度降序
    imp_str = "、".join(f"{e['org']}（{fp(e['impact'])}）" for e in top3)
    top3_sum = impact_rate(sum(e["lost"] for e in top3), tot_yc)
    by_unq = sorted(enriched, key=lambda e: e["unquoted"], reverse=True)[:3]
    unq_str = "、".join(f"{e['org']}（{e['unquoted']:,} 户）" for e in by_unq)
    unq_drag = impact_rate(tot_unq, tot_yc)

    rpt.add(f"**问题一 · 续保率缺口**：6 月已到期客户续保率 {fp(rr_t)}，续保缺口 {fp(imp_t)}"
            f"（即 {fp(imp_t)} 的已到期应续车未续回，按续保影响度可加和分解到各机构）。"
            f"续保影响度前三的三级机构分别是 {imp_str}，三家合计导致整体续保缺口扩大 {fp(top3_sum)}。")
    rpt.add()
    rpt.add(f"**问题二 · 未报价即流失**：6 月已到期客户报价率 {fp(qr_t)}，"
            f"仍有 {tot_unq:,} 户至今未报价、视同已流失，直接拉低续保率 {fp(unq_drag)}"
            f"（{tot_unq:,} ÷ {tot_yc:,}）。未报价客户数前三机构是 {unq_str}。")
    rpt.add()


def _branch_funnel_section(con, rpt, num, title, win_sql, pool_lead, mature, note=""):
    """三级机构续保漏斗表（应续件数 / 已报价件数 / 已续保件数 / 报价率 / 续保率）。

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
    rpt.table(["三级机构", "应续件数", "已报价件数", "已续保件数", "报价率", "续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    big = rows[0]
    valid = [(o, rate(r, yc)) for o, yc, q, r in rows if yc]
    valid = [(o, v) for o, v in valid if v is not None]
    if valid:
        hi, lo = max(valid, key=lambda x: x[1]), min(valid, key=lambda x: x[1])
        kind = "续保率已成熟即最终留存" if mature else "含未到期，续保率反映已锁定的续保进度而非最终留存"
        rpt.concl(f"合计应续 {tot_yc:,} 件、报价率 {fp(qr_t)}、续保率 {fp(rr_t)}（{kind}）。"
                  f"续保率标杆 **{hi[0]}（{fp(hi[1])}）**、落后 {lo[0]}（{fp(lo[1])}）；"
                  f"盘子最大 **{big[0]}（{big[1]:,} 件）** 经营杠杆最大。")


def _branch_speed_section(con, rpt, num, title, prefix, qcol, rcol, win_sql, pool_lead, note):
    """三级机构首日/首周进盘响应速度表（无亮灯，速度子指标）。

    口径 A（用户 2026-06-06 确认）：{prefix}续回数 = 进盘后{prefix}内已报价 且 最终续回的件数；
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
    rpt.table(["三级机构", "应续件数", f"{prefix}报价数", f"{prefix}续回数", f"{prefix}报价率", f"{prefix}续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:"])
    rpt.concl(f"合计{prefix}报价率 {fp(rate(tot_q, tot_yc))}、{prefix}续保率 {fp(rate(tot_r, tot_yc))}。"
              f"{prefix}续保率 = 进盘后{prefix}内已报价且最终续回的件数 ÷ 应续件数（衡量快速响应的成交转化，"
              f"续保成交日恒为到期前后故不以续保日切片）。")


def run_branch_report(con, args, out_dir, ts):
    """分公司视角：6 张三级机构窗口表（当月已到期/未到期/当月/当年 + 首日/首周进盘响应）。"""
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
    rpt.add(f"> **数据截止日** {today} · **当月** [{m_start} ~ {m_end}] · **当年** [{y_start} ~ {y_end}] · **口径** 商业险 · 应续件数 = 去重车架号")
    rpt.add(f"> **进盘锚点** 进盘日 = 到期日 − {pool_lead} 天；首日 = 进盘后 1 天内、首周 = 进盘后 7 天内")
    rpt.add(f"> **生成** `diagnose_renewal.py --branch-report` · {ts}")
    rpt.add()
    rpt.add("> 6 张三级机构窗口表：①当月已到期 ②当月未到期 ③当月 ④当年 续保漏斗；⑤首日 ⑥首周 进盘响应速度。"
            "续保率在含未到期的窗口反映**进度**（数据截止日早于到期日，未到期件尚未进入续保动作）；"
            "只有「当月已到期」窗口续保率为已成熟的最终留存。")
    rpt.add(">")
    rpt.add("> **已续回口径**：已签单续保（is_renewed，已匹配到续保单号）即计入，与前端续保追踪页面一致。"
            "未到期保单若已提前签单续保（新保单起保日在未来）同样计入已续回 —— ②当月未到期表续保率反映"
            "**已提前锁定的续保进度**，随到期临近逐月补齐；其报价率体现盘子是否已提前铺开。")
    rpt.add()

    _branch_matured_section(con, rpt,
                            f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{today}'", pool_lead,
                            note=f"当月已到期（到期日 ≤ 数据截止日 {today}）保单 —— 续保率已成熟，是最接近最终留存的信号。")
    _branch_funnel_section(con, rpt, "二", "当月未到期续保表",
                           f"expiry_date > DATE '{today}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月尚未到期保单 —— 续保率反映进度，随到期临近补齐，重点看报价率是否已提前铺开。")
    _branch_funnel_section(con, rpt, "三", "当月续保表",
                           f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead, mature=False,
                           note="当月全部应续（已到期 + 未到期）—— 续保率含未到期属进度。")
    _branch_funnel_section(con, rpt, "四", "当年续保表",
                           f"expiry_date >= DATE '{y_start}' AND expiry_date <= DATE '{y_end}'", pool_lead, mature=False,
                           note="当年全部应续 —— 全盘子经营基本面，续保率含未来月份未到期件属进度。")
    _branch_speed_section(con, rpt, "五", "当月首日续保情况", "首日", "d1q", "d1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘进盘后**首日**（约到期前 {pool_lead - 1} 天）响应：首日报价数 = 进盘后 1 天内已报价；首日续回数 = 其中最终续回（口径 A）。")
    _branch_speed_section(con, rpt, "六", "当月首周续保情况", "首周", "w1q", "w1r",
                          f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{m_end}'", pool_lead,
                          note=f"当月应续盘进盘后**首周**（约到期前 {pool_lead - 7}~{pool_lead} 天）响应：首周报价数 = 进盘后 7 天内已报价；首周续回数 = 其中最终续回（口径 A）。")

    md_path = out_dir / f"续保分公司视角_{today.year}年{today.month:02d}月_{ts}.md"
    md_path.write_text(rpt.text(), encoding="utf-8")
    print(f"✅ 分公司视角报告 → {md_path}")
    return md_path
