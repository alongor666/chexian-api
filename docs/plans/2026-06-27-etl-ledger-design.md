# ETL 全链路数据流转台账（etl-ledger）设计

> 状态：设计已确认（2026-06-27）· 下一步：实现计划（writing-plans）
> 关联红线：CLAUDE.md §0「验证不声称 / 修补不拆除」· §6 验证协议 · `.claude/rules/worktree-setup.md`（event-log 防冲突）

---

## 1. 背景与问题

`chexian-api` 的 ETL 数据流水线横跨 **6 大环节、20+ 步**：上游 XLSX → 本地 ETL（`数据管理/daily.mjs`）→ VPS 同步（`scripts/sync-vps.mjs`）→ 上线 reload + 数据加载 → 前端消费（`/api/data/version` 轮询）→ `release:daily` 统一编排（`scripts/sync-and-reload.mjs`）。

现状的"记录"散落在至少 6 处、且**全是快照、互不关联**：

| 现有产物 | 记什么 | 致命短板 |
|---|---|---|
| `数据管理/data-sources.json` | 各域行数 / 时间范围快照 | 只有最新值、无连续历史；row_count 是手填参考值 |
| `数据管理/logs/转换质量报告.json` | 字段空值率等质量指标 | 单份快照、无时序 |
| `数据管理/release-manifests/*.json` | 一次 ETL 的输入计划 | 仅 1 份（2026-04-19）、不连续 |
| `_partition_meta.json` | （文档曾称的 claims CDC 日志） | **实际不存在** |
| `warehouse/snapshots/` | （文档曾称的批次指纹） | **实际不存在** |

**根因**：缺一份**贯穿全链路、连续追加、能定位断点**的统一台账。用户强调的三个诉求——连续历史、每步流转状态、断点定位——现状**一个都没有**。

**核实纪要（重要）**：本设计动笔前，对探索阶段的转述逐项 `ls`/`git log` 核实，纠正了三处幻觉（release-manifests「9 份」实为 1 份；`snapshots/` 与 `_partition_meta.json` 均不存在）。结论：真正可用于回填的连续历史在 **git 历史**——`data-sources.json` 累计 **55 次提交**，每次 ETL 同步 metadata 均留痕。

---

## 2. 目标与非目标

### 目标
1. **连续历史**：每次 ETL / 同步 / 上线自动追加记录，形成不可篡改的连续流水账。
2. **断点定位**：排查数据问题时，第一眼看到「卡在哪个域、哪一步、什么原因」。
3. **安全审计**：每批数据的源文件→Parquet 指纹链、数据版本号、触发者、时间可追溯。
4. **数据管理**：每个域每次的数据量（行数 + 增量）、覆盖时间段一目了然。
5. **零人工维护**：由数据管线脚本自动写入，无需任何人记得更新。

### 非目标（YAGNI）
- ❌ 不做实时监控大盘 / 告警推送（先落台账；推送是后续可选项）。
- ❌ 不追踪单个浏览器终端的实时消费状态（只记 VPS 对外的当前数据版本）。
- ❌ 不替代 `data-sources.json`（台账是**补充**，不是替代；二者职责不同）。
- ❌ 首版不做 JSONL 自动归档轮转（增长可控，记为 follow-up）。

---

## 3. 决策记录（用户已拍板，2026-06-27）

| 决策 | 选择 | 含义 |
|---|---|---|
| 维护方式 | **ETL 全程自动追加** | 改造管线脚本，每步自动追加；底层 JSONL + 派生 MD |
| 历史起点 | **回填** | 从 git 历史回填 55 个时间点，开局即有连续历史 |
| 落地范围 | **一次全接 7 环节** | 源/ETL/校验/同步/上线/健康/前端全链路闭环 |

---

## 4. 架构：双账（真相源 + 派生视图）

复用项目已验证的 **event-log + 派生视图**模式（先例：`BACKLOG_LOG.jsonl` → `BACKLOG.md`；`loop-quality-ledger.jsonl`）。

```
各 ETL 脚本 ──recordEvent()──▶  数据管理/ledger/etl-ledger.jsonl   （真相源，只追加，merge=union）
                                          │
                                   render.mjs（每次发布末尾自动跑）
                                          ▼
                                数据管理/ledger/数据流转台账.md      （派生视图，禁手编，全量重渲染）
```

- **真相源** `数据管理/ledger/etl-ledger.jsonl`：每行一个独立 JSON 事件对象（JSONL，非 JSON 数组）。git 跟踪，`.gitattributes` 设 `merge=union`——多分支/多会话写入**永不冲突**（每行唯一）。
- **派生视图** `数据管理/ledger/数据流转台账.md`：从 JSONL 全量重渲染，给人和 AI 读，**禁止手编**（手编会被下次 render 覆盖）。

