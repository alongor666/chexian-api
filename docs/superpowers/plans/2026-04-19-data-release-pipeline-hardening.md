# Data Release Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current manual data refresh flow into a guarded data release pipeline with explicit run manifests, preflight validation, transactional metadata updates, safe VPS sync, reliable snapshot builds, and reproducible run reports.

**Architecture:** Introduce a run manifest as the release contract, then make ETL entrypoints consume that manifest instead of relying on directory scanning alone. Move metadata writes to final-success boundaries, add source/date preflight checks before any parquet changes, and add production validation/reporting after sync. Snapshot building will stop treating skipped builds as success and will avoid production login rate limits.

**Tech Stack:** Node.js ESM for orchestration (`数据管理/daily.mjs`, `scripts/*.mjs`), Python 3 + DuckDB + pandas for parquet validation and Claims processing, Vitest for Node unit tests where available, pytest for Python pipeline tests, rsync/SSH for VPS sync.

---

## Scope Check

This is one coherent project because every task improves the same release path: source xlsx → parquet warehouse → metadata → VPS sync → snapshots → verification report. It should be executed in phases, but each task is independently testable and can be merged without waiting for every downstream task.

## File Structure

- Create: `数据管理/release-manifest.schema.json`
  - JSON schema documenting the run manifest contract.
- Create: `数据管理/release-manifests/2026-04-19.json`
  - Example manifest for the just-completed refresh, used as a fixture and template.
- Create: `数据管理/pipelines/preflight_refresh.py`
  - Validates manifest, active source files, Premium overlap, Claims/Customer Flow uniqueness, writable archive directory, and temporary file absence.
- Create: `数据管理/pipelines/test_preflight_refresh.py`
  - pytest coverage for unsafe source layouts and valid manifest execution.
- Modify: `数据管理/daily.mjs`
  - Add `--manifest <path>`.
  - Route `claims_detail` with `replace_range` when manifest declares it.
  - Stop relying on `02_理赔明细_*.xlsx` directory scanning for manifest-driven runs.
  - Defer `data-sources.json` writes until final domain output exists.
- Modify: `数据管理/pipelines/claims_partition_manager.py`
  - Keep existing `replace_range`; add stronger validation for required columns and dry-run output.
- Modify: `数据管理/pipelines/base_converter.py`
  - `update_data_sources()` 调用位置（目前在 `run()` 末尾第 182 行）改为受 `--no-metadata` / `write_metadata=False` 控制，默认保持现状以免破坏其它入口；`daily.mjs` 走 manifest 路径时统一传 `--no-metadata`。
  - `convert_cross_sell.py` / `convert_customer_flow.py` 自身无 `data-sources.json` 写入（继承自 BaseConverter），不需单独修改。
- Create: `数据管理/pipelines/refresh_metadata.py`
  - 从最终 parquet 输出派生 row_count / field_count / min_date / max_date，并统一写回 `data-sources.json`。
  - `daily.mjs` 中现有 4 处 `updateDataSources(...)`（line 273/462/535/776）在 manifest 驱动流程里**全部移除**，改为所有域完成后由 `refresh_metadata.py` 单次事务写入。
- Create: `数据管理/pipelines/test_refresh_metadata.py`
  - pytest coverage for metadata generated from parquet, not intermediate state.
- Modify: `scripts/sync-vps.mjs`
  - Exclude `_incoming.parquet`, `*.tmp`, `_tmp/`, `.DS_Store`.
  - Retry optional directory sync once before continuing.
- Modify: `scripts/build-snapshots.mjs`
  - Add login concurrency/spacing.
  - Remove deprecated `renewal-v2` bundle definitions.
  - Fail when all tasks skip or success count is below threshold.
  - Add `--skip-deprecated` and `--login-delay-ms`.
- Create: `scripts/verify-data-release.mjs`
  - Verifies local or VPS row counts/max dates for declared domains.
- Create: `数据管理/pipelines/write_release_report.py`
  - Writes Markdown and JSON run reports under `数据管理/run_reports/`.
- Create: `数据管理/run_reports/.gitkeep`
  - Keeps report directory in repo.
- Modify: `数据管理/README.md`
  - Replace manual refresh notes with manifest-driven SOP.

## Manifest Contract

Use this manifest shape for all future refreshes:

```json
{
  "run_id": "2026-04-19-data-refresh",
  "run_date": "2026-04-19",
  "archive_dir": "~/chexian-archive/backup-pre-20260419",
  "domains": {
    "premium": {
      "mode": "incremental_shards",
      "files": ["数据管理/01_签单清单_增量_20260419.xlsx"],
      "date_column": "签单日期",
      "expected_min_date": "2026-04-18",
      "expected_max_date": "2026-04-19",
      "overlap_policy": "fail_if_overlaps_existing_parquet"
    },
    "claims_detail": {
      "mode": "replace_range",
      "files": ["数据管理/02_理赔明细_报案时间20250101-20260419.xlsx"],
      "date_column": "报案时间",
      "report_start": "2025-01-01",
      "report_end": "2026-04-19"
    },
    "cross_sell": {
      "mode": "merge_with_history",
      "files": ["数据管理/03_交叉销售_增量_20260419.xlsx"],
      "date_column": "签单日期",
      "expected_max_date": "2026-04-19"
    },
    "customer_flow": {
      "mode": "full_replace",
      "file": "数据管理/08_客户来源去向_20250101_20260419.xlsx",
      "date_column": "保险起期",
      "expected_max_date": "2026-04-19"
    }
  }
}
```

