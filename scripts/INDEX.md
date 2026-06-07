# 脚本工具索引 (Scripts Index)

**职责**：提供治理校验、数据分析、任务管理、CI/CD 自动化脚本。

> ⚠️ **AI协作提示**：开发前先查此索引，避免重复造轮子。需要新脚本时先搜索是否已有类似功能。

---

## 快速查找

| 我想要... | 使用脚本 | 运行命令 |
|-----------|----------|----------|
| 跨平台启动项目（自动检测运行时） | `start.mjs` | `node scripts/start.mjs --all` |
| 一键发布“业绩分析热力图”到 VPS 并自动验收 | `release-vps-heatmap.mjs` | `bun run release:vps:heatmap` |
| 仅做 VPS 线上热力图验收（不部署） | `verify-vps-heatmap.mjs` | `bun run verify:vps:heatmap` |
| 验收 Agent 确定性诊断与 Stage 5 前置证据 | `verify-agent-production-smoke.mjs` | `bun run verify:agent:smoke -- --token <jwt> --start-date YYYY-MM-DD --end-date YYYY-MM-DD --baseline-start-date YYYY-MM-DD --baseline-end-date YYYY-MM-DD` |
| 检查代码提交前是否合规 | `check-governance.mjs` | `bun run governance` |
| 检查热点文件是否带上契约测试 | `check-hotfile-contracts.mjs` | `bun run governance:hotfiles` |
| 一键执行生产级门禁（治理+构建+测试+关键e2e） | `production-gate.mjs` | `bun run production:gate` |
| 测试前快速验证依赖与运行时前提 | `test-preflight.mjs` | `bun run test:preflight [-- --mode unit]` |
| 清理未跟踪调试产物（日志/报告） | `cleanup-debug-artifacts.mjs` | `bun run cleanup:artifacts` |
| 新增/流转 BACKLOG 任务（事件追加） | `backlog.mjs` | `bun scripts/backlog.mjs add\|status\|note\|amend\|list` |
| 扫描/归档已完成的 plans 计划文件 | `manage-plans.mjs` | `bun run plans:manage` |
| 统计项目 Token 数 | `count-tokens.mjs` | `bun run count-tokens` |
| 校验 BACKLOG 事件日志（结构/孤儿/唯一性） | `check-task-id-conflict.mjs` | `bun scripts/check-task-id-conflict.mjs` |
| 渲染 BACKLOG 派生视图（折叠日志→看板+归档） | `governance-backlog-curate.mjs` | `bun scripts/governance-backlog-curate.mjs --apply` |
| 分析 Parquet 文件结构 | `analyze-parquet-schema.py` | `python3 scripts/analyze-parquet-schema.py` |
| 提取业务员计划数据 | `extract_salesman_plan.py` | `python3 scripts/extract_salesman_plan.py` |
| 执行关键路由 15 分钟并发稳定性压测 | `benchmark-key-routes-soak.mjs` | `bun run benchmark:key-routes:soak` |
| 从字段注册表生成 mapping/validator/etl 文件 | `field-registry/generate.mjs` | `node scripts/field-registry/generate.mjs` |
| 校验 codegen 产物是否与注册表同步 | `field-registry/generate.mjs --check` | `node scripts/field-registry/generate.mjs --check` |
| Phase 0 better-sqlite3 沙盒预检（验证 ESM/PRAGMA/CRUD/backup） | `state-db-smoke.mjs` | `node scripts/state-db-smoke.mjs`（沙盒中需先 `bun add better-sqlite3`） |
| ETL 后异常哨兵（统计判定+LLM 归因，异常才告警） | `sentinel/etl-anomaly-sentinel.mjs` | `CX_PAT=... node scripts/sentinel/etl-anomaly-sentinel.mjs --dry-run` |

---

## 完整脚本清单

