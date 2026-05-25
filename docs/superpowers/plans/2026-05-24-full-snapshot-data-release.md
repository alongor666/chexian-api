# Full Snapshot Data Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“新能源、08_商业险续保流失公司、09_商业险转保上年公司”这类每日全量更新清单治理成可追溯、可跳过重复转换、可按域上传、可无重启发布的数据产物。

**Architecture:** 采用 `raw archive -> snapshot parquet -> current/latest parquet -> release manifest` 四层结构。Excel 只作为原始证据归档，热路径使用 parquet 和 manifest；本地发布只替换通过校验的候选产物，远端发布只同步本批变更域，并通过数据 reload 或懒加载失效替代 PM2 全量重启。

**Tech Stack:** Node.js `数据管理/daily.mjs`、Python/pandas/DuckDB/pyarrow、`scripts/sync-vps.mjs`、`scripts/sync-and-reload.mjs`、VPS rsync/ssh、现有 `数据管理/data-sources.json` 域注册表。

---

## 结论

业界最高效且保持简洁的做法不是把每天全量 Excel 都反复 merge，也不是把全部仓库数据每天重新 rsync；而是把每日全量表当作“快照事实”管理：

1. 原始 Excel 永久归档，只做审计和重跑依据。
2. 每批 Excel 先转换成按批次日期分区的 thin parquet snapshot。
3. `latest.parquet` 永远是“最近一个完整批次”的原子指针或复制件。
4. ETL 读取 source hash 和 schema hash，命中缓存时跳过 Excel 解析。
5. 上传只推本批变更的 parquet、release manifest 和必要报告。
6. 服务端只 reload 受影响的数据关系，避免数据变更触发 PM2 全量重启。

这套方案的关键是“全量快照按批次替换，不按历史累加”。对 08/09 已经符合新事实；新能源若也是每日全量，应纳入同一类 `full_snapshot` 策略。

## 当前事实

### 源文件

2026-05-23 批次本机可见 3 个全量源文件：

| 域 | 文件 | 大小 | 当前定位 |
| --- | --- | ---: | --- |
| 08 流失去向 | `/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/20260523_08_商业险续保流失公司.xlsx` | 19 MB | 已接入 `customer_flow`，提供 `next_insurer` |
| 09 转保来源 | `/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/20260523_09_商业险转保上年公司.xlsx` | 8.6 MB | 已接入 `customer_flow`，提供 `previous_insurer` |
| 新能源出险 | `/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/20260523_新能源_出险信息表.xlsx` | 17 MB | 仓库中尚未注册成独立数据域 |

### 已有能力

- `数据管理/daily.mjs` 已有 `validateDomainCandidate(...)`，能在替换 `latest.parquet` 前做行数、日期、非空字段校验。
- `runStrategyMultiInput(...)` 已能把多个 Excel 一次传给 ETL，并用 `.tmp` 候选文件做原子替换。
- `数据管理/data-sources.json` 中 `customer_flow` 已改为 08/09 双文件输入，校验规则包含 `min_rows=180000`、`min_date=2025-01-01`、`previous_insurer/next_insurer` 非空门槛。
- `scripts/sync-vps.mjs` 已用 rsync 并行上传，并写 `.last-sync-manifest.json`。

### 主要瓶颈

| 环节 | 当前行为 | 问题 |
| --- | --- | --- |
| 历史管理 | 旧 `latest.parquet` 归档到 `~/chexian-archive`，源 Excel 依赖 iCloud 目录 | 缺少按域、按批次、按 hash 的统一历史索引；重跑时难判断源是否已处理 |
| 转换 | 08/09 已向量化，其他域仍混有逐行 apply | 全量 Excel 解析仍是热路径，重复执行时浪费最大 |
| 上传 | `sync-vps.mjs` 固定扫描并同步最多 14 个目录 | 单域更新仍会遍历全仓数据和报告目录 |
| reload | `sync-and-reload.mjs` 固定 PM2 reload，超时 60 秒 | 数据变更牵连 CrossSellDailyAgg 等无关启动物化，2026-05-24 实跑已触发 60 秒超时 |
| 新能源 | 只有业务维度和诊断引用，未见独立 `新能源_出险信息表` 数据域 | 若每天全量更新，缺少统一接入策略 |

