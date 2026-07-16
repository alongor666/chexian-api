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

from pipelines.salesman_org_fallback import build_salesman_org_map, resolve_other_by_salesman
from pipelines.quote_etl import normalize_org_level_3

UNITS = {'太原一部', '太原二部', '经代', '车商', '重客', '大同'}


def _write_policy(tmp_path: Path, rows: list[tuple[str, str]]) -> Path:
    d = tmp_path / 'validation_SX'
    d.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows, columns=['salesman_name', 'org_level_3']).to_parquet(d / 'policy.parquet')
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
    """经 normalize_org_level_3 集成：报价源准确值 + 其他行 → 业务员清分。"""

    def _quotes_df(self):
        return pd.DataFrame({
            'org_level_3': ['其他', '经代', '其他', '大同'],
            'salesman_raw': ['110031100张三', '110031101赵六', '110031102无名氏', '110031103张三'],
        })

    def test_sx_with_policy_dir_resolves_other(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = _write_policy(Path(t), [('张三', '太原一部'), ('张三', '太原一部')])
            out = normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=d)
        self.assertEqual(list(out['org_level_3']), ['太原一部', '经代', '其他', '大同'])

    def test_policy_dir_none_keeps_other(self):
        out = normalize_org_level_3(self._quotes_df(), 'SX', env={}, policy_dir=None)
        self.assertEqual(list(out['org_level_3']), ['其他', '经代', '其他', '大同'])

    def test_sc_untouched(self):
        df = self._quotes_df()
        out = normalize_org_level_3(df, 'SC', env={}, policy_dir='/nonexistent')
        self.assertEqual(list(out['org_level_3']), list(df['org_level_3']))


if __name__ == '__main__':
    unittest.main()
