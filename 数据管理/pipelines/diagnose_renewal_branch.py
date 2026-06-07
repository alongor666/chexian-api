#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 分公司视角子报告（diagnose_renewal.py --branch-report 的实现模块）

面向分公司管理者的 6 张三级机构窗口对照表（以 cutoff 当天所在月/年为窗口）：
  一、当月已到期续保表   expiry ≤ cutoff（已成熟，续保率亮灯）
  二、当月未到期续保表   expiry > cutoff（续保率反映进度，不亮灯）
  三、当月续保表         当月全部（= 一 + 二）
  四、当年续保表         当年全部
  五、当月首日续保情况   进盘后首日（到期前约 29 天）报价/续回响应
  六、当月首周续保情况   进盘后首周（到期前约 23-30 天）报价/续回响应

口径单一事实源：数据源（RT）、应续=去重车架号、进盘锚点、亮灯阈值、率值聚合（rate）、
渲染（Report/fp/light_q/light_r）全部从 renewal_common 复用，本模块不重复定义，避免口径漂移。

已续回口径与前端续保追踪（server/src/sql/renewal-tracker.ts）严格一致：仅续保单已起期
（renewed_date ≤ cutoff）才计入已续回，排除「已提前续保但起期在未来、当前尚未生效」件；
故未到期窗口续保率反映已生效续回进度（②当月未到期表接近 0% 属正常，看点是报价率铺开）。

首日/首周续保率口径 A（用户 2026-06-06 确认）：续回数 = 进盘后首日/首周内「已报价 且 已起期续回
（renewed_date ≤ cutoff）」的件数 ÷ 应续件数。因续保成交日恒为到期前后（无提前成交信号），
不以续保日切片，而衡量「快速响应客户的成交转化」。

每张表在自己窗口内按车架号去重（与主报告单窗口口径一致），跨月重复车架号（年内约 1099 个）
在各自到期窗口分别计入，避免被「年表 MIN 去重」误归月份。
"""

import sys
from calendar import monthrange
from datetime import date

# 共享口径/渲染原语单一来源：从 renewal_common（依赖叶子）导入，避免反向依赖主文件与 __main__ 双导入
from renewal_common import RT, Report, fp, light_q, light_r, rate


def _month_bounds(d: date):
    """返回 d 所在自然月的 (首日, 末日)。"""
    return d.replace(day=1), d.replace(day=monthrange(d.year, d.month)[1])


def _win_dedup_cte(win_sql, pool_lead):
    """窗口内按车架号去重的 CTE 前缀（末 CTE 名 f）。

    先按窗口过滤 raw，再按车架号去重（MAX 报价/续回、MIN 到期/首次报价），最后算进盘锚点首日/首周标记。
    每个窗口独立去重 —— 与主报告单窗口「应续=去重车架号」口径一致，跨月重复车架号在各自到期窗口分别计入。
    已续回口径（renewed）已在 raw 表按 cutoff 注入（is_renewed 且续保单已起期 renewed_date ≤ cutoff，
    与前端续保追踪 renewal-tracker.ts 一致），此处仅 MAX 聚合；未到期窗口续保率因此反映「已生效续回」进度。
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


def _branch_funnel_section(con, rpt, num, title, win_sql, pool_lead, mature, note=""):
    """三级机构续保漏斗表（应续件数 / 已报价件数 / 已续保件数 / 报价率 / 续保率）。

    mature=True 表示窗口已成熟（到期日 ≤ cutoff），续保率即最终留存 → 亮灯；
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
    # 已成熟窗口按续保率排名（最终留存有意义）；含未到期窗口续保率反映已生效进度（未到期件起期在未来 → 趋 0），
    # 核心看点是报价是否提前铺开，故结论按报价率排名，避免「续保率全 0 时标杆/落后同一机构」的无意义表述。
    metric = (lambda yc, q, r: rate(r, yc)) if mature else (lambda yc, q, r: rate(q, yc))
    valid = [(o, metric(yc, q, r)) for o, yc, q, r in rows if yc]
    valid = [(o, v) for o, v in valid if v is not None]
    if valid:
        hi, lo = max(valid, key=lambda x: x[1]), min(valid, key=lambda x: x[1])
        if mature:
            rpt.concl(f"合计应续 {tot_yc:,} 件、报价率 {fp(qr_t)}、续保率 {fp(rr_t)}（续保率已成熟即最终留存）。"
                      f"续保率标杆 **{hi[0]}（{fp(hi[1])}）**、落后 {lo[0]}（{fp(lo[1])}）；"
                      f"盘子最大 **{big[0]}（{big[1]:,} 件）** 经营杠杆最大。")
        else:
            rpt.concl(f"合计应续 {tot_yc:,} 件、报价率 {fp(qr_t)}（续保率 {fp(rr_t)} 仅反映已生效续回，未到期件起期在未来故趋 0）。"
                      f"报价铺开标杆 **{hi[0]}（{fp(hi[1])}）**、落后 {lo[0]}（{fp(lo[1])}）；"
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
    # 已续回口径与前端续保追踪（renewal-tracker.ts）一致：仅续保单已起期（renewed_date ≤ cutoff）才计入 renewed，
    # 排除「已提前续保但续保单起期晚于 cutoff、尚未生效」件 → 未到期窗口续保率如实反映已生效续回（而非虚高）。
    con.execute(f"""
        CREATE TEMP TABLE raw AS
        SELECT vehicle_frame_no, org_level_3, expiry_date,
               is_quoted::INT AS quoted,
               (CASE WHEN is_renewed AND renewed_date <= DATE '{today}' THEN 1 ELSE 0 END) AS renewed,
               first_quote_time AS fqt
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
    rpt.add(f"> **cutoff** {today} · **当月** [{m_start} ~ {m_end}] · **当年** [{y_start} ~ {y_end}] · **口径** 商业险 · 应续件数 = 去重车架号")
    rpt.add(f"> **进盘锚点** 进盘日 = 到期日 − {pool_lead} 天；首日 = 进盘后 1 天内、首周 = 进盘后 7 天内")
    rpt.add(f"> **生成** `diagnose_renewal.py --branch-report` · {ts}")
    rpt.add()
    rpt.add("> 6 张三级机构窗口表：①当月已到期 ②当月未到期 ③当月 ④当年 续保漏斗；⑤首日 ⑥首周 进盘响应速度。"
            "续保率在含未到期的窗口反映**进度**（cutoff 早于到期日，未到期件尚未进入续保动作）；"
            "只有「当月已到期」窗口续保率为已成熟的最终留存。")
    rpt.add(">")
    rpt.add(f"> **已续回口径**：续保单已起期（renewed_date ≤ cutoff {today}）才计入已续回，与前端续保追踪页面严格一致。"
            "未到期保单的续保单起期均在未来、当前尚未生效，故②当月未到期表续保率接近 0% 属正常 —— "
            "该表看点是**报价率是否已提前铺开**，续保率随到期临近逐月补齐。")
    rpt.add()

    _branch_funnel_section(con, rpt, "一", "当月已到期续保表",
                           f"expiry_date >= DATE '{m_start}' AND expiry_date <= DATE '{today}'", pool_lead, mature=True,
                           note=f"当月已到期（到期日 ≤ cutoff {today}）保单 —— 续保率已成熟，是最接近最终留存的信号。")
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
