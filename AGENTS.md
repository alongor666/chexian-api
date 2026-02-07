# AI Agents 协作指南 (AGENTS.md)

本文件是本仓库的 **AI Agent 协作操作系统**，用于统一角色边界、工作流程与交付约束。遵循本文件与顶层指令的优先级要求。

---

## 0. 适用范围与优先级
- **适用范围**：仓库根目录及其所有子目录（除非存在更深层的 AGENTS.md）。
- **优先级**：System/Developer/User 指令 > 更深层 AGENTS.md > 本文件。

---

## 1. 启动前必读（3分钟）
### 技术栈与全局约定（强制）
- 技术栈声明（修改代码前必读）：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- 开发者全局约定（DC-001/日期口径等）：[开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)

### 三大索引
- [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md) - 核心模块、关键文件
- [DATA_INDEX](./开发文档/00_index/DATA_INDEX.md) - ⭐ 字段定义、业务规则、分析场景
- [PROGRESS_INDEX](./开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、证据链
- [Plans 状态快照](./.claude/plans/STATUS_SNAPSHOT.md) - plans 目录计划完成度索引（先看快照，避免全文搜索）

### 两本账
- [BACKLOG.md](./BACKLOG.md) - 需求账本（唯一真理来源）
- [PROGRESS.md](./PROGRESS.md) - 进展账本（里程碑、阻塞）

### 核心工作记录
- [缺口清单.md](./开发文档/缺口清单.md) - **AI工作缺口记录（规划前必查）**
  - 记录规划/开发中发现的信息缺失
  - 避免重复发现，追踪解决进度
  - **核心原则**：没有完备信息 = 不能开始开发
- 数据知识协议（数据处理任务必读）：[.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)
  - 唯一事实源（字段定义/业务规则）：[车险数据业务规则字典.md](./数据管理/knowledge/rules/车险数据业务规则字典.md)
  - 快速参考（~200 tokens）：[QUICK_REFERENCE.md](./数据管理/knowledge/QUICK_REFERENCE.md)

### Parquet 表结构知识库（AI SQL 必读）
- ⭐ **[PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md)** - AI 必须 100% 掌握
  - 完整表结构与数据类型（30个字段）
  - 每个字段的值域范围与枚举值
  - 自然语言关键词 → SQL 字段映射
  - 常见查询模式与隐私保护规则
  - **用途**：NL2SQL 语义理解、用户意图识别

### 辅助指南
- [WORKFLOW.md](./WORKFLOW.md) - Claude Code 工作流与可用命令
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) - 当前应用测试流程与数据说明
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - 常见问题排查
- [GOVERNANCE_DELIVERY.md](./GOVERNANCE_DELIVERY.md) - 治理交付与审计要求

---

## 2. 代码库结构速览
- `src/`：业务代码与核心逻辑（前端与数据处理）
  - `src/app/`：应用入口与全局样式（`main.tsx`, `App.tsx`）
  - `src/components/` / `src/widgets/`：通用 UI 组件与复用控件
  - `src/features/`：业务功能模块与页面逻辑
  - `src/shared/`：数据加载、校验、SQL 生成、DuckDB Worker 通信
  - `src/services/`：业务服务与数据访问封装
  - `src/workers/`：Web Worker 相关实现（含 DuckDB/Arrow 管道）
  - `src/charts/`：图表渲染封装
  - `src/core/`：通用基础能力（日志、格式化、通用逻辑）
  - `src/types/`：全局类型定义
- `tests/`：Vitest 测试用例与测试工具
- `scripts/`：治理与自动化脚本
- `开发文档/`：业务规则、架构说明、索引与任务进度
- `docs/`：补充说明文档与规范
- `reference/`：参考资料与历史记录
- `CC工作流复刻/`：Claude Code 工作流复刻与示例
- `签单清洗/`：示例数据与数据处理脚本
- `BACKLOG.md` / `PROGRESS.md`：需求与进度账本

**关键模块**
- `src/shared/`：数据加载、校验、SQL 生成、DuckDB Worker 通信
- `src/features/`：业务功能模块与页面逻辑
- `src/widgets/`：复用 UI 组件
- `src/shared/sql/kpi.ts`：KPI 业务口径 SQL 模板
- `src/shared/normalize/mapping.ts`：字段映射/别名规则
- `src/shared/duckdb/client.ts`：DuckDB 连接与视图定义

