"""销售队伍业绩 ETL 回归闸测试。"""

from pathlib import Path
import sys

import duckdb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sales_team_etl


class _WorkbookCoverageConnection:
    """只实现 main() 本测试所需的 DuckDB 查询面。"""

    def __init__(self):
        self._row = None

    def execute(self, sql):
        normalized = " ".join(sql.split())
        if "SELECT count(*) FROM fact" in normalized:
            self._row = (2,)
        elif "SELECT count(*) FROM dim" in normalized:
            self._row = (1,)
        elif "SELECT count(*) FROM enriched WHERE 标保 IS NULL" in normalized:
            self._row = (0,)
        elif "string_agg(DISTINCT 折标分类" in normalized:
            self._row = (None,)
        elif "WHERE 险种大类='车险' AND 折标分类 IS NULL" in normalized:
            self._row = (0,)
        elif "SELECT round(sum(标保),2) FROM enriched" in normalized:
            self._row = (10.0,)
        elif "WHERE 业务员='118050119郭保东'" in normalized:
            self._row = (5.0,)
        elif "SELECT count(*) FROM verify_r" in normalized:
            self._row = (1,)
        elif "FULL OUTER JOIN verify_r" in normalized:
            self._row = (1, 0)
        elif "JOIN verify_r" in normalized:
            # 旧实现的 INNER JOIN 会把缺失行吞掉并误报零差异。
            self._row = (0,)
        else:
            self._row = None
        return self

    def fetchone(self):
        if self._row is None:
            raise AssertionError("测试桩未覆盖查询")
        return self._row


def test_verify_workbook_rejects_missing_row(monkeypatch, tmp_path):
    con = _WorkbookCoverageConnection()
    monkeypatch.setattr(sales_team_etl.duckdb, "connect", lambda: con)
    monkeypatch.setattr(sales_team_etl, "BASELINE_FACT_ROWS", 2, raising=False)
    monkeypatch.setattr(sales_team_etl, "BASELINE_UNMATCHED_AUTO_ROWS", 0, raising=False)
    monkeypatch.setattr(sales_team_etl, "BASELINE_TOTAL", 10.0)
    monkeypatch.setattr(sales_team_etl, "BASELINE_GUO", 5.0)
    monkeypatch.setattr(sales_team_etl, "FACT_DIR", tmp_path / "fact")
    monkeypatch.setattr(sales_team_etl, "DIM_DIR", tmp_path / "dim")
    monkeypatch.setattr(sales_team_etl, "FACT_PARQUET", tmp_path / "fact" / "raw.parquet")
    monkeypatch.setattr(sales_team_etl, "DIM_PARQUET", tmp_path / "dim" / "dim.parquet")
    monkeypatch.setattr(sales_team_etl, "ENRICHED_PARQUET", tmp_path / "fact" / "enriched.parquet")
    monkeypatch.setattr(
        sales_team_etl.sys,
        "argv",
        ["sales_team_etl.py", "-i", str(tmp_path / "fixture.xlsx"), "--verify-workbook"],
    )

    with pytest.raises(AssertionError, match="行数|缺失"):
        sales_team_etl.main()


def _execute_rules(dim_category):
    con = duckdb.connect(":memory:")
    con.execute("""
        CREATE TABLE fact AS SELECT
          1 AS src_row,
          'P1' AS 保单号,
          '车险' AS 险种大类,
          '0301测试险' AS 险种名称,
          DATE '2026-06-01' AS 承保确认时间,
          '山西太原' AS 机构,
          '118050119郭保东' AS 业务员,
          100.0 AS 实收保费
    """)
    con.execute(
        """CREATE TABLE dim AS SELECT
          1 AS src_row,
          'P1' AS 保单号,
          ?::VARCHAR AS 车险折标因子,
          NULL::VARCHAR AS 一司一策系数""",
        [dim_category],
    )
    rules = Path(sales_team_etl.RULES_SQL).read_text(encoding="utf-8")
    rules = rules.replace("'{fact}'", "fact").replace("'{dim}'", "dim")
    return con.execute(f"SELECT 险种系数 FROM ({rules})").fetchone()[0]


def test_unknown_non_null_vehicle_category_does_not_silently_fallback_to_one():
    assert _execute_rules("新分类1.7") is None


def test_missing_vehicle_category_keeps_documented_fallback_one():
    assert float(_execute_rules(None)) == 1.0
