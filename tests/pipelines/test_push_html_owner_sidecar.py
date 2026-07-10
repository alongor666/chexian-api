"""push_html.py 报告归属 sidecar 生产方契约单测（B003 / backlog 2026-06-22-16ab1c-b842bc）。

被测函数：数据管理/integrations/wecom_bot/push_html.py 的 write_report_owner_sidecar。
契约消费方：server/src/routes/reports.ts resolveReportOwner——
  - 单文件 foo.html → 旁路 foo.html.meta.json
  - 内容 { "ownerOrg": "<org_level_3 非空>", "ownerBranch": "<^[A-Z]{2}$ 可选>" }
  - ownerBranch 若声明但不匹配 ^[A-Z]{2}$ → 消费侧整体判 null（fail-closed）
本测试锁死生产侧产物与该 schema 的一致性，防两侧各自演化后静默失配。
"""
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
WECOM_BOT_DIR = ROOT / "数据管理" / "integrations" / "wecom_bot"
if str(WECOM_BOT_DIR) not in sys.path:
    sys.path.insert(0, str(WECOM_BOT_DIR))

from push_html import write_report_owner_sidecar  # noqa: E402

# 与 reports.ts resolveReportOwner 的 ownerBranch 校验保持同一正则
OWNER_BRANCH_PATTERN = re.compile(r"^[A-Z]{2}$")


def _make_report(tmp_path: Path) -> Path:
    target = tmp_path / "20260710-demo-abcd1234.html"
    target.write_text("<html></html>", encoding="utf-8")
    return target


def test_org_and_branch_writes_contract_payload(tmp_path: Path) -> None:
    target = _make_report(tmp_path)
    sidecar = write_report_owner_sidecar(target, "天府", "SC")
    assert sidecar is not None
    # 命名契约：<报告文件名>.meta.json（reports.ts 用 `${fullPath}.meta.json` 拼路径）
    assert sidecar.name == target.name + ".meta.json"
    assert sidecar.parent == target.parent
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload == {"ownerOrg": "天府", "ownerBranch": "SC"}
    assert OWNER_BRANCH_PATTERN.fullmatch(payload["ownerBranch"])


def test_org_only_omits_owner_branch(tmp_path: Path) -> None:
    target = _make_report(tmp_path)
    sidecar = write_report_owner_sidecar(target, "乐山", None)
    assert sidecar is not None
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload == {"ownerOrg": "乐山"}


def test_no_org_no_branch_writes_nothing(tmp_path: Path) -> None:
    """省级/跨机构报告不带归属：不产 sidecar → 消费侧 owner=null 仅 branch_admin。"""
    target = _make_report(tmp_path)
    assert write_report_owner_sidecar(target, None, None) is None
    assert write_report_owner_sidecar(target, "  ", "") is None
    assert not list(tmp_path.glob("*.meta.json"))


def test_branch_without_org_fails_closed(tmp_path: Path) -> None:
    target = _make_report(tmp_path)
    with pytest.raises(ValueError, match="ownerOrg"):
        write_report_owner_sidecar(target, "", "SC")
    assert not list(tmp_path.glob("*.meta.json"))


def test_lowercase_branch_normalized_to_contract(tmp_path: Path) -> None:
    target = _make_report(tmp_path)
    sidecar = write_report_owner_sidecar(target, "高新", "sx")
    assert sidecar is not None
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload["ownerBranch"] == "SX"
    assert OWNER_BRANCH_PATTERN.fullmatch(payload["ownerBranch"])


@pytest.mark.parametrize("bad_branch", ["S1", "SCX", "S", "s-", "四川"])
def test_invalid_branch_rejected_not_emitted(tmp_path: Path, bad_branch: str) -> None:
    """坏 branch 必须生产侧就拒绝（若放行，消费侧会把整个 sidecar 判 null 导致静默 403）。"""
    target = _make_report(tmp_path)
    with pytest.raises(ValueError, match="两位大写"):
        write_report_owner_sidecar(target, "天府", bad_branch)
    assert not list(tmp_path.glob("*.meta.json"))
