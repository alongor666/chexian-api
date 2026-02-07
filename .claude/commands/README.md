# Claude Code 命令索引 (v2.2)

> 车险业绩看板项目 - Claude Code Slash Commands 完整参考

**最后更新**: 2026-01-18

---

## 📋 快速导航

| 我想... | 使用命令 |
|---------|----------|
| 🚀 提交代码并创建PR | [`/commit-push-pr`](#commit-push-pr) |
| 🔄 同步最新代码 | [`/sync-and-rebase`](#sync-and-rebase) |
| 📊 分析车险数据 | [`/data-analysis`](#data-analysis) |
| 🛠️ Python数据分析工具库 | [`/data-tools`](#data-tools) ⭐ NEW |
| 💰 成本分析 | [`/cost-analysis`](#cost-analysis) ⭐ NEW |
| 📈 生成业务周报 | [`/weekly-report`](#weekly-report) |
| 🔒 安全审查 | [`/security-review`](#security-review) |
| ⚡ 性能审计 | [`/performance-audit`](#performance-audit) ⭐ NEW |
| 🎨 UI 审查 | [`/ui-review`](#ui-review) ⭐ NEW |
| 🧪 测试覆盖率 | [`/test-coverage`](#test-coverage) ⭐ NEW |
| 📚 管理会话历史 | [`/session-manager`](#session-manager) |
| 💡 提取隐性知识 | [`/extract-knowledge`](#extract-knowledge) |
| 📋 汇总沟通记录 | [`/session-summary`](#session-summary) ⭐ NEW |
| 🎯 初始化新项目 | [`/init-project`](#init-project) |
| 🧪 TDD 工作流 | [`/tdd`](#tdd) ⭐ NEW |
| 💾 检查点保存 | [`/checkpoint`](#checkpoint) ⭐ NEW |
| ✅ 多层验证 | [`/verify`](#verify) ⭐ NEW |
| 🎭 多Agent编排 | [`/orchestrate`](#orchestrate) ⭐ NEW |
| 🔄 配置演进 | [`/evolve`](#evolve) ⭐ NEW |

---

## 🗂️ 按类别分组

### Git 工作流 (2个命令)

#### commit-push-pr
**描述**: Git 提交并创建 Pull Request（含冲突检测和治理校验）
**作用域**: 全局 (可复用到其他项目)
**依赖**: `gh` CLI, `bun`, `scripts/check-write-conflict.mjs`, `scripts/check-governance.mjs`

**使用示例**:
```bash
/commit-push-pr
```

**自动执行流程**:
1. ✅ 分析所有变更文件
2. ✅ 生成语义化 commit message
3. ✅ 同步远程最新代码 (`git fetch origin main`)
4. ✅ 运行冲突检测 (`check-write-conflict.mjs`)
5. ✅ 运行治理校验 (`check-governance.mjs`)
6. ✅ 提交代码 (`git commit + push`)
7. ✅ 创建 Pull Request (`gh pr create`)

**详细文档**: [commit-push-pr.md](./commit-push-pr.md)

---

#### sync-and-rebase
**描述**: 同步远程代码并 Rebase（含冲突检测和测试）
**作用域**: 全局
**依赖**: `git`, `bun`, `scripts/check-write-conflict.mjs`

**使用示例**:
```bash
/sync-and-rebase
```

**执行流程**:
1. ✅ 同步远程最新代码 (`git fetch origin main`)
2. ✅ Rebase 到最新 main (`git rebase origin/main`)
3. ✅ 运行冲突检测 (`check-write-conflict.mjs`)
4. ✅ 运行测试 (`bun test`)

**适用场景**:
- 每天开始工作前
- 创建 PR 前
- 长时间未同步代码后

**详细文档**: [sync-and-rebase.md](./sync-and-rebase.md)

---

### 数据分析 (7个命令: 2个主命令 + 4个子命令 + 1个工具库)

#### data-analysis ⭐
**描述**: 车险数据多维度深度分析（KPI、趋势、续保、批改专项）
**作用域**: 项目特定 (车险业务)
**依赖**: DuckDB-WASM, PolicyFact 视图, `src/shared/sql/*.ts`

**使用示例**:
```bash
# 基础全量分析（推荐）
/data-analysis

# 指定分析维度
/data-analysis --dimensions 机构,险类,续保状态

# 指定时间范围（基于签单日期）
/data-analysis --start 2025-10-01 --end 2025-12-31

# 专项分析
/data-analysis --focus renewal      # 续保专项
/data-analysis --focus batch-type   # 批改类型专项
/data-analysis --focus vehicle      # 车型专项
```

**快速子命令** (推荐使用以提高速度):
- `/data-profile` - 数据概览与质量检查
- `/data-kpi` - 业绩分析与排名
- `/data-trends` - 时间趋势分析
- `/data-export` - 数据导出

**详细文档**: [data-analysis.md](./data-analysis.md)

---

#### data-profile
**描述**: 数据概览与质量检查（基础统计、字段完整性、保费分布）
**作用域**: 项目特定
**父命令**: `data-analysis`

**使用示例**:
```bash
/data-profile
```

---

#### data-kpi
**描述**: 业绩分析与排名（Top30业务员、机构对比、四象限分层）
**作用域**: 项目特定
**父命令**: `data-analysis`

**使用示例**:
```bash
/data-kpi
/data-kpi --top 50
```

---

#### data-trends
**描述**: 时间趋势分析（月度/周度趋势、环比增长、异常检测）
**作用域**: 项目特定
**父命令**: `data-analysis`

**使用示例**:
```bash
/data-trends
/data-trends --period month
```

---

#### data-export
**描述**: 数据导出工具（CSV/JSON/Excel格式，支持筛选和聚合）
**作用域**: 项目特定
**父命令**: `data-analysis`

**使用示例**:
```bash
/data-export --query "SELECT * FROM PolicyFact LIMIT 1000" --format csv
```

---

#### data-tools ⭐ NEW
**描述**: Python数据分析工具库（8个工具，统一CLI调用）
**作用域**: 项目特定
**依赖**: python3, pandas, cli.py

**使用示例**:
```bash
/data-tools --list              # 列出所有工具
/data-tools --search parquet    # 搜索工具
/data-tools analyze_parquet     # 运行Parquet分析
/data-tools earned_premium      # 计算已赚保费
```

**工具列表**:
- `analyze_parquet`: Parquet文件结构分析
- `analyze_excel`: Excel文件结构分析
- `deep_analysis`: 深度数据探索
- `field_relation`: 字段关联分析
- `field_deep`: 字段深度分析
- `field_exhaustive`: 字段穷举分析
- `excel_to_parquet`: Excel转Parquet
- `earned_premium`: 已赚保费计算

**详细文档**: [data-tools.md](./data-tools.md) | [数据管理/INDEX.md](../../数据管理/INDEX.md)

---

### 报告生成 (4个命令: 1个主命令 + 3个子命令)

#### weekly-report ⭐
**描述**: 车险业务周报自动生成（董事会级，数据驱动，业务洞察型）
**作用域**: 项目特定
**依赖**: DuckDB-WASM, PolicyFact 视图, `data-analysis` 命令

**使用示例**:
```bash
# 默认：生成最近一周报告
/weekly-report

# 指定自然周（基于签单日期）
/weekly-report --period week --number 50

# 指定时间范围
/weekly-report --start 2025-12-01 --end 2025-12-31

# 生成月度报告
/weekly-report --period month --value 2025-12
```

**快速子命令**:
- `/report-weekly` - 周报生成
- `/report-monthly` - 月报生成
- `/report-custom` - 自定义报告

**详细文档**: [weekly-report.md](./weekly-report.md)

---

#### report-weekly
**描述**: 生成周报（自然周数据，环比分析，业绩排名）
**作用域**: 项目特定
**父命令**: `weekly-report`

**使用示例**:
```bash
/report-weekly
/report-weekly --week 50
```

---

#### report-monthly
**描述**: 生成月报（自然月数据，同比环比，趋势分析）
**作用域**: 项目特定
**父命令**: `weekly-report`

**使用示例**:
```bash
/report-monthly
/report-monthly --month 2025-12
```

---

#### report-custom
**描述**: 自定义报告生成（灵活时间范围，自定义维度）
**作用域**: 项目特定
**父命令**: `weekly-report`

**使用示例**:
```bash
/report-custom --start 2025-10-01 --end 2025-12-31
```

---

### 开发工具 (11个命令: 6个主命令 + 4个安全子命令)

#### security-review ⭐
**描述**: 车险业绩看板全面安全审查（SQL注入、XSS、CORS等8项检查）
**作用域**: 项目特定
**依赖**: `grep`, `bun`, `tests/security.test.ts`, `src/shared/utils/security.ts`

**使用示例**:
```bash
# 审查所有已修改的文件
/security-review

# 审查指定目录
/security-review --target src/shared/utils
/security-review --target src/features/dashboard

# 全量审查
/security-review --target all
```

**审查清单** (8项):
1. 🔴 SQL 注入防护
2. 🔴 SQL 验证器合规性
3. 🟠 XSS 防护
4. 🟠 CORS 配置
5. 🟡 文件上传安全
6. 🟡 隐私保护
7. 🟢 依赖安全
8. 🟢 环境变量管理

**快速子命令** (专项审查):
- `/security-sql` - SQL注入防护专项
- `/security-xss` - XSS防护专项
- `/security-cors` - CORS与文件上传安全
- `/security-all` - 全量审查（8项）

**详细文档**: [security-review.md](./security-review.md)

---

#### security-sql
**描述**: SQL注入防护专项检查（输入清理、SQL验证器、LIKE子句）
**作用域**: 项目特定
**父命令**: `security-review`

**使用示例**:
```bash
/security-sql
/security-sql --target src/shared/sql
```

---

#### security-xss
**描述**: XSS防护专项检查（输出编码、innerHTML使用、React安全）
**作用域**: 项目特定
**父命令**: `security-review`

**使用示例**:
```bash
/security-xss
/security-xss --target src/features
```

---

#### security-cors
**描述**: CORS与文件上传安全检查（COOP/COEP头部、文件验证）
**作用域**: 项目特定
**父命令**: `security-review`

**使用示例**:
```bash
/security-cors
```

---

#### security-all
**描述**: 全量安全审查（8项检查完整覆盖）
**作用域**: 项目特定
**父命令**: `security-review`

**使用示例**:
```bash
/security-all
```

---

#### session-manager
**描述**: 管理 Claude Code CLI 对话历史（查看、搜索、重命名、导出）
**作用域**: 全局
**依赖**: `bun`, `scripts/session-manager.mjs`

**使用示例**:
```bash
# 列出所有会话
/session-manager --list

# 搜索会话
/session-manager --search "KPI分析"

# 按日期范围搜索
/session-manager --date-from "2025-01-01" --date-to "2025-01-10"

# 重命名会话
/session-manager --rename <session-id> --title "新标题"

# 导出会话为 Markdown
/session-manager --export <session-id> --format markdown --output "会话.md"
```

**详细文档**: [session-manager.md](./session-manager.md)

---

#### extract-knowledge
**描述**: 提取对话中的隐性知识并结构化归档到知识库
**作用域**: 全局
**依赖**: `.claude/knowledge-extraction-protocol.md`, `.claude/subagents/knowledge-miner.md`

**使用示例**:
```bash
# 提取本次对话的全部知识
/extract-knowledge

# 提取本次对话，仅关注业务规则
/extract-knowledge --focus business-rules

# 提取历史对话
/extract-knowledge --scope history

# 批量模式，快速确认
/extract-knowledge --mode batch
```

**工作流程**:
1. 扫描对话 → 2. 提取上下文 → 3. 分类整理 → 4. 请求确认 → 5. 归档存储 → 6. 生成报告

**详细文档**: [extract-knowledge.md](./extract-knowledge.md)

---

#### session-summary ⭐ NEW (v2.0)
**描述**: 扫描**所有历史Session**，提取用户原文和AI回复概要，增量汇总到沟通记录表
**作用域**: 全局
**依赖**: `开发文档/沟通记录汇总表.md`, `.claude/session-tracking.json`

**使用示例**:
```bash
# 🔥 推荐：处理所有未汇总的历史 session
/session-summary

# 处理全部历史 session
/session-summary --scope all

# 筛选包含"续保"的历史对话
/session-summary --filter "续保"

# 筛选指定日期范围
/session-summary --date-from "2026-01-01" --date-to "2026-01-15"

# 批量模式（无需确认）
/session-summary --mode batch

# 仅预览，不写入
/session-summary --mode preview --filter "性能"
```

**核心特性**:
- 历史全量扫描（默认扫描 `~/.claude/projects/` 下的所有 session）
- 增量更新（记录已处理 session，避免重复）
- 智能筛选（关键词、日期范围）
- 自动分类标签

**输出文件**: `开发文档/沟通记录汇总表.md`

**详细文档**: [session-summary.md](./session-summary.md)

---

#### performance-audit ⭐ NEW
**描述**: 全栈性能审计（前端渲染+后端查询+内存优化）
**作用域**: 项目特定
**依赖**: Chrome DevTools, React DevTools, bun

**使用示例**:
```bash
# 完整性能审计
/performance-audit

# 仅审计前端性能
/performance-audit --frontend

# 仅审计数据库查询
/performance-audit --database

# 生成性能报告
/performance-audit --report
```

**审计清单**:
1. 🎯 前端性能（FCP/LCP/FID/CLS）
2. 🗄️ DuckDB 查询性能（慢查询优化）
3. 💾 内存使用（内存泄漏检测）
4. 📊 缓存命中率（优化建议）

**详细文档**: [performance-audit.md](./performance-audit.md)

---

#### ui-review ⭐ NEW
**描述**: UI/UX 设计审查与优化建议
**作用域**: 项目特定
**依赖**: Chrome DevTools, React DevTools

**使用示例**:
```bash
# 完整 UI 审查
/ui-review

# 仅审查可访问性
/ui-review --accessibility

# 仅审查响应式设计
/ui-review --responsive

# 审查指定组件
/ui-review --component PremiumDashboard
```

**审查清单**:
1. 🎨 视觉设计（颜色/间距/字体）
2. 🖱️ 交互设计（按钮/表单/反馈）
3. 📱 响应式设计（移动端/平板/桌面）
4. ♿ 可访问性（WCAG 2.1 标准）
5. ⚡ 性能与体验（加载时间/动画）

**详细文档**: [ui-review.md](./ui-review.md)

---

#### test-coverage ⭐ NEW
**描述**: 测试覆盖率分析与增强建议
**作用域**: 项目特定
**依赖**: bun, vitest, @vitest/coverage-v8

**使用示例**:
```bash
# 生成测试覆盖率报告
/test-coverage

# 仅运行单元测试
/test-coverage --unit

# 生成覆盖率 HTML 报告
/test-coverage --report

# 检查特定模块
/test-coverage --module sql
/test-coverage --module components
```

**测试类型**:
1. 🧪 单元测试（> 80% 覆盖率）
2. 🔗 组件测试（> 70% 覆盖率）
3. 🔄 集成测试（核心流程 100%）
4. 🎭 E2E 测试（关键业务流程 100%）

**详细文档**: [test-coverage.md](./test-coverage.md)

---

#### cost-analysis ⭐ NEW
**描述**: 成本分析深度审计（赔付率/费用率/综合费用率/变动成本率）
**作用域**: 项目特定
**依赖**: DuckDB-WASM, 业务员保费计划数据

**使用示例**:
```bash
# 完整成本分析
/cost-analysis

# 仅分析赔付率
/cost-analysis --claim-ratio

# 指定分析维度
/cost-analysis --dimension 机构
/cost-analysis --dimension 客户类别

# 指定截止日期
/cost-analysis --cutoff-date "2026-01-15"
```

**分析维度**:
1. 💸 赔付率分析（满期赔付率/案均赔款）
2. 📊 费用率分析（费用金额/费用率）
3. 📈 综合费用率分析（承保利润率）
4. 🎯 变动成本率分析（边际贡献率）

**详细文档**: [cost-analysis.md](./cost-analysis.md)

---

### 项目管理 (1个命令)

#### init-project
**描述**: 为新项目生成完整的 Claude Code 工作流配置
**作用域**: 全局
**依赖**: `git`

**使用示例**:
```bash
/init-project
```

**生成内容**:
1. CLAUDE.md 项目文档
2. .claude/commands/ 自定义命令
3. .claude/subagents/ AI 子代理
4. .claude/settings.json 配置
5. .mcp.json MCP 服务器配置
6. Git hooks
7. CI/CD 配置模板

**详细文档**: [init-project.md](./init-project.md)

---

### 工作流增强 (5个命令 - 来自 everything-claude-code)

#### tdd ⭐ NEW
**描述**: TDD 测试驱动开发工作流
**作用域**: 全局
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**使用示例**:
```bash
/tdd                    # 启动 TDD 工作流
/tdd --feature "新功能"  # 指定功能开始 TDD
```

**工作流程**:
1. 🔴 Red: 编写失败的测试
2. 🟢 Green: 编写最小实现通过测试
3. 🔵 Refactor: 重构代码保持测试通过

**详细文档**: [tdd.md](./tdd.md)

---

#### checkpoint ⭐ NEW
**描述**: 会话检查点保存与恢复
**作用域**: 全局
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**使用示例**:
```bash
/checkpoint             # 保存当前会话状态
/checkpoint --name "功能完成"  # 命名检查点
```

**详细文档**: [checkpoint.md](./checkpoint.md)

---

#### verify ⭐ NEW
**描述**: 多层验证协议（与项目 §6 验证协议互补）
**作用域**: 全局
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**使用示例**:
```bash
/verify                 # 执行完整验证
/verify --quick         # 快速验证
```

**验证层级**:
1. 静态分析（类型检查、lint）
2. 单元测试
3. 集成测试
4. 端到端验证

**详细文档**: [verify.md](./verify.md)

---

#### orchestrate ⭐ NEW
**描述**: 多 Agent 任务编排与协调
**作用域**: 全局
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**使用示例**:
```bash
/orchestrate            # 自动编排任务
/orchestrate --agents "architect,tdd-guide,security-reviewer"
```

**详细文档**: [orchestrate.md](./orchestrate.md)

---

#### evolve ⭐ NEW
**描述**: Claude Code 配置持续演进
**作用域**: 全局
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**使用示例**:
```bash
/evolve                 # 检查配置更新
/evolve --apply         # 应用推荐更新
```

**详细文档**: [evolve.md](./evolve.md)

---

## 📊 命令统计

| 类别 | 主命令 | 子命令 | 总计 | 全局命令 | 项目特定 |
|------|--------|--------|------|---------|---------|
| Git 工作流 | 2 | 0 | 2 | 2 | 0 |
| 数据分析 | 2 | 4 | 6 | 0 | 6 |
| 报告生成 | 1 | 3 | 4 | 0 | 4 |
| 开发工具 | 7 | 4 | 11 | 3 | 8 |
| 项目管理 | 1 | 0 | 1 | 1 | 0 |
| 工作流增强 | 5 | 0 | 5 | 5 | 0 |
| **总计** | **18** | **11** | **29** | **11** | **18** |

> 🔗 新增 5 个命令来自 [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**命令粒度说明**:
- ⭐ 标记的是主命令（功能完整，包含所有子功能）
- 子命令提供更快速、更专注的执行（推荐日常使用）
- 所有子命令都可以独立使用，无需先执行主命令

---

## 🚀 快速开始

### 新用户推荐流程

```bash
# 1. 每天开始工作前
/sync-and-rebase

# 2. 开发过程中（每30-60分钟）
git add .
git commit -m "feat(xxx): ..."
git push

# 3. 完成功能后
/commit-push-pr
```

### 数据分析工作流

```bash
# 1. 上传 Parquet 文件到应用
# 2. 执行深度分析
/data-analysis

# 3. 生成周报
/weekly-report

# 4. 安全审查
/security-review
```

---

## 🔗 相关文档

- **项目协作协议**: [CLAUDE.md](../../CLAUDE.md) - 必读，包含所有开发规范
- **技术栈声明**: [开发文档/TECH_STACK.md](../../开发文档/TECH_STACK.md)
- **开发者全局约定**: [开发文档/DEVELOPER_CONVENTIONS.md](../../开发文档/DEVELOPER_CONVENTIONS.md)
- **快速参考卡片**: [.claude/docs/](../docs/) - 快速参考和测试指南

---

## 📝 贡献指南

### 添加新命令

1. 在 `.claude/commands/` 创建 `<command-name>.md`
2. 添加 YAML frontmatter（参考现有命令）
3. 更新本 `README.md` 索引
4. 运行 `bun run scripts/check-governance.mjs` 验证

### YAML Frontmatter 模板

```yaml
---
name: command-name
description: 简短描述（不超过80字符）
category: git-workflow | data-analysis | development-tools | project-setup
version: 1.0.0
author: "@your-name"
tags: [tag1, tag2, tag3]
scope: global | project
requires:
  - 外部工具1
  - 外部工具2
dependencies:
  - 项目内部依赖1
  - 项目内部依赖2
last_updated: "YYYY-MM-DD"
---
```

---

**维护者**: @claude
**最后更新**: 2026-01-18
**版本**: 2.2.0

**License**: 车险业绩看板项目内部使用
