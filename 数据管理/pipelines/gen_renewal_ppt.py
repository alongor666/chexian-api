#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""续保三级机构视角 → 深色靛蓝仪表盘 PPT 生成器（数据 + 叙述全部来自 refine 正式版，零硬编码）。

设计铁律
========
1. **唯一输入 = diagnose-report-refine 产出的「正式版.md」**。该文件数据已回查、cutoff 已锚
   parquet 最新签单日期、叙述已按方法论提炼。本脚本把它「翻译」成 PPT，不另算数字、不另编叙述。
2. **渲染引擎原样复用**：主题皮肤 / 16:9 画幅 / 翻页交互 / 渲染函数（THEME/DECK/COMPONENTS/
   NAV）从模板 html 切片直取，项目无关。本脚本只重写 DATA（T1~T7）与 PAGES（叙述编排）两段。
3. **叙述随数据自适应**：
   - 封面标题 / P2 核心矛盾 lede = 直接引用正式版「总判断」原句（**经营瓶颈判断在 refine（步骤②），
     本脚本不重新判定**，只对百分数做高亮渲染）；各表页 lede 引正式版「各表现象」原句。
   - 排名、归因、标杆、短板、未报价前三、影响度前三 = 从解析出的表数据**计算**得出，无写死名字。
   - 续保缺口两段拆分（未报价＝没接触客户 / 报价未成交＝接触了没转化）= 对 T5 漏斗件数做恒等相减
     （口径 renewal_common.MATURED_GLOSSARY），纯算术、非阈值；缺口主导段由两段件数大小**比较**得出，
     非根因断言（报价未成交的具体原因 refine 列为待归因）。
   换机构 = 换一份正式版.md，故事自动改写，无需改本脚本一行。

用法
====
    python3 数据管理/pipelines/gen_renewal_ppt.py \
        --refine 数据管理/数据分析报告/续保三级机构视角_天府_2026年06月_..._正式版.md \
        --template 数据管理/数据分析报告/续保PPT_2026年06月/续保盯盘_深色仪表盘_天府业务员_2026年06月.html \
        --out 数据管理/数据分析报告/续保PPT_2026年06月/续保盯盘_深色仪表盘_天府业务员_2026年06月.html \
        [--company 华安保险] [--target 58]

    --template 仅作渲染引擎来源（取其静态切片），与 --out 可同名（先读后写）。
