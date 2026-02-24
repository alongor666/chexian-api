
# GEMINI.md

**协作操作系统**：GEMINI 工作前必读协议。

---


## 0.1 指挥-执行极简快照（新增，保留原架构）

> 快速记忆：**先搜后写，先证据后结论，单目标闭环**。

- 角色：指挥者定目标；执行者做实现/验证/证据。
- 流程：目标一句话 → 全库检索 → 最小改动 → 三层验证 → 证据回写。
- 禁止：未检索开发、未验证宣称、破坏式重构。

## 0. AI 行为红线（ZERO TOLERANCE）

> 来源：Claude Code 使用洞察报告（36 会话 / 319 消息）

- **执行不规划**：涉及 Git 操作（commit/push/PR）直接执行命令，禁止用规划或摘要替代执行
- **先搜再写**：写代码前必须全库搜索，禁止假设“模块不存在”
- **验证不声称**：禁止声称“已可用”，必须通过真实 API 请求或浏览器验证
- **修补不拆除**：安全加固/重构时禁止删除整块插件或集成，只能修补
- **排版合规要求 (DC-003)**：严禁在 UI 层面硬编码 Tailwind 色值或虚构 CSS 类，必须通过 `import { colorClasses, fontStyles, cardStyles } from '@/shared/styles'` 获取样式。
- **并行不串行**：3+ 独立模块任务必须并行执行 subagents
- **聚焦不发散**：单次会话只完成一个明确目标，完成并验证后再继续

### Git 安全检查（推送前必做）

```bash
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1 == "blob" && $3 > 104857600 {print $3, $4}'
git merge-base main HEAD || echo "WARNING: no common ancestor"
```

## 📖 快速导航

