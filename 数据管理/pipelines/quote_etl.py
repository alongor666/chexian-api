#!/usr/bin/env python3
"""
报价转化数据 ETL：04_报价清单 Excel → 拆分业务员 → JOIN 团队 → Parquet

支持多文件输入（按时间拆分的报价清单自动合并）。

用法:
  python3 数据管理/pipelines/quote_etl.py -i "04_报价清单_A.xlsx" "04_报价清单_B.xlsx"
  python3 数据管理/pipelines/quote_etl.py  # 自动检测 数据管理/ 目录下 04_报价清单_*.xlsx
"""

import argparse
import json
import re
import sys
from pathlib import Path

import duckdb
import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

# ── 33列 CN→EN 映射（04_报价清单格式）──

CN_TO_EN = {
    '报价时间': 'quote_time',
    '车架号': 'vehicle_frame_no',
    '险类': 'insurance_type',
    '三级机构': 'org_level_3',
    # 山西 2026-07-15 新口径列（BACKLOG 2026-07-15-user-e04971）：单元级短名，normalize_org_level_3
    # 内优先消费后 drop，不落 parquet。截至 2026-07-15 上游 02 导出组件尚未含此列（待卡主补），
    # 存在与否两态均兼容。
    '三级机构新': 'org_level_3_new',
    '险别组合': 'coverage_combination',
    '客户类别': 'customer_category',
    '货车吨位分段': 'tonnage_segment',
    '厂牌车型分类': 'brand_model_category',
    '燃料种类': 'fuel_type',
    '保单号': 'policy_no',
    '车牌号': 'plate_no',
    '保险起期': 'insurance_start_date',
    '续转保': 'renewal_status',
    '是否过户车': 'is_transfer',
    '是否新能源车': 'is_nev',
    '是否电销': 'is_telemarketing',
    '是否承保': 'is_underwritten',
    # '险别组合.1' → 重复列，丢弃
    '车险分等级': '_grade_1',
    '小货车评分': '_grade_2',
    '大货车评分': '_grade_3',
    '高速风险等级': 'highway_risk_level',       # 对齐保单 highway_risk_level
    '交通风险评分等级': 'traffic_risk_grade',
    '业务员': 'salesman_raw',
    '新车购置价': 'new_vehicle_price',          # 对齐保单 new_vehicle_price
    '车龄': 'vehicle_age',
    '纯风险保费': 'pure_risk_premium',
    '商业险NCD': 'commercial_ncd',
    'NCD较上年': 'ncd_yoy_change',
    'NCD保费': 'ncd_premium',
    '自主定价系数': 'commercial_pricing_factor',
    '自主系数较上年': 'pricing_factor_yoy_change',
    '最终报价': 'final_quote_premium',
}

REQUIRED_COLUMNS = ['车架号', '报价时间']
STR_FORCE_COLS = {'车架号': str, '保单号': str, '车牌号': str}


def resolve_org_column_variant(df: 'pd.DataFrame') -> 'pd.DataFrame':
    """多省源列名变体（B006，对齐 transform.py NEW_FORMAT_RENAMES['机构']='三级机构'）：
    山西报价清单切到正确卡后机构列为裸「机构」（值为编码全称），四川源为「三级机构」。
    仅当「三级机构」不存在时才改名——两列并存时保留「三级机构」并告警，
    「机构」列走未映射列丢弃路径（不静默二义）。"""
    if '机构' not in df.columns:
        return df
    if '三级机构' in df.columns:
        print("   ⚠ 源同时含「机构」与「三级机构」列，保留「三级机构」（「机构」按未映射列丢弃）")
        return df
    print("   🔄 源列名变体: 机构 → 三级机构（山西正确卡格式）")
    return df.rename(columns={'机构': '三级机构'})


