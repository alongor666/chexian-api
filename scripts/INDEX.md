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
| 检查代码提交前是否合规 | `check-governance.mjs` | `bun run governance` |
| 检查热点文件是否带上契约测试 | `check-hotfile-contracts.mjs` | `bun run governance:hotfiles` |
| 一键执行生产级门禁（治理+构建+测试+关键e2e） | `production-gate.mjs` | `bun run production:gate` |
| 测试前快速验证依赖与运行时前提 | `test-preflight.mjs` | `bun run test:preflight [-- --mode unit]` |
| 清理未跟踪调试产物（日志/报告） | `cleanup-debug-artifacts.mjs` | `bun run cleanup:artifacts` |
| 归档已完成的任务 | `archive-backlog.mjs` | `node scripts/archive-backlog.mjs` |
| 扫描/归档已完成的 plans 计划文件 | `manage-plans.mjs` | `bun run plans:manage` |
| 统计项目 Token 数 | `count-tokens.mjs` | `bun run count-tokens` |
| 检测多 Agent 任务ID冲突 | `check-task-id-conflict.mjs` | `node scripts/check-task-id-conflict.mjs` |
| 分析 Parquet 文件结构 | `analyze-parquet-schema.py` | `python3 scripts/analyze-parquet-schema.py` |
| 计算续保率 | `calculate-renewal-rate.py` | `python3 scripts/calculate-renewal-rate.py` |
| 提取业务员计划数据 | `extract_salesman_plan.py` | `python3 scripts/extract_salesman_plan.py` |
| 测试 DuckDB SQL 语法 | `test-duckdb-sql.py` | `python3 scripts/test-duckdb-sql.py` |
| 执行关键路由 15 分钟并发稳定性压测 | `benchmark-key-routes-soak.mjs` | `bun run benchmark:key-routes:soak` |
| 从字段注册表生成 mapping/validator/etl 文件 | `field-registry/generate.mjs` | `node scripts/field-registry/generate.mjs` |
| 校验 codegen 产物是否与注册表同步 | `field-registry/generate.mjs --check` | `node scripts/field-registry/generate.mjs --check` |

---

## 完整脚本清单

### 🔒 治理校验类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `check-governance.mjs` | **主治理校验**：检查必需文件、索引完整性、BACKLOG证据链、DC-002合规 | `bun run governance` |
| `check-hotfile-contracts.mjs` | **热点契约门禁**：`query.ts` / `client.ts` 改动时要求同步修改契约测试 | `bun run governance:hotfiles` |
| `production-gate.mjs` | **生产门禁编排**：治理 + 构建 + 全量测试 + 关键E2E（可选压测门禁） | `bun run production:gate [-- --with-perf]` |
| `test-preflight.mjs` | **测试运行时预检**：检查 `node_modules`、`vitest`、`playwright` 与关键 E2E 文件是否就绪 | `bun run test:preflight [-- --mode all]` |
| `cleanup-debug-artifacts.mjs` | 清理未跟踪调试产物（`.playwright-cli`、`playwright-report`、`test-results`、常见调试日志） | `bun run cleanup:artifacts` |
| `check-task-id-conflict.mjs` | 检测多Agent任务ID是否冲突（B100-199/@claude等范围） | `node scripts/check-task-id-conflict.mjs` |
| `check-write-conflict.mjs` | PR前检测文件写入冲突，防止merge冲突 | `node scripts/check-write-conflict.mjs` |
| `check-document-partition.mjs` | 检查文档分区是否符合多Agent协作规范 | `node scripts/check-document-partition.mjs` |
| `assign-task-id.mjs` | 自动分配任务ID（按Agent范围） | `node scripts/assign-task-id.mjs` |

### 📋 任务管理类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `archive-backlog.mjs` | 将指定日期前的DONE任务归档到BACKLOG_ARCHIVE.md | `node scripts/archive-backlog.mjs [日期] [--dry-run]` |
| `manage-plans.mjs` | 扫描`.claude/plans`计划文件，生成状态快照并归档已完成文件 | `node scripts/manage-plans.mjs [--dry-run] [--apply]` |
| `cleanup-backlog.mjs` | 清理BACKLOG.md中的重复/无效条目 | `node scripts/cleanup-backlog.mjs` |
| `merge-backlog.mjs` | 合并多Agent并发修改的BACKLOG.md（解决冲突） | `node scripts/merge-backlog.mjs` |

### 📊 数据分析类（Python）

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `analyze-parquet-schema.py` | 分析Parquet文件的schema结构和字段类型 | `python3 scripts/analyze-parquet-schema.py <file>` |
| `calculate-renewal-rate.py` | 计算续保率（按机构/时间段） | `python3 scripts/calculate-renewal-rate.py` |
| `compare-schema-mapping.py` | 对比Excel列名与mapping.ts定义的差异 | `python3 scripts/compare-schema-mapping.py` |
| `diagnose-renewal.py` | 诊断续保匹配失败的原因 | `python3 scripts/diagnose-renewal.py` |
| `generate-renewal-analysis.py` | 生成完整的续保分析报告 | `python3 scripts/generate-renewal-analysis.py` |
| `inspect_columns.py` | 检查Parquet/Excel文件的列名和数据类型 | `python3 scripts/inspect_columns.py <file>` |
| `extract_salesman_plan.py` | 从Excel提取业务员保费计划，生成标准化Parquet | `python3 scripts/extract_salesman_plan.py` |
| `test-duckdb-sql.py` | 在DuckDB中测试SQL语法是否正确 | `python3 scripts/test-duckdb-sql.py "<sql>"` |

### 🔌 外部系统集成

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `数据管理/integrations/wecom_smartsheet/sync_zigong_renewal.py` | 将自贡商业险续保追踪名单按车架号 upsert 到企业微信智能表格 | `python3 数据管理/integrations/wecom_smartsheet/sync_zigong_renewal.py --dry-run` |

### 🚀 启动类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `start.mjs` | **跨平台自适应启动**：自动检测bun/node，支持前端/后端/全栈启动 | `node scripts/start.mjs [--dev\|--server\|--all]` |

### 🌐 发布/验收类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `release-vps-heatmap.mjs` | **VPS 一键发布 + 验收编排**：构建前后端、同步 VPS、重启 PM2、健康检查并调用线上热力图验收 | `bun run release:vps:heatmap` |
| `verify-vps-heatmap.mjs` | **VPS 热力图专项验收**：真实登录线上页面并校验热力图标题/三标签切换/`performance-org-heatmap` 200 | `bun run verify:vps:heatmap` |

### 🛠️ 工具类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `count-tokens.mjs` | 统计项目Token数（按文件类型/目录分类） | `bun run count-tokens` |
| `session-manager.mjs` | 管理Claude Code会话状态和上下文 | `node scripts/session-manager.mjs` |
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

### 场景2：归档历史任务（每周/每月清理）
```bash
# 预览将归档哪些任务
node scripts/archive-backlog.mjs --dry-run

# 执行归档
node scripts/archive-backlog.mjs
```

### 场景3：多Agent协作前检查冲突
```bash
# 检查任务ID是否冲突
node scripts/check-task-id-conflict.mjs

# 检查文件写入冲突
node scripts/check-write-conflict.mjs
```

### 场景4：分析新数据文件
```bash
# 查看Parquet结构
python3 scripts/analyze-parquet-schema.py 数据文件.parquet

# 对比列名映射
python3 scripts/compare-schema-mapping.py
```

### 场景5：续保分析全流程
```bash
python3 scripts/calculate-renewal-rate.py   # 计算续保率
python3 scripts/generate-renewal-analysis.py # 生成报告
```

---

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