### 🔒 治理校验类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `check-governance.mjs` | **主治理校验**（纯代码治理 23 项；数据状态校验已解耦至 `check-data-readiness.mjs`）：必需文件、索引完整性、BACKLOG证据链、DC-002合规、空catch禁令 | `bun run governance` |
| `check-data-readiness.mjs` | **数据就绪校验**（4 项数据状态）：Parquet 重叠 / Claims 去重 / 知识库规模 / 同步漂移；由 release:daily（`sync-and-reload.mjs` Stage 1.7）在 ETL 后、发布前执行，**不在**代码门禁跑 | `node scripts/check-data-readiness.mjs` |
| `check-hotfile-contracts.mjs` | **热点契约门禁**：`query.ts` / `client.ts` 改动时要求同步修改契约测试 | `bun run governance:hotfiles` |
| `production-gate.mjs` | **生产门禁编排**：治理 + 构建 + 全量测试 + 关键E2E（可选压测门禁） | `bun run production:gate [-- --with-perf]` |
| `test-preflight.mjs` | **测试运行时预检**：检查 `node_modules`、`vitest`、`playwright` 与关键 E2E 文件是否就绪 | `bun run test:preflight [-- --mode all]` |
| `cleanup-debug-artifacts.mjs` | 清理未跟踪调试产物（`.playwright-cli`、`playwright-report`、`test-results`、常见调试日志） | `bun run cleanup:artifacts` |
| `check-task-id-conflict.mjs` | BACKLOG 事件日志快速校验（结构/无孤儿事件/uid·曾用号唯一）；陈旧守卫见 check-governance | `bun scripts/check-task-id-conflict.mjs` |
| `check-write-conflict.mjs` | **[DEPRECATED 2026-06]** 旧「可变表」BACKLOG 追加冲突检测，event-log 下 union 自动并入，待清理 | — |
| `check-document-partition.mjs` | 检查文档分区是否符合多Agent协作规范 | `node scripts/check-document-partition.mjs` |
| `assign-task-id.mjs` | **[DEPRECATED 2026-06]** 写入方不再挑号；新增任务改用 `bun scripts/backlog.mjs add` | — |

### 📋 任务管理类（BACKLOG event-log 模型，2026-06 治本）

> 道：真相是 append-only 事件日志 `BACKLOG_LOG.jsonl`；`BACKLOG.md`/`BACKLOG_ARCHIVE.md` 是其**派生视图**（禁止手工编辑）。
> 写入 = 追加事件（永不挑号、永不原地改行）→ 多分支并发结构性不再碰号、不再产生重复行。

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `backlog.mjs` | **BACKLOG 写入入口**（唯一写路径）：add/status/note/amend/list，追加事件并自动重渲染视图 | `bun scripts/backlog.mjs add --actor @x --priority Px --section "..." --desc "..."` |
| `governance-backlog-curate.mjs` | **BACKLOG 渲染器**（幂等纯函数）：折叠 `BACKLOG_LOG.jsonl` → 渲染 BACKLOG.md + BACKLOG_ARCHIVE.md + 速查看板 | `bun scripts/governance-backlog-curate.mjs [--apply]` |
| `backlog/lib.mjs` | event-log 核心库（解析/折叠/渲染/校验的唯一事实源），被 curate / backlog.mjs / check-governance 共用 | （被引用） |
| `backlog/migrate.mjs` | 一次性：把旧「可变表」BACKLOG.md/ARCHIVE 播种为事件日志（含 106/106 逐列等价校验） | `bun scripts/backlog/migrate.mjs [--apply]` |
| `manage-plans.mjs` | 扫描`.claude/plans`计划文件，生成状态快照并归档已完成文件 | `node scripts/manage-plans.mjs [--dry-run] [--apply]` |
| `archive-backlog.mjs` | **[DEPRECATED 2026-06]** 旧「可变表」归档器，已被 event-log（status DONE 事件 + curate 渲染）取代，待清理 | — |
| `cleanup-backlog.mjs` | **[DEPRECATED 2026-06]** 旧「可变表」去重器，event-log 下无重复行，待清理 | — |
| `merge-backlog.mjs` | **[DEPRECATED 2026-06]** 旧「可变表」合并器，event-log 下 union 自动并入，待清理 | — |

