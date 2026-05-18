# Claude Code 命令索引 (v3.3)

> 车险数据分析平台 — 40 个项目级 Slash Commands（不含本 README）

**最后更新**: 2026-05-18（P3.3 第三刀 — 散落车险功能归簇完成）

---

## 快速查找

| 我想... | 命令 | 详细文档 |
|---------|------|---------|
| 提交代码并创建 PR | `/chexian-commit-push-pr` | [chexian-commit-push-pr.md](./chexian-commit-push-pr.md) |
| 部署到 VPS | `/chexian-deploy` | [chexian-deploy.md](./chexian-deploy.md) |
| 每日数据同步 | `/chexian-daily-sync` | [chexian-daily-sync.md](./chexian-daily-sync.md) |
| 车险数据分析 | `/chexian-data-analysis` | [chexian-data-analysis.md](./chexian-data-analysis.md) |
| 数据概览 | `/chexian-data-profile` | [chexian-data-profile.md](./chexian-data-profile.md) |
| 业绩排名 | `/chexian-data-kpi` | [chexian-data-kpi.md](./chexian-data-kpi.md) |
| 趋势分析 | `/chexian-data-trends` | [chexian-data-trends.md](./chexian-data-trends.md) |
| 数据导出 | `/chexian-data-export` | [chexian-data-export.md](./chexian-data-export.md) |
| Python 数据工具 | `/chexian-data-tools` | [chexian-data-tools.md](./chexian-data-tools.md) |
| 成本分析 | `/chexian-cost-analysis` | [chexian-cost-analysis.md](./chexian-cost-analysis.md) |
| 定价红线 | `/chexian-pricing-redline` | [chexian-pricing-redline.md](./chexian-pricing-redline.md) |
| 客户来源去向 | `/chexian-flow-analysis` | [chexian-flow-analysis.md](./chexian-flow-analysis.md) |
| 续保巡检 | `/chexian-patrol` | [chexian-patrol.md](./chexian-patrol.md) |
| 推送企业微信 | `/chexian-push-wecom` | [chexian-push-wecom.md](./chexian-push-wecom.md) |
| 生成周报 | `/chexian-report-weekly` | [chexian-report-weekly.md](./chexian-report-weekly.md) |
| 月报 | `/chexian-report-monthly` | [chexian-report-monthly.md](./chexian-report-monthly.md) |
| 自定义报告 | `/chexian-report-custom` | [chexian-report-custom.md](./chexian-report-custom.md) |
| 安全审查 | `/chexian-security-review` | [chexian-security-review.md](./chexian-security-review.md) |
| SQL 注入检查 | `/chexian-security-sql` | [chexian-security-sql.md](./chexian-security-sql.md) |
| XSS 检查 | `/chexian-security-xss` | [chexian-security-xss.md](./chexian-security-xss.md) |
| CORS 检查 | `/chexian-security-cors` | [chexian-security-cors.md](./chexian-security-cors.md) |
| 全量安全审查 | `/chexian-security-all` | [chexian-security-all.md](./chexian-security-all.md) |
| 性能审计 | `/chexian-performance-audit` | [chexian-performance-audit.md](./chexian-performance-audit.md) |
| UI 审查 | `/chexian-ui-review` | [chexian-ui-review.md](./chexian-ui-review.md) |
| 测试覆盖率 | `/chexian-test-coverage` | [chexian-test-coverage.md](./chexian-test-coverage.md) |
| 管理会话 | `/chexian-session-manager` | [chexian-session-manager.md](./chexian-session-manager.md) |
| 提取知识 | `/chexian-extract-knowledge` | [chexian-extract-knowledge.md](./chexian-extract-knowledge.md) |
| 汇总沟通记录 | `/chexian-session-summary` | [chexian-session-summary.md](./chexian-session-summary.md) |
| 检查点保存 | `/chexian-checkpoint` | [chexian-checkpoint.md](./chexian-checkpoint.md) |
| 多层验证 | `/chexian-verify` | [chexian-verify.md](./chexian-verify.md) |
| 多 Agent 编排 | `/chexian-orchestrate` | [chexian-orchestrate.md](./chexian-orchestrate.md) |
| 过户车出险地点 | `/diagnose-transfer-location` | [diagnose-transfer-location.md](./diagnose-transfer-location.md) |
| 诊断命令路由 | `/diagnose-router` | [diagnose-router.md](./diagnose-router.md) |
| 机构/经代经营诊断 | `/diagnose-agent` | [diagnose-agent.md](./diagnose-agent.md) |
| 车型细分诊断 | `/diagnose-segment` | [diagnose-segment.md](./diagnose-segment.md) |
| 双 cutoff cohort 对比 | `/diagnose-cohort-comparison` | [diagnose-cohort-comparison.md](./diagnose-cohort-comparison.md) |
| 续保诊断 | `/diagnose-renewal` | [diagnose-renewal.md](./diagnose-renewal.md) |
| 摩托车专项诊断 | `/diagnose-motorcycle` | [diagnose-motorcycle.md](./diagnose-motorcycle.md) |
| 赔款预测 | `/diagnose-forecast-claim` | [diagnose-forecast-claim.md](./diagnose-forecast-claim.md) |
| LR 投影 | `/diagnose-lr-projection` | [diagnose-lr-projection.md](./diagnose-lr-projection.md) |

