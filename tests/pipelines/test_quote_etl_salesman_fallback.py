"""报价域「其他」业务员按年回退清分（BACKLOG e04971 报价侧方案）单测。

覆盖：① 分年映射构建（按年分桶 / 白名单过滤 / 年内签单量最多 / 并列取字典序 / 空目录容错）
② 行级解析（当年优先 / 邻年兜底 / 超年距不借 / 年份 NaN 落空 / 白名单双保险 / 入参不可变）
③ 清分闸（默认阻断 / 显式降级 / 低于阈值放行）
④ normalize_org_level_3 集成（按年清分 / 依赖缺失默认阻断 / 降级续跑 / SC 不启用）。

fixture 用生产真实格式（回归锁）：两域业务员均为「工号+姓名」全串
（签单域 salesman_name 本就带工号前缀），匹配键 = 原始全串不拆姓名——
2026-07-16 曾因拆名匹配（键对不上）静默解析 0 行，靠真实格式 fixture 拦住。
"""

import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / '数据管理'))

from pipelines.salesman_org_fallback import (
    QuoteOrgResolutionError,
    build_salesman_org_maps_by_year,
    enforce_resolution_gate,
    resolve_other_by_salesman_yearly,
)
from pipelines.quote_etl import normalize_org_level_3

UNITS = {'太原一部', '太原二部', '经代', '车商', '重客', '大同'}


def _write_policy(tmp_path: Path, rows: list[tuple]) -> Path:
    """rows: (salesman_name, org_level_3, policy_date字符串)"""
    d = tmp_path / 'validation_SX'
    d.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=['salesman_name', 'org_level_3', 'policy_date'])
    df['policy_date'] = pd.to_datetime(df['policy_date'])
    df.to_parquet(d / 'policy.parquet')
    return d


class BuildYearMapsTest(unittest.TestCase):
    def test_year_partition_and_cross_year_move(self):
        # 用户裁定核心场景：跨年组织架构调整——同一业务员 2025 属大同、2026 属太原一部，
        # 分年映射必须各归各年，不许一年的签单量压过另一年
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031100张三', '大同', '2025-03-01'),
                ('110031100张三', '大同', '2025-04-01'),
                ('110031100张三', '大同', '2025-05-01'),
                ('110031100张三', '太原一部', '2026-01-10'),
            ])
            maps = build_salesman_org_maps_by_year(d, UNITS)
        self.assertEqual(maps[2025]['110031100张三'], '大同')
        self.assertEqual(maps[2026]['110031100张三'], '太原一部')

    def test_within_year_max_count_and_tie_break(self):
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031101李四', '太原一部', '2026-01-01'),
                ('110031101李四', '太原一部', '2026-02-01'),
                ('110031101李四', '太原二部', '2026-03-01'),
                ('110031102王五', '车商', '2026-01-01'),  # 并列 1:1 → 字典序最小「经代」
                ('110031102王五', '经代', '2026-02-01'),
            ])
            maps = build_salesman_org_maps_by_year(d, UNITS)
        self.assertEqual(maps[2026]['110031101李四'], '太原一部')
        self.assertEqual(maps[2026]['110031102王五'], '经代')

    def test_whitelist_and_blank_filtered(self):
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031103赵六', '其他', '2026-01-01'),
                ('110031103赵六', '不存在的单元', '2026-02-01'),
                ('', '太原一部', '2026-03-01'),
            ])
            self.assertEqual(build_salesman_org_maps_by_year(d, UNITS), {})

    def test_missing_dir_and_empty_dir_return_empty(self):
        self.assertEqual(build_salesman_org_maps_by_year('/nonexistent/xxx', UNITS), {})
        with tempfile.TemporaryDirectory() as t:
            self.assertEqual(build_salesman_org_maps_by_year(t, UNITS), {})