def normalize_org_level_3(df: 'pd.DataFrame', branch: str, env=None, policy_dir=None) -> 'pd.DataFrame':
    """多省机构值规范化 + 塌缩守卫（B006，对齐 transform.py normalize_branch_org G5 语义）。

    branch != 'SC' 时按 config/branch-org-mapping/<branch>.json 的 org_to_unit 把
    org_level_3 原始值（编码全称）映射到经营单元短名；SC → 原样返回（四川字节级安全）；
    无映射文件 → 保留原始值。未在映射表中的机构保留原始值并告警（不静默丢数据）。

    policy_dir（BACKLOG e04971 报价侧「其他」清分）：给定签单域 parquet 目录时，
    规范化后仍为「其他」的行按 业务员↔机构 对照（每日随最新签单数据派生，
    salesman_org_fallback.py）二次解析——上游报价卡太原片区整体落「其他」，
    业务员归属是唯一可用的行级线索。None → 跳过（过渡态/单测/SC 不需要）。

    出口守卫（B005/B006 同款）：非 SC 省归一化后若 org_level_3 坍缩成占位值
    （其他/NULL/空 合计 ≥ 阈值）即红字告警，ORG_COLLAPSE_FAIL=1 时抛错中止——
    堵住上游报价卡导出退化（山西旧卡「三级机构」恒为「其他」）静默产出。
    判定纯函数见 pipelines/org_collapse.py；env 可注入 dict 便于单测。"""
    if branch == 'SC' or 'org_level_3' not in df.columns:
        return df
    mapping_path = Path(__file__).resolve().parent.parent / 'config' / 'branch-org-mapping' / f'{branch}.json'
    if mapping_path.exists():
        cfg = json.loads(mapping_path.read_text(encoding='utf-8'))
        org_map = cfg.get('org_to_unit', {})
        units = set(cfg.get('units', []))
        new_norm = cfg.get('org_new_normalization')
        df = df.copy()
        if new_norm is not None and 'org_level_3_new' in df.columns:
            # ── 新口径（对齐 transform.py normalize_branch_org）：org_level_3_new（三级机构新）优先；
            # 空/「其他」行按编码列 org_to_unit 回退；回退结果不在 units 白名单（如旧合并值）→ 保留「其他」。
            normalized = df['org_level_3_new'].map(lambda v: new_norm.get(v, v) if pd.notna(v) else v)
            as_str = normalized.astype('string').str.strip()
            # string dtype 对 NaN 的比较产出 NA，直接进 mask 会抛错，必须 fillna(False)
            needs_fb = normalized.isna() | (as_str == '').fillna(False) | (as_str == '其他').fillna(False)
            fallback = df['org_level_3'].map(lambda v: org_map.get(v) if pd.notna(v) else None)
            fb_valid = fallback.where(fallback.isin(units))
            resolved = normalized.mask(needs_fb, fb_valid)
            df['org_level_3'] = resolved.where(resolved.notna(), '其他')
            df = df.drop(columns=['org_level_3_new'])
            n_fb = int(needs_fb.sum())
            n_rec = int((needs_fb & fb_valid.notna()).sum())
            print(f"   🏢 [{branch}] 机构规范化（新口径·三级机构新 优先）: "
                  f"{df['org_level_3'].nunique()} 经营单元（白名单 {len(units)}），"
                  f"回退 {n_fb} 行（恢复 {n_rec} / 保留「其他」{n_fb - n_rec}）")
        else:
            if new_norm is not None:
                # 报价源缺新口径列 = 过渡态（上游 02 导出组件待补列）：沿旧路径产出（含旧合并值），
                # 响亮告警但不硬失败——与 transform.py（premium 缺列即 exit 1）刻意不同：
                # 报价历史单日文件替换有时间差，重建后 parquet 值域验收兜底（BACKLOG e04971）。
                print(f"   🔴 [{branch}] 报价源缺「三级机构新」列（上游 02 导出组件待补），沿旧合并口径过渡产出——"
                      f"经代/车商/重客拆分对报价域尚未生效")
            if 'org_level_3_new' in df.columns:
                df = df.drop(columns=['org_level_3_new'])
            src_orgs = set(df['org_level_3'].dropna().unique())
            unmapped = sorted(src_orgs - set(org_map.keys()))
            df['org_level_3'] = df['org_level_3'].map(lambda v: org_map.get(v, v) if pd.notna(v) else v)
            print(f"   🏢 [{branch}] 机构规范化: {len(src_orgs)} 原始机构 → {df['org_level_3'].nunique()} 经营单元（映射表 {len(org_map)} 条）")
            if unmapped:
                print(f"   ⚠️ {len(unmapped)} 个机构未在映射表中，保留原始值（需补 {branch}.json）：{unmapped[:5]}{'...' if len(unmapped) > 5 else ''}")
    else:
        print(f"   ⚠️ [{branch}] 机构规范化跳过：无映射文件 {mapping_path}（保留原始机构值）")
        units = set()

    # ── 业务员回退清分（BACKLOG e04971 报价侧）：规范化后仍「其他」的行，按最新签单域
    # 业务员↔机构对照解析（上游报价卡太原片区整体落「其他」）。白名单双保险：映射构建与
    # 应用各过一遍 units；解析不出保留「其他」。salesman_raw 在步骤 5 已重命名到位。
    if policy_dir is not None and units and 'salesman_raw' in df.columns:
        from pipelines.salesman_org_fallback import build_salesman_org_map, resolve_other_by_salesman
        org_map = build_salesman_org_map(policy_dir, units)
        if org_map:
            _, names = split_salesman_columns(df['salesman_raw'])
            resolved, n_other, n_hit = resolve_other_by_salesman(df['org_level_3'], names, org_map, units)
            df['org_level_3'] = resolved
            print(f"   🧭 [{branch}] 业务员回退清分:「其他」{n_other:,} 行 → 解析 {n_hit:,}"
                  f"（映射 {len(org_map)} 人，剩「其他」{n_other - n_hit:,}）")
        else:
            print(f"   ⚠️ [{branch}] 业务员回退清分跳过：{policy_dir} 无可用签单 parquet 映射")

    # 出口守卫：机构维度塌缩检测（覆盖已映射 / 无映射两条非 SC 路径）
    from pipelines.org_collapse import (
        OrgDimensionCollapseError,
        evaluate_org_collapse,
        org_collapse_should_fail,
        resolve_org_collapse_threshold,
    )
    counts = df['org_level_3'].value_counts(dropna=False).to_dict()
    threshold = resolve_org_collapse_threshold(env)
    verdict = evaluate_org_collapse(counts, threshold=threshold)
    if verdict.collapsed:
        dom = '（NULL/空）' if verdict.dominant_value is None else repr(verdict.dominant_value)
        msg = (
            f"[{branch}] 机构维度塌缩：org_level_3 {verdict.placeholder_share:.1%} 为占位值"
            f"（主值 {dom} 占 {verdict.dominant_share:.1%}，distinct={verdict.distinct}，"
            f"总 {verdict.total:,} 行，阈值 {threshold:.0%}）。疑似上游报价卡导出退化"
            f"（机构列坍缩为单一占位值），org_level_3 分析维度失效（缺口 B006）。"
        )
        if org_collapse_should_fail(env):
            raise OrgDimensionCollapseError(msg)
        print(f"\n   🔴 {msg}")
        print("      → 若确为合法机构集中可忽略；设 ORG_COLLAPSE_FAIL=1 升级为中止，"
              "ORG_COLLAPSE_WARN_THRESHOLD 调整阈值。")
    return df


