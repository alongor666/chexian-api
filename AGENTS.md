# AGENTS.md

> 这是给 Codex 的仓库工作地图。先读根目录规则，再按任务进入子目录细则。
> 本文件为 Codex 工作地图入口。Claude 项目入口见 `.claude/AGENTS.md`，专项规则见 `.claude/rules/`。

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
- 业务与进展：需求账本真相 [`BACKLOG_LOG.jsonl`](./BACKLOG_LOG.jsonl) + `backlog-events/`（`BACKLOG.md` 为 gitignored 派生视图，`bun run backlog:render` 生成）、[`PROGRESS.md`](./PROGRESS.md)
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
| `.claude/data-knowledge-protocol.md` | 数据口径事实源 |
| `.claude/rules/data-pipeline.md` | ETL/分片护栏 |
| `.claude/rules/sql-generators.md` | SQL 业务口径护栏 |
| `.claude/rules/claude-md-budget.md` | CLAUDE.md 体积红线 |
| `.claude/agents/**` | Agent 行为契约 |
| AGENTS.md §8 本节 | 元规则（修改本节也算 frozen）|

> **2026-06-17 §8.1 校准**：`reference_shared_memory.md` 已从本表移除——其物理路径 `~/.claude/projects/**/memory/reference_shared_memory.md` 已被 §8.3 user-only 覆盖。user-only（AI 完全不动）严于 frozen（需 `[policy-override]`），双标只会让档位判断歧义。该文件作为契约的修改路径：用户人工编辑（与其它 memory 文件一致）。

> **2026-06-05（PR #493）**：经 owner 显式授权（`[policy-override]`），`CLAUDE.md` 移出 frozen 名单——顶层指令的常规校准（注册表计数、命令约定等）不再需逐次 `[policy-override]`；CLAUDE.md 体积红线仍由 frozen 的 `.claude/rules/claude-md-budget.md` + governance #23 守护，业务口径/红线表的实质改动仍应走 PR + review。

### 8.2 `append-only` — 工具注册表 / 命令体系

允许：**新增**命令文件。
禁止：修改既有命令文件的实质逻辑、删除既有命令。

> **AI-native（2026-05-30）**：项目不再维护人类向 README 索引（`.claude/commands|agents|skills/README.md` 已删除，governance H1 计数检查同步移除）。命令/agent/skill 由各自 frontmatter `description` 自动注入上下文被发现；新增时写好 frontmatter 即可，无需登记任何索引行。

| 路径 | 操作准则 |
|------|---------|
| `.claude/commands/*.md` | 允许新增；既有命令的修订需用户口头确认 |
| `.claude/rules/`（除上面 frozen 列出的外）| 允许新增独立护栏文件；既有文件改动按 frozen 处理 |

PR 涉及 append-only 路径的纯新增时，**不需要**额外授权，但 PR 描述必须显式注明 `policy: append-only`。

### 8.3 `user-only` — 本地状态 / 共享记忆

**规则语义**：

- **读始终允许**（含 `grep` / `cat` / Read 工具 / lock 状态查询）。
- **写禁止**：AI 不得通过 Write / Edit / 删除 / `>` 重定向 / `sed -i` / `git rm` / `git mv` 等任何方式修改下表路径。

| 路径 | 档位 | 说明 |
|------|------|------|
| `.claude/shared-memory/**` | 🔒 硬锁 | 项目内 git tracked 共享记忆（私董会/作战地图/chexian 多项目共用）|
| `~/.claude/shared-memory/**` | 🔒 硬锁 | 全部用户级共享记忆根目录（chexian / sidonghui / 等所有子项目）|
| `.claude/scheduled_tasks.lock` | 🔒 硬锁 | 调度运行时 lock（gitignore，并发原语）|
| `~/.claude/projects/**/memory/**` | 🔓 可授权 | auto-memory 与用户手工 memory；默认禁写，用户可拨开关放行（见下）|