---

## 2.1 入口与运行方式（常用定位点）
- 应用入口：`src/app/main.tsx`，根组件：`src/app/App.tsx`
- Vite 配置：`vite.config.ts`
- 测试入口：`tests/*.test.ts`，测试初始化：`tests/setup.ts`
- Worker 通信：`src/shared/duckdb/` 与 `src/workers/`

---

## 3. 工作流程（状态机 + 交付约束）
### 状态机
```
PROPOSED → TRIAGED → IN_PROGRESS → DONE
                         ↓
                      BLOCKED → (解决后回到 IN_PROGRESS)
                         ↓
                    DEPRECATED
```

### 任务开始
1. 阅读 §1 的索引与账本。
2. 在 BACKLOG.md 领取任务并标记为 **IN_PROGRESS**。
3. 填写关联文档与代码位置。

### 开发中
- 必须使用 **Bun** 作为包管理器与执行器。
- 修改核心目录后，同步更新对应 `INDEX.md`（**只可追加条目**）。
- 严格遵守“禁止触碰区域”。

### 完成与交付
1. 任务标记为 **DONE**，补全验收/证据。
2. 运行治理校验：`bun run governance`（等价：`bun run scripts/check-governance.mjs`）。
3. 测试必须执行（推荐：`bun run test`）。

### 常用命令
- 安装依赖：`bun install`
- 本地开发：`bun run dev`
- 构建：`bun run build`
- 预览：`bun run preview`
- 单测（Vitest）：`bun run test`
- 覆盖率：`bun run test:coverage`
- 治理校验：`bun run governance`（等价：`bun run scripts/check-governance.mjs`）
- PR前冲突检测：`bun run scripts/check-write-conflict.mjs`

**测试命令说明（避免踩坑）**：
- `bun run test` 会执行 `package.json#scripts.test`（Vitest，适配本项目的测试与DOM环境）。
- `bun test` 会走 Bun 内置 runner；对包含 DOM/React Testing Library 的测试可能不兼容，优先用 `bun run test`。

---

## 4. 关键护栏（必须遵守）

### 实现前检查协议（防止重复造轮子）

> **核心原则**：写代码前必须检查现有实现，禁止重复造轮子。

**三问原则**（写代码前必答）：

| 问题 | 检查方式 |
|------|----------|
| **已有吗？** | 查 `CODE_INDEX.md` 组件/工具清单 |
| **能复用吗？** | 查 `src/shared/` 通用模块 |
| **有模式吗？** | 查同类实现的代码模式 |

**组件/工具注册表**（强制查询）：

| 类别 | 位置 | 示例 |
|------|------|------|
| **UI组件** | `src/widgets/` | Table、Card、Badge、Button |
| **样式系统** | `src/shared/styles/index.ts` | tableStyles、textStyles、colors |
| **SQL生成器** | `src/shared/sql/` | kpi.ts、trend.ts、cost.ts |
| **工具函数** | `src/shared/utils/formatters.ts` | formatCurrency、formatPercent |

**全局样式设定**（UI开发必用）：

```typescript
// ✅ 正确：使用全局样式
import { tableStyles, textStyles, buttonStyles, cn } from '@/shared/styles';

// ❌ 错误：硬编码样式
className="bg-white rounded-lg shadow-sm"  // 应用 cardStyles.standard
```

**违规判定**：
- ❌ 新建函数但已存在同功能函数 → 必须删除，使用现有
- ❌ 硬编码 Tailwind 类 → 必须使用全局样式
- ❌ 新增通用组件未登记 → 补充 INDEX.md 后方可提交

### 业务口径与架构护栏
- 业务口径文件只可追加，不得修改或删除既有内容。
- Worker 与主线程通信必须使用 Arrow IPC。
- `vite.config.ts` 的 COOP/COEP 头不得删除。

### 数据与测试约定
- Parquet 数据列名必须匹配 `mapping.ts` 中别名规则。
- 测试集中在 `tests/*.test.ts`，集成流程见 `test-integration.ts` 与 `TESTING_GUIDE.md`。

### DC-002 用户筛选优先规则（强制）
**核心原则**：用户设置的筛选条件必须优先于系统默认值。