def find_input_files(search_dir: str = '数据管理') -> list[Path]:
    """自动检测报价清单 xlsx：旧编号 04_报价清单* + 新编号 YYYYMMDD_02_报价清单*（2026-06-10 上游编号 04→02）"""
    base = Path(search_dir)
    if not base.exists():
        return []
    files = list(base.glob('04_报价清单*.xlsx'))
    files += [f for f in base.glob('*_02_报价清单*.xlsx')
              if re.match(r'^\d{8}_02_', f.name)]
    # 排除浏览器重复下载残留（xxx (1).xlsx）
    files = [f for f in files if not re.search(r'\(\d+\)\.xlsx$', f.name)]
    return sorted(set(files), key=lambda f: f.name)


def split_salesman(name: str):
    """拆分 '110031100周凡丁' → ('110031100', '周凡丁')"""
    if not isinstance(name, str):
        return ('', '')
    m = re.match(r'^(\d+)(.*)', name)
    if m:
        return (m.group(1), m.group(2))
    return ('', name)


def split_salesman_columns(raw: pd.Series) -> tuple[pd.Series, pd.Series]:
    """向量化拆分业务员字段，保持 split_salesman 的兼容语义。"""
    values = raw.astype("string").str.strip()
    parts = values.str.extract(r"^(\d+)(.*)$")
    salesman_no = parts[0].fillna("")
    salesman_name = parts[1].where(parts[0].notna(), values).fillna("")
    return salesman_no, salesman_name


