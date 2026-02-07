# Contexts 索引 (v1.0)

> 动态系统提示注入 - 根据任务类型自动加载不同上下文

**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
**最后更新**: 2026-01-28

---

## 📋 可用上下文

| 上下文 | 适用场景 | 描述 |
|--------|---------|------|
| [dev.md](#dev) | 开发任务 | 代码编写、功能实现 |
| [research.md](#research) | 研究任务 | 技术调研、方案设计 |
| [review.md](#review) | 审查任务 | 代码审查、安全审查 |

---

## 🗂️ 上下文详情

### dev
**文件**: [dev.md](./dev.md)
**适用场景**: 代码编写、功能实现、Bug修复

**触发条件**:
- 用户请求编写代码
- 用户请求修复问题
- 用户请求实现功能

---

### research
**文件**: [research.md](./research.md)
**适用场景**: 技术调研、方案设计、架构规划

**触发条件**:
- 用户请求研究某项技术
- 用户请求设计方案
- 用户请求评估选型

---

### review
**文件**: [review.md](./review.md)
**适用场景**: 代码审查、安全审查、性能审查

**触发条件**:
- 用户请求审查代码
- 用户请求安全检查
- 用户请求性能分析

---

## 🚀 使用方式

Contexts 通过 Claude Code 的 hooks 机制自动加载，无需手动调用。

当检测到特定任务类型时，系统会自动注入对应的上下文，提供更精准的响应。

---

## 🔗 相关文档

- **Skills 索引**: [.claude/skills/README.md](../skills/README.md)
- **Agents 索引**: [.claude/agents/README.md](../agents/README.md)
- **Commands 索引**: [.claude/commands/README.md](../commands/README.md)

---

**维护者**: @claude
**版本**: 1.0.0
**最后更新**: 2026-01-28
