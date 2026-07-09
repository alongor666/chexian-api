"""单测：机构 slug 省份化 SSOT 的等价迁移验证（BACKLOG 2026-07-07-claude-cfaf91）。

背景：sync_org_renewal_from_xlsx.py 曾把四川 12 机构的「中文名→拼音 slug」与
「中文名→webhook 环境变量后缀」硬编码成两份平行 dict（多省硬编码债）。抽到省份化
SSOT org-slugs.json（按 branch_code 键）后，本测试锁死三件事：
    1. 从 JSON 派生的 ORG_SLUGS / ORG_ENVS 与迁移前的 12 条硬编码**逐条等价**（证明
       等价迁移，非行为变更）。
    2. ORG_ENVS 恒等于 ORG_SLUGS 的大写形态（派生不变量，防止有人往 JSON 塞入
       env 后缀 ≠ slug 大写的机构而不显式声明）。
    3. slug 机构 ⊆ 四川机构花名册（branch-org-mapping/SC.json units），确保 slug 省份
       SSOT 不与省份机构清单 SSOT 漂移出未知机构。

纯配置，不需 parquet，CI 可跑。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent  # …/integrations/wecom_smartsheet
sys.path.insert(0, str(HERE))

import sync_org_renewal_from_xlsx as sync  # noqa: E402


# 迁移前的原始硬编码快照（frozen golden；改这里等于改口径，需评审）
EXPECTED_ORG_SLUGS = {
    "高新": "gaoxin",
    "自贡": "zigong",
    "青羊": "qingyang",
    "宜宾": "yibin",
    "天府": "tianfu",
    "达州": "dazhou",
    "德阳": "deyang",
    "武侯": "wuhou",
    "新都": "xindu",
    "泸州": "luzhou",
    "乐山": "leshan",
    "资阳": "ziyang",
}
EXPECTED_ORG_ENVS = {
    "高新": "GAOXIN",
    "自贡": "ZIGONG",
    "青羊": "QINGYANG",
    "宜宾": "YIBIN",
    "天府": "TIANFU",
    "达州": "DAZHOU",
    "德阳": "DEYANG",
    "武侯": "WUHOU",
    "新都": "XINDU",
    "泸州": "LUZHOU",
    "乐山": "LESHAN",
    "资阳": "ZIYANG",
}


def test_org_slugs_equivalent_to_original_hardcoded() -> None:
    """派生 ORG_SLUGS 与迁移前 12 条硬编码逐条等价。"""
    assert sync.ORG_SLUGS == EXPECTED_ORG_SLUGS


def test_org_envs_equivalent_to_original_hardcoded() -> None:
    """派生 ORG_ENVS 与迁移前 12 条硬编码逐条等价。"""
    assert sync.ORG_ENVS == EXPECTED_ORG_ENVS


def test_org_envs_is_uppercase_of_slug() -> None:
    """派生不变量：环境变量后缀恒 = slug 大写（防 JSON 混入 env ≠ upper(slug) 的机构）。"""
    assert sync.ORG_ENVS == {org: slug.upper() for org, slug in sync.ORG_SLUGS.items()}


def test_slug_orgs_subset_of_sichuan_roster() -> None:
    """slug 机构 ⊆ 四川机构花名册（branch-org-mapping/SC.json units）。

    复用既有省份机构清单 SSOT 做单向对账（花名册 14 个含无追踪表的重客/本部，slug 为其
    12 个子集），确保 org-slugs.json 不会登记花名册外的未知机构。
    """
    roster_path = HERE.parents[1] / "config" / "branch-org-mapping" / "SC.json"
    units = set(json.loads(roster_path.read_text(encoding="utf-8"))["units"])
    unknown = set(sync.ORG_SLUGS) - units
    assert not unknown, f"org-slugs.json SC 段含四川花名册外的机构：{unknown}"


def test_load_org_slugs_fail_closed_on_unknown_province() -> None:
    """fail-closed：未注册省份无 slug 映射时必须报错，禁止静默回落空表。"""
    import pytest

    with pytest.raises(RuntimeError, match="缺少省份"):
        sync._load_org_slugs("ZZ")
