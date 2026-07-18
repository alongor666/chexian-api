"""业务员 → 经营单元按年映射（报价域「其他」清分 — BACKLOG e04971 报价侧方案）。

背景：山西报价上游（BI 主题「山西报价清单me」组件 04_quetolist）的「三级机构」
按行派生，城市单元与 经代/车商/重客 已准确，但太原片区整体落「其他」（约 29%，
组件派生规则覆盖不到）。用户裁定（2026-07-16）：报价域「其他」行改由**业务员对照**
清分——用签单域（premium parquet，org_level_3 已是 13 单元新口径）里
业务员 ↔ 机构 的对照关系，把报价里值为「其他」的 org_level_3 解析到真实单元。

设计约束：
- 匹配键 =「工号+姓名」原始全串：签单域 salesman_name 与报价域 业务员 同为
  工号前缀拼姓名格式（如「118226546彭佩」）。刻意不拆姓名——工号天然区分
  同名业务员，重名跨机构错归风险归零。
- 按年分桶（用户裁定 2026-07-16 二次修订）：**当年的报价用当年签单数据建的
  映射**——跨年太原地区组织架构会调整，同一业务员不同年份归属可以不同
  （实测 2025/2026 两年都活跃的 161 人中 17 人跨年归属不同）。当年映射缺席
  该业务员时按邻年兜底（|Δ年| ≤ max_year_gap，就近优先、并列取更近的晚年——
  架构漂移随年距增大，默认只容 ±1 年）。实测 2025-12 报价 × 2025 年映射行
  覆盖 99.5%，邻年再收一部分，残余保留「其他」交清分闸判定。
- 归属规则对齐 SX 业务员维度表（generate_dim_tables.build_sx_salesman_from_parquet）：
  年内按签单量最多的机构归属；并列时取机构名字典序最小（确定性）。
- 只信白名单：映射目标必须在 branch-org-mapping units 白名单内（policy 侧的
  「其他」/空值不进映射），报价侧解析不出仍保留「其他」，绝不产出白名单外脏值。
- 失败必须响亮（评审 P1，fail-closed）：清分是本管道对约 29%「其他」行的核心
  口径能力，依赖缺失（签单目录/映射为空/业务员列缺失）或清分后「其他」仍超阈
  → 抛 QuoteOrgResolutionError 阻断发布；仅显式设
  QUOTE_ORG_FALLBACK_ALLOW_DEGRADED=1 才降级为红字告警继续（应急口径，
  与 --allow-stale 同哲学：断链兜底必须是人工显式决定，不能是默认行为）。
- 纯函数 + 显式传参，便于单测（不隐式找路径；env 经参数注入）。
"""

from pathlib import Path

import pandas as pd

# 清分后「其他」占比仍超过此值 → 视为清分失效（正常态实测 ≈0.3%；上游报价卡
# 太原片区落「其他」约 29%，若依赖断裂会整体残留，5% 足以区分两种状态）
OTHER_SHARE_FAIL_THRESHOLD = 0.05

# 邻年兜底的最大年距：当年映射缺席该业务员时最多借 |Δ年| ≤ 1 的映射
DEFAULT_MAX_YEAR_GAP = 1

DEGRADED_ENV_KEY = 'QUOTE_ORG_FALLBACK_ALLOW_DEGRADED'


class QuoteOrgResolutionError(RuntimeError):
    """报价机构清分失效（依赖缺失或残留「其他」超阈）——默认阻断发布。"""


def degraded_mode_allowed(env=None) -> bool:
    """是否显式授权降级续跑（QUOTE_ORG_FALLBACK_ALLOW_DEGRADED=1/true/yes/on）。"""
    import os
    src = env if env is not None else os.environ
    return str(src.get(DEGRADED_ENV_KEY, '')).strip().lower() in {'1', 'true', 'yes', 'on'}


