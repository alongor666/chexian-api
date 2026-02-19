# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。前端 React + TypeScript + Vite + ECharts，后端 Express + DuckDB。纯 REST API 模式，已上线生产环境 `https://chexian.cretvalu.com`。

---

## 0. AI 行为红线（ZERO TOLERANCE - 违反即失败）

> **来源**：36 个会话、319 条消息的 Insights 分析。18 次"方法错误"是头号摩擦源。以下规则从血泪教训中提炼，**每条都对应至少 2 次返工事件**。

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

### Git 安全检查（推送前必做）

```bash
# 1. 检查大文件（>100MB 阻塞推送）
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1 == "blob" && $3 > 104857600 {print $3, $4}'

# 2. 检查分支共同祖先（无共同祖先 → cherry-pick 策略）
git merge-base main HEAD || echo "WARNING: no common ancestor"

# 3. 发现大文件 → git-filter-repo/BFG 清理或配置 Git LFS
```

### 破坏性操作（项目特有红线）

删除插件/集成、修改 `rateLimiter.ts`/`security.ts` 安全配置前，必须列出影响范围并获得用户确认。

---

## 1. 必经入口（每次任务开始前必读）

### 智能加载（按任务复杂度选择阅读深度）

| 任务类型 | 特征关键词 | 必读章节 | 可跳过 |
|---------|-----------|---------|-------|
| 简单 | 修复、改、调整、查看 | §0-3 | §4-13 |
| 中等 | 新增、实现、开发、重构 | §0-5, §7-9 | §6, §10-13 |
| 复杂 | 架构、设计、协作、CI/CD | 全部 | 无 |

### 核心索引（5分钟快速定位）

| 索引 | 路径 | 内容 |
|------|------|------|
| 文档索引 | [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md) | 业务规则、架构文档、指标口径 |
| 代码索引 | [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md) | 核心模块、关键文件、禁止修改区域 |
| 数据索引 | [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md) | 字段定义、业务规则、分析场景 |
| 进展索引 | [开发文档/00_index/PROGRESS_INDEX.md](./开发文档/00_index/PROGRESS_INDEX.md) | 任务状态、证据链、接力入口 |
| Plans 快照 | [.claude/plans/STATUS_SNAPSHOT.md](./.claude/plans/STATUS_SNAPSHOT.md) | 计划完成度（先看快照避免全文搜索） |

### 强制前置文档

| 文档 | 何时必读 | 核心内容 |
|------|---------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 涉及数据管理/子项目 | 模块层级（L0→L1→L2）、依赖规则 |
| [开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md) | 所有开发任务 | 技术栈、架构入口、验证协议 |
| [开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md) | 所有代码/文档 | DC-001 数据三要素、禁止硬编码日期口径 |
| [数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md) | SQL/数据处理 | 30 字段完整定义、枚举值、查询模式 |
| [开发文档/缺口清单.md](./开发文档/缺口清单.md) | 规划/开发前 | 信息缺口追踪（没有完备信息 = 不能开发） |

### 缺口清单工作流

发现信息缺口 → 登记[缺口清单](./开发文档/缺口清单.md)（状态 DISCOVERED）→ 当前任务 BLOCKED → 用户提供信息后验证 → COMPLETED。**没有完备信息 = 不能开始开发**。常见缺口：业务规则缺失、数据格式未明确、计算口径未确认、示例数据缺失。

### 两本账（唯一真理来源）
1. **需求账本**: [BACKLOG.md](./BACKLOG.md) — 所有任务（PROPOSED → IN_PROGRESS → DONE）
2. **进展账本**: [PROGRESS.md](./PROGRESS.md) — 里程碑、阻塞、下一步行动

### 数据知识协议

⚠️ 数据处理任务必读: [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)

分层加载：简单任务仅加载快速参考(200tokens) → 中等加 业务规则(700tokens) → 复杂按需加载完整字典。唯一事实源：[数据管理/knowledge/rules/车险数据业务规则字典.md](./数据管理/knowledge/rules/车险数据业务规则字典.md)

---

## 2. 护栏（RED LINE - 禁止擅自修改）

### 业务口径定义

| 文件 | 规则 |
|------|------|
| `server/src/services/duckdb.ts` | ❌ 不得修改已有查询逻辑 ✅ 只能追加新查询 📝 需 BACKLOG.md 登记+证据 |
| `server/src/routes/query.ts` | ❌ 不得删除已有路由 ✅ 只能追加新路由 📝 需 BACKLOG.md 登记 |

### 架构协议

- **Bun 包管理器**：禁止 npm/yarn/pnpm
- **智谱 API**：`https://open.bigmodel.cn/api/paas/v4`（glm-4.7-flash）
- **API 限流**：`server/src/middleware/rateLimiter.ts` 三级限流（通用100/min、登录5/min、查询30/min），禁止降低
- **JWT 认证**：所有 `/api/*` 必须经过认证中间件，禁止绕过
- **文件名验证**：`server/src/utils/security.ts` 使用危险字符黑名单（非白名单），支持中文

