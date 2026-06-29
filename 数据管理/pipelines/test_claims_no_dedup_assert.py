"""convert_claims_detail.assert_claim_no_unique 的 fail-closed 断言测试。

背景：下游诊断脚本对 claims 做 LEFT JOIN ON policy_no 后 SUM(已决/未决) 且不去重，
同一 claim_no 多行会双计赔款。本断言是 ETL 产出后的源头兜底（line 185 去重的兜底）。
"""

import pandas as pd
import pytest

from pipelines.convert_claims_detail import assert_claim_no_unique


def _df(branch_codes, claim_nos):
    return pd.DataFrame({
        "branch_code": branch_codes,
        "claim_no": claim_nos,
        "settled_amount": [100.0] * len(claim_nos),
    })


def test_unique_claim_no_passes_silently():
    """省内 claim_no 唯一 → 不抛异常、不退出。"""
    df = _df(["SC", "SC", "SC"], ["C1", "C2", "C3"])
    assert assert_claim_no_unique(df) is None


def test_cross_province_same_claim_no_is_allowed():
    """不同省份的相同 claim_no 是合法的（省内唯一即可）→ 不退出。"""
    df = _df(["SC", "SX"], ["C1", "C1"])
    assert assert_claim_no_unique(df) is None


def test_duplicate_within_province_fails_closed(capsys):
    """同省内 claim_no 重复 → sys.exit(1)，并打印重复键样本。"""
    df = _df(["SC", "SC", "SC"], ["C1", "C1", "C2"])  # C1 在 SC 内出现两次
    with pytest.raises(SystemExit) as exc:
        assert_claim_no_unique(df)
    assert exc.value.code == 1
    out = capsys.readouterr().out
    assert "claim_no 重复" in out
    assert "C1" in out  # 重复键样本里出现 C1


def test_duplicate_without_branch_code_falls_back_to_claim_no(capsys):
    """无 branch_code 列时退化为按 claim_no 全局唯一性判定。"""
    df = pd.DataFrame({"claim_no": ["C1", "C1", "C2"], "settled_amount": [1.0, 2.0, 3.0]})
    with pytest.raises(SystemExit) as exc:
        assert_claim_no_unique(df)
    assert exc.value.code == 1
    assert "C1" in capsys.readouterr().out


def test_sample_cap_limits_printed_rows(capsys):
    """重复键样本受 sample_n 限制（不刷屏）。"""
    df = _df(["SC"] * 6, ["D1", "D1", "D2", "D2", "D3", "D3"])
    with pytest.raises(SystemExit):
        assert_claim_no_unique(df, sample_n=2)
    printed_samples = [ln for ln in capsys.readouterr().out.splitlines() if "重复键样本" in ln]
    assert len(printed_samples) == 2
