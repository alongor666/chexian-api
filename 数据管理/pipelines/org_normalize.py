#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多省机构值规范化（G5 · premium 域）——从 transform.py 下沉的可测纯逻辑模块。

为什么独立成模块：transform.py 模块级执行 argparse（`args = parse_args()`），
无法被单测 import；参照 org_collapse.py 先例把判定逻辑下沉，transform.py 留薄
wrapper（读 BRANCH_CODE 环境变量 + 定位 config 目录）。

新口径（2026-07-15，BACKLOG 2026-07-15-user-e04971）取值优先级
（配置声明了 org_new_normalization 的省份，如 SX）：
1. 源列「三级机构新」（上游单元级短名）优先——经 org_new_normalization 归一
   （太原业务一部/二部 → 太原一部/二部），这是「经代/车商/重客」拆分的唯一可靠
   来源（编码 0118010204 一对多映射到 4 个单元，org_to_unit 无法反推）；
2. 该列空值/「其他」的行 → 按「三级机构」编码全称列查 org_to_unit 行级回退；
   回退结果不在 units 白名单（如已拆除的旧合并值「经代、车商、重客」）→
   保留「其他」并点名告警，绝不产出退役值污染下游；
3. 「三级机构新」整列缺失 → **硬失败退出**（fail-closed：上游导出回退即断链
   报警，绝不静默退回合并口径重演 B005 静默退化）。
未声明 org_new_normalization 的省份走旧路径（org_to_unit 全列映射）。
SC → 调用方（transform.py wrapper）在进入本模块前原样返回（四川字节级安全）。

