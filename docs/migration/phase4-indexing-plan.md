# Phase 4：JSONL → SQLite 索引化（Design Doc）

> **状态**：DRAFT（提案，未排期）
> **作者**：@claude（基于 v5 plan §Phase 4 后置 epic 展开）
> **依赖**：Phase 1-3（B296/B297/B298）已 DONE；VPS 已启用 `STATE_STORE_BACKEND=sqlite` 稳定运行 ≥ 2 周
> **不是**：执行计划。落地前必须由用户重新评审范围 + 优先级，可能拆 PR 或重新建议

---

## 1. 背景与动机

v5 状态持久层迁移（B292-B298）已覆盖**用户态**：users/roles + PAT 三层原子 SQLite 双写。剩下的**运行时态**仍是 JSONL/单文件模式：

| 存储 | 路径 | 数量级 | 当前模式 |
|------|------|--------|---------|
| `skill_runs` | `server/data/runtime/skill-runs/{runId}.json` | **~10-100 k 文件** | 每 run 一个 JSON 文件 |
| `workflow_runs` | `server/data/runtime/workflow-runs/{runId}.json` | 单数百到千 | 每 run 一个 JSON 文件（含 .lock 文件） |
| `audit_log` | `server/logs/audit.log` | 单文件 N MB | JSONL append + GC 维护 |
| `report_publications` | `server/data/reports/*.html` | 单数十到百 | 仅 HTML，无元数据索引 |

**痛点**：

1. **skill_runs 文件数量级问题**：N 万级文件意味着 `ls` / `find` / rsync / VPS rsync sync 都变慢，文件系统 inode 压力上升
2. **不可查询**：想知道"昨天 user X 跑了哪些 skill"必须 `find + jq | grep` 全表扫描 — 没有 index
3. **审计缺面板**：`audit.log` 全文 grep，没有 "近 7 天 admin 路由 4xx top10" 这类即席查询
4. **报告推送无回溯**：HTML 文件名是事实源，但谁推过、推到哪个企微群、关联哪个 skill_run 都不可查

---

## 2. 设计原则（沿用 Phase 2/3 验证过的模板）

| 原则 | Phase 2/3 已落地版本 | Phase 4 复用 |
|------|---------------------|-------------|
| SQLite first + JSON fallback | `access-control.persistToFile` 三明治 | ✅ Phase 4a 直接复制 |
| dynamic import state-db | `ensureAccessControlStore` 防 backend=json 加载原生模块 | ✅ |
| Repository 模式 | `access-control-store` + `personal-access-token-store` | ✅ 新增 `skill-run-store` / `workflow-run-store` / `audit-log-store` / `report-store` |
| Schema migration append-only | `state-db-schema.MIGRATIONS` id=1..3 | ✅ 新增 id=4..7 |
| Lock-file 一次性迁移 CLI | `admin-import-{users,pat}-from-json` | ✅ 新增 `admin-import-{skill-runs,workflow-runs,audit-log,reports}` |
| 访问契约（RED LINE） | `ONLY *-store.ts may import state-db` | ✅ governance #26 白名单扩展 |
| codex review 回路 | reload 原子事务 + legacy lock 兼容 | ✅ 必须 |

**关键差异 vs Phase 2/3**：

- skill_runs 体量大 → snapshot 模式（全量 DELETE+INSERT）不适用，必须用**纯 row-level CRUD + 增量写**
- workflow_runs 有 `.lock` 文件配合（approval 流），SQLite 需用 `BEGIN IMMEDIATE` 替代 `.lock` 文件
- audit_log 是 append-only 流，**不需要 snapshot 兜底**，只需 SQLite 写 + JSON 写双写

---

## 3. 拆分建议（强烈推荐分两步）

### Phase 4a (B299 候选)：skill_runs + workflow_runs 索引化（高价值）

**为什么先做**：
- skill_runs 文件数已达 ~41 个（生产 VPS 上估计 N 千以上），文件系统压力曲线最陡
- workflow_runs 配套 `.lock` 文件可以借迁移机会用 SQLite 事务替代（更可靠）
- 不动 audit_log → 不触审计链路 → 风险最小化

