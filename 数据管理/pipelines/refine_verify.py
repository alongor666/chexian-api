#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
refine_verify.py — 诊断报告草案的「解析 + 回查校验 + 事实包输出」（确定性部分）

定位：diagnose-report-refine 技能的确定性引擎。输入一份已生成的诊断报告 md 草案，
输出结构化「事实包」JSON（供 AI 按方法论写隐性结论），并对成熟口径表回查 Parquet 核验
（防 AI 看错数字 / 生成器口径漂移）。**本脚本不写判断**——精准的现象语言由 AI 在
`.claude/commands/diagnose-report-refine.md` 的方法论下产出。

分工铁律：数字由本脚本回查保真，判断由 AI 方法论保质。AI 一律引用本脚本的事实包，
不肉眼读 md 表格，杜绝看错。

用法：
  python3 数据管理/pipelines/refine_verify.py --report <报告.md>           # 输出事实包 JSON 到 stdout
  python3 数据管理/pipelines/refine_verify.py --report <报告.md> --no-verify  # 跳过 Parquet 回查

设计文档：docs/plans/2026-06-08-diagnose-report-refine-design.md
"""

import argparse
import json
import re
import sys
from datetime import date
from calendar import monthrange
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from renewal_common import RT, rate  # noqa: E402  复用数据源路径与率值聚合口径

# 亮灯/emoji/加粗/千分位/百分号 —— 解析数字时一律剥离
_NOISE = re.compile(r"[*,%\s]|🔴|🟡|🔵|🟢")


def _clean(cell: str) -> str:
    return _NOISE.sub("", str(cell)).strip()


def _num(cell):
    """单元格 → 数字（int/float）；非数字（如业务员名）原样返回，空/占位返回 None。"""
    s = _clean(cell)
    if s in ("", "-", "—", "N/A", "NA"):
        return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return s  # 业务员名等文本列


def _split_row(line: str):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_meta(text: str) -> dict:
    """从报告头部解析元信息：域 / 视角 / 机构 / 年月 / 客户类别 / 数据截止日。"""
    meta = {"domain": None, "view": None, "org": None, "customer_category": None,
            "year": None, "month": None, "cutoff": None}
    # 生成命令行（最权威）：> **生成** `diagnose_renewal.py --org-report --org 乐山`
    gen = re.search(r"diagnose_renewal\.py([^\n`]*)", text)
    if gen:
        meta["domain"] = "renewal"
        args_str = gen.group(1)
        if "--org-report" in args_str:
            meta["view"] = "org-report"
        elif "--branch-report" in args_str:
            meta["view"] = "branch-report"
        m = re.search(r"--org\s+(\S+)", args_str)
        if m:
            meta["org"] = m.group(1)
    # 标题：# 续保诊断 · 三级机构视角 · 乐山 · 2026年6月
    title = re.search(r"^#\s+(.+)$", text, re.M)
    if title:
        t = title.group(1)
        ym = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月", t)
        if ym:
            meta["year"], meta["month"] = int(ym.group(1)), int(ym.group(2))
        if not meta["org"]:
            # 视角后、年月前的那段视作机构名（分公司视角无机构 → 留空）
            parts = [p.strip() for p in t.split("·")]
            for p in parts:
                if "视角" not in p and "续保诊断" not in p and "年" not in p and p:
                    meta["org"] = p
                    break
    # 客户类别「非营业个人客车」
    cc = re.search(r"客户类别[「\"]([^」\"]+)[」\"]", text)
    if cc:
        meta["customer_category"] = cc.group(1)
    # 数据截止日 2026-06-08
    cutoff = re.search(r"数据截止日[*\s]*(\d{4}-\d{2}-\d{2})", text)
    if cutoff:
        meta["cutoff"] = cutoff.group(1)
    return meta


def parse_sections(text: str):
    """切分 ## section，返回 [(idx_cn, title, body_text), ...]（仅含表格的业务 section）。"""
    out = []
    chunks = re.split(r"\n##\s+", text)
    for ch in chunks[1:]:  # 跳过标题前言
        head, _, body = ch.partition("\n")
        # head 形如「一、当月已到期续保表」；附录/口径表跳过
        if "附录" in head or "口径" in head:
            continue
        out.append((head.strip(), body))
    return out


