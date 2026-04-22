# AGENTS.md

> 这是给 Codex 的仓库工作地图。先读根目录规则，再按任务进入子目录细则。

## 1. 语言与优先级

- 使用中文回复。
- 指令优先级：系统指令 > 开发者指令 > 本文件 > 子目录 `AGENTS.md` > 其他项目文档。
- 如果上层指令与下层文档冲突，以更高优先级为准。

## 2. 应遵守的工作方式

- 动手前先搜现有实现和相关文档，禁止凭空假设“不存在”。
- 改动少时优先精准修改；大改动再考虑重写。
- 保留无关改动，不要擅自回滚或顺手清理别人的工作。
- 避免删除整个模块、目录或主流程，优先局部修补。
- 多个独立任务可并行处理，不要串行等待可并行的信息。
- 包管理器只用 `bun`，不要改用 `npm` / `yarn`。

## 3. 先看这些文档

- 架构总览：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 业务与进展：[`BACKLOG.md`](./BACKLOG.md)、[`PROGRESS.md`](./PROGRESS.md)
- 技术与规范：[`开发文档/TECH_STACK.md`](./开发文档/TECH_STACK.md)、[`开发文档/DEVELOPER_CONVENTIONS.md`](./开发文档/DEVELOPER_CONVENTIONS.md)
- 数据与知识：[`数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md)、[`数据管理/knowledge/rules/车险数据业务规则字典.md`](./数据管理/knowledge/rules/车险数据业务规则字典.md)
- 需要更细的约束时，进入对应子目录的 `AGENTS.md`。

## 4. 验证原则

- 代码或配置修改后，先做可执行验证，再声称完成。
- 声称“已完成”“已验证”“已部署”时，至少给出一个真实可复现的检查结果。
- 涉及接口、SQL、数据、快照或路由时，优先用真实请求、真实数据或直接查询验证。
- 修改前端时，至少做一次构建或类型检查。

## 5. 常用验证命令

- `bun run dev:full`
- `bun run build`
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run governance`
- `bun run snapshot:build`
- `bun run snapshot:verify`

## 6. 分区细则

- 前端、组件、服务层规则：[`src/AGENTS.md`](./src/AGENTS.md)
- 后端、SQL、API、指标注册表规则：[`server/AGENTS.md`](./server/AGENTS.md)
- 数据管道、Parquet、ETL、业务口径规则：[`数据管理/AGENTS.md`](./数据管理/AGENTS.md)

## 7. 交付要求

- 涉及多文件重构时，完成后同步更新受影响的索引或知识文档。
- 需要提交、推送、建 PR 时，直接执行，不要只停留在建议层。
- 如果任务范围明显偏大，先拆分再做，避免把独立问题混成一个难以验证的改动。

## 8. CLAUDE 体系禁改

- 不要修改 `CLAUDE.md`。
- 不要修改 `.claude/` 目录及其所有子文件、子目录。
- 不要修改 `CLAUDE.md` 中直接点名的体系文件，包括但不限于：
  - `.claude/data-knowledge-protocol.md`
  - `.claude/rules/data-pipeline.md`
  - `.claude/rules/sql-generators.md`
  - `.claude/commands/README.md`
  - `.claude/commands/` 下的所有命令文件
  - `.claude/agents/` 下的所有文件
  - `.claude/shared-memory/` 下的所有文件
  - `~/.claude/shared-memory/chexian/` 本地运行时内容
  - `reference_shared_memory.md`
- 只要一个文件在 `CLAUDE.md` 里被当作“必读 / 唯一事实源 / 护栏 / 注册表 / 共享记忆 / 命令 / agents 体系”点名，就默认需要你明确授权后才能修改；未经授权时不改。