> **全局命令**（不在项目级 `.claude/commands/`）：`/cleanup-worktrees`（P3.3 第三刀升迁到 `~/.claude/commands/`）、通用工程流程（`/commit-push-pr` 全局版、`/tdd`、`/evolve` 等）。

---

## 按类别

| 类别 | 主命令 | 子命令 |
|------|--------|--------|
| **Git 工作流** | `chexian-commit-push-pr`, `chexian-checkpoint` | — |
| **部署/同步** | `chexian-deploy`, `chexian-daily-sync` | — |
| **数据分析** | `chexian-data-analysis`, `chexian-data-tools`, `chexian-cost-analysis`, `chexian-pricing-redline`, `chexian-flow-analysis` | `chexian-data-profile`, `chexian-data-kpi`, `chexian-data-trends`, `chexian-data-export` |
| **续保巡检** | `chexian-patrol` | — |
| **报告生成** | `chexian-report-weekly` | `chexian-report-monthly`, `chexian-report-custom` |
| **报告分发** | `chexian-push-wecom` | — |
| **安全审查** | `chexian-security-review`, `chexian-security-all` | `chexian-security-sql`, `chexian-security-xss`, `chexian-security-cors` |
| **开发工具** | `chexian-performance-audit`, `chexian-ui-review`, `chexian-test-coverage`, `chexian-verify` | — |
| **知识管理** | `chexian-session-manager`, `chexian-extract-knowledge`, `chexian-session-summary` | — |
| **工作流增强** | `chexian-orchestrate` | — |
| **经营诊断（车险）** | `diagnose-agent`, `diagnose-motorcycle`, `diagnose-transfer-location`, `diagnose-router`, `diagnose-segment`, `diagnose-cohort-comparison`, `diagnose-renewal`, `diagnose-forecast-claim`, `diagnose-lr-projection` | — |

---

## 统计

| 类别 | 命令数 |
|------|--------|
| 车险簇 chexian-* | 31 |
| 诊断簇 diagnose-* | 9 |
| **合计** | **40** |

---

## P3.3 治理记录

- **第一刀**（[PR #402](https://github.com/alongor666/chexian-api/pull/402)，2026-05-18）：消除 11 同名 command + 2 处 skill/command 冲突 → 9 rename 加 chexian- 前缀 + 3 删项目（session-debrief/evolve/tdd）+ 1 删全局（learn）
- **第三刀**（本 PR，2026-05-18，策略 A+D 重做版）：22 散落 command rename 加 chexian- 前缀 + 3 删（report-weekly 合并入 weekly-report→chexian-report-weekly / init-project / sync-and-rebase）+ 1 升迁全局（cleanup-worktrees）
- 治理依据：[skill-system-methodology.md](~/.claude/docs/skill-system-methodology.md) §P8 前缀语义化 + §P9 形态匹配
- 重做缘起：第一版 perl 全树替换因 `\b` 边界过宽，把 `.github/workflows/deploy.yml`、`/usr/local/bin/deploy-chexian-api`、`数据管理/patrol/patrol_engine.py` 等 CI/CD 关键路径误改。Phase 0 完全回退到 origin/main + 策略 A 风险分级（低危 perl 严格正则 / 中危 perl + dry-run / 高危手工 Edit）+ 策略 D 双向 gate（旧名残留 + 新名路径误位）重做，根除过度替换。

---

## 相关索引

- [Agents 索引](../agents/README.md)
- [Contexts 索引](../contexts/README.md)
- [Agent-Command 对应关系](../docs/agent-command-map.md)
