"""业务员 → 经营单元回退映射（报价域「其他」清分 — BACKLOG e04971 报价侧方案）。

背景：山西报价上游（BI 主题「山西报价清单me」组件 04_quetolist）的「三级机构」
按行派生，城市单元与 经代/车商/重客 已准确，但太原片区整体落「其他」（约 29%，
组件派生规则覆盖不到）。用户裁定（2026-07-16）：报价域「其他」行改由**业务员对照**
清分——每天用最新签单域（premium parquet，org_level_3 已是 13 单元新口径）里
业务员 ↔ 机构的对照关系，把报价里值为「其他」的 org_level_3 解析到真实单元。

设计约束：
- 归属规则对齐 SX 业务员维度表（generate_dim_tables.build_sx_salesman_from_parquet）：
  按签单量最多的机构作为该业务员归属；并列时取机构名字典序最小（确定性）。
- 只信白名单：映射目标必须在 branch-org-mapping units 白名单内（policy 侧的
  「其他」/空值不进映射），报价侧解析不出仍保留「其他」，绝不产出白名单外脏值。
- 纯函数 + 显式传参，便于单测（不读环境变量、不隐式找路径）。
"""

from pathlib import Path

import pandas as pd


def build_salesman_org_map(policy_dir: 'Path | str', units: set) -> dict:
    """从签单域 parquet 目录构建 业务员姓名 → 经营单元 映射。

    只扫 policy_dir 顶层 *.parquet（premium 产物；validation/<省>/ 下的
    quotes_conversion/claims_detail/dim 等子目录天然不被顶层 glob 命中）。
    仅读 salesman_name/org_level_3 两列。org 不在 units 白名单、或姓名为空的行
    不参与归属。返回 dict[str, str]；目录不存在或无 parquet 返回空 dict。
    """
    base = Path(policy_dir)
    if not base.is_dir():
        return {}
    files = sorted(base.glob('*.parquet'))
    if not files:
        return {}
    frames = []
    for f in files:
        try:
            frames.append(pd.read_parquet(f, columns=['salesman_name', 'org_level_3']))
        except Exception as e:  # 列缺失/文件损坏：跳过该文件，不让单文件毁掉整个映射
            print(f"   ⚠️ 业务员映射源跳过 {f.name}: {e}")
    if not frames:
        return {}
    df = pd.concat(frames, ignore_index=True)
    name = df['salesman_name'].astype('string').str.strip()
    org = df['org_level_3'].astype('string').str.strip()
    mask = name.notna() & (name != '') & org.isin(list(units))
    if not mask.any():
        return {}
    counts = (
        pd.DataFrame({'name': name[mask], 'org': org[mask]})
        .groupby(['name', 'org'], sort=False)
        .size()
        .reset_index(name='n')
        # 签单量降序；并列取机构名字典序最小 —— 与 build_sx_salesman_from_parquet 同规则
        .sort_values(['name', 'n', 'org'], ascending=[True, False, True], kind='mergesort')
    )
    top = counts.drop_duplicates('name', keep='first')
    return dict(zip(top['name'], top['org']))


def resolve_other_by_salesman(org_series: pd.Series, name_series: pd.Series,
                              org_map: dict, units: set) -> tuple[pd.Series, int, int]:
    """把 org_series 中值为「其他」的行按业务员姓名映射到经营单元。

    返回 (解析后的 Series, 待解析「其他」行数, 成功解析行数)。
    映射值再过一遍 units 白名单（防 org_map 被注入脏值）；解析不出保留「其他」。
    不修改入参（immutable）。
    """
    org = org_series.astype('string')
    is_other = (org == '其他').fillna(False)
    n_other = int(is_other.sum())
    if n_other == 0 or not org_map:
        return org_series.copy(), n_other, 0
    names = name_series.astype('string').str.strip()
    mapped = names.map(org_map)
    mapped = mapped.where(mapped.isin(list(units)))
    resolved = org.mask(is_other & mapped.notna(), mapped)
    n_resolved = int((is_other & mapped.notna()).sum())
    return resolved, n_other, n_resolved