---

## 3. 实现前检查协议（防止重复造轮子）

### 三问原则（写代码前必答）

| 问题 | 检查方式 |
|------|----------|
| **已有吗？** | 查 CODE_INDEX.md + `src/widgets/INDEX.md` |
| **能复用吗？** | 查 `src/shared/`（api/styles/utils/types） |
| **有模式吗？** | 查同类实现代码（如 `EarnedPremiumTable.tsx`） |

### 组件/工具注册表

| 类别 | 位置 | 说明 |
|------|------|------|
| UI组件 | `src/widgets/INDEX.md` | Table、Card、Badge、Button 等 |
| 样式系统 | `src/shared/styles/index.ts` | tableStyles、textStyles、buttonStyles、colorClasses |
| API客户端 | `src/shared/api/client.ts` | 所有后端请求统一入口 |
| 工具函数 | `src/shared/utils/formatters.ts` | 格式化（件数/均值/比率/保费/系数/图表） |
| 类型定义 | `src/shared/types/` | 通用+业务类型 |

### 样式与格式化规范

```typescript
// ✅ 样式：使用全局样式系统
import { tableStyles, textStyles, colorClasses } from '@/shared/styles';
// ❌ 禁止硬编码 className="text-red-800" / "bg-blue-600"

// ✅ 格式化：使用 formatters.ts
import { formatCount, formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
// ❌ 禁止 (premium / 10000).toFixed(2) 等硬编码格式化

// ✅ 数字字体：等宽对齐
<span className={textStyles.numeric}>{formatPremiumWan(premium)}</span>
```

**可用函数**：`formatCount`（件数）/ `formatAverage`（均值）/ `formatPercent`（百分比%）/ `formatPremiumWan`（保费万元）/ `formatCoefficient`（4位系数）/ `formatChartValue`（图表Y轴纯数字）

### 违规判定

| 违规 | 处理 |
|------|------|
| 新建函数但已存在同功能函数 | 删除，使用现有 |
| 硬编码 Tailwind 颜色/样式 | 重构为 `colorClasses` / `tableStyles` |
| 新增通用组件未在 INDEX.md 登记 | 补充登记后方可提交 |

---

## 4. API 架构与启动

> 纯 API 模式，前端所有数据来自后端 API。

### 数据流

```
用户登录 → JWT Token → DataContext.isDataLoaded = true
    ↓
前端 Hook → apiClient.getKpi(filters) → GET /api/query/kpi
    ↓
server/src/routes/query.ts → server/src/sql/*.ts → server/src/services/duckdb.ts
    ↓
DuckDB 执行查询 → JSON 响应 → 前端渲染
```

### 启动命令

```bash
bun run dev:full    # ✅ 一键启动前后端（推荐）
# ⚠️ 禁止只运行 bun run dev（仅前端，后端不可用）
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/shared/contexts/DataContext.tsx` | isDataLoaded 唯一来源，固定 dataSource='api' |
| `src/shared/contexts/AuthContext.tsx` | JWT Token、登录/登出 |
| `src/shared/api/client.ts` | 所有后端请求统一入口 |
| `server/src/services/duckdb.ts` | DuckDB 查询执行、PolicyFact + PolicyFactRenewal 视图 |
| `server/src/routes/query.ts` | API 端点（KPI/趋势/排名/成本/系数/续保/交叉销售） |
| `server/src/sql/` | SQL 生成器（16 个模块） |
| `server/src/utils/security.ts` | 文件名验证、路径验证、SQL表名验证 |
| `server/src/middleware/rateLimiter.ts` | 三级限流 |
| `server/src/middleware/audit.ts` | 审计日志 |

### API 端点清单

| 前缀 | 说明 |
|------|------|
| `/api/query/*` | KPI、趋势、排名、成本、系数、续保、交叉销售、自定义查询 |
| `/api/data/*` | 文件上传、列表、加载 |
| `/api/ai/*` | NL2SQL、智能分析 |
| `/api/auth/*` | 登录、Token 刷新 |
| `/api/filters/*` | 筛选器选项 |

### 排查清单（遇到"暂无数据"时）

| 检查项 | 预期值 |
|--------|--------|
| `localStorage.getItem('auth_token')` | 非空 |
| 后端终端日志 | "Server is running on http://localhost:3000" |
| 浏览器网络面板 | 200 OK，无 404/500 |
| Console 检查 DataContext | `isDataLoaded = true` |

### 防御性编码（项目特有陷阱）

