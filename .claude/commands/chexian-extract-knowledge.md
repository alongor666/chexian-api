---
name: chexian-extract-knowledge
description: 提取对话中的隐性知识并结构化归档到知识库。当用户说"提取知识/归档规则/沉淀本次对话"时触发。
category: knowledge-management
version: 1.1.0
author: "@claude"
tags: [knowledge, documentation, automation, best-practices]
scope: global
requires: []
dependencies:
  - .claude/knowledge-extraction-protocol.md
  - .claude/agents/knowledge-miner.md
last_updated: "2026-06-09"
---

# /chexian-extract-knowledge

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
/chexian-extract-knowledge

# 提取本次对话,仅关注业务规则
/chexian-extract-knowledge --focus business-rules

# 提取历史对话
/chexian-extract-knowledge --scope history

# 批量模式,快速确认
/chexian-extract-knowledge --mode batch
```

## 工作流程

调用 `.claude/agents/knowledge-miner.md` 执行六步流程（强制读取 `.claude/knowledge-extraction-protocol.md` 协议）：
1. 扫描对话识别关键词（规则/纠正/约束/决策）
2. 提取完整对话片段上下文
3. 按六类知识体系分类整理
4. 逐项确认理解准确性
5. 归档存储到对应路径（见下）
6. 输出变更摘要报告

## 归档路径映射（项目专属）

| 知识类型 | 归档路径 |
|---------|---------|
| 车险业务规则 | `数据管理/knowledge/rules/车险数据业务规则字典.md` |
| 数据索引与字段 | `开发文档/00_index/DATA_INDEX.md` |
| 开发规范与决策 | `开发文档/DEVELOPER_CONVENTIONS.md` |
| 进展与缺口 | `开发文档/缺口清单.md` |
| 跨对话持久记忆 | `~/.claude/projects/.../memory/MEMORY.md` |

## 相关文档

- `.claude/knowledge-extraction-protocol.md` — 知识提取协议（强制读取，覆盖所有提取行为）
- `.claude/agents/knowledge-miner.md` — 知识挖掘 Agent