def parse_table(body: str):
    """提取 section 内第一张 md 表格 → (headers, data_rows, total_row)。无表格返回 (None, [], None)。"""
    lines = body.splitlines()
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            headers = _split_row(ln)
            rows = []
            for ln2 in lines[i + 2:]:
                if not ln2.lstrip().startswith("|"):
                    break
                rows.append(_split_row(ln2))
            total = None
            data = []
            for r in rows:
                if r and "合计" in _clean(r[0]):
                    total = r
                else:
                    data.append(r)
            return headers, data, total
    return None, [], None


def _col_index(headers, *keywords):
    """返回第一个表头包含任一 keyword 的列下标；找不到返回 None。"""
    for i, h in enumerate(headers):
        hc = _clean(h)
        if any(k in hc for k in keywords):
            return i
    return None


def _assert_funnel_layout(headers, title):
    """漏斗三列位置守卫：第 2/3/4 列恒为 应续 / 报价 / 续回(保)。列序漂移即 fail-loud，
    避免 progress 表无 Parquet 回查兜底时按固定位 1/2/3 静默读错列（P2 review 加固）。"""
    if len(headers) < 4:
        raise ValueError(f"表「{title}」列数 {len(headers)} < 4，无法定位 应续/报价/续回 漏斗列")
    for pos, kws in [(1, ("应续",)), (2, ("报价",)), (3, ("续保", "续回"))]:
        hc = _clean(headers[pos])
        if not any(k in hc for k in kws):
            raise ValueError(
                f"表「{title}」第 {pos + 1} 列表头「{headers[pos]}」不含预期关键词 {kws}；"
                f"漏斗列序疑似变动，拒绝按固定位静默读数（请同步更新 table_facts）")


def table_facts(idx_cn: str, title: str, headers, data, total) -> dict:
    """构建单表事实结构：漏斗 / 合计率 / 最大异常点 / 缺口 / 对比落差。

    漏斗三级用位置（第2/3/4列恒为 应续/报价数/续回数，跨 7 表稳定，先经 _assert_funnel_layout
    守卫）；率与缺口列用表头匹配。
    """
    maturity = "matured" if "已到期" in title else "progress"
    _assert_funnel_layout(headers, title)
    i_yc, i_q, i_r = 1, 2, 3
    i_qr = _col_index(headers, "报价率")
    i_rr = _col_index(headers, "续保率")
    i_unq = _col_index(headers, "未报价")
    i_imp = _col_index(headers, "影响度")

    def cell(row, i):
        return _num(row[i]) if row and i is not None and i < len(row) else None

    fact = {"idx": idx_cn, "title": title, "maturity": maturity}
    if total:
        fact["total"] = {
            "yc": cell(total, i_yc), "quoted": cell(total, i_q), "renewed": cell(total, i_r),
            "quote_rate": cell(total, i_qr), "renew_rate": cell(total, i_rr),
        }
        fact["funnel"] = [cell(total, i_yc), cell(total, i_q), cell(total, i_r)]

    # 精简每行（供 AI 引用具体业务员/机构）
    rows = []
    for r in data:
        name = _clean(r[0])
        rows.append({
            "name": name, "yc": cell(r, i_yc), "quoted": cell(r, i_q), "renewed": cell(r, i_r),
            "quote_rate": cell(r, i_qr), "renew_rate": cell(r, i_rr),
            "unquoted": cell(r, i_unq), "impact": cell(r, i_imp),
        })
    fact["rows"] = rows

    # 最大异常点：有影响度列→影响度最高；否则→应续较大里续保率最低
    valid = [x for x in rows if isinstance(x["yc"], (int, float))]
    if i_imp is not None:
        cand = [x for x in valid if isinstance(x["impact"], (int, float))]
        if cand:
            top = max(cand, key=lambda x: x["impact"])
            fact["top_anomaly"] = {"name": top["name"], "metric": "续保影响度",
                                   "value": top["impact"], "quote_rate": top["quote_rate"],
                                   "renew_rate": top["renew_rate"]}
    else:
        cand = [x for x in valid if isinstance(x["renew_rate"], (int, float)) and (x["yc"] or 0) >= 5]
        if cand:
            low = min(cand, key=lambda x: x["renew_rate"])
            fact["top_anomaly"] = {"name": low["name"], "metric": "续保率",
                                   "value": low["renew_rate"], "quote_rate": low["quote_rate"],
                                   "renew_rate": low["renew_rate"]}

    # 缺口（有未报价列）：合计未报价 + 未报价最高行
    if i_unq is not None and total:
        unq_rows = [x for x in valid if isinstance(x["unquoted"], (int, float))]
        top_unq = max(unq_rows, key=lambda x: x["unquoted"]) if unq_rows else None
        fact["gap"] = {"unquoted": cell(total, i_unq),
                       "unquoted_top": ({"name": top_unq["name"], "value": top_unq["unquoted"]}
                                        if top_unq else None)}

    # 对比落差：已报价路径续保率 vs 未报价路径续保率。
    # 表内只有 应续/报价/续回三列，无法把续回拆成「报价内续回 / 未报价续回」；
    # 实测 is_renewed ⊄ is_quoted（约 0.16% 续回未经报价），故续回/报价仅为已报价路径续保率的
    # **上界近似**。matured 表会被 verify_renewal 的精确交叉拆分覆盖（见 build_facts）。
    if total and isinstance(fact.get("total", {}).get("quoted"), (int, float)):
        q, r = fact["total"]["quoted"], fact["total"]["renewed"]
        if q:
            fact["contrast"] = {
                "quoted_renew_rate": rate(r, q),
                "unquoted_renew_rate": None,
                "approx": True,
                "assumption": "续回⊆报价上界（约 0.16% 续回未经报价，故已报价路径续保率略高估；"
                              "matured 表已由回查给精确值）",
            }

    return fact