### 📊 数据分析类（Python）

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `analyze-parquet-schema.py` | 分析Parquet文件的schema结构和字段类型 | `python3 scripts/analyze-parquet-schema.py <file>` |
| `compare-schema-mapping.py` | 对比Excel列名与mapping.ts定义的差异 | `python3 scripts/compare-schema-mapping.py` |
| `inspect_columns.py` | 检查Parquet/Excel文件的列名和数据类型 | `python3 scripts/inspect_columns.py <file>` |
| `extract_salesman_plan.py` | 从Excel提取业务员保费计划，生成标准化Parquet | `python3 scripts/extract_salesman_plan.py` |

### 🔌 外部系统集成

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `数据管理/integrations/wecom_smartsheet/sync_renewal.py` | 按 `config.{instance}.json` 将分支机构商业险续保追踪名单按车架号 upsert 到企业微信智能表格（多实例） | `python3 数据管理/integrations/wecom_smartsheet/sync_renewal.py --config 数据管理/integrations/wecom_smartsheet/config.zigong.json --dry-run` |

**自动化触发**：`daily.mjs` 步骤 8 会自动遍历模块内所有 `config.*.json` 并同步，由 `WECOM_SMARTSHEET_ENABLED=1`（`.env.local`）开关控制。失败降级告警不阻塞 ETL。

### 🚀 启动类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `start.mjs` | **跨平台自适应启动**：自动检测bun/node，支持前端/后端/全栈启动 | `node scripts/start.mjs [--dev\|--server\|--all]` |

### 🌐 发布/验收类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `release-vps-heatmap.mjs` | **VPS 一键发布 + 验收编排**：构建前后端、同步 VPS、重启 PM2、健康检查并调用线上热力图验收 | `bun run release:vps:heatmap` |
| `verify-vps-heatmap.mjs` | **VPS 热力图专项验收**：真实登录线上页面并校验热力图标题/三标签切换/`performance-org-heatmap` 200 | `bun run verify:vps:heatmap` |
| `verify-agent-production-smoke.mjs` | **Agent 生产验收 smoke**：按固定 API 调用 7 个确定性诊断端点、observability 和 readiness，输出 Stage 5 前置证据报告；不接 LLM、不生成 SQL、不输出 token | `bun run verify:agent:smoke -- --token <jwt> --start-date YYYY-MM-DD --end-date YYYY-MM-DD --baseline-start-date YYYY-MM-DD --baseline-end-date YYYY-MM-DD` |
| `gen-reports-manifest.mjs` | **静态报告 manifest 生成**：扫描 `public/reports/<slug>/`，把真实存在的报告日期写入 `manifest.json`，供首页卡片解析「应打开哪一期 + 是否落后于 etlDate」。由 `sync-vps.mjs` / `sync-and-reload.mjs` 同步前自动调用 | `bun run reports:manifest` |

### 🛡️ 监控哨兵类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `sentinel/etl-anomaly-sentinel.mjs` | **ETL 异常哨兵**（发布后监控）：每日 ETL 后调生产 API（PAT 只读），统计层判定核心指标异常（赔付率/费用率/保费/件数，含 IBNR 成熟度过滤）+ LLM 归因，异常才在 GitHub 追踪 issue 告警。幂等以 comprehensive 响应 ETag 去重。详见 `scripts/sentinel/README.md` | `CX_PAT=... node scripts/sentinel/etl-anomaly-sentinel.mjs --dry-run --api-base https://chexian.cretvalu.com` |
| `sentinel/lib/stats.mjs` | 哨兵统计纯函数（Z-score/环比/成熟度过滤/指标判定），单测 `tests/sentinel/stats.test.ts` | （被主脚本引用） |
| `sentinel/lib/fetch-metrics.mjs` | 哨兵取数封装（data/version、comprehensive、trend、YoY），PAT 只读 + ETag 幂等 | （被主脚本引用） |
| `sentinel/lib/llm-judge.mjs` | 哨兵 LLM 归因（Anthropic/智谱，temperature=0，不裁决告警），不可用时规则兜底 | （被主脚本引用） |

> 工作流：`.github/workflows/etl-anomaly-sentinel.yml`（schedule 轮询 + workflow_dispatch）。哨兵是**发布后监控非准入闸门**。