### ⚠️ merge=union 的正确边界（避坑）
`.gitattributes` 现有注释已明确：**JSONL/纯追加文本可 union；结构化 JSON（如 `data-sources.json`）禁 union**（union 会拼出非法 JSON 结构）。据此：
- `etl-ledger.jsonl` → **设 union**（对标 `loop-quality-ledger.jsonl`）。
- `数据流转台账.md` → **不设 union**（它是全量重渲染、非纯追加；冲突时重新 render，不手解）。

---

## 5. 数据模型：一笔事件 = 一次运行 × 一个环节 × 一个域

```json
{
  "ts": "2026-06-27T14:30:45+08:00",
  "run_id": "20260627-143045",
  "stage": "etl",
  "step": "premium_transform",
  "domain": "premium",
  "province": "SC",
  "status": "success",
  "row_count": 2600421,
  "row_delta": 5234,
  "date_range": "2021-01-01~2026-05-16",
  "bytes": 127205376,
  "file_count": 4,
  "source_fp": "d6d4f6db",
  "output_fp": "37f71241",
  "data_version": "a1b2c3d4",
  "duration_ms": 12345,
  "error": null,
  "actor": "release:daily",
  "backfilled": false,
  "note": ""
}
```

| 字段 | 含义 | 来源 |
|---|---|---|
| `ts` | 事件时间戳（本地时区 +08:00） | 记录时生成 |
| `run_id` | 一次发布运行的唯一编号（贯穿全链路，串起所有步骤） | 发布入口生成、env 透传 |
| `stage` / `step` | 环节（source/etl/validate/vps_sync/reload/health/frontend）/ 具体步骤名 | 埋点处指定 |
| `domain` / `province` | 数据域（无域则 null）/ 省份（SC/SX） | 埋点上下文 |
| `status` | success / warning / failure / skipped | 埋点处判定 |
| `row_count` + `row_delta` | 数据量（行数）+ 跟上一版增量 | ETL 产物统计 + 查上一条同域事件 |
| `date_range` | 覆盖时间段 | ETL 产物统计 |
| `bytes` / `file_count` | 产物字节数 / 文件数 | 文件系统 |
| `source_fp` / `output_fp` | 源文件 / Parquet 的 SHA-256 前 8 位（**审计指纹链**） | 已有指纹计算逻辑 |
| `data_version` | 数据版本号（8 字符，前端缓存键） | `/api/data/version` 或内部指纹 |
| `duration_ms` / `error` | 耗时 / 失败原因（**断点定位**） | 计时 + 异常捕获 |
| `actor` | 触发者（`release:daily` / `daily.mjs` / 手动 / 回填） | 入口标识 |
| `backfilled` | 是否为 git 历史回填（区分真实运行 vs 历史还原） | 回填脚本置 true |

---

## 6. 全链路 7 环节埋点表

> 宿主脚本均已 `ls` 确认存在。**具体埋点函数 / 行号留实现阶段用 LSP/grep 精确定位**（本表只定「环节→脚本→时机」，不写死未核实的函数名）。

| 环节 | `stage` | 宿主脚本 | 记录时机 | 关键字段 |
|---|---|---|---|---|
| ① 源文件 | `source` | `数据管理/daily.mjs` | 源文件发现后 | 文件名 / bytes / mtime / source_fp |
| ② ETL 转换 | `etl` | `数据管理/daily.mjs` | 每域 Parquet 产出后 | row_count / row_delta / date_range / output_fp / duration |
| ③ 数据校验 | `validate` | `数据管理/daily.mjs` | 域校验后 | status（通过/失败）/ error（失败项） |
| ④ VPS 同步 | `vps_sync` | `scripts/sync-vps.mjs` | rsync + 完整性闸门后 | status / bytes / 闸门结果 |
| ⑤ 上线 reload | `reload` | `scripts/sync-and-reload.mjs` | reload 后 | status / duration |
| ⑥ 健康检查 | `health` | `scripts/sync-and-reload.mjs` | `/health` 后 | status / data_version |
| ⑦ 前端消费 | `frontend` | `scripts/sync-and-reload.mjs` | 回读 `/api/data/version` | data_version（VPS 当前对外版本） |

**埋点原则（RED LINE）**：所有 `recordEvent()` 调用必须 `try/catch` 包裹——**记账失败绝不能阻断 ETL/发布主流程**（数据发布优先级 > 记账）。失败仅 `console.warn`。符合「修补不拆除」：只加埋点，不改现有逻辑。

---