class ResolveYearlyTest(unittest.TestCase):
    MAPS = {
        2025: {'110031100张三': '大同'},
        2026: {'110031100张三': '太原一部', '110031104张三': '车商'},
    }

    def test_same_year_preferred_over_adjacent(self):
        # 2025 年的报价按 2025 映射归大同，2026 年的按 2026 归太原一部——同一个人
        org = pd.Series(['其他', '其他'])
        names = pd.Series(['110031100张三', '110031100张三'])
        years = pd.Series([2025, 2026])
        resolved, n_other, n_hit = resolve_other_by_salesman_yearly(org, names, years, self.MAPS, UNITS)
        self.assertEqual(list(resolved), ['大同', '太原一部'])
        self.assertEqual((n_other, n_hit), (2, 2))
        self.assertEqual(list(org), ['其他', '其他'])  # 入参不被修改

    def test_adjacent_year_borrow_within_gap(self):
        # 110031104张三 只在 2026 有签单；其 2025 年报价按邻年（±1）借 2026 归车商
        org = pd.Series(['其他'])
        resolved, _, n_hit = resolve_other_by_salesman_yearly(
            org, pd.Series(['110031104张三']), pd.Series([2025]), self.MAPS, UNITS)
        self.assertEqual(list(resolved), ['车商'])
        self.assertEqual(n_hit, 1)

    def test_beyond_gap_not_borrowed(self):
        # 2023 年报价距最近映射年（2025）超 ±1 → 不借，保留「其他」
        org = pd.Series(['其他'])
        resolved, _, n_hit = resolve_other_by_salesman_yearly(
            org, pd.Series(['110031100张三']), pd.Series([2023]), self.MAPS, UNITS)
        self.assertEqual(list(resolved), ['其他'])
        self.assertEqual(n_hit, 0)

    def test_nan_year_and_unknown_salesman_keep_other(self):
        org = pd.Series(['其他', '其他', '大同'])
        names = pd.Series(['110031100张三', '999999999无名', '110031100张三'])
        years = pd.Series([None, 2026, 2026], dtype='float')
        resolved, n_other, n_hit = resolve_other_by_salesman_yearly(org, names, years, self.MAPS, UNITS)
        self.assertEqual(list(resolved), ['其他', '其他', '大同'])  # 非其他行不动
        self.assertEqual((n_other, n_hit), (2, 0))

    def test_map_value_outside_whitelist_ignored(self):
        maps = {2026: {'110031100张三': '脏值'}}
        resolved, _, n_hit = resolve_other_by_salesman_yearly(
            pd.Series(['其他']), pd.Series(['110031100张三']), pd.Series([2026]), maps, UNITS)
        self.assertEqual(list(resolved), ['其他'])
        self.assertEqual(n_hit, 0)


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


class NormalizeIntegrationTest(unittest.TestCase):
    """经 normalize_org_level_3 集成：报价源准确值 + 其他行 → 业务员按年清分。"""

    def _quotes_df(self):
        return pd.DataFrame({
            'org_level_3': ['其他', '经代', '其他', '大同', '其他'],
            'salesman_raw': ['110031100张三', '110031101赵六', '110031102李壹',
                             '110031103张三', '110031100张三'],
        })

    def _years(self):
        return pd.Series([2025, 2026, 2026, 2026, 2026])

    def test_sx_yearly_resolution_full_raw_key(self):
        # 同一个 110031100张三：2025 年报价归大同（当年映射），2026 年报价归太原一部——
        # 跨年架构调整各归各年；110031102李壹 当年缺席按邻年借
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [
                ('110031100张三', '大同', '2025-06-01'),
                ('110031100张三', '大同', '2025-07-01'),
                ('110031100张三', '太原一部', '2026-01-10'),
                ('110031100张三', '太原一部', '2026-02-10'),
                ('110031102李壹', '经代', '2025-05-01'),
            ])
            out = normalize_org_level_3(self._quotes_df(), 'SX', env={},
                                        policy_dir=d, quote_years=self._years())
        self.assertEqual(list(out['org_level_3']), ['大同', '经代', '经代', '大同', '太原一部'])

    def test_partial_coverage_over_threshold_blocked(self):
        # 对照缺人 → 残留「其他」超阈（2/5=40% > 5%）→ 清分闸默认阻断
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [('110031100张三', '太原一部', '2026-01-10')])
            with self.assertRaises(QuoteOrgResolutionError):
                normalize_org_level_3(self._quotes_df(), 'SX', env={},
                                      policy_dir=d, quote_years=self._years())

    def test_missing_years_blocked_by_default(self):
        # 评审 P1：清分依赖缺失（quote_years 未提供）不再静默续跑——默认阻断
        with self.assertRaises(QuoteOrgResolutionError):
            normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=None)

    def test_degraded_env_keeps_other(self):
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
