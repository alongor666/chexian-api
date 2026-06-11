---
name: chexian-bug-hunt
description: 全项目并行 bug 排查 — 4 路并行域审计（后端服务层 / SQL 生成器 / 前端+SW / 脚本ETL），证据化分级清单（高影响/口径裁决/其他），按红线区分"可直接修"与"需口径裁决"。Use when 用户说"找 bug / 排查 bug / 全项目审计 / bug hunt / 找项目缺陷"，或要在大改动前做一次系统性缺陷扫描时。
version: 1.0.0
user_invocable: true
---

# 全项目并行 Bug 排查（chexian-bug-hunt）

> 来源：2026-06-11 一次全项目 bug 排查（PR #588 修 4 项 + PR #590 修 7 项 + 45 项登记 BACKLOG）沉淀。把"凭直觉东翻西找"换成"4 路并行域审计 → 证据化分级 → 红线感知处置"的可复跑流程。

## 何时用

- 用户说"找 bug / 排查项目缺陷 / 全项目审计 / bug hunt"
- 大重构 / 发版前想做一次系统性缺陷扫描
- 不是定位某个具体已知 bug（那走 `investigate` skill 的四阶段 debug）

## 0. 红线（先读，决定哪些能修）

| 约束 | 含义 |
|------|------|
| **业务口径禁直接改**（CLAUDE.md §7 / §10） | 满期赔付率/出险率分母/推介率分母/件数口径(`COUNT(*)` vs `COUNT(DISTINCT policy_no)`)/达成率锚点 等**口径类**问题，禁止 AI 自行改，**只登 BACKLOG 标 `[口径裁决]`**，等用户定口径。改错口径 = 业务方拿错误数据决策。 |
| **修补不拆除** | 安全加固只补不删整模块。 |
| **源数据验证** | 改 SQL 生成器后必须 Parquet 直查与 API 对比（红线 §6）。无数据环境下 **RLS 注入/口径 SQL 不盲改**，登 BACKLOG。 |
| **先搜再写** | 修复前 `grep` 确认现有实现与调用方。 |

**可直接修 vs 必须登记**：
- ✅ 可直接修：崩溃（Binder/Parser Error 500）、安全漏洞（越权/注入）、前端逻辑错误（null→0、竞态、缓存残留、Context 未挂载）、shell 注入、明确的数据丢失逻辑。
- 🟡 必须登记待裁决：任何改变**指标数值口径**的（分子分母定义、去重粒度、时间锚点、阈值）。
- ⚠️ 需数据验证才改：SQL 生成器里 RLS 注入、JOIN fan-out、满期口径——本机无 Parquet 时只登记。

## 1. 流程

### Step 1 — 基线自检（并行）
```bash
bun install && bun run build        # 类型检查+构建必须先绿
bun run governance                   # 29 项治理基线
```
同时并行启动 4 路审计 sub-agent（**一条消息多个 Agent 调用**，general-purpose 类型，run_in_background）。

### Step 2 — 4 路并行域审计

每个 agent 的 prompt 模板（按域替换范围与重点）：

> 你是资深代码审计员，在 /home/user/chexian-api 找**真实 bug**（非风格）。负责范围：`<域>`。重点排查：`<域专属清单>`。方法：通读关键文件 + 交叉验证调用方。每个发现给 **file:line + 问题 + 触发场景 + 置信度(高/中/低)**，只报有具体证据的。不要改文件。输出按置信度排序的中文清单。

| 域 | 范围 | 专属重点 |
|----|------|---------|
| **后端服务层** | `server/src/` 除 `sql/` | 认证/权限(越权·fail-open·PAT 只读绕过·`readonlyMiddleware` 挂载缺口)、缓存键缺维度串读、连接池竞态、zod 校验缺口、错误处理 |
| **SQL 生成器** | `server/src/sql/` + `metric-registry/` | RLS/permissionFilter 遗漏注入、口径不一致(对基准 `cost/cost-ratios.ts`)、除零/NULL、JOIN fan-out 重复计数、参数拼接 Binder/Parser Error、件数口径 |
| **前端+SW** | `src/` + `public/sw.js` | hook 依赖/stale closure/竞态(乱序覆盖)、SW 缓存策略与版本检测、apiClient token 刷新竞态、Context 定义但未挂载、登出不清缓存、null→0、ECharts 泄漏 |
| **脚本+ETL** | `scripts/` + `数据管理/`(ETL) + `cli/` `mcp/` | glob 误删、ETL 字段映射/精度/去重/增量漏判、`execSync` shell 注入、错误被吞、backlog 折叠/LWW |

