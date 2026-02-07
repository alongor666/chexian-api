# Plans 使用说明

## 目标

将 `.claude/plans/` 作为“计划/设计/分析文档”的集中目录，并通过自动化脚本生成轻量状态快照，减少全量搜索带来的 token 消耗。

## 推荐工作流（先快照，后全文）

1. 先阅读：`STATUS_SNAPSHOT.md`
2. 如需深入某一计划，再打开对应文件（避免对整个 plans 目录做全文搜索）

## 自动化脚本

- 生成状态快照（默认 dry-run）：`bun run plans:manage`
- 执行归档（移动到 `_archive/`，并在原位置写入占位文件以保持引用）：`bun run plans:manage -- --apply`

## 状态判定（脚本规则）

脚本会综合以下信号判定计划是否完成：

- 文内“当前状态/状态：DONE/已完成/100%✅”等显式标记
- 勾选清单 `[ ] / [x]` 的完成情况
- 引用的 BACKLOG 任务（Bxxx）是否均为终态（DONE/ARCHIVED/DEPRECATED，含 BACKLOG_ARCHIVE）

