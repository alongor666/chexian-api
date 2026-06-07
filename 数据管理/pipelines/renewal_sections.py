#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 主报告 6 大板块（diagnose_renewal.py 编排调用）

  build_base / overview / write_header  — base 临时表构建 + 概览统计 + 报告头
  section_org_overview   一、机构经营盯盘总表（产出 org_rows，供板块四复用）
  section_progress       二、续保进度与时效（成熟度 + 报价响应速度·进盘锚点）
  section_pricing_anomaly 三、涨价异常专题（系数变化 + 涨价客户风险等级变化）
  section_org_drill      四、机构下钻追业务员（大机构列团队/小机构直列）+ 业务员盯盘 CSV
  section_supplementary  五、补充结构（责任模式 / 报价提前 / 保费比值 / 客户结构 / 电销渠道）
  section_followup       六、待跟进清单 + 涨价离谱清单 CSV

每个 section 签名统一 (con, rpt, ctx)；跨板块唯一数据依赖是板块一的 org_rows → 板块四（经 ctx.org_rows 传递）。
口径/渲染原语全部 import 自 renewal_common（单一事实源），责任模式加载 import 自 renewal_resp_mode。
"""

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from renewal_common import (
    POL,
    Q,
    QUOTE_WINDOW_START,
    RT,
    SMALL_ORG_SALESMEN,
    TELESALES_TERMINAL,
    disp_team,
    fp,
    light_q,
    light_r,
    rate,
)
from renewal_resp_mode import load_resp_mode_source


@dataclass
class Ctx:
    """主报告各 section 共享的上下文（窗口 / cutoff / 概览统计 / 运行参数）。"""
    today: date
    start: date
    end: date
    label: str
    by_month: bool
    pool_lead: int
    immature: bool
    yc_all: int
    q_all: int
    r_all: int
    qr_all: float
    rr_all: float
    args: object
    out_dir: Path
    ts: str
    org_rows: list = field(default_factory=list)   # 板块一产出，板块四消费


def build_base(con, where_sql, cutoff) -> int:
    """构建 base 临时表（窗口内按车架号去重），返回应续车架数。

    已续回口径与前端续保追踪（server/src/sql/renewal-tracker.ts）严格一致：仅当续保单已起期
    （renewed_date ≤ cutoff）才计入 renewed，排除「已提前续保但续保单起期晚于 cutoff、尚未生效」的件，
    避免未成熟窗口把未来才生效的续保提前计入、虚高当前续回率。
    """
    con.execute(f"""
        CREATE TEMP TABLE base AS
        SELECT vehicle_frame_no,
               ANY_VALUE(source_policy_no) AS source_policy_no,
               ANY_VALUE(org_level_3) AS org_level_3,
               ANY_VALUE(team_name) AS team_name,
               ANY_VALUE(salesman_name) AS salesman_name,
               ANY_VALUE(customer_category) AS customer_category,
               ANY_VALUE(coverage_combination) AS coverage_combination,
               MIN(expiry_date) AS expiry_date,
               MAX(is_quoted::INT) AS quoted,
               MAX(CASE WHEN is_renewed AND renewed_date <= DATE '{cutoff}' THEN 1 ELSE 0 END) AS renewed,
               MIN(first_quote_time) AS first_quote_time,
               MIN(renewed_date) AS renewed_date,
               ANY_VALUE(renewed_policy_no) AS renewed_policy_no
        FROM read_parquet('{RT}')
        WHERE {where_sql}
        GROUP BY vehicle_frame_no
    """)
    return con.execute("SELECT COUNT(*) FROM base").fetchone()[0]


def overview(con):
    """概览统计：返回 (yc_all, q_all, r_all, qr_all, rr_all)。"""
    yc_all, q_all, r_all = con.execute("SELECT COUNT(*), SUM(quoted), SUM(renewed) FROM base").fetchone()
    return yc_all, q_all, r_all, rate(q_all, yc_all), rate(r_all, yc_all)


def write_header(rpt, ctx):
    """报告头：标题 + 数据窗口 + 概览 + 进度提示。"""
    rpt.add(f"# 续保诊断 · {ctx.label} · 三级机构经营盯盘")
    rpt.add()
    rpt.add(f"> **数据窗口** `expiry ∈ [{ctx.start}, {ctx.end}]` · **cutoff** {ctx.today} · **口径** 商业险 · 应续 = 去重车架号 · 已续回 = 续保单已起期（renewed_date ≤ cutoff，与前端续保追踪一致）")
    rpt.add(f"> **概览** 应续 {ctx.yc_all:,} 车架 · 报价率 {fp(ctx.qr_all)}{light_q(ctx.qr_all)} · 续回率 {fp(ctx.rr_all)}{light_r(ctx.rr_all)}")
    rpt.add(f"> **生成** `diagnose_renewal.py` v2.0 · {ctx.ts}")
    if ctx.immature:
        rpt.add(f"> ⚠️ **进度提示**：cutoff={ctx.today} 早于窗口末（{ctx.end}），未到期保单尚未进入续保动作，"
                f"**整体续回率反映进度而非最终留存**——看「已到期续保率」与成熟度切片。")
    rpt.add()


def section_org_overview(con, rpt, ctx):
    """一、机构经营盯盘总表。返回 org_rows 供板块四复用。"""
    rpt.add("## 一、机构经营盯盘总表")
    rpt.add()
    rpt.add("> 分公司视角核心表：每个三级机构的应续盘子、报价缺口、续回缺口、及已到期保单的真实续保率。")
    rpt.add()
    org_rows = con.execute(f"""
        SELECT org_level_3, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r,
               COUNT(*) FILTER (WHERE expiry_date <= DATE '{ctx.today}') exp_yc,
               SUM(renewed) FILTER (WHERE expiry_date <= DATE '{ctx.today}') exp_r
        FROM base WHERE org_level_3 IS NOT NULL
        GROUP BY 1 ORDER BY yc DESC
    """).fetchall()
    trows = []
    for org, yc, q, r, eyc, er in org_rows:
        qr, rr, err = rate(q, yc), rate(r, yc), rate(er, eyc)
        trows.append([org, f"{yc:,}", f"{q:,}", f"{yc - q:,}", f"{fp(qr)}{light_q(qr)}",
                      f"{r:,}", f"{yc - r:,}", f"{fp(rr)}{light_r(rr)}",
                      f"{fp(err)}{light_r(err)}" if err is not None else "—"])
    tot_eyc = sum(x[4] for x in org_rows)
    tot_er = sum((x[5] or 0) for x in org_rows)
    trows.append(["**合计**", f"**{ctx.yc_all:,}**", f"{ctx.q_all:,}", f"{ctx.yc_all - ctx.q_all:,}",
                  f"**{fp(ctx.qr_all)}**", f"{ctx.r_all:,}", f"{ctx.yc_all - ctx.r_all:,}", f"**{fp(ctx.rr_all)}**",
                  f"**{fp(rate(tot_er, tot_eyc))}**" if tot_eyc else "—"])
    rpt.table(["三级机构", "应续", "已报价", "未报价", "报价率", "已续回", "未续回", "续回率", "已到期续保率"],
              trows, ["---", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:"])
    valid = [(o, rate(r, yc), rate(er, eyc)) for o, yc, q, r, eyc, er in org_rows if yc]
    rrv = [(o, v) for o, v, _e in valid if v is not None]
    if rrv:
        hi, lo = max(rrv, key=lambda x: x[1]), min(rrv, key=lambda x: x[1])
        biggest = org_rows[0]
        rpt.concl(f"全机构应续 {ctx.yc_all:,}、报价缺口 {ctx.yc_all - ctx.q_all:,} 户、续回缺口 {ctx.yc_all - ctx.r_all:,} 户。"
                  f"续回率标杆 **{hi[0]}（{fp(hi[1])}）**、落后 {lo[0]}（{fp(lo[1])}）；"
                  f"盘子最大 **{biggest[0]}（{biggest[1]:,}）** 经营杠杆最大。"
                  f"{'「已到期续保率」是各机构当前最接近最终留存的信号，未到期件随进度补齐。' if ctx.immature else ''}")
    return org_rows


def section_progress(con, rpt, ctx):
    """二、续保进度与时效（2.1 成熟度 + 2.2 报价响应速度）。"""
    rpt.add("## 二、续保进度与时效")
    rpt.add()
    rpt.add("### 2.1 续保进度（成熟度）")
    if ctx.by_month:
        rows = con.execute("""
            SELECT MONTH(expiry_date) m, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
            FROM base GROUP BY 1 ORDER BY 1
        """).fetchall()
        trows, slice_rr = [], []
        for m, yc, q, r in rows:
            qr, rr = rate(q, yc), rate(r, yc)
            slice_rr.append((f"{m}月", rr))
            trows.append([f"{m}月", f"{yc:,}", f"{fp(qr)}{light_q(qr)}", f"{fp(rr)}{light_r(rr)}"])
        rpt.table(["到期月", "应续", "报价率", "续回率"], trows, ["---", "--:", "--:", "--:"])
        v = [(m, x) for m, x in slice_rr if x is not None]
        if v:
            hi, lo = max(v, key=lambda x: x[1]), min(v, key=lambda x: x[1])
            rpt.concl(f"各月续回率最高 {hi[0]}（{fp(hi[1])}）、最低 {lo[0]}（{fp(lo[1])}）。"
                      f"{'越靠后的月份越未成熟，续回率偏低属进度。' if ctx.immature else ''}")
    else:
        rows = con.execute(f"""
            WITH b AS (SELECT *, CAST(expiry_date AS DATE) ed FROM base)
            SELECT CASE WHEN ed <= DATE '{ctx.today}' THEN 'a.已到期'
                        WHEN ed <= DATE '{ctx.today}'+6 THEN 'b.本周(7日内)'
                        WHEN ed <= DATE '{ctx.today}'+13 THEN 'c.下周(8-14日)'
                        WHEN ed <= DATE '{ctx.today}'+20 THEN 'd.第三周(15-21日)'
                        ELSE 'e.更晚' END seg,
                   COUNT(*) yc, SUM(quoted) q, SUM(renewed) r, MIN(ed) mn
            FROM b GROUP BY 1 ORDER BY mn
        """).fetchall()
        trows, mature_rr = [], None
        for seg, yc, q, r, _mn in rows:
            qr, rr = rate(q, yc), rate(r, yc)
            if seg.startswith("a.") and yc:
                mature_rr = rr
            trows.append([seg[2:], f"{yc:,}", f"{fp(qr)}{light_q(qr)}", f"{fp(rr)}{light_r(rr)}"])
        rpt.table(["到期区间", "应续", "报价率", "续回率"], trows, ["---", "--:", "--:", "--:"])
        if mature_rr is not None:
            rpt.concl(f"整体续回率 {fp(ctx.rr_all)} 含未到期属进度；**已到期保单续回率 {fp(mature_rr)}** "
                      f"是当前最接近最终留存的信号，报价率随到期临近爬升。")

    rpt.add(f"### 2.2 报价响应速度（进盘锚点：到期日 − {ctx.pool_lead} 天）")
    spd = con.execute(f"""
        WITH b AS (SELECT *, CAST(expiry_date AS DATE) - {ctx.pool_lead} pool_day FROM base)
        SELECT COUNT(*) yc,
               COUNT(*) FILTER (WHERE quoted=1 AND CAST(first_quote_time AS DATE) <= pool_day+1) d1,
               COUNT(*) FILTER (WHERE quoted=1 AND CAST(first_quote_time AS DATE) <= pool_day+7) w1,
               SUM(quoted) qf
        FROM b
    """).fetchone()
    yc, d1, w1, qf = spd
    d1r, w1r, qfr = rate(d1, yc), rate(w1, yc), rate(qf, yc)
    rpt.table(["报价时效（进盘后）", "比例"],
              [["首日报价率（≤进盘+1天）", f"{fp(d1r)}{light_q(d1r)}"],
               ["首周报价率（≤进盘+7天）", f"{fp(w1r)}{light_q(w1r)}"],
               ["最终报价率", f"{fp(qfr)}{light_q(qfr)}"]],
              ["---", "--:"])
    rpt.concl(f"进盘（到期前 {ctx.pool_lead} 天）后首周已报价 {fp(w1r)}、首日 {fp(d1r)}，最终 {fp(qfr)}。"
              f"首周与最终相差 {round((qfr or 0) - (w1r or 0), 1)} 个百分点 = 拖到临近到期才报价的部分，是响应提速空间。"
              f"（续保签发日≈续保单起期≈原到期日，无提前续保信号，故续保时效以 2.1 成熟度衡量）")


def section_pricing_anomaly(con, rpt, ctx):
    """三、涨价异常专题（3.1 报价系数变化 + 3.2 涨价客户风险等级变化）。"""
    rpt.add("## 三、涨价异常专题（报价系数 × 风险等级）")
    rpt.add()
    rpt.add("### 3.1 报价系数变化 × 续回率")
    rows = con.execute(f"""
        WITH ql AS (
          SELECT vehicle_frame_no, pricing_factor_yoy_change yoy FROM read_parquet('{Q}')
          WHERE quote_time >= TIMESTAMP '{QUOTE_WINDOW_START}'
          QUALIFY ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC)=1)
        SELECT CASE WHEN b.quoted=0 THEN 'z.未报价' WHEN q.yoy IS NULL THEN 'y.系数变化未记录' ELSE q.yoy END k,
               COUNT(*) yc, SUM(b.renewed) r
        FROM base b LEFT JOIN ql q USING(vehicle_frame_no) GROUP BY 1 ORDER BY yc DESC
    """).fetchall()
    trows, yoy_rr = [], {}
    for k, yc, r in rows:
        kk = k[2:] if k in ("z.未报价", "y.系数变化未记录") else k
        rr = rate(r, yc)
        yoy_rr[kk] = rr
        trows.append([kk, f"{yc:,}", f"{r:,}", f"{fp(rr)}{light_r(rr)}"])
    rpt.table(["报价系数变化", "车架", "续回", "续回率"], trows, ["---", "--:", "--:", "--:"])
    down, up = yoy_rr.get("系数下降"), yoy_rr.get("系数上升")
    if down is not None and up is not None:
        rpt.concl(f"系数下降（降价）续回率 {fp(down)} vs 系数上升（涨价）{fp(up)}，差 {round(down - up, 1):+.1f}pp。涨价件流失风险高，需深挖涨价原因（见 3.2）。")

    rpt.add("### 3.2 涨价客户报价风险等级 vs 上年风险等级")
    rows = con.execute(f"""
        WITH ql AS (
          SELECT vehicle_frame_no, pricing_factor_yoy_change yoy, insurance_grade qg FROM read_parquet('{Q}')
          WHERE quote_time >= TIMESTAMP '{QUOTE_WINDOW_START}'
          QUALIFY ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC)=1),
        prior AS (SELECT policy_no, ANY_VALUE(insurance_grade) pg FROM read_parquet('{POL}') GROUP BY 1),
        j AS (SELECT b.renewed, q.qg, p.pg
              FROM base b JOIN ql q USING(vehicle_frame_no) JOIN prior p ON b.source_policy_no=p.policy_no
              WHERE q.yoy='系数上升')
        SELECT CASE
                 WHEN qg IS NULL OR pg IS NULL OR qg='X' OR pg='X' THEN 'e.等级不可比'
                 WHEN qg=pg THEN 'a.等级一致'
                 WHEN ascii(qg) < ascii(pg) THEN 'b.等级变好(风险降低)'
                 WHEN ascii(qg)-ascii(pg)=1 THEN 'c.小幅变差(1档)'
                 ELSE 'd.大幅变差(≥2档)' END chg,
               COUNT(*) yc, SUM(renewed) r
        FROM j GROUP BY 1 ORDER BY 1
    """).fetchall()
    trows, chg_map = [], {}
    for chg, yc, r in rows:
        rr = rate(r, yc)
        chg_map[chg[2:]] = (yc, rr)
        trows.append([chg[2:], f"{yc:,}", f"{r:,}", f"{fp(rr)}{light_r(rr)}"])
    rpt.table(["涨价客户·风险等级变化", "车架", "续回", "续回率"], trows, ["---", "--:", "--:", "--:"])
    consistent = chg_map.get("等级一致", (0, None))
    big = chg_map.get("大幅变差(≥2档)", (0, None))
    total_cmp = sum(v[0] for k, v in chg_map.items() if k != "等级不可比")
    if total_cmp:
        rpt.concl(f"涨价客户约 {fp(rate(consistent[0], total_cmp))} 风险等级与上年一致，其余为等级变化驱动。"
                  f"**等级大幅变差（≥2档）{big[0]:,} 户、续回率仅 {fp(big[1])}** —— 涨价多由风险恶化（出险/评分下降）驱动，"
                  f"这批是最易流失的「涨价离谱」客户（见六·涨价离谱清单）。风险等级 A→G 递差（A 最优、G 最差）。")


def section_org_drill(con, rpt, ctx):
    """四、机构下钻追业务员（大机构列团队/小机构直列）+ 业务员盯盘 CSV。返回 sm_csv。"""
    rpt.add("## 四、机构下钻：追业务员")
    rpt.add()
    rpt.add(f"> 大机构（业务员 ≥ {SMALL_ORG_SALESMEN}）列团队 + 前 5 / 末位 5 业务员，机构长分配团队长追；"
            f"小机构（< {SMALL_ORG_SALESMEN}）直列全部业务员，机构长直接召集。完整明细见业务员盯盘 CSV。")
    rpt.add()
    org_sm_cnt = dict(con.execute(
        "SELECT org_level_3, COUNT(DISTINCT salesman_name) FROM base WHERE salesman_name IS NOT NULL GROUP BY 1"
    ).fetchall())
    team_rows = con.execute("""
        SELECT org_level_3, team_name, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM base WHERE team_name IS NOT NULL GROUP BY 1,2
    """).fetchall()
    sm_rows = con.execute("""
        SELECT org_level_3, salesman_name, ANY_VALUE(team_name) team, COUNT(*) yc, SUM(quoted) q, SUM(renewed) r
        FROM base WHERE salesman_name IS NOT NULL GROUP BY 1,2
    """).fetchall()
    teams_by_org, sm_by_org = {}, {}
    for o, t, yc, q, r in team_rows:
        teams_by_org.setdefault(o, []).append((t, yc, q, r))
    for o, s, t, yc, q, r in sm_rows:
        sm_by_org.setdefault(o, []).append((s, t, yc, q, r))

    for org, yc_o, *_ in ctx.org_rows:
        n_sm = org_sm_cnt.get(org, 0)
        kind = "小机构·直列业务员" if n_sm < SMALL_ORG_SALESMEN else "大机构·列团队"
        rpt.add(f"### {org}（{kind} · 业务员 {n_sm} 人 · 应续 {yc_o:,}）")
        if n_sm < SMALL_ORG_SALESMEN:
            sms = sorted(sm_by_org.get(org, []), key=lambda x: x[2], reverse=True)
            trows = [[s, disp_team(t), f"{yc:,}", f"{yc - q:,}", f"{yc - r:,}", f"{fp(rate(r, yc))}{light_r(rate(r, yc))}"]
                     for s, t, yc, q, r in sms]
            rpt.table(["业务员", "团队", "应续", "未报价", "未续回", "续回率"], trows,
                      ["---", "---", "--:", "--:", "--:", "--:"])
        else:
            tms = sorted(teams_by_org.get(org, []), key=lambda x: x[1], reverse=True)
            trows = [[disp_team(t), f"{yc:,}", f"{yc - q:,}", f"{fp(rate(q, yc))}{light_q(rate(q, yc))}",
                      f"{yc - r:,}", f"{fp(rate(r, yc))}{light_r(rate(r, yc))}"]
                     for t, yc, q, r in tms]
            rpt.table(["团队", "应续", "未报价", "报价率", "未续回", "续回率"], trows,
                      ["---", "--:", "--:", "--:", "--:", "--:"])
            # 业务员明细（应续≥10）：>10 人才拆前5/末位5，否则全列（避免重叠）
            sms = sorted([x for x in sm_by_org.get(org, []) if x[2] >= 10],
                         key=lambda x: rate(x[4], x[2]), reverse=True)
            if len(sms) > 10:
                picked = [("🔝前5", x) for x in sms[:5]] + [("⚠️末位5", x) for x in sms[-5:]]
            else:
                picked = [("", x) for x in sms]
            if picked:
                trows = [[tag, s, disp_team(t), f"{yc:,}", f"{yc - r:,}", f"{fp(rate(r, yc))}{light_r(rate(r, yc))}"]
                         for tag, (s, t, yc, q, r) in picked]
                rpt.table(["", "业务员(应续≥10)", "团队", "应续", "未续回", "续回率"], trows,
                          [":-:", "---", "---", "--:", "--:", "--:"])

    sm_csv = None
    if not ctx.args.no_action_list:
        sm_csv = ctx.out_dir / f"续保业务员盯盘_{ctx.ts}.csv"
        con.execute(f"""
            COPY (
              SELECT org_level_3, team_name, salesman_name,
                     COUNT(*) AS 应续, SUM(quoted) AS 已报价, COUNT(*)-SUM(quoted) AS 未报价,
                     SUM(renewed) AS 已续回, COUNT(*)-SUM(renewed) AS 未续回,
                     ROUND(100.0*SUM(renewed)/COUNT(*),1) AS 续回率
              FROM base WHERE salesman_name IS NOT NULL
              GROUP BY 1,2,3 ORDER BY org_level_3, 应续 DESC
            ) TO '{sm_csv}' (HEADER, DELIMITER ',')
        """)
        rpt.concl(f"业务员盯盘全量明细 → `{sm_csv.name}`（机构/团队/业务员/应续/已报价/未报价/已续回/未续回/续回率），分公司可按机构筛选下发。")
    return sm_csv


def section_supplementary(con, rpt, ctx):
    """五、补充结构（5.1 责任模式 / 5.2 报价提前 / 5.3 保费比值 / 5.4 客户结构 / 5.5 电销渠道）。"""
    rpt.add("## 五、补充结构")
    rpt.add()

    # 5.1 责任模式
    rpt.add("### 5.1 责任模式")
    rm_path = ctx.args.resp_mode_list or ctx.args.renewal_list
    lst, src_label = load_resp_mode_source(Path(rm_path), ctx.start, ctx.end)
    if lst is None:
        rpt.add(f"⛔ 跳过：{src_label}（专项清单用 `--resp-mode-list`）")
        rpt.add()
    else:
        rpt.add(f"> 来源：{src_label} · `{Path(rm_path).name}`")
        con.register("rlist", lst)
        rows = con.execute("""
            SELECT COALESCE(l.resp_mode,'业务员自留') rm, COUNT(*) yc, SUM(b.quoted) q, SUM(b.renewed) r
            FROM base b LEFT JOIN rlist l USING(vehicle_frame_no) GROUP BY 1 ORDER BY yc DESC
        """).fetchall()
        trows, mode_rr = [], []
        for rm, yc, q, r in rows:
            rr = rate(r, yc)
            mode_rr.append((rm, rr))
            trows.append([rm, f"{yc:,}", f"{fp(rate(q, yc))}{light_q(rate(q, yc))}", f"{fp(rr)}{light_r(rr)}"])
        rpt.table(["责任模式", "应续", "报价率", "续回率"], trows, ["---", "--:", "--:", "--:"])
        v = [(m, x) for m, x in mode_rr if x is not None]
        if v:
            hi, lo = max(v, key=lambda x: x[1]), min(v, key=lambda x: x[1])
            rpt.concl(f"续回率最高 {hi[0]}（{fp(hi[1])}）、最低 {lo[0]}（{fp(lo[1])}）。责任模式=清单指派口径，与电销实际成交渠道（5.5）不同。")

    # 5.2 报价提前天数
    rpt.add("### 5.2 报价提前天数 × 续回率")
    rows = con.execute("""
        WITH b AS (SELECT *, CASE WHEN quoted=0 THEN NULL ELSE DATE_DIFF('day', CAST(first_quote_time AS DATE), CAST(expiry_date AS DATE)) END lead FROM base)
        SELECT CASE WHEN quoted=0 THEN 'g.未报价' WHEN lead<0 THEN 'f.已过期才报' WHEN lead>=30 THEN 'a.≥30天'
                    WHEN lead>=21 THEN 'b.21~29天' WHEN lead>=14 THEN 'c.14~20天' WHEN lead>=7 THEN 'd.7~13天' ELSE 'e.0~6天' END bk,
               COUNT(*) yc, SUM(renewed) r FROM b GROUP BY 1 ORDER BY 1
    """).fetchall()
    trows, bkt = [], []
    for bk, yc, r in rows:
        rr = rate(r, yc)
        bkt.append((bk, rr))
        trows.append([bk[2:], f"{yc:,}", f"{r:,}", f"{fp(rr)}{light_r(rr)}"])
    rpt.table(["提前桶", "车架", "续回", "续回率"], trows, ["---", "--:", "--:", "--:"])
    qb = [(b[2:], v) for b, v in bkt if b[0] in "abcde" and v is not None]
    noq = next((v for b, v in bkt if b.startswith("g.")), None)
    if qb:
        best = max(qb, key=lambda x: x[1])
        rpt.concl(f"提前「{best[0]}」续回率最高（{fp(best[1])}）；未报价仅 {fp(noq)}。")

    # 5.3 报价保费/上年保费 比值
    rpt.add("### 5.3 报价保费 / 上年保费 比值 × 续回率")
    rows = con.execute(f"""
        WITH prior AS (SELECT policy_no, SUM(premium) pp FROM read_parquet('{POL}') GROUP BY 1),
        ql AS (SELECT vehicle_frame_no, TRY_CAST(final_quote_premium AS DOUBLE) qp FROM read_parquet('{Q}')
               WHERE quote_time >= TIMESTAMP '{QUOTE_WINDOW_START}'
               QUALIFY ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC)=1),
        j AS (SELECT b.renewed, ql.qp/NULLIF(p.pp,0) ratio FROM base b JOIN prior p ON b.source_policy_no=p.policy_no
              JOIN ql USING(vehicle_frame_no) WHERE ql.qp>0 AND p.pp>0)
        SELECT CASE WHEN ratio<0.8 THEN 'a.降>20%' WHEN ratio<0.95 THEN 'b.降5-20%' WHEN ratio<1.05 THEN 'c.持平±5%'
                    WHEN ratio<1.2 THEN 'd.升5-20%' ELSE 'e.升>20%' END k, COUNT(*) yc, SUM(renewed) r
        FROM j GROUP BY 1 ORDER BY 1
    """).fetchall()
    if rows:
        trows, ratio_rr = [], []
        for k, yc, r in rows:
            rr = rate(r, yc)
            ratio_rr.append((k[2:], rr))
            trows.append([k[2:], f"{yc:,}", f"{r:,}", f"{fp(rr)}{light_r(rr)}"])
        rpt.table(["报价/上年 比值", "车架", "续回", "续回率"], trows, ["---", "--:", "--:", "--:"])
        v = [(k, x) for k, x in ratio_rr if x is not None]
        if v:
            best = max(v, key=lambda x: x[1])
            rpt.concl(f"比值「{best[0]}」续回率最高（{fp(best[1])}）；两端极值（大幅降价/涨价）续回更弱——价格剧烈波动伤续保。")

    # 5.4 客户结构
    rpt.add("### 5.4 客户结构（客类 × 险别，应续≥30）")
    rows = con.execute("""
        SELECT customer_category, coverage_combination, COUNT(*) yc, SUM(renewed) r
        FROM base GROUP BY 1,2 HAVING COUNT(*)>=30 ORDER BY yc DESC LIMIT 12
    """).fetchall()
    trows = [[cc, cov, f"{yc:,}", f"{fp(rate(r, yc))}{light_r(rate(r, yc))}"] for cc, cov, yc, r in rows]
    rpt.table(["客户类别", "险别组合", "应续", "续回率"], trows, ["---", "---", "--:", "--:"])

    # 5.5 电销渠道交叉
    rpt.add("### 5.5 电销渠道交叉（融合销售=电销，仅已续回）")
    rows = con.execute(f"""
        WITH pol AS (SELECT policy_no, MAX(CASE WHEN terminal_source='{TELESALES_TERMINAL}' THEN 1 ELSE 0 END) tele
                     FROM read_parquet('{POL}') GROUP BY 1),
        flow AS (SELECT CASE WHEN sp.tele=1 THEN '电销' ELSE '自营' END pc, CASE WHEN rp.tele=1 THEN '电销' ELSE '自营' END rc
                 FROM base b JOIN pol sp ON b.source_policy_no=sp.policy_no JOIN pol rp ON b.renewed_policy_no=rp.policy_no
                 WHERE b.renewed=1 AND b.renewed_policy_no IS NOT NULL)
        SELECT pc||'→'||rc fl, COUNT(*) c FROM flow GROUP BY 1 ORDER BY c DESC
    """).fetchall()
    if rows:
        tot = sum(c for _, c in rows)
        rpt.table(["上年→续保 渠道流向", "续回单", "占比"], [[f, f"{c:,}", fp(rate(c, tot))] for f, c in rows], ["---", "--:", "--:"])
        switch = sum(c for f, c in rows if f.split("→")[0] != f.split("→")[1])
        dom = max(rows, key=lambda x: x[1])
        rpt.concl(f"主流向 {dom[0]}（{fp(rate(dom[1], tot))}）；跨渠道切换仅 {fp(rate(switch, tot))}——渠道黏性高。")


def section_followup(con, rpt, ctx):
    """六、待跟进清单 + 涨价离谱清单。返回 (act_csv, overdue_csv)。"""
    rpt.add("## 六、待跟进清单（重点）⭐")
    rpt.add()
    pct = con.execute(f"""
        WITH prior AS (SELECT policy_no, SUM(premium) pp, MAX(commercial_pricing_factor) pf FROM read_parquet('{POL}') GROUP BY 1)
        SELECT QUANTILE_CONT(p.pp,0.75), QUANTILE_CONT(p.pf,0.50)
        FROM base b JOIN prior p ON b.source_policy_no=p.policy_no
    """).fetchone()
    p75, p50 = pct
    rpt.add(f"**筛选**：未报价 + 上年保费 ≥ P75（{p75:,.0f} 元） + 上年自主系数 ≤ P50（{p50:.3f}）。")
    rpt.add()
    act_csv = overdue_csv = None
    if not ctx.args.no_action_list:
        act_csv = ctx.out_dir / f"续保待跟进_{ctx.ts}.csv"
        con.execute(f"""
            COPY (
              WITH prior AS (SELECT policy_no, SUM(premium) prior_premium, MAX(commercial_pricing_factor) prior_factor,
                                    ANY_VALUE(insurance_grade) insurance_grade FROM read_parquet('{POL}') GROUP BY 1)
              SELECT b.org_level_3, b.team_name, b.salesman_name, b.customer_category, b.coverage_combination,
                     b.vehicle_frame_no, b.source_policy_no AS policy_no, CAST(b.expiry_date AS DATE) AS insurance_end_date,
                     DATE_DIFF('day', DATE '{ctx.today}', CAST(b.expiry_date AS DATE)) AS days_to_expiry,
                     ROUND(p.prior_premium,2) AS prior_premium, ROUND(p.prior_factor,4) AS prior_factor,
                     p.insurance_grade, 'N/A' AS renewal_mode, 'N/A' AS competition_level
              FROM base b JOIN prior p ON b.source_policy_no=p.policy_no
              WHERE b.quoted=0 AND p.prior_premium >= {p75} AND p.prior_factor <= {p50}
              ORDER BY p.prior_premium DESC
            ) TO '{act_csv}' (HEADER, DELIMITER ',')
        """)
        n = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{act_csv}')").fetchone()[0]
        overdue = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{act_csv}') WHERE days_to_expiry<0").fetchone()[0]
        top = con.execute(f"""
            SELECT org_level_3, salesman_name, customer_category, prior_premium, prior_factor,
                   COALESCE(insurance_grade,'—') g, days_to_expiry FROM read_csv_auto('{act_csv}')
            ORDER BY prior_premium DESC LIMIT 10
        """).fetchall()
        rpt.add(f"- **清单规模 {n:,} 户** → `{act_csv.name}`")
        rpt.add()
        rpt.table(["机构", "业务员", "客类", "上年保费", "上年系数", "评级", "距到期"],
                  [[o, s, c, f"{pp:,.0f}", f"{pf:.3f}", g, (f"{d}天" if d >= 0 else f"已过期{-d}天")]
                   for o, s, c, pp, pf, g, d in top],
                  ["---", "---", "---", "--:", "--:", ":-:", "--:"])

        # 涨价离谱客户清单（系数上升 + 风险等级大幅变差≥2档）
        overdue_csv = ctx.out_dir / f"续保涨价离谱_{ctx.ts}.csv"
        con.execute(f"""
            COPY (
              WITH ql AS (SELECT vehicle_frame_no, insurance_grade qg, customer_category FROM read_parquet('{Q}')
                          WHERE quote_time >= TIMESTAMP '{QUOTE_WINDOW_START}' AND pricing_factor_yoy_change='系数上升'
                          QUALIFY ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC)=1),
              prior AS (SELECT policy_no, ANY_VALUE(insurance_grade) pg, MAX(commercial_pricing_factor) pf FROM read_parquet('{POL}') GROUP BY 1)
              SELECT b.org_level_3, b.team_name, b.salesman_name, b.vehicle_frame_no, b.customer_category,
                     p.pg AS 上年风险等级, q.qg AS 报价风险等级, (ascii(q.qg)-ascii(p.pg)) AS 变差档数,
                     ROUND(p.pf,4) AS 上年自主系数, DATE_DIFF('day', DATE '{ctx.today}', CAST(b.expiry_date AS DATE)) AS days_to_expiry,
                     b.renewed AS 已续回
              FROM base b JOIN ql q USING(vehicle_frame_no) JOIN prior p ON b.source_policy_no=p.policy_no
              WHERE q.qg IS NOT NULL AND p.pg IS NOT NULL AND q.qg<>'X' AND p.pg<>'X' AND ascii(q.qg)-ascii(p.pg) >= 2
              ORDER BY (ascii(q.qg)-ascii(p.pg)) DESC, p.pf
            ) TO '{overdue_csv}' (HEADER, DELIMITER ',')
        """)
        no = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{overdue_csv}')").fetchone()[0]
        rpt.concl(f"**{n:,} 户**未报价金矿客户{('，其中 ' + str(overdue) + ' 户已过期需抢救') if overdue else ''}，立即派单。"
                  f"另：**涨价离谱客户 {no:,} 户**（涨价 + 风险等级大幅变差≥2档）→ `{overdue_csv.name}`，"
                  f"建议核保复核风险评分是否合理、是否值得保。")
    else:
        rpt.add("（--no-action-list：未落 CSV）")
        rpt.add()
    return act_csv, overdue_csv
