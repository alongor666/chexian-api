# 文档索引 (DOC_INDEX)

**唯一事实来源 (SSOT)**：本索引指向所有架构、业务规则、API契约的权威文档。

> **防腐原则（2026-07-16 起）**：目录型知识（reviews/audits 等持续新增的产物）只登记**目录 + 少量精选**，不逐文件枚举——枚举必腐。单文件条目仅限长期有效的权威文档。

## 核心协议（@user专属，Agent只读）

| 文档 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| **技术栈声明** | `/开发文档/TECH_STACK.md` | ⚠️ **所有开发任务前必读**：技术栈特性、架构强制入口、验证协议 | **P0** |
| **开发者全局约定** | `/开发文档/DEVELOPER_CONVENTIONS.md` | ⚠️ **所有代码和文档必须遵守**：数据分析三要素强制前置（DC-001）、硬编码禁止规则、诊断报告 | **P0** |
| 项目协作协议 | `/CLAUDE.md` | Claude Code 必读指南（架构、命令、关键约束） | **P0** |
| AI 协作规则 | `/AGENTS.md` | Agent职责分工、工作区定义、§8 policy 分层 | P0 |
| Gemini 协作规则 | `/.claude/GEMINI.md` | Gemini专属协作协议（已停止主动维护，历史参考） | P2 |
| 需求账本（真相日志） | `/BACKLOG_LOG.jsonl` + `/backlog-events/` | 需求与状态的唯一真相：存量冻结 + 增量事件（写入走 `bun scripts/backlog.mjs`）。`BACKLOG.md` 为 gitignored 本地派生视图，`bun run backlog:render` 生成 | P1 |
| 进展账本 | `/PROGRESS.md` | 历史里程碑存档 + 接力指针（2026-05-18 后不再逐条维护，任务级真相见需求账本） | P1 |

<!-- @claude-section-start -->
## Claude工作区索引（@claude专属写入）

| 文档 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| AI 协作规则 | `/开发文档/AI_COLLABORATION.md` | 多 AI 协作流程、通用验证方法、跨AI知识传递 | P0 |

<!-- @claude-section-end -->

## 业务规则与口径（不可擅改）

| 主题 | 路径 | 说明 |
|------|------|------|
| **指标注册表（代码层 SSOT）** | `server/src/config/metric-registry/` | L1-L3 原子指标唯一事实源（id/formula/sql/testCase/changelog） |
| **指标字典（自动生成）** | `开发文档/指标字典.md` | 由 `bun scripts/metric-registry/generate-metric-doc.ts` 从注册表生成，禁止手动编辑 |
| 字段注册表 | `server/src/config/field-registry/fields.json` | 必需+可选字段唯一事实源（codegen 产出 mapping/validator/etl_fields） |
| 数据映射规则 | `server/src/normalize/mapping.ts` | 列名别名映射（codegen 产物，DO NOT EDIT） |
| 数据契约 | `server/src/normalize/validator.ts` | 类型验证、数据质量检查规则（codegen 产物，DO NOT EDIT） |
| 指标计算口径 | `server/src/sql/kpi.ts` | KPI SQL 生成规则（SQL 模块全景见 `server/src/sql/INDEX.md`） |
| KPI口径说明 | `开发文档/KPI口径说明.md` | KPI 承保/净额口径、退保影响指标与展示规范 |
| 业绩分析口径 | `开发文档/业绩分析指标口径说明.md` | 业绩分析板块专有的计划达成率分母折算逻辑 |
| PolicyFact 视图定义 | `server/src/services/duckdb.ts` | 业务规则：MAX(premium) 去重、FIRST() 其他字段；`loadMultipleParquet()` |
| 业务规则字典（业务层 SSOT） | `数据管理/knowledge/rules/车险数据业务规则字典.md` | 公式/口径疑问先查此文件 |

## 架构与技术栈

| 主题 | 路径 | 说明 |
|------|------|------|
| 模块层级总览 | `/ARCHITECTURE.md` | 前后端模块层级与依赖边界 |
| SQL 模块索引 | `server/src/sql/INDEX.md` | SQL 生成器拆分结构 |
| Dashboard 状态管理 | `src/features/dashboard/README.md` | 加载策略、错误处理、并发控制 |
| Agent 化升级总览 | `docs/AGENTIC_UPGRADE.md` | 当前基线 API-only + DuckDB native；Agent-ready 能力目录与护栏路线 |
| Agent harness 对标评测 | `docs/AGENT_HARNESS_BENCHMARK.md` | 10 维度实测打分（2026-06-10）、sql-guard 对抗实测 |