**Schema (Migration #4)**：

```sql
CREATE TABLE skill_runs (
  run_id        TEXT PRIMARY KEY,             -- sr_20260517065233_pre_7b799556
  skill_name    TEXT NOT NULL,                -- 'pre_xxx'
  status        TEXT NOT NULL,                -- 'pending'|'running'|'success'|'failed'|'cancelled'
  user_id       TEXT,                         -- 触发用户（可空，定时触发为 NULL）
  trigger_source TEXT,                        -- 'http'|'cron'|'cli'|'workflow'
  workflow_run_id TEXT,                       -- 被 workflow 调用时反向引用
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  duration_ms   INTEGER,
  payload_json  TEXT NOT NULL,                -- 完整 SkillRunRecord（含 input/output/error，便于回放）
  error_class   TEXT,                         -- 失败时的错误类型，索引用
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(run_id) ON DELETE SET NULL
);
CREATE INDEX idx_skill_runs_user_status ON skill_runs(user_id, status, created_at DESC);
CREATE INDEX idx_skill_runs_skill_created ON skill_runs(skill_name, created_at DESC);
CREATE INDEX idx_skill_runs_workflow ON skill_runs(workflow_run_id) WHERE workflow_run_id IS NOT NULL;
```

**Schema (Migration #5)**：

```sql
CREATE TABLE workflow_runs (
  run_id        TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status        TEXT NOT NULL,                -- 'pending'|'running'|'awaiting_approval'|'approved'|'rejected'|'success'|'failed'
  user_id       TEXT,
  approval_required INTEGER NOT NULL DEFAULT 0,  -- bool
  approver_id   TEXT,                         -- 审批人，可空
  approved_at   TEXT,
  rejected_at   TEXT,
  rejection_reason TEXT,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  payload_json  TEXT NOT NULL                 -- 完整 WorkflowRunRecord + steps timeline
);
CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(status, created_at DESC);
CREATE INDEX idx_workflow_runs_user_created ON workflow_runs(user_id, created_at DESC);
CREATE INDEX idx_workflow_runs_pending_approval
  ON workflow_runs(status, created_at DESC) WHERE status='awaiting_approval';
```

**关键设计选择**：

- **payload_json 整段存**：保留 JSONL 完整 schema 不强约束，行级字段只索引高查询热点（status/user_id/skill_name/created_at）。后续 BI 查询用 SQLite JSON 函数（`json_extract`）即可
- **不实时 snapshot 模式**：CRUD 路径 row-level upsert（不像 PAT/users 用 DELETE+bulk INSERT）。理由：写入并发高（N 千/天），snapshot 锁全表会阻塞
- **`.lock` 文件保留 transition 期**：Phase 4a 不动 `workflow-approval` 的 lock 文件机制，让 SQLite 与 lock 并存；Phase 4a+2 周稳定后单独 PR 改为 `BEGIN IMMEDIATE`
- **GC 策略**：不在本阶段做。当前 JSONL 也没 GC，SQLite 后期可加 `DELETE WHERE created_at < datetime('now', '-90 days')` 配合 cron

**failure 兜底矩阵**（同 Phase 3 模板）：

| 场景 | 行为 |
|------|------|
| SQLite upsert 失败 | 5xx + 不写 JSON（保 SQLite-first 一致） |
| SQLite OK + JSON 失败 | console.warn + 不抛（JSON 是过渡期 backup，5xx 反而打断业务） |
| 启动 reload 从 SQLite 失败 | console.warn 降级 JSONL 加载（同 PAT 启动路径） |

**Repository 接口**（参考 personal-access-token-store）：

```ts
// server/src/services/skill-run-store.ts
export async function upsertSkillRunToSqlite(record: SkillRunRecord): Promise<void>;
export async function querySkillRunsFromSqlite(filter: {
  userId?: string; status?: string; skillName?: string;
  workflowRunId?: string; limit?: number; cursor?: string;
}): Promise<SkillRunRecord[]>;
export async function getSkillRunFromSqlite(runId: string): Promise<SkillRunRecord | null>;
export async function hasSkillRunDataInSqlite(): Promise<boolean>;
```

**一次性 CLI**：`admin-import-skill-runs-from-jsonl.ts` + `admin-import-workflow-runs-from-jsonl.ts`，scope 分别 `'skill-runs'` / `'workflow-runs'`，独立 lock 文件，逐文件读 + batch INSERT（每 1000 行一 commit）。

**预估工作量**：4-5 PR
1. Migration #4+#5 + state-db-schema 测试（轻）
2. skill-run-store Repository + 测试 + 一次性 CLI（中）
3. workflow-run-store Repository + 测试 + 一次性 CLI（中）
4. run-store.ts / workflow-runner.ts 改双写（中-重，需保留 fire-and-forget 语义）
5. governance #26 白名单 + docs/migration/phase4a.md 验收文档（轻）

### Phase 4b (B300 候选)：audit_log_index + report_publications（中价值，后置）

**为什么后做**：
- audit.log 当前是单文件 + GC 维护，**没有"N 万小文件"问题**，迁移收益主要在"可查询"
- report_publications 是**全新表**（不是迁移），需配套修改 wecom_bot/push_html.py（Python 侧）和 reports route
- 两块都跟 LLM 自动化任务无强耦合，可推迟到 Phase 4a 稳定后

**Schema (Migration #6)**：

```sql
CREATE TABLE audit_log_index (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,                -- ISO timestamp
  username      TEXT,
  user_role     TEXT,
  auth_kind     TEXT,                         -- 'session'|'pat'
  token_id      TEXT,                         -- PAT 时填
  client_ip     TEXT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  status        INTEGER NOT NULL,
  duration_ms   INTEGER,
  raw_jsonl_offset INTEGER                    -- audit.log 文件内偏移，做"详情下钻"用（仍读原 jsonl）
);
CREATE INDEX idx_audit_user_ts ON audit_log_index(username, ts DESC);
CREATE INDEX idx_audit_path_ts ON audit_log_index(path, ts DESC);
CREATE INDEX idx_audit_status_ts ON audit_log_index(status, ts DESC) WHERE status >= 400;
```

**关键设计选择**：
- **不存全文 payload**：audit.log 行可能含 query string / body 字段，**SQLite 只索引可聚合字段**（user/path/status/duration），详情读 raw_jsonl_offset 回原文件。理由：避免数据量爆炸 + 保留 audit.log 作为不可变源
- **写入模式**：middleware/audit.ts 改为 "写 audit.log + 异步 INSERT audit_log_index"（fire-and-forget warn）
- **GC**：audit.log 现有 GC 删旧文件时，同步 DELETE audit_log_index 中 ts < GC 阈值的行

**Schema (Migration #7)**：

```sql
CREATE TABLE report_publications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT NOT NULL UNIQUE,       -- 报告文件名去扩展，如 'auto_ir_diagnosis_2026-05-17'
  title           TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  generated_by    TEXT,                       -- skill_run_id 或 user_id
  source_skill_run_id TEXT,                   -- 关联 Phase 4a 的 skill_runs.run_id（可空）
  file_path       TEXT NOT NULL,              -- 'server/data/reports/xxx.html'
  file_size_bytes INTEGER,
  wecom_msg_id    TEXT,                       -- 推送企微的 msg_id（首次推送）
  wecom_pushed_at TEXT,
  wecom_chat_id   TEXT,                       -- 推到哪个企微群
  notes           TEXT,
  FOREIGN KEY (source_skill_run_id) REFERENCES skill_runs(run_id) ON DELETE SET NULL
);
CREATE INDEX idx_report_pub_generated ON report_publications(generated_at DESC);
CREATE INDEX idx_report_pub_skill_run ON report_publications(source_skill_run_id);
```

**关键设计选择**：
- **HTML 文件仍是事实源**：report_publications 是**元数据索引**，不存 HTML body，删表不影响 HTML 可访问
- **跨语言写入**：push_html.py（Python）和 reports.ts（TS）都要写入此表 → 不走 better-sqlite3，改走 **HTTP API**（`POST /api/admin/report-publications`）让 server 写。Python 侧只发 HTTP，不直连 SQLite
- **首次推送/重新推送**：本表只记首次推送，重新推送（PR #379 类型应急）单独写 `report_push_history` 表（Phase 4c 候选，暂不规划）

**预估工作量**：3-4 PR（audit_log_index 2 PR + report_publications 2 PR）

---

## 4. 不在 Phase 4 范围

| 不做 | 理由 |
|------|------|
| 删 JSONL/JSON 原文件双写路径 | 需 Phase 4a 部署后 ≥ 2 周稳定才能拆，独立 PR |
| workflow-approval `.lock` → `BEGIN IMMEDIATE` | Phase 4a 稳定后 ≥ 2 周再做（需压测确认 SQLite 事务足够替代文件锁） |
| `STATE_STORE_BACKEND=sqlite` 在 VPS 上启用 Phase 4 表 | 仅 PR 落地基础设施；VPS 启用是 Phase 5 运营动作 |
| BI 查询接口 / 管理后台面板 | 独立 epic（消费 SQLite 索引），等 4a/4b 落地后再排 |
| GC 策略实现 | 待 4a 落地观察文件 / SQLite 体积曲线后定阈值 |

---

## 5. 前置条件（DoR）

- [ ] B298 在 VPS 上稳定运行 ≥ 2 周（监控 admin-import-pat-from-json 后无 5xx 突增）
- [ ] 监控指标：当前 skill_runs/workflow_runs 实际文件数与日增量（生产 VPS `ls | wc -l`）
- [ ] 用户决策：是否优先做 4a（运行时态）还是 4b（审计/发布态）
- [ ] 用户决策：跨语言写入策略（Python 侧 push_html.py 改走 HTTP 还是允许直连 SQLite，影响 governance #26 边界）

---

## 6. 验证矩阵（执行时复用）

| 场景 | 验证 |
|------|------|
| Migration #4-#7 应用 | `sqlite3 state.db '.schema'` + `schema_migrations [1..N]` |
| skill_runs row-level upsert + query | 单测 ~15 case；积分 Repository round-trip |
| workflow_runs awaiting_approval 索引 | 部分索引命中验证（EXPLAIN QUERY PLAN） |
| 一次性 admin-import-* CLI | lock 写入 + 拒绝重导入；导入 N 千行 batch 速度 < 30s |
| 双写 fire-and-forget | mock SQLite 失败 → console.warn + 业务无 5xx |
| audit_log_index 写入路径 | middleware/audit.ts 双写 + raw_jsonl_offset 回查原文件 |
| report_publications HTTP API | Python push_html.py 调 `POST /api/admin/report-publications` 后 SQL 查得到 |
| 大体积压测 | skill_runs 1 万行单测 + EXPLAIN QUERY PLAN 关键查询走索引 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| skill_runs 单事务 commit 1 万行内存爆 | 一次性 CLI OOM | 每 1000 行一 commit，progress log |
| workflow `.lock` 文件机制与 SQLite 并行写冲突 | 双写期 approval 状态不一致 | Phase 4a 不动 lock；transition 期 SQLite 只作"索引"，不作"权威源" |
| audit.log 写入路径加 SQLite 拖慢请求 | API P95 抬升 | 必须 fire-and-forget warn（同 Phase 3 flush）；压测对照 |
| Python ↔ TS 跨语言写 SQLite 锁竞争 | report_publications 写入死锁 | 设计选 HTTP API（Python 只发请求，TS 单一权威写入） |
| Migration #6+#7 与 audit-log GC cron 时序 | GC 删行后 SQLite 残留索引 | GC 加 SQLite DELETE 联动；或定期 `VACUUM` |

---

## 8. 决策点（写在文档里给未来执行者）

执行前必须澄清的灰区：

1. **Phase 4a / 4b 顺序**：默认建议 4a 先做（高价值），用户可选
2. **跨语言写策略**：建议 HTTP API（保 governance #26 单一权威源），用户可选直连
3. **GC 策略**：建议 90 天保留 + cron 删除，待生产数据曲线决定
4. **payload_json 字段大小限制**：单 skill_runs.payload_json 单行 ≤ 1MB 警告 / ≤ 10MB 拒绝？需用户定阈
5. **审批人不再 active 时的回滚**：workflow_runs.approver_id 关联 access_users 应不应 FK？（FK ON DELETE SET NULL vs 文本快照）

---

## 9. 关联

- 母 plan：`~/.claude/plans/vps-json-keen-clock.md` §Phase 4 后置 epic
- 上一阶段：[Phase 3 PAT (B298) plan-mode-dreamy-dawn.md](../../) + [PR #389](https://github.com/alongor666/chexian-api/pull/389)
- 沿用模板：[server/src/services/access-control-store.ts](../../server/src/services/access-control-store.ts) + [personal-access-token-store.ts](../../server/src/services/personal-access-token-store.ts)
- governance：[scripts/check-governance.mjs #26](../../scripts/check-governance.mjs)
- 部署链 SOP：[.claude/rules/deploy-chain-sop.md](../../.claude/rules/deploy-chain-sop.md)
