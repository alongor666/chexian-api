# 脚本工具索引 (Scripts Index)

**职责**：提供治理校验、数据分析、任务管理、CI/CD 自动化脚本。

> ⚠️ **AI协作提示**：开发前先查此索引，避免重复造轮子。需要新脚本时先搜索是否已有类似功能。

---

## 快速查找

| 我想要... | 使用脚本 | 运行命令 |
|-----------|----------|----------|
| 跨平台启动项目（自动检测运行时） | `start.mjs` | `node scripts/start.mjs --all` |
| 检查代码提交前是否合规 | `check-governance.mjs` | `bun run governance` |
| 归档已完成的任务 | `archive-backlog.mjs` | `node scripts/archive-backlog.mjs` |
| 扫描/归档已完成的 plans 计划文件 | `manage-plans.mjs` | `bun run plans:manage` |
| 统计项目 Token 数 | `count-tokens.mjs` | `bun run count-tokens` |
| 检测多 Agent 任务ID冲突 | `check-task-id-conflict.mjs` | `node scripts/check-task-id-conflict.mjs` |
| 分析 Parquet 文件结构 | `analyze-parquet-schema.py` | `python3 scripts/analyze-parquet-schema.py` |
| 计算续保率 | `calculate-renewal-rate.py` | `python3 scripts/calculate-renewal-rate.py` |
| 提取业务员计划数据 | `extract_salesman_plan.py` | `python3 scripts/extract_salesman_plan.py` |
| 测试 DuckDB SQL 语法 | `test-duckdb-sql.py` | `python3 scripts/test-duckdb-sql.py` |

---

## 完整脚本清单

### 🔒 治理校验类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `check-governance.mjs` | **主治理校验**：检查必需文件、索引完整性、BACKLOG证据链、DC-002合规 | `bun run governance` |
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
| `analyze_renewal.py` | 分析续保数据质量和匹配情况 | `python3 scripts/analyze_renewal.py` |
| `calculate-renewal-rate.py` | 计算续保率（按机构/时间段） | `python3 scripts/calculate-renewal-rate.py` |
| `compare-schema-mapping.py` | 对比Excel列名与mapping.ts定义的差异 | `python3 scripts/compare-schema-mapping.py` |
| `diagnose-renewal.py` | 诊断续保匹配失败的原因 | `python3 scripts/diagnose-renewal.py` |
| `generate-renewal-analysis.py` | 生成完整的续保分析报告 | `python3 scripts/generate-renewal-analysis.py` |
| `inspect_columns.py` | 检查Parquet/Excel文件的列名和数据类型 | `python3 scripts/inspect_columns.py <file>` |
| `extract_salesman_plan.py` | 从Excel提取业务员保费计划，生成标准化Parquet | `python3 scripts/extract_salesman_plan.py` |
| `test-duckdb-sql.py` | 在DuckDB中测试SQL语法是否正确 | `python3 scripts/test-duckdb-sql.py "<sql>"` |

### 🚀 启动类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `start.mjs` | **跨平台自适应启动**：自动检测bun/node，支持前端/后端/全栈启动 | `node scripts/start.mjs [--dev\|--server\|--all]` |

### 🛠️ 工具类

| 脚本 | 作用 | 运行命令 |
|------|------|----------|
| `count-tokens.mjs` | 统计项目Token数（按文件类型/目录分类） | `bun run count-tokens` |
| `session-manager.mjs` | 管理Claude Code会话状态和上下文 | `node scripts/session-manager.mjs` |
| `diagnose-renewal.mjs` | 续保诊断工具（JS版，调用DuckDB） | `node scripts/diagnose-renewal.mjs` |
| `split-commands.mjs` | 拆分过长的slash command文件 | `node scripts/split-commands.mjs` |
| `reorganize-commands.sh` | 重组.claude/commands目录结构 | `bash scripts/reorganize-commands.sh` |

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
python3 scripts/analyze_renewal.py          # 数据质量分析
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
