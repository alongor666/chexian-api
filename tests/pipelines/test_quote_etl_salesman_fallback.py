"""报价域「其他」业务员回退清分（BACKLOG e04971 报价侧方案）单测。

覆盖：① 映射构建（白名单过滤 / 签单量最多 / 并列取字典序 / 空目录容错）
② 行级解析（其他→命中 / 其他→未命中保留 / 非其他不动 / 白名单双保险）
③ normalize_org_level_3 集成（policy_dir 注入 / None 跳过 / SC 不启用）。
"""

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / '数据管理'))

from pipelines.salesman_org_fallback import (
    QuoteOrgResolutionError,
    build_salesman_org_map,
    enforce_resolution_gate,
    resolve_other_by_salesman,
)
from pipelines.quote_etl import normalize_org_level_3

UNITS = {'太原一部', '太原二部', '经代', '车商', '重客', '大同'}


def _write_policy(tmp_path: Path, rows: list[tuple], with_date: bool = False) -> Path:
    d = tmp_path / 'validation_SX'
    d.mkdir(parents=True, exist_ok=True)
    cols = ['salesman_name', 'org_level_3'] + (['policy_date'] if with_date else [])
    df = pd.DataFrame(rows, columns=cols)
    if with_date:
        df['policy_date'] = pd.to_datetime(df['policy_date'])
    df.to_parquet(d / 'policy.parquet')
    return d


class BuildMapTest(unittest.TestCase):
    def test_max_count_wins_and_tie_breaks_deterministic(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('张三', '太原一部'), ('张三', '太原一部'), ('张三', '太原二部'),
                ('李四', '车商'), ('李四', '经代'),  # 并列 1:1 → 字典序最小「经代」
            ])
            m = build_salesman_org_map(d, UNITS)
        self.assertEqual(m['张三'], '太原一部')
        self.assertEqual(m['李四'], '经代')

    def test_whitelist_and_blank_filtered(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('王五', '其他'), ('王五', '不存在的单元'), ('', '太原一部'),
            ])
            m = build_salesman_org_map(d, UNITS)
        self.assertEqual(m, {})

    def test_missing_dir_and_empty_dir_return_empty(self):
        import tempfile
        self.assertEqual(build_salesman_org_map('/nonexistent/xxx', UNITS), {})
        with tempfile.TemporaryDirectory() as t:
            self.assertEqual(build_salesman_org_map(t, UNITS), {})

    def test_since_window_excludes_stale_history(self):
        # 评审锁定：调动业务员——历史签单量大于现单元，全历史投票会错归旧单元；
        # since 窗口对齐后只看近窗行，归现单元
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031100张三', '大同', '2024-03-01'),
                ('110031100张三', '大同', '2024-04-01'),
                ('110031100张三', '大同', '2024-05-01'),
                ('110031100张三', '太原一部', '2026-01-10'),
            ], with_date=True)
            full = build_salesman_org_map(d, UNITS)
            windowed = build_salesman_org_map(d, UNITS, since='2025-12-01')
        self.assertEqual(full['110031100张三'], '大同')        # 全历史投票 → 旧单元（错）
        self.assertEqual(windowed['110031100张三'], '太原一部')  # 窗口对齐 → 现单元（对）


class ResolutionGateTest(unittest.TestCase):
    """清分闸（评审 P1 · fail-closed）：残留「其他」超阈默认抛错，显式降级才放行。"""

    def test_over_threshold_raises_by_default(self):
        with self.assertRaises(QuoteOrgResolutionError):
            enforce_resolution_gate(100, 32, reason='单测', env={})

    def test_explicit_degraded_env_downgrades_to_warning(self):
        enforce_resolution_gate(100, 32, reason='单测',
                                env={'QUOTE_ORG_FALLBACK_ALLOW_DEGRADED': '1'})  # 不抛

    def test_under_threshold_passes(self):
        enforce_resolution_gate(100, 3, reason='单测', env={})  # 3% < 5%，不抛

    def test_empty_frame_noop(self):
        enforce_resolution_gate(0, 0, reason='单测', env={})


class ResolveTest(unittest.TestCase):
    def test_row_level_resolution(self):
        org = pd.Series(['其他', '其他', '大同', '其他'])
        names = pd.Series(['张三', '无名氏', '张三', '李四'])
        m = {'张三': '太原一部', '李四': '经代'}
        resolved, n_other, n_hit = resolve_other_by_salesman(org, names, m, UNITS)
        self.assertEqual(list(resolved), ['太原一部', '其他', '大同', '经代'])
        self.assertEqual((n_other, n_hit), (3, 2))
        self.assertEqual(list(org), ['其他', '其他', '大同', '其他'])  # 入参不被修改

    def test_map_value_outside_whitelist_ignored(self):
        org = pd.Series(['其他'])
        resolved, n_other, n_hit = resolve_other_by_salesman(
            org, pd.Series(['张三']), {'张三': '脏值'}, UNITS)
        self.assertEqual(list(resolved), ['其他'])
        self.assertEqual(n_hit, 0)


class NormalizeIntegrationTest(unittest.TestCase):
    """经 normalize_org_level_3 集成：报价源准确值 + 其他行 → 业务员清分。

    fixture 用生产真实格式（回归锁）：两域业务员均为「工号+姓名」全串
    （签单域 salesman_name 本就带工号前缀），匹配键 = 原始全串不拆姓名——
    2026-07-16 曾因拆名匹配（键对不上）静默解析 0 行，靠真实格式 fixture 拦住。
    """

    def _quotes_df(self):
        return pd.DataFrame({
            'org_level_3': ['其他', '经代', '其他', '大同', '其他'],
            'salesman_raw': ['110031100张三', '110031101赵六', '110031102李壹',
                             '110031103张三', '110031104张三'],
        })

    def test_sx_with_policy_dir_resolves_other_by_full_raw_key(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            # 签单域姓名带工号前缀（生产实况）；110031104张三 是同名不同工号的另一人，
            # 属车商——全串匹配必须把两个「张三」分别归对，不许串
            d = _write_policy(Path(t), [
                ('110031100张三', '太原一部'), ('110031100张三', '太原一部'),
                ('110031102李壹', '经代'),
                ('110031104张三', '车商'),
            ])
            out = normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=d)
        self.assertEqual(list(out['org_level_3']), ['太原一部', '经代', '经代', '大同', '车商'])

    def test_partial_coverage_over_threshold_blocked(self):
        # 对照缺人 → 残留「其他」超阈（1/5=20% > 5%）→ 清分闸默认阻断
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031100张三', '太原一部'),
                ('110031104张三', '车商'),
            ])  # 110031102李壹 缺席
            with self.assertRaises(QuoteOrgResolutionError):
                normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=d)

    def test_policy_dir_none_blocked_by_default(self):
        # 评审 P1：清分依赖缺失不再静默续跑——默认阻断
        with self.assertRaises(QuoteOrgResolutionError):
            normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=None)

    def test_policy_dir_none_degraded_env_keeps_other(self):
        out = normalize_org_level_3(self._quotes_df(), 'SX',
                                    env={'QUOTE_ORG_FALLBACK_ALLOW_DEGRADED': '1'},
                                    policy_dir=None)
        self.assertEqual(list(out['org_level_3']), ['其他', '经代', '其他', '大同', '其他'])

    def test_sc_untouched(self):
        df = self._quotes_df()
        out = normalize_org_level_3(df, 'SC', env={}, policy_dir='/nonexistent')
        self.assertEqual(list(out['org_level_3']), list(df['org_level_3']))


if __name__ == '__main__':
    unittest.main()