## 基线指标

| 指标 | 计划前实测 | 说明 |
| --- | ---: | --- |
| `customer_flow` 直接转换 | 28.48s -> 1.29s | 08/09 聚合已从 Python callback 改为向量化 `groupby().first()` |
| `daily.mjs customer_flow --no-sync` | 62.74s -> 35.26s | 剩余时间主要来自报告生成和流程固定开销 |
| `customer_flow/latest.parquet` | 185,476 行，3.8 MB | 5 字段：`policy_no`、`insurance_start_date`、`vehicle_frame_no`、`previous_insurer`、`next_insurer` |
| `previous_insurer` 非空 | 12,971 | 当前 09 产物贡献 |
| `next_insurer` 非空 | 8,466 | 当前 08 产物贡献 |
| 日期范围 | 2025-01-01 ~ 2026-06-22 | 当前 `customer_flow/latest.parquet` |
| `quote_etl.py` 全量样本 | 24.568s -> 23.814s | 向量化收益小，瓶颈在 Excel 读取 |
| `convert_claims_detail.py` 全量样本 | 3.497s -> 3.242s | 向量化收益小但无行为差异 |
| 上传 manifest | 31 个 parquet 文件 | 当前 `.last-sync-manifest.json` 记录的是全目录同步指纹 |
| 发布 reload | 60s 超时 | 远端服务随后恢复，说明超时来自启动物化，不是数据不可用 |

## 目标指标

| 指标 | 目标值 | 判定方式 |
| --- | ---: | --- |
| 全量快照 cache hit ETL | P95 <= 5s | 源 hash 未变时跳过 Excel parse，只校验 manifest 和 parquet |
| 三表 fresh parse ETL | P95 <= 15s | 新能源 + 08 + 09 三个 Excel 首次转换并生成 snapshot |
| `customer_flow` 转换 | 保持 <= 2s | 对 08/09 现有向量化结果做回归保护 |
| 单域上传 | 只上传变更域 parquet + manifest | `customer_flow` 更新不再同步 policy/current、claims、brand 等无关目录 |
| 数据发布 reload | <= 10s | 数据热 reload 或服务端懒加载失效；不触发 PM2 delete/start |
| 发布完整性 | 100% fail closed | 同批三表缺任一必需文件、schema 漂移、行数异常时不替换 latest、不上传 |

## 目标目录结构

```text
数据管理/
  raw/full_snapshot/
    customer_flow/
      batch_date=20260523/
        20260523_08_商业险续保流失公司.xlsx
        20260523_09_商业险转保上年公司.xlsx
        source-manifest.json
    new_energy_claims/
      batch_date=20260523/
        20260523_新能源_出险信息表.xlsx
        source-manifest.json
  warehouse/snapshots/
    customer_flow/
      batch_date=20260523/
        08_loss.parquet
        09_previous.parquet
        customer_flow.parquet
        snapshot-manifest.json
    new_energy_claims/
      batch_date=20260523/
        latest-input.parquet
        snapshot-manifest.json
  warehouse/fact/
    customer_flow/latest.parquet
    new_energy_claims/latest.parquet
  release-manifests/
    20260523.full_snapshot.json
```

说明：

- `raw/full_snapshot` 是不可变证据层，可以保留最近 90 天本地文件，长期转冷存储。
- `warehouse/snapshots` 是可重复使用的计算层，文件名包含 `batch_date`，允许多批并存和回滚。
- `warehouse/fact/*/latest.parquet` 是服务端读取层，只指向最近完整批次。
- `release-manifests` 记录本次发布的源 hash、输出 hash、行数、schema、远端路径、发布时间。

## 实施计划

### Task 1: 注册 full_snapshot 策略

**Files:**