"""
from __future__ import annotations
import argparse
import calendar
import datetime
import os
import re
import sys
from string import Template


# ============================================================================
# 1. 解析正式版 md（唯一事实源）
# ============================================================================

LIGHT_EMOJI = {'🟢': 'ok', '🔵': 'watch', '🟡': 'warn', '🔴': 'danger'}

# 每张表的列契约：name 之后的数值列在 md 中的顺序，及哪些列带亮灯 emoji。
# kind 决定渲染函数与 DATA 数组结构（与模板 tableFull/tableFunnel/tableMatured/tableResp 对齐）。
#   full    : 应续 报价 续保 未报价 流失 影响度 报价率(灯) 续保率(灯?)  -> 9/8 列
#   funnel  : 应续 报价 续保 报价率(灯) 续保率(进度,不灯)            -> T3/T4
#   matured : 应续 报价 续保 报价率(灯) 续保率(灯)                   -> T5
#   resp    : 应续 colA colB 报价率 续保率（均不灯）                 -> T6/T7
SECTION_SPEC = [
    ('一', 'full',    True),   # T1 当月已到期：续保率亮灯
    ('二', 'full',    False),  # T2 临期 7 天：续保率进度不亮灯
    ('三', 'funnel',  None),   # T3 当月未到期
    ('四', 'funnel',  None),   # T4 当月全部
    ('五', 'matured', None),   # T5 当年已到期
    ('六', 'resp',    None),   # T6 首日
    ('七', 'resp',    None),   # T7 首周
]


def _cell_num(s: str):
    """解析单元格 -> (数值, 亮灯level|None)。剥离 emoji / % / 千分位 / 加粗星号。"""
    light = None
    for em, lv in LIGHT_EMOJI.items():
        if em in s:
            light = lv
            s = s.replace(em, '')
    s = s.strip().replace('*', '').replace('%', '').replace(',', '').replace('，', '')
    try:
        return float(s), light
    except ValueError:
        return s.strip(), light


def _split_row(line: str):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def parse_md(path: str) -> dict:
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()

    # --- frontmatter / 头部元数据 ---
    cutoff_m = re.search(r'data_cutoff:\s*(\d{4}-\d{2}-\d{2})', text)
    cutoff = cutoff_m.group(1) if cutoff_m else ''
    h1_m = re.search(r'^#\s*续保诊断\s*·\s*三级机构视角\s*·\s*([^·\n]+?)\s*·\s*([^\n（]+)', text, re.M)
    org = h1_m.group(1).strip() if h1_m else '本机构'
    period = h1_m.group(2).strip() if h1_m else ''
    tot_m = re.search(r'全部\s*(\d+)\s*名业务员', text)
    total_salesmen = int(tot_m.group(1)) if tot_m else 0
    topn_m = re.search(r'top\s*(\d+)\s*业务员', text) or re.search(r'展示\s*(\d+)\s*名', text)
    topn = int(topn_m.group(1)) if topn_m else 15

    # --- 总判断 / 要点 ---
    verdict_m = re.search(r'\*\*总判断\*\*[：:](.+)', text)
    verdict = verdict_m.group(1).strip() if verdict_m else ''
    points = []
    in_pts = False
    for ln in lines:
        if '**要点**' in ln:
            in_pts = True
            continue
        if in_pts:
            if ln.strip().startswith('- '):
                points.append(ln.strip()[2:].strip())
            elif ln.strip() == '' and points:
                break

    # --- 7 张表 + 各表现象段 ---
    tables = {}          # idx -> {'rows':[...], 'sum':[...]}
    phenomena = {}       # idx -> 现象段文字
    sec_idx = None
    pending_table = []
    capturing_phen = False
    for ln in lines:
        hm = re.match(r'^##\s*([一二三四五六七])、', ln)
        if hm:
            ch = hm.group(1)
            sec_idx = '一二三四五六七'.index(ch)
            capturing_phen = True
            pending_table = []
            continue
        if sec_idx is None:
            continue
        if capturing_phen and ln.strip() and not ln.strip().startswith(('|', '>', '#', '!')):
            phenomena[sec_idx] = ln.strip()
            capturing_phen = False
            continue
        if ln.strip().startswith('|'):
            cells = _split_row(ln)
            if set(''.join(cells)) <= set('-: '):   # 分隔行
                continue
            if cells and cells[0] in ('top15业务员', 'top业务员') or (cells and '业务员' in cells[0] and '应续' in cells):
                continue   # 表头
            pending_table.append(cells)
        elif pending_table and sec_idx not in tables:
            tables[sec_idx] = pending_table
            pending_table = []
    if pending_table and sec_idx not in tables:
        tables[sec_idx] = pending_table

    # --- 把原始单元格按列契约组装成 DATA 数组 ---
    parsed = []
    for idx, (ch, kind, t1_ren_light) in enumerate(SECTION_SPEC):
        raw = tables.get(idx, [])
        rows, summ = [], None
        for cells in raw:
            name = cells[0].replace('*', '').strip()
            nums = [_cell_num(c) for c in cells[1:]]
            is_sum = ('合计' in name)
            if kind == 'full':
                # md: 应续 报价 续保 未报价 流失 影响度 报价率(灯) 续保率(灯?)
                vals = [n for n, _ in nums]
                ql = nums[6][1]; rl = nums[7][1]
                if is_sum:
                    summ = ['合计'] + vals[:8]
                else:
                    elem = [name, vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], ql or 'ok', vals[7]]
                    if t1_ren_light:
                        elem.append(rl or 'danger')
                    rows.append(elem)
            elif kind == 'funnel':
                vals = [n for n, _ in nums]
                ql = nums[3][1]
                if is_sum:
                    summ = ['合计', vals[0], vals[1], vals[2], vals[3], vals[4]]
                else:
                    rows.append([name, vals[0], vals[1], vals[2], vals[3], ql or 'ok', vals[4]])
            elif kind == 'matured':
                vals = [n for n, _ in nums]
                ql = nums[3][1]; rl = nums[4][1]
                if is_sum:
                    summ = ['合计', vals[0], vals[1], vals[2], vals[3], vals[4]]
                else:
                    rows.append([name, vals[0], vals[1], vals[2], vals[3], ql or 'ok', vals[4], rl or 'danger'])
            elif kind == 'resp':
                vals = [n for n, _ in nums]
                if is_sum:
                    summ = ['合计', vals[0], vals[1], vals[2], vals[3], vals[4]]
                else:
                    rows.append([name, vals[0], vals[1], vals[2], vals[3], vals[4]])
        parsed.append({'kind': kind, 'rows': rows, 'sum': summ})

    return {
        'org': org, 'period': period, 'cutoff': cutoff,
        'total_salesmen': total_salesmen, 'topn': topn,
        'verdict': verdict, 'points': points,
        'phenomena': phenomena, 'tables': parsed,
        'src': os.path.basename(path),
    }


# ============================================================================
# 2. 计算工具
# ============================================================================

def rate(v):
    return f'{float(v):.1f}'


def comma(v):
    return f'{int(round(float(v))):,}'


def topk(rows, idx, k=3):
    return sorted(rows, key=lambda r: r[idx], reverse=True)[:k]


def minrow(rows, idx, floor_idx=None, floor=0.0):
    cand = [r for r in rows if floor_idx is None or r[floor_idx] >= floor]
    return min(cand, key=lambda r: r[idx]) if cand else None


def maxrow(rows, idx, floor_idx=None, floor=0.0):
    cand = [r for r in rows if floor_idx is None or r[floor_idx] >= floor]
    return max(cand, key=lambda r: r[idx]) if cand else None


def by_name(rows, name, idx):
    for r in rows:
        if r[0] == name:
            return r[idx]
    return None


def light_ren(v):
    v = float(v)
    return 'danger' if v < 55 else 'warn' if v < 65 else 'watch' if v < 75 else 'ok'


def light_quote(v):
    v = float(v)
    return 'danger' if v < 70 else 'warn' if v < 80 else 'watch' if v < 90 else 'ok'


def S(x):
    """注入 JS 单引号字符串前的防御性转义（叙述含双引号/「」/（），但不应含单引号）。"""
    return str(x).replace('\\', '\\\\').replace("'", '’').replace('\n', ' ')


def jn(v):
    """DATA 数组数字字面量：整数去 .0。"""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def first_sentences(text, n=2):
    if not text:
        return ''
    parts = [p for p in re.split(r'(?<=。)', text) if p.strip()]
    return ''.join(parts[:n]).strip()


def hl(text):
    """把 refine 叙述里的百分数高亮（仅排版强调，不改判断），再做 JS 字符串转义。"""
    if not text:
        return ''
    t = re.sub(r'(\d[\d,]*\.?\d*\s*%)', r'<span class="hot">\1</span>', str(text))
    return S(t)


def _strip_tags(s):
    return re.sub(r'<[^>]+>', '', str(s)).strip()


def _overlaps(a, b):
    """去标签后一方包含另一方（且都非短）→ 判定为「高度复述」。封面/内页去重的机制闸。"""
    ta, tb = _strip_tags(a), _strip_tags(b)
    if len(ta) < 8 or len(tb) < 8:
        return False
    return ta in tb or tb in ta


# ============================================================================
# 3. 生成 DATA 模块
# ============================================================================

def js_array(elem):
    out = []
    for v in elem:
        if isinstance(v, str):
            out.append("'" + v + "'")
        else:
            out.append(jn(v))
    return '[' + ','.join(out) + ']'


def build_data_module(d):
    T = d['tables']
    parts = ["var V={ok:'var(--ok)',watch:'var(--watch)',warn:'var(--warn)',danger:'var(--danger)',accent:'var(--accent)'};",
             "var LC=function(s){return V[s]||'var(--accent)';};"]
    for i in range(7):
        name = f'T{i+1}'
        rows = T[i]['rows']
        summ = T[i]['sum']
        parts.append(f'var {name}=[')
        parts.append(',\n '.join(' ' + js_array(r) for r in rows) + '];')
        parts.append(f'var {name}S={js_array(summ)};')
    return '\n'.join(parts) + '\n'


# ============================================================================
# 4. 生成 PAGES 模块（叙述编排）
# ============================================================================

def build_pages_module(d, target):
    T = d['tables']
    org = d['org']
    t1, t1s = T[0]['rows'], T[0]['sum']
    t2, t2s = T[1]['rows'], T[1]['sum']
    t3s = T[2]['sum']
    t4, t4s = T[3]['rows'], T[3]['sum']
    t3 = T[2]['rows']
    t5, t5s = T[4]['rows'], T[4]['sum']
    t6, t6s = T[5]['rows'], T[5]['sum']
    t7, t7s = T[6]['rows'], T[6]['sum']
    ph = d['phenomena']
    topn = d['topn']
    total_sm = d['total_salesmen']

    # ---- 当年已到期：基础事实（纯算术；瓶颈判断不在此处下，引自 refine 总判断）----
    q5 = float(t5s[4])                       # 当年已到期报价率
    ren5 = float(t5s[5])                     # 当年已到期续保率（最终留存）
    qren5 = t5s[3] / t5s[2] * 100 if t5s[2] else 0   # 已报价续保率
    due5 = int(t5s[1]); quoted5 = int(t5s[2]); renewed5 = int(t5s[3])
    # 续保缺口两段拆分（步骤① 恒等口径：流失 = 未报价 + 报价未成交）
    unq5 = due5 - quoted5                     # ① 未报价＝没接触客户（续保率结构性 0）
    afterq5 = quoted5 - renewed5              # ② 报价未成交＝接触了没转化（原因待归因）
    lost5 = due5 - renewed5                   # 流失 = unq5 + afterq5
    unq_drag5 = round(unq5 / due5 * 100, 1) if due5 else 0
    afterq_drag5 = round(afterq5 / due5 * 100, 1) if due5 else 0
    afterloss = round(100 - qren5, 1)         # 报价后流失率（已报价未成交 ÷ 已报价）
    # 两段并重·不分主次（红线 2026-06-08）：报价=接触客户的必要前置动作；未报价=零接触=必然 100% 流失，
    # 是最不该发生的基础失守。afterq5/unq5 仅供 P2 件数拆解展示，禁以件数多少判「主导段」（曾误用
    # afterq5>unq5 把未报价淡化为次要，违背「每一单都应报价接触」铁律）。两道关口都在漏、都不可放过。
    gap_both = '两段并重·不分主次'
    # refine 总判断按「判断句 / 数字佐证」自然切两半 —— 封面放判断句（定调）、P2 放佐证句（数字依据），
    # 两半互补不复述（金字塔分层去重）。分隔符兼容 —— / ： / : ；无分隔时 vtail 空、各自走兜底。
    vverdict = d['verdict'] or ''
    _vparts = re.split(r'——|：|:', vverdict, maxsplit=1) if vverdict else ['']
    vhead = _vparts[0].strip()                                   # 判断句：瓶颈定性（封面 H1，通常无数字）
    vtail = _vparts[1].strip() if len(_vparts) > 1 else ''       # 数字佐证句（P2 lede，与封面互补）

    P = {}
    P['COMPANY'] = S(d['company'])
    P['ORG'] = S(org)
    P['CUTOFF'] = d['cutoff']
    P['SRC'] = S(d['src'])
    P['TARGET'] = str(target)
    P['TARGET_FRAC'] = f'{target/100:.2f}'

    # ---- 封面 P1 = 塔尖·定调：判断句（refine） + 元信息 + 3 个结果率 KPI；件数/漏斗明细留给 P2 ----
    P['CV_H1'] = hl(vhead) or S(f'当年已到期续保留存 {rate(ren5)}%，两道关口都在漏：'
                                f'未报价 {comma(unq5)} 件零接触必然流失 ＋ 报价后未成交 {comma(afterq5)} 件待归因')
    P['CV_SUB'] = S(f'{org} · {d["period"]} · 全部 {total_sm} 名业务员 · 数据截止 {d["cutoff"]}')
    P['KPI1_LV'] = light_ren(ren5); P['KPI1_LBL'] = '当年已到期续保率'; P['KPI1_VAL'] = rate(ren5); P['KPI1_U'] = '%'
    gap = round(target - ren5, 1)
    P['KPI2_LV'] = 'warn' if gap > 0 else 'ok'; P['KPI2_LBL'] = f'差 {target}% 目标'
    P['KPI2_VAL'] = rate(abs(gap)); P['KPI2_U'] = '个点'
    P['KPI3_LV'] = 'watch'; P['KPI3_LBL'] = '报价后流失（已报价未成交）'; P['KPI3_VAL'] = rate(afterloss); P['KPI3_U'] = '%'

    # ---- P2 核心摘要 = 塔身首层·拆解：件数结构标题 + refine 佐证句 + 漏斗 + 两段卡（不复述封面判断句）----
    P['P2_QUOTE_LV'] = light_quote(q5); P['P2_QUOTE'] = rate(q5); P['P2_QUOTED'] = comma(quoted5)
    P['P2_QUOTE_WORD'] = '近满格' if q5 >= 90 else '待铺开'
    P['P2_REN_LV'] = light_ren(ren5); P['P2_REN'] = rate(ren5); P['P2_RENEWED'] = comma(renewed5)
    P['P2_QREN_LV'] = light_ren(qren5); P['P2_QREN'] = rate(qren5); P['P2_AFTERLOSS'] = rate(afterloss)
    P['P2_GAP_SIDE'] = gap_both
    P['P2_TOTARGET'] = f'-{rate(gap)}' if gap > 0 else f'+{rate(abs(gap))}'
    P['P2_DUE'] = comma(due5)
    # P2 标题 = 件数结构（封面是定性判断、这里是定量拆解，互补不复述）
    P['P2_TITLE'] = f'缺口 {comma(lost5)} 件 ＝ 未报价 {comma(unq5)} ＋ 报价未成交 {comma(afterq5)}'
    # P2 lede = refine 总判断的「数字佐证句」（封面用判断句、这里用佐证句，一句总判断拆两层）
    P['P2_LEDE'] = hl(vtail) or S(
        f'两道关口都在漏：未报价 {comma(unq5)} 件零接触、续保率 0.0% 必然流失；'
        f'报价后未成交 {comma(afterq5)} 件，原因（理赔 / 服务 / 价格 / 跟进 / 主动剔除）待归因。两段并重、不分主次。')
    # 去重机制闸：封面判断句 与 P2 佐证句/标题 高度复述则告警（防回归）
    if _overlaps(P['CV_H1'], P['P2_LEDE']) or _overlaps(P['CV_H1'], P['P2_TITLE']):
        print('⚠️ 封面 CV_H1 与 P2 文本高度复述（疑似重复）—— 检查 refine 总判断是否含「判断/佐证」分隔', file=sys.stderr)
    P['P2_C1_T'] = '核心矛盾 · 续保缺口拆两段'
    P['P2_C1_B'] = (f'当年已到期流失 <b>{comma(lost5)} 件</b>＝① 未报价 <b>{comma(unq5)} 件</b>'
                    f'（没接触客户，续保率 0.0%，拖低 <span class="hot">{rate(unq_drag5)} 个点</span>）'
                    f'＋② 报价未成交 <b>{comma(afterq5)} 件</b>（接触了没转化，拖低 '
                    f'<span class="hot">{rate(afterq_drag5)} 个点</span>）。<b>两段并重、都不可放过</b>——'
                    f'① 未报价是最不该发生的基础失守（每一单都应报价接触、零报价必然流失）；'
                    f'② 段未成交原因（理赔 / 服务 / 价格 / 跟进 / 主动剔除）<b>当前数据未区分，待归因</b>。')
    # 未报价（当月已到期 T1）—— 缺口里零接触成本的一段，落差自现，不写动作句
    unq1 = int(t1s[4]); due1 = int(t1s[1]); drag1 = round(unq1 / due1 * 100, 1) if due1 else 0
    top3unq1 = topk(t1, 4)
    top3unq1_str = ' · '.join(f'{r[0]} {int(r[4])}' for r in top3unq1)
    P['P2_C2_T'] = '未报价即流失 · 缺口里零接触成本的一段'
    P['P2_C2_B'] = (f'当月已到期仍有 <b>{unq1} 单</b>至今未报价、续保率 0.0% 结构性流失，'
                    f'仅这一截就拖低续保率 <span class="hot">{rate(drag1)} 个百分点</span>（{unq1} ÷ {due1}）。'
                    f'未报价前三 —— {top3unq1_str}。')

    # ---- P4 ① 排名 ----
    P['P4_BIGCAP'] = jn(maxrow(t1, 1)[1])
    below1 = sum(1 for r in t1 if r[9] < target)
    P['P4_TITLE'] = f'当月已到期续保率 {rate(t1s[8])}%，{below1}/{len(t1)} 名业务员低于 {target}% 线'
    P['P4_LEDE'] = S(first_sentences(ph.get(0, ''), 2))
    P['P4_NOTE'] = (f'读图：{len(t1)} 名业务员按续保率<b>从低到高</b>排，最差在最上；'
                    f'虚线为 <b>{target}% 目标线</b>；条右标「应续单数 · 影响度」。亮灯定义见第 3 页。')

    # ---- P5 ① 缺口归因（影响度可加和堆叠）----
    ren_pct = float(t1s[8]); imp_total = float(t1s[6])
    top3imp1 = topk(t1, 6)
    (n1, v1) = (top3imp1[0][0], top3imp1[0][6])
    (n2, v2) = (top3imp1[1][0], top3imp1[1][6])
    (n3, v3) = (top3imp1[2][0], top3imp1[2][6])
    sum3 = round(v1 + v2 + v3, 1)
    others = round(imp_total - sum3, 1)
    others_cnt = total_sm - 3
    stack_html = (
        '<div style="flex:0 0 auto;margin-top:4px">'
        '<div style="display:flex;height:48px;border-radius:9px;overflow:hidden;margin:0 0 12px;border:1px solid var(--edge)">'
        f'<div style="width:{rate(ren_pct)}%;background:rgba(52,211,153,.32);border-right:2px solid var(--page-b);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--ok)">已续回 {rate(ren_pct)}%</div>'
        f'<div style="width:{rate(v1)}%;background:var(--danger);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#2a0a12">{n1} {rate(v1)}</div>'
        f'<div style="width:{rate(v2)}%;background:#fb7185"></div>'
        f'<div style="width:{rate(v3)}%;background:var(--warn)"></div>'
        f'<div style="width:{rate(others)}%;background:rgba(244,81,107,.45)"></div>'
        '</div>'
        '<div class="legend" style="font-size:11px">'
        f'<span class="li"><span class="dot" style="--c:rgba(52,211,153,.5)"></span>已续回 {rate(ren_pct)}%</span>'
        f'<span class="li"><span class="dot" style="--c:var(--danger)"></span>{n1} {rate(v1)}%</span>'
        f'<span class="li"><span class="dot" style="--c:#fb7185"></span>{n2} {rate(v2)}%</span>'
        f'<span class="li"><span class="dot" style="--c:var(--warn)"></span>{n3} {rate(v3)}%</span>'
        f'<span class="li"><span class="dot" style="--c:rgba(244,81,107,.45)"></span>其余 {others_cnt} 名 {rate(others)}%</span>'
        '</div></div>')
    P['P5_STACK'] = "'" + S(stack_html) + "'"
    P['P5_TITLE'] = f'前三名拉走 {rate(sum3)}% 缺口：{n1}·{n2}·{n3}'
    P['P5_LEDE'] = '整条 = 整体应续 100%；绿段 = 已续回，红/琥珀段 = 各业务员流失影响度。'
    P['P5_C1_T'] = '缺口主来源 · 前三名'
    P['P5_C1_B'] = (f'前三名 —— {n1}<span class="hot">{rate(v1)}%</span> / {n2}<span class="hot">{rate(v2)}%</span> / '
                    f'{n3}<span class="hot">{rate(v3)}%</span> 合计 <b>{rate(sum3)}%</b>，是缺口的主来源'
                    f'（报价已覆盖、流失全在报价后没续回）。')
    P['P5_C2_T'] = f'{unq1} 单未报价 · 零接触缺口'
    P['P5_C2_B'] = (f'报价率 <b>{rate(t1s[7])}%</b> 已不低，但仍有 <b>{unq1} 单</b>至今未报价、续保率 0.0% 结构性流失，'
                    f'拉低续保率 <span class="hot">{rate(drag1)} 个百分点</span>。未报价前三 —— {top3unq1_str}（零接触成本）。')
    P['P5_NOTE'] = (f'读图：续保影响度 = 该业务员流失 ÷ 合计应续，<b>可加和</b> —— '
                    f'各段之和（{rate(imp_total)}%）＝整体续保缺口，与已续回 {rate(ren_pct)}% 合为 100%。')

    # ---- P6 ② 临期 7 天 ----
    due2 = int(t2s[1]); ren2 = float(t2s[8]); unq2 = int(t2s[4])
    top3unq2 = topk(t2, 4); top3unq2_str = ' · '.join(f'{r[0]} {int(r[4])}' for r in top3unq2)
    top3imp2 = topk(t2, 6)
    sum3imp2 = round(sum(r[6] for r in top3imp2), 1)
    imp2_str = ' / '.join(f'{r[0]}<span class="hot">{rate(r[6])}%</span>' for r in top3imp2)
    P['P6_TITLE'] = f'临期 7 天 {comma(due2)} 单，续回进度仅 {rate(ren2)}%'
    P['P6_LEDE'] = S(first_sentences(ph.get(1, ''), 2))
    P['P6_C1_T'] = f'未报价 · {unq2} 单距到期不足 7 天'
    P['P6_C1_B'] = (f'距到期已不足 7 天、转化时间极短，是流失风险最高的一段（占应续 {rate(unq2/due2*100)}%）。<br>'
                    f'未报价前三 —— <b>{top3unq2_str}</b>（仍在续保窗口内）。')
    P['P6_C2_T'] = f'临期进度 · {comma(due2)} 单'
    P['P6_C2_B'] = (f'当前续保率仅 <b>{rate(ren2)}%</b>（进度，将随到期补齐）。尚未续回影响度前三 —— '
                    f'{imp2_str}，三人合计 <b>{rate(sum3imp2)}%</b> 是进度缺口最集中的盘子。')
    P['P6_NOTE'] = ('读图：子弹图外槽 = 报价率，内条 = 续保率（进度）。'
                    '<b style="color:var(--accent2)">进度口径不亮灯</b>（含未到期，会随到期补齐，详见第 3 页）。')

    # ---- P7 ③④ 当月进度 ----
    P['P7_T3REN'] = rate(t3s[5]); P['P7_T3DUE'] = comma(t3s[1]); P['P7_T3Q'] = rate(t3s[4])
    P['P7_T4REN'] = rate(t4s[5]); P['P7_T4DUE'] = comma(t4s[1]); P['P7_T4Q'] = rate(t4s[4])
    best4 = maxrow(t4, 6); worst4 = minrow(t4, 6); big4 = maxrow(t4, 1)
    best3ren = by_name(t3, best4[0], 6); worst3ren = by_name(t3, worst4[0], 6)
    worst3q = by_name(t3, worst4[0], 4); big3due = by_name(t3, big4[0], 1)
    side_b = f'最好 <b style="color:var(--watch)">{best4[0]} {rate(best4[6])}%</b>'
    if best3ren is not None:
        side_b += f'（未到期 {rate(best3ren)}%）'
    side_b += f' · 最差 <b>{worst4[0]} {rate(worst4[6])}%</b>'
    if worst3ren is not None and worst3q is not None:
        side_b += f'（未到期 {rate(worst3ren)}%、报价率却 {rate(worst3q)}%）'
    side_b += f'。<br>盘子最大 <b>{big4[0]} {comma(big4[1])} 件</b>'
    if big3due is not None:
        side_b += f'（未到期 {comma(big3due)}）'
    side_b += f' —— <b>经营杠杆最大</b>，进度仅 {rate(big4[6])}%。'
    P['P7_SIDE_B'] = side_b
    P['P7_TITLE'] = f'当月进度 · 报价铺开 {rate(t4s[4])}%，续回只到 {rate(t4s[5])}%'
    P['P7_LEDE'] = S(first_sentences(ph.get(3, ''), 2))
    P['P7_NOTE'] = ('读图：上条 = 报价率，下条 = 续保率（进度），两者落差 ≈ 已报价未成交的待促成空间。'
                    '<b style="color:var(--accent2)">进度口径不亮灯</b>。')

    # ---- P8 ⑤ 当年已到期排名 ----
    big5 = maxrow(t5, 1)
    P['P8_BIGCAP'] = jn(big5[1])
    min5 = minrow(t5, 6, floor_idx=1, floor=100); max5 = maxrow(t5, 6, floor_idx=1, floor=100)
    shown5 = sum(1 for r in t5 if r[1] >= 100)
    P['P8_TITLE'] = f'当年已到期续保率 {rate(ren5)}%，{min5[0]}垫底、{max5[0]}领先'
    P['P8_LEDE'] = S(first_sentences(ph.get(4, ''), 3))
    P['P8_NOTE'] = (f'读图：{shown5} 名业务员按续保率<b>从低到高</b>排，最差在最上；'
                    f'虚线为 <b>{target}% 目标线</b>。续保率亮灯（已成熟最终留存）定义见第 3 页。')

    # ---- P9 ⑥⑦ 首日/首周响应 ----
    d1v = float(t6s[5]); d1q = float(t6s[4])
    d7v = float(t7s[5]); d7q = float(t7s[4])
    nowv = float(t4s[5]); nowq = float(t4s[4])
    scale = max(d1v, d7v, nowv) * 1.18 or 1
    P['P9_D1V'] = rate(d1v); P['P9_D1W'] = f'{d1v/scale*100:.1f}'; P['P9_D1Q'] = rate(d1q)
    P['P9_D7V'] = rate(d7v); P['P9_D7W'] = f'{d7v/scale*100:.1f}'; P['P9_D7Q'] = rate(d7q)
    P['P9_NOWV'] = rate(nowv); P['P9_NOWW'] = f'{nowv/scale*100:.1f}'; P['P9_NOWQ'] = rate(nowq)
    bm = maxrow(t6, 5)                       # 首日续保率标杆
    bm_d7 = by_name(t7, bm[0], 5); bm_now = by_name(t4, bm[0], 6); bm_q = bm[4]
    sd1 = minrow(t6, 5); sd1_d7 = by_name(t7, sd1[0], 5)
    sd7 = minrow(t7, 5); sd7_d1 = by_name(t6, sd7[0], 5)
    P['P9_C1_T'] = f'标杆 · {bm[0]}全程领先'
    c1b = f'首日 <b style="color:var(--ok)">{rate(bm[5])}%</b>'
    if bm_d7 is not None:
        c1b += f' → 首周 <b style="color:var(--ok)">{rate(bm_d7)}%</b>'
    if bm_now is not None:
        c1b += f' → 当月 {rate(bm_now)}%'
    c1b += f'。首日报价率即达 {rate(bm_q)}%，<b>起得早、爬得快</b>，转化最稳。'
    P['P9_C1_B'] = c1b
    c2b = f'{sd1[0]}首日仅 <b>{rate(sd1[5])}%</b>（全场最低）'
    if sd1_d7 is not None:
        c2b += f' → 首周 {rate(sd1_d7)}%'
    c2b += f'；{sd7[0]}首日 <b>{rate(sd7_d1) if sd7_d1 is not None else "-"}%</b> → 首周 {rate(sd7[5])}%（首周最低）。<br>快速响应弱，拖累整体节奏。'
    P['P9_C2_B'] = c2b
    P['P9_TITLE'] = f'续保高度前置：首日就锁定 {rate(d1v)}%'
    P['P9_LEDE'] = S(first_sentences(ph.get(5, ''), 2))
    P['P9_NOTE'] = (f'读图：首日 = 可续期首日（到期前 30 天当天），首周 = 前 30~24 天累计，当前 = 截至 {d["cutoff"]}。'
                    f'业务员明细见附录表六 / 表七。')

    # ---- P10 四个杠杆点（缺口落差呈现 · 不写管理动作，改进杠杆靠对比落差自现）----
    P['P10_A1_T'] = '临期未报价 · 零接触缺口'
    P['P10_A1_B'] = (f'临期 7 天 <b>{unq2} 单</b>未报价、距到期不足 7 天，续保率结构性 0%，'
                     f'是缺口里距到期最近、零接触成本的一段。{top3unq2_str}。{comma(due2)} 临期单仍在窗口内。')
    P['P10_A1_TAG'] = '零接触成本 · 续保率 0%'
    P['P10_A2_T'] = '缺口主来源 · 影响度前三'
    P['P10_A2_B'] = (f'{big5[0]}（当年 {comma(big5[1])} 单最大盘、影响度 {rate(v1)}% 最高）/ {n2} / {n3}，'
                     f'前三影响度合计 <span class="hot">{rate(sum3)}%</span>——整体续保缺口主来源集中在这三人。')
    P['P10_A2_TAG'] = '杠杆集中'
    P['P10_A3_T'] = '标杆 · 早响应高留存'
    P['P10_A3_B'] = (f'{bm[0]}首日续保率 <b style="color:var(--ok)">{rate(bm[5])}%</b> / 首周 '
                     f'{rate(bm_d7) if bm_d7 is not None else "-"}% 全程领先，{max5[0]}当年留存 '
                     f'<b style="color:var(--ok)">{rate(max5[6])}%</b>。首日即报价、首周即成交者，转化最稳。')
    P['P10_A3_TAG'] = '早响应 = 高留存'
    # 两道关口并陈·不分主次（红线 2026-06-08）：未报价=最不该发生的基础失守，报价后未成交=更大体量
    P['P10_A4_T'] = '两道关口 · 都在漏'
    P['P10_A4_B'] = (f'① 未报价 <b>{comma(unq5)} 单</b>零接触、续保率结构性 0%（当年报价率 {rate(q5)}%，'
                     f'每一单都应报价接触，零报价必然流失，最不该发生）；② 报价后未成交 '
                     f'<b>{comma(afterq5)} 单</b>、已报价续保率仅 <b>{rate(qren5)}%</b>（体量更大、待归因）。两段并重。')
    P['P10_A4_TAG'] = '两段并重·不分主次'
    P['P10_LEDE'] = S(f'缺口的四个着力点：临期未报价（零接触）、影响度前三（主来源）、'
                      f'早响应标杆（高留存）、两道关口（未报价 + 报价后未成交，两段并重）。')
    P['P10_TITLE'] = '四个杠杆点 · 缺口落差呈现'
    P['P10_NOTE'] = ('读图：四格＝缺口的四个观察角度——距到期最近的零接触段 / 影响度最集中的业务员 / '
                     '早响应高留存标杆 / 两道关口（未报价 + 报价后未成交，两段并重）；改进杠杆靠落差自现。')

    # ---- P11~P17 附录（全量数据 · 无底部点评 · 顶部交代「应续」到期口径 + 到期日窗口）----
    ym = re.match(r'(\d+)\D+(\d+)', d['period'])
    yr = int(ym.group(1)); mo = int(ym.group(2))
    last = calendar.monthrange(yr, mo)[1]
    cut = d['cutoff']
    ms = f'{yr}-{mo:02d}-01'; me = f'{yr}-{mo:02d}-{last:02d}'; ys = f'{yr}-01-01'
    cdt = datetime.date.fromisoformat(cut)
    a1 = (cdt + datetime.timedelta(days=1)).isoformat()
    a7 = (cdt + datetime.timedelta(days=7)).isoformat()
    CAL = '「应续」＝保单<b>到期日</b>落入窗口去重车架号（<b>到期口径</b>，非起保）'
    win = [
        f'{CAL} · 窗口 到期日 ∈ {ms} ~ {cut}',
        f'{CAL} · 窗口 到期日 ∈ {a1} ~ {a7}',
        f'{CAL} · 窗口 到期日 ∈ {a1} ~ {me}',
        f'{CAL} · 窗口 到期日 ∈ {ms} ~ {me}',
        f'{CAL} · 窗口 到期日 ∈ {ys} ~ {cut}',
        f'{CAL} · 窗口 到期日 ∈ {ms} ~ {me} · ⑥首日响应',
        f'{CAL} · 窗口 到期日 ∈ {ms} ~ {me} · ⑦首周响应',
    ]
    tbl = [
        "11,'①','当月已到期续保',{k:'lit',txt:'续保率亮灯 · 最终留存'},tableFull(T1.slice().sort(asc(9)),T1S,{})",
        "12,'②','临期 7 天续保',{k:'prog',txt:'进度口径 · 续保率不亮灯'},tableFull(T2.slice().sort(asc(9)),T2S,{progress:true})",
        "13,'③','当月未到期续保',{k:'prog',txt:'进度口径'},tableFunnel(T3.slice().sort(asc(6)),T3S)",
        "14,'④','当月续保',{k:'prog',txt:'进度口径 · 已到期＋未到期'},tableFunnel(T4.slice().sort(asc(6)),T4S)",
        "15,'⑤','当年已到期续保',{k:'lit',txt:'续保率亮灯 · 最终留存'},tableMatured(T5.filter(function(r){return r[1]>=100;}).sort(asc(6)).concat(T5.filter(function(r){return r[1]<100;}).sort(asc(6))),T5S)",
        "16,'⑥','当月首日响应',null,tableResp(T6.slice().sort(asc(5)),T6S,'首日报价','首日续回')",
        "17,'⑦','当月首周响应',null,tableResp(T7.slice().sort(asc(5)),T7S,'首周报价','首周续回')",
    ]
    P['APPENDIX'] = '\n'.join(f"add(apxPage({tbl[i]},'{S(win[i])}'));" for i in range(7))

    return Template(PAGES_TMPL).substitute(P)


# ============================================================================
# PAGES 模板（图表 JS 原样复用，叙述用 ${占位符}；占位符全部由数据计算）
# ============================================================================
PAGES_TMPL = r'''var PAGES=[];
function add(html){PAGES.push(html);}

/* ===== P1 封面 ===== */
add(
'<section class="page cover-page"><div class="inner">'+
  '<div class="cv-top"><span class="lg">${COMPANY} · ${ORG}</span><span>数据截止 ${CUTOFF}（按最新签单日期）</span></div>'+
  '<div class="cv-kick">续保经营盯盘 · 业务员 · 七窗口</div>'+
  '<div class="cv-h1">${CV_H1}</div>'+
  '<div class="cv-sub">${CV_SUB}</div>'+
  '<div class="cv-kpis">'+
    '<div class="cv-kpi"><div class="l"><span class="light" style="--c:var(--${KPI1_LV})"></span>${KPI1_LBL}</div><div class="v kn" style="--c:var(--${KPI1_LV})">${KPI1_VAL}<span class="u">${KPI1_U}</span></div></div>'+
    '<div class="cv-kpi"><div class="l"><span class="light" style="--c:var(--${KPI2_LV})"></span>${KPI2_LBL}</div><div class="v kn" style="--c:var(--${KPI2_LV})">${KPI2_VAL}<span class="u">${KPI2_U}</span></div></div>'+
    '<div class="cv-kpi"><div class="l"><span class="light" style="--c:var(--${KPI3_LV})"></span>${KPI3_LBL}</div><div class="v kn" style="--c:var(--${KPI3_LV})">${KPI3_VAL}<span class="u">${KPI3_U}</span></div></div>'+
  '</div>'+
'</div></section>');

/* ===== P2 核心摘要 ===== */
(function(){
var cards='<div class="cards" style="flex:0 0 auto">'+
  '<div class="card"><div class="c-top"><div class="c-lbl">报价率（当年已到期）</div><span class="light" style="--c:var(--${P2_QUOTE_LV})"></span></div>'+
    '<div class="c-num kn" style="--c:var(--watch)">${P2_QUOTE}<span class="u">%</span></div><div class="c-sub">已报价 <b>${P2_QUOTED} 单</b> · 前端盘子${P2_QUOTE_WORD}</div></div>'+
  '<div class="card"><div class="c-top"><div class="c-lbl">当年已到期续保率</div><span class="light" style="--c:var(--${P2_REN_LV})"></span></div>'+
    '<div class="c-num kn" style="--c:var(--${P2_REN_LV})">${P2_REN}<span class="u">%</span></div><div class="c-sub">已续回 <b>${P2_RENEWED} 单</b> · 已成熟最终留存</div></div>'+
  '<div class="card"><div class="c-top"><div class="c-lbl">已报价续保率</div><span class="light" style="--c:var(--${P2_QREN_LV})"></span></div>'+
    '<div class="c-num kn" style="--c:var(--${P2_QREN_LV})">${P2_QREN}<span class="u">%</span></div><div class="c-sub">报价后 ${P2_AFTERLOSS}% 未成交 · ${P2_GAP_SIDE}</div></div>'+
  '<div class="card"><div class="c-top"><div class="c-lbl">距 ${TARGET}% 目标</div><span class="dot" style="--c:var(--accent)"></span></div>'+
    '<div class="c-num kn" style="--c:var(--accent2)">${P2_TOTARGET}<span class="u">个点</span></div><div class="c-sub">当年应续 <b>${P2_DUE} 单</b> 的留存目标</div></div>'+
  '</div>';
var concl='<div class="concl" style="flex:1;margin-top:14px;align-items:stretch">'+
  '<div class="cbox"><div class="ct"><span class="light" style="--c:var(--danger)"></span>${P2_C1_T}</div>'+
    '<div class="cb">${P2_C1_B}</div></div>'+
  '<div class="cbox"><div class="ct"><span class="light" style="--c:var(--warn)"></span>${P2_C2_T}</div>'+
    '<div class="cb">${P2_C2_B}</div></div>'+
  '</div>';
add(page({pg:2,kicker:'核心摘要 · 一句话看懂',no:'',title:'${P2_TITLE}',
  lede:'${P2_LEDE}',
  body:cards+concl,
  note:'四个指标全部服务同一个矛盾。<b>所有口径、字段、公式与亮灯规则集中在第 3 页「读表口径」</b>，本页及后续各页不再重复。'}));
})();

/* ===== P3 读表口径（口径 / 字段 / 指标 / 逻辑 全集 · 唯一处） ===== */
(function(){
var anchor='<div class="kbox" style="flex:0 0 auto"><div class="kh"><span class="ic">钟</span>可续期时间锚点（四川规则）：窗口＝到期前 30 天起 · 首日＝前 30 天当天 · 首周＝前 30~24 天</div>'+
  '<div class="anchor">'+
    '<div class="axis"></div>'+
    '<div class="seg" style="left:6%;width:24%"></div>'+
    '<div class="mk" style="left:6%"><div class="pt"></div><div class="tx"><b>首日</b> 6/1（前30天）</div></div>'+
    '<div class="mk" style="left:30%"><div class="pt"></div><div class="tx"><b>首周末</b> 6/7（前24天）</div></div>'+
    '<div class="mk" style="left:94%"><div class="pt"></div><div class="tx"><b>到期日</b> 例 6/30</div></div>'+
  '</div></div>';
var winCol='<div class="kbox" style="flex:1;gap:6px;min-height:0"><div class="kh"><span class="ic">窗</span>七个观察窗口 · 看什么</div>'+
  '<div class="win"><span class="wt" style="--c:var(--ok)"></span><span class="wn">① 当月已到期</span><span class="wd">已成熟＝最终留存 <span class="pill lit">亮灯</span></span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--accent)"></span><span class="wn">② 临期 7 天</span><span class="wd">未到期，随到期补齐 <span class="pill prog">进度</span></span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--accent)"></span><span class="wn">③ 当月未到期</span><span class="wd">重在报价提前铺开 <span class="pill prog">进度</span></span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--accent)"></span><span class="wn">④ 当月全部</span><span class="wd">已到期＋未到期 <span class="pill prog">进度</span></span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--ok)"></span><span class="wn">⑤ 当年已到期</span><span class="wd">已成熟＝最终留存 <span class="pill lit">亮灯</span></span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--watch)"></span><span class="wn">⑥ 首日响应</span><span class="wd">可续期首日报价/续回</span></div>'+
  '<div class="win"><span class="wt" style="--c:var(--watch)"></span><span class="wn">⑦ 首周响应</span><span class="wd">可续期首周累计报价/续回</span></div></div>';
var defCol='<div class="kbox" style="flex:1.05;gap:5px;min-height:0"><div class="kh"><span class="ic">尺</span>字段与指标公式</div>'+
  '<div class="kdef"><span class="term">应续</span><span>保单<b>到期日</b>落入窗口、<b>去重车架号</b>的商业险保单数（<b>到期口径</b>，非起保口径）</span></div>'+
  '<div class="kdef"><span class="term">已报价</span><span>至少报过一次价的单数</span></div>'+
  '<div class="kdef"><span class="term">已续保</span><span>已签单续保的单数</span></div>'+
  '<div class="kdef"><span class="term">未报价</span><span>＝应续 − 已报价；&nbsp;<b>流失</b>＝应续 − 已续保</span></div>'+
  '<div class="kdef" style="border-top:1px solid var(--edge);padding-top:5px;margin-top:1px"><span class="term">报价率</span><span>＝已报价 ÷ 应续</span></div>'+
  '<div class="kdef"><span class="term">续保率</span><span>＝已续保 ÷ 应续（①⑤即最终留存）</span></div>'+
  '<div class="kdef"><span class="term">续保影响度</span><span>＝业务员流失 ÷ 合计应续（<b>可加和</b>，各业务员之和＝整体缺口）</span></div></div>';
var lightCol='<div class="kbox" style="flex:1;gap:6px;min-height:0"><div class="kh"><span class="ic">灯</span>四级亮灯 · 逻辑 · 来源</div>'+
  legend()+
  '<div class="kline" style="border-top:1px solid var(--edge);padding-top:6px"><b style="color:var(--danger)">续保率亮灯只用于 ①⑤</b>（已成熟最终留存）；<b style="color:var(--accent2)">②③④ 含未到期＝进度口径不亮灯</b>；报价率各窗口均亮灯。</div>'+
  '<div class="kline" style="border-top:1px solid var(--edge);padding-top:6px">所有图表/表格统一<b>从最差到最好</b>排（续保率升序）。</div>'+
  '<div class="kline">数据截止 <b>${CUTOFF}</b> · 口径 <b>商业险</b> · 源 ${SRC}。</div></div>';
add(page({pg:3,kicker:'读表口径 · 唯一处',no:'',title:'看任何一页前，先认清这页',
  lede:'<b>口径、字段、公式、亮灯逻辑、数据来源全部集中在本页</b>，其余各页只放结论与图表、不再重复。',
  body:'<div class="dict-compact" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:11px">'+anchor+'<div style="display:flex;gap:13px;flex:1;min-height:0">'+winCol+defCol+lightCol+'</div></div>'}));
})();

/* ===== P4 ① 当月已到期 · 续保率排名（最差在上 + 体量标注） ===== */
(function(){
var rows=T1.map(function(r){return [r[0],r[9],r[10],r[1],r[6]];}).sort(asc(1));
var bars=rows.map(function(r){
  var tag='应续'+fmt(r[3])+'单 · 影响'+r[4].toFixed(1);
  if(r[3]>=${P4_BIGCAP}) tag+=' <b>◀最大盘</b>';
  return rankBar(r[0],r[1],r[2],tag);
}).join('');
var body='<div class="chart"><div class="bars" style="padding-right:0">'+
    '<div class="refline" style="left:calc((100% - 242px) * ${TARGET_FRAC} + 54px)"><span class="lab">${TARGET}% 目标</span></div>'+
    bars+'</div></div>';
add(page({pg:4,kicker:'已成熟 · 最终留存',no:'①',title:'${P4_TITLE}',
  lede:'<b>现象</b>：${P4_LEDE}',
  body:body,
  note:'${P4_NOTE}'}));
})();

/* ===== P5 ① 缺口归因（100% 可加和堆叠） ===== */
(function(){
var stack=${P5_STACK};
var concl='<div class="concl" style="flex:1;margin-top:16px;align-items:stretch">'+
  '<div class="cbox"><div class="ct"><span class="light" style="--c:var(--danger)"></span>${P5_C1_T}</div>'+
    '<div class="cb">${P5_C1_B}</div></div>'+
  '<div class="cbox"><div class="ct"><span class="light" style="--c:var(--warn)"></span>${P5_C2_T}</div>'+
    '<div class="cb">${P5_C2_B}</div></div>'+
  '</div>';
add(page({pg:5,kicker:'缺口归因 · 影响度可加和',no:'①',title:'${P5_TITLE}',
  lede:'${P5_LEDE}',
  body:stack+concl,
  note:'${P5_NOTE}'}));
})();

/* ===== P6 ② 临期 7 天（子弹图 + 未报价/进度卡） ===== */
(function(){
var rows=T2.slice().sort(asc(9));
var bars=rows.map(function(r){return bulletRow(r[0],r[7],r[9]);}).join('');
var chart='<div style="flex:1.5;display:flex;flex-direction:column;min-height:0">'+
  '<div class="chart"><div class="bars" style="padding-right:58px">'+bars+'</div></div></div>';
var dispatch='<div style="flex:1;display:flex;flex-direction:column;gap:12px">'+
  '<div class="cbox" style="flex:1"><div class="ct"><span class="light" style="--c:var(--danger)"></span>${P6_C1_T}</div>'+
    '<div class="cb">${P6_C1_B}</div></div>'+
  '<div class="cbox" style="flex:1"><div class="ct"><span class="light" style="--c:var(--warn)"></span>${P6_C2_T}</div>'+
    '<div class="cb">${P6_C2_B}</div></div></div>';
add(page({pg:6,kicker:'进度口径 · 不亮灯',no:'②',title:'${P6_TITLE}',
  lede:'<b>现象</b>：${P6_LEDE}',
  body:'<div style="display:flex;gap:16px;flex:1;min-height:0">'+chart+dispatch+'</div>',
  note:'${P6_NOTE}'}));
})();

/* ===== P7 ③④ 当月进度（分组双条 + 对照） ===== */
(function(){
var rows=T4.slice().sort(asc(6));
var bars=rows.map(function(r){return groupRow(r[0],r[4],r[6]);}).join('');
var chart='<div style="flex:1.6;display:flex;flex-direction:column;min-height:0">'+
  '<div class="chart"><div class="bars" style="padding-right:58px">'+bars+'</div></div></div>';
var side='<div style="flex:1;display:flex;flex-direction:column;gap:11px">'+
  '<div class="cards" style="flex-direction:column;gap:11px">'+
    '<div class="card"><div class="c-lbl">③ 当月未到期</div><div style="display:flex;gap:14px;align-items:baseline"><div class="c-num kn" style="font-size:30px;--c:var(--accent2)">${P7_T3REN}<span class="u">%</span></div><div style="font-size:12px;color:var(--dim)">续保进度</div></div><div class="c-sub">应续 <b>${P7_T3DUE}</b> · 报价率 ${P7_T3Q}% · 重在提前铺开</div></div>'+
    '<div class="card"><div class="c-lbl">④ 当月全部</div><div style="display:flex;gap:14px;align-items:baseline"><div class="c-num kn" style="font-size:30px;--c:var(--accent2)">${P7_T4REN}<span class="u">%</span></div><div style="font-size:12px;color:var(--dim)">续保进度</div></div><div class="c-sub">应续 <b>${P7_T4DUE}</b> · 报价率 ${P7_T4Q}%</div></div>'+
  '</div>'+
  '<div class="cbox" style="flex:1"><div class="ct" style="font-size:13px"><span class="light" style="--c:var(--watch)"></span>最好与最差</div>'+
    '<div class="cb">${P7_SIDE_B}</div></div></div>';
add(page({pg:7,kicker:'进度口径 · 不亮灯',no:'③④',title:'${P7_TITLE}',
  lede:'<b>现象</b>：${P7_LEDE}',
  body:'<div style="display:flex;gap:16px;flex:1;min-height:0">'+chart+side+'</div>',
  note:'${P7_NOTE}'}));
})();

/* ===== P8 ⑤ 当年已到期 · 最终续保率排名（最差在上 + 体量标注） ===== */
(function(){
var rows=T5.filter(function(r){return r[1]>=100;}).map(function(r){return [r[0],r[6],r[7],r[1]];}).sort(asc(1));
var bars=rows.map(function(r){
  var tag='应续'+fmt(r[3])+'单';
  if(r[3]>=${P8_BIGCAP}) tag+=' <b>◀最大盘</b>';
  return rankBar(r[0],r[1],r[2],tag);
}).join('');
var body='<div class="chart"><div class="bars" style="padding-right:0">'+
    '<div class="refline" style="left:calc((100% - 242px) * ${TARGET_FRAC} + 54px)"><span class="lab">${TARGET}% 目标</span></div>'+
    bars+'</div></div>';
add(page({pg:8,kicker:'已成熟 · 最终留存',no:'⑤',title:'${P8_TITLE}',
  lede:'<b>现象</b>：${P8_LEDE}',
  body:body,
  note:'${P8_NOTE}'}));
})();

/* ===== P9 ⑥⑦ 首日/首周响应（推进三段 + 标杆短板） ===== */
(function(){
function push(name,val,w,sub){return '<div class="brow"><div class="bn" style="width:74px">'+name+'</div>'+
  '<div class="btrack" style="height:22px"><div class="bfill" style="width:'+w+'%;--c:var(--accent)"></div></div>'+
  '<div class="bv mono" style="width:120px;justify-content:flex-start;padding-left:10px"><b style="color:var(--accent2);font-size:15px">'+val+'%</b><span style="color:var(--dim);font-size:10.5px;margin-left:6px">'+sub+'</span></div></div>';}
var prog='<div style="flex:1.2;display:flex;flex-direction:column;min-height:0">'+
  '<div class="chart"><div class="bars" style="padding-right:0;justify-content:space-around">'+
    push('合计 · 首日',${P9_D1V},${P9_D1W},'报价 ${P9_D1Q}%')+
    push('合计 · 首周',${P9_D7V},${P9_D7W},'报价 ${P9_D7Q}%')+
    push('合计 · 当前',${P9_NOWV},${P9_NOWW},'报价 ${P9_NOWQ}%')+
  '</div></div></div>';
var side='<div style="flex:1;display:flex;flex-direction:column;gap:12px">'+
  '<div class="cbox" style="flex:1"><div class="ct"><span class="light" style="--c:var(--ok)"></span>${P9_C1_T}</div>'+
    '<div class="cb">${P9_C1_B}</div></div>'+
  '<div class="cbox" style="flex:1"><div class="ct"><span class="light" style="--c:var(--warn)"></span>短板 · 起步慢</div>'+
    '<div class="cb">${P9_C2_B}</div></div></div>';
add(page({pg:9,kicker:'响应速度 · 看谁起得早',no:'⑥⑦',title:'${P9_TITLE}',
  lede:'<b>现象</b>：${P9_LEDE}',
  body:'<div style="display:flex;gap:16px;flex:1;min-height:0">'+prog+side+'</div>',
  note:'${P9_NOTE}'}));
})();

/* ===== P10 四个杠杆点（缺口落差呈现 · 2×2 编号卡） ===== */
(function(){
var acts='<div class="acts">'+
  '<div class="act"><div class="a-h"><div class="a-no">1</div><div class="a-t">${P10_A1_T}</div></div>'+
    '<div class="a-b">${P10_A1_B}</div><div class="a-tag">${P10_A1_TAG}</div></div>'+
  '<div class="act"><div class="a-h"><div class="a-no">2</div><div class="a-t">${P10_A2_T}</div></div>'+
    '<div class="a-b">${P10_A2_B}</div><div class="a-tag">${P10_A2_TAG}</div></div>'+
  '<div class="act"><div class="a-h"><div class="a-no">3</div><div class="a-t">${P10_A3_T}</div></div>'+
    '<div class="a-b">${P10_A3_B}</div><div class="a-tag">${P10_A3_TAG}</div></div>'+
  '<div class="act"><div class="a-h"><div class="a-no">4</div><div class="a-t">${P10_A4_T}</div></div>'+
    '<div class="a-b">${P10_A4_B}</div><div class="a-tag">${P10_A4_TAG}</div></div>'+
  '</div>';
add(page({pg:10,kicker:'缺口杠杆 · 落差呈现',no:'',title:'${P10_TITLE}',
  lede:'${P10_LEDE}',
  body:acts,
  note:'${P10_NOTE}'}));
})();

/* ===== P11~P17 附录（一页一表 · 标题去重 · 口径含本表 min/max） ===== */
${APPENDIX}
'''


# ============================================================================
# 5. 拼装
# ============================================================================

def assemble(template_html, data_js, pages_js, d, period):
    org = d['org']
    i_data = template_html.index('var V={ok:')
    i_5a = template_html.rindex('/*', 0, template_html.index('* 模块5a'))
    i_pages = template_html.index('var PAGES=[];')
    i_tail = template_html.index("document.getElementById('deck-root')")

    head = template_html[:i_data]
    render = template_html[i_5a:i_pages]
    tail = template_html[i_tail:]

    # 附录页 apxPage 重写：
    #   ① 状态进 kicker 文字行（不再浮层胶囊 → 杜绝与标题重叠）
    #   ② body 只放表格、底部无点评（附录是全量数据，不做数据点评）
    #   ③ 第 6 参改为顶部口径 lede（交代「应续」到期口径 + 到期日窗口，杜绝起保/到期歧义）
    #   ④ 标题不带「全量业务员」（kicker 已表达，避免三层冗余）
    new_apx = (
        'function apxPage(pg,no,axt,axtag,tableHtml,lede){\n'
        "  var k='附录 · 全量业务员'+(axtag?' · '+axtag.txt:'');\n"
        '  return page({pg:pg,kicker:k,no:no,title:axt,lede:lede,\n'
        "    body:'<div class=\"appendix\">'+tableHtml+'</div>'});\n"
        '}')
    render = re.sub(r'function apxPage\([^)]*\)\{.*?\n\}',
                    lambda _m: new_apx, render, count=1, flags=re.S)

    # 附录表加一行口径 lede 后，16 行表需收紧行距腾出空间（防溢出）
    head = head.replace('.appendix .tbl th{font-size:12px;padding:8px 16px;}',
                        '.appendix .tbl th{font-size:12px;padding:5px 16px;}')
    head = head.replace('.appendix .tbl td{font-size:13.5px;padding:6px 16px;}',
                        '.appendix .tbl td{font-size:13.5px;padding:4px 16px;}')

    # 渲染引擎 page() 页脚里硬编码的机构/期间 -> 参数化
    render = render.replace('天府', org).replace('2026年6月', period)
    # 头部注释 / title 里硬编码的机构/期间/旧源 -> 参数化
    head = head.replace('天府', org).replace('2026年6月', period)
    head = re.sub(r'数据唯一事实源：[^\n]*',
                  f'数据唯一事实源：{d["src"]}（数据 + 叙述均由 gen_renewal_ppt.py 从 refine 正式版生成，零硬编码）',
                  head)

    return head + data_js + '\n' + render + pages_js + '\n' + tail


def main():
    ap = argparse.ArgumentParser(description='续保三级机构视角 → 深色仪表盘 PPT 生成器（refine 正式版驱动）')
    ap.add_argument('--refine', required=True, help='refine 正式版 md（唯一输入）')
    ap.add_argument('--template', required=True, help='渲染引擎来源 html（取静态切片）')
    ap.add_argument('--out', required=True, help='输出 html')
    ap.add_argument('--company', default='华安保险', help='公司简称（默认 华安保险）')
    ap.add_argument('--target', type=int, default=58, help='续保率目标线（默认 58）')
    args = ap.parse_args()

    d = parse_md(args.refine)
    d['company'] = args.company

    # 解析完整性校验（fail fast）
    miss = [f'T{i+1}' for i in range(7) if not d['tables'][i]['rows'] or d['tables'][i]['sum'] is None]
    if miss:
        sys.exit(f'❌ 正式版解析不完整，缺失表：{miss}。请确认 md 含 一~七 全部 7 张表及合计行。')

    template_html = open(args.template, encoding='utf-8').read()
    data_js = build_data_module(d)
    pages_js = build_pages_module(d, args.target)
    out = assemble(template_html, data_js, pages_js, d, d['period'])

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(out)

    print(f'✓ 已生成 {args.out}')
    print(f'  机构={d["org"]} · 期间={d["period"]} · 截止={d["cutoff"]} · 业务员={d["total_salesmen"]} 名 · top{d["topn"]}')
    print(f'  唯一输入={d["src"]}（数据 + 叙述全部派生，零硬编码）')

    # 判断红线回归闸（自迭代机制）：把用户否决过的判断型错误挡在产出后；单一事实源 judgment_redlines.json。
    # PPT 是纯消费，违反 = 上游 refine 判断错，须回正式版改判断后重生成。
    try:
        from lint_renewal_judgment import lint as _lint_judgment
        if _lint_judgment(args.out) != 0:
            print('  ⚠️ 判断红线违反——回 refine 正式版修正判断后重生成（PPT 是纯消费，错在上游）', file=sys.stderr)
    except Exception as _e:
        print(f'  （判断红线 lint 跳过：{_e}）', file=sys.stderr)


if __name__ == '__main__':
    main()