### 🛠️ 工具类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `count-tokens.mjs` | 统计项目Token数（按文件类型/目录分类） | `bun run count-tokens` |
| `session-manager.mjs` | 管理Claude Code会话状态和上下文 | `node scripts/chexian-session-manager.mjs` |
| `diagnose-renewal.mjs` | 续保诊断工具（JS版，调用DuckDB） | `node scripts/diagnose-renewal.mjs` |
| `split-commands.mjs` | 拆分过长的slash command文件 | `node scripts/split-commands.mjs` |
| `reorganize-commands.sh` | 重组.claude/commands目录结构 | `bash scripts/reorganize-commands.sh` |
| `benchmark-key-routes.mjs` | 关键路由基准压测（输出P50/P95/P99到artifacts/perf） | `bun run benchmark:key-routes` |
| `benchmark-key-routes-soak.mjs` | 关键路由并发稳定性压测（默认15分钟，检测5xx漂移与RSS峰值） | `bun run benchmark:key-routes:soak` |

### 📁 hooks/ 子目录

| 文件 | 作用 | 触发时机 |
|------|------|----------|
| `pre-commit` | 提交前自动运行治理校验 | `git commit` |
| `post-tool-use.sh` | Claude工具调用后执行检查 | Claude Code工具调用 |

---

## 常用场景

### 场景0：跨平台启动项目
```bash
# 查看环境信息（运行时检测）
node scripts/start.mjs --info

# 启动前端开发服务器（默认）
node scripts/start.mjs
# 或
bun run start

# 启动后端服务器
node scripts/start.mjs --server
# 或
bun run start:server

# 同时启动前后端（全栈开发）
node scripts/start.mjs --all
# 或
bun run start:all
```

### 场景1：提交代码前检查
```bash
bun run governance
```

### 场景2：完成任务并归档（event-log）
```bash
# 标记完成（追加 status 事件 + 自动重渲染；DONE 必须带证据）
bun scripts/backlog.mjs status <id|uid> DONE --evidence "PR/commit/测试证据"
# DONE 任务自动进入 BACKLOG_ARCHIVE.md（视图由日志折叠渲染，无需单独归档脚本）
```

### 场景3：多Agent协作（event-log 下无需冲突检测脚本）
```bash
# 各分支各自追加事件即可，merge=union 自动并入；写入方不挑号 → 结构性无碰号
bun scripts/backlog.mjs add --actor @claude --priority P2 --section "..." --desc "..."

# 合并后如视图与日志不一致（governance 会提示），重新渲染即可：
bun scripts/governance-backlog-curate.mjs --apply
```

### 场景4：分析新数据文件
```bash
# 查看Parquet结构
python3 scripts/analyze-parquet-schema.py 数据文件.parquet

# 对比列名映射
python3 scripts/compare-schema-mapping.py
```

## 关联索引

