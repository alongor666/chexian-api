# Agent-Command 对应关系

> 何时用 Agent、何时用 Command？

**最后更新**: 2026-02-24

---

## 选择原则

| 场景 | 用 Agent | 用 Command |
|------|---------|-----------|
| 需要深度分析/多轮推理 | Y | |
| 需要标准化输出格式 | | Y |
| 作为 sub-agent 被调用 | Y | |
| 用户直接通过 `/` 调用 | | Y |
| 需要交互式确认 | Y | |

---

## 对应关系表

| Agent | 对应 Command | 关系说明 |
|-------|-------------|---------|
| `architect` | — | 独立 agent，无对应 command |
| `build-error-resolver` | — | 构建失败时自动触发 |
| `business-intelligence` | `/chexian-data-analysis` | BI agent 提供分析能力，command 提供标准化流程 |
| `code-simplifier` | — | 代码审查后触发 |
| `data-validator` | `/chexian-data-profile` | validator 做深度校验，profile 做概览 |
| `duckdb-optimizer` | — | 查询慢时触发 |
| `e2e-runner` | — | E2E 测试专用 |
| `knowledge-miner` | `/chexian-extract-knowledge` | miner 提取知识，command 触发流程 |
| `react-performance` | `/chexian-performance-audit` | agent 专注 React，command 做全栈审计 |
| `security-reviewer` | `/chexian-security-review` | agent 深度分析，command 8 项检查清单 |
| `session-manager` | `/chexian-session-manager` | 功能相同，command 是快捷入口 |
| `tdd-guide` | — | 项目无对应 command（敲 `/tdd` 会用全局通用版） |
| `ui-ux-designer` | `/chexian-ui-review` | agent 设计，command 审查 |
| `verify-app` | `/chexian-verify` | agent 全面验证，command 快速检查 |

---

## Command 分类速查

### 数据分析类
| Command | 说明 | 耗时 |
|---------|------|------|
| `/chexian-data-analysis` | 全量 12 维度分析 | 长 |
| `/chexian-data-profile` | 数据概览+质量 | 短 |
| `/chexian-data-kpi` | 业绩+排名 | 中 |
| `/chexian-data-trends` | 时间趋势 | 中 |
| `/chexian-data-export` | 导出结果 | 短 |
| `/chexian-cost-analysis` | 成本深度审计 | 中 |

### 报告类
| Command | 说明 |
|---------|------|
| `/chexian-report-weekly` | 董事会级完整周报 |
| `/chexian-report-weekly` | 快速周报 |
| `/chexian-report-monthly` | 月报 |
| `/chexian-report-custom` | 自定义时间范围 |

### 安全类
| Command | 说明 |
|---------|------|
| `/chexian-security-review` | 全量 8 项审查 |
| `/chexian-security-sql` | SQL 注入专项 |
| `/chexian-security-xss` | XSS 专项 |
| `/chexian-security-cors` | CORS+文件上传 |
| `/chexian-security-all` | 快速全量 |

### 工作流类
| Command | 说明 |
|---------|------|
| `/chexian-commit-push-pr` | Git 提交+推送+PR |
| `/chexian-verify` | 多层验证 |
| `/chexian-checkpoint` | 会话存档 |
| `/chexian-test-coverage` | 测试覆盖率 |