def derive_branch_code(df: 'pd.DataFrame', declared_branch: str) -> 'pd.DataFrame':
    """报价表 branch_code 派生（quotes 专用 · warn 模式）。

    fields.json branch_code 字段已挂 strictNonNull + assertDeclaredBranch；quotes 报价表
    policy_no NULL 占比 92.5%（B255 数据质量问题，待生产报价源抽样修复），直接调
    apply_registry_derivations(df, declared) 会因 NULL 比例触发 strictNonNull fail-fast。
    故此处走内联 + warn 模式自管校验，唯一从 fields.json 复用 mapping/prefixLength：

      - 缺 'policy_no' 列 → schema 退化防线，fail-fast
      - declared_branch 必须 ∈ fields.json mapping.values()（白名单），非法 fail-fast
      - 非缺失行：policy_no[:prefixLength] 必须 ∈ mapping.keys()（key 级校验，防 .map(miss)
        变 NaN 被 dropna 静默丢失 → codex 闸-1 P0），未命中前缀 fail-fast
      - 非缺失派生值：必须 ⊆ {declared_branch}（防喂错省/混省），不符 fail-fast
      - 缺失行（NaN/None/'nan'/'None'/''）：fillna(declared_branch)，等价 loader
        selectUnionWithBranchCode 旧"列缺失注入部署省常量"兜底，防 RLS 漏行

    注：B255 数据质量修复后再升级到 derived_fields.py guarded helper 路径。
    单测：tests/pipelines/test_quote_etl_branch_code_derivation.py（10 边界用例）。
    """
    if 'policy_no' not in df.columns:
        print("   ❌ derive_branch_code: df 缺 'policy_no' 列（schema 退化防线）— fail-fast")
        sys.exit(1)

    registry_path = Path(__file__).resolve().parent.parent.parent / 'server/src/config/field-registry/fields.json'
    with open(registry_path) as f:
        registry = json.load(f)
    branch_field = next(fd for fd in registry['fields'] if fd['id'] == 'branch_code')
    mapping = branch_field['derivation']['mapping']
    prefix_len = branch_field['derivation'].get('prefixLength', 3)
    allowed_values = set(mapping.values())
    allowed_prefixes = set(mapping.keys())

    # P1.2（codex 闸-1）：declared_branch 白名单校验，防 BRANCH_CODE=GD 等错值兜底全部
    if declared_branch not in allowed_values:
        print(
            f"   ❌ derive_branch_code: declared_branch={declared_branch!r} 不在白名单 "
            f"{sorted(allowed_values)}（fields.json mapping 值域）— fail-fast"
        )
        sys.exit(1)

    # 识别"缺失行"：pandas NaN/None + ETL astype(str) 链路产生的 'nan'/'None'/'' 字符串
    policy_str = df['policy_no'].astype(str)
    missing_mask = df['policy_no'].isna() | policy_str.isin(['nan', 'None', 'NaT', ''])
    notmissing_mask = ~missing_mask

    # P0（codex 闸-1）：非缺失行做 prefix key 级校验（不依赖 .map() 后的 dropna，
    # 否则未知前缀（999...）→ NaN → dropna 丢掉 → 误判为"全合规"被静默兜底 declared）
    if notmissing_mask.any():
        prefixes = policy_str[notmissing_mask].str[:prefix_len]
        unknown_prefixes = set(prefixes.unique()) - allowed_prefixes
        if unknown_prefixes:
            samples = (
                prefixes[prefixes.isin(unknown_prefixes)]
                .value_counts().head(5).to_dict()
            )
            print(
                f"   ❌ derive_branch_code: 非缺失行出现未知 policy_no 前缀 "
                f"{sorted(unknown_prefixes)}（不在 fields.json mapping 键集 "
                f"{sorted(allowed_prefixes)}）— fail-fast"
            )
            print(f"      未命中前缀样例(top5): {samples}")
            sys.exit(1)

        derived_values = set(prefixes.map(mapping).unique())
        if derived_values != {declared_branch}:
            print(
                f"   ❌ derive_branch_code: 派生省 {sorted(derived_values)} 与声明省 "
                f"{declared_branch!r} 不符（疑似喂错省 / 混省）— fail-fast"
            )
            sys.exit(1)

    df = df.copy()
    # 缺失行全填 declared_branch（loader 旧兜底语义），非缺失行覆盖为派生值
    df['branch_code'] = declared_branch
    if notmissing_mask.any():
        df.loc[notmissing_mask, 'branch_code'] = (
            policy_str[notmissing_mask].str[:prefix_len].map(mapping)
        )

    n_missing = int(missing_mask.sum())
    print(
        f"   派生字段: branch_code ← policy_no[:{prefix_len}] 映射 + "
        f"缺失行兜底 declared='{declared_branch}'"
    )
    if len(df) > 0:
        print(
            f"   ⚠️  policy_no 缺失 {n_missing:,}/{len(df):,} "
            f"({n_missing * 100 / len(df):.1f}%) 已兜底 → '{declared_branch}' "
            "（quotes 表已知数据质量问题，见 BACKLOG B255）"
        )
    print(
        f"   branch_code 全非空: {df['branch_code'].notna().sum():,}/{len(df):,}"
        "（应=总行数）"
    )
    return df