- **数据管理工具**：[数据管理/INDEX.md](../数据管理/INDEX.md) - 8个Python工具（2,508行）
- **代码索引**：[CODE_INDEX](../开发文档/00_index/CODE_INDEX.md) - 核心模块入口
- **进展索引**：[PROGRESS_INDEX](../开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、证据链规则

---

**变更规则**：新增脚本必须在此登记，包含：脚本名、作用、运行命令。

## 2026-02-25 追加记录

- `check-governance.mjs` 新增“TS检查范围”校验：禁止在 `tsconfig.json` 中重新排除 `src/charts`、`src/components`、`src/services`、`src/types`、`src/core` 等活跃目录，以防通过 `exclude` 掩盖真实类型问题。

## 2026-02-26 追加记录

- 新增 `test-burn-down.mjs`：生成测试债务燃尽报告（`artifacts/test-burndown/current.md`），用于每周失败用例清零跟踪。
- 新增 `install-git-hooks.sh`：一键安装本地 Git Hooks（`core.hooksPath=.githooks`）。
- 新增仓库级 `.githooks/pre-commit`：提交前强制执行治理检查 + 核心回归测试。

## 2026-02-27 追加记录

- `benchmark-key-routes.mjs` 增强：支持 429 自动退避重试、失败原因与状态码统计、`p95`（成功样本）与 `p95All`（全样本）分离统计，并可从 `logs/audit.log` 提取指定日期基线自动计算新旧 P95 对比。

## 2026-03-02 追加记录

- 新增 `cleanup-debug-artifacts.mjs`：提交前自动清理未跟踪调试产物，避免日志/报告误入版本库。
- `check-governance.mjs` 新增“暂存区调试产物”门禁：若检测到 `.playwright-cli/`、`playwright-report/`、`test-results/` 或 `.log` 等文件进入暂存区，直接阻断提交。

## 2026-03-03 追加记录

- 新增 `production-gate.mjs`：统一串联治理校验、构建、全量单测与关键 E2E（支持 `--with-perf` 扩展压测门禁）。

## 2026-03-04 追加记录

- 新增 `release-vps-heatmap.mjs`：发布“业绩分析热力图”到 VPS 的一键编排脚本（构建、同步、重启、健康检查、验收）。
- 新增 `verify-vps-heatmap.mjs`：线上热力图专项验收脚本（真实登录 + 页面与接口双重校验 + 证据落盘）。

## 2026-03-06 追加记录

- 新增 `check-hotfile-contracts.mjs`：当 `server/src/routes/query.ts` 或 `src/shared/api/client.ts` 进入暂存区时，要求同步修改契约测试。
- 新增 `test-preflight.mjs`：在执行单测或 E2E 前快速检查依赖和关键测试入口是否就绪。
- `check-governance.mjs` 新增“热点文件契约联动”校验，`production-gate.mjs` 与 `.githooks/pre-commit` 新增测试运行时预检步骤。

## 2026-03-11 追加记录

- `check-governance.mjs` 新增“包管理器锁文件策略（Bun-only）”检查：`bun.lock` 必须存在且禁止 `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml` 混入。
- `sync-vps.mjs` 升级为真正跨系统配置解析：支持从 `~/.ssh/config`、环境变量和 CLI 参数分层覆盖，并新增 `--dry-run` 用于无副作用预演。

## 2026-06-03 追加记录

- `check-governance.mjs` 新增 #25“空 catch 块禁令”检查：`server/src` + `src` 禁止纯空 catch 块（静默失败 Law 1），纯代码治理项 22 → 23；配套 `.claude/skills/silent-failure-guard.md`。

## 2026-06-05 追加记录

- 新增 **ETL 异常哨兵**（`scripts/sentinel/`）：发布后监控，每日 ETL 后调生产 API（PAT 只读）做核心指标「当前 vs 历史」对比，统计层确定性判定告警 + LLM 归因（不裁决），异常才在 GitHub 追踪 issue 告警、无异常静默。取数坍缩到 `/api/query/comprehensive` 一次调用；幂等以响应 ETag（绑定 `getDataVersion` 指纹）去重；满期赔付率做 IBNR 成熟度过滤。工作流 `.github/workflows/etl-anomaly-sentinel.yml`。配套新增「🛡️ 监控哨兵类」分类。

## 2026-06-07 追加记录（BACKLOG event-log 治本）

- **BACKLOG 从「可变表」重构为「事件日志 + 派生视图」**（道：根治多分支并发的碰号 / 原地改行冲突 / 手解派生文件三类病）。
  - 新增真相文件 `BACKLOG_LOG.jsonl`（append-only，merge=union）；`BACKLOG.md`/`BACKLOG_ARCHIVE.md` 降为派生视图。
  - 新增 `scripts/backlog/lib.mjs`（解析/折叠/渲染/校验 SSOT）、`scripts/backlog/migrate.mjs`（一次性播种 + 106/106 等价校验）、`scripts/backlog.mjs`（事件追加 CLI，写入方不挑号）。
  - `governance-backlog-curate.mjs` 重写为「折叠日志 → 渲染视图」；`check-governance.mjs` 的「任务ID分配」检查替换为「BACKLOG事件日志」（结构/孤儿/唯一性 + 视图==折叠(日志) 陈旧守卫）。
  - `assign-task-id.mjs`（不再挑号）、`check-write-conflict.mjs`/`archive-backlog.mjs`/`cleanup-backlog.mjs`/`merge-backlog.mjs`（可变表遗留孤儿）标记 **[DEPRECATED]**，清理单独排期。
