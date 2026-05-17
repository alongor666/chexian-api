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
- 涉及接口、SQL、数据或路由时，优先用真实请求、真实数据或直接查询验证。
- 修改前端时，至少做一次构建或类型检查。

## 5. 常用验证命令

- `bun run dev:full`
- `bun run build`
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run governance`

## 5.1 日常数据发布入口

- `bun run release:daily:dry`：只看 ETL/VPS/企微同步计划，不写外部系统。
- `bun run release:daily:check`：执行 ETL/VPS/reload/health，企微只 dry-run。
- `bun run release:daily`：执行 ETL → VPS → reload → health → 企微同步。
- 细节见 `数据管理/integrations/wecom_smartsheet/README.md` 与 `scripts/sync-and-reload.mjs --help`。

## 6. 分区细则

- 前端、组件、服务层规则：[`src/AGENTS.md`](./src/AGENTS.md)
- 后端、SQL、API、指标注册表规则：[`server/AGENTS.md`](./server/AGENTS.md)
- 数据管道、Parquet、ETL、业务口径规则：[`数据管理/AGENTS.md`](./数据管理/AGENTS.md)

## 7. 交付要求

- 涉及多文件重构时，完成后同步更新受影响的索引或知识文档。
- 需要提交、推送、建 PR 时，直接执行，不要只停留在建议层。
- 如果任务范围明显偏大，先拆分再做，避免把独立问题混成一个难以验证的改动。

## 8. CLAUDE 体系修改护栏（分级）

不再用单一"禁改名单"，按目录用途分三档。**判断顺序：先看 policy，再做改动**。

### 8.1 `frozen` — 业务护栏 / 红线规则 / Agent 契约

任何修改都需要用户**显式书面授权**（聊天里口头同意 + PR 标题或 commit message 含 `[policy-override]`）。

| 路径 | 理由 |
|------|------|
| `CLAUDE.md` | 项目顶层指令 |
| `.claude/data-knowledge-protocol.md` | 数据口径事实源 |
| `.claude/rules/data-pipeline.md` | ETL/分片护栏 |
| `.claude/rules/sql-generators.md` | SQL 业务口径护栏 |
| `.claude/rules/claude-md-budget.md` | CLAUDE.md 体积红线 |
| `.claude/agents/**` | Agent 行为契约 |
| `reference_shared_memory.md` | 共享记忆契约 |
| AGENTS.md §8 本节 | 元规则（修改本节也算 frozen）|

### 8.2 `append-only` — 工具注册表 / 命令体系

允许：**新增**命令文件、**追加**索引新行、**新增** README 表格行。
禁止：修改既有命令文件的实质逻辑、删除既有命令、修改 README 既有行（除追加新行/更新计数/时间戳外）。

| 路径 | 操作准则 |
|------|---------|
| `.claude/commands/*.md`（除 README）| 允许新增；既有命令的修订需用户口头确认 |
| `.claude/commands/README.md` | 允许追加索引行 + 同步计数/时间戳；禁止改既有行 |
| `.claude/rules/`（除上面 frozen 列出的外）| 允许新增独立护栏文件；既有文件改动按 frozen 处理 |

PR 涉及 append-only 路径的纯新增时，**不需要**额外授权，但 PR 描述必须显式注明 `policy: append-only`。

### 8.3 `user-only` — 本地状态 / 共享记忆

AI 不得修改，只读引用；只能由用户手动 sync / 编辑。

| 路径 |
|------|
| `.claude/shared-memory/**` |
| `~/.claude/shared-memory/chexian/**` |
| `.claude/scheduled_tasks.lock` |
| `~/.claude/projects/**/memory/**`（auto-memory，hook 自动写入除外）|

### 8.4 与外部 AI 评审协作（Codex）

Codex 评审基于规则字面解释；Claude Code 承担"判断 policy 等级"的职责。

- Codex 标记 P1 违反 §8 时：先识别变更路径属于哪一档
  - `frozen` + 无授权 → 立即遵从，回滚
  - `append-only` + 纯新增 → 在 PR comment 注明 policy 等级，**不必回滚**
  - 规则本身脱节 / 粒度不当 → 同 PR 加一个修改 §8 的 commit，让用户拍板
- 不要把 Codex 字面解释当作终审；规则合理性由用户 + Claude Code 协同判断。

## 9. 共享知识库入口

本项目通过软链接复用相邻车险知识库，避免重复维护业务口径：

- `共享知识库_作战地图` -> `/Users/alongor666/Desktop/私董会--车险作战地图/05_知识库`
- `共享知识库_车险经营决策` -> `/Users/alongor666/Downloads/车险经营决策/知识库`

涉及四川车险经营决策、司务会报告审视、经营底线、机构盈利面、整改闭环时，先读取 `共享知识库_车险经营决策`，再结合本项目 `数据管理/knowledge` 与指标注册表核对口径。