### Step 3 — 实证复现高置信度项
SQL 类用 `@duckdb/node-api` 内存库或 `duckdb` CLI 实证；后端/前端用 grep + 读源码交叉验证（如确认 `readonlyMiddleware` 挂载点、Provider 树是否挂某 Context）。

### Step 4 — 分级处置
1. **全部确证发现登 BACKLOG**（见 §2 批量脚本），口径类标 `[口径裁决]` + 对应 priority。
2. **可直接修的**：开分支修 → 类型检查 + governance + 针对性单测 → 提交。
3. **需裁决/需数据验证的**：留 BACKLOG（P1/P2），PR 描述列"未修复/待裁决"清单。

### Step 5 — 验证（声称完成前必做）
```bash
bunx tsc --noEmit && bunx tsc --noEmit -p server/tsconfig.json   # 前后端零报错
bun run governance                                                # 29/29
CI=true bunx vitest run <受影响测试>                              # 针对性单测
CI=true bunx vitest run                                           # 全量（改动激活沉睡逻辑时必跑）
```

## 2. BACKLOG 批量登记

唯一写路径（event-log，写入方永不挑号，详见 `.claude/rules/backlog-eventlog.md`）：
```bash
bun scripts/backlog.mjs add --actor @claude --priority P1 --section "Security/Backend" \
  --desc "<现象+file:line+触发场景>" --code "<逗号分隔文件清单>"
```
- section 取值参考现有：`Bugfix/Backend` `Bugfix/Frontend` `Security/Backend` `指标口径` `数据质量` `Infra/Deploy` 等。
- 多条用 bash 循环脚本一次性灌（见来源会话 `/tmp/backlog-batch.sh` 模式）。
- 完成项：`bun scripts/backlog.mjs status <uid> DONE --evidence "PR #..."`。

## 3. 真实战果样例（2026-06-11，可直接修的类型）

- **PAT 只读越权**：`readonlyMiddleware` 挂 8 router 漏 `/api/auth` `/api/admin` → 6 写端点补挂。
- **前端 RBAC 整层失效**：`AuthProvider` 定义但从未挂载，`useRBAC` 读空 → 改读已挂载的 `PermissionContext`。
- **登出不清缓存跨用户残留**：`auth-logout` 事件补 `queryClient.clear()` + SW `FORCE_REFRESH`。
- **2 处 SQL 必炸 500**：`marketing-report` 漏 `.replaceAll('tm.',..)`、`premiumPlan` GROUP BY 塞带别名片段。
- **pivot L4/异源指标 500**：补"pivot 安全指标"白名单守卫（拒 `--` 占位 + 非 PolicyFact 列）。
- **getToken 自毁刷新通道 + 并发 401 无互斥**：过期保留 cookie hint + 共享 refreshPromise。
- **govern­ance 文件名 shell 注入**：`execSync(\`...\${f}\`)` → `execFileSync('git',[...,f])`。

## 4. 反模式

- ❌ 串行翻文件找 bug（必须 4 路并行 sub-agent）。
- ❌ 把口径类问题"顺手改了"（红线 §7，必登记待裁决）。
- ❌ 无 Parquet 环境盲改 SQL 生成器的 RLS/口径（假安全或 500）。
- ❌ 声称修完未跑 tsc+governance+单测。

## 关联
- 红线：CLAUDE.md §0/§6/§7/§10 · `.claude/rules/business-domain.md` · `.claude/rules/sql-generators.md`
- BACKLOG 模型：`.claude/rules/backlog-eventlog.md`
- 定向 debug（已知单个 bug）走全局 `investigate` skill；本 skill 是"广度扫描"。
