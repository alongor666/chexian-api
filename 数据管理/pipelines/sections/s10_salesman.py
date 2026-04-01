"""板块10：业务员维度（三级机构专属）

条件触发：仅当 --filter 含三级机构时自动加入
内容：人数趋势、人均产能、Top/Bottom 排名、客户类别集中度、增长率
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from diagnose_common import (
    GLOB, EARNED, POLICY_TERM, EARNED_DAYS,
    fw, fp, fi, fc, light, kpi_select, query_kpi,
    TH_VC, TH_LR, TH_IR, TH_AC_CARGO,
)


def run(ctx, rpt, collected, silent=False):
    """板块10：业务员维度分析"""
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    yr_where = ctx.yr_where

    # ================================================================
    # 10.1 人数与人均产能趋势
    # ================================================================
    yr_staff = []
    for yr in years:
        r = con.execute(f"""
        SELECT
            COUNT(DISTINCT 业务员)::INT AS 人数,
            COUNT(DISTINCT 保单号)::INT AS 保单数,
            ROUND(SUM(保费)/10000, 1) AS 保费万,
            ROUND(SUM(保费)/10000/NULLIF(COUNT(DISTINCT 业务员),0), 1) AS 人均保费万,
            ROUND(COUNT(DISTINCT 保单号)*1.0/NULLIF(COUNT(DISTINCT 业务员),0), 0)::INT AS 人均件数,
            ROUND(SUM({EARNED})/10000, 1) AS 满期保费万,
            ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)*100, 1) AS 满期赔付率,
            ROUND(SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0)*100, 1) AS 费用率
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND {yr_where(yr)}
        """).fetchone()
        yr_staff.append((yr,) + r)

    if not silent:
        rpt.add("## 10. 业务员维度\n")
        rpt.add("### 10.1 人数与人均产能趋势\n")
        rpt.add("| 年份 | 人数 | 保单数 | 保费 | 人均保费 | 人均件数 | 满期赔付率 | 费用率 | 变动成本率 |")
        rpt.add("| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for row in yr_staff:
            yr, cnt, pols, prem, avg_p, avg_n, _ep, lr, fr = row
            vc = (lr or 0) + (fr or 0)
            rpt.add(f"| {yr} | {fi(cnt)} | {fi(pols)} | {fw(prem)} | {fw(avg_p)} | {fi(avg_n)} | {fp(lr)}{light(lr, TH_LR)} | {fp(fr)} | {fp(vc)}{light(vc, (85,91,94))} |")
        rpt.add()

        # 增长率
        if len(yr_staff) >= 2:
            first, last = yr_staff[0], yr_staff[-1]
            if first[1] and last[1] and first[1] > 0:
                staff_g = (last[1] - first[1]) / first[1] * 100
                prem_g = ((last[3] or 0) - (first[3] or 0)) / (first[3] or 1) * 100
                prod_g = ((last[4] or 0) - (first[4] or 0)) / (first[4] or 1) * 100
                rpt.add(f"> {years[0]}→{years[-1]} 增长率：人数 {staff_g:+.1f}%，保费 {prem_g:+.1f}%，人均产能 {prod_g:+.1f}%\n")

    # ================================================================
    # 10.2 Top 15 业务员（最新年 or 全年份汇总）
    # ================================================================
    top_n = 15
    top_rows = con.execute(f"""
    SELECT
        业务员,
        COUNT(DISTINCT 保单号)::INT AS 保单数,
        ROUND(SUM(保费)/10000, 1) AS 保费万,
        ROUND(AVG(CASE WHEN 保费>0 THEN 保费 END), 0)::INT AS 件均保费,
        ROUND(SUM({EARNED})/10000, 1) AS 满期保费万,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)*100, 1) AS 满期赔付率,
        ROUND(SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0)*100, 1) AS 费用率,
        ROUND(SUM(COALESCE(赔案件数,0) * CAST({POLICY_TERM} AS DOUBLE)
              / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0))
              / NULLIF(COUNT(DISTINCT 保单号), 0) * 100, 2) AS 满期出险率,
        COUNT(DISTINCT 客户类别)::INT AS 客户类别数,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM(COALESCE(赔案件数,0)),0), 0)::INT AS 案均赔款
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) = {years[-1]}
    GROUP BY 业务员
    ORDER BY SUM(保费) DESC
    LIMIT {top_n}
    """).fetchall()

    if not silent:
        rpt.add(f"### 10.2 Top {top_n} 业务员（{years[-1]}年）\n")
        rpt.add("| 排名 | 业务员 | 保单数 | 保费 | 件均保费 † | 赔付率 | 费用率 | 出险率 | 案均 † | 客类数 |")
        rpt.add("| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for i, row in enumerate(top_rows, 1):
            name, pols, prem, avg_p, ep, lr, fr, ir, cat_n, avg_c = row
            # 去掉工号前缀，只留姓名
            short = name
            if len(name) > 6 and name[:6].isdigit():
                short = name[6:] if len(name) > 9 else name[9:]
            if not short:
                short = name
            rpt.add(f"| {i} | {short} | {fi(pols)} | {fw(prem)} | {fi(avg_p)} | {fp(lr)}{light(lr, TH_LR)} | {fp(fr)} | {fp(ir)}{light(ir, TH_IR)} | {fi(avg_c)} | {fi(cat_n)} |")
        rpt.add()

    # ================================================================
    # 10.3 Bottom 10 业务员（赔付率最高，保费>10万）
    # ================================================================
    bottom_rows = con.execute(f"""
    SELECT
        业务员,
        COUNT(DISTINCT 保单号)::INT AS 保单数,
        ROUND(SUM(保费)/10000, 1) AS 保费万,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)*100, 1) AS 满期赔付率,
        ROUND(SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0)*100, 1) AS 费用率,
        ROUND(SUM(COALESCE(赔案件数,0) * CAST({POLICY_TERM} AS DOUBLE)
              / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0))
              / NULLIF(COUNT(DISTINCT 保单号), 0) * 100, 2) AS 满期出险率,
        ROUND(SUM({EARNED})*(1-SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)
              -SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0))/10000, 1) AS 满期边际贡献额
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) = {years[-1]}
    GROUP BY 业务员
    HAVING SUM(保费) > 100000
    ORDER BY SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0) DESC
    LIMIT 10
    """).fetchall()

    if not silent:
        rpt.add(f"### 10.3 赔付率最高 Top 10（{years[-1]}年，保费>10万）\n")
        rpt.add("| 业务员 | 保单数 | 保费 | 赔付率 | 费用率 | 出险率 | 边际贡献额 |")
        rpt.add("| :--- | ---: | ---: | ---: | ---: | ---: | ---: |")
        for row in bottom_rows:
            name, pols, prem, lr, fr, ir, em = row
            short = name[9:] if len(name) > 9 and name[:9].isdigit() else (name[6:] if len(name) > 6 and name[:6].isdigit() else name)
            if not short:
                short = name
            rpt.add(f"| {short} | {fi(pols)} | {fw(prem)} | {fp(lr)}{light(lr, TH_LR)} | {fp(fr)} | {fp(ir)}{light(ir, TH_IR)} | {fw(em)} |")
        rpt.add()

    # ================================================================
    # 10.4 客户类别集中度（按业务员×客户类别）
    # ================================================================
    conc_rows = con.execute(f"""
    WITH salesman_cat AS (
        SELECT 业务员, 客户类别,
            ROUND(SUM(保费)/10000, 1) AS 保费万,
            COUNT(DISTINCT 保单号)::INT AS 保单数
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND YEAR(签单日期) = {years[-1]}
        GROUP BY 业务员, 客户类别
    ),
    salesman_total AS (
        SELECT 业务员, SUM(保费万) AS 总保费万
        FROM salesman_cat GROUP BY 业务员
    ),
    top_cat AS (
        SELECT sc.业务员, sc.客户类别, sc.保费万, sc.保单数,
            ROUND(sc.保费万 / NULLIF(st.总保费万, 0) * 100, 1) AS 占比,
            ROW_NUMBER() OVER (PARTITION BY sc.业务员 ORDER BY sc.保费万 DESC) AS rn
        FROM salesman_cat sc JOIN salesman_total st ON sc.业务员 = st.业务员
        WHERE st.总保费万 > 10
    )
    SELECT 客户类别,
        COUNT(DISTINCT 业务员)::INT AS 涉及人数,
        ROUND(SUM(保费万), 1) AS 保费万,
        ROUND(AVG(占比), 1) AS 平均占比
    FROM top_cat WHERE rn <= 3
    GROUP BY 客户类别
    ORDER BY SUM(保费万) DESC
    """).fetchall()

    if not silent:
        rpt.add(f"### 10.4 客户类别集中度（{years[-1]}年，Top3 客户类别/人）\n")
        rpt.add("| 客户类别 | 涉及人数 | 保费 | 平均占比 |")
        rpt.add("| :--- | ---: | ---: | ---: |")
        for row in conc_rows:
            cat, cnt, prem, pct = row
            rpt.add(f"| {cat} | {fi(cnt)} | {fw(prem)} | {fp(pct)} |")
        rpt.add()

    # ================================================================
    # 10.5 业务员增长率（YoY，保费>5万筛选）
    # ================================================================
    if len(years) >= 2:
        prev_yr, curr_yr = years[-2], years[-1]
        growth_rows = con.execute(f"""
        WITH prev AS (
            SELECT 业务员, SUM(保费) AS prem
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND {yr_where(prev_yr)}
            GROUP BY 业务员 HAVING SUM(保费) > 50000
        ),
        curr AS (
            SELECT 业务员, SUM(保费) AS prem
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND {yr_where(curr_yr)}
            GROUP BY 业务员 HAVING SUM(保费) > 50000
        )
        SELECT COALESCE(c.业务员, p.业务员) AS 业务员,
            ROUND(COALESCE(p.prem,0)/10000, 1) AS 上年保费万,
            ROUND(COALESCE(c.prem,0)/10000, 1) AS 本年保费万,
            ROUND((COALESCE(c.prem,0) - COALESCE(p.prem,0)) / NULLIF(p.prem,0) * 100, 1) AS 增长率
        FROM curr c FULL OUTER JOIN prev p ON c.业务员 = p.业务员
        ORDER BY COALESCE(c.prem,0) - COALESCE(p.prem,0) DESC
        LIMIT 10
        """).fetchall()

        if not silent:
            rpt.add(f"### 10.5 业务员保费增长 Top 10（{prev_yr}→{curr_yr}，保费>5万）\n")
            rpt.add(f"| 业务员 | {prev_yr}年 | {curr_yr}年 | 增长率 |")
            rpt.add("| :--- | ---: | ---: | ---: |")
            for row in growth_rows:
                name, prev_p, curr_p, g = row
                short = name[9:] if len(name) > 9 and name[:9].isdigit() else (name[6:] if len(name) > 6 and name[:6].isdigit() else name)
                if not short:
                    short = name
                g_str = f"{g:+.1f}%" if g is not None else "新增"
                rpt.add(f"| {short} | {fw(prev_p)} | {fw(curr_p)} | {g_str} |")
            rpt.add()

    return {}
