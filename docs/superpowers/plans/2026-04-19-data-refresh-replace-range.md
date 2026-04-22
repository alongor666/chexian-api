# 2026-04-19 Data Refresh Replace Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely refresh Premium, ClaimsDetail, CrossSell, and CustomerFlow data through 2026-04-19 without duplicate source windows or accidental loss of preserved history.

**Architecture:** Add a `replace_range` command to `claims_partition_manager.py` for report-time bounded replacement while preserving records outside the window. Deploy xlsx files with one active source per full-replacement domain, then run existing ETL entrypoints and verify parquet row/date invariants before syncing VPS snapshots.

**Tech Stack:** Python 3, DuckDB, pandas/pyarrow parquet, Node.js ETL orchestrator, rsync VPS sync, Bun snapshot build.

---

### File Structure

- Modify: `数据管理/pipelines/claims_partition_manager.py`
  - Add `replace_range` CLI arguments.
  - Implement bounded replacement by `CAST(report_time AS DATE)` and `insurance_year`.
  - Preserve non-window rows and write affected partitions through `.tmp` rename.
  - Append CDC-style metadata with deleted/inserted/final row counts.
- Create: `数据管理/pipelines/test_claims_partition_manager.py`
  - Build synthetic partition parquet files in `tmp_path`.
  - Verify range replacement, preserved rows, date boundary handling, and status metadata.
- Create: `docs/superpowers/plans/2026-04-19-data-refresh-replace-range.md`
  - This revised execution plan.
- Data files:
  - Copy `~/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/01_签单清单_增量2026_0418_0419.xlsx` to `数据管理/01_签单清单_增量_20260419.xlsx`.
  - Copy `~/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/02_理赔明细_报案时间20250101-20260419.xlsx` to `数据管理/02_理赔明细_报案时间20250101-20260419.xlsx`.
  - Copy `~/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/03_交叉销售_增量2026_0418_0419.xlsx` to `数据管理/03_交叉销售_增量_20260419.xlsx`.
  - Copy `~/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/08_客户来源去向_20250101_20260419.xlsx` to `数据管理/08_客户来源去向_20250101_20260419.xlsx`.

### Task 1: Claims Replace Range Tests

**Files:**
- Create: `数据管理/pipelines/test_claims_partition_manager.py`
- Modify: `数据管理/pipelines/claims_partition_manager.py:38-56`

- [x] **Step 1: Write failing tests**

Create tests that call the CLI with:

```bash
python3 数据管理/pipelines/claims_partition_manager.py replace_range \
  -i "$TMP/incoming.parquet" \
  -o "$TMP/claims_detail" \
  --report-start 2025-01-01 \
  --report-end 2026-04-19
```