- Modify: `数据管理/data-sources.json`
- Modify: `数据管理/daily.mjs`
- Test: `tests/pipelines/test_full_snapshot_manifest.py`

- [ ] **Step 1: 增加策略测试**

Create `tests/pipelines/test_full_snapshot_manifest.py`:

```python
import json
from pathlib import Path


def test_customer_flow_full_snapshot_contract():
    root = Path(__file__).resolve().parents[2]
    cfg = json.loads((root / "数据管理/data-sources.json").read_text())
    domain = next(d for d in cfg["domains"] if d["id"] == "customer_flow")
    trigger = domain["trigger"]

    assert trigger["input_strategy"] in {"multi_file_input", "full_snapshot"}
    assert trigger["input_globs"] == [
        "????????_08_商业险续保流失公司.xlsx",
        "????????_09_商业险转保上年公司.xlsx",
    ]
    assert trigger["validation"]["min_rows"] >= 180000
    assert trigger["validation"]["min_date"] == "2025-01-01"
    assert trigger["validation"]["require_non_null"]["previous_insurer"] >= 1
    assert trigger["validation"]["require_non_null"]["next_insurer"] >= 1
```

- [ ] **Step 2: 运行测试并确认当前合同**

Run:

```bash
python3 tests/pipelines/test_full_snapshot_manifest.py
```

Expected: exit code `0` after adding a `if __name__ == "__main__"` runner, or run with `pytest` if the local environment has it.

- [ ] **Step 3: 在 `data-sources.json` 中显式标记快照语义**

Change `customer_flow.trigger` to include:

```json
"snapshot_mode": "full_batch_replace",
"batch_date_from": "filename_prefix",
"required_same_batch": true,
"source_retention_days": 90,
"snapshot_retention_batches": 30
```

When `new_energy_claims` is implemented, register it with the same `snapshot_mode` and a single required input glob:

```json
"input_globs": [
  "????????_新能源_出险信息表.xlsx"
]
```

### Task 2: 建立源文件 manifest 和 snapshot cache

**Files:**

- Modify: `数据管理/daily.mjs`
- Create: `数据管理/pipelines/full_snapshot_manifest.py`
- Test: `tests/pipelines/test_full_snapshot_manifest.py`

- [ ] **Step 1: 实现源文件指纹**

Create `数据管理/pipelines/full_snapshot_manifest.py`:

```python
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceFileFingerprint:
    path: str
    name: str
    size: int
    mtime_ns: int
    sha256: str


def file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def fingerprint(path: Path) -> SourceFileFingerprint:
    stat = path.stat()
    return SourceFileFingerprint(
        path=str(path),
        name=path.name,
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        sha256=file_sha256(path),
    )


def write_manifest(output_path: Path, batch_date: str, domain_id: str, sources: list[Path]) -> None:
    payload = {
        "domain_id": domain_id,
        "batch_date": batch_date,
        "sources": [asdict(fingerprint(p)) for p in sources],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
```

- [ ] **Step 2: 在 `daily.mjs` 加入 batch 完整性门禁**

Add a helper near standard-domain loading:

```js
function extractBatchDateFromName(filename) {
  const match = /^(\d{8})_/.exec(filename);
  if (!match) return null;
  return match[1];
}

function assertSameFullSnapshotBatch(domainId, sourceFiles, trigger) {
  if (trigger.required_same_batch !== true) return null;
  const batchDates = [...new Set(sourceFiles.map(f => extractBatchDateFromName(f.name)).filter(Boolean))];
  if (batchDates.length !== 1) {
    throw new Error(`${domainId} full_snapshot batch_date 不唯一: ${batchDates.join(', ') || 'empty'}`);
  }
  return batchDates[0];
}
```

Call it before conversion in `runStandardDomain(...)`. If it throws, do not write tmp output and do not upload.

- [ ] **Step 3: cache hit 时跳过 Excel 解析**

For each domain, compute a cache key from:

```text
domain_id + batch_date + sorted(source sha256) + converter version + schema mapping version
```

