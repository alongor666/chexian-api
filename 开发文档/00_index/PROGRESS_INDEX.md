# 进展索引 (PROGRESS_INDEX)

**定位**：进展/任务状态类知识的**入口指针**。本文件不复述状态机与口径——2026-06-07（PR #522）需求管理迁移到事件日志模型后，那些内容的唯一事实源在下表所指位置；此前本文件复述的旧状态机（PROPOSED→TRIAGED→…）已随迁移废止，历史版本见 git。

## 唯一事实源速查

| 主题 | 唯一事实源 | 说明 |
|------|-----------|------|
| 需求账本（真相） | `/BACKLOG_LOG.jsonl`（存量·冻结只读）+ `/backlog-events/`（增量·每事件一文件） | 写入一律 `bun scripts/backlog.mjs`（add/status/note/claim/…），禁止手改 |
| 事件模型 / 状态与折叠规则 / DONE 证据要求 | `.claude/rules/backlog-eventlog.md` | 事件类型、折叠语义、验收证据字段定义 |
| 本地看板（派生视图） | `BACKLOG.md` / `BACKLOG_ARCHIVE.md` — gitignored 不进 git，`bun run backlog:render` 生成 | 只读视图，冲突时以真相日志为准 |
| 里程碑存档 | `/PROGRESS.md` | 历史里程碑编年史（2026-05-18 后不再逐条人工维护） |
| 自动校验 | `bun run governance`（`BACKLOG证据链` / `BACKLOG事件日志` 检查项） | DONE 缺证据、事件格式错误会拦截提交 |

## 接力入口（新协作者三步）

1. 读三大索引：[DOC_INDEX](./DOC_INDEX.md) + [CODE_INDEX](./CODE_INDEX.md) + [DATA_INDEX](./DATA_INDEX.md)
2. `bun run backlog:render` 生成本地看板，查看待办/进行中/阻塞任务
3. 领取任务先 `bun scripts/backlog.mjs claim`（防重复派发），完成后走 status 事件并附验收证据

## 变更记录

- 2026-07-16：整体重写为薄指针（知识体系审计，详见 `开发文档/审计/2026-07-16-知识体系审计.md`）。原文复述的状态机定义、DONE 判定规则、由 `bun run backlog:render` 生成的本地派生看板表格流程均已被事件日志模型取代且 5 个月未更新，全部改为指向唯一事实源。
- 2026-02-07：初始版本（旧 BACKLOG.md 表格模型，该文件现为 gitignored 派生视图）。
