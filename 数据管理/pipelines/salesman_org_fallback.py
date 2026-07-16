"""业务员 → 经营单元回退映射（报价域「其他」清分 — BACKLOG e04971 报价侧方案）。

背景：山西报价上游（BI 主题「山西报价清单me」组件 04_quetolist）的「三级机构」
按行派生，城市单元与 经代/车商/重客 已准确，但太原片区整体落「其他」（约 29%，
组件派生规则覆盖不到）。用户裁定（2026-07-16）：报价域「其他」行改由**业务员对照**
清分——每天用最新签单域（premium parquet，org_level_3 已是 13 单元新口径）里
业务员 ↔ 机构 的对照关系，把报价里值为「其他」的 org_level_3 解析到真实单元。

设计约束：
- 匹配键 =「工号+姓名」原始全串：签单域 salesman_name 与报价域 业务员 同为
  工号前缀拼姓名格式（如「118226546彭佩」）。刻意不拆姓名——工号天然区分
  同名业务员，重名跨机构错归风险归零。
- 窗口对齐（评审锁定，2026-07-16）：映射只取 policy_date >= since（报价窗口
  起点）的签单行——2021 全历史投票会把调动过的业务员归到旧机构（实测全历史 vs
  近窗映射有 21 人归属不同、波及 9.17% 报价行）。近窗对照实测行覆盖 99.7%，
  与全历史（99.8%）几乎无损失。
- 归属规则对齐 SX 业务员维度表（generate_dim_tables.build_sx_salesman_from_parquet）：
  按签单量最多的机构作为该业务员归属；并列时取机构名字典序最小（确定性）。
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

# 清分后「其他」占比仍超过此值 → 视为清分失效（正常态实测 ≈0.2%；上游报价卡
# 太原片区落「其他」约 29%，若依赖断裂会整体残留，5% 足以区分两种状态）
OTHER_SHARE_FAIL_THRESHOLD = 0.05

DEGRADED_ENV_KEY = 'QUOTE_ORG_FALLBACK_ALLOW_DEGRADED'


class QuoteOrgResolutionError(RuntimeError):
    """报价机构清分失效（依赖缺失或残留「其他」超阈）——默认阻断发布。"""


def degraded_mode_allowed(env=None) -> bool:
    """是否显式授权降级续跑（QUOTE_ORG_FALLBACK_ALLOW_DEGRADED=1/true/yes/on）。"""
    import os
    src = env if env is not None else os.environ
    return str(src.get(DEGRADED_ENV_KEY, '')).strip().lower() in {'1', 'true', 'yes', 'on'}


def build_salesman_org_map(policy_dir: 'Path | str', units: set, since=None) -> dict:
    """从签单域 parquet 目录构建 业务员全串 → 经营单元 映射。

    只扫 policy_dir 顶层 *.parquet（premium 产物；validation/<省>/ 下的
    quotes_conversion/claims_detail/dim 等子目录天然不被顶层 glob 命中）。
    since 给定时仅统计 policy_date >= since 的行（报价窗口对齐，防历史机构
    投票压过现机构）。org 不在 units 白名单、或键为空的行不参与归属。
    返回 dict[str, str]；目录不存在或无可读 parquet 返回空 dict（由调用方
    按 fail-closed 语义决定是否阻断）。
    """
    base = Path(policy_dir)
    if not base.is_dir():
        return {}
    files = sorted(base.glob('*.parquet'))
    if not files:
        return {}
    cols = ['salesman_name', 'org_level_3'] + (['policy_date'] if since is not None else [])
    frames = []
    for f in files:
        try:
            frames.append(pd.read_parquet(f, columns=cols))
        except Exception as e:  # 列缺失/文件损坏：跳过该文件，不让单文件毁掉整个映射
            print(f"   ⚠️ 业务员映射源跳过 {f.name}: {e}")
    if not frames:
        return {}
    df = pd.concat(frames, ignore_index=True)
    if since is not None:
        dates = pd.to_datetime(df['policy_date'], errors='coerce')
        df = df[dates >= pd.Timestamp(since)]
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
    """把 org_series 中值为「其他」的行按业务员全串映射到经营单元。

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
