---
name: plans-manager
description: 扫描、判定、归档 .claude/plans 计划文件，并生成轻量状态快照（STATUS_SNAPSHOT.md/json），以减少全文搜索与 token 消耗。
---

# Plans Manager Skill

## 适用场景（触发条件）

当用户表达以下意图时使用本技能：

- “高效检索 plans 目录的任务/计划是否完成”
- “已完成的计划需要归档、并保留引用”
- “减少 AI 对 plans 目录全文搜索，降低 token 消耗”
- “需要一个可重复执行的扫描+归档+归纳流程”

## 单一事实源（SSOT）与读取顺序

- 任务状态 SSOT：`BACKLOG.md`（以及 `BACKLOG_ARCHIVE.md`）
- plans 目录的“优先入口”：`STATUS_SNAPSHOT.md`
- 计划正文：仅在需要细节时再打开具体计划文件，避免全文检索 `.claude/plans/`

## 产物与目录约定

- 快照索引：
  - `.claude/plans/STATUS_SNAPSHOT.md`
  - `.claude/plans/STATUS_SNAPSHOT.json`
- 归档目录（按月归档）：
  - `.claude/plans/_archive/YYYY-MM/`
- 归档占位文件：
  - 原计划文件位置保留一个极短占位文件，写明“已归档至…”，用于维持引用链与可追溯性

## 判定逻辑（折中版：降低误判、兼顾存量文档）

脚本综合三类信号判定“计划是否完成”：

1. 文内状态行：`当前状态/状态: DONE/已完成/100%✅` 等显式标记
2. 勾选清单：`[ ]/[x]` 全部勾选视为完成
3. 关联任务：计划中出现的 `Bxxx` 是否在 `BACKLOG.md/BACKLOG_ARCHIVE.md` 中均为终态（DONE/ARCHIVED/DEPRECATED）

注意：
- 若原文件已是“归档占位文件”，视为 DONE 且不会重复归档
- 若缺少上述信号，状态会被标记为 UNKNOWN，并提示“建议补充当前状态或勾选清单”

## 标准操作流程

### 1) 默认扫描（建议每次先做）

```bash
bun run plans:manage
```

行为：
- 扫描 `.claude/plans` 的一级 Markdown 文件（不递归）
- 生成/更新 `STATUS_SNAPSHOT.md` 与 `STATUS_SNAPSHOT.json`
- 不移动文件（dry-run）

### 2) 执行归档（确认快照无误后）

```bash
bun run plans:manage -- --apply
```

行为：
- 将判定为 DONE 的计划文件移动到 `.claude/plans/_archive/YYYY-MM/`
- 在原路径写入占位文件保留引用链
- 更新快照文件

## 交互建议（给 AI 的“最短路径”）

强制约束：
- 禁止对 `.claude/plans` 全量全文搜索作为第一步

推荐最短路径：
1. 打开 `STATUS_SNAPSHOT.md` 了解总览
2. 若需要归档：运行 `bun run plans:manage` 再运行 `bun run plans:manage -- --apply`
3. 若需要深入：仅打开目标计划文件与其关联的 Bxxx（在 BACKLOG 中定位）

## 可靠性升级建议（可选：把 SSOT 从 Markdown 语义抽出来）

若你希望 100% 可靠判定完成度，建议逐步强制每个 plan 顶部加入结构化元信息，例如：

```text
当前状态：IN_PROGRESS | DONE
关联任务：B123,B124
```

届时脚本可以完全依赖元信息 + BACKLOG 状态，而无需推断勾选框含义。

