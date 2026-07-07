"""data-sources-status.json 运行时状态写入/合并单测（B314）。

被测模块：数据管理/pipelines/data_sources_updater.py

背景：data-sources.json 是入库契约文件（域定义/路径等静态信息），运行时状态字段
（row_count / last_updated / data_range / field_count）拆分到 data-sources-status.json
（gitignored，ETL 自动生成）。本文件用 tempfile 构造临时契约 + 状态文件，
不依赖仓库真实数据（hermetic，遵守 pytest.ini 纪律）。

核心验收断言：update_data_sources() 对已知域写入状态文件后，契约文件字节内容零变化。
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.data_sources_updater import (  # noqa: E402
    read_merged_domains,
    update_data_sources,
    write_data_sources_status,
)


def _write_contract(path: Path, domains: list) -> None:
    """写一份最小契约文件（模拟 data-sources.json 的结构）。"""
    payload = {
        "_comment": "测试用最小契约",
        "domains": domains,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class WriteDataSourcesStatusTest(unittest.TestCase):
    def test_first_write_creates_file_with_comment_skeleton(self):
        """状态文件首次不存在时，写入应自动创建骨架（含 _comment）+ 正确条目。"""
        with tempfile.TemporaryDirectory() as tmp:
            status_path = Path(tmp) / "data-sources-status.json"
            self.assertFalse(status_path.exists())

            entry = write_data_sources_status(
                "premium",
                row_count=100,
                field_count=10,
                data_range="2024-01-01 ~ 2024-12-31",
                last_updated="2026-07-07",
                status_path=status_path,
            )

            self.assertTrue(status_path.exists())
            on_disk = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertIn("_comment", on_disk)
            self.assertEqual(
                on_disk["domains"]["premium"],
                {
                    "last_updated": "2026-07-07",
                    "row_count": 100,
                    "field_count": 10,
                    "data_range": "2024-01-01 ~ 2024-12-31",
                },
            )
            self.assertEqual(entry, on_disk["domains"]["premium"])

    def test_second_write_same_domain_overwrites(self):
        """同域二次写入应覆盖旧值，不残留过期字段。"""
        with tempfile.TemporaryDirectory() as tmp:
            status_path = Path(tmp) / "data-sources-status.json"

            write_data_sources_status(
                "premium",
                row_count=100,
                field_count=10,
                data_range="2024-01-01 ~ 2024-12-31",
                last_updated="2026-07-01",
                status_path=status_path,
            )
            write_data_sources_status(
                "premium",
                row_count=200,
                field_count=12,
                data_range="2024-01-01 ~ 2025-01-01",
                last_updated="2026-07-07",
                status_path=status_path,
            )

            on_disk = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk["domains"]["premium"]["row_count"], 200)
            self.assertEqual(on_disk["domains"]["premium"]["field_count"], 12)
            self.assertEqual(on_disk["domains"]["premium"]["last_updated"], "2026-07-07")

    def test_write_another_domain_does_not_affect_existing(self):
        """写入不同域不应影响已有域的条目。"""
        with tempfile.TemporaryDirectory() as tmp:
            status_path = Path(tmp) / "data-sources-status.json"

            write_data_sources_status(
                "premium",
                row_count=100,
                last_updated="2026-07-01",
                status_path=status_path,
            )
            write_data_sources_status(
                "claims",
                row_count=500,
                last_updated="2026-07-02",
                status_path=status_path,
            )

            on_disk = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk["domains"]["premium"]["row_count"], 100)
            self.assertEqual(on_disk["domains"]["claims"]["row_count"], 500)

    def test_none_keys_are_not_written(self):
        """field_count / data_range 缺省（None）时，条目中不应出现这些键。"""
        with tempfile.TemporaryDirectory() as tmp:
            status_path = Path(tmp) / "data-sources-status.json"

            entry = write_data_sources_status(
                "premium",
                row_count=100,
                last_updated="2026-07-07",
                status_path=status_path,
            )

            self.assertNotIn("field_count", entry)
            self.assertNotIn("data_range", entry)
            self.assertEqual(entry["row_count"], 100)


class ReadMergedDomainsTest(unittest.TestCase):
    def test_status_overrides_contract_value(self):
        """status 中的字段应覆盖契约中的同名字段。"""
        with tempfile.TemporaryDirectory() as tmp:
            contract_path = Path(tmp) / "data-sources.json"
            status_path = Path(tmp) / "data-sources-status.json"

            _write_contract(
                contract_path,
                [{"id": "premium", "name": "保费", "row_count": 1, "field_count": 1}],
            )
            write_data_sources_status(
                "premium",
                row_count=999,
                field_count=42,
                last_updated="2026-07-07",
                status_path=status_path,
            )

            merged = read_merged_domains(data_sources_path=contract_path, status_path=status_path)
            premium = next(d for d in merged if d["id"] == "premium")
            self.assertEqual(premium["row_count"], 999)
            self.assertEqual(premium["field_count"], 42)
            self.assertEqual(premium["name"], "保费")

    def test_missing_status_entry_falls_back_to_contract_frozen_snapshot(self):
        """status 无该域条目时，回落契约中的冻结快照值（deprecated 域兜底场景）。"""
        with tempfile.TemporaryDirectory() as tmp:
            contract_path = Path(tmp) / "data-sources.json"
            status_path = Path(tmp) / "data-sources-status.json"

            _write_contract(
                contract_path,
                [
                    {
                        "id": "legacy_domain",
                        "deprecated": True,
                        "row_count": 12345,
                        "field_count": 7,
                    }
                ],
            )
            # status 文件存在，但不含 legacy_domain 条目
            write_data_sources_status("premium", row_count=1, status_path=status_path)

            merged = read_merged_domains(data_sources_path=contract_path, status_path=status_path)
            legacy = next(d for d in merged if d["id"] == "legacy_domain")
            self.assertEqual(legacy["row_count"], 12345)
            self.assertEqual(legacy["field_count"], 7)

    def test_missing_status_file_returns_contract_values_unchanged(self):
        """状态文件整体缺失时，返回契约原始值。"""
        with tempfile.TemporaryDirectory() as tmp:
            contract_path = Path(tmp) / "data-sources.json"
            status_path = Path(tmp) / "data-sources-status.json"  # 不创建

            _write_contract(
                contract_path,
                [{"id": "premium", "row_count": 1, "field_count": 1}],
            )

            merged = read_merged_domains(data_sources_path=contract_path, status_path=status_path)
            premium = next(d for d in merged if d["id"] == "premium")
            self.assertEqual(premium["row_count"], 1)
            self.assertEqual(premium["field_count"], 1)


class UpdateDataSourcesTest(unittest.TestCase):
    def test_unknown_domain_warns_and_creates_no_status_entry(self):
        """未知 domain_id：照旧打印警告 + 不写状态条目。"""
        with tempfile.TemporaryDirectory() as tmp:
            contract_path = Path(tmp) / "data-sources.json"
            status_path = Path(tmp) / "data-sources-status.json"
            _write_contract(contract_path, [{"id": "premium"}])

            import pipelines.data_sources_updater as updater_module

            original_contract_path = updater_module.DATA_SOURCES_PATH
            original_status_path = updater_module.DATA_SOURCES_STATUS_PATH
            updater_module.DATA_SOURCES_PATH = contract_path
            updater_module.DATA_SOURCES_STATUS_PATH = status_path
            try:
                result = updater_module.update_data_sources("not_registered_domain", row_count=1)
            finally:
                updater_module.DATA_SOURCES_PATH = original_contract_path
                updater_module.DATA_SOURCES_STATUS_PATH = original_status_path

            self.assertFalse(result)
            self.assertFalse(status_path.exists())

    def test_known_domain_writes_status_and_leaves_contract_byte_identical(self):
        """已知域：写入状态文件成功，且契约文件字节内容零变化（B314 核心验收断言）。"""
        with tempfile.TemporaryDirectory() as tmp:
            contract_path = Path(tmp) / "data-sources.json"
            status_path = Path(tmp) / "data-sources-status.json"
            _write_contract(
                contract_path,
                [{"id": "premium", "name": "保费", "row_count": 1, "field_count": 1}],
            )
            contract_bytes_before = contract_path.read_bytes()

            import pipelines.data_sources_updater as updater_module

            original_contract_path = updater_module.DATA_SOURCES_PATH
            original_status_path = updater_module.DATA_SOURCES_STATUS_PATH
            updater_module.DATA_SOURCES_PATH = contract_path
            updater_module.DATA_SOURCES_STATUS_PATH = status_path
            try:
                result = updater_module.update_data_sources(
                    "premium",
                    row_count=4464114,
                    field_count=42,
                    data_range="2021-01-01 ~ 2026-05-16",
                )
            finally:
                updater_module.DATA_SOURCES_PATH = original_contract_path
                updater_module.DATA_SOURCES_STATUS_PATH = original_status_path

            self.assertTrue(result)
            contract_bytes_after = contract_path.read_bytes()
            self.assertEqual(
                contract_bytes_before,
                contract_bytes_after,
                "update_data_sources() 不应修改契约文件内容",
            )

            on_disk_status = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk_status["domains"]["premium"]["row_count"], 4464114)
            self.assertEqual(on_disk_status["domains"]["premium"]["field_count"], 42)
            self.assertEqual(
                on_disk_status["domains"]["premium"]["data_range"],
                "2021-01-01 ~ 2026-05-16",
            )


if __name__ == "__main__":
    unittest.main()