**豁免**：`~/.claude/projects/**/memory/**` 下，**平台内置 auto-memory 工具入口**（Claude Code 内置的 memory 写入机制 / Claude Agent SDK 的 memory 持久化通道）写入不受本规则约束——AI 通过 Write/Edit 工具调用不豁免。

**用户授权开关（仅对 🔓 可授权档 `~/.claude/projects/**/memory/**` 生效；硬锁档不受影响）**：默认仍禁 AI 写 memory，但用户本人可拨动以下任一开关临时/长期放行（`scripts/hooks/claude-user-only-guard.sh` 识别）：

1. **临时（即时生效，无需重启）**：`touch .claude/.user-only-write-ok`（仓库内，已 gitignore）或 `touch ~/.claude/.user-only-write-ok`（全局，跨 worktree）；用完 `rm` 撤销。
2. **长期**：在 `.claude/settings.local.json` 的 `env` 段设 `CLAUDE_USER_ONLY_WRITE_OK=1`（需重启会话）。

命中开关放行时 hook 向 stderr 打印审计提示。🛑 **AI 会话禁止自行设置该环境变量或创建该哨兵文件**——开关只能由用户本人拨动，AI 自拨等同自我授权后门（与 §8.3 末 `SHARED_MEMORY_USER_WRITE` 同理）。

**用户对话中要求修改 user-only 路径时的 AI 响应规范**：

1. **不直接改**：即使用户明确说"把 memory `feedback_xxx` 里 X 改成 Y"或"删掉这条 memory"，AI 不得用 Write/Edit 工具完成。
2. **提供 diff/patch**：给出具体改动方案（`<file_path>:<line>` 处 X → Y 的明确 diff），让用户 copy-paste 到自己的终端 / 编辑器手动 apply。
3. **不绕路**：禁止建议"我来跑一个 shell 脚本 / Bash here-doc 帮你写入"——这属于借道 Bash 绕开 Write/Edit 拦截，违反本节精神。

**机制覆盖范围与剩余规约层**（诚实声明，对应规则语义中的"写禁止"全口径）：

| 写入入口 | user-only 路径 | 拦截层 | 状态 |
|---|---|---|---|
| Write / Edit（Claude Code 工具调用）| 全部 4 类（项目内+项目外+gitignore）| **PreToolUse hook**（`scripts/hooks/claude-user-only-guard.sh`，matcher `Write\|Edit`）| ✅ 机制拦截，写动作发起前阻止 |
| 已 commit 进 PR 的违规 | 仅 `.claude/shared-memory/**`（git 可见）| **governance check**（`scripts/check-governance.mjs:checkSharedMemoryUserOnly` 第 37 项，扫 staged/unstaged/untracked/`origin/main...HEAD` commit range）| ✅ 机制拦截，pre-push / CI / `bun run governance` 闸 |
| Bash 命令（here-doc `cat >` / `sed -i` / `git rm` / `git mv` / 任意 shell 重定向）写入 user-only | 全部 4 类 | ⚠️ **无机制拦截**——matcher 不挂 Bash | 走 AI 自律「不绕路」+ reviewer 人工核查；命中 `.claude/shared-memory/**` 的 Bash 写入会被 governance commit range 兜底（事后），但 `~/.claude/**` 与 `scheduled_tasks.lock` 的 Bash 写入**无机制兜底** |

> Bash 入口未挂 hook 的取舍：项目内大量合法 Bash 写文件（ETL 写 parquet / sed 改 lockfile / git mv 重组目录），无差别拦截误拦率高、解析 shell 命令易绕过；故只在 Write/Edit 工具入口设硬拦截，Bash 写入对 user-only 的合规由「不绕路」自律 + PR 评审兜底。需要更强保证时，user 可设 `SHARED_MEMORY_USER_WRITE=1` 显式豁免开关（命名带 USER_WRITE 自我提示，**AI 会话禁用**）作为治理 lever。

详细规则（违规清单、备选路径建议、自动闸行为）见 [`.claude/rules/shared-memory-discipline.md`](.claude/rules/shared-memory-discipline.md)。

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
