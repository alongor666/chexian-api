# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。纯后端 API 模式，前端通过 REST API 访问后端 DuckDB，无 DuckDB-WASM / Local 模式。从 chexianYJFX 双模式项目拆分而来。当前版本 v2.5，已上线至生产环境 `https://chexian.cretvalu.com`。

**协作操作系统**：Claude Code 工作前必读协议。

---

## 0. 智能加载协议（AI必读 - Token优化）

**根据任务复杂度选择阅读深度，节省30-50% token消耗**：

| 任务类型 | 特征关键词 | 必读章节 | 可跳过 |
|---------|-----------|---------|-------|
| 🟢 简单任务 | 修复、改、调整、查看 | §1-2 | §2.5-9 |
| 🟡 中等任务 | 新增、实现、开发、重构 | §1-2.5, §3-6 | §7-9 |
| 🔴 复杂任务 | 架构、设计、协作、CI/CD | §1-9 | 无 |

**判断规则**：分析用户首条消息，不确定时按中等任务处理。

---

## 📖 快速导航

| 我想... | 查看章节 |
|---------|----------|
| 🏗️ **理解项目架构/新建子项目** | → [ARCHITECTURE.md](./ARCHITECTURE.md) - 模块层级、依赖规则、子项目标准 |
| 🎯 **开始新任务** | → [§1 必经入口](#1-必经入口critical---每次任务开始前必读) - 三大索引 + 两本账 |
| 🚫 **了解禁止修改的文件** | → [§2 护栏](#2-护栏red-line---以下文件禁止擅自修改) - 业务口径定义、架构协议 |
| 🔧 **写代码前查现有实现** | → [§2.5 实现前检查协议](#25-实现前检查协议must---防止重复造轮子) - 三问原则、组件注册表、全局样式 |
| 🎨 **UI开发必读** | → [§2.7 设计系统规范](#27-设计系统规范must---ui开发强制遵守) - 字体、颜色、深色模式 |
| ✅ **提交代码前检查** | → [§3 交付协议](#3-交付协议must---完成任务的硬性要求) - DONE 判定、治理校验 |
| 🛠️ **查看技术栈和命令** | → [§4 项目技术栈](#4-项目技术栈快速参考) - Bun 命令、测试 |
| 🔄 **理解数据处理流程** | → [§5 数据处理链路](#5-数据处理链路快速理解架构) - 从上传到渲染 |
| ✅ **验证代码质量** | → [§6 验证协议](#6-验证协议critical---禁止自我安慰式开发) - 强制三层验证 |
| 🤖 **使用自动化工具** | → [§7 Claude Code 工作流](#7-claude-code-工作流集成) - Slash Commands、Subagents |
| ⚠️ **遇到问题** | → [§8 异常情况处理](#8-异常情况处理) - 口径错误、阻塞、文档缺失 |
| 🔀 **多Agent协作** | → [§9 多Agent并发协作协议](#9-多agent并发协作协议critical---防止merge冲突) - 文档分区、任务ID预留、PR前检查 |
| 🚀 **GitHub Actions 配置** | → [§10 GitHub Actions 集成](#10-github-actions-集成cicd---云端协作) - @claude 标记、teleport、会话移交 |
| 🌐 **生产部署/数据同步** | → [§12 生产部署与数据同步](#12-生产部署与数据同步) - VPS 信息、一键同步脚本、部署文件 |
| 🤖 **AI 协作行为规范** | → [§13 AI 协作行为规范](#13-ai-协作行为规范critical---基于-insights-分析) - Git 规范、安全操作、并行执行 |

---

## 1. 必经入口（CRITICAL - 每次任务开始前必读）

### 项目架构规范（嵌套项目必读）
⚠️ **涉及数据管理/子项目时必读**：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 理解模块层级（L0根项目 → L1功能域 → L2子项目）
- 遵循依赖规则（只能向下依赖，子项目间通过文件交互）
- 新建子项目按标准结构创建

### 技术栈声明（第一优先级）
⚠️ **所有开发任务开始前必读**：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- 了解项目技术栈特性（React、Vite、后端 DuckDB）
- 查看架构强制入口（修改代码前必读文件列表）
- 掌握验证协议（单元测试 → 浏览器实测 → 用户验收）

### 开发者全局约定（强制遵守）
⚠️ **所有代码和文档必须遵守**：[开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)
- **DC-001**：数据分析三要素强制前置（分析年度、数据口径、时间段）
- 禁止硬编码日期口径（签单日期/起保日期必须通过状态管理）
- 所有报表/查询必须提供三要素选择器，缺一不可

### 核心索引（5分钟快速定位）
1. **文档索引**: [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档、指标口径
2. **代码索引**: [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md) - 核心模块、关键文件、禁止修改区域
3. **数据索引**: [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md) - ⭐ 字段定义、业务规则、分析场景
4. **进展索引**: [开发文档/00_index/PROGRESS_INDEX.md](./开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、证据链规则、接力入口
5. **缺口清单**: [开发文档/缺口清单.md](./开发文档/缺口清单.md) - AI工作记录、信息缺口追踪
6. **Plans 状态快照**: [.claude/plans/STATUS_SNAPSHOT.md](./.claude/plans/STATUS_SNAPSHOT.md) - plans 目录计划完成度索引（先看快照，避免全文搜索）

### 数据知识协议 (DATA-KNOWLEDGE-PROTOCOL)

⚠️ **所有数据处理任务必读**: [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)

- **分层加载策略**: 第1层快速索引(200tokens) → 第2层业务规则摘要(500tokens) → 第3层完整字典(按需)
- **唯一事实源**: [数据管理/车险数据业务规则字典.md](./数据管理/knowledge/rules/车险数据业务规则字典.md) - 所有字段定义、业务规则
- ⭐ **Parquet Schema 知识库**: [数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md) - **AI SQL 必读**
  - 完整表结构与30个字段的数据类型、值域范围
  - 枚举字段所有可能值及占比
  - 自然语言关键词 → SQL 字段映射表
  - 常见查询模式与隐私保护规则

**数据协作最佳实践**:

- ✅ 简单任务: 仅加载快速参考(200tokens)
- ✅ 中等任务: 快速参考 + 业务规则摘要(700tokens)
- ✅ 复杂任务: 按需加载完整字典(验证阶段)
- ✅ 跨会话接力: 通过PROGRESS.md复用上下文

### 两本账（唯一真理来源）
1. **需求账本**: [BACKLOG.md](./BACKLOG.md) - 所有任务状态追踪（PROPOSED → DONE）
2. **进展账本**: [PROGRESS.md](./PROGRESS.md) - 里程碑、阻塞、下一步行动

### 缺口清单（规划前必查）
⚠️ **所有规划和开发任务开始前必查**：[开发文档/缺口清单.md](./开发文档/缺口清单.md)

**工作流程**：
- **规划阶段**：检查是否有未解决的缺口，评估是否影响当前任务
- **发现缺口**：立即登记，标记为DISCOVERED，暂停任务等待信息
- **验证信息**：用户提供信息后，验证完整性，更新状态为COMPLETED
- **核心原则**：⚠️ **没有完备信息 = 不能开始开发**

**常见缺口类型**：
- 业务规则文档缺失（如保费目标、机构层级）
- 数据格式规范未明确（如Excel列名、字段类型）
- 计算口径未确认（如续保率定义、时间范围）
- 示例数据缺失（如测试用Parquet文件）

---

## 1.5 API 模式架构与启动协议（CRITICAL）

> 本项目为纯 API 模式，从 chexianYJFX 双模式项目拆分而来。已移除所有 DuckDB-WASM / Local 模式代码。

### 架构核心概念

本项目采用**纯 API 模式数据架构**：

| 模式 | 数据位置 | 触发条件 | 状态标识 |
|------|----------|----------|----------|
| **API 模式** | 后端 DuckDB (server/) | 用户已登录 | `dataSource = 'api'` |

数据状态由 `DataContext` 统一管理：

```
┌──────────────────────────────────────────────────────────────────┐
│  状态层                        │  来源         │  含义            │
├──────────────────────────────────────────────────────────────────┤
│  DataContext.isDataLoaded      │  后端文件列表  │  后端有可查询数据 │
│  AuthContext.isAuthenticated   │  JWT Token    │  用户已登录       │
└──────────────────────────────────────────────────────────────────┘
```

### ✅ 正确的数据启用判断

```typescript
// 在 Dashboard/PremiumDashboard 等组件中
const { isDataLoaded } = useDataStatus();

// ✅ 正确：直接使用 isDataLoaded
const isDataEnabled = isDataLoaded;
```

### 标准启动流程

```
用户登录 → AuthContext 验证 → JWT Token
         → DataContext 查询后端文件列表
         → 设置 isDataLoaded = true

仪表盘查询 → useApiQuery() → GET /api/query/kpi
           → 后端 DuckDB 执行查询 → 返回 JSON → 前端渲染
```

### 排查清单（遇到"暂无数据"时必查）

| 检查项 | 命令/方法 | 预期值 |
|--------|----------|--------|
| 用户是否登录 | `localStorage.getItem('auth_token')` | 非空 |
| 后端是否启动 | 检查终端日志 | "Server is running on http://localhost:3000" |
| 后端是否有数据文件 | 首页文件列表 | 有"当前加载"标记 |
| API 请求是否成功 | 浏览器网络面板 | 200 OK，无 404/500 |
| isDataLoaded 状态 | Console 检查 DataContext | `true` |

### 关键文件清单

| 文件 | 职责 | 修改注意事项 |
|------|------|-------------|
| `src/shared/contexts/DataContext.tsx` | 数据源状态管理 | isDataLoaded 的唯一来源，固定 dataSource='api' |
| `src/shared/contexts/AuthContext.tsx` | 认证状态管理 | JWT Token、登录/登出逻辑 |
| `src/shared/contexts/PermissionContext.tsx` | 权限管理 | 角色权限控制 |
| `src/shared/api/client.ts` | API 客户端 | 所有后端请求的统一入口 |
| `src/features/dashboard/hooks/useDashboardData.ts` | 数据获取 Hook | 仅 API 分支 |
| `src/components/layout/DataGuard.tsx` | 路由守卫 | 检查 isDataLoaded |
| `server/src/services/duckdb.ts` | 后端 DuckDB 服务 | 查询执行、数据加载；PolicyFact + PolicyFactRenewal 视图 |
| `server/src/routes/query.ts` | 后端查询路由 | API 端点定义（含 cross-sell/renewal-drilldown） |
| `server/src/utils/security.ts` | 安全工具 | 文件名验证、路径验证、SQL表名验证、敏感信息脱敏 |
| `server/src/middleware/audit.ts` | 审计日志中间件 | 记录已认证用户的 /api/query/* 操作 |
| `server/src/middleware/rateLimiter.ts` | API 限流中间件 | 通用100/min、登录5/min、查询30/min；修改须保持防暴力破解效果 |

### 防御性编码规范

1. **图表组件必须处理空数据**：
```typescript
// ✅ 正确：防御性检查
const timePeriod = row.time_period ?? '';
const year = timePeriod.includes('-') ? timePeriod.split('-')[0] : '2025';

// ❌ 错误：直接访问可能为 undefined 的属性
const year = row.time_period.includes('-') ? ...  // TypeError!
```

2. **Hook 统一使用 API 数据源**：
```typescript
// ✅ 正确：直接调用 API
const { isDataLoaded } = useDataStatus();

useEffect(() => {
  if (!isDataLoaded) return;
  fetchFromApi();
}, [isDataLoaded]);
```

---

## 2. 护栏（RED LINE - 以下文件禁止擅自修改）

### 业务口径定义（不可改，只能追加且需证据）

| 文件 | 原因 | 如需变更 |
|------|------|----------|
| `server/src/services/duckdb.ts` | 后端 DuckDB 查询逻辑（KPI 计算、视图定义） | ❌ 不得修改已有查询逻辑<br>✅ 只能追加新查询<br>📝 需在 BACKLOG.md 登记并提供证据 |
| `server/src/routes/query.ts` | 后端 API 路由定义 | ❌ 不得删除已有路由<br>✅ 只能追加新路由<br>📝 需在 BACKLOG.md 登记 |

### 架构协议（不可破坏）
- **Bun 包管理器**：禁止使用 npm/yarn/pnpm（项目统一使用 Bun）
- **智谱 API 端点**：`https://open.bigmodel.cn/api/paas/v4` 是标准端点（支持模型 glm-4.7-flash），已从 Coding 套餐迁移
- **API 限流中间件**：`server/src/middleware/rateLimiter.ts` 定义三级限流（通用/登录/查询），禁止降低限流强度
- **API 认证**：所有 `/api/*` 路由必须经过 JWT 认证中间件，禁止绕过
- **文件名验证**：`server/src/utils/security.ts` 的 `sanitizeFilename()` 使用危险字符黑名单（非白名单），以支持中文文件名。修改时注意保持对路径遍历、控制字符的防护

---

## 2.5 实现前检查协议（MUST - 防止重复造轮子）

> **核心原则**：写代码前先查现有实现，节约开发时间，保持代码一致性。

### 三问原则（写代码前必答）

| 问题 | 检查方式 | 示例 |
|------|----------|------|
| **1. 已有吗？** | 查 CODE_INDEX.md 组件/工具清单 | 新增表格组件前，先查 `src/widgets/table/` |
| **2. 能复用吗？** | 查 `src/shared/` 通用模块 | 格式化函数用 `formatters.ts`，不要自己写 |
| **3. 有模式吗？** | 查同类实现的代码模式 | 新建表格页参考 `EarnedPremiumTable.tsx` |

### 组件/工具注册表（强制查询）

| 类别 | 注册表位置 | 包含内容 |
|------|-----------|---------|
| **UI组件** | `src/widgets/INDEX.md` | Table、Card、Badge、Button、Input、Select |
| **样式系统** | `src/shared/styles/index.ts` | ⭐ tableStyles、textStyles、buttonStyles、colors |
| **API客户端** | `src/shared/api/client.ts` | 所有后端 API 调用方法 |
| **工具函数** | `src/shared/utils/` | formatters.ts、export.ts |
| **类型定义** | `src/shared/types/` | 通用类型、业务类型 |

### 全局样式设定（UI开发必用）

**唯一样式来源**：`src/shared/styles/index.ts` + `src/shared/ui/index.ts`

```typescript
// ✅ 正确：使用全局样式
import { tableStyles, textStyles, buttonStyles, cn } from '@/shared/styles';
import { Card, Badge, Button } from '@/shared/ui';

// ❌ 错误：硬编码 Tailwind 类
<div className="bg-white rounded-lg shadow-sm p-4">  // 应用 cardStyles.standard
<th className="px-3 py-2 text-left text-xs font-semibold"> // 应用 tableStyles.headerCell
```

### 数据格式化规范（MUST - 全局统一）

**唯一格式化来源**：`src/shared/utils/formatters.ts`

| 数据类型 | 格式化函数 | 规则 | 示例 |
|---------|-----------|------|------|
| **件数** | `formatCount` | 整数，千分位 | `1,234` |
| **均值** | `formatAverage` | 1位小数，千分位 | `1,234.5` |
| **比率/百分比** | `formatPercent` | 1位小数，带% | `85.6%` |
| **保费** | `formatPremiumWan` | 万元为单位，整数 | `1,234` |
| **自主系数** | `formatCoefficient` | 4位小数 | `0.8523` |
| **图表Y轴** | `formatChartValue` | 纯数字，无单位 | `1234` |

**数字字体规范**：所有数字使用 `textStyles.numeric`（等宽字体 `font-mono tabular-nums`）

```typescript
// ✅ 正确：使用统一格式化函数
import { formatCount, formatAverage, formatPercent, formatPremiumWan } from '@/shared/utils/formatters';
<span className={textStyles.numeric}>{formatPremiumWan(premium)}</span>

// ❌ 错误：自定义格式化逻辑
<span>{(premium / 10000).toFixed(2)}万元</span>  // 禁止硬编码格式化
```

**图表标签规范**：
- Y轴标签使用 `formatChartValue`，不显示单位
- 标题或图例中标注单位（如"保费(万元)"）

### 违规判定与处理

| 违规类型 | 判定标准 | 处理方式 |
|---------|---------|---------|
| **重复实现** | 新建函数但已存在同功能函数 | ❌ 必须删除，使用现有 |
| **硬编码样式** | 未使用 `src/shared/styles` 定义 | ❌ 必须重构为全局样式 |
| **未登记组件** | 新增通用组件但未在 INDEX.md 登记 | ❌ 补充登记后方可提交 |

### 检查点清单（每次开发必过）

```
开始前 □ 查 CODE_INDEX.md 确认无现有实现
      □ 查 src/shared/ 确认无可复用模块
      □ 查 src/shared/styles/index.ts 了解样式规范

开发中 □ UI 样式使用 tableStyles/textStyles/buttonStyles
      □ 格式化使用 formatters.ts 的函数
      □ 类型定义使用或扩展 shared/types

完成后 □ 新增通用组件已登记到 INDEX.md
      □ 无硬编码 Tailwind 类（已使用全局样式）
      □ 无重复实现的工具函数
```

---

## 2.6 启动与架构验证协议（MUST - 防止架构认知偏差）

> 本项目为纯 API 模式，前端所有数据均来自后端 API，必须同时启动前后端。

### 启动前检查（每次启动必答）

| 问题 | 检查方式 | 预期答案 |
|------|----------|---------|
| **1. 后端是否就绪？** | 检查 `server/` 目录 | 存在 → 需要启动后端 |
| **2. 数据文件是否存在？** | 检查后端 Parquet 数据目录 | 有 `.parquet` 文件 |
| **3. 环境变量是否配置？** | 检查 `server/.env` | JWT_SECRET 等已配置 |

### 开发环境启动命令（CRITICAL）

```bash
# ✅ 推荐：一键启动前后端
bun run dev:full

# 或分别启动：
cd server && bun run dev &    # 启动后端（端口 3000）
bun run dev                   # 启动前端（端口 5173）
```

**启动器联动机制（必须理解）**：
- `bun run dev:full` 会调用 `scripts/start.mjs --all`
- 脚本会在启动前自动清理开发常用旧端口（`3000`, `5173-5176`）
- 清理成功后再启动后端与前端；若端口仍不可用，脚本会阻断启动并输出占用进程

⚠️ **禁止只运行 `bun run dev`**：这只启动前端，后端 API 不可用会导致数据加载失败。

### 数据流架构（API 模式）

```
┌─────────────────────────────────────────────────────────────────┐
│                      API 模式（唯一模式）                        │
│  用户登录 → 后端验证 → JWT Token                                 │
│       ↓                                                         │
│  仪表盘组件 → useApiQuery() → GET /api/query/kpi                │
│       ↓                                                         │
│  后端 DuckDB 执行查询 → 返回 JSON → 前端渲染                     │
└─────────────────────────────────────────────────────────────────┘
```

| 模式 | 触发条件 | 数据来源 | 仪表盘数据获取 |
|------|----------|----------|---------------|
| **API 模式** | 用户登录 + 后端可用 | 后端 DuckDB | `useApiQuery()` → `/api/query/*` |

### 后端 API 端点清单

| 端点类别 | 路径前缀 | 说明 |
|---------|----------|------|
| 查询 API | `/api/query/*` | KPI、趋势、排名、成本、系数、续保、自定义查询 |
| 数据管理 | `/api/data/*` | 文件上传、列表、加载 |
| AI 助手 | `/api/ai/*` | NL2SQL、智能分析 |
| 认证 | `/api/auth/*` | 登录、注册、Token 刷新 |
| 筛选器 | `/api/filters/*` | 筛选器选项（机构/业务员/险别等） |

### 违规判定与处理

| 违规类型 | 判定标准 | 处理方式 |
|---------|---------|---------|
| **盲目启动** | 只运行 `bun run dev` 未启动后端 | ❌ 必须运行 `bun run dev:full` |
| **症状式调试** | 花 >15 分钟在 UI 点击上 | ❌ 停止，先读 §2.6 和 §5 理解数据流 |
| **绕过认证** | API 路由缺少认证中间件 | ❌ 所有 `/api/*` 必须经过 JWT 验证 |

### 检查点清单（启动项目时必过）

```
启动前 □ 检查 server/ 目录存在
      □ 检查 server/.env 配置完整
      □ 阅读 §5 数据处理链路

启动时 □ 运行 bun run dev:full（同时启动前后端）
      □ 检查后端日志：应显示 "Server is running on http://localhost:3000"
      □ 检查前端日志：应显示 "Local: http://localhost:5173/"

验证时 □ 登录后应能直接看到仪表盘数据
      □ 浏览器网络面板确认 API 请求返回 200
      □ 浏览器控制台无 CORS 或 Failed to fetch 错误
```

---

## 2.7 设计系统规范（MUST - UI开发强制遵守）

> **目标**：统一字体、颜色、间距，确保代码一致性和深色模式兼容。

### 字体使用规范（3类场景）

| 场景 | CSS类 | 何时使用 | 示例 |
|------|-------|---------|------|
| **KPI大数字** | `.font-kpi` | 仪表盘KPI卡片数值 | `<div className="font-kpi">1,234</div>` |
| **图表数字** | `.font-chart-number` | ECharts轴标签、SVG文本 | `<text className="font-chart-number">2025</text>` |
| **表格数字** | `.font-tabular` | 表格数字列（需对齐） | `<td className="font-tabular text-right">85.6%</td>` |

**字体栈**：
- `.font-kpi`: Avenir Next / Century Gothic（现代几何感）
- `.font-chart-number`: SF Pro / Helvetica Neue（清晰专业）
- `.font-tabular`: 等宽数字（完美对齐）

### 颜色使用规范（禁止硬编码）

**❌ 错误**（硬编码Tailwind颜色）：
```tsx
className="text-red-800"              // 禁止
className="bg-blue-600"               // 禁止
```

**✅ 正确**（使用设计系统）：
```tsx
import { colorClasses } from '@/shared/styles';

className={colorClasses.text.danger}       // 'text-danger dark:text-danger-light'
className={colorClasses.bg.dangerSolid}    // 'bg-red-100 dark:bg-red-900/20'
className={colorClasses.border.primary}    // 'border-blue-200 dark:border-blue-800'
```

**颜色映射速查**：
```
text-red-800   → colorClasses.text.dangerDark
text-green-600 → colorClasses.text.positive
text-blue-700  → colorClasses.text.primary
bg-red-50      → colorClasses.bg.danger
bg-gray-50     → colorClasses.bg.neutral
```

### 图表年份颜色（统一函数）

```tsx
import { getYearChartColor } from '@/shared/styles';

const color = getYearChartColor('2024');  // 返回 '#FF6B6B'
```

### 验证清单（代码审查必查）

```
□ 无硬编码 text-{color}-{number} 或 bg-{color}-{number}
□ KPI数值使用 .font-kpi 类
□ 图表标签使用 .font-chart-number 类
□ 表格数字使用 .font-tabular 类
□ 深色模式测试通过（切换 dark 类验证）
```

**参考文档**：[src/shared/styles/index.ts](src/shared/styles/index.ts) - 完整设计系统定义

---

## 3. 交付协议（MUST - 完成任务的硬性要求）

### 新增需求流程
```
1. 在 BACKLOG.md 添加新行，状态=PROPOSED
2. 填写：提出时间、板块、需求描述、优先级
3. 开始开发前，状态改为 IN_PROGRESS，填写关联文档/代码
4. 完成后，状态改为 DONE，**必须填写验收/证据**
```

### DONE 判定（缺一不可）
- ✅ 关联文档：已填写（若无则填 `N/A`）
- ✅ 关联代码：已填写（若纯文档任务则填 `N/A`）
- ✅ 验收/证据：必填（PR链接/Commit哈希/测试报告/截图，至少一项）

### 核心层改动规则
修改以下目录时，必须同步更新对应 INDEX.md：
- `src/shared/` → 更新 `src/shared/INDEX.md`
- `src/features/` → 更新 `src/features/INDEX.md`
- `src/widgets/` → 更新 `src/widgets/INDEX.md`
- `scripts/` → 更新 `scripts/INDEX.md`

### 治理校验
每次提交前运行：
```bash
bun run scripts/check-governance.mjs
```
校验失败则**禁止提交**。

---

## 4. 项目技术栈（快速参考）

**核心技术**：React + TypeScript + Vite + 后端 DuckDB + ECharts
> 详细版本和依赖：见 [开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)

**包管理器**：Bun（⚠️ 禁止使用 npm/yarn/pnpm）

**关键命令**：
```bash
bun install         # 安装依赖
bun run dev:full    # ✅ 一键启动前后端（推荐）
bun run dev         # 仅启动前端（⚠️ 需同时启动后端）
bun run build       # 类型检查 + 生产构建
bun run test        # 运行单元测试 ⚠️ 注意：不是 bun test
bun run governance  # 治理校验
```

---

## 5. 数据处理链路（快速理解架构）

### 架构说明

系统采用纯 API 模式，`DataContext.dataSource` 固定为 `'api'`：

| 模式 | 数据源 | 适用场景 | 启动命令 |
|------|--------|----------|----------|
| **API 模式** | 后端 DuckDB (server/) | 登录用户、多用户协作、权限过滤 | `bun run dev:full` |

### API 模式数据链路

```
用户登录 → DataContext.dataSource = 'api'
  ↓
src/shared/api/client.ts                          # API 客户端
  ├─ getKpi(filters)                              # /api/query/kpi
  ├─ getSalesmanRanking(limit, filters)           # /api/query/salesman-ranking
  ├─ getTrend(granularity, filters)               # /api/query/trend
  ├─ executeCustomQuery(sql)                      # /api/query/custom
  └─ ...                                          # /api/query/cost, /coefficient, /renewal 等
  ↓
server/src/routes/                                # 后端 API 路由
  ├─ query.ts                                     # 查询路由
  ├─ data.ts                                      # 数据管理路由
  ├─ auth.ts                                      # 认证路由
  ├─ ai.ts                                        # AI/NL2SQL 路由
  └─ filters.ts                                   # 筛选器选项路由
  ↓
server/src/sql/                                   # SQL 生成器（16个模块）
  ├─ kpi.ts / kpi-detail.ts                       # KPI 查询
  ├─ trend.ts / salesman-ranking.ts               # 趋势与排名
  ├─ cost.ts / coefficient.ts / growth.ts         # 专项分析
  ├─ renewal.ts / renewal-drilldown.ts            # 续保分析（PolicyFactRenewal 视图）
  ├─ truck.ts / premiumPlan.ts                    # 货车与保费计划
  ├─ cross-sell.ts / cross-sell-summary.ts        # 车驾意推介率（层层下钻版）
  ├─ marketing-report.ts                          # 营销战报
  └─ perspective-adapter.ts                       # 视角适配
  ↓
server/src/services/duckdb.ts                     # 后端 DuckDB 查询执行
  ↓
src/features/dashboard/hooks/                      # 前端数据 Hooks
  ├─ useDashboardData.ts                          # 主 Hook（refreshApi 分支）
  ├─ usePremiumDashboardData.ts                   # 保费仪表盘数据
  ├─ useBaseKpiData.ts                            # 基础 KPI 数据
  ├─ useKpiData.ts / useTrendData.ts              # KPI 与趋势
  ├─ useTruckAnalysis.ts / useRenewalAnalysis.ts  # 货车与续保
  ├─ useRenewalDrilldown.ts                       # 续保下钻
  ├─ useCrossSellAnalysis.ts / useCrossSellTimePeriod.ts  # 车驾意推介率
  ├─ useAlerts.ts / useDataQualityCheck.ts        # 告警与数据质量
  └─ useDashboardFilters.ts / useDashboardLayout.ts  # 筛选器与布局
  ↓
src/features/*                                    # 功能模块 UI 渲染
```

**功能模块清单**（15个模块）：
| 模块 | 路径 | 职责 |
|------|------|------|
| Auth | `auth/` | 用户认证（登录/注册） |
| Home | `home/` | 首页数据导入（拖拽上传、最近文件） |
| Dashboard | `dashboard/` | 仪表盘主视图（KPI、图表、表格、续保分析、车驾意推介率） |
| Filters | `filters/` | 筛选面板（日期/机构/业务员/险别） |
| Growth | `growth/` | 增长率分析（同比/环比/年累计/自定义期间） |
| SQL Query | `sql-query/` | 交互式SQL查询（只读+聚合，17个模板） |
| Coefficient | `coefficient/` | 商车自主定价系数监控（阈值合规、周期分表） |
| Cost | `cost/` | 成本分析（赔付率/费用率/综合费用率/变动成本率） |
| Premium Report | `premium-report/` | 保费报表（机构保费+业务员明细+汇总） |
| Marketing Report | `marketing-report/` | 营销战报（假日营销分析：机构战报+业务员明细） |
| Report | `report/` | 报表模板功能（预设分析场景） |
| Settings | `settings/` | 设置面板（主题/系统设置） |
| File | `file/` | 文件菜单（数据导入/导出/报表模板） |
| Pages | `pages/` | 独立页面组件 |
| Cross-sell | `dashboard/` (内嵌) | 车驾意推介率（层层下钻、四象限散点图） |

**关键特性**：
- **多视图支持**：业绩看板 + SQL查询 + 专项分析（营业货车/系数监控/成本分析/车驾意推介率）+ 报表（保费/营销）
- **现代侧边栏布局**：功能菜单系统 + 独立页面组件
- **时间维度**：日/自然周/自然月/年度趋势分析
- **智能查询**：
  - Monaco编辑器 + 只读安全校验
  - NL2SQL自然语言转SQL（支持中文语义理解，基于智谱 glm-4.7-flash）
  - 17个预置查询模板 + 参数化模板引擎
- **专项分析**：
  - 营业货车按吨位分段 + 下钻式堆叠柱状图
  - 商车自主定价系数监控（阈值合规、周期分表、缺口保费）
  - 成本分析四子板块（赔付率/费用率/综合费用率/变动成本率）
  - 增强型KPI卡片 + SVG环形图可视化
  - **车驾意推介率**：层层下钻（机构→团队→业务员→维度），四象限散点图（件均保费 vs 推介件数）
  - **续保下钻**：PolicyFactRenewal 视图支持逐月续保分析
- **报表功能**：
  - 保费报表（机构保费统计 + 业务员保费明细）
  - 营销战报（假日营销分析 + 开单率统计）
  - PDF/PPT导出功能
- **高级筛选**：
  - 日期范围选择器（默认今年至今YTD）
  - 多选下拉框（机构/业务员/客户类别/险别组合）
  - 折叠式筛选区域（localStorage记忆）
- **安全防护**：三级 API 限流 + 审计日志 + JWT 认证 + 文件名黑名单校验

---

## 6. 验证协议（CRITICAL - 禁止自我安慰式开发）

**教训来源**：2026-01-08 自然周/月视图实现，未浏览器实测导致多次返工。

### 强制三层验证

```
第1层：单元测试（bun test）
  ↓  验证逻辑正确
第2层：浏览器实测（Chrome DevTools）
  ↓  验证 API 请求与响应数据正确
第3层：用户验收（人工确认）
  ↓  验证功能符合需求
```

**详细验证步骤**：见 [开发文档/TECH_STACK.md § 4](./开发文档/TECH_STACK.md#4-通用验证协议所有开发必须遵守)

### 特别提醒

| 场景 | 必须执行 |
|------|----------|
| 修改 SQL 生成逻辑 | ✅ 单元测试通过 → ✅ **打开 Chrome Console 验证实际执行结果** |
| SQL 报错 | ✅ 复制完整错误信息 → ✅ 查看 `server/src/services/duckdb.ts` 字段类型定义 |
| 日期时间处理 | ✅ 先 `CAST(field AS DATE)` → ✅ 查看 DuckDB 日期函数文档 |
| 功能开发完成 | ✅ 截图 Console 输出 → ✅ 记录关键字段实际值 |
| 发现启动异常（端口冲突/仅前端） | ✅ 执行 `bun run dev:full` 触发自动端口清理 → ✅ 若清理失败，按脚本输出释放端口后重试 |

**执行标准（强制）**：
- 不允许“只自检不修复”。发现环境问题后必须推进到可运行状态（后端健康 + 登录可查数）再交付结论。

---

## 7. Claude Code 工作流集成

**自动化工具箱**：Slash Commands + Subagents，位于 `.claude/` 目录。

**完整命令索引**: [.claude/commands/README.md](./.claude/commands/README.md)（30个命令，v2.3）

### 命令分类速查

| 类别 | 命令 | 描述 |
|------|------|------|
| **Git工作流** | `/sync-and-rebase` | 同步远程代码并Rebase |
| | `/commit-push-pr` | 提交代码并创建PR |
| **数据分析** | `/data-analysis` | 车险数据多维度深度分析 |
| | `/data-tools` | Python数据分析工具库（8个工具） |
| | `/data-profile` | 数据概览与质量检查 |
| | `/data-kpi` | 业绩分析与排名 |
| | `/data-trends` | 时间趋势分析 |
| | `/data-export` | 数据导出（CSV/JSON/Excel） |
| **报告生成** | `/weekly-report` | 车险业务周报自动生成 |
| | `/report-weekly` | 周报（自然周数据） |
| | `/report-monthly` | 月报（同比环比） |
| | `/report-custom` | 自定义报告 |
| **安全审查** | `/security-review` | 全面安全审查（8项检查） |
| | `/security-sql` | SQL注入防护专项 |
| | `/security-xss` | XSS防护专项 |
| | `/security-cors` | CORS与文件上传安全 |
| | `/security-all` | 全量安全审查 |
| **开发工具** | `/performance-audit` | 全栈性能审计 |
| | `/ui-review` | UI/UX设计审查 |
| | `/test-coverage` | 测试覆盖率分析 |
| | `/cost-analysis` | 成本分析深度审计 |
| | `/tdd` | TDD开发工作流 |
| | `/session-manager` | 管理对话历史 |
| | `/session-summary` | 历史Session汇总 |
| | `/extract-knowledge` | 提取隐性知识 |
| | `/verify` | 验证命令 |
| | `/checkpoint` | 检查点命令 |
| | `/orchestrate` | 编排命令 |
| | `/evolve` | 技能演进命令 |
| **项目管理** | `/init-project` | 初始化Claude Code配置 |

**Subagents**：`.claude/agents/*.md`（14个）
- `architect` / `build-error-resolver` / `business-intelligence`
- `code-simplifier` / `data-validator` / `duckdb-optimizer`
- `e2e-runner` / `knowledge-miner` / `react-performance`
- `security-reviewer` / `session-manager` / `tdd-guide`
- `ui-ux-designer` / `verify-app`

### 数据准备

**测试数据（真实数据）**：`数据管理/warehouse/fact/policy/` 目录下的最新 `.parquet` 文件
- 当前最新：`数据管理/warehouse/fact/policy/车险保单综合明细表0214.parquet`（2026-02-14 更新）
- 格式：Parquet（必须）
- 列名：需匹配后端 DuckDB 表结构定义
- 必需字段：`policy_no`, `premium`, `org_name`, `salesman_name`

> ⚠️ **测试时必须使用真实数据**，不要使用 mock 数据或旧的示例文件。

---

## 8. 异常情况处理

| 情况 | 处理方式 |
|------|----------|
| 发现信息缺口（如缺少文档、格式不明） | 📝 立即在 [缺口清单.md](./开发文档/缺口清单.md) 登记<br>⚫ 当前任务标记为 BLOCKED<br>📝 在 PROGRESS.md 补充阻塞详情 |
| 发现业务口径错误 | ❌ 禁止直接修改<br>📝 在 BACKLOG.md 添加任务（状态=BLOCKED），标注"需产品确认" |
| 需要重构核心逻辑 | 📝 在 BACKLOG.md 添加任务（状态=PROPOSED），提供重构理由和影响范围 |
| 遇到阻塞无法继续 | 📝 在 BACKLOG.md 将任务状态改为 BLOCKED<br>📝 在 PROGRESS.md 第 2 节补充阻塞详情 |
| 发现缺失文档 | ✅ 直接创建文档<br>📝 在对应 INDEX.md 登记 |
| SQL 执行失败 | ✅ 查看 Chrome Console 完整错误 → ✅ 检查字段类型 → ✅ 查 DuckDB 文档 |
| 不确定 DuckDB 语法 | ✅ 先查 [DuckDB 官方文档](https://duckdb.org/docs/) → ❌ 禁止猜测 |
| **API 调用失败/数据不显示** | ✅ 检查浏览器网络面板（是否 404/500）<br>✅ 检查前端 apiClient 和后端路由是否对应<br>⚠️ **前端新增 API 方法必须检查后端路由是否存在**<br>📝 教训：2026-02-04 KPI 显示"--"，根因是 `/api/query/kpi-detail` 路由未创建 |
| **生产环境登录后无数据** | ✅ 检查 `/api/data/files` 是否返回空数组<br>✅ 检查 `sanitizeFilename()` 是否拒绝了中文文件名<br>📝 教训：2026-02-15 部署后"只有前端没有数据"，根因是 `security.ts` 使用 ASCII-only 白名单正则 `/^[a-zA-Z0-9_\-\.]+$/` 拒绝了中文 Parquet 文件名，改为危险字符黑名单解决 |
| **ESM 部署问题** | ✅ TypeScript 编译 ESM 不自动添加 `.js` 扩展名 → 需手动添加或配置 `moduleResolution: NodeNext`<br>✅ ESM 模式无 `__dirname` → 用 `fileURLToPath(import.meta.url)` 替代<br>✅ Express 路由挂载后 `req.path` 变为相对路径 → 用 `req.originalUrl` |
| **渲染循环导致性能问题** | ✅ useEffect 依赖数组缺少或包含引用不稳定的对象会导致无限渲染<br>✅ 检查 React DevTools Profiler 找到高频重渲染组件<br>📝 教训：2026-02-17 PR #15 修复了多处渲染循环（`usePremiumDashboardData`、`useBaseKpiData`），根因是 filters 对象每次渲染时创建新引用 |
| **DuckDB 日期字段序列化** | ✅ DuckDB 原生日期返回格式为 `{days: N}` (DATE) 或 `{micros: N}` (TIMESTAMP)<br>✅ 必须在 `server/src/services/duckdb.ts` 反序列化为 ISO 字符串<br>📝 教训：2026-02-13 B167 发现 renewal/coefficient API 返回日期字段异常，修复方案：统一 BigInt+Date 序列化处理 |
| **安全问题（B200-B204）** | ⚠️ **待整改 P0 任务**：<br>- B201: 登录接口账户锁定（当前仅限流，无锁定）<br>- B202: JWT 从 localStorage 迁移到 HttpOnly Cookie<br>- B203: 默认弱口令下线<br>- B204: 全局速率限制基线<br>📝 已有 `rateLimiter.ts` 覆盖 B204 的限流部分 |

---

## 9. 多Agent并发协作协议（CRITICAL - 防止merge冲突）

> 详细分析：[开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md](./开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md)

### 核心规则

**任务ID分配**（防止冲突）：
| Agent | ID范围 |
|-------|--------|
| @user | B001-B099 |
| @claude | B100-B199 |
| @codex | B200-B299 |
| @gemini | B300-B399 |

**PR前强制检查**：
```bash
git fetch origin main && git rebase origin/main
bun run scripts/check-write-conflict.mjs
bun run governance
```

**冲突处理**：禁止force push，通知@user后使用`scripts/merge-backlog.mjs`合并

---

## 10. GitHub Actions 集成（CI/CD - 云端协作）

> Boris Cherny 工作流高级技巧实践

### 配置文件位置

| 文件 | 用途 |
|------|------|
| `.github/workflows/claude-code.yml` | Claude Code 主 workflow |
| `.github/workflows/governance-check.yml` | 治理检查 workflow |
| `.github/workflows/deploy.yml` | 自动部署 workflow（push to main → VPS） |
| `.github/instructions/claude.instructions.md` | PR 中 @claude 标记交互规范 |
| `.claude/scripts/hooks/session-start.sh` | 会话初始化 hook |

### @claude 标记使用（PR/Issue 中触发）

在 PR 或 Issue 评论中使用 `@claude` 触发任务：

```
@claude 请帮我修复这个类型错误
@claude review 请审查这个 PR 的代码
@claude fix 修复 lint 错误并提交
@claude implement 实现导出功能
```

**标准动词**：`review` | `fix` | `implement` | `refactor` | `test` | `docs`

### 会话移交协议（& 符号）

**从本地移交到 Web**：
1. 在本地终端输入 `&`
2. 获取 session_id
3. 在 PR 评论中：`@claude continue session_id=<session-id>`

**从 Web 返回本地**：
```bash
# PR 评论中
@claude teleport-back

# 本地终端继续
claude --resume <session-id>
```

### --teleport 切换（本地 ↔ 云端）

```bash
# 本地 → 云端
claude --teleport
# 输出 session_id，在 PR 中使用 @claude teleport session_id=xxx

# 云端 → 本地
# PR 中 @claude teleport-back
# 本地运行 claude --resume xxx
```

### 自动检查项

每次 PR 自动运行：
1. `bun test` - 单元测试
2. `bun run build` - 类型检查 + 构建
3. `bun run governance` - 治理校验

### 安全配置

**允许的工具**：
- 文件读写（Read/Write/Edit）
- 代码搜索（Glob/Grep）
- Bun 命令（`bun:*`）
- Git 命令（`git:*`）
- Vitest 测试（`npx:vitest*`）

**禁止的操作**：
- 删除根目录（`rm -rf /*`）
- sudo 命令
- 管道执行远程脚本（`curl*|*sh`）

### 使用前提

1. 在 GitHub 仓库设置中添加 `ANTHROPIC_API_KEY` secret
2. 确保 Actions 权限包含：contents:write, pull-requests:write, issues:write

---

## 11. FORalongor.md 编写协议

> **每个项目必须维护一份 `FORalongor.md` 文件**，用于向未来的开发者（或未来的自己）解释这个项目到底是什么、怎么运作的。

### 编写要求

编写一份详细的 `FORalongor.md` 文件，用**平白易懂的语言**解释整个项目，内容必须覆盖以下维度：

| 维度 | 说明 |
|------|------|
| **技术架构** | 系统由哪些层组成？数据怎么流动？各模块之间如何协作？ |
| **代码结构** | 目录为什么长这样？关键文件在哪？某个功能的代码在哪里能找到？ |
| **技术选择的理由** | 为什么用后端 DuckDB + REST API 架构？为什么用 JWT 认证？ |
| **血泪教训** | 遇到过哪些 bug？怎么找到根本原因的？哪些坑踩过一次绝不踩第二次？ |
| **潜在陷阱** | 哪些地方容易出错？新手最可能被哪些设计决策绊倒？ |
| **新技术沙龙** | 引入了哪些不常见的技术？为什么？怎么学上手？ |
| **工程师思维** | 好的工程师在这个项目里是怎么工作的？决策框架是什么？ |
| **最佳实践** | 项目沉淀了哪些可复用的模式和规范？ |

### 风格指南

- ✅ **用类比和故事**让技术概念易懂可记（例如：用"邮箱"比喻 Worker 通信，用"菜谱"比喻 SQL 模板）
- ✅ **语气要活泼**，不要写成枯燥的技术文档或教科书
- ✅ **帮读者建立心智模型**：读完之后，开发者应该能画出系统架构图
- ✅ **诚实记录失败**：成功案例固然重要，但踩过的坑往往比成功经验更有价值
- ❌ 不要仅罗列 API 接口或函数签名
- ❌ 不要照搬 README，那是项目入口说明；FORalongor.md 是**深度理解指南**

### 更新时机

- 项目初期：架构基本稳定时写第一版
- 踩到坑：第一时间补充到"血泪教训"章节
- 引入新技术：补充决策背景和上手路径
- 定期回顾：每个 Sprint 末检查是否有遗漏

---

## 12. 生产部署与数据同步

### 生产环境

| 项目 | 值 |
|------|-----|
| 服务器 | 腾讯云轻量 2核4G（`162.14.113.44`） |
| 域名 | `https://chexian.cretvalu.com` |
| 后端 | PM2 → `chexian-api`（端口 3000，仅 127.0.0.1） |
| 前端 | Nginx 静态文件 → `/var/www/chexian/frontend/dist` |
| 安全 | HTTPS + Nginx IP 白名单 + JWT 认证 + 审计日志 |

### 自动部署（Push to main → 自动构建部署）

Push 到 `main` 分支后，GitHub Actions 自动完成：构建前后端 → 打包上传 → 部署到 VPS → 健康检查（失败自动回滚）。

**Workflow 文件**：`.github/workflows/deploy.yml`

**支持手动触发**：GitHub Actions 页面 → Deploy to VPS → Run workflow

**首次配置（一次性）**：到 GitHub 仓库 Settings → Secrets and variables → Actions，添加：

| Secret | 获取方式 |
|--------|----------|
| `VPS_SSH_KEY` | `cat ~/.ssh/id_ed25519`（私钥内容） |
| `VPS_KNOWN_HOSTS` | `ssh-keyscan 162.14.113.44`（输出内容） |

**安全设计**：
- 不碰 `server/data/` 和 `.env`（数据文件和环境变量保持不变）
- 健康检查失败时自动回滚到上一版本
- 仅更新 `dist/` 构建产物，不拉取源码到 VPS

### 一键数据同步（本地 → VPS）

```bash
# 在 chexian-api 目录执行
./deploy/sync-data.sh                   # 自动同步最新 Parquet
./deploy/sync-data.sh 某文件.parquet     # 指定文件
```

脚本自动完成：找到最新 `.parquet` → scp 上传 → chmod 600 → PM2 重启 → 健康检查。

### 部署相关文件

| 文件 | 说明 |
|------|------|
| `.github/workflows/deploy.yml` | 自动部署 workflow（push to main 触发） |
| `deploy/sync-data.sh` | 一键数据同步脚本 |
| `deploy/vps-deploy.sh` | VPS 全量部署脚本（首次部署用） |
| `DEPLOYMENT_GUIDE.md` | 完整部署步骤文档 |
| `vps.md` | VPS 运维手册（SSH/PM2/Nginx/备份/常用命令） |
| `server/src/middleware/audit.ts` | 审计日志中间件 |
| `server/src/utils/security.ts` | 文件名安全校验（支持中文） |

---

## 13. AI 协作行为规范（CRITICAL - 基于 Insights 分析）

> **来源**：Claude Code Insights 分析报告（2026-02-18），基于 36 个会话、319 条消息的使用数据。
> **目的**：减少 18 次"方法错误"摩擦事件，提升协作效率。

### Git 工作流规范

| 规则 | 说明 |
|------|------|
| **立即执行，禁止空转** | 执行 Git 操作（commit、push、PR）时，直接执行命令。禁止用分析计划或摘要代替实际操作 |
| **推送前检查大文件** | `git push` 前必须检查 >100MB 的文件。发现后用 `git-filter-repo`/BFG 清理历史，或主动配置 Git LFS |
| **分支共同祖先检查** | Push 前检查 feature branch 与 main 是否有共同祖先（`git merge-base`），若无则采用 cherry-pick 策略 |

### 安全操作规范

| 规则 | 说明 |
|------|------|
| **破坏性操作需确认** | 删除插件、移除集成、修改安全配置前，必须列出影响范围并获得用户明确确认 |
| **禁止整体删除** | 安全加固或重构时，禁止删除整个插件/模块。只能修补，不能拆除 |

### 开发工作流规范

| 规则 | 说明 |
|------|------|
| **先搜再写** | 开发前必须搜索项目中已有的数据源和代码实现，禁止假设"不存在" |
| **Feature Branch 优先** | 修改代码前必须创建 feature branch，遵循项目分支命名约定 |
| **验证优先于声明** | 禁止声称模块"已经可用"而不实际验证 API 调用。必须通过真实请求确认 |

### 性能与效率规范

| 规则 | 说明 |
|------|------|
| **并行优于串行** | 复杂多模块任务必须使用并行 sub-agents（Task 工具），禁止逐个串行检查 |
| **聚焦单任务** | 每次会话专注一个目标，完成并验证后再接下一个。避免多任务并行导致半途而废 |

### 违规判定

| 违规类型 | 判定标准 | 处理方式 |
|---------|---------|---------|
| **空转规划** | Git 操作请求却输出计划文档 | 立即停止，直接执行命令 |
| **盲目声称** | 声称功能可用但未验证 | 必须附上实际 API 响应或测试结果 |
| **过度删除** | 安全加固时删除整个模块 | 回滚操作，仅修补漏洞 |
| **串行低效** | 3+ 独立模块逐个检查 | 改为并行 agent 执行 |

---

**变更历史**：
- 2026-02-18：新增§13 AI 协作行为规范（基于 Insights 分析报告，覆盖 Git 工作流/安全操作/开发规范/效率优化）
- 2026-02-18：【全面更新 v2.5】新增 `rateLimiter.ts` 到关键文件清单和护栏；更新SQL生成器（12→16个，新增 cross-sell.ts/cross-sell-summary.ts/marketing-report.ts）；更新功能模块（14→15个，新增车驾意推介率+四象限散点图）；更新仪表盘 Hooks 清单（新增10个专用 Hooks）；新增安全整改待办（B201-B204）；更新数据文件引用（0214）；新增渲染循环和日期序列化异常处理教训
- 2026-02-16：新增 `.github/workflows/deploy.yml` 自动部署 workflow（push to main 触发构建+部署+健康检查+自动回滚），更新§12文档
- 2026-02-15：新增§12生产部署与数据同步章节，创建 `deploy/sync-data.sh` 一键同步脚本
- 2026-02-15：【生产部署】完成腾讯云 VPS 部署（`https://chexian.cretvalu.com`），修复6个部署问题（ESM 导入缺 .js 扩展名、ESM __dirname 不可用、req.path vs req.originalUrl、types 目录导入、Nginx IP 白名单、sanitizeFilename 中文文件名支持），新增审计日志中间件（`server/src/middleware/audit.ts`），配置 SSL/备份/日志轮转
- 2026-02-13：【文档同步】更新§5功能模块清单（13→14个，补充Auth/Pages模块）、§5数据链路补充SQL生成器层（14个模块）和完整路由清单（5个路由文件）、§7命令索引升级v2.3（23→30个命令）、§7 Subagents更新（4→14个）、更新最新数据文件路径（0212.parquet）、补充筛选器API端点
- 2026-02-07：从 chexianYJFX 拆分为 API 版，移除所有 Local/DuckDB-WASM 相关内容
- 2026-02-04 PM：【血泪教训】新增§1.5双模式架构与启动协议，记录三层状态陷阱（DataContext.isDataLoaded vs duckdbClient.isDataLoaded() vs 组件isInitialized）、正确的数据启用判断模式、防御性编码规范、排查清单；修复PremiumDashboard.tsx/Dashboard.tsx的双模式支持、LineChart.tsx空值防护
- 2026-02-04 AM：【架构修复】新增§2.6启动与架构验证协议，修复前端Hooks双模式支持（useDashboardData.ts支持API/Local模式自动切换），更新§5数据处理链路文档（添加双模式架构说明、API模式数据链路、Hook双模式适配关键实现），新增`dev:full`统一启动命令
- 2026-01-20：新增§10 GitHub Actions集成章节（Boris Cherny工作流高级技巧），包含claude-code.yml workflow、@claude标记规范、&符号会话移交、--teleport云端切换、session-start hook配置
- 2026-01-19：新增§2.5实现前检查协议（防止重复造轮子），包含三问原则、组件注册表、全局样式设定、数据格式化规范（件数整数/均值1位小数/比率1位小数/保费万元整数/图表无单位）、检查点清单
- 2026-01-16：【全面更新】测试覆盖扩展（30套件/593用例）、新增13个功能模块（coefficient/cost/premium-report/marketing-report等）、Claude命令索引v2.1（23个命令）、新增数据工具套件（/data-tools 8个Python工具）、新增开发工具命令（/performance-audit、/ui-review、/test-coverage、/cost-analysis）
- 2026-01-15：实现营销保费报表功能、保费报表页面功能、数据管理工具套件与已赚保费计算优化
- 2026-01-14：实现现代侧边栏布局与功能菜单系统、成本分析四子板块功能（赔付率/费用率/综合费用率/变动成本率）
- 2026-01-13：实现PDF/PPT导出功能、业务员保费计划数据集成、新增质量业务分析字段支持、商车自主定价系数监控优化
- 2026-01-12：新增商车自主定价系数监控板块（Phase 1-3）、建立缺口清单协议、多项核心功能增强与性能优化、视角系统简化、增长对比分析面板增强
- 2026-01-11 12:00：【重大更新】版本号校正（与package.json同步）、测试覆盖更新（14套件/273+测试）、新增NL2SQL智能查询、新增session-manager子代理、扩展关键特性（增强型KPI卡片、高级筛选器）
- 2026-01-11 04:30：新增§9多Agent并发协作协议，解决PR批量merge冲突问题（ROOT-CAUSE-001）
- 2026-01-08 20:30：更新技术栈版本号、补全测试覆盖（新增sql-validator/natural-week测试）、添加CI/CD说明、扩展数据处理链路（增加多视图和专项分析）、更新关键特性清单
- 2026-01-08 早期：新增验证协议，引入技术栈声明，记录 DuckDB 实测教训；实现交互式SQL查询（B020）、营业货车专项分析（B022/B023/B025）
- 2026-01-07 22:00：新增 Claude Code 工作流集成章节（Slash Commands、Subagents、数据准备）；补充测试覆盖说明
- 2026-01-07 16:00：协作操作系统化加固，建立三大索引 + 两本账 + 护栏机制