## Task 1: Manifest Fixtures and Preflight Tests

**Files:**
- Create: `数据管理/release-manifest.schema.json`
- Create: `数据管理/release-manifests/2026-04-19.json`
- Create: `数据管理/pipelines/test_preflight_refresh.py`
- Create: `数据管理/pipelines/preflight_refresh.py`

- [ ] **Step 1: Create the manifest schema**

Add `数据管理/release-manifest.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["run_id", "run_date", "archive_dir", "domains"],
  "properties": {
    "run_id": { "type": "string", "minLength": 1 },
    "run_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "archive_dir": { "type": "string", "minLength": 1 },
    "domains": {
      "type": "object",
      "required": ["premium", "claims_detail", "cross_sell", "customer_flow"],
      "properties": {
        "premium": { "$ref": "#/$defs/premium" },
        "claims_detail": { "$ref": "#/$defs/claimsDetail" },
        "cross_sell": { "$ref": "#/$defs/crossSell" },
        "customer_flow": { "$ref": "#/$defs/customerFlow" }
      }
    }
  },
  "$defs": {
    "premium": {
      "type": "object",
      "required": ["mode", "files", "date_column", "expected_min_date", "expected_max_date", "overlap_policy"],
      "properties": {
        "mode": { "const": "incremental_shards" },
        "files": { "type": "array", "minItems": 1, "items": { "type": "string" } },
        "date_column": { "type": "string" },
        "expected_min_date": { "type": "string" },
        "expected_max_date": { "type": "string" },
        "overlap_policy": { "enum": ["fail_if_overlaps_existing_parquet", "allow_verified_non_overlap"] }
      }
    },
    "claimsDetail": {
      "type": "object",
      "required": ["mode", "files", "date_column", "report_start", "report_end"],
      "properties": {
        "mode": { "const": "replace_range" },
        "files": { "type": "array", "minItems": 1, "items": { "type": "string" } },
        "date_column": { "type": "string", "description": "Excel 源的中文日期列名，如 `报案时间`；preflight 仅用它做 Excel 侧日期校验，不影响 parquet 列名（parquet 侧固定 `report_time`）。" },
        "report_start": { "type": "string" },
        "report_end": { "type": "string" }
      }
    },
    "crossSell": {
      "type": "object",
      "required": ["mode", "files", "date_column", "expected_max_date"],
      "properties": {
        "mode": { "const": "merge_with_history" },
        "files": { "type": "array", "minItems": 1, "items": { "type": "string" } },
        "date_column": { "type": "string" },
        "expected_max_date": { "type": "string" }
      }
    },
    "customerFlow": {
      "type": "object",
      "required": ["mode", "file", "date_column", "expected_max_date"],
      "properties": {
        "mode": { "const": "full_replace" },
        "file": { "type": "string" },
        "date_column": { "type": "string" },
        "expected_max_date": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 2: Create the example run manifest**

Add `数据管理/release-manifests/2026-04-19.json` with the manifest shown in "Manifest Contract".

- [ ] **Step 3: Write failing preflight tests**

Create `数据管理/pipelines/test_preflight_refresh.py`:

```python
import json
from pathlib import Path

import pandas as pd
import pytest

from preflight_refresh import PreflightError, run_preflight


def write_xlsx(path: Path, date_col: str, dates: list[str]) -> None:
    pd.DataFrame({date_col: pd.to_datetime(dates), "保单号": [f"P{i}" for i in range(len(dates))]}).to_excel(path, index=False)


def base_manifest(tmp_path: Path) -> dict:
    archive = tmp_path / "archive"
    archive.mkdir()
    premium = tmp_path / "01_签单清单_增量_20260419.xlsx"
    claims = tmp_path / "02_理赔明细_报案时间20250101-20260419.xlsx"
    cross = tmp_path / "03_交叉销售_增量_20260419.xlsx"
    flow = tmp_path / "08_客户来源去向_20250101_20260419.xlsx"
    write_xlsx(premium, "签单日期", ["2026-04-18", "2026-04-19"])
    write_xlsx(claims, "报案时间", ["2025-01-01", "2026-04-19"])
    write_xlsx(cross, "签单日期", ["2026-04-19"])
    write_xlsx(flow, "保险起期", ["2026-04-19"])
    return {
        "run_id": "test-run",
        "run_date": "2026-04-19",
        "archive_dir": str(archive),
        "domains": {
            "premium": {
                "mode": "incremental_shards",
                "files": [str(premium)],
                "date_column": "签单日期",
                "expected_min_date": "2026-04-18",
                "expected_max_date": "2026-04-19",
                "overlap_policy": "allow_verified_non_overlap"
            },
            "claims_detail": {
                "mode": "replace_range",
                "files": [str(claims)],
                "date_column": "报案时间",
                "report_start": "2025-01-01",
                "report_end": "2026-04-19"
            },
            "cross_sell": {
                "mode": "merge_with_history",
                "files": [str(cross)],
                "date_column": "签单日期",
                "expected_max_date": "2026-04-19"
            },
            "customer_flow": {
                "mode": "full_replace",
                "file": str(flow),
                "date_column": "保险起期",
                "expected_max_date": "2026-04-19"
            }
        }
    }


