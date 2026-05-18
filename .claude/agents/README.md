# AI Agents 索引 (v3.0)

> 车险数据分析平台 — 14 个专业化 AI 子代理

**最后更新**: 2026-02-24

---

## 快速查找

| 我需要... | Agent | Model | 详细文档 |
|-----------|-------|-------|---------|
| DuckDB 查询优化 | `duckdb-optimizer` | — | [duckdb-optimizer.md](./duckdb-optimizer.md) |
| React 性能优化 | `react-performance` | — | [react-performance.md](./react-performance.md) |
| 业务分析与洞察 | `business-intelligence` | — | [business-intelligence.md](./business-intelligence.md) |
| UI/UX 设计优化 | `ui-ux-designer` | — | [ui-ux-designer.md](./ui-ux-designer.md) |
| 代码简化与重构 | `code-simplifier` | sonnet | [code-simplifier.md](./code-simplifier.md) |
| 数据验证与清洗 | `data-validator` | — | [data-validator.md](./data-validator.md) |
| 应用验证与测试 | `verify-app` | — | [verify-app.md](./chexian-verify-app.md) |
| 会话管理 | `session-manager` | — | [chexian-session-manager.md](./chexian-session-manager.md) |
| 知识提取与归档 | `knowledge-miner` | — | [knowledge-miner.md](./knowledge-miner.md) |
| 架构规划 | `architect` | opus | [architect.md](./architect.md) |
| 构建错误解决 | `build-error-resolver` | opus | [build-error-resolver.md](./build-error-resolver.md) |
| 安全审查 | `security-reviewer` | opus | [security-reviewer.md](./security-reviewer.md) |
| TDD 开发指导 | `tdd-guide` | opus | [tdd-guide.md](./tdd-guide.md) |
| E2E 测试运行 | `e2e-runner` | opus | [e2e-runner.md](./e2e-runner.md) |

---

## 按类别

| 类别 | Agent | 触发场景 |
|------|-------|---------|
| **性能** | `duckdb-optimizer` | 查询 >3s、大数据集处理慢 |
| | `react-performance` | 组件渲染卡顿、FCP >2s、列表滚动慢 |
| **业务** | `business-intelligence` | 新增分析维度、指标计算、数据可视化 |
| **设计** | `ui-ux-designer` | 新增/重构 UI 组件、布局问题、移动端适配 |
| **质量** | `code-simplifier` | 复杂度过高、重复代码、PR 前重构 |
| | `data-validator` | 数据加载前验证、格式/完整性/业务规则检查 |
| | `verify-app` | 功能验证、性能测试、回归测试 |
| **知识** | `session-manager` | 查看/搜索/导出会话 |
| | `knowledge-miner` | 对话结束后提取隐性知识 |
| **工作流** | `architect` | 架构设计、技术选型 |
| | `build-error-resolver` | 构建失败、TS 类型错误 |
| | `security-reviewer` | SQL 注入、XSS、认证授权审查 |
| | `tdd-guide` | 新功能开发（写测试先行） |
| | `e2e-runner` | 端到端测试创建和执行 |

---

## 禁止修改区域 (RED LINE)

| 文件 | 原因 |
|------|------|
| `server/src/normalize/mapping.ts` | 业务口径定义（仅追加） |
| `server/src/sql/kpi.ts` | KPI 计算逻辑（仅追加） |
| `server/src/services/duckdb.ts:78-95` | PolicyFact 视图定义 |

---

## 相关索引

- [Commands 索引](../commands/README.md)
- [Contexts 索引](../contexts/README.md)
- [Agent-Command 对应关系](../docs/agent-command-map.md)