If `数据管理/warehouse/snapshots/<domain>/batch_date=<YYYYMMDD>/snapshot-manifest.json` has the same cache key and output parquet exists, validate that parquet and copy it to `warehouse/fact/<domain>/latest.parquet.tmp` before atomic rename.

### Task 3: 把 08/09 和新能源都落成 snapshot parquet

**Files:**

- Modify: `数据管理/pipelines/convert_customer_flow.py`
- Create: `数据管理/pipelines/convert_new_energy_claims.py`
- Modify: `数据管理/data-sources.json`
- Test: `tests/pipelines/test_customer_flow_split_products.py`
- Test: `tests/pipelines/test_new_energy_claims_contract.py`

- [ ] **Step 1: `customer_flow` 输出中间分表**

Keep current final schema unchanged:

```text
policy_no
insurance_start_date
vehicle_frame_no
previous_insurer
next_insurer
```

Additionally write optional snapshot files:

```text
数据管理/warehouse/snapshots/customer_flow/batch_date=<YYYYMMDD>/08_loss.parquet
数据管理/warehouse/snapshots/customer_flow/batch_date=<YYYYMMDD>/09_previous.parquet
数据管理/warehouse/snapshots/customer_flow/batch_date=<YYYYMMDD>/customer_flow.parquet
```

The final merge key remains:

```text
(policy_no, insurance_start_date)
```

- [ ] **Step 2: 新能源出险清单最小接入**

Create `convert_new_energy_claims.py` with the same converter style as `convert_claims_detail.py`, but only normalize fields needed by downstream analysis. The first version should output:

```text
report_time
policy_no
claim_no
vehicle_frame_no
plate_no
org_level_3
claim_status
settled_amount
reserve_amount
source_batch_date
```

If the source column does not exist, write NULL and fail only for `report_time` plus one stable business key among `claim_no` or `policy_no`.

- [ ] **Step 3: 对三表并行读取**

Run the 08、09、新能源 converters as independent processes. Only the final `customer_flow` 08/09 merge needs DuckDB or pandas after both inputs are ready.

### Task 4: 按域上传，不再全目录 rsync

**Files:**

- Modify: `scripts/sync-vps.mjs`
- Modify: `scripts/sync-and-reload.mjs`
- Test: `tests/scripts/sync-vps-domain-plan.test.ts`

- [ ] **Step 1: 增加 domain 参数**

Extend `scripts/sync-vps.mjs` args:

```text
node scripts/sync-vps.mjs --domain customer_flow --no-restart
node scripts/sync-vps.mjs --domain customer_flow,new_energy_claims --no-restart
```

Map domains to directories:

```js
const DOMAIN_SYNC_TASKS = {
  customer_flow: [
    { label: 'fact/customer_flow', local: LOCAL_CUSTOMER_FLOW_DIR, remote: `${remote}/fact/customer_flow`, critical: true },
  ],
  new_energy_claims: [
    { label: 'fact/new_energy_claims', local: LOCAL_NEW_ENERGY_CLAIMS_DIR, remote: `${remote}/fact/new_energy_claims`, critical: true },
  ],
};
```

- [ ] **Step 2: 原子上传 latest**

For changed `latest.parquet`, upload as:

```text
latest.parquet.uploading
```

Then run remote:

```bash
mv latest.parquet.uploading latest.parquet
```

This avoids the server reading a partially written parquet.

- [ ] **Step 3: release manifest 只记录本次变更**

Write `.last-sync-manifest.json` with:

```json
{
  "syncedAt": "2026-05-24T00:00:00.000Z",
  "domains": ["customer_flow"],
  "files": {
    "fact/customer_flow/latest.parquet": {
      "size": 4027535,
      "sha256": "..."
    }
  }
}
```

The current all-directory manifest can remain for `sync-vps.mjs` without `--domain`.

### Task 5: 数据 reload 替代 PM2 reload

**Files:**

- Modify: `server/src/data/duckdb-loader.ts`
- Modify: `server/src/routes/admin.ts`
- Modify: `scripts/sync-and-reload.mjs`
- Test: `tests/server/data-reload.test.ts`

