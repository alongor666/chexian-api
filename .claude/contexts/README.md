# Contexts 索引 (v2.0)

> 动态上下文注入 — 根据任务类型提供精准的背景知识和行为指引

**最后更新**: 2026-02-24

---

## 可用上下文

| 上下文 | 适用场景 | 描述 |
|--------|---------|------|
| [dev.md](./dev.md) | 开发任务 | 代码编写、功能实现、Bug 修复 |
| [research.md](./research.md) | 研究任务 | 技术调研、方案设计、架构规划 |
| [review.md](./review.md) | 审查任务 | 代码审查、PR 评审 |
| [data.md](./data.md) | 数据分析 | SQL 查询、数据质量、业务指标计算 |
| [security.md](./security.md) | 安全审查 | 漏洞检测、安全合规、防御性编码 |
| [performance.md](./performance.md) | 性能优化 | 查询调优、渲染效率、资源使用 |

## 使用方式

在对话中根据任务类型手动加载对应上下文，或在 Agent/Command 中引用。

## 相关

命令在 `../commands/`、agent 在 `../agents/`，均由各文件 frontmatter `description` 自动注入上下文被发现（AI-native，不维护 README 索引）。
