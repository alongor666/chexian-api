# 优化 .claude/{agents,commands,contexts,docs} 目录

## Context

项目从前端 DuckDB-WASM 迁移到了后端 Express+DuckDB API 架构，但 `.claude/` 下大量文件仍引用旧架构（`src/shared/duckdb/client.ts`、`DuckDB-WASM` 等）。同时存在：
- 3 个巨型命令文件（33-40KB），超出合理维护范围
- agents 与 commands 之间内容重复
- 断裂的文件引用
- contexts 目录仅 3 个基础上下文，缺少项目特有场景
- docs 目录缺少实用的快速参考

**目标**：精简冗余、修正过时引用、补充缺失上下文、提升可维护性。

---

## Phase 1: agents/ 优化 (14 agents)

### 1.1 修正过时引用（所有 agent 文件）
- `DuckDB-WASM` → `DuckDB (server-side)`
- `src/shared/duckdb/client.ts` → `server/src/services/duckdb.ts`
- `src/shared/sql/*.ts` → `server/src/sql/*.ts`

**涉及文件**：
- `.claude/agents/architect.md`
- `.claude/agents/build-error-resolver.md`
- `.claude/agents/business-intelligence.md`
- `.claude/agents/code-simplifier.md`
- `.claude/agents/duckdb-optimizer.md`
- `.claude/agents/security-reviewer.md`
- `.claude/agents/tdd-guide.md`
- `.claude/agents/README.md`

### 1.2 精简过大 agent 文件
- `verify-app.md` (15.5KB → ~6KB)：移除内嵌 Python/Playwright 代码示例，保留行为规范
- `code-simplifier.md` (11.7KB → ~6KB)：精简重复的代码模式示例
- `e2e-runner.md` (9.5KB → ~5KB)：精简内嵌测试代码

### 1.3 简化 README.md
- 移除过度嵌套的分类层级，改为扁平快查表
- 更新日期戳

---

## Phase 2: commands/ 优化 (31 files)

### 2.1 精简 3 个巨型命令
| 文件 | 当前 | 目标 | 策略 |
|------|------|------|------|
| `weekly-report.md` | 40.5KB | ~12KB | 移除大段 Markdown 模板示例，保留结构定义和执行步骤 |
| `data-analysis.md` | 33.9KB | ~10KB | 子命令已存在，移除重复的详细分析步骤（已委托给子命令） |
| `security-review.md` | 22.6KB | ~8KB | 子命令已存在，移除重复的检查细节（已委托给子命令） |

### 2.2 修正过时引用（所有 command 文件）
- `DuckDB-WASM` → `DuckDB (server-side)`
- `src/shared/duckdb/client.ts` → `server/src/services/duckdb.ts`
- `src/shared/sql/*.ts` → `server/src/sql/*.ts`
- `requires: DuckDB-WASM` → `requires: server API (DuckDB)`

**涉及 ~15 个命令文件**

### 2.3 修复断裂引用
- `data-analysis.md` → `.claude/knowledge-extraction-protocol.md`（路径不存在）
- `extract-knowledge.md` → `.claude/subagents/knowledge-miner.md`（应为 `.claude/agents/`）

### 2.4 更新 README.md 命令索引
- 修正版本号和日期
- 确保所有命令都有正确的 category 分组

---

## Phase 3: contexts/ 优化

### 3.1 新增 3 个项目特有上下文
| 上下文 | 文件 | 用途 |
|--------|------|------|
| 数据分析 | `data.md` | 数据处理任务注入：字段定义、SQL 模式、业务规则引用 |
| 安全审查 | `security.md` | 安全任务注入：OWASP 检查清单、项目安全边界 |
| 性能优化 | `performance.md` | 性能任务注入：DuckDB 查询优化、React 渲染、API 响应 |

### 3.2 更新 README.md
- 添加新上下文说明
- 说明 context 的使用方式

---

## Phase 4: docs/ 优化

### 4.1 清理过时内容
- `conflict-free-quick-reference.md`：修正 `src/shared/duckdb` → `server/src/services/duckdb.ts` 引用

### 4.2 新增实用文档
| 文档 | 内容 |
|------|------|
| `api-quickref.md` | API 端点快速参考（路由、请求格式、响应格式） |
| `agent-command-map.md` | Agent ↔ Command 对应关系表（何时用 agent、何时用 command） |

---

## 执行顺序

1. Phase 1 (agents) 和 Phase 2 (commands) 可并行执行
2. Phase 3 (contexts) 独立执行
3. Phase 4 (docs) 独立执行

预计修改 ~35 个文件，新增 5 个文件。

## 验证

- `ls -la .claude/agents/ .claude/commands/ .claude/contexts/ .claude/docs/` 确认文件结构
- `grep -r "DuckDB-WASM" .claude/agents/ .claude/commands/` 确认零残留
- `grep -r "src/shared/duckdb" .claude/agents/ .claude/commands/` 确认零残留
- 检查 3 个巨型文件大小是否降到目标范围
