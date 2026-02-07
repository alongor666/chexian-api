---
name: extract-knowledge
description: 提取对话中的隐性知识并结构化归档到知识库
category: knowledge-management
version: 1.0.0
author: "@claude"
tags: [knowledge, documentation, automation, best-practices]
scope: global
requires: []
dependencies:
  - .claude/knowledge-extraction-protocol.md
  - .claude/subagents/knowledge-miner.md
last_updated: "2026-01-11"
---

# /extract-knowledge

提取对话中的隐性知识并结构化归档到知识库。

## 使用场景

- 重要对话结束后，提取本次对话中的业务规则、决策、约束
- 项目初始化时，从历史对话补齐知识库
- 定期维护知识库，发现并修正过时内容

## 参数

- `--scope`: 提取范围 (可选)
  - `current`: 仅本次对话 (默认)
  - `history`: 历史对话
  - `all`: 全部对话

- `--focus`: 重点关注的领域 (可选)
  - `business-rules`: 业务规则
  - `technical`: 技术约束
  - `standards`: 开发规范
  - `decisions`: 历史决策
  - `exceptions`: 例外情况
  - `all`: 全部类型 (默认)

- `--mode`: 确认模式 (可选)
  - `interactive`: 交互式逐项确认 (默认)
  - `batch`: 批量确认

## 使用示例

```bash
# 提取本次对话的全部知识
/extract-knowledge

# 提取本次对话,仅关注业务规则
/extract-knowledge --focus business-rules

# 提取历史对话
/extract-knowledge --scope history

# 批量模式,快速确认
/extract-knowledge --mode batch
```

## 工作流程

1. **扫描对话** - 识别关键词命中(规则、纠正、约束、决策)
2. **提取上下文** - 获取完整对话片段
3. **分类整理** - 按6类知识体系分类
4. **请求确认** - 逐项确认理解准确性
5. **归档存储** - 更新知识库文档
6. **生成报告** - 输出变更摘要

## 输出

- 候选知识清单 (Markdown)
- 更新的知识库文档
- 变更摘要报告

## 预期时间

- 交互模式: 20-40分钟
- 批量模式: 5-10分钟

## 相关文档

- `.claude/knowledge-extraction-protocol.md` - 知识提取协议
- `.claude/subagents/knowledge-miner.md` - Knowledge Miner Subagent
- `开发文档/00_index/DATA_INDEX.md` - 数据索引