| 我想...                        | 查看章节                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 🚨**遵守行为红线**       | →[§0 AI 行为红线](#0-ai-行为红线zero-tolerance)                                                            |
| 🎯**开始新任务**         | →[§1 必经入口](#1-必经入口critical---每次任务开始前必读) - 三大索引 + 两本账                               |
| 🚫**了解禁止修改的文件** | →[§2 护栏](#2-护栏red-line---以下文件禁止擅自修改) - 业务口径定义、架构协议                                |
| ✅**提交代码前检查**     | →[§3 交付协议](#3-交付协议must---完成任务的硬性要求) - DONE 判定、治理校验                                 |
| 🛠️**查看技术栈和命令** | →[§4 项目技术栈](#4-项目技术栈快速参考) - Bun 命令、测试                                                   |
| 🔄**理解数据处理流程**   | →[§5 数据处理链路](#5-数据处理链路快速理解架构) - 从上传到渲染                                             |
| ✅**验证代码质量**       | →[§6 验证协议](#6-验证协议critical---禁止自我安慰式开发) - 强制三层验证                                    |
| 🤖**使用自动化工具**     | →[§7 Claude Code 工作流](#7-claude-code-工作流集成) - Slash Commands、Subagents                            |
| ⚠️**遇到问题**         | →[§8 异常情况处理](#8-异常情况处理) - 口径错误、阻塞、文档缺失                                             |
| 🔀**多Agent协作**        | →[§9 多Agent并发协作协议](#9-多agent并发协作协议critical---防止merge冲突) - 文档分区、任务ID预留、PR前检查 |

---

## 1. 必经入口（CRITICAL - 每次任务开始前必读）

### 技术栈声明（第一优先级）

⚠️ **所有开发任务开始前必读**：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)

- 了解项目技术栈特性（DuckDB-WASM、React、Vite）
- 查看架构强制入口（修改代码前必读文件列表）
- 掌握验证协议（单元测试 → 浏览器实测 → 用户验收）

### 开发者全局约定（强制遵守）

⚠️ **所有代码和文档必须遵守**：[开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)

- **DC-001**：数据分析三要素强制前置（分析年度、数据口径、时间段）
- 禁止硬编码日期口径（签单日期/起保日期必须通过状态管理）
- 所有报表/查询必须提供三要素选择器，缺一不可

### 三大索引（5分钟快速定位）

1. **文档索引**: [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档、指标口径
2. **代码索引**: [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md) - 核心模块、关键文件、禁止修改区域
3. **数据索引**: [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md) - ⭐ 字段定义、业务规则、分析场景
4. **进展索引**: [开发文档/00_index/PROGRESS_INDEX.md](./开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、证据链规则、接力入口

### 数据知识协议 (DATA-KNOWLEDGE-PROTOCOL)

⚠️ **所有数据处理任务必读**: [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)

- **分层加载策略**: 第1层快速索引(200tokens) → 第2层业务规则摘要(500tokens) → 第3层完整字典(按需)
- **唯一事实源**: [签单清洗/车险数据业务规则字典.md](./签单清洗/车险数据业务规则字典.md) - 所有字段定义、业务规则
- **快速参考**: [签单清洗/QUICK_REFERENCE.md](./签单清洗/QUICK_REFERENCE.md) - 200 tokens速查表
- **分析价值矩阵**: [签单清洗/字段分析价值矩阵.md](./签单清洗/字段分析价值矩阵.md) - 8大分析维度、30+SQL示例

**数据协作最佳实践**:

- ✅ 简单任务: 仅加载快速参考(200tokens)
- ✅ 中等任务: 快速参考 + 业务规则摘要(700tokens)
- ✅ 复杂任务: 按需加载完整字典(验证阶段)
- ✅ 跨会话接力: 通过PROGRESS.md复用上下文

### 两本账（唯一真理来源）

1. **需求账本**: [BACKLOG.md](./BACKLOG.md) - 所有任务状态追踪（PROPOSED → DONE）
2. **进展账本**: [PROGRESS.md](./PROGRESS.md) - 里程碑、阻塞、下一步行动

---

## 2. 护栏（RED LINE - 以下文件禁止擅自修改）

### 业务口径定义（不可改，只能追加且需证据）

| 文件                                  | 原因                            | 如需变更                                                                                                 |
| ------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/shared/normalize/mapping.ts`   | 列名映射规则（指标口径）        | ❌ 不得删除已有别名 `<br>`✅ 只能追加新别名 `<br>`📝 需在 BACKLOG.md 登记（状态=PROPOSED）并提供证据 |
| `src/shared/sql/kpi.ts`             | KPI 计算逻辑（业务规则）        | ❌ 不得修改已有 SQL 模板 `<br>`✅ 只能追加新模板 `<br>`📝 需在 BACKLOG.md 登记并提供证据             |
| `src/shared/duckdb/client.ts:78-95` | PolicyFact 视图定义（去重规则） | ❌ 涉及业务口径，需产品确认 `<br>`📝 需在 BACKLOG.md 登记并提供产品确认证据                            |

### 架构协议（不可破坏）

- **Arrow IPC 协议**：Worker 与主线程通信必须使用 Arrow IPC，禁止 JSON 序列化
- **CORS 配置**：`vite.config.ts` 的 COOP/COEP 头不得删除（DuckDB-WASM 强制要求）
- **Bun 包管理器**：禁止使用 npm/yarn/pnpm（项目统一使用 Bun）

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

**核心技术**：

- Frontend: React 18.3.1 + TypeScript 5.9.3 + Vite 5.4.21
- Styling: Tailwind CSS 3.4.19 + PostCSS
- Analytics: DuckDB-WASM 1.32.0 + Apache Arrow 17.0.0
- Charts: ECharts 5.6.0 + echarts-for-react 3.0.5
- Testing: Vitest 2.1.9
- Editor: Monaco Editor 4.7.0 (SQL 编辑器)
- Export: ExcelJS 4.4.0
- Routing: React Router DOM 7.12.0

**包管理器**：Bun（⚠️ 必须使用 `bun install`, `bun run dev` 等）

**关键命令**：

```bash
bun install         # 安装依赖
bun run dev:full    # ✅ 一键启动前后端（联动 start.mjs 自动清理旧端口）
bun run dev         # 仅启动前端（需确认后端已可用）
bun run build       # 类型检查 + 生产构建
bun test            # 运行单元测试
bun run governance  # 治理校验（简写）
bun run scripts/check-governance.mjs  # 治理校验（完整路径）
```

**启动联动机制（必须）**：
- `bun run dev:full` 会调用 `scripts/start.mjs --all`
- 启动前自动清理常见旧端口占用（`3000`, `5173-5176`）
- 发生端口冲突时，不允许只报告；必须完成清理并重试至后端可用

**测试覆盖**（14个测试套件，273+ 单元测试）：

- `tests/mapping.test.ts` - 列名映射和别名解析（多别名支持）
- `tests/validator.test.ts` - 数据验证和质量检查
- `tests/kpi.test.ts` - KPI SQL 生成和业务规则
- `tests/kpi-detail.test.ts` - KPI 详细数据分解（环形图数据源）
- `tests/security.test.ts` - 安全性测试（XSS、SQL注入、CORS等）
- `tests/sql-validator.test.ts` - SQL查询安全校验（只读+聚合强制）
- `tests/natural-week.test.ts` - 自然周计算逻辑
- `tests/formatters.test.ts` - 数字格式化工具（保费、占比、通用数字）
- `tests/logger.test.ts` - 日志系统测试
- `tests/renewal.test.ts` - 续保业务逻辑测试
- `tests/org-salesman-linkage.test.ts` - 机构-业务员联动测试
- `tests/date-range-picker.test.ts` - 日期范围选择器测试
- `tests/nl2sql-rule-engine.test.ts` - 自然语言转SQL规则引擎测试
- `tests/template-engine.test.ts` - SQL模板引擎测试

**CI/CD**：

- GitHub Actions 自动治理校验（`.github/workflows/governance-check.yml`）
- PR 前自动运行 5 项治理检查

---

## 5. 数据处理链路（快速理解架构）

```
用户上传 Parquet
  ↓
src/shared/duckdb/client.ts:loadParquet()        # 加载文件
  ↓
src/shared/normalize/validator.ts:validateSchema() # 列名校验（别名解析）
  ↓
src/shared/duckdb/client.ts:78-95                # 创建 PolicyFact 视图（MAX去重）
  ↓
src/shared/sql/*.ts                               # 生成 SQL（kpi/trend/truck/growth）
  ↓
src/shared/duckdb/worker.ts:query()              # Worker 执行（返回 Arrow IPC）
  ↓
src/features/dashboard/*                          # UI 渲染
    ├─ PremiumDashboard.tsx                      # 主仪表盘（KPI、趋势、分析）
    ├─ TruckAnalysisPanel.tsx                     # 营业货车专项分析
    └─ sql-query/SqlQueryPanel.tsx                # 交互式SQL查询
```

**关键特性**：

- **多视图支持**：业绩看板 + SQL查询 + 营业货车专项 + 增长分析
- **时间维度**：日/自然周/自然月/年度趋势分析
- **智能查询**：
  - Monaco编辑器 + 只读安全校验
  - NL2SQL自然语言转SQL（支持中文语义理解）
  - 8个预置查询模板 + 参数化模板引擎
- **专项分析**：
  - 营业货车按吨位分段 + 下钻式堆叠柱状图
  - 增强型KPI卡片 + SVG环形图可视化
  - 机构-业务员联动筛选
- **高级筛选**：
  - 日期范围选择器（默认今年至今YTD）
  - 多选下拉框（机构/业务员/客户类别/险别组合）
  - 同城/异地机构快速分类按钮

---

## 6. 验证协议（CRITICAL - 禁止自我安慰式开发）

**教训来源**：2026-01-08 自然周/月视图实现，未浏览器实测导致多次返工。

### 强制三层验证

```
第1层：单元测试（bun test）
  ↓  验证 SQL 生成逻辑语法正确
第2层：浏览器实测（Chrome DevTools）
  ↓  验证 DuckDB 实际执行结果
第3层：用户验收（人工确认）
  ↓  验证功能符合需求
```

**详细验证步骤**：见 [开发文档/TECH_STACK.md § 4](./开发文档/TECH_STACK.md#4-通用验证协议所有开发必须遵守)

### 特别提醒

| 场景              | 必须执行                                                            |
| ----------------- | ------------------------------------------------------------------- |
| 修改 SQL 生成逻辑 | ✅ 单元测试通过 → ✅**打开 Chrome Console 验证实际执行结果** |
| SQL 报错          | ✅ 复制完整错误信息 → ✅ 查看 `client.ts:78-95` 字段类型定义     |
| 日期时间处理      | ✅ 先 `CAST(field AS DATE)` → ✅ 查看 DuckDB 日期函数文档        |
| 功能开发完成      | ✅ 截图 Console 输出 → ✅ 记录关键字段实际值                       |
| 启动异常（仅前端/端口冲突） | ✅ 执行 `bun run dev:full` 自动清理旧端口 → ✅ 必要时手动释放后重试 |

**执行标准**：
- 不允许“只自检不修复”。发现环境问题后，必须推进到后端健康可访问再结束任务。

---

## 7. Claude Code 工作流集成

**自动化工具箱**：项目已集成 Claude Code Slash Commands 和 Subagents，位于 `.claude/` 目录。

### 可用的 Slash Commands

**完整命令索引**: [.claude/commands/README.md](./.claude/commands/README.md)

#### Git 工作流 (2个)

| 命令                 | 功能                      | 使用场景                                                |
| -------------------- | ------------------------- | ------------------------------------------------------- |
| `/commit-push-pr`  | Git 提交 + 推送 + 创建 PR | 完成功能开发后，自动生成语义化 commit message 并创建 PR |
| `/sync-and-rebase` | 同步并 Rebase             | 每天开始工作前、创建 PR 前同步最新代码                  |

#### 数据分析 (2个)

| 命令               | 功能             | 使用场景                                                  |
| ------------------ | ---------------- | --------------------------------------------------------- |
| `/data-analysis` | 车险数据深度分析 | 对已加载的 Parquet 数据执行多维度分析，生成 Markdown 报告 |
| `/weekly-report` | 董事会级周报生成 | 生成业务周报（KPI、趋势、异常预警）                       |

#### 开发工具 (3个)

| 命令                   | 功能         | 使用场景                                      |
| ---------------------- | ------------ | --------------------------------------------- |
| `/security-review`   | 代码安全审查 | 全面检查 XSS、SQL注入、CORS 等安全漏洞        |
| `/session-manager`   | 会话历史管理 | 查看、搜索、重命名、导出 Claude Code 对话历史 |
| `/extract-knowledge` | 知识提取     | 提取对话中的隐性知识并结构化归档到知识库      |

#### 项目管理 (1个)

| 命令              | 功能       | 使用场景                             |
| ----------------- | ---------- | ------------------------------------ |
| `/init-project` | 项目初始化 | 快速初始化新项目结构（仅用于新项目） |

**使用示例**：

```bash
# Git 工作流
/sync-and-rebase                    # 每天开始前同步代码
/commit-push-pr                     # 完成开发后提交并创建 PR

# 数据分析
/data-analysis --dimensions 机构,业务员 --start 2025-10-01
/weekly-report --period week --number 50

# 开发工具
/security-review --target src/shared
/session-manager --search "KPI分析"
/extract-knowledge --focus business-rules
```

### 可用的 Subagents

| Subagent            | 功能               | 调用场景                       |
| ------------------- | ------------------ | ------------------------------ |
| `code-simplifier` | 代码简化和重构建议 | 发现冗余代码、复杂逻辑时       |
| `data-validator`  | 数据质量深度校验   | 数据加载后验证完整性、一致性   |
| `verify-app`      | 应用功能验证       | 发布前全面检查应用功能是否正常 |
| `session-manager` | 会话管理和任务追踪 | 管理多轮对话、追踪任务进度     |

**位置**：`.claude/subagents/*.md`

### 数据准备

**示例数据位置**：`签单清洗/` 目录

- `优化处理后的业务数据.parquet` - 已清洗的业务数据（可直接上传测试）
- `Excel转Parquet优化处理脚本.py` - Excel → Parquet 转换脚本
- `数据质量验证脚本.py` - 数据质量检查脚本

**数据格式要求**：

- 必须是 Parquet 格式
- 列名必须匹配 `src/shared/normalize/mapping.ts` 中的别名（支持中英文）
- 必需字段：`policy_no`, `premium`, `org_name`, `salesman_name`

---

## 8. 异常情况处理

| 情况               | 处理方式                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| 发现业务口径错误   | ❌ 禁止直接修改 `<br>`📝 在 BACKLOG.md 添加任务（状态=BLOCKED），标注"需产品确认"   |
| 需要重构核心逻辑   | 📝 在 BACKLOG.md 添加任务（状态=PROPOSED），提供重构理由和影响范围                    |
| 遇到阻塞无法继续   | 📝 在 BACKLOG.md 将任务状态改为 BLOCKED `<br>`📝 在 PROGRESS.md 第 2 节补充阻塞详情 |
| 发现缺失文档       | ✅ 直接创建文档 `<br>`📝 在对应 INDEX.md 登记                                       |
| SQL 执行失败       | ✅ 查看 Chrome Console 完整错误 → ✅ 检查字段类型 → ✅ 查 DuckDB 文档               |
| 不确定 DuckDB 语法 | ✅ 先查[DuckDB 官方文档](https://duckdb.org/docs/) → ❌ 禁止猜测                        |
| 启动时仅前端可用/后端缺失 | ✅ 先执行 `bun run dev:full`（自动端口清理） → ✅ 检查 3000 端口占用并释放后重试 |

---

---

## 9. 多Agent并发协作协议（CRITICAL - 防止merge冲突）

**问题背景**：2026-01-11发现多个PR (#51, #49, #48, #43) 因BACKLOG.md冲突无法合并
**根本原因**：Claude、Codex、Gemini同时在BACKLOG.md末尾追加任务，缺乏协调机制
**解决方案**：文档分区 + 任务ID预留 + PR前强制检查

详细分析见：[开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md](./开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md)

### 9.1 文档写入分区（强制遵守）

| 文档                   | 写入权限  | 读取权限  | 冲突策略                      |
| ---------------------- | --------- | --------- | ----------------------------- |
| BACKLOG.md             | 所有Agent | 所有Agent | 使用merge-backlog.mjs工具合并 |
| CLAUDE.md § 1-8       | @user     | 所有Agent | 只读，禁止修改                |
| CLAUDE.md § 9         | @user     | 所有Agent | 只读，禁止修改                |
| PROGRESS.md            | 所有Agent | 所有Agent | 追加+时间戳，注明Agent ID     |
| 索引文件 (DOC_INDEX等) | 所有Agent | 所有Agent | 分区写入（见§9.3）           |

**关键规则**：

- ❌ 禁止修改其他Agent的工作区内容
- ✅ 允许追加到公共文档（需添加Agent标识）
- ⚠️ PR前必须运行 `bun run scripts/check-write-conflict.mjs`

### 9.2 任务ID分配规则

**防止ID冲突**，每个Agent使用独立ID范围：

| Agent    | ID范围    | 当前使用  | 示例          |
| -------- | --------- | --------- | ------------- |
| @user    | B001-B099 | B001-B055 | B056, B057... |
| @claude  | B100-B199 | 未使用    | B100, B101... |
| @codex   | B200-B299 | 未使用    | B200, B201... |
| @gemini  | B300-B399 | 未使用    | B300, B301... |
| 未来扩展 | B400-B999 | -         | B400-B999     |

**使用规则**：

1. 在BACKLOG.md添加任务时，使用自己的ID范围
2. 归属对象列填写自己的Agent ID（如 `@claude`）
3. 发现ID冲突时，优先使用main分支的任务状态

### 9.3 索引文件分区写入

**示例**：DOC_INDEX.md分区标记

```markdown
## 核心协议（@user专属，Agent只读）
- CLAUDE.md
- AGENTS.md
- GEMINI.md

<!-- @claude-section-start -->
## Claude工作区索引（@claude专属写入）
- 开发文档/TECH_STACK.md
- 开发文档/AI_COLLABORATION.md
<!-- @claude-section-end -->

<!-- @codex-section-start -->
## Codex工作区索引（@codex专属写入）
- .claude/plans/*.md
<!-- @codex-section-end -->
```

**规则**：

- 只能在自己的section内添加/修改内容
- 禁止删除其他section的内容
- 新增section需先通知@user

### 9.4 PR前强制检查（三步骤）

**所有Agent在创建PR前必须执行**：

```bash
# Step 1: 同步main最新更新
git fetch origin main
git rebase origin/main

# Step 2: 运行冲突检测（即将开发）
bun run scripts/check-write-conflict.mjs

# Step 3: 运行治理校验
bun run scripts/check-governance.mjs

# Step 4: 确认所有检查通过后才能创建PR
```

**冲突检测内容**：

- ✅ 当前分支是否基于最新main
- ✅ BACKLOG.md是否有追加冲突
- ✅ 索引文件是否跨区写入
- ✅ 任务ID是否在分配范围内

### 9.5 紧急冲突处理流程

**发现merge冲突时**：

1. ❌ **禁止**：直接在PR中解决冲突并force push
2. ✅ **正确流程**：
   ```
   a. 通知@user（在PR评论区）
   b. 在BACKLOG.md添加BLOCKED任务，说明冲突原因
   c. 等待@user确认修复方案
   d. 使用merge-backlog.mjs工具合并BACKLOG.md
   e. 手动检查其他文件冲突
   f. 更新PR并通知@user验收
   ```

### 9.6 自动化工具

| 工具                     | 功能                                | 使用时机                 |
| ------------------------ | ----------------------------------- | ------------------------ |
| merge-backlog.mjs        | 智能合并BACKLOG.md（去重+状态统一） | merge冲突时              |
| check-write-conflict.mjs | PR前冲突检测                        | 创建PR前（即将开发）     |
| assign-task-id.mjs       | 自动分配Agent专属ID                 | 创建新任务时（即将开发） |

**工具位置**：`scripts/`

---

## 10. 生产部署与数据同步

### 生产环境

| 项目 | 值 |
|------|-----|
| 服务器 | 腾讯云轻量 2核4G（`162.14.113.44`） |
| 域名 | `https://chexian.cretvalu.com` |
| 后端 | PM2 → `chexian-api`（端口 3000，仅内部访问） |
| 前端 | Nginx 静态文件（`/var/www/chexian/frontend/dist`） |
| 安全 | HTTPS + Nginx IP 白名单 + JWT 认证 + 审计日志 |

### 数据更新全链路（Excel → Parquet → VPS）

```bash
# 完整一键链路（推荐）
./数据管理/run.sh full \
  --source 历史数据.xlsx \
  --target 最新数据.xlsx \
  --output 数据管理/warehouse/fact/policy/车险保单综合明细表MMDD.parquet
# 自动执行：续保匹配 → Parquet 转换 → scp 上传 → PM2 重启 → 健康检查

# 仅本地转换，不同步 VPS
./数据管理/run.sh full ... --no-sync

# 单独同步已有 Parquet（跳过转换步骤）
./deploy/sync-data.sh                   # 自动找最新 Parquet
./deploy/sync-data.sh 某文件.parquet     # 指定文件
```

### SSH 连接前提（sync 失败必查）

```
# 本地 ~/.ssh/config 必须存在以下配置
Host chexian-vps
    HostName 162.14.113.44
    User root
    IdentityFile ~/.ssh/chexian_deploy
    ServerAliveInterval 60
```

验证连接：`ssh chexian-vps echo ok`

**常见失败原因与修复**：

| 错误 | 原因 | 修复 |
|------|------|------|
| `Identity file not accessible` | 密钥文件名错误或不存在 | 检查 `~/.ssh/chexian_deploy` 是否存在 |
| `Permission denied (publickey)` | 公钥未注册到 VPS | 登录腾讯云控制台，用 `tee -a` 追加公钥到 `authorized_keys` |
| 网页控制台命令折断 | 控制台自动加缩进换行 | 改用 `tee -a /root/.ssh/authorized_keys` 后粘贴 key，Ctrl+D 结束 |

### 部署相关文件

| 文件 | 说明 |
|------|------|
| `deploy/sync-data.sh` | 一键数据同步脚本（依赖 `~/.ssh/config` 别名） |
| `deploy/vps-deploy.sh` | VPS 全量部署脚本 |
| `DEPLOYMENT_GUIDE.md` | 完整部署步骤文档 |
| `vps.md` | VPS 运维手册（含 SSH 配置步骤） |

---

**变更历史**：

- 2026-02-15：新增§10生产部署与数据同步章节
- 2026-01-11 12:00：【重大更新】版本号校正（与package.json同步）、测试覆盖更新（14套件/273+测试）、新增NL2SQL智能查询、新增session-manager子代理、扩展关键特性（增强型KPI卡片、高级筛选器）
- 2026-01-11 04:30：新增§9多Agent并发协作协议，解决PR批量merge冲突问题（ROOT-CAUSE-001）
- 2026-01-08 20:30：更新技术栈版本号、补全测试覆盖（新增sql-validator/natural-week测试）、添加CI/CD说明、扩展数据处理链路（增加多视图和专项分析）、更新关键特性清单
- 2026-01-08 早期：新增验证协议，引入技术栈声明，记录 DuckDB 实测教训；实现交互式SQL查询（B020）、营业货车专项分析（B022/B023/B025）
- 2026-01-07 22:00：新增 Claude Code 工作流集成章节（Slash Commands、Subagents、数据准备）；补充测试覆盖说明
- 2026-01-07 16:00：协作操作系统化加固，建立三大索引 + 两本账 + 护栏机制
