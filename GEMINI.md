# GEMINI.md

> **chexian-api** — 车险数据分析平台（API 版）。前端 React + TypeScript + Vite + ECharts，后端 Express + DuckDB。纯 REST API 模式，已上线生产环境 `https://chexian.cretvalu.com`。

**协作操作系统**：Gemini 工作前必读协议。以最新 `CLAUDE.md` 为公共基线，补充 Gemini 专属协作、写入分区与部署约束。

---

## 0. AI 行为红线（ZERO TOLERANCE - 违反即失败）

> **来源**：36 个会话、319 条消息的 Insights 分析。18 次“方法错误”是最高频返工源。

### 执行纪律

| 红线 | 反面教训 | 正确做法 |
|------|---------|---------|
| **执行不规划** | 用户要求 commit/push/PR，却输出分析文档代替执行 | Git 操作直接执行命令，禁止用摘要替代 |
| **先搜再写** | 假设“模块/数据不存在”后误删逻辑 | 写代码前 `grep/glob/find` 全库搜索 |
| **验证不声称** | 声称“已可用/已集成”，实际 API 不通 | 必须用真实 API 请求或浏览器验证 |
| **修补不拆除** | 安全加固时整块删除插件或集成 | 只能补漏洞，不得直接拆除整个模块 |
| **并行不串行** | 逐个串行检查多个独立模块，效率低且易中断 | 3+ 独立模块/任务必须并行执行 |
| **层级不扁平** | 将“下钻”误做成扁平筛选 | 先确认交互模型：点击行 → 选维度 → 重组 + 面包屑 |
| **聚焦不发散** | 一次会话并行推进多个目标导致半途而废 | 单次只完成一个明确目标并闭环验证 |

### Git 安全检查（推送前必做）

```bash
# 1. 检查大文件（>100MB 会阻塞推送）
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1 == "blob" && $3 > 104857600 {print $3, $4}'

# 2. 检查与 main 的共同祖先
git merge-base main HEAD || echo "WARNING: no common ancestor"

# 3. 扫描冲突标记
grep -rn '<<<<<<< \|=======$\|>>>>>>>' BACKLOG.md PROGRESS.md
```

### 破坏性操作（项目特有红线）

删除插件/集成、修改 `rateLimiter.ts` 或 `security.ts` 前，必须列出影响范围并获得用户确认。

### 强制 Pre-flight Checklist（每次任务启动前逐条执行，不可跳过）

| # | 检查项 | 命令/动作 | 触发条件 |
|---|--------|----------|---------|
| 1 | 搜索已有实现 | `grep -r "关键词" src/ server/src/` | 写任何新代码前 |
| 2 | 搜索已有数据 | `find 数据管理/ -name "*.json" -o -name "*.parquet"` | 涉及数据源时 |
| 3 | API 端点验证 | `curl -s -w '%{http_code}' http://localhost:3000/api/[路由]` | 声称功能“已完成”前 |
| 4 | 破坏性影响清单 | 列出将删除/修改的文件，等待确认 | 删除文件/模块/插件前 |
| 5 | 大文件检查 | `git rev-list --objects --all | ...` | 任意 `git push` 前 |
| 6 | 冲突标记扫描 | `grep -rn '<<<<<<< \|=======$\|>>>>>>>' BACKLOG.md PROGRESS.md` | 任意 `git push` / PR 前 |
| 7 | 治理校验 | `bun run governance` | 任意 `git push` / PR 前 |

**执行规则**：任一项跳过即视为任务未完成；检查结果必须在输出中可见。

### 0.1 方法确认协议（防止方向性错误）

遇到以下关键词时，必须先确认再实现：

| 触发关键词 | 必须确认的问题 | 确认方式 |
|-----------|--------------|---------|
| “下钻 / drill-down / 层级” | 是层级面包屑还是扁平筛选？ | 先问用户 |
| “已集成 / 已可用 / 已完成” | 是否有真实 API / 浏览器证据？ | 执行验证命令 |
| “不存在 / 没有数据 / 缺少” | 是否已全库搜索？ | `grep -r` + `find` |
| “安全加固 / 重构 / 清理” | 将删除或修改哪些文件？ | 列清单并等待确认 |
| “commit / push / PR” | - | 直接执行命令，禁止输出规划文档 |
| “全部检查 / 逐个验证” | - | 必须并行执行，不得串行替代 |

### 0.2 基于最近 20 次提交的反思加固（2026-02-27）

样本范围：`git log -20`（`a8f9863` → `df5b96b`）

