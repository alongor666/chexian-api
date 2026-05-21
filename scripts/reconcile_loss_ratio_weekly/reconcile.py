"""
对账判定 + 派生满期赔付率（精简版）
======================================

输入：xlsx + project 的客户类别 records（4 个核心指标）
派生：满期赔付率 = 总赔款 / 满期保费（在 reconcile 阶段算出）
输出：external.json / project.json / diff.json / summary.json + stdout 报告
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path
from . import config as _cfg
from .config import THRESHOLDS, DERIVED_METRIC_ID, DERIVED_METRIC_CN


def _key(r: dict) -> tuple:
    return (r['sheet'], r['policy_year'], tuple(r['dim_path']), r['metric_id'])


def _derive_loss_ratio(records: list[dict]) -> list[dict]:
    """派生满期赔付率 = 总赔款 / 满期保费（按客户类别分组）"""
    # 按 (policy_year, dim_path) 收集 4 个核心指标
    pivot: dict[tuple, dict[str, float]] = {}
    for r in records:
        key = (r['policy_year'], tuple(r['dim_path']))
        pivot.setdefault(key, {})[r['metric_id']] = r['value']

    derived = []
    for (year, dim_path), m in pivot.items():
        claims = m.get('total_reported_claims_wan')
        earned = m.get('earned_premium_wan')
        if claims is None or earned is None or earned <= 0:
            continue
        derived.append({
            'sheet': 'customer_category',
            'policy_year': year,
            'dim_path': list(dim_path),
            'metric_id': DERIVED_METRIC_ID,
            'metric_cn': DERIVED_METRIC_CN,
            'value': claims / earned,
            'derived': True,
        })
    return derived


def _judge(metric_id: str, ext: float, prj: float) -> tuple[str, float, float | None]:
    abs_diff = prj - ext
    rel_diff = abs_diff / ext if ext not in (0, None) else None
    th = THRESHOLDS.get(metric_id, {'rel': 0.005, 'abs': 0.01})
    tol_rel, tol_abs = th['rel'], th['abs']
    passed = abs(abs_diff) <= tol_abs or (rel_diff is not None and abs(rel_diff) <= tol_rel)
    if passed:
        return 'PASS', abs_diff, rel_diff
    warn = abs(abs_diff) <= tol_abs * 3 or (rel_diff is not None and abs(rel_diff) <= tol_rel * 3)
    return ('WARN' if warn else 'FAIL'), abs_diff, rel_diff


def reconcile(
    external: list[dict],
    project: list[dict],
    *,
    week: str,
    verbose: bool = False,
) -> dict:
    out_dir = _cfg.OUTPUT_BASE_DIR / week
    out_dir.mkdir(parents=True, exist_ok=True)

    # 派生满期赔付率（两端）
    ext_all = external + _derive_loss_ratio(external)
    prj_all = project + _derive_loss_ratio(project)

    _dump_json(out_dir / 'external.json', ext_all)
    _dump_json(out_dir / 'project.json', prj_all)

    ext_idx = {_key(r): r for r in ext_all}
    prj_idx = {_key(r): r for r in prj_all}

    diffs = []
    # codex review P1 fix：缺失键计入 FAIL，不再静默 continue 高估通过率
    for k in set(ext_idx.keys()) | set(prj_idx.keys()):
        ext, prj = ext_idx.get(k), prj_idx.get(k)
        sheet, year, dim_path, metric_id = k
        if ext is None:
            diffs.append({
                'sheet': sheet, 'policy_year': year, 'dim_path': list(dim_path),
                'metric_id': metric_id,
                'external_value': None, 'project_value': prj['value'],
                'abs_diff': prj['value'], 'rel_diff': None,
                'status': 'FAIL', 'missing_side': 'external',
                'threshold': THRESHOLDS.get(metric_id),
            })
            continue
        if prj is None:
            diffs.append({
                'sheet': sheet, 'policy_year': year, 'dim_path': list(dim_path),
                'metric_id': metric_id,
                'external_value': ext['value'], 'project_value': None,
                'abs_diff': -ext['value'], 'rel_diff': None,
                'status': 'FAIL', 'missing_side': 'project',
                'threshold': THRESHOLDS.get(metric_id),
            })
            continue
        status, abs_diff, rel_diff = _judge(metric_id, ext['value'], prj['value'])
        diffs.append({
            'sheet': sheet, 'policy_year': year, 'dim_path': list(dim_path),
            'metric_id': metric_id,
            'external_value': ext['value'], 'project_value': prj['value'],
            'abs_diff': abs_diff, 'rel_diff': rel_diff,
            'status': status, 'threshold': THRESHOLDS.get(metric_id),
        })
    diffs.sort(key=lambda d: abs(d['abs_diff']), reverse=True)

    summary = _summarize(diffs)
    _dump_json(out_dir / 'diff.json', {'week': week, 'diffs': diffs})
    _dump_json(out_dir / 'summary.json', summary)
    _print_stdout(summary, diffs, week=week, verbose=verbose)
    return summary


def _summarize(diffs) -> dict:
    by_metric = defaultdict(lambda: defaultdict(int))
    overall = defaultdict(int)
    for d in diffs:
        by_metric[d['metric_id']][d['status']] += 1
        overall[d['status']] += 1
    overall_total = sum(overall.values())
    metric_summary = {}
    for m, c in by_metric.items():
        t = sum(c.values())
        metric_summary[m] = {'total': t, **dict(c), 'pass_rate': c.get('PASS', 0) / t if t else 0}
    return {
        'overall': {'total': overall_total, **dict(overall),
                    'pass_rate': overall.get('PASS', 0) / overall_total if overall_total else 0},
        'by_metric': metric_summary,
    }


def _print_stdout(summary, diffs, *, week, verbose):
    METRIC_ORDER = [
        'total_premium_wan', 'earned_premium_wan',
        'reported_claim_count', 'total_reported_claims_wan',
        'earned_loss_ratio',
    ]
    METRIC_CN = {
        'total_premium_wan': '跟单保费（万）',
        'earned_premium_wan': '满期保费（万）',
        'reported_claim_count': '已报件数',
        'total_reported_claims_wan': '总赔款（万）',
        'earned_loss_ratio': '满期赔付率',
    }
    DIM_ORDER = ['非营业客车', '非营业货车', '营业货车', '特种车', '摩托车', '出租车与网约车', '其他', '合计']

    print()
    print('━' * 90)
    print(f'赔付率周报对账（YTD 2026 截至 {week}） — 客户类别 7 类 + 合计')
    print('━' * 90)
    o = summary['overall']
    print(f"总对比 {o['total']}   PASS {o.get('PASS',0)} ({o['pass_rate']:.1%})   "
          f"WARN {o.get('WARN',0)}   FAIL {o.get('FAIL',0)}")
    print()

    # 索引 diffs：(metric_id, dim_name) → diff
    didx = {(d['metric_id'], d['dim_path'][0]): d for d in diffs}

    for metric_id in METRIC_ORDER:
        unit = '' if metric_id in ('reported_claim_count','earned_loss_ratio') else ''
        is_count = metric_id == 'reported_claim_count'
        is_ratio = metric_id == 'earned_loss_ratio'
        print(f'━━ {METRIC_CN[metric_id]} ━━')
        print(f'{"客户类别":<18s}  {"xlsx":>13s}  {"project":>13s}  {"Δ":>11s}  {"rel":>9s}   状态')
        print('─' * 90)
        for dim in DIM_ORDER:
            d = didx.get((metric_id, dim))
            if not d: continue
            ext, prj = d['external_value'], d['project_value']
            ad = d['abs_diff']
            rel = f"{d['rel_diff']*100:>+7.2f}%" if d['rel_diff'] is not None else '    n/a '
            icon = {'PASS':'✓','WARN':'⚠','FAIL':'✗'}[d['status']]
            missing = d.get('missing_side')
            note = f' (仅{missing}端有数)' if missing else ''
            if dim == '合计':
                print('═' * 90)
            # 缺失侧显示为 n/a
            ext_str = ('     n/a    ' if ext is None else (f'{ext:>13.0f}' if is_count else (f'{ext:>13.4f}' if is_ratio else f'{ext:>13.2f}')))
            prj_str = ('     n/a    ' if prj is None else (f'{prj:>13.0f}' if is_count else (f'{prj:>13.4f}' if is_ratio else f'{prj:>13.2f}')))
            ad_str = f'{ad:>+11.0f}' if is_count else (f'{ad:>+11.4f}' if is_ratio else f'{ad:>+11.2f}')
            print(f'{dim:<18s}  {ext_str}  {prj_str}  {ad_str}  {rel:>9s}   {icon} {d["status"]}{note}')
        print()

    print('━━ 按指标通过率 ━━')
    for m in METRIC_ORDER:
        st = summary['by_metric'].get(m, {})
        print(f"  {METRIC_CN[m]:<15s} PASS {st.get('PASS',0):>2}/{st.get('total',0):<2} ({st.get('pass_rate',0):.0%})  WARN {st.get('WARN',0):>2}  FAIL {st.get('FAIL',0):>2}")

    print()
    print(f'输出: {_cfg.OUTPUT_BASE_DIR}/{week}/')
    print('━' * 90)


def _dump_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
