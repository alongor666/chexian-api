"""单测：outputs/ 必须被 git 忽略（codex 审计 #7：敏感链接不入 git）。"""
from __future__ import annotations

import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def _git_check_ignore(path: Path) -> bool:
    """returns True if path is ignored by git."""
    proc = subprocess.run(
        ["git", "check-ignore", "-q", str(path)],
        cwd=str(HERE),
        capture_output=True,
    )
    # 0 = ignored, 1 = not ignored, 128 = not in repo
    return proc.returncode == 0


def test_outputs_distribute_md_is_ignored() -> None:
    """分发清单 markdown 必须被 .gitignore 忽略。"""
    target = HERE / "outputs" / "leshan_renewal_distribute.md"
    target.parent.mkdir(exist_ok=True)
    target.touch(exist_ok=True)
    try:
        assert _git_check_ignore(target), (
            f"敏感产物 {target} 未被 .gitignore 忽略！"
            "请检查 wecom_smartsheet/.gitignore 包含 'outputs/'"
        )
    finally:
        target.unlink(missing_ok=True)


def test_outputs_messages_md_is_ignored() -> None:
    target = HERE / "outputs" / "leshan_renewal_messages.md"
    target.parent.mkdir(exist_ok=True)
    target.touch(exist_ok=True)
    try:
        assert _git_check_ignore(target)
    finally:
        target.unlink(missing_ok=True)


def test_state_json_is_ignored() -> None:
    target = HERE / "state" / "leshan_renewal.json"
    target.parent.mkdir(exist_ok=True)
    target.touch(exist_ok=True)
    try:
        assert _git_check_ignore(target)
    finally:
        target.unlink(missing_ok=True)


def test_logs_json_is_ignored() -> None:
    target = HERE / "logs" / "leshan_renewal_dryrun_xxx.json"
    target.parent.mkdir(exist_ok=True)
    target.touch(exist_ok=True)
    try:
        assert _git_check_ignore(target)
    finally:
        target.unlink(missing_ok=True)