# ---------- 续保 adapter：回查 renewal_tracker 核验成熟口径表 ----------

def _renewal_aggregate(con, start: date, end: date, org: str, cc: str):
    """独立朴素 SQL 重算窗口内去重车架号的 应续/已报价/已续回 + 续回×报价交叉拆分
    （与生成器同口径、独立实现）。

    参数化防注入（P1 review）：org/cc 来自报告文本（可能含单引号），用 DuckDB 占位符 `?`
    绑定值；日期绑定 date 对象（不拼 `DATE '...'` 字面量）；ILIKE 用 `'%' || ? || '%'`。
    RT 是项目内常量路径（renewal_common 唯一事实源，非外部输入），保留 f-string。

    返回 (应续, 已报价, 已续回, 续回且报价, 续回未报价)。后两项供精确对比落差——
    实测 is_renewed ⊄ is_quoted（约 0.16% 续回未经报价），不能假设未报价续保率恒 0。
    """
    where = ["expiry_date >= ?", "expiry_date <= ?"]
    params = [start, end]
    if org:
        where.append("org_level_3 ILIKE '%' || ? || '%'")
        params.append(org)
    if cc:
        where.append("customer_category = ?")
        params.append(cc)
    sql = f"""
        WITH d AS (
          SELECT vehicle_frame_no, MAX(is_quoted::INT) q, MAX(is_renewed::INT) r
          FROM read_parquet('{RT}')
          WHERE {' AND '.join(where)}
          GROUP BY vehicle_frame_no
        )
        SELECT COUNT(*), COALESCE(SUM(q),0), COALESCE(SUM(r),0),
               COALESCE(SUM(CASE WHEN r=1 AND q=1 THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN r=1 AND q=0 THEN 1 ELSE 0 END),0)
        FROM d
    """
    return con.execute(sql, params).fetchone()


