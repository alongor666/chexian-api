"""B006 quote_etl 机构规范化 + 塌缩守卫单测

背景（缺口 B006-2026-07-10）：山西报价域 612,702 行 org_level_3 全量坍缩「其他」。
双因：① 上游 #02 报价清单无山西省份感知（旧卡「三级机构」恒为「其他」）；
② quote_etl.py 此前不做 org_to_unit 规范化，上游修好也不会映射到经营单元。

本文件锁定本地半边的契约（对齐 transform.py normalize_branch_org G5 语义）：

- resolve_org_column_variant：裸「机构」列（山西正确卡格式）→「三级机构」；
  两列并存保留「三级机构」不二义；无机构列 no-op
- normalize_org_level_3：SC 原样返回（四川字节级安全）；SX 按 SX.json org_to_unit
  映射编码全称 → 经营单元；未映射值保留原始值不静默丢数据
- 塌缩守卫：占位值（其他/NULL/空）合计 ≥ 阈值 → 默认告警不中断；
  ORG_COLLAPSE_FAIL=1 → 抛 OrgDimensionCollapseError；健康分布不触发
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.org_collapse import OrgDimensionCollapseError  # noqa: E402
from pipelines.salesman_org_fallback import QuoteOrgResolutionError  # noqa: E402
from pipelines.quote_etl import (  # noqa: E402
    normalize_org_level_3,
    resolve_org_column_variant,
)

# SX.json org_to_unit 中的真实键（仓库内提交的映射表，测试与生产同源）
SX_CODED_ORG = "0118010109太原市鼎晨花园营销服务部（停用）"
SX_EXPECTED_UNIT = "太原一部"


class ResolveOrgColumnVariantTest(unittest.TestCase):
    def test_bare_org_column_renamed(self):
        df = pd.DataFrame({"机构": ["a"], "车架号": ["v1"]})
        out = resolve_org_column_variant(df)
        self.assertIn("三级机构", out.columns)
        self.assertNotIn("机构", out.columns)

    def test_both_columns_keep_canonical(self):
        # 两列并存 → 保留「三级机构」，「机构」原样留给未映射列丢弃路径
        df = pd.DataFrame({"机构": ["a"], "三级机构": ["b"]})
        out = resolve_org_column_variant(df)
        self.assertEqual(out["三级机构"].tolist(), ["b"])
        self.assertIn("机构", out.columns)

    def test_no_org_column_noop(self):
        df = pd.DataFrame({"车架号": ["v1"]})
        out = resolve_org_column_variant(df)
        self.assertEqual(list(out.columns), ["车架号"])


class NormalizeOrgLevel3Test(unittest.TestCase):
    def test_sc_returns_unchanged(self):
        # 四川字节级安全：SC 不做任何映射
        df = pd.DataFrame({"org_level_3": [SX_CODED_ORG, "其他"]})
        out = normalize_org_level_3(df, "SC")
        self.assertEqual(out["org_level_3"].tolist(), [SX_CODED_ORG, "其他"])

    def test_missing_column_noop(self):
        df = pd.DataFrame({"policy_no": ["6180001"]})
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(list(out.columns), ["policy_no"])

    def test_sx_maps_coded_org_to_unit(self):
        df = pd.DataFrame({"org_level_3": [SX_CODED_ORG] * 3})
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(out["org_level_3"].tolist(), [SX_EXPECTED_UNIT] * 3)

    def test_sx_unmapped_value_preserved(self):
        # 未在映射表中的机构保留原始值（不静默丢数据）；混入真实机构避免触发塌缩守卫
        df = pd.DataFrame({"org_level_3": ["不存在的机构X", SX_CODED_ORG]})
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(out["org_level_3"].tolist(), ["不存在的机构X", SX_EXPECTED_UNIT])

    def test_sx_does_not_mutate_input(self):
        df = pd.DataFrame({"org_level_3": [SX_CODED_ORG]})
        normalize_org_level_3(df, "SX")
        self.assertEqual(df["org_level_3"].tolist(), [SX_CODED_ORG])

    def test_collapsed_default_now_blocked_by_resolution_gate(self):
        # 2026-07-16 评审 P1 语义变更：全「其他」默认不再放行——清分闸 fail-closed 阻断
        df = pd.DataFrame({"org_level_3": ["其他"] * 100})
        with self.assertRaises(QuoteOrgResolutionError):
            normalize_org_level_3(df, "SX", env={})

    def test_collapsed_warn_mode_passes_only_with_explicit_degraded(self):
        # 塌缩守卫默认告警不中断的既有语义仍在，但须显式降级授权才能走完出口
        df = pd.DataFrame({"org_level_3": ["其他"] * 100})
        out = normalize_org_level_3(df, "SX", env={"QUOTE_ORG_FALLBACK_ALLOW_DEGRADED": "1"})
        self.assertEqual(out["org_level_3"].nunique(), 1)

    def test_collapsed_fail_mode_raises(self):
        df = pd.DataFrame({"org_level_3": ["其他"] * 99 + [None]})
        with self.assertRaises(OrgDimensionCollapseError):
            normalize_org_level_3(df, "SX", env={"ORG_COLLAPSE_FAIL": "1"})

    def test_healthy_distribution_no_raise_even_fail_mode(self):
        # 真实机构集中不是塌缩：映射后全为经营单元短名，FAIL=1 也不触发；
        # 「其他」3% 低于清分闸阈值（5%），默认也放行
        df = pd.DataFrame({"org_level_3": [SX_CODED_ORG] * 97 + ["其他"] * 3})
        out = normalize_org_level_3(df, "SX", env={"ORG_COLLAPSE_FAIL": "1"})
        self.assertEqual((out["org_level_3"] == SX_EXPECTED_UNIT).sum(), 97)


class NormalizeOrgLevel3NewCaliberTest(unittest.TestCase):
    """新口径（BACKLOG 2026-07-15-user-e04971）：org_level_3_new（三级机构新）优先。

    与 transform.py 的差异（刻意）：报价源缺新列只告警不硬失败——历史单日文件
    替换有时间差（上游 02 导出组件截至 2026-07-15 尚未含该列），过渡期沿旧合并
    口径产出，重建后以 parquet 值域验收兜底。
    """
    RETIRED_BUCKET_CODE = "0118010204山西分公司本部（渠道重客）"  # org_to_unit → 旧合并值（白名单外）

    def test_new_column_preferred_normalized_and_dropped(self):
        df = pd.DataFrame({
            "org_level_3_new": ["太原业务二部", "经代", "车商", "重客"],
            "org_level_3": [SX_CODED_ORG] * 4,
        })
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(out["org_level_3"].tolist(), ["太原二部", "经代", "车商", "重客"])
        self.assertNotIn("org_level_3_new", out.columns)

    def test_other_rows_fall_back_via_coded_org(self):
        df = pd.DataFrame({
            "org_level_3_new": ["其他", "晋中"],
            "org_level_3": [SX_CODED_ORG, SX_CODED_ORG],
        })
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(out["org_level_3"].tolist(), [SX_EXPECTED_UNIT, "晋中"])

    def test_fallback_to_retired_bucket_keeps_placeholder(self):
        # 回退命中旧合并值（白名单外）→ 保留「其他」，不产出退役值。
        # fixture「其他」占比 50% 会触发清分闸，此处显式降级只验行级语义
        df = pd.DataFrame({
            "org_level_3_new": ["其他", "晋中"],
            "org_level_3": [self.RETIRED_BUCKET_CODE, SX_CODED_ORG],
        })
        out = normalize_org_level_3(df, "SX", env={"QUOTE_ORG_FALLBACK_ALLOW_DEGRADED": "1"})
        self.assertEqual(out["org_level_3"].tolist(), ["其他", "晋中"])
        self.assertNotIn("经代、车商、重客", set(out["org_level_3"]))

    def test_missing_new_column_transitional_old_path(self):
        # 过渡态：缺新列 → 告警 + 沿旧路径映射（不硬失败，与 transform.py 不同）
        df = pd.DataFrame({"org_level_3": [SX_CODED_ORG] * 3})
        out = normalize_org_level_3(df, "SX")
        self.assertEqual(out["org_level_3"].tolist(), [SX_EXPECTED_UNIT] * 3)

    def test_sc_untouched_even_with_new_column(self):
        df = pd.DataFrame({"org_level_3": ["天府"], "org_level_3_new": ["晋中"]})
        out = normalize_org_level_3(df, "SC")
        self.assertEqual(out["org_level_3"].tolist(), ["天府"])
        self.assertIn("org_level_3_new", out.columns)


if __name__ == "__main__":
    unittest.main()