- [ ] **Step 1: 服务端暴露受控 reload**

Add an authenticated admin endpoint:

```text
POST /api/admin/data/reload
```

Request:

```json
{
  "domains": ["customer_flow", "new_energy_claims"]
}
```

Behavior:

```text
invalidate in-memory relation cache
re-register affected DuckDB views
do not rebuild unrelated materialized tables
return row counts and parquet mtime
```

- [ ] **Step 2: `sync-and-reload.mjs` 优先走数据 reload**

If daily args only include full-snapshot domains, call:

```bash
curl -X POST https://chexian.cretvalu.com/api/admin/data/reload \
  -H "Authorization: Bearer $ADMIN_RELOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domains":["customer_flow"]}'
```

Fallback to PM2 reload only when:

```text
code changed
policy/current changed
server schema bootstrap changed
admin reload failed after retry
```

- [ ] **Step 3: 若保留 PM2 reload，调整超时和冷启动物化**

The 2026-05-24 evidence showed 60 seconds is below observed cold-start materialization time. If PM2 reload remains in the path, raise timeout to 180 seconds and move CrossSellDailyAgg materialization out of request-critical startup.

## 前后对比

| 维度 | 计划前 | 计划后 | 量化收益 |
| --- | --- | --- | --- |
| 历史文件 | Excel 在 iCloud，旧 parquet 归档到 `~/chexian-archive` | raw/snapshot/latest/release manifest 四层 | 任意批次可按 batch_date 和 hash 回放 |
| 08/09 处理 | 已生成 5 字段 `customer_flow/latest.parquet` | 同时保留 08、09 中间 snapshot 和 final snapshot | 排错时能定位来源表，不需要重读 Excel |
| 新能源 | 未注册独立域 | `new_energy_claims` full_snapshot 域 | 三表纳入同一发布门禁 |
| 重复转换 | 每次命令都可能重读 Excel | cache hit 只校验 parquet 和 manifest | 目标 P95 <= 5s |
| fresh 转换 | 08/09 direct 已达 1.29s；daily 仍 35.26s | 三表并行 parse，报告和上传解耦 | 目标三表 <= 15s |
| 上传 | 14 个目录并行 rsync，manifest 31 个 parquet | `--domain` 只推变更域 | `customer_flow` 典型只推 3.8 MB + manifest |
| reload | PM2 reload 固定 60s，已出现超时 | 数据 reload <= 10s；必要时 PM2 180s | 避免无关 CrossSell 冷启动拖慢 |
| 失败策略 | optional 目录失败可继续，单域发布粒度粗 | required batch 缺失则不替换、不上传 | 发布 fail closed |

## 取舍

优点：

- 全量快照语义清楚：每天一批，latest 只代表最新完整批次。
- 速度主要靠跳过 Excel 解析和按域上传，收益比继续抠 pandas 小循环更大。
- 回滚简单：把 `latest.parquet` 指回某个 `batch_date` snapshot 即可。
- 审计完整：源文件 hash、输出 hash、行数、schema 都在 manifest 中。

代价：

- 需要维护 source manifest 和 snapshot manifest 两套小元数据。
- 需要给 VPS 增加 domain-scoped sync 和数据 reload 能力。
- 本地会多保留 snapshot parquet，需要设定保留批次数。
- 新能源域首次接入需要确定最小字段合同和服务端使用方式。

## 验收命令

Implementation must pass these commands before claiming completion:

```bash
python3 tests/pipelines/test_customer_flow_split_products.py
python3 tests/pipelines/test_vectorized_etl_helpers.py
bun test --run tests/customer-flow-etl-contract.test.ts
bun run governance
git diff --check
```

After implementing domain-scoped sync:

```bash
node scripts/sync-vps.mjs --domain customer_flow --dry-run --no-restart
node scripts/sync-and-reload.mjs customer_flow --dry-run
```

Expected dry-run behavior:

```text
only fact/customer_flow and release manifest are listed for upload
PM2 reload is not selected for customer_flow-only data refresh
```