def test_preflight_accepts_valid_manifest(tmp_path):
    manifest = base_manifest(tmp_path)
    report = run_preflight(manifest, project_root=tmp_path)
    assert report["ok"] is True
    assert report["domains"]["premium"]["max_date"] == "2026-04-19"


def test_preflight_rejects_customer_flow_duplicate_active_files(tmp_path):
    manifest = base_manifest(tmp_path)
    duplicate = tmp_path / "08_客户来源去向_每周日更新至20260412.xlsx"
    write_xlsx(duplicate, "保险起期", ["2026-04-12"])
    with pytest.raises(PreflightError, match="customer_flow active source conflict"):
        run_preflight(manifest, project_root=tmp_path)


def test_preflight_rejects_premium_overlap(tmp_path):
    manifest = base_manifest(tmp_path)
    manifest["domains"]["premium"]["overlap_policy"] = "fail_if_overlaps_existing_parquet"
    existing = tmp_path / "数据管理/warehouse/fact/policy/current"
    existing.mkdir(parents=True)
    pd.DataFrame({"policy_date": pd.to_datetime(["2026-04-19"])}).to_parquet(existing / "01_签单清单_增量_20260417.parquet")
    with pytest.raises(PreflightError, match="premium date overlap"):
        run_preflight(manifest, project_root=tmp_path)
```

- [ ] **Step 4: Run failing tests**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_preflight_refresh.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'preflight_refresh'`.

## Task 2: Preflight Implementation

**Files:**
- Create: `数据管理/pipelines/preflight_refresh.py`
- Test: `数据管理/pipelines/test_preflight_refresh.py`

- [ ] **Step 1: Implement preflight module**