`row.time_period` 可能为 undefined — 必须先 `?? ''` 再 `.includes()`。图表/表格组件中所有 DuckDB 返回字段都需空值防护。

---

## 5. 设计系统规范（UI 开发必遵守）

### 字体

| 场景 | CSS类 | 用途 |
|------|-------|------|
| KPI大数字 | `.font-kpi` | 仪表盘 KPI 卡片 |
| 图表数字 | `.font-chart-number` | ECharts 轴标签 |
| 表格数字 | `.font-tabular` | 表格数字列对齐 |

### 颜色（禁止硬编码 Tailwind 颜色类）

```typescript
import { colorClasses } from '@/shared/styles';
// text-red-800   → colorClasses.text.dangerDark
// text-green-600 → colorClasses.text.positive
// bg-red-50      → colorClasses.bg.danger
// bg-gray-50     → colorClasses.bg.neutral

import { getYearChartColor } from '@/shared/styles';
const color = getYearChartColor('2024');  // '#FF6B6B'
```

参考：[src/shared/styles/index.ts](src/shared/styles/index.ts)

---

## 6. 交付协议

### DONE 判定（缺一不可）
- ✅ 关联文档：已填写（无则 `N/A`）
- ✅ 关联代码：已填写（纯文档则 `N/A`）
- ✅ 验收/证据：PR链接/Commit哈希/测试报告/截图（至少一项）

### 核心层改动同步
修改 `src/shared/` / `src/features/` / `src/widgets/` / `scripts/` 时，必须更新对应 `INDEX.md`。

### 治理校验（提交前必跑）
```bash
bun run scripts/check-governance.mjs   # 校验失败禁止提交
```

---

## 7. 技术栈

**核心**：React + TypeScript + Vite + 后端 DuckDB + ECharts
**包管理器**：Bun（禁止 npm/yarn/pnpm）
**详细版本**：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)

```bash
bun install         # 安装依赖
bun run dev:full    # 一键启动前后端
bun run build       # 类型检查 + 生产构建
bun run test        # 单元测试（⚠️ 不是 bun test）
bun run governance  # 治理校验
```

---

## 8. 数据处理链路

```
src/shared/api/client.ts          →  前端 API 客户端
    ↓
server/src/routes/query.ts        →  路由分发
    ↓
server/src/sql/*.ts (16模块)      →  SQL 生成
    ↓
server/src/services/duckdb.ts     →  DuckDB 执行
    ↓
src/features/*/hooks/             →  前端 Hooks 消费数据
    ↓
src/features/*/components/        →  UI 渲染
```

**SQL 生成器**：kpi / kpi-detail / trend / salesman-ranking / cost / coefficient / growth / renewal / renewal-drilldown / truck / premiumPlan / cross-sell / cross-sell-summary / marketing-report / perspective-adapter / premium-report

**功能模块**（15个）：Auth / Home / Dashboard / Filters / Growth / SQL Query / Coefficient / Cost / Premium Report / Marketing Report / Report / Settings / File / Pages / Cross-sell

**系统关键能力**（AI 需知道系统能做什么）：
- NL2SQL 自然语言转 SQL（智谱 glm-4.7-flash + Monaco 编辑器 + 17 个预置模板）
- 层层下钻分析（机构→团队→业务员→维度，面包屑导航）
- 车驾意推介率四象限散点图（件均保费 vs 推介件数）
- 营业货车吨位分段 + 下钻式堆叠柱状图
- 商车自主定价系数监控（阈值合规、周期分表、缺口保费）
- 成本分析四子板块（赔付率/费用率/综合费用率/变动成本率）
- PDF/PPT 导出、ECharts 可视化、增强型 KPI 卡片 + SVG 环形图

> 详细模块说明见 [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md)

---

## 9. 验证协议（禁止自我安慰式开发）

| 场景 | 必须执行 |
|------|----------|
| 修改 SQL | 单元测试 → Chrome Console 验证实际执行结果 |
| SQL 报错 | 复制完整错误 → 查字段类型定义 → 查 DuckDB 文档 |
| 日期处理 | 先 `CAST(field AS DATE)` → 查 DuckDB 日期函数文档 |
| 功能完成 | 截图 Console → 记录关键字段实际值 |
| 启动异常 | `bun run dev:full` 自动清理端口 → 仍失败则按脚本输出处理 |

**执行标准**：发现环境问题必须推进到可运行状态（后端健康 + 登录可查数）再交付，禁止"只自检不修复"。

---

## 10. 异常情况处理