**规则**：
1. **禁止硬编码日期**：SQL中不得使用 `CURRENT_DATE`、`NOW()`、`CURDATE()` 等函数（除非有 `DC-002 Exception` 注释）
2. **禁止 `||` 运算符**：判断 `filters` 字段时必须使用 `??` 运算符（nullish coalescing）
3. **禁止可选日期参数**：SQL生成器函数不得接受 `startDate?: string` 等可选参数，必须从 `filters` 读取

**正确示例**：
```typescript
// ✅ 正确：使用 ?? 运算符
const endDate = filters.policy_date_end ?? new Date().toISOString().split('T')[0];

// ✅ 正确：使用类型守卫
import { buildDC002QueryFilters } from '../types/dc-002-guard';
const { sqlExpressions } = buildDC002QueryFilters(filters, 'myFunction');
```

**错误示例**：
```typescript
// ❌ 错误：使用 || 运算符
const endDate = filters.policy_date_end || '2026-01-01';

// ❌ 错误：硬编码 CURRENT_DATE
const sql = `WHERE date <= CURRENT_DATE`;

// ❌ 错误：可选日期参数
function generateQuery(filters: AdvancedFilterState, endDate?: string): string {
  // ...
}
```

**检测与验证**：
- 运行治理检查：`bun run scripts/check-governance.mjs`（第6项）
- 单元测试：`bun test tests/dc-002-compliance.test.ts`
- 类型守卫：使用 `src/shared/types/dc-002-guard.ts` 中的工具函数

**例外处理**：如必须使用硬编码日期（如YTD查询获取当前年份），需添加注释：
```sql
-- DC-002 Exception: YTD查询需要动态获取"当前年份"
WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)
```

**详细文档**：[开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md](./开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md)

---

## 4.1 代码与提交规范（面向 AI 助手）
- 使用 TypeScript/React/Vite/Tailwind 技术栈；保持函数/组件命名清晰。
- 仅在需要时增加依赖，且通过 `package.json` 记录。
- 避免在导入语句外包裹 try/catch（与系统约束一致）。
- 提交前确保 lint/测试与治理校验满足任务要求。

## 5. 角色定义与边界
### 5.1 开发 Agent (Developer Agent)
**职责**：实现功能、修复 Bug、编写测试。

**可读入口**：
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md)
- [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md)
- [BACKLOG.md](./BACKLOG.md)
- `src/*/README.md`

**必须回写位置**：
1. BACKLOG.md 中对应任务状态
2. 关联文档、关联代码、验收/证据
3. 新增文件对应 `INDEX.md`
4. 发现信息缺口时，立即在 `开发文档/缺口清单.md` 中登记
5. 验证用户提供的信息，更新缺口状态

**禁止触碰区域**：
- ❌ `src/shared/normalize/mapping.ts` - 只能追加，不能删除/修改
- ❌ `src/shared/sql/kpi.ts` - 只能追加新模板，不能改已有逻辑
- ❌ `src/shared/duckdb/client.ts:78-95` - PolicyFact 视图定义（需产品确认）
- ❌ 所有 `*.md` 索引文件 - 只能补充条目，不能删除已有内容

### 5.2 文档 Agent (Documentation Agent)
**职责**：编写/更新文档、维护索引、补充注释。

**可读入口**：
- [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md)
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md)
- `src/*/README.md`

**必须回写位置**：
1. `src/*/README.md` 补充/更新文档
2. 对应 `INDEX.md` 登记新增文档
3. BACKLOG.md 标记文档任务为 DONE（附文档路径作为证据）
4. 维护 `开发文档/缺口清单.md` 的格式规范
5. 定期整理已完成缺口，提取可复用的知识

**禁止触碰区域**：
- ❌ 业务口径定义（如 `mapping.ts` 中的 DEFAULT_MAPPING 注释）- 只能解释，不能修改
- ❌ 删除已有索引条目 - 只能追加，不能删除

### 5.3 测试 Agent (Testing Agent)
**职责**：编写/维护单元测试、集成测试、生成测试报告。

**可读入口**：
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md)
- `tests/*.test.ts`
- `src/shared/sql/kpi.ts`
- `src/shared/normalize/validator.ts`

**必须回写位置**：
1. `tests/` 中的测试文件
2. BACKLOG.md 更新测试任务状态
3. 验收证据包含 `bun test` 输出截图/文本

**禁止触碰区域**：
- ❌ 生产代码（除非修复明确的 Bug）
- ❌ 业务口径定义（测试应覆盖现有口径，不应修改口径）