Create `数据管理/pipelines/preflight_refresh.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import sys
from pathlib import Path

import duckdb
import pandas as pd

# governance #24 + 项目共识：必须走共享 Excel 读取函数（多 sheet 自动合并）+ calamine 引擎
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipelines.etl_validation import load_excel_all_sheets  # noqa: E402


class PreflightError(RuntimeError):
    pass


def expand_path(value: str, project_root: Path) -> Path:
    p = Path(os.path.expanduser(value))
    return p if p.is_absolute() else project_root / p


def read_excel_date_range(path: Path, date_col: str) -> tuple[str, str, int]:
    """从 Excel 读日期列范围。
    - 使用 `load_excel_all_sheets` 保证多 sheet 续表被完整读取（governance #24）
    - 底层引擎 calamine（5-10x），由 etl_validation 控制
    """
    df = load_excel_all_sheets(
        str(path),
        dtype=None,
        required_columns=[date_col],
    )
    if date_col not in df.columns or df.empty:
        raise PreflightError(f"{path.name} missing usable date column: {date_col}")
    dates = pd.to_datetime(df[date_col], errors="coerce").dropna()
    if dates.empty:
        raise PreflightError(f"{path.name} has no parseable dates in {date_col}")
    return dates.min().date().isoformat(), dates.max().date().isoformat(), len(df)


def reject_conflicting_active_files(project_root: Path, pattern: str, allowed: set[Path], label: str) -> None:
    active_dir = project_root if project_root.name == "数据管理" else project_root / "数据管理"
    if not active_dir.exists():
        active_dir = project_root
    conflicts = []
    for p in active_dir.glob(pattern):
        if p.resolve() not in {a.resolve() for a in allowed}:
            conflicts.append(p.name)
    if conflicts:
        raise PreflightError(f"{label} active source conflict: {', '.join(sorted(conflicts))}")


def _resolve_parquet_date_column(domain: str) -> str:
    """从字段注册表派生英文日期列名，避免硬编码。
    对应 `server/src/config/field-registry/fields.json` 中的 parquet 列；
    domain→column 映射随字段注册表演化，保持单一事实源。
    """
    mapping = {
        "premium": "policy_date",
        "claims_detail": "report_time",
        "customer_flow": "insurance_start_date",
        "cross_sell": "policy_date",
    }
    if domain not in mapping:
        raise PreflightError(f"unknown domain for parquet date column: {domain}")
    return mapping[domain]


def check_premium_overlap(project_root: Path, min_date: str, max_date: str) -> None:
    current = project_root / "数据管理/warehouse/fact/policy/current"
    if not current.exists():
        return
    date_col = _resolve_parquet_date_column("premium")
    for parquet in current.glob("*.parquet"):
        parquet_str = str(parquet).replace("'", "''")
        try:
            row = duckdb.sql(
                f"SELECT COUNT(*) FROM read_parquet('{parquet_str}') "
                f"WHERE CAST({date_col} AS DATE) BETWEEN DATE '{min_date}' AND DATE '{max_date}'"
            ).fetchone()
        except Exception:
            continue
        if row and row[0] > 0:
            raise PreflightError(f"premium date overlap with existing parquet: {parquet.name} ({row[0]} rows)")


def run_preflight(manifest: dict, project_root: Path | str = ".") -> dict:
    root = Path(project_root).resolve()
    archive_dir = expand_path(manifest["archive_dir"], root)
    if not archive_dir.exists() or not os.access(archive_dir, os.W_OK):
        raise PreflightError(f"archive_dir is not writable: {archive_dir}")

    domains = manifest["domains"]
    report = {"ok": True, "run_id": manifest["run_id"], "domains": {}}

    premium_files = [expand_path(p, root) for p in domains["premium"]["files"]]
    for p in premium_files:
        if not p.exists():
            raise PreflightError(f"missing premium source: {p}")
    min_date, max_date, rows = read_excel_date_range(premium_files[0], domains["premium"]["date_column"])
    if min_date != domains["premium"]["expected_min_date"] or max_date != domains["premium"]["expected_max_date"]:
        raise PreflightError(f"premium date range mismatch: {min_date} ~ {max_date}")
    if domains["premium"]["overlap_policy"] == "fail_if_overlaps_existing_parquet":
        check_premium_overlap(root, min_date, max_date)
    report["domains"]["premium"] = {"rows": rows, "min_date": min_date, "max_date": max_date}

    claims_spec = domains["claims_detail"]
    claims_files = [expand_path(p, root) for p in claims_spec["files"]]
    for cf in claims_files:
        if not cf.exists():
            raise PreflightError(f"missing claims_detail source: {cf}")
    reject_conflicting_active_files(root, "02_理赔明细_*.xlsx", set(claims_files), "claims_detail")
    reject_conflicting_active_files(root, "车险报立结案清单_*.xlsx", set(), "claims_detail_legacy")

    # 跨所有 claims 源合并最小/最大报案时间，校验 report_start/report_end 至少落在 Excel 日期范围内
    claims_min, claims_max, claims_rows = None, None, 0
    for cf in claims_files:
        mn, mx, rows_cf = read_excel_date_range(cf, claims_spec["date_column"])
        claims_rows += rows_cf
        claims_min = mn if claims_min is None or mn < claims_min else claims_min
        claims_max = mx if claims_max is None or mx > claims_max else claims_max
    if claims_min is None or claims_max is None:
        raise PreflightError("claims_detail: unable to determine date range")
    if claims_min > claims_spec["report_start"] or claims_max < claims_spec["report_end"]:
        raise PreflightError(
            f"claims_detail date range {claims_min}~{claims_max} does not cover "
            f"report window {claims_spec['report_start']}~{claims_spec['report_end']}"
        )
    report["domains"]["claims_detail"] = {
        "rows": claims_rows,
        "min_date": claims_min,
        "max_date": claims_max,
    }

    flow_file = expand_path(domains["customer_flow"]["file"], root)
    if not flow_file.exists():
        raise PreflightError(f"missing customer_flow source: {flow_file}")
    reject_conflicting_active_files(root, "08_客户来源去向*.xlsx", {flow_file}, "customer_flow")
    flow_min, flow_max, flow_rows = read_excel_date_range(flow_file, domains["customer_flow"]["date_column"])
    if flow_max != domains["customer_flow"]["expected_max_date"]:
        raise PreflightError(f"customer_flow max date mismatch: {flow_max}")
    report["domains"]["customer_flow"] = {"rows": flow_rows, "min_date": flow_min, "max_date": flow_max}

    incoming = root / "数据管理/warehouse/fact/claims_detail/_incoming.parquet"
    if incoming.exists():
        raise PreflightError(f"temporary file must be removed before release: {incoming}")

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="数据刷新预检")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    report = run_preflight(manifest, Path(args.project_root))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run preflight tests**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_preflight_refresh.py -q
```

Expected: PASS.

## Task 3: Claims Manifest Integration in daily.mjs

**Files:**
- Modify: `数据管理/daily.mjs`
- Modify: `数据管理/pipelines/claims_partition_manager.py`
- Test manually with manifest dry run.

- [ ] **Step 1: Add manifest parser in `daily.mjs`**

Add near `main()` argument parsing:

```js
function getArgValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function loadReleaseManifest(scriptDir) {
  const manifestArg = getArgValue('--manifest');
  if (!manifestArg) return null;
  const manifestPath = isAbsolute(manifestArg) ? manifestArg : join(dirname(scriptDir), manifestArg);
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}
```

Also import `isAbsolute` from `path`.

- [ ] **Step 2: Change `runClaimsDetail` signature**

Change:

```js
function runClaimsDetail(python, scriptDir) {
```

to:

```js
function runClaimsDetail(python, scriptDir, manifest = null) {
```

Inside `runClaimsDetail`, replace source discovery when manifest exists:

```js
const claimsSpec = manifest?.domains?.claims_detail;
const resolveManifestFile = (rel) => (isAbsolute(rel) ? rel : join(dirname(scriptDir), rel));
const sourceFiles = claimsSpec
  ? claimsSpec.files.map((rel) => ({ name: basename(rel), path: resolveManifestFile(rel) }))
  : [...newFiles, ...legacyFiles];
```