**观察结论**：
- 高频热点集中在 `src/shared/api/client.ts`、`server/src/routes/query.ts`、`CrossSellOrgTrend*`，接口与趋势图联动是回归高发区。
- 权限改动出现“二次补丁链”，说明过滤注入容易遗漏。
- 替换式重构曾出现大规模回滚，证明“先删后证”风险极高。
- `docs` / `BACKLOG` 标题混入业务代码，降低审计与回溯效率。
- 调试产物进入版本库，会稀释评审焦点。

**新增硬规则**：
1. 权限/角色变更必须同时检查 `server/src/routes/query.ts` 与 `server/src/routes/ai.ts`，并补至少 1 个相关测试。
2. 替换式重构必须“并行保底 + 等价验证”后再删除旧实现。
3. `docs` / `BACKLOG` 类提交不得混入业务代码；如必须同日完成，应拆分提交。
4. 提交前执行调试产物清理检查。
5. 高频热点文件优先复用已有 helper 与 contract tests，禁止复制同类逻辑。

```bash
git diff --cached --name-only | rg "(^|/)(test_output|vitest_log|.*\\.log)$" && echo "BLOCK: remove debug artifacts" || true
```

### 0.3 生产完成定义与发布硬门禁（2026-03-20）

**适用触发词**：`已部署` / `生产可用` / `VPS可用` / `merge后上线` / `访问正常`

**硬规则 1：生产完成定义（缺一不可）**
只有同时满足以下 5 项，才允许声称“已部署可用”：
1. `GET https://chexian.cretvalu.com/` 返回 `200`
2. `GET https://chexian.cretvalu.com/health` 返回 `200`
3. `POST /api/auth/login` 返回 `200`
4. 至少一个核心业务 API 返回 `200` + 非空 JSON，例如 `GET /api/query/kpi?...`
5. 至少一个真实浏览器场景通过，确认目标页面与核心接口均正常

**硬规则 2：最终 SHA 发布规则**
- 发布期间若发生 `commit` / `push` / `rebase` / `merge`，必须基于最终远端 HEAD 重新完整发布一次。
- 禁止用“之前已部署过本地版本”替代最终 merge 版本的重新发布。

**硬规则 3：发布脚本健康检查规则**
- VPS 发布脚本禁止仅依赖固定 `sleep N` 判断服务可用。
- 必须使用“轮询重试 + 超时退出”检查 `health` 或等价端点，覆盖 DuckDB 冷启动和 PM2 重启竞争窗口。

**硬规则 4：证据分级**
- 本地绿灯：`governance` / 全量测试 / `typecheck` / `server build`
- 服务绿灯：`/` 与 `/health`
- 业务绿灯：登录 + 至少一个核心业务 API
- 页面绿灯：至少一个真实浏览器场景

**执行要求**：输出中必须出现上述四级证据，任一级缺失都不得写“生产可用”。

---

## 📖 快速导航

