# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。React + TypeScript + Vite + ECharts，后端 Express + DuckDB。生产环境 `https://chexian.cretvalu.com`。

---

## 0. AI 行为红线（ZERO TOLERANCE）

> 36 个会话、319 条消息的 Insights 分析。每条规则对应至少 2 次返工事件。

### 执行纪律

| 红线 | 反面教训 | 正确做法 |
|------|---------|---------|
| **执行不规划** | 用户要求 commit-push-PR，Claude 写了分析文档而非执行命令（3+ 次） | Git 操作（commit/push/PR）直接执行命令，零分析零摘要 |
| **先搜再写** | Claude 假设"团队数据不存在"并删除了团队维度，实际数据在 `salesman_organization_mapping.json`（1 次） | 写代码前 `grep/glob` 搜索整个项目，禁止假设"不存在" |
| **验证不声称** | Claude 声称 8 个仪表盘模块"已集成 API"，实际零个能用（1 次） | 禁止声称功能"已可用"，必须通过真实 API 请求验证 |
| **修补不拆除** | 安全加固时删除整个企业微信插件，需手动恢复（1 次） | 安全加固/重构禁止删除整个模块/插件，只能修补漏洞 |
| **并行不串行** | 逐个串行检查 8 个模块，被用户打断要求并行（2+ 次） | 3+ 独立模块/任务必须用并行 sub-agents（Task 工具） |
| **层级不扁平** | 实现了扁平单维度筛选而非层级下钻（1 次） | 遇到"下钻"需求，确认交互模型：点击行→选维度→筛选+重组+面包屑 |
| **聚焦不发散** | 多任务并行导致会话半途而废，6 个会话仅部分完成 | 每次会话专注一个目标，完成并验证后再接下一个 |
| **交付不重构** | 数据更新任务变成 ETL 架构重构，前端和部署完全没碰 | 先跑通端到端交付（数据→前端→部署），再优化流程 |
| **能并行就并行** | 可并行的任务串行执行浪费时间 | 无依赖关系的任务并行执行；有依赖的按顺序执行 |

### Git 安全检查（推送前必做）

```bash
# 1. 检查大文件（>100MB 阻塞推送）
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1 == "blob" && $3 > 104857600 {print $3, $4}'
# 2. 检查分支共同祖先（无共同祖先 → cherry-pick 策略）
git merge-base main HEAD || echo "WARNING: no common ancestor"
# 3. 发现大文件 → git-filter-repo/BFG 清理或配置 Git LFS
```

### 破坏性操作

删除插件/集成、修改 `rateLimiter.ts`/`security.ts` 安全配置前，必须列出影响范围并获得用户确认。

### 强制 Pre-flight Checklist（每次任务启动前逐条执行，不可跳过）

| # | 检查项 | 命令/动作 | 触发条件 |
|---|--------|----------|---------|
| 1 | **搜索已有实现** | `grep -r "关键词" src/ server/src/` | 写任何新代码前 |
| 2 | **搜索已有数据** | `find 数据管理/ -name "*.json" -o -name "*.parquet"` | 涉及数据源时 |
| 3 | **API 端点验证** | `curl -s -w '%{http_code}' http://localhost:3000/api/[路由]` | 声称功能"已完成"前 |
| 4 | **破坏性影响清单** | 列出将删除/修改的所有文件 → 等待用户确认 | 删除文件/模块/插件前 |
| 5 | **大文件检查** | `git rev-list --objects --all \| ... \| awk '$3 > 104857600'` | 任何 `git push` 前 |
| 6 | **冲突标记扫描** | `grep -rn '<<<<<<< \|=======$\|>>>>>>>' BACKLOG.md PROGRESS.md` | 任何 `git push` 前 |
| 7 | **治理校验** | `bun run governance` | 任何 `git push` / PR 前 |

跳过任何一条 → 该任务视为未完成。每条检查结果必须在输出中可见。

### §0.1 方法确认协议

| 触发关键词 | 必须确认的问题 | 确认方式 |
|-----------|--------------|---------|
| "下钻/drill-down/层级" | 交互模型：层级面包屑 vs 扁平筛选？ | 问用户 |
| "已集成/已可用/已完成" | 通过 `curl` 或实际 API 调用证明 | 执行验证命令 |
| "不存在/没有数据/缺少" | 先 `grep -r` + `find` 搜索整个项目 | 搜索后再下结论 |
| "安全加固/重构/清理" | 列出将删除/修改的文件清单 | 等待用户确认 |
| "commit/push/PR" | — | 直接执行命令，禁止输出分析/规划文档 |
| "全部检查/逐个验证" | — | 使用并行 sub-agents（Task 工具），禁止串行 |

未经确认就实现 → 立即停止 → 回退到确认步骤。

---

## 1. 核心索引与入口

| 索引 | 路径 |
|------|------|
| 文档索引 | [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md) |
| 代码索引 | [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md) |
| 数据索引 | [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md) |
| 进展索引 | [开发文档/00_index/PROGRESS_INDEX.md](./开发文档/00_index/PROGRESS_INDEX.md) |
| Plans 快照 | [.claude/plans/STATUS_SNAPSHOT.md](./.claude/plans/STATUS_SNAPSHOT.md) |

**强制前置文档**：[ARCHITECTURE.md](./ARCHITECTURE.md) | [TECH_STACK.md](./开发文档/TECH_STACK.md) | [DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md) | [PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md) | [缺口清单](./开发文档/缺口清单.md)

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求） | [PROGRESS.md](./PROGRESS.md)（进展）

**数据知识协议**：[.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md) — 唯一事实源：[车险数据业务规则字典](./数据管理/knowledge/rules/车险数据业务规则字典.md)