出口守卫（缺口 B005-2026-07-09）：归一后做维度塌缩检测（其他/NULL/空合计 ≥ 阈值
即告警，ORG_COLLAPSE_FAIL=1 时中止），判定见 pipelines/org_collapse.py。
"""
import json
import sys
from pathlib import Path

import pandas as pd

ORG_NEW_COLUMN = '三级机构新'
ORG_LEGACY_COLUMN = '三级机构'
ORG_PLACEHOLDER = '其他'


def warn_if_org_collapsed(df, branch, env=None, column=ORG_LEGACY_COLUMN):
    """落盘前守卫：机构维度塌缩为占位值（其他/NULL/空 合计 ≥ 阈值）→ 红字告警；
    ORG_COLLAPSE_FAIL=1 → 抛错中止（fail-closed）。env 可注入 dict 便于单测。"""
    if column not in df.columns:
        return
    from pipelines.org_collapse import (
        OrgDimensionCollapseError,
        evaluate_org_collapse,
        org_collapse_should_fail,
        resolve_org_collapse_threshold,
    )
    counts = df[column].value_counts(dropna=False).to_dict()
    threshold = resolve_org_collapse_threshold(env)
    verdict = evaluate_org_collapse(counts, threshold=threshold)
    if not verdict.collapsed:
        return
    dom = '（NULL/空）' if verdict.dominant_value is None else repr(verdict.dominant_value)
    msg = (
        f"[{branch}] 机构维度塌缩：{column} {verdict.placeholder_share:.1%} 为占位值"
        f"（主值 {dom} 占 {verdict.dominant_share:.1%}，distinct={verdict.distinct}，"
        f"总 {verdict.total:,} 行，阈值 {threshold:.0%}）。疑似上游导出退化"
        f"（机构列坍缩为单一占位值），org_level_3 分析维度失效。"
    )
    if org_collapse_should_fail(env):
        raise OrgDimensionCollapseError(msg)
    print(f"\n   🔴 {msg}")
    print("      → 若确为合法机构集中可忽略；设 ORG_COLLAPSE_FAIL=1 升级为中止，"
          "ORG_COLLAPSE_WARN_THRESHOLD 调整阈值。")


def normalize_branch_org_df(df, branch, mapping_dir, env=None):
    """按 <mapping_dir>/<branch>.json 归一 df 的机构列（详见模块 docstring）。

    参数:
      df: 含「三级机构」/「三级机构新」（可任一缺失）的 DataFrame
      branch: 省份码（'SX' 等；'SC' 应由调用方在进入前拦截）
      mapping_dir: config/branch-org-mapping 目录 Path
      env: 塌缩守卫环境注入（None = os.environ），便于单测
    """
    has_legacy = ORG_LEGACY_COLUMN in df.columns
    has_new = ORG_NEW_COLUMN in df.columns
    if not has_legacy and not has_new:
        return df
    mapping_path = Path(mapping_dir) / f'{branch}.json'
    if not mapping_path.exists():
        print(f"\n   ⚠️ [{branch}] 机构规范化跳过：无映射文件 {mapping_path}（保留原始机构值）")
        warn_if_org_collapsed(df, branch, env)
        return df

    cfg = json.loads(mapping_path.read_text(encoding='utf-8'))
    org_map = cfg.get('org_to_unit', {})
    units = set(cfg.get('units', []))
    new_norm = cfg.get('org_new_normalization')
    df = df.copy()

    if new_norm is not None and not has_new:
        # 新口径省份源列缺失 = 上游导出回退。宁可断链也不静默退回合并口径。
        print(f"\n   ❌ [{branch}] 源缺少「{ORG_NEW_COLUMN}」列，但 {mapping_path.name} 已声明新口径"
              f"（org_new_normalization）。上游导出疑似回退，拒绝按旧合并口径静默产出。")
        print(f"      → 核实上游 01 签单导出卡列结构；确需旧口径请先移除 {branch}.json 的 org_new_normalization。")
        sys.exit(1)

    if new_norm is not None and has_new:
        # ── 新口径：三级机构新 优先 + 行级回退 ──
        normalized = df[ORG_NEW_COLUMN].map(lambda v: new_norm.get(v, v) if pd.notna(v) else v)
        as_str = normalized.astype('string').str.strip()
        # string dtype 对 NaN 的比较产出 NA，直接进 mask 会抛错，必须 fillna(False)
        needs_fallback = normalized.isna() | (as_str == '').fillna(False) | (as_str == ORG_PLACEHOLDER).fillna(False)
        if has_legacy:
            fallback = df[ORG_LEGACY_COLUMN].map(lambda v: org_map.get(v) if pd.notna(v) else None)
        else:
            fallback = pd.Series(None, index=df.index, dtype=object)
        fallback_valid = fallback.where(fallback.isin(units))
        resolved = normalized.mask(needs_fallback, fallback_valid)
        resolved = resolved.where(resolved.notna(), ORG_PLACEHOLDER)

        n_fb = int(needs_fallback.sum())
        n_recovered = int((needs_fallback & fallback_valid.notna()).sum())
        n_retired_hit = int((needs_fallback & fallback.notna() & ~fallback.isin(units)).sum())
        out_of_wl = sorted(set(resolved[~resolved.isin(units) & (resolved != ORG_PLACEHOLDER)].dropna()))

        df[ORG_LEGACY_COLUMN] = resolved
        df = df.drop(columns=[ORG_NEW_COLUMN])
        print(f"\n   🏢 [{branch}] 机构规范化（新口径·{ORG_NEW_COLUMN} 优先）: "
              f"{df[ORG_LEGACY_COLUMN].nunique()} 经营单元（白名单 {len(units)}），"
              f"回退 {n_fb} 行（编码映射恢复 {n_recovered} / 保留「{ORG_PLACEHOLDER}」{n_fb - n_recovered}）")
        if n_retired_hit:
            retired_targets = sorted(set(fallback[needs_fallback & fallback.notna() & ~fallback.isin(units)]))
            print(f"   ⚠️ {n_retired_hit} 行回退命中白名单外映射目标 {retired_targets[:3]}（如已拆除的旧合并值），"
                  f"已保留「{ORG_PLACEHOLDER}」——需上游补全「{ORG_NEW_COLUMN}」或业务确认归属")
        if out_of_wl:
            print(f"   ⚠️ {ORG_NEW_COLUMN} 出现 {len(out_of_wl)} 个白名单外新值（原样保留，需确认是否补 {branch}.json units）：{out_of_wl[:5]}")
    elif has_legacy:
        # ── 旧路径：org_to_unit 全列映射（未声明新口径的省份）──
        src_orgs = set(df[ORG_LEGACY_COLUMN].dropna().unique())
        unmapped = sorted(src_orgs - set(org_map.keys()))
        df[ORG_LEGACY_COLUMN] = df[ORG_LEGACY_COLUMN].map(lambda v: org_map.get(v, v) if pd.notna(v) else v)
        print(f"\n   🏢 [{branch}] 机构规范化: {len(src_orgs)} 原始机构 → {df[ORG_LEGACY_COLUMN].nunique()} 经营单元（映射表 {len(org_map)} 条）")
        if unmapped:
            print(f"   ⚠️ {len(unmapped)} 个机构未在映射表中，保留原始值（需补 {branch}.json）：{unmapped[:5]}{'...' if len(unmapped) > 5 else ''}")

    # 出口守卫：机构维度塌缩检测（单一检查点，覆盖新旧两条路径）
    warn_if_org_collapsed(df, branch, env)
    return df