> manifest 模式下**不再自动合入** `车险报立结案清单_*.xlsx` 的 legacy 文件。若仍需合并，必须把它们显式写入 manifest 的 `claims_detail.files` 数组。preflight 会扫描 `车险报立结案清单_*.xlsx` 并在未被 manifest 声明时报 `claims_detail_legacy active source conflict`，防止静默漏数据。

- [ ] **Step 3: Route replace_range from manifest**

In the partition update branch:

```js
if (hasPartitions && claimsSpec?.mode === 'replace_range') {
  log('green', `▶ Step 2: 日期窗替换 (${claimsSpec.report_start} ~ ${claimsSpec.report_end})`);
  runPythonScript(python, partitionManager, [
    'replace_range',
    '-i', `"${tmpOutput}"`,
    '-o', `"${CLAIMS_DETAIL_DIR}"`,
    '--report-start', claimsSpec.report_start,
    '--report-end', claimsSpec.report_end,
  ]);
} else if (hasPartitions) {
  log('green', '▶ Step 2: CDC 更新（合入已有分区）');
  runPythonScript(python, partitionManager, [
    'update', '-i', `"${tmpOutput}"`, '-o', `"${CLAIMS_DETAIL_DIR}"`
  ]);
}
```

- [ ] **Step 4: Run syntax and smoke checks**

Run:

```bash
node --check 数据管理/daily.mjs
python3 数据管理/pipelines/claims_partition_manager.py replace_range --help
```

Expected:
- `node --check` exits 0.
- `replace_range --help` lists `--report-start` and `--report-end`.

## Task 4: Transactional Metadata Refresh

**Files:**
- Create: `数据管理/pipelines/refresh_metadata.py`
- Create: `数据管理/pipelines/test_refresh_metadata.py`
- Modify: `数据管理/daily.mjs`（移除 4 处 `updateDataSources(...)` 调用：line 273/462/535/776，统一改为流程末尾调用 `refresh_metadata.py`）
- Modify: `数据管理/pipelines/base_converter.py`（唯一 `update_data_sources()` 调用点在 `run()` 第 182 行，加 `--no-metadata` CLI flag 跳过）

- [ ] **Step 1: Write metadata tests**

Create `数据管理/pipelines/test_refresh_metadata.py`:

```python
import json
from pathlib import Path

import pandas as pd

from refresh_metadata import refresh_domain_metadata


def test_refresh_domain_metadata_uses_final_parquet(tmp_path: Path):
    data_sources = tmp_path / "data-sources.json"
    data_sources.write_text(json.dumps({"domains": [{
        "id": "customer_flow",
        "last_updated": "2026-04-18",
        "row_count": 1,
        "field_count": 1,
        "data_range": "old"
    }]}, ensure_ascii=False), encoding="utf-8")
    parquet = tmp_path / "latest.parquet"
    pd.DataFrame({
        "policy_no": ["A", "B"],
        "insurance_start_date": pd.to_datetime(["2026-04-18", "2026-04-19"])
    }).to_parquet(parquet, index=False)

    refresh_domain_metadata(
        data_sources_path=data_sources,
        domain_id="customer_flow",
        parquet_glob=str(parquet),
        date_column="insurance_start_date",
        run_date="2026-04-19",
    )

    updated = json.loads(data_sources.read_text(encoding="utf-8"))
    domain = updated["domains"][0]
    assert domain["row_count"] == 2
    assert domain["field_count"] == 2
    assert domain["data_range"] == "2026-04-18 ~ 2026-04-19"
    assert domain["last_updated"] == "2026-04-19"
```

- [ ] **Step 2: Run failing metadata test**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_refresh_metadata.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'refresh_metadata'`.

- [ ] **Step 3: Implement metadata refresh**

Create `数据管理/pipelines/refresh_metadata.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
from pathlib import Path

import duckdb


