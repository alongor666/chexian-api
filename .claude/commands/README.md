# Claude Code 命令索引 (v3.1)

> 车险数据分析平台 — 44 个 Slash Commands

**最后更新**: 2026-05-06

---

## 快速查找

| 我想... | 命令 | 详细文档 |
|---------|------|---------|
| 提交代码并创建 PR | `/commit-push-pr` | [commit-push-pr.md](./commit-push-pr.md) |
| 同步远程代码 | `/sync-and-rebase` | [sync-and-rebase.md](./sync-and-rebase.md) |
| 清理已合并 worktree | `/cleanup-worktrees` | [cleanup-worktrees.md](./cleanup-worktrees.md) |
| 车险数据分析 | `/data-analysis` | [data-analysis.md](./data-analysis.md) |
| 数据概览 | `/data-profile` | [data-profile.md](./data-profile.md) |
| 业绩排名 | `/data-kpi` | [data-kpi.md](./data-kpi.md) |
| 趋势分析 | `/data-trends` | [data-trends.md](./data-trends.md) |
| 数据导出 | `/data-export` | [data-export.md](./data-export.md) |
| Python 数据工具 | `/data-tools` | [data-tools.md](./data-tools.md) |
| 成本分析 | `/cost-analysis` | [cost-analysis.md](./cost-analysis.md) |
| 定价红线 | `/pricing-redline` | [pricing-redline.md](./pricing-redline.md) |
| 流向分析 | `/flow-analysis` | [flow-analysis.md](./flow-analysis.md) |
| 业务巡检 | `/patrol` | [patrol.md](./patrol.md) |
| 每日同步 | `/daily-sync` | [daily-sync.md](./daily-sync.md) |
| 生成周报 | `/weekly-report` | [weekly-report.md](./weekly-report.md) |
| 周报子命令 | `/report-weekly` | [report-weekly.md](./report-weekly.md) |
| 月报子命令 | `/report-monthly` | [report-monthly.md](./report-monthly.md) |
| 自定义报告 | `/report-custom` | [report-custom.md](./report-custom.md) |
| 安全审查 | `/security-review` | [security-review.md](./security-review.md) |
| SQL 注入检查 | `/security-sql` | [security-sql.md](./security-sql.md) |
| XSS 检查 | `/security-xss` | [security-xss.md](./security-xss.md) |
| CORS 检查 | `/security-cors` | [security-cors.md](./security-cors.md) |
| 全量安全审查 | `/security-all` | [security-all.md](./security-all.md) |
| 性能审计 | `/performance-audit` | [performance-audit.md](./performance-audit.md) |
| UI 审查 | `/ui-review` | [ui-review.md](./ui-review.md) |
| 测试覆盖率 | `/test-coverage` | [test-coverage.md](./test-coverage.md) |
| 管理会话 | `/session-manager` | [session-manager.md](./session-manager.md) |
| 提取知识 | `/extract-knowledge` | [extract-knowledge.md](./extract-knowledge.md) |
| 汇总沟通记录 | `/session-summary` | [session-summary.md](./session-summary.md) |
| 会话复盘 | `/session-debrief` | [session-debrief.md](./session-debrief.md) |
| 初始化项目 | `/init-project` | [init-project.md](./init-project.md) |
| 部署 | `/deploy` | [deploy.md](./deploy.md) |
| TDD 工作流 | `/tdd` | [tdd.md](./tdd.md) |
| 检查点保存 | `/checkpoint` | [checkpoint.md](./checkpoint.md) |
| 多层验证 | `/verify` | [verify.md](./verify.md) |
| 多 Agent 编排 | `/orchestrate` | [orchestrate.md](./orchestrate.md) |
| 配置演进 | `/evolve` | [evolve.md](./evolve.md) |
| 诊断命令路由 | `/diagnose-router` | [diagnose-router.md](./diagnose-router.md) |
| 机构/经代经营诊断 | `/diagnose-agent` | [diagnose-agent.md](./diagnose-agent.md) |
| 车型细分诊断 | `/diagnose-segment` | [diagnose-segment.md](./diagnose-segment.md) |
| 双 cutoff cohort 对比 | `/diagnose-cohort-comparison` | [diagnose-cohort-comparison.md](./diagnose-cohort-comparison.md) |
| 续保诊断 | `/diagnose-renewal` | [diagnose-renewal.md](./diagnose-renewal.md) |
| 摩托车专项诊断 | `/diagnose-motorcycle` | [diagnose-motorcycle.md](./diagnose-motorcycle.md) |
| 过户车出险地点 | `/diagnose-transfer-location` | [diagnose-transfer-location.md](./diagnose-transfer-location.md) |

---

## 按类别

| 类别 | 主命令 | 子命令 |
|------|--------|--------|
| **Git 工作流** | `commit-push-pr`, `sync-and-rebase`, `cleanup-worktrees` | — |
| **数据分析** | `data-analysis`, `data-tools`, `cost-analysis`, `pricing-redline`, `flow-analysis`, `patrol` | `data-profile`, `data-kpi`, `data-trends`, `data-export`, `daily-sync` |
| **经营诊断** | `diagnose-router`, `diagnose-agent`, `diagnose-segment`, `diagnose-cohort-comparison`, `diagnose-renewal`, `diagnose-motorcycle`, `diagnose-transfer-location` | — |
| **报告生成** | `weekly-report` | `report-weekly`, `report-monthly`, `report-custom` |
| **安全审查** | `security-review` | `security-sql`, `security-xss`, `security-cors`, `security-all` |
| **开发工具** | `performance-audit`, `ui-review`, `test-coverage` | — |
| **知识管理** | `session-manager`, `extract-knowledge`, `session-summary`, `session-debrief` | — |
| **项目管理** | `init-project`, `deploy` | — |
| **工作流增强** | `tdd`, `checkpoint`, `verify`, `orchestrate`, `evolve` | — |

---

## 统计

| 类别 | 主命令 | 子命令 | 合计 |
|------|--------|--------|------|
| Git 工作流 | 3 | 0 | 3 |
| 数据分析 | 6 | 5 | 11 |
| 经营诊断 | 7 | 0 | 7 |
| 报告生成 | 1 | 3 | 4 |
| 安全审查 | 1 | 4 | 5 |
| 开发工具 | 3 | 0 | 3 |
| 知识管理 | 4 | 0 | 4 |
| 项目管理 | 2 | 0 | 2 |
| 工作流增强 | 5 | 0 | 5 |
| **合计** | **32** | **12** | **44** |

---

## 相关索引

- [Agents 索引](../agents/README.md)
- [Contexts 索引](../contexts/README.md)
- [Agent-Command 对应关系](../docs/agent-command-map.md)