| 情况 | 处理方式 |
|------|----------|
| 信息缺口 | 📝 登记 [缺口清单](./开发文档/缺口清单.md) → 任务 BLOCKED → PROGRESS.md 补充 |
| 业务口径错误 | ❌ 禁止直接修改 → BACKLOG.md 添加任务（BLOCKED，需产品确认） |
| API 调用失败 | ✅ 检查网络面板 → 检查 apiClient 与路由对应 → **前端新增方法必须确认后端路由存在** |
| 生产环境无数据 | ✅ 检查 `/api/data/files` → 检查 `sanitizeFilename()` 是否拒绝了中文文件名 |
| ESM 部署问题 | TS→ESM 不自动加 `.js` 扩展名；ESM 无 `__dirname` 用 `fileURLToPath`；Express 路由用 `req.originalUrl` |
| 渲染循环 | useEffect 依赖数组检查 → React DevTools Profiler → 稳定化 filters 引用 |
| DuckDB 日期序列化 | DATE→`{days:N}`、TIMESTAMP→`{micros:N}`，必须在 duckdb.ts 反序列化为 ISO 字符串 |
| DuckDB 语法不确定 | ✅ 查 [DuckDB 官方文档](https://duckdb.org/docs/) → ❌ 禁止猜测 |
| 安全待办（B200-B204） | B201 账户锁定 / B202 JWT→HttpOnly Cookie / B203 弱口令下线 / B204 速率限制 |

---

## 11. 多 Agent 并发协作

> 详细分析：[开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md](./开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md)

**任务 ID 分配**：@user B001-B099 / @claude B100-B199 / @codex B200-B299 / @gemini B300-B399

**PR 前强制检查**：
```bash
git fetch origin main && git rebase origin/main
bun run scripts/check-write-conflict.mjs
bun run governance
```

冲突处理：禁止 force push，通知 @user 后使用 `scripts/merge-backlog.mjs` 合并。

---

## 12. 数据准备

### 数据文件

| 文件 | 路径 | 用途 |
|------|------|------|
| 保单明细 | `数据管理/warehouse/fact/policy/车险保单综合明细表0214.parquet` | 主数据源 |
| 团队映射 | `数据管理/warehouse/dim/salesman_organization_mapping.json` | 业务员-团队-机构映射 |
| 续保明细 | `数据管理/warehouse/fact/renewal/` | 续保数据 |

### 数据加载流程

```bash
# 本地开发
bun run dev:full  # 自动加载 Parquet + JSON

# 生产同步
./deploy/sync-data.sh  # 上传最新 Parquet → PM2 重启 → 健康检查
```

### 数据知识协议

⚠️ 数据处理任务必读: [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)

---

## 13. CI/CD 与部署

### GitHub Actions

| Workflow | 触发 | 说明 |
|----------|------|------|
| `deploy.yml` | push to main | 构建→上传→部署→健康检查（失败回滚） |
| `claude-code.yml` | @claude 标记 | PR/Issue 中触发任务 |
| `governance-check.yml` | PR | 治理校验 |

PR 中使用 `@claude` + 动词（review/fix/implement/refactor/test/docs）触发。

### 生产环境

| 项目 | 值 |
|------|-----|
| 服务器 | 腾讯云轻量 2核4G（`162.14.113.44`） |
| 域名 | `https://chexian.cretvalu.com` |
| 后端 | PM2 → `chexian-api`（端口 3000，仅 127.0.0.1） |
| 前端 | Nginx → `/var/www/chexian/frontend/dist` |

**数据同步**：`./deploy/sync-data.sh` 一键上传最新 Parquet → PM2 重启 → 健康检查。

**部署文档**：[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) / [vps.md](./vps.md)

---

## 14. Claude Code 工作流与工具箱

**命令索引**：[.claude/commands/README.md](./.claude/commands/README.md)（30 个命令）
**Subagents**：`.claude/agents/*.md`（14 个）

**常用命令速查**：

| 命令 | 用途 |
|------|------|
| `/commit-push-pr` | Git 提交+推送+创建 PR |
| `/sync-and-rebase` | 同步远程代码并 Rebase |
| `/data-analysis` | 车险数据多维度深度分析 |
| `/security-review` | 全面安全审查 |
| `/verify` | 验证命令 |

**测试数据**：`数据管理/warehouse/fact/policy/车险保单综合明细表0214.parquet`（最新，必须用真实数据）

---

**变更历史**（完整历史见 [开发文档/CHANGELOG.md](./开发文档/CHANGELOG.md)）：
- 2026-02-18：基于 Insights 报告彻底重构 CLAUDE.md v3.0（§0 行为红线前置、合并重复章节、精简 1000→550 行、移除变更历史详情）
- 2026-02-18：v2.5 全面更新（rateLimiter/SQL生成器/功能模块/Hooks/安全待办/渲染循环教训）
- 2026-02-16：自动部署 workflow（push→build→deploy→healthcheck→rollback）
- 2026-02-15：生产部署+数据同步+审计日志+6个 ESM/安全 bug 修复
- 2026-02-13：文档同步（模块清单/SQL生成器/命令索引/Subagents）