def build_salesman_org_maps_by_year(policy_dir: 'Path | str', units: set) -> dict:
    """从签单域 parquet 目录构建 {签单年份: {业务员全串: 经营单元}} 分年映射。

    只扫 policy_dir 顶层 *.parquet（premium 产物；validation/<省>/ 下的
    quotes_conversion/claims_detail/dim 等子目录天然不被顶层 glob 命中），
    仅读 salesman_name/org_level_3/policy_date 三列。org 不在 units 白名单、
    键为空、policy_date 解析不出的行不参与归属。年内归属 = 签单量最多，
    并列取机构名字典序最小。返回 dict[int, dict[str, str]]；目录不存在或
    无可读 parquet 返回空 dict（由调用方按 fail-closed 语义决定是否阻断）。
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
            frames.append(pd.read_parquet(f, columns=['salesman_name', 'org_level_3', 'policy_date']))
        except Exception as e:  # 列缺失/文件损坏：跳过该文件，不让单文件毁掉整个映射
            print(f"   ⚠️ 业务员映射源跳过 {f.name}: {e}")
    if not frames:
        return {}
    df = pd.concat(frames, ignore_index=True)
    name = df['salesman_name'].astype('string').str.strip()
    org = df['org_level_3'].astype('string').str.strip()
    year = pd.to_datetime(df['policy_date'], errors='coerce').dt.year
    mask = name.notna() & (name != '') & org.isin(list(units)) & year.notna()
    if not mask.any():
        return {}
    counts = (
        pd.DataFrame({'year': year[mask].astype(int), 'name': name[mask], 'org': org[mask]})
        .groupby(['year', 'name', 'org'], sort=False)
        .size()
        .reset_index(name='n')
        # 签单量降序；并列取机构名字典序最小 —— 与 build_sx_salesman_from_parquet 同规则
        .sort_values(['year', 'name', 'n', 'org'], ascending=[True, True, False, True], kind='mergesort')
    )
    top = counts.drop_duplicates(['year', 'name'], keep='first')
    maps: dict = {}
    for y, sub in top.groupby('year'):
        maps[int(y)] = dict(zip(sub['name'], sub['org']))
    return maps


def _lookup_yearly(key: str, year, year_maps: dict, max_year_gap: int):
    """单键查找：先当年，缺席则在 |Δ年| ≤ max_year_gap 内就近借（并列取更近的晚年）。"""
    if pd.isna(year):
        return None
    y = int(year)
    exact = year_maps.get(y, {}).get(key)
    if exact is not None:
        return exact
    candidates = []
    for ym, m in year_maps.items():
        gap = abs(ym - y)
        if 0 < gap <= max_year_gap and key in m:
            candidates.append((gap, -ym, m[key]))  # -ym：同距优先更晚的年份（更接近现架构）
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2]


def resolve_other_by_salesman_yearly(org_series: pd.Series, name_series: pd.Series,
                                     year_series: pd.Series, year_maps: dict, units: set,
                                     max_year_gap: int = DEFAULT_MAX_YEAR_GAP) -> tuple[pd.Series, int, int]:
    """把 org_series 中值为「其他」的行按（业务员全串 × 报价年份）映射到经营单元。

    当年映射优先，邻年（|Δ年| ≤ max_year_gap）兜底。返回
    (解析后的 Series, 待解析「其他」行数, 成功解析行数)。映射值再过一遍 units
    白名单（防映射被注入脏值）；解析不出保留「其他」。不修改入参（immutable）。
    """
    org = org_series.astype('string')
    is_other = (org == '其他').fillna(False)
    n_other = int(is_other.sum())
    if n_other == 0 or not year_maps:
        return org_series.copy(), n_other, 0
    names = name_series.astype('string').str.strip()
    # 只对（键, 年）去重后的组合查一次表，再广播回行——避免逐行 Python 调用
    pairs = pd.DataFrame({'name': names[is_other], 'year': year_series[is_other]})
    uniq = pairs.drop_duplicates()
    uniq['org'] = [
        _lookup_yearly(k, y, year_maps, max_year_gap)
        for k, y in zip(uniq['name'], uniq['year'])
    ]
    merged = pairs.merge(uniq, on=['name', 'year'], how='left')
    mapped = pd.Series(pd.array(merged['org'], dtype='string'), index=pairs.index)
    mapped = mapped.where(mapped.isin(list(units)))
    resolved = org.copy()
    hit_idx = mapped.dropna().index
    resolved.loc[hit_idx] = mapped.loc[hit_idx]
    n_resolved = int(mapped.notna().sum())
    return resolved, n_other, n_resolved


def enforce_resolution_gate(total_rows: int, n_other_after: int, *, reason: str,
                            env=None, threshold: float = OTHER_SHARE_FAIL_THRESHOLD) -> None:
    """清分闸（fail-closed）：清分后「其他」占比超阈即抛错阻断，除非显式降级。

    reason 描述触发场景（依赖缺失/覆盖不足），进错误消息与告警，可回溯。
    """
    if total_rows <= 0:
        return
    share = n_other_after / total_rows
    if share <= threshold:
        return
    msg = (
        f"报价机构清分失效：「其他」残留 {n_other_after:,}/{total_rows:,} 行"
        f"（{share:.1%} > 阈值 {threshold:.0%}）。{reason}。"
        f"默认阻断发布（B006 同款红线：宁可不发布也不静默错口径）；"
        f"确需带缺口发布请显式设 {DEGRADED_ENV_KEY}=1 并在发布记录中注明。"
    )
    if degraded_mode_allowed(env):
        print(f"\n   🔴 [降级续跑·已显式授权] {msg}")
        return
    raise QuoteOrgResolutionError(msg)