## 质量保证与审查

> 以目录为准：`开发文档/reviews/`（代码/架构/事故审查）· `开发文档/审计/`（体系级审计）· `开发文档/multi-branch/`（多省架构决策链）· `开发文档/隐性知识/`（复盘沉淀）。以下仅精选长期有效条目。

| 主题 | 路径 | 说明 |
|------|------|------|
| **知识体系审计（2026-07-16）** | `开发文档/审计/2026-07-16-知识体系审计.md` | 知识载体全量盘点 + 死链/漂移/停滞问题清单 + 索引死链闸机制补强 |
| **模型算力成本优化研究（2026-07-07）** | `开发文档/reviews/2026-07-07-模型算力成本优化研究/` | 三档子代理「质量×成本」边界实测 + 模型路由决策表 |
| **治理体系奥卡姆审计（2026-07-05）** | `开发文档/reviews/2026-07-05-治理体系奥卡姆审计与重构.md` | 57 项治理检查全量审计 + 四批次重构落账（57→49 项） |
| **技术栈审计（2026-06-12）** | `开发文档/reviews/2026-06-12-技术栈审计.md` | 依赖版本/安全通告全量审计、升级路线 P0-P3 |

---

## 知识管理

### 技术决策文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **通用立方体查询加速方案** | `开发文档/架构设计/通用立方体查询加速方案.md` | 可加性立方体 + 指标路由（2026-06-11，BACKLOG uid 2026-06-11-claude-90a92c） |
| **理赔模块架构评审与决策（ADR）** | `开发文档/架构设计/理赔模块架构评审与决策_2026-06-20.md` | 六层链路评审 + ADR-1/2/3（cutoff 时间不变量，B299 共同根因） |
| **技术决策记录** | `开发文档/TECHNICAL_DECISIONS.md` | 5大核心技术决策的背景、理由和实现细节 |

### 历史教训文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **历史教训记录** | `开发文档/LESSONS_LEARNED.md` | 5大历史教训的根因分析和解决方案 |

### 测试文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **测试覆盖缺口** | `开发文档/TEST_GAPS.md` | 20+测试缺口、优先级排序、测试用例建议 |

### 安全文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **安全约束** | `开发文档/SECURITY_CONSTRAINTS.md` | 5大安全约束和防护机制 |

## 工具与实用程序

| 主题 | 路径 | 说明 |
|------|------|------|
| **VPS热力图发布SOP** | `开发文档/VPS_HEATMAP_RELEASE_SOP.md` | 业绩分析热力图的一键发布与验收标准流程 |
| 会话管理 Slash Command | `.claude/commands/chexian-session-manager.md` | 会话历史管理技能定义 |

## 链接到其他索引

- **代码索引**: [CODE_INDEX.md](./CODE_INDEX.md) - 核心模块入口、关键类型定义
- **数据索引**: [DATA_INDEX.md](./DATA_INDEX.md) - 数据域、字段、业务规则边界
- **进展索引**: [PROGRESS_INDEX.md](./PROGRESS_INDEX.md) - 账本位置、接力入口

---

**变更规则**：
- 业务规则/指标口径需变更：只能追加新规则，不得修改已有规则；必须提供 BACKLOG 证据链。
- 架构文档需变更：必须同步更新本索引对应条目。

## 变更记录

- **2026-07-16 知识体系审计重构**（详见 `开发文档/审计/2026-07-16-知识体系审计.md`）：全量死链清理——删除指向已不存在载体的条目（`MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md`、`会话管理器.md`、`.claude/reports/`、`.claude/sessions/`、`.claude/subagents/`、`reviews/` 下 7 个已清理报告、`artifacts/cleanup-gates/`）；「业务规则与口径」表由已删除的 `src/shared/{duckdb,normalize,sql}/` 旧架构路径重写为 `server/src/` 现行路径（原「2026-02 API-only 校正补充」补丁段随之收编）；`GEMINI.md`/`BACKLOG.md` 指向修正；「质量保证与审查」改目录为准防腐模式；补登 `审计/`、`multi-branch/`、`隐性知识/` 目录与指标注册表/字段注册表/业务规则字典条目。历史版本见 git。 <!-- governance-allow: index-doc-links 变更记录墓碑，所列路径为已删除载体 -->
- 2026-02 API-only 校正（已收编进上表）：数据链路 = 前端 `src/shared/api/client.ts` → `server/src/routes/*` → `server/src/sql/*` → `server/src/services/duckdb.ts` → `@duckdb/node-api`。
