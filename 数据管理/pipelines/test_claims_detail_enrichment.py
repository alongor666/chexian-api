import pandas as pd

from pipelines.convert_claims_detail import _enrich_insurance_start_date


class _FakeDuckResult:
    def df(self):
        return pd.DataFrame(
            {
                "policy_no": ["POLICYNO0012026001"],
                "_pf_insurance_start_date": pd.to_datetime(["2026-04-28"]),
            }
        )


def test_enrich_insurance_start_date_skips_empty_fallback_assignment(monkeypatch, tmp_path):
    import duckdb

    (tmp_path / "policy.parquet").write_text("stub", encoding="utf-8")
    monkeypatch.setattr(duckdb, "sql", lambda _query: _FakeDuckResult())

    df = pd.DataFrame({"policy_no": ["POLICYNO0012026001"]})

    result = _enrich_insurance_start_date(df, str(tmp_path))

    assert result["insurance_year"].tolist() == [2026]
    assert result["insurance_start_date"].dt.date.astype(str).tolist() == ["2026-04-28"]