Expected behavior:
- `claims_2024.parquet` keeps rows with `report_time` before 2025-01-01.
- Existing rows with `report_time` on 2025-01-01 through 2026-04-19 are removed.
- Incoming rows are inserted into partitions by `insurance_year`.
- A row at `2026-04-19 23:59:00` is included.
- `claims_2023.parquet` is not rewritten when it has no window rows and no incoming 2023 rows.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_claims_partition_manager.py -q
```

Expected: FAIL because `replace_range` is not a recognized command.

### Task 2: Claims Replace Range Implementation

**Files:**
- Modify: `数据管理/pipelines/claims_partition_manager.py`
- Test: `数据管理/pipelines/test_claims_partition_manager.py`

- [x] **Step 1: Add CLI parser**

Add parser:

```python
r = sub.add_parser('replace_range', help='按 report_time 日期窗替换分区记录')
r.add_argument('-i', '--input', required=True, help='新数据 parquet（含 insurance_year/report_time 列）')
r.add_argument('-o', '--output-dir', required=True, help='分区目录')
r.add_argument('--report-start', required=True, help='报案时间开始日期 YYYY-MM-DD（含）')
r.add_argument('--report-end', required=True, help='报案时间结束日期 YYYY-MM-DD（含）')
```

- [x] **Step 2: Implement `do_replace_range`**

Use DuckDB `CAST(report_time AS DATE) BETWEEN DATE start AND DATE end` so same-day timestamps are included. For each affected `insurance_year`, write:

```sql
SELECT * FROM existing WHERE CAST(report_time AS DATE) NOT BETWEEN start AND end
UNION ALL BY NAME
SELECT * FROM incoming WHERE insurance_year = year
```

Then write `.tmp`, replace original, update `_partition_meta.json`, and append CDC summary.

- [x] **Step 3: Run tests**

Run:

```bash
python3 -m pytest 数据管理/pipelines/test_claims_partition_manager.py -q
```

Expected: PASS.

### Task 3: Source File Deployment

**Files:**
- Modify data files under `数据管理/`

- [ ] **Step 1: Create backup**

Run:

```bash
mkdir -p "$HOME/chexian-archive/backup-pre-20260419/source" "$HOME/chexian-archive/backup-pre-20260419/warehouse"
cp -R 数据管理/warehouse/fact "$HOME/chexian-archive/backup-pre-20260419/warehouse/"
cp -R 数据管理/warehouse/snapshots "$HOME/chexian-archive/backup-pre-20260419/warehouse/"
cp 数据管理/data-sources.json "$HOME/chexian-archive/backup-pre-20260419/"
cp 数据管理/01_签单清单_增量_20260417.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
cp 数据管理/02_理赔明细_报案时间20250101-20260417.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
cp 数据管理/03_交叉销售_增量_20260415.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
cp 数据管理/08_客户来源去向_每周日更新至20260412.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
```

- [ ] **Step 2: Copy new source files**

Run the four `cp` commands listed in File Structure.

- [ ] **Step 3: Remove full-window duplicates from active root**

Move old full-window files out of `数据管理/` before ETL:

```bash
mv 数据管理/02_理赔明细_报案时间20250101-20260417.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
mv 数据管理/08_客户来源去向_每周日更新至20260412.xlsx "$HOME/chexian-archive/backup-pre-20260419/source/"
```

Keep `03_交叉销售_增量_20260415.xlsx` only if it is historical incremental input; cross_sell also merges existing `latest.parquet`.

- [ ] **Step 4: Decide Premium 0417 overlap**

Inspect `01_签单清单_增量_20260419.xlsx` min/max `签单日期`. If it contains 2026-04-17 records, move both old active 0417 xlsx and old 0417 parquet to archive before running premium ETL. If it only contains 2026-04-18 and 2026-04-19 records, keep 0417.

### Task 4: ETL Execution and Local Verification

**Files:**
- Modify generated parquet under `数据管理/warehouse/fact/`
- Modify `数据管理/data-sources.json`

- [ ] **Step 1: Premium ETL**

Run:

```bash
node 数据管理/daily.mjs premium --no-sync
```

Verify total row count and max `签单日期`.

- [ ] **Step 2: Claims incoming conversion**

Run:

```bash
python3 数据管理/pipelines/convert_claims_detail.py \
  -i "数据管理/02_理赔明细_报案时间20250101-20260419.xlsx" \
  -o "数据管理/warehouse/fact/claims_detail/_incoming.parquet" \
  --policy-dir "数据管理/warehouse/fact/policy/current"
```

- [ ] **Step 3: Claims bounded replacement**

Run:

```bash
python3 数据管理/pipelines/claims_partition_manager.py replace_range \
  -i "数据管理/warehouse/fact/claims_detail/_incoming.parquet" \
  -o "数据管理/warehouse/fact/claims_detail/" \
  --report-start 2025-01-01 \
  --report-end 2026-04-19
```

- [ ] **Step 4: Cross Sell and Customer Flow ETL**

Run:

```bash
node 数据管理/daily.mjs cross_sell --no-sync
node 数据管理/daily.mjs customer_flow --no-sync
```

- [ ] **Step 5: Local verification**

Verify:
- Premium total rows, max `policy_date` or mapped signing date.
- Claims total rows equals preserved old rows outside window plus incoming rows.
- Claims 2019-2023 row counts unchanged.
- Cross Sell row count and max `policy_date`.
- Customer Flow row count and max `insurance_start_date`.
- Remove `_incoming.parquet` after successful verification.

### Task 5: VPS Sync and Snapshot Rebuild

**Files:**
- Modify remote VPS data through rsync.
- Modify local snapshots under `数据管理/warehouse/snapshots/`.

- [ ] **Step 1: Preflight**

Run:

```bash
node scripts/sync-vps.mjs --check
```

- [ ] **Step 2: Sync facts and restart**

Run:

```bash
node scripts/sync-vps.mjs
```

- [ ] **Step 3: Build snapshots against VPS**

Run:

```bash
SNAPSHOT_SERVER_URL=https://chexian.cretvalu.com bun run snapshot:build
```

- [ ] **Step 4: Sync snapshots without restart**

Run:

```bash
node scripts/sync-vps.mjs --no-restart
```

### Rollback

Restore from:

```bash
$HOME/chexian-archive/backup-pre-20260419/
```

For parquet-only rollback, copy `warehouse/fact` and `warehouse/snapshots` back into `数据管理/warehouse/`, then re-run `node scripts/sync-vps.mjs`.