| 我想... | 查看章节 |
|--------|---------|
| 遵守行为红线 | [§0](#0-ai-行为红线zero-tolerance---违反即失败) |
| 开始新任务 | [§1](#1-必经入口每次任务开始前必读) |
| 看项目护栏 | [§2](#2-护栏red-line---禁止擅自修改) |
| 避免重复造轮子 | [§3](#3-实现前检查协议防止重复造轮子) |
| 启动和排查 API | [§4](#4-api-架构与启动) |
| 遵守 UI 设计系统 | [§5](#5-设计系统规范-dc-003) |
| 完成交付并验收 | [§6](#6-交付与验证协议) |
| 使用协作工具 | [§7](#7-协作工具箱) |
| 处理异常/阻塞 | [§8](#8-异常情况处理) |
| 避免多 Agent 冲突 | [§9](#9-多-agent-并发协作协议) |
| 做生产部署/数据同步 | [§10](#10-生产部署与数据同步) |

---

## 1. 必经入口（每次任务开始前必读）

### 智能加载（按任务复杂度选择阅读深度）

| 任务类型 | 特征关键词 | 必读章节 | 可跳过 |
|---------|-----------|---------|-------|
| 简单 | 修复、改、调整、查看 | §0-3 | §4-10 |
| 中等 | 新增、实现、开发、重构 | §0-6、§8-10 | §7 |
| 复杂 | 架构、设计、协作、CI/CD | 全部 | 无 |

### 核心索引

- [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md)
- [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md)
- [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md)
- [开发文档/00_index/PROGRESS_INDEX.md](./开发文档/00_index/PROGRESS_INDEX.md)
- [.claude/plans/STATUS_SNAPSHOT.md](./.claude/plans/STATUS_SNAPSHOT.md)

### 强制前置文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- [开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)
- [开发文档/缺口清单.md](./开发文档/缺口清单.md)
- [数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md)

### 缺口清单工作流

发现信息缺口 → 登记到 [开发文档/缺口清单.md](./开发文档/缺口清单.md) → 当前任务标记 `BLOCKED` → 用户补充信息后再恢复。核心原则：**没有完备信息 = 不能开始开发**。

### 两本账（唯一真理来源）

1. [BACKLOG.md](./BACKLOG.md)：需求账本
2. [PROGRESS.md](./PROGRESS.md)：进展账本

### 数据知识协议

数据处理任务必读：[.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)

- 唯一事实源：[数据管理/knowledge/rules/车险数据业务规则字典.md](./数据管理/knowledge/rules/车险数据业务规则字典.md)
- 快速参考：[数据管理/knowledge/QUICK_REFERENCE.md](./数据管理/knowledge/QUICK_REFERENCE.md)

---

## 2. 护栏（RED LINE - 禁止擅自修改）

### 业务口径定义（只能追加，不得删改已有语义）

- `server/src/normalize/mapping.ts`
- `server/src/sql/kpi.ts`
- `server/src/services/duckdb.ts`
- `server/src/routes/query.ts`

### 架构协议

- 纯 API 模式，禁止新增 DuckDB-WASM / Local DuckDB 分支逻辑。
- `/api/*` 必须经过 `server/src/middleware/auth.ts`。
- `server/src/routes/query.ts` 不得删除既有路由，只允许追加并保持向后兼容。
- `src/shared/contexts/DataContext.tsx` 中 `dataSource='api'` 语义不可破坏。
- 默认使用 **Bun**，禁止 npm/yarn/pnpm。
- `server/src/middleware/rateLimiter.ts` 的限流语义不得降低。
- `server/src/utils/security.ts` 文件名/路径/表名校验不得绕开。

### VPS 分层数据架构（CRITICAL）

**黄金规则**：新增功能必须建立或复用预聚合表，禁止在 VPS 上直接查询原始 `PolicyFact`（续保除外）。

| 场景 | 正确做法 | 禁止做法 |
|------|---------|----------|
| 新增仪表盘 / 趋势 | 查 `DailyAggregated` / `PeriodAggregated` / `CrossSellDailyAgg` / `KpiDailySummary` | 直接扫 `PolicyFact` |
| 增加新维度 | 本地扩展聚合表 → `scripts/export-for-vps.mjs` 导出 → 推送 VPS | 在 VPS 重建聚合 |
| 数据同步 | 仅推 `aggregated.parquet` + `renewal_slim.parquet` | 推送原始全量 Parquet |
| 续保查询 | 仅访问冻结的 8 个字段 | 引入更多 `PolicyFact` 字段 |

**续保最小字段集**：
`policy_no`, `premium`, `salesman_name`, `org_level_3`, `customer_category`, `insurance_type`, `insurance_start_date`, `renewal_policy_no`

---

## 3. 实现前检查协议（防止重复造轮子）

### 三问原则

| 问题 | 检查方式 |
|------|----------|
| 已有吗？ | 查 `CODE_INDEX.md` 与对应模块 `INDEX.md` |
| 能复用吗？ | 查 `src/shared/`、`server/src/utils/` |
| 有模式吗？ | 查同类实现、同类 SQL 生成器或页面 |

### 组件 / 工具注册表

| 类别 | 位置 |
|------|------|
| UI 组件 | `src/widgets/INDEX.md` |
| 样式系统 | `src/shared/styles/index.ts` |
| API 客户端 | `src/shared/api/client.ts` |
| SQL 生成器 | `server/src/sql/` |
| 格式化函数 | `src/shared/utils/formatters.ts` |

### 基本规范

```typescript
// ✅ 样式
import { tableStyles, textStyles, colorClasses } from '@/shared/styles';

// ✅ 格式化
import { formatCount, formatPercent, formatPremiumWan } from '@/shared/utils/formatters';

// ❌ 禁止
// className="text-red-800 bg-blue-50"
// (premium / 10000).toFixed(2)
```

违规判定：
- 已有能力重复实现
- 硬编码 Tailwind 通用颜色/布局类
- 新增通用组件或脚本但未登记 `INDEX.md`

---

## 4. API 架构与启动

### 数据流

```text
用户登录 → JWT Token → DataContext.isDataLoaded = true
    ↓
前端 Hook → apiClient.* → /api/*
    ↓
server/src/routes/*.ts → server/src/sql/*.ts → server/src/services/duckdb.ts
    ↓
DuckDB 执行查询 → JSON 响应 → 前端渲染
```

### 启动命令

```bash
bun run dev:full    # 推荐：一键启动前后端
```

禁止只运行 `bun run dev` 后直接排查“暂无数据”问题。

### 核心入口

- 前端：`src/app/main.tsx`、`src/app/App.tsx`
- 状态源：`src/shared/contexts/DataContext.tsx`
- API 客户端：`src/shared/api/client.ts`
- 后端：`server/src/app.ts`
- 查询路由：`server/src/routes/query.ts`
- 查询执行：`server/src/services/duckdb.ts`

### “暂无数据”排查顺序

1. Token 是否存在
2. 后端 3000 端口是否启动
3. 当前是否已加载数据文件
4. `/api/*` 是否返回 200
5. `isDataLoaded` 是否为 `true`

---

## 5. 设计系统规范 (DC-003)

所有 UI 开发必须复用 `src/shared/styles/index.ts`，严禁手写离散 Tailwind 颜色和虚构类名。

### 强制规则

- KPI 大数字使用 `fontStyles.kpi`
- 图表数字使用 `fontStyles.chart`
- 表格数字使用 `fontStyles.tabular`
- 动态趋势颜色使用 `getTrendColorClass(value)`
- 卡片/按钮优先复用 `cardStyles`、`buttonStyles` 或 `src/shared/ui/*`

### 明确禁止

- `className="font-kpi text-xl"` 这类未注册类名
- `text-red-500`、`bg-blue-50` 这类直接硬编码语义色
- 重新拼装通用卡片/按钮基础样式

---

## 6. 交付与验证协议

### BACKLOG 工作流

1. 新任务先登记到 `BACKLOG.md`
2. 开发前置为 `IN_PROGRESS`
3. 完成后置为 `DONE`
4. `DONE` 必须补全关联文档、关联代码、验收/证据

### DONE 判定

- 关联文档已填写，无则 `N/A`
- 关联代码已填写，纯文档则 `N/A`
- 验收/证据至少一项：测试报告、命令结果、截图、PR、commit

### 强制验证

1. 单元测试：`bun run test`
2. 浏览器实测：Network / Console 或真实页面交互
3. 用户验收：按需求场景人工确认

### 自动化验证基线

| 场景 | 最低要求 |
|------|---------|
| 修改 SQL / 路由 | 至少一个真实 API 返回 `200` + 非空 JSON |
| 修改前端组件 | `bun run build` 通过 |
| 任意提交 / PR 前 | `bun run governance` 通过 |
| 声称完成 | 输出里必须出现关键验证结果 |

禁止“只自检不修复”或“请用户自行验证”替代执行。

### 生产发布额外门禁

- 声称“网站访问正常/线上恢复”前，必须额外展示 `/`、`/health`、登录、至少一个核心业务 API、至少一个真实浏览器场景这 5 项证据。
- 若中途发生新的 `commit/push/rebase/merge`，必须以最终远端 HEAD 重新执行发布与验收，不得复用旧部署证据。

---

## 7. 协作工具箱

项目已集成 `.claude/` 下的命令与子代理，可用于辅助验证和协作。

### 常用命令

- `.claude/commands/README.md`
- `/commit-push-pr`
- `/sync-and-rebase`
- `/data-analysis`
- `/security-review`
- `/verify`

### 常用子代理

- `code-simplifier`
- `data-validator`
- `verify-app`
- `session-manager`

### 数据准备

- 示例数据位置：`数据管理/`
- 优先使用真实 Parquet / JSON 数据，不要靠伪造数据声称完成

---

## 8. 异常情况处理

| 情况 | 处理方式 |
|------|----------|
| 信息缺口 | 登记 `开发文档/缺口清单.md`，任务转 `BLOCKED` |
| 业务口径错误 | 禁止直接改，先在 `BACKLOG.md` 建 `BLOCKED` 任务并标注“需产品确认” |
| API 调用失败 | 先核对 `apiClient` 与后端路由是否一一对应，再查认证与权限注入 |
| SQL 语法不确定 | 先查 [DuckDB 官方文档](https://duckdb.org/docs/)，禁止猜测 |
| 启动异常 | 先跑 `bun run dev:full`，再按端口占用和脚本输出处理 |
| 生产环境无数据 | 先查 `/api/data/files` 与文件名校验逻辑 |

---

## 9. 多 Agent 并发协作协议

> 详细背景见：[开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md](./开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md)

### 9.1 文档写入分区

| 文档 | 写入权限 | 读取权限 | 冲突策略 |
|------|---------|---------|---------|
| `BACKLOG.md` | 所有 Agent | 所有 Agent | 使用 `merge-backlog.mjs` 合并 |
| `CLAUDE.md` 公共区 | `@user` | 所有 Agent | 只读 |
| `PROGRESS.md` | 所有 Agent | 所有 Agent | 追加 + 时间戳 + Agent 标识 |
| 索引文件 | 所有 Agent | 所有 Agent | 分区写入 |

### 9.2 任务 ID 规则

- `@user`：B001-B099
- `@claude`：B100-B199
- `@codex`：B200-B299
- `@gemini`：B300-B399
- 未来扩展：B400+

### 9.3 并行执行触发规则

满足以下任一条件时，必须并行执行：

| 触发条件 | 示例 |
|---------|------|
| 3+ 独立文件/模块检查 | “把 8 个页面都检查一遍” |
| 用户要求“全部/逐个/每个/所有” | “逐个验证接口” |
| 多表 / 多字段数据验证 | 验证 30 个字段映射 |
| 互不依赖的前后端任务 | 前端修复 + 后端修复 |

### 9.4 索引文件分区示例

```markdown
## 核心协议（@user专属，Agent只读）
- CLAUDE.md
- AGENTS.md
- GEMINI.md

<!-- @claude-section-start -->
## Claude工作区索引（@claude专属写入）
- 开发文档/TECH_STACK.md
<!-- @claude-section-end -->

<!-- @codex-section-start -->
## Codex工作区索引（@codex专属写入）
- .claude/plans/*.md
<!-- @codex-section-end -->
```

规则：
- 只能在自己的 section 内修改
- 禁止删除其他 section 内容
- 新增 section 前先通知 `@user`

### 9.5 PR 前强制检查

```bash
git fetch origin main
git rebase origin/main
bun run scripts/check-write-conflict.mjs
bun run governance
```

### 9.6 紧急冲突处理

发现冲突时：
1. 禁止直接 force push 解决
2. 在 `BACKLOG.md` 新增 `BLOCKED` 任务说明原因
3. 通知 `@user`
4. 使用 `scripts/merge-backlog.mjs` 合并
5. 手动复核其他冲突文件

---

## 10. 生产部署与数据同步

### 生产环境

| 项目 | 值 |
|------|-----|
| 服务器 | 腾讯云轻量 2核4G（`162.14.113.44`） |
| 域名 | `https://chexian.cretvalu.com` |
| 后端 | PM2 → `chexian-api`（端口 3000） |
| 前端 | Nginx 静态文件（`/var/www/chexian/frontend/dist`） |

### SSH 连接前提

本地 `~/.ssh/config` 必须包含：

```sshconfig
Host chexian-vps-deploy
    HostName 162.14.113.44
    User deployer
    IdentityFile ~/.ssh/chexian_deploy
    ServerAliveInterval 60
```

验证：

```bash
ssh chexian-vps-deploy echo ok
```

### 数据更新全链路

```bash
./数据管理/run.sh full \
  --source 历史数据.xlsx \
  --target 最新数据.xlsx \
  --output 数据管理/warehouse/fact/policy/车险保单综合明细表MMDD.parquet

./scripts/sync-vps.mjs
./scripts/sync-vps.mjs 文件名.parquet
```

### 热力图发布 / 验收入口

```bash
bun run release:vps:heatmap
bun run verify:vps:heatmap
```

唯一流程文档：[开发文档/VPS_HEATMAP_RELEASE_SOP.md](./开发文档/VPS_HEATMAP_RELEASE_SOP.md)

### 常见 SSH 故障

| 现象 | 原因 | 修复 |
|------|------|------|
| `Could not resolve hostname` | 未配置 `~/.ssh/config` 别名 | 补充 Host 配置 |
| `Permission denied (publickey)` | 私钥不匹配或公钥未授权 | 检查 `~/.ssh/chexian_deploy` 与 VPS `authorized_keys` |
| 上传后健康检查失败 | PM2 重启竞争或后端异常 | 登录 VPS 查看 `deploy-chexian-api logs` |

### 相关文件

- `scripts/sync-vps.mjs`
- `数据管理/run.sh`
- `deploy/vps-deploy.mjs`
- `DEPLOYMENT_GUIDE.md`
- `vps.md`

---

**变更历史**：
- 2026-03-15：基于最新 `CLAUDE.md` 重构公共治理基线，新增 pre-flight、方法确认协议、API-only 启动与 DC-003 细则，并收敛 Gemini 专属并发协作与部署约束
- 2026-02-27：新增最近 20 次提交反思加固，补充权限过滤漏检、替换式重构与调试产物入库防回归规则
- 2026-02-15：新增生产部署与数据同步章节
- 2026-01-11：新增多 Agent 并发协作协议，解决批量 PR merge 冲突