def refresh_domain_metadata(data_sources_path: Path, domain_id: str, parquet_glob: str, date_column: str | None, run_date: str) -> dict:
    cfg = json.loads(data_sources_path.read_text(encoding="utf-8"))
    domain = next((d for d in cfg["domains"] if d["id"] == domain_id), None)
    if domain is None:
        raise ValueError(f"domain not found: {domain_id}")

    union = ", union_by_name=true" if "*" in parquet_glob else ""
    count, field_count = duckdb.sql(
        f"SELECT COUNT(*) AS rows FROM read_parquet('{parquet_glob}'{union})"
    ).fetchone()[0], len(duckdb.sql(
        f"DESCRIBE SELECT * FROM read_parquet('{parquet_glob}'{union})"
    ).fetchall())

    domain["row_count"] = int(count)
    domain["field_count"] = int(field_count)
    domain["last_updated"] = run_date
    if date_column:
        min_date, max_date = duckdb.sql(
            f"SELECT MIN(CAST({date_column} AS DATE)), MAX(CAST({date_column} AS DATE)) "
            f"FROM read_parquet('{parquet_glob}'{union})"
        ).fetchone()
        domain["data_range"] = f"{min_date} ~ {max_date}"

    data_sources_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return domain


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh data-sources.json from final parquet")
    parser.add_argument("--data-sources", default="数据管理/data-sources.json")
    parser.add_argument("--domain", required=True)
    parser.add_argument("--parquet", required=True)
    parser.add_argument("--date-column", default=None)
    parser.add_argument("--run-date", required=True)
    args = parser.parse_args()
    updated = refresh_domain_metadata(
        Path(args.data_sources),
        args.domain,
        args.parquet,
        args.date_column,
        args.run_date,
    )
    print(json.dumps(updated, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Centralize metadata writes**

4a. 在 `数据管理/pipelines/base_converter.py` 的 `_parse_args()` 中新增 CLI flag（保持默认行为以免影响其它入口）：

```python
parser.add_argument("--no-metadata", action="store_true",
                    help="manifest 驱动流程用；跳过 update_data_sources()，由 refresh_metadata.py 统一写入")
```

`run()` 末尾（当前第 182 行）包一层守卫：

```python
if not args.no_metadata:
    update_data_sources(
        self.get_domain_id(),
        row_count=len(df),
        field_count=len(df.columns),
    )
```

4b. 在 `数据管理/daily.mjs` 中，当 `manifest` 存在时：
- 删除或跳过 4 处 `updateDataSources(...)`（line 273 `runStandardDomain`、line 462 `runClaimsDetail`、line 535 `renewal_tracker`、line 776 `premium`），改为在 `main()` 末尾新增一个 `refreshAllMetadata(manifest)` 调用，对 manifest 声明的每个域各调一次 `refresh_metadata.py`。
- 所有 BaseConverter 子脚本（convert_cross_sell / convert_customer_flow / convert_brand_dim / convert_repair / convert_renewal_tracker）在 manifest 模式下通过 `runPythonScript` 传入 `--no-metadata`。
- 非 manifest 模式（无 `--manifest` 参数）保持原行为，向后兼容。

Run:

```bash
rg -n "data-sources|updateDataSources|已更新" 数据管理/pipelines 数据管理/daily.mjs
```

Expected: 当 manifest 存在时，最终 metadata 写入仅发生在 `refresh_metadata.py` 内；converter 与 daily.mjs 的 `updateDataSources` 调用在 manifest 路径下均被跳过。

- [ ] **Step 5: Run metadata tests**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_refresh_metadata.py -q
```

Expected: PASS.

## Task 5: Sync Safety and Optional Retry

**Files:**
- Modify: `scripts/sync-vps.mjs`
- Test: `node scripts/sync-vps.mjs --dry-run`

- [ ] **Step 1: Extract `RSYNC_EXCLUDES` constant and apply to `rsyncDir`**

In `scripts/sync-vps.mjs` 顶部（`rsyncDir` 定义上方）新增：

```js
// 统一排除 ETL 中间态/系统垃圾文件，避免将 _incoming.parquet 推上 VPS 造成读坏
const RSYNC_EXCLUDES = ['_incoming.parquet', '*.tmp', '_tmp/', '.DS_Store'];
const RSYNC_EXCLUDE_ARGS = RSYNC_EXCLUDES.flatMap((p) => ['--exclude', p]);
const RSYNC_EXCLUDE_DRY_RUN = RSYNC_EXCLUDES.map((p) => `--exclude '${p}'`).join(' ');
```

`rsyncDir` 内把 args 从：

```js
[
  '-azv',
  '--delete',
  '-e', 'ssh',
  src,
  `${alias}:${dst}`,
]
```

改为：

```js
[
  '-azv',
  '--delete',
  ...RSYNC_EXCLUDE_ARGS,
  '-e', 'ssh',
  src,
  `${alias}:${dst}`,
]
```

- [ ] **Step 2: Add optional retry**

Replace the sync result handling loop with a one-time retry for optional failures:

```js
const failures = [];
for (let i = 0; i < activeTasks.length; i += 1) {
  const task = activeTasks[i];
  const result = settled[i];
  let rsyncResult = result.status === 'fulfilled' ? result.value : { ok: false, label: task.label, error: result.reason?.message };
  if (!rsyncResult.ok && !task.critical) {
    log('yellow', `  retry optional ${task.label} once...`);
    rsyncResult = await rsyncDir(alias, task.local, task.remote, task.label);
  }
  if (!rsyncResult.ok) {
    failures.push({ ...rsyncResult, critical: task.critical });
  }
}
```

- [ ] **Step 3: Update dry-run print lines in BOTH task lists**

`scripts/sync-vps.mjs` 有**两处** rsync 任务列表（dry-run 分支 line 440+ 与实际 run 分支 line 495+）。dry-run 分支 line 459 的 `console.log` 必须同步更新：

```js
console.log(`  ${tag} rsync -azv --delete ${RSYNC_EXCLUDE_DRY_RUN} -e ssh ${task.local}/ ${sshConfig.alias}:${task.remote}/${suffix}`);
```

（实际执行分支不打印该字符串，但 rsync args 会复用同一 `RSYNC_EXCLUDE_ARGS` 常量。）

Run:

```bash
node scripts/sync-vps.mjs --dry-run | tee /tmp/sync-vps-dry.log
grep -E "_incoming\\.parquet|\\*\\.tmp|_tmp/" /tmp/sync-vps-dry.log | wc -l
```

Expected: 每条 rsync 行都包含三项 exclude，行数 = 总任务数（13）。

## Task 6: Snapshot Builder Reliability

**Files:**
- Modify: `scripts/build-snapshots.mjs`

- [ ] **Step 1: Remove deprecated renewal-v2 bundles**

Delete bundle definitions:

```js
'renewal-metadata'
'renewal-overview'
'renewal-trend'
'renewal-funnel'
```

Expected bundle count after removal: 10 bundle keys remain.

- [ ] **Step 2: Add login throttling args**

Extend `parseArgs`:

```js
loginDelayMs: 12000,
```

Parse:

```js
if (arg === '--login-delay-ms') {
  result.loginDelayMs = Number(argv[++i] || 12000);
}
```

Add helper:

```js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Replace parallel login block with serial login:

```js
for (const [scope, creds] of Object.entries(scopes)) {
  try {
    const token = await login(creds.username, creds.password);
    tokenMap[scope] = token;
    log('green', `  ✓ ${scope}`);
  } catch (err) {
    log('red', `  ✗ 登录失败: ${err.message}`);
  }
  if (args.loginDelayMs > 0) await sleep(args.loginDelayMs);
}
```

- [ ] **Step 3: Fail on low success ratio (non-trivial threshold)**

仅判 `successCount === 0` 保护过弱（19 个 skip + 1 个 success 会静默通过）。在总数已知时用比例阈值：

```js
const totalTasks = tasks.length;                       // tasks 在前面已构建
const threshold = Math.max(1, Math.ceil(totalTasks * 0.8));
if (successCount < threshold) {
  log('red', `  成功数 ${successCount}/${totalTasks} < 阈值 ${threshold}，本次构建失败`);
  process.exit(1);
}
```

同时，如果存在任何 scope 的 JWT 获取失败（`tokenMap[scope]` 缺失），整体直接 `process.exit(1)`，而不是让该 scope 全部 skip 成 success（现有 `351: successCount++` 路径会把"无 JWT skip"算作成功）：

```js
if (Object.keys(tokenMap).length !== Object.keys(scopes).length) {
  log('red', '  存在 scope 未登录成功，构建中止');
  process.exit(1);
}
```

- [ ] **Step 4: Verify all scope build**

Run:

```bash
SNAPSHOT_SERVER_URL=https://chexian.cretvalu.com bun run snapshot:build -- --scope all --login-delay-ms 0
```

Expected:
- Login succeeds for `all`.
- No `renewal-v2` 404.
- Success count is 20 for current bundle definitions.
- Exit code is 0.

## Task 7: Release Verification and Reports

**Files:**
- Create: `scripts/verify-data-release.mjs`
- Create: `数据管理/pipelines/write_release_report.py`
- Create: `数据管理/run_reports/.gitkeep`

- [ ] **Step 1: Add data verification script**

Create `scripts/verify-data-release.mjs`:

```js
#!/usr/bin/env node
import { spawnSync } from 'child_process';

const checks = [
  ['premium', '数据管理/warehouse/fact/policy/current/*.parquet', 'policy_date', 2527565, '2026-04-19'],
  ['claims', '数据管理/warehouse/fact/claims_detail/claims_*.parquet', 'report_time', 280524, '2026-04-19'],
  ['cross_sell', '数据管理/warehouse/fact/cross_sell/latest.parquet', 'policy_date', 404977, '2026-04-19'],
  ['customer_flow', '数据管理/warehouse/fact/customer_flow/latest.parquet', 'insurance_start_date', 996375, '2026-04-19'],
];

const script = `
import duckdb
checks = ${JSON.stringify(checks)}
failed = 0
for name, path, date_col, min_rows, expected_max in checks:
    union = ", union_by_name=true" if "*" in path else ""
    rows, max_date = duckdb.sql(f"select count(*), max(cast({date_col} as date)) from read_parquet('{path}'{union})").fetchone()
    print(f"{name}: rows={rows}, max_date={max_date}")
    if rows < min_rows or str(max_date) != expected_max:
        failed += 1
if failed:
    raise SystemExit(failed)
`;

const result = spawnSync('python3', ['-c', script], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

- [ ] **Step 2: Add release report writer**

Create `数据管理/pipelines/write_release_report.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
from pathlib import Path


def write_report(run_report: dict, output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = run_report["run_id"]
    json_path = output_dir / f"{run_id}.json"
    md_path = output_dir / f"{run_id}.md"
    json_path.write_text(json.dumps(run_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# {run_id} 数据发布报告",
        "",
        f"- 运行日期: {run_report['run_date']}",
        f"- 备份目录: `{run_report['archive_dir']}`",
        "",
        "## 域结果",
    ]
    for name, info in run_report["domains"].items():
        lines.append(f"- {name}: rows={info['rows']}, max_date={info['max_date']}")
    lines.extend(["", "## 发布结果"])
    for item in run_report["publish"]:
        lines.append(f"- {item['step']}: {item['status']}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Write data release report")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", default="数据管理/run_reports")
    args = parser.parse_args()
    report = json.loads(Path(args.input).read_text(encoding="utf-8"))
    json_path, md_path = write_report(report, Path(args.output_dir))
    print(json_path)
    print(md_path)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run verification script**

Run:

```bash
node scripts/verify-data-release.mjs
```

Expected:
- Prints all four domains.
- Exit code 0.

## Task 8: Documentation and Migration SOP

**Files:**
- Modify: `数据管理/README.md`
- Modify: `开发文档/00_index/CODE_INDEX.md` — 登记 `preflight_refresh.py` / `refresh_metadata.py` / `verify-data-release.mjs` / `write_release_report.py` / `release-manifests/` 5 个新节点（CLAUDE.md §0 文档同步红线）。
- Modify: `scripts/INDEX.md`（若存在）— 登记 `verify-data-release.mjs`。
- Modify: `CLAUDE.md` §5 的 npm scripts 区块 — 如新增 `release:preflight` / `release:verify` 别名需同步。
- Modify: `docs/superpowers/plans/2026-04-19-data-release-pipeline-hardening.md` after implementation checkboxes are complete.

- [ ] **Step 1: Add manifest-driven SOP to README**

Append:

```markdown
## 数据发布 SOP

1. 创建 `数据管理/release-manifests/YYYY-MM-DD.json`。
2. 运行 `python3 数据管理/pipelines/preflight_refresh.py --manifest 数据管理/release-manifests/YYYY-MM-DD.json --project-root .`。
3. 备份 `warehouse/fact`、`warehouse/snapshots`、`data-sources.json` 和活动源文件。
4. 运行 `node 数据管理/daily.mjs all --manifest 数据管理/release-manifests/YYYY-MM-DD.json --no-sync`。
5. 运行 `node scripts/verify-data-release.mjs`。
6. 运行 `node scripts/sync-vps.mjs --check`。
7. 运行 `node scripts/sync-vps.mjs`。
8. 运行 `SNAPSHOT_SERVER_URL=https://chexian.cretvalu.com bun run snapshot:build -- --scope all --login-delay-ms 0`。
9. 运行 `node scripts/sync-vps.mjs --no-restart`。
10. 使用真实 JWT 验证 `/api/data/snapshot-health`。
11. 写入 `数据管理/run_reports/YYYY-MM-DD-*.md`。
```

- [ ] **Step 2: Run final verification suite**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_claims_partition_manager.py 数据管理/pipelines/test_preflight_refresh.py 数据管理/pipelines/test_refresh_metadata.py -q
node --check 数据管理/daily.mjs
node --check scripts/sync-vps.mjs
node --check scripts/build-snapshots.mjs
node --check scripts/verify-data-release.mjs
node scripts/sync-vps.mjs --dry-run
```

Expected:
- pytest exits 0.
- all `node --check` commands exit 0.
- dry-run prints rsync exclusions.

## Self-Review

Spec coverage:
- Source ambiguity: covered by manifest + preflight（含 legacy 命名 `车险报立结案清单_*` 强制显式声明）。
- Premium overlap: covered by preflight；parquet 列名从 domain→column 映射派生而非硬编码。
- Claims replace_range misuse: covered by manifest-driven `daily.mjs` routing；preflight 交叉校验 Excel 日期范围覆盖 `report_start/report_end`。
- Metadata pollution: covered by `base_converter.py` 的 `--no-metadata` 守卫 + `refresh_metadata.py` 流程末尾单点写入，消除 BaseConverter / daily.mjs / updateDataSources 的多写入点。
- Excel ingestion compliance: preflight 使用 `load_excel_all_sheets`（governance #24）+ calamine 引擎，与 ETL 主链保持一致。
- Temporary file sync: covered by rsync excludes（提取为 `RSYNC_EXCLUDES` 常量，dry-run 与实际执行两处复用）。
- Optional rsync instability: covered by optional retry.
- Snapshot 429 and deprecated endpoints: covered by login throttling and renewal-v2 removal；失败阈值改为成功率 ≥ 80% 且未登录 scope 直接中止。
- Production verification: covered by verification script and release report.
- Documentation sync (CLAUDE.md §0 红线): README / CODE_INDEX / scripts/INDEX 同步更新。

Known blast-radius notes（执行前确认）:
- daily.mjs 4 处 `updateDataSources` 删除仅在 manifest 路径生效；无 `--manifest` 时保持旧行为，向后兼容。
- `RSYNC_EXCLUDES` 包含 `*.tmp`；若其它系统写了合法 `*.tmp` 文件到 warehouse 目录会被跳过（已核：warehouse 下无合法 `*.tmp`）。
- 删除 `renewal-v2` 4 bundle 前须确认后端 `/api/query/renewal-v2/*` 已真正下线（查 `server/src/routes/query.ts` 聚合器）。

Placeholder scan:
- No `TBD`, `TODO`, or open-ended implementation steps remain.

Type consistency:
- Manifest fields use snake_case consistently: `run_id`, `run_date`, `archive_dir`, `expected_max_date`, `report_start`, `report_end`, `date_column`, `files`。
- claims_detail 改用 `files`（数组）+ `date_column`，与 premium / cross_sell 一致。
- Parquet 列名（`policy_date` / `report_time` / `insurance_start_date`）从 `_resolve_parquet_date_column()` 派生，避免与字段注册表不一致。
- Python functions referenced in tests are defined in the same task: `run_preflight`, `PreflightError`, `refresh_domain_metadata`, `write_report`.