### 5.4 治理 Agent (Governance Agent)
**职责**：维护治理体系、更新索引、校验证据链、执行审计。

**可读入口**：
- `开发文档/00_index/*.md`, `src/*/INDEX.md`, `scripts/INDEX.md`
- [BACKLOG.md](./BACKLOG.md)
- [PROGRESS.md](./PROGRESS.md)
- `scripts/check-governance.mjs`

**必须回写位置**：
1. 所有 INDEX.md（补充缺失条目）
2. BACKLOG.md 中 DONE 任务的证据链
3. PROGRESS.md 记录里程碑、阻塞
4. 审计 `开发文档/缺口清单.md` 的完整性和状态准确性
5. 识别长期未解决的缺口，提出替代方案

**允许触碰但需谨慎**：
- ✅ 治理文件（CLAUDE.md, AGENTS.md, BACKLOG.md, PROGRESS.md, INDEX.md）
- ✅ 校验脚本（scripts/check-governance.mjs）
- ⚠️ 必须保持向后兼容

**禁止触碰区域**：
- ❌ 业务代码（`src/` 下的 `.ts/.tsx` 文件）
- ❌ 业务口径定义（mapping.ts, kpi.ts 等）

### 5.5 架构师 Agent (Architect Agent)
**职责**：设计架构、评审技术方案、制定重构计划。

**可读入口**：
- [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md)
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md)
- `src/shared/duckdb/README.md`
- `src/features/dashboard/README.md`

**必须回写位置**：
1. `开发文档/` 下 ADR 文档（可选）
2. BACKLOG.md 添加重构任务（状态=PROPOSED）
3. 对应模块 README.md 更新

**禁止触碰区域**：
- ❌ 直接修改代码（应提供方案，由 Developer Agent 实施）
- ❌ 修改业务口径（只能建议，需产品确认）

---

## 6. 协作冲突与异常处理
### 并发修改同一任务
- BACKLOG.md 中同一任务只允许一个 Agent 标记为 IN_PROGRESS。
- 若已被占用：选择其他任务或等待；超 24 小时未更新则在 PROGRESS.md 标记 BLOCKED。

### 多Agent并发协作（任务ID范围）
任务ID范围用于降低并发写 `BACKLOG.md` 的冲突风险（治理校验会强制检查范围合法性）：
- `@user`：B001-B099
- `@claude`：B100-B199
- `@codex`：B200-B299
- `@gemini`：B300-B399
- `@trae`：B400-B499
- `@kilo`：B500-B599
- `@codebuddy`：B600-B699

### 发现业务口径错误
1. 在 BACKLOG.md 添加新任务（状态=BLOCKED）
2. 标注“需产品确认”
3. 在 PROGRESS.md 第 2 节补充详情

### 索引不一致
- `bun run scripts/check-governance.mjs` 会检测；失败时由 Governance Agent 统一修复。

---

## 7. 异常情况处理矩阵

| 异常 | Developer | Documentation | Testing | Governance | Architect |
|------|-----------|---------------|---------|------------|-----------|
| 业务口径错误 | ❌ 不能改<br>📝 标记 BLOCKED | ❌ 不能改<br>📝 标记 BLOCKED | ❌ 不能改<br>✅ 可补充测试 | ✅ 可审计<br>📝 升级处理 | ✅ 可建议<br>📝 需产品确认 |
| 架构缺陷 | 📝 标记 PROPOSED | 📝 补充文档说明 | 📝 补充测试覆盖 | 📝 审计风险 | ✅ 可设计方案 |
| 测试缺失 | ✅ 可补充测试 | 📝 补充测试文档 | ✅ 负责补充 | 📝 审计覆盖率 | 📝 建议测试策略 |
| 文档缺失 | 📝 可创建简单文档 | ✅ 负责补充 | 📝 补充测试说明 | ✅ 审计完整性 | 📝 补充架构文档 |
| 索引不一致 | ✅ 可修复 | ✅ 可修复 | ❌ 不负责 | ✅ 负责修复 | ✅ 可修复 |

---

**变更历史**：
- 2026-01-19：新增实现前检查协议（防止重复造轮子），包含三问原则、组件注册表、全局样式设定
- 2026-01-08：重构结构与流程描述，去除重复段落并对齐最佳实践
- 2026-01-07：建立多 Agent 协作操作系统，定义 5 种角色权限边界