def main():
    parser = argparse.ArgumentParser(description='报价转化数据 ETL（04_报价清单 → Parquet）')
    parser.add_argument('-i', '--input', nargs='+', help='输入 Excel 文件（支持多个）')
    parser.add_argument(
        '-o', '--output',
        default='数据管理/warehouse/fact/quotes_conversion',
        help='输出 Parquet 目录',
    )
    parser.add_argument(
        '--branch-code', default=None,
        help='多省 P3-D（ADR D5）：分公司编码（如 SX）。CLI 优先，其次 BRANCH_CODE env，'
             '默认 SC。派生后 quotes parquet 全行 branch_code = 声明省（非缺失行按 fields.json '
             'prefix_map 派生 + 校验，缺失行兜底 declared）；声明省 != SC 时跳过 data-sources.json '
             '写入。SC 默认链路与原"loader 注入部署省常量"逐字节等价。',
    )
    parser.add_argument(
        '--policy-dir', default=None,
        help='签单域 parquet 目录（BACKLOG e04971：报价「其他」按业务员↔机构对照清分）。'
             '缺省时非 SC 省自动取输出目录的上一级（validation/<省>/，premium 产物所在），'
             '显式传入可覆盖；SC 不启用。',
    )
    args = parser.parse_args()

    # 1. 定位输入文件
    if args.input:
        input_paths = [Path(p) for p in args.input]
    else:
        input_paths = find_input_files()

    if not input_paths:
        print('❌ 找不到报价清单 Excel 文件')
        sys.exit(1)

    missing = [p for p in input_paths if not p.exists()]
    if missing:
        print(f'❌ 文件不存在: {missing}')
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"{'='*80}")
    print(f"📋 报价转化 ETL（04_报价清单 → Parquet）")
    print(f"{'='*80}")
    print(f"   输入: {len(input_paths)} 个文件")
    for p in input_paths:
        size_mb = p.stat().st_size / 1024 / 1024
        print(f"     - {p.name} ({size_mb:.1f} MB)")

    from pipelines.etl_validation import validate_output_path, verify_non_empty, safe_pct, to_bool, PLACEHOLDER_STRS, load_excel_all_sheets

    # 2. 读取并合并 Excel（每个文件自动合并多 sheet）
    print('\n📊 读取 Excel...')
    frames = []
    for p in input_paths:
        df = load_excel_all_sheets(p, dtype=STR_FORCE_COLS, required_columns=REQUIRED_COLUMNS)
        frames.append(df)

    df = pd.concat(frames, ignore_index=True)
    print(f"   文件合并: {len(df):,} 行 × {len(df.columns)} 列")

    # 3. Schema 契约
    df.columns = df.columns.str.strip()
    df = resolve_org_column_variant(df)  # B006：山西正确卡机构列为裸「机构」
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        print(f"   ❌ 缺少必须列: {missing_cols}")
        print(f"      实际列: {list(df.columns)}")
        sys.exit(1)

    # 4. 丢弃重复列 '险别组合.1'
    dup_cols = [c for c in df.columns if c.endswith('.1')]
    if dup_cols:
        df = df.drop(columns=dup_cols)
        print(f"   丢弃重复列: {dup_cols}")

    # 5. 列名重命名
    rename_cols = {k: v for k, v in CN_TO_EN.items() if k in df.columns}
    df = df.rename(columns=rename_cols)
    extra_cols = [c for c in df.columns if c not in CN_TO_EN.values()]
    if extra_cols:
        print(f"   ⚠ 未映射列（已丢弃）: {extra_cols}")
        df = df[[c for c in df.columns if c in CN_TO_EN.values()]]
    print(f"   列名重命名: {len(rename_cols)}/{len(CN_TO_EN)} 列")

    # 5b. 多省机构规范化（B006）：declared_branch 提前解析（CLI --branch-code 优先 →
    # BRANCH_CODE env → 默认 SC，与 11b derive_branch_code 共用同一解析结果），
    # 非 SC 省对 org_level_3 做 org_to_unit 映射 + 塌缩守卫。SC 原样（四川字节级安全）。
    from pipelines.derived_fields import resolve_declared_branch
    declared_branch = resolve_declared_branch(args) or 'SC'
    # 业务员回退清分的签单域来源：显式 --policy-dir 优先；非 SC 省默认取输出目录上一级
    # （branchOutputRoot 布局下即 validation/<省>/，premium 产物顶层所在）；SC 不启用。
    policy_dir = args.policy_dir
    if policy_dir is None and declared_branch != 'SC':
        policy_dir = output_dir.parent
    df = normalize_org_level_3(df, declared_branch, policy_dir=policy_dir)

    # 6. 风险等级 COALESCE 合并
    grade_cols = ['_grade_1', '_grade_2', '_grade_3']
    existing_grades = [c for c in grade_cols if c in df.columns]
    if existing_grades:
        df['insurance_grade'] = df[existing_grades[0]]
        for c in existing_grades[1:]:
            df['insurance_grade'] = df['insurance_grade'].fillna(df[c])
        df = df.drop(columns=existing_grades)
        valid_grades = df['insurance_grade'].notna().sum()
        print(f"   风险等级合并: {valid_grades:,}/{len(df):,} ({safe_pct(valid_grades, len(df)):.1f}%)")

    # 7. 类型转换

    # 日期/时间字段
    for col in ['quote_time', 'insurance_start_date']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')

    if 'quote_time' in df.columns:
        valid = df['quote_time'].notna().sum()
        print(f"   报价时间: {df['quote_time'].min()} ~ {df['quote_time'].max()} ({valid:,} 有值)")

    # 布尔字段
    for col in ['is_transfer', 'is_nev', 'is_telemarketing']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()

    # is_underwritten 保持原始中文值 '承保'/'未承保'（SQL 按 '承保' 判定）
    if 'is_underwritten' in df.columns:
        df['is_underwritten'] = df['is_underwritten'].astype(str).str.strip()
        uw_count = (df['is_underwritten'] == '承保').sum()
        print(f"   已承保: {uw_count:,}/{len(df):,} ({safe_pct(uw_count, len(df)):.1f}%)")

    # 数值字段
    for col in ['pure_risk_premium', 'ncd_premium', 'commercial_pricing_factor',
                'final_quote_premium', 'commercial_ncd', 'new_vehicle_price', 'vehicle_age']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 字符串字段标准化
    for col in ['vehicle_frame_no', 'policy_no', 'plate_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)

    # 8. 过滤无效行
    before = len(df)
    df = df[df['vehicle_frame_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无车架号: {before - len(df):,} 行")

    # 9. 业务员字段：保留原始拼接格式（对齐保单 salesman_name = "工号+姓名"）
    #    同时拆出 salesman_no 用于 JOIN dim 表
    print('🔧 处理业务员字段...')
    if 'salesman_raw' in df.columns:
        df['salesman_no'], _salesman_name = split_salesman_columns(df['salesman_raw'])
        df['salesman_name'] = df['salesman_raw'].str.strip()  # 对齐保单命名
        df = df.drop(columns=['salesman_raw'])

    # 10. JOIN salesman dim 获取团队
    print('🔗 JOIN salesman dim 表...')
    # _DATA_ROOT = 数据管理/，用绝对路径确保从任何 cwd 都能找到
    data_root = Path(__file__).resolve().parent.parent
    project_root = data_root.parent
    dim_paths = [
        data_root / 'warehouse/dim/salesman/latest.parquet',
        project_root / 'server/data/dim/salesman/latest.parquet',
    ]
    dim_path = next((p for p in dim_paths if p.exists()), None)

    con = duckdb.connect()
    con.register('quotes', df)

    if dim_path:
        print(f"   dim 表: {dim_path}")
        result = con.execute(
            f"""
            SELECT q.*,
                   COALESCE(s.team, '未分配团队') AS team
            FROM quotes q
            LEFT JOIN read_parquet('{dim_path}') s
              ON q.salesman_no = s.business_no
            """
        ).df()
        matched = (result['team'] != '未分配团队').sum()
        print(f"   匹配: {matched:,}/{len(result):,} ({matched/len(result)*100:.0f}%)")
    else:
        print("   ⚠️ salesman dim 表不存在，团队字段全部为'未分配团队'")
        df['team'] = '未分配团队'
        result = df

    # 11. 统计概览
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(result):,}")
    print(f"   唯一车架号: {result['vehicle_frame_no'].nunique():,}")
    if 'renewal_status' in result.columns:
        print(f"   续转保分布: {result['renewal_status'].value_counts().to_dict()}")
    if 'customer_category' in result.columns:
        print(f"   客户类别TOP5: {result['customer_category'].value_counts().head(5).to_dict()}")
    if 'final_quote_premium' in result.columns:
        total = pd.to_numeric(result['final_quote_premium'], errors='coerce').sum()
        print(f"   最终报价合计: {total/1e8:.2f} 亿元")

    # 11b-多省 P3-D：branch_code 派生（替代 P3 之前的 constant 注入；codex 闸-1 修订）。
    # declared_branch 已在 5b 提前解析（--branch-code CLI 优先 → BRANCH_CODE env → 默认
    # 'SC'，与 daily.mjs:669 process.env.BRANCH_CODE || 'SC' 同语义），此处复用同一结果
    # 用于 derive_branch_code 校验、写后 verify、metadata skip（codex 闸-1 P1.1）。
    result = derive_branch_code(result, declared_branch)

    # 12. 输出 Parquet
    output_file = output_dir / 'latest.parquet'
    print(f'\n💾 写入 Parquet: {output_file}')
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        result, output_file,
        source_file=', '.join(p.name for p in input_paths),
        processing_mode='quotes_conversion',
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"   输出: {output_file} ({size_mb:.1f} MB)")

    # 13. 验证
    verify = con.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN is_underwritten='承保' THEN 1 END) AS insured,
            COUNT(DISTINCT org_level_3) AS orgs,
            COUNT(DISTINCT team) AS teams,
            COUNT(DISTINCT salesman_name) AS salesmen
        FROM read_parquet('{output_file}')
        """
    ).fetchone()
    print(f"\n✅ 完成!")
    print(f"   总量: {verify[0]:,} | 承保: {verify[1]:,} | 转化率: {verify[1]/verify[0]*100:.1f}%")
    print(f"   机构: {verify[2]} | 团队: {verify[3]} | 业务员: {verify[4]}")
    print(f"   列: {len(result.columns)} → {list(result.columns)}")

    # 13b. branch_code 写后断言（P3-D codex 闸-1 P1.3）：零 NULL + 单一值 = declared_branch
    branch_verify = con.execute(
        f"""
        SELECT
            COUNT(*) - COUNT(branch_code) AS bc_null,
            LIST(DISTINCT branch_code) AS bc_values
        FROM read_parquet('{output_file}')
        """
    ).fetchone()
    bc_null_cnt, bc_values = int(branch_verify[0]), list(branch_verify[1])
    if bc_null_cnt > 0:
        print(f"   ❌ 写后 verify: branch_code 含 {bc_null_cnt:,} 行 NULL（应=0）— fail-fast")
        sys.exit(1)
    if set(bc_values) != {declared_branch}:
        print(
            f"   ❌ 写后 verify: branch_code 值集 {sorted(bc_values)} ≠ "
            f"{{{declared_branch!r}}} — fail-fast"
        )
        sys.exit(1)
    print(f"   ✅ branch_code 写后 verify：{verify[0]:,} 行全非空，值集=[{declared_branch}]")

    # 14. 更新 data-sources.json
    # 多省 P3-D（codex 闸-1 P1.1）：用 declared_branch 判定（覆盖 BRANCH_CODE env 路径），
    # 非 SC 省一律跳过共享 SC data-sources.json 写入，避免污染唯一事实源。
    if declared_branch != 'SC':
        print(f"  ⏭ [{declared_branch}] 跳过 data-sources.json 写入（隔离省不污染 SC 唯一事实源）")
    else:
        try:
            from pipelines.data_sources_updater import update_data_sources
            update_data_sources('quotes_conversion', row_count=verify[0], field_count=len(result.columns))
        except Exception as e:
            print(f"  ⚠️ data-sources.json 更新跳过: {e}")

    print(f"{'='*80}")


if __name__ == '__main__':
    main()