## 7. 中文报告（`数据流转台账.md`）三视角

1. **🔴 断点告警区（置顶）**：所有 `failure` / `warning` 事件，按时间倒序。排障第一眼定位「域 + 环节 + 原因」。
2. **📅 最近运行时间线（倒序）**：每个 `run_id` 一行汇总——全链路 N/7 步通过、总行数、总耗时、状态灯（🟢🟡🔴）。
3. **📊 各域生命周期**：每个域当前 row_count / date_range / 最近 N 次变化（含增量曲线）。

四级亮灯沿用项目规范（🟢成功 🔵信息 🟡警告 🔴失败）。

---

## 8. 配套护栏

### 8.1 防漏记（governance）
`scripts/check-governance.mjs` 新增一项检查：**最近一次 ETL 运行后，`etl-ledger.jsonl` 必须有对应 `run_id` 的新事件**，否则告警。落实项目「规则要自动化执行、不停在 SOP 层」原则（memory `feedback_rules_need_automation`）。

### 8.2 `.gitattributes`
新增一行：`数据管理/ledger/etl-ledger.jsonl merge=union`（对标 `loop-quality-ledger.jsonl`）。`数据流转台账.md` **不加** union。

---

## 9. 回填方案（git 历史为主）

一次性脚本 `scripts/etl-ledger/backfill-from-git.mjs`：

1. `git log --reverse -- 数据管理/data-sources.json` 取全部 55 次提交。
2. 逐次 `git show <sha>:数据管理/data-sources.json`，解析各域 `row_count` / `data_range` / `last_updated`。
3. 为每域每次变化生成一条 `stage:"etl"`、`backfilled:true` 的历史事件，追加进 JSONL。
4. 辅以 `release-manifests/2026-04-19.json` 1 条 run 记录。

### 回填的诚实边界（写入报告脚注）
- 历史 `row_count` 取自 `data-sources.json` 的**快照参考值**（手填，可能与当时真实 Parquet 有偏差）。
- 粒度是「每次 metadata 提交」，非「每次真实 ETL run」。
- git 里只留**成功** commit → 历史段**无失败记录**；完整的「断点」能力从新台账上线后才有。

---

## 10. 文件清单与落点

| 文件 | 操作 | 说明 |
|---|---|---|
| `数据管理/ledger/etl-ledger.jsonl` | 新增 | 真相源，merge=union |
| `数据管理/ledger/数据流转台账.md` | 新增 | 派生视图，禁手编 |
| `scripts/etl-ledger/record.mjs` | 新增 | `recordEvent()` API（含 try/catch 安全网） |
| `scripts/etl-ledger/render.mjs` | 新增 | JSONL → MD 三视角渲染器 |
| `scripts/etl-ledger/backfill-from-git.mjs` | 新增 | 一次性 git 历史回填 |
| `.gitattributes` | 修改 | +1 行 union |
| `数据管理/daily.mjs` | 修改 | ①②③ 埋点 |
| `scripts/sync-vps.mjs` | 修改 | ④ 埋点 |
| `scripts/sync-and-reload.mjs` | 修改 | ⑤⑥⑦ 埋点 + 末尾调 render |
| `scripts/check-governance.mjs` | 修改 | 防漏记检查 |

---

## 11. 验证方式（CLAUDE.md §6：验证不声称）

1. 跑一次 `node 数据管理/daily.mjs <域>` → `etl-ledger.jsonl` 出现该 run 的 ①②③ 事件。
2. 跑 `render.mjs` → `数据流转台账.md` 三视角正确、亮灯正确。
3. **故意造一次校验失败** → 断点告警区高亮该条、status=failure、error 有内容。
4. `bun run governance` → 防漏记检查生效（无新事件时报警）。
5. `backfill-from-git.mjs` → JSONL 产出 ≥50 条 `backfilled:true` 历史事件。
6. 全链路 `bun run release:daily:dry` 不报错（埋点不破坏现有流程）。

---

## 12. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 记账失败阻断 ETL | `recordEvent()` 全程 try/catch，失败仅 warn，绝不抛出 |
| JSONL 无限增长 | 首版增长可控（每次发布约 10 行）；归档轮转记为 follow-up |
| 埋点改坏现有脚本 | 只加埋点不改逻辑；`release:daily:dry` + 单测把关 |
| 回滚 | 删 `数据管理/ledger/` + `scripts/etl-ledger/` + 撤埋点 + 撤 governance 项，无数据副作用 |

---

## 13. 后续（follow-up，本次不做）
- JSONL 季度归档轮转。
- 断点事件推送飞书/企微（复用 `chexian-im-push`）。
- 台账接入前端只读页（`/api/data/*`）。