**缺口清单工作流**：发现信息缺口 → 登记缺口清单（DISCOVERED）→ 任务 BLOCKED → 用户提供信息后验证 → COMPLETED。没有完备信息 = 不能开始开发。

---

## 2. 护栏（RED LINE）

### 业务口径定义

| 文件 | 规则 |
|------|------|
| `server/src/services/duckdb.ts` | 不得修改已有查询逻辑，只能追加新查询，需 BACKLOG.md 登记+证据 |
| `server/src/routes/query.ts` | 不得删除已有路由，只能追加新路由，需 BACKLOG.md 登记 |

### 架构协议

- **Bun 包管理器**：禁止 npm/yarn/pnpm
- **智谱 API**：`https://open.bigmodel.cn/api/paas/v4`（glm-4.7-flash）
- **API 限流**：三级限流（通用100/min、登录5/min、查询200/min），禁止降低
- **JWT 认证**：所有 `/api/*` 必须经过认证中间件，禁止绕过

### VPS 黄金规则

**禁止在 VPS 上查询原始 `PolicyFact` 构建新功能**（续保除外） → 完整规则见 [.claude/rules/data-pipeline.md](.claude/rules/data-pipeline.md)

---

## 3. 实现前检查（三问原则）

| 问题 | 检查方式 |
|------|----------|
| **已有吗？** | 查 CODE_INDEX.md + `src/widgets/INDEX.md` |
| **能复用吗？** | 查 `src/shared/`（api/styles/utils/types） |
| **有模式吗？** | 查同类实现代码（如 `EarnedPremiumTable.tsx`） |

组件/工具注册表详情 → [.claude/rules/shared-modules.md](.claude/rules/shared-modules.md) | 样式规范 → [.claude/rules/frontend.md](.claude/rules/frontend.md)

---

## 4. API 架构与启动

```bash
bun run dev:full    # 一键启动前后端（推荐）
# 禁止只运行 bun run dev（仅前端，后端不可用）
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/shared/contexts/DataContext.tsx` | isDataLoaded 唯一来源，固定 dataSource='api' |
| `src/shared/contexts/AuthContext.tsx` | JWT Token、登录/登出 |
| `src/shared/api/client.ts` | 所有后端请求统一入口 |
| `server/src/services/duckdb.ts` | DuckDB 查询执行 |
| `server/src/routes/query.ts` | API 端点 |
| `server/src/sql/` | SQL 生成器（16 个模块） |

### API 端点清单

`/api/query/*`（KPI/趋势/排名/成本/系数/续保/交叉销售） | `/api/data/*`（文件） | `/api/ai/*`（NL2SQL） | `/api/auth/*`（认证） | `/api/filters/*`（筛选器）

### 排查清单（"暂无数据"时）

`localStorage.getItem('auth_token')` 非空 → 后端日志 "Server is running" → 网络面板 200 OK → DataContext `isDataLoaded = true`

---

## 5. 技术栈

**核心**：React + TypeScript + Vite + 后端 DuckDB + ECharts | **包管理器**：Bun | **详细**：[TECH_STACK.md](./开发文档/TECH_STACK.md)

```bash
bun install         # 安装依赖
bun run dev:full    # 一键启动前后端
bun run build       # 类型检查 + 生产构建
bun run test        # 单元测试（不是 bun test）
bun run governance  # 治理校验
```

---

## 6. 验证协议（禁止自我安慰式开发）

| 场景 | 验证命令（必须执行并贴出结果） |
|------|------------------------------|
| 修改 SQL | `curl -s http://localhost:3000/api/query/kpi \| jq '.data \| length'` — 确认返回非空数据 |
| 修改 API 路由 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/[路由]` — 确认 200 |
| 修改前端组件 | `bun run build` — 确认零 TS 报错 |
| 声称功能完成 | 至少一个 API 端点返回 `200` + 非空 JSON |
| Git 推送前 | `bun run governance && git diff --check` |
| SQL 报错 | 查字段类型定义 → 查 [DuckDB 官方文档](https://duckdb.org/docs/) |

**执行标准**：验证结果必须出现在输出中。声称功能完成但未贴出验证命令执行结果 → 视为未完成。

---

## 7. 交付协议

**DONE 判定**：关联文档（已填写或 N/A）+ 关联代码（已填写或 N/A）+ 验收/证据（PR/Commit/测试/截图至少一项）

**治理校验**：`bun run governance`（校验失败禁止提交）

---

## 8. 并行执行规则

**任务 ID 分配**：@user B001-B099 / @claude B100-B199 / @codex B200-B299 / @gemini B300-B399

| 触发条件 | 示例 |
|---------|------|
| 3+ 独立文件/模块检查或修改 | 检查 8 个仪表盘模块 API 状态 |
| 指令含"全部/逐个/每个/所有" | "全部检查一遍" |
| 2 个互不依赖的任务 | 修复前端 + 修复后端 |

满足条件但串行执行 → 用户有权打断并要求重做。

**PR 前强制检查**：`git fetch origin main && git rebase origin/main && bun run governance`

---

## 参考链接

| 主题 | 文档 |
|------|------|
| 数据处理链路 | [CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md) |
| CI/CD 与部署 | [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) / [vps.md](./vps.md) |
| 命令索引 | [.claude/commands/README.md](./.claude/commands/README.md)（30 个命令） |
| Subagents | `.claude/agents/*.md`（14 个） |
| 变更历史 | [CHANGELOG.md](./开发文档/CHANGELOG.md) |
| 专项规则 | `.claude/rules/`（6 个文件，按路径自动加载） |