def verify_renewal(meta: dict, facts: list) -> dict:
    """回查成熟口径表（当月已到期 / 当年已到期）合计 vs Parquet 直查。

    同时为每张成熟表算**精确对比落差**（续回×报价交叉拆分），放进 `exact_contrast`（keyed by idx），
    由 build_facts 合并进事实包——matured 表用精确值替换表内上界近似，progress 表沿用近似。
    """
    if meta["domain"] != "renewal" or not meta["org"] or not meta["cutoff"] or not meta["year"]:
        return {"checked": [], "ok": True, "skipped": "缺机构/截止日/年份，无法回查", "exact_contrast": {}}
    try:
        import duckdb
    except ImportError:
        return {"checked": [], "ok": True, "skipped": "duckdb 不可用", "exact_contrast": {}}

    cutoff = date.fromisoformat(meta["cutoff"])
    org, cc, year = meta["org"], meta["customer_category"], meta["year"]
    windows = {}
    if meta.get("month"):
        m_start = date(year, meta["month"], 1)
        windows["当月已到期"] = (m_start, cutoff)
    windows["当年已到期"] = (date(year, 1, 1), cutoff)

    con = duckdb.connect()
    details, exact_contrast, ok = [], {}, True
    for f in facts:
        if f["maturity"] != "matured" or "total" not in f:
            continue
        win = next((w for w in windows if w in f["title"]), None)
        if not win:
            continue
        start, end = windows[win]
        yc, q, r, rq, ru = _renewal_aggregate(con, start, end, org, cc)
        for field, rep, pq in [("yc", f["total"]["yc"], yc),
                               ("quoted", f["total"]["quoted"], q),
                               ("renewed", f["total"]["renewed"], r)]:
            match = (rep == pq)
            ok = ok and match
            details.append({"table": f["idx"], "title": f["title"], "field": field,
                            "report": rep, "parquet": pq, "match": match})
        # 精确对比落差：已报价路径=续回且报价/报价；未报价路径=续回未报价/未报价
        exact_contrast[f["idx"]] = {
            "quoted_renew_rate": rate(rq, q),
            "unquoted_renew_rate": rate(ru, yc - q),
            "source": "parquet_exact",
        }
    con.close()
    return {"checked": sorted({d["title"] for d in details}), "ok": ok,
            "details": details, "exact_contrast": exact_contrast}


def build_facts(report_path: Path, do_verify: bool = True) -> dict:
    text = report_path.read_text(encoding="utf-8")
    meta = parse_meta(text)
    facts = []
    for head, body in parse_sections(text):
        idx_cn, _, title = head.partition("、")
        headers, data, total = parse_table(body)
        if not headers:
            continue
        facts.append(table_facts(idx_cn or head, title or head, headers, data, total))
    if do_verify:
        verify = verify_renewal(meta, facts)
    else:
        verify = {"checked": [], "ok": True, "skipped": "--no-verify", "exact_contrast": {}}
    # matured 表用回查精确对比落差覆盖表内上界近似（immutable：构造新 dict，不原地改）
    exact = verify.get("exact_contrast", {})
    verify_out = {k: v for k, v in verify.items() if k != "exact_contrast"}
    tables = [{**f, "contrast": exact[f["idx"]]} if f["idx"] in exact else f for f in facts]
    return {"meta": meta, "tables": tables, "verify": verify_out}


def main():
    ap = argparse.ArgumentParser(description="诊断报告草案解析 + 回查校验 + 事实包输出")
    ap.add_argument("--report", required=True, help="已生成的诊断报告 .md 路径")
    ap.add_argument("--no-verify", action="store_true", help="跳过 Parquet 回查（无数据环境/测试用）")
    args = ap.parse_args()

    path = Path(args.report)
    if not path.exists():
        sys.exit(f"❌ 报告不存在：{path}")
    try:
        facts = build_facts(path, do_verify=not args.no_verify)
    except ValueError as e:
        sys.exit(f"❌ 报告解析失败（漏斗列序守卫触发）：{e}")
    print(json.dumps(facts, ensure_ascii=False, indent=2))
    if not facts["verify"]["ok"]:
        sys.exit("❌ 回查校验失败：报告数字与 Parquet 不符，禁止据此产出正式版（详见上方 verify.details）")


if __name__ == "__main__":
    main()
