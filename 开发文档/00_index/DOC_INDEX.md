# 文档索引 (DOC_INDEX)

**唯一事实来源 (SSOT)**：本索引指向所有架构、业务规则、API契约的权威文档。

## 核心协议（@user专属，Agent只读）

| 文档 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| **技术栈声明** | `/开发文档/TECH_STACK.md` | ⚠️ **所有开发任务前必读**：技术栈特性、架构强制入口、验证协议 | **P0** |
| **开发者全局约定** | `/开发文档/DEVELOPER_CONVENTIONS.md` | ⚠️ **所有代码和文档必须遵守**：数据分析三要素强制前置（DC-001）、硬编码禁止规则、诊断报告 | **P0** |
| 项目协作协议 | `/CLAUDE.md` | Claude Code 必读指南（架构、命令、关键约束）、**§9 多Agent并发协作协议** | **P0** |
| AI 协作规则 | `/AGENTS.md` | Agent职责分工、工作区定义 | P0 |
| Gemini 协作规则 | `/GEMINI.md` | Gemini专属协作协议 | P0 |
| 需求账本 | `/BACKLOG.md` | 需求提议与状态追踪（唯一真理来源） | P1 |
| 进展账本 | `/PROGRESS.md` | 里程碑、阻塞、下一步接力点（唯一真理来源） | P1 |

<!-- @claude-section-start -->
## Claude工作区索引（@claude专属写入）

| 文档 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| **PR冲突根因分析** | `/开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md` | Ultra-think根因分析、立即行动方案、中长期防冲突机制（ROOT-CAUSE-001） | **P0** |
| AI 协作规则 | `/开发文档/AI_COLLABORATION.md` | 多 AI 协作流程、通用验证方法、跨AI知识传递 | P0 |
| 会话管理器 | `/开发文档/会话管理器.md` | 管理 Claude Code CLI 对话历史的完整工具 | P1 |

<!-- @claude-section-end -->

## 业务规则与口径（不可擅改）

| 主题 | 路径 | 说明 |
|------|------|------|
| 数据映射规则 | `src/shared/normalize/mapping.ts` | 列名别名映射（中英文兼容）、DEFAULT_MAPPING |
| 指标计算口径 | `src/shared/sql/kpi.ts` | KPI/TopN/Table SQL 模板生成规则 |
| KPI口径说明 | `开发文档/KPI口径说明.md` | KPI 承保/净额口径、退保影响指标与展示规范 |
| 业绩分析口径 | `开发文档/业绩分析指标口径说明.md` | 业绩分析板块专有的计划达成率分母折算逻辑 |
| PolicyFact 视图定义 | `src/shared/duckdb/client.ts:78-95` | 业务规则：MAX(premium) 去重、FIRST() 其他字段 |
| 数据契约 | `src/shared/normalize/validator.ts` | 类型验证、数据质量检查规则 |

## 架构与技术栈

| 主题 | 路径 | 说明 |
|------|------|------|
| DuckDB Worker 架构 | `src/shared/duckdb/README.md` | Worker 通信、Arrow IPC 数据流、CORS 配置 |
| 数据处理流程 | `src/shared/normalize/README.md` | 别名-验证模式、错误处理 |
| SQL 生成策略 | `src/shared/sql/README.md` | 查询模板、性能优化、业务逻辑 |
| Dashboard 状态管理 | `src/features/dashboard/README.md` | 加载策略、错误处理、并发控制 |

## 质量保证与审查

| 主题 | 路径 | 说明 |
|------|------|------|
| 代码质量审查 | `开发文档/reviews/` | 代码审查报告、改进建议、质量指标追踪 |
| **治理体系奥卡姆审计（2026-07-05）** | `开发文档/reviews/2026-07-05-治理体系奥卡姆审计与重构.md` | 57 项治理检查全量审计（重复/冲突/交叉/移位四类清单）+ 四批次重构落账（57→49 项 · 11.3s→1.8s）+ 检查生命周期与自我适用机制 |
| 综合审查报告 | `开发文档/reviews/2026-01-10-code-quality-review.md` | PR #35 审查：测试覆盖率、类型安全、性能优化 |
| **改进路线图** | `开发文档/reviews/quality-improvement-roadmap.md` | **4周工程化实施计划（Week-by-Week）** |
| **Linear任务导出** | `开发文档/reviews/linear-tasks-export.md` | **16个可执行任务（含验收标准）** |
| **Code Review（2026-02-24）** | `开发文档/reviews/2026-02-24-code-review.md` | 聚焦企微登录与治理账本一致性的专项审查（2个P0） |
| **Cross-sell UX 线框规格 V1（2026-03-09）** | `开发文档/reviews/2026-03-09-cross-sell-ux-wireframe-v1.md` | 交叉销售页重构前的实现级线框规格：页面骨架、吸顶层级、筛选重组、锚点导航与组件契约 |
| **技术栈审计（2026-06-12）** | `开发文档/reviews/2026-06-12-技术栈审计.md` | 四包依赖版本/安全通告全量审计：1 严重 12 高危处置分级、TECH_STACK.md 漂移清单、升级路线 P0-P3 |

---

## 知识管理 (2026-01-11 新增)

### 技术决策文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **通用立方体查询加速方案** | `开发文档/架构设计/通用立方体查询加速方案.md` | 不依赖结果快照的查询加速：可加性立方体 + 指标路由，基准原型 16 项等值校验通过（2026-06-11，BACKLOG uid 2026-06-11-claude-90a92c） |
| **理赔模块架构评审与决策（ADR）** | `开发文档/架构设计/理赔模块架构评审与决策_2026-06-20.md` | 理赔模块六层链路评审 + ADR-1/2/3：核心判断=满期赔付率正确性依赖"cutoff=最新数据日"隐藏时间不变量（B299 共同根因）；含 ADR-1 半步「赔款谓词提取」零行为变更实施清单（2026-06-20） |
| **技术决策记录** | `开发文档/TECHNICAL_DECISIONS.md` | 5大核心技术决策的背景、理由和实现细节 |
| Arrow IPC vs JSON | §1 | 性能10x提升、传输减少70%、类型保真度 |
| Worker架构设计 | §2 | 并发控制、请求取消、沙箱安全 |
| PolicyFact去重逻辑 | §3 | MAX保费+FIRST字段、数据完整性保障 |
| 参数化查询模板 | §4 | 安全机制、易用性设计、防重复筛选 |
| 下钻式图表交互 | §5 | 信息密度优化、交互流畅、视觉统一 |

### 历史教训文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **历史教训记录** | `开发文档/LESSONS_LEARNED.md` | 5大历史教训的根因分析和解决方案 |
| 自然周计算踩坑 | §1 (B014-B017) | ISO周vs自然周、自定义计算公式、8小时损失 |
| 日期字段类型转换 | §2 (B041) | Parquet默认VARCHAR、查询失败、类型转换方案 |
| 代码质量问题 | §3 (B038) | 测试覆盖率<10%、122处any、203处console.log |
| 验证协议建立 | §4 (B013) | 返工率40%→5%、三层验证协议 |
| 治理体系演进 | §5 | 从混乱到有序、知识断层→文档化 |

### 测试文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **测试覆盖缺口** | `开发文档/TEST_GAPS.md` | 20+测试缺口、优先级排序、测试用例建议 |
| 数据质量边界 | §1 | 极端保费、未来日期、保单号格式 |
| 业务逻辑边界 | §2 | 跨年续保、保单状态流转、多级机构层级 |
| 性能相关测试 | §3 | 大数据量、并发访问、内存边界 |
| 安全增强测试 | §4 | 时间盲注、存储型XSS、文件上传验证 |

### 安全文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **安全约束** | `开发文档/SECURITY_CONSTRAINTS.md` | 5大安全约束和防护机制 |
| **安全深度研究报告（2026-02-17）** | `开发文档/reviews/2026-02-17-安全深度研究报告.md` | 全链路风险评级（P0/P1/P2）与分阶段修复路线图 | **P0** |
| SQL注入防护 | §1 | 只读强制、聚合强制、视图边界、隐私保护 |
| XSS攻击防护 | §2 | HTML实体编码、CSP策略、攻击模式 |
| COOP/COEP配置 | §3 | DuckDB-WASM强制要求、Vite配置 |
| 数据脱敏策略 | §4 | 敏感字段清单、脱敏规则、访问控制 |

### 综合报告

| 文档 | 路径 | 说明 |
|------|------|------|
| **知识提取报告** | `.claude/reports/knowledge-extraction-report-20260111.md` | 知识提取综合报告、统计、关键发现 |
| 执行摘要 | §执行摘要 | 50+条隐性知识、4个新文档、5个更新文档 |
| 知识分类统计 | §知识分类统计 | 业务规则15条、技术约束18条、开发规范10条等 |
| 关键发现 | §关键发现 | 5大重要发现、根因分析、经验总结 |
| 后续行动建议 | §后续行动建议 | 立即执行、近期执行、中期规划 |

---

## 会话记录

| 主题 | 路径 | 说明 |
|------|------|------|
| **会话总结** | `.claude/sessions/代码质量改进规划-20260110.md` | **2026-01-10代码质量审查+4周改进计划** |

## 工具与实用程序

| 主题 | 路径 | 说明 |
|------|------|------|
| **会话管理器** | `开发文档/会话管理器.md` | **管理 Claude Code CLI 对话历史的完整工具**（快速开始、命令参考、故障排除） |
| **VPS热力图发布SOP** | `开发文档/VPS_HEATMAP_RELEASE_SOP.md` | 业绩分析热力图的一键发布与验收标准流程（发布脚本 + 验收脚本 + 证据产物） |
| 会话管理 Slash Command | `.claude/commands/chexian-session-manager.md` | 技能定义和功能规范 |
| 会话管理 Subagent | `.claude/subagents/chexian-session-manager.md` | 智能助手工作流程、最佳实践 |
| 会话管理快速参考 | `.claude/commands/chexian-session-manager-quickref.md` | 一页纸速查表 |

## 链接到其他索引

- **代码索引**: [CODE_INDEX.md](./CODE_INDEX.md) - 核心模块入口、关键类型定义
- **进展索引**: [PROGRESS_INDEX.md](./PROGRESS_INDEX.md) - 任务状态、阻塞点、接力入口

---

**变更规则**：
- 业务规则/指标口径需变更：只能追加新规则，不得修改已有规则；必须提供 BACKLOG 证据链。
- 架构文档需变更：必须同步更新本索引对应条目。

## 2026-02 API-only 校正补充（新增）

以下校正优先于本文件历史条目：

- `src/shared/duckdb/client.ts`、`src/shared/duckdb/README.md` 已不属于当前运行架构。
- 当前数据链路：前端 `src/shared/api/client.ts` → 后端 `server/src/routes/*` → `server/src/sql/*` → `server/src/services/duckdb.ts` → `@duckdb/node-api`（DuckDB native）。
- 如需查看 DuckDB 业务口径，请以 `server/src/services/duckdb.ts` 和 `server/src/sql/*.ts` 为准。

## 2026-04 Agent 化升级入口（新增）

- `docs/AGENTIC_UPGRADE.md`：Agent 化升级总览，明确当前系统基线为 API-only + DuckDB native，并定义后续 Agent-ready 能力目录、受控查询、任务编排与生产护栏路线。
- `docs/AGENT_HARNESS_BENCHMARK.md`：自建 agent harness 对标评测（2026-06-10）。以业界顶级 10 维度为标尺逐维度实测打分（综合约 77/100），含 sql-guard 对抗实测、释放大模型前三道硬门槛、harness 持续运营六条最佳实践。

## 2026-02-25 清理门禁报告（新增）

- `开发文档/reviews/2026-02-25-api-only-cleanup-gate-report.md`：API-only 分批清理（Batch0-3）与零故障门禁执行报告。
- 运行证据日志目录：`artifacts/cleanup-gates/2026-02-25/`。

## 2026-03-06 夜间流水线执行摘要（新增）

- `开发文档/reviews/2026-03-06-nightly-pipeline-summary.md`：记录今日驾乘险日报流水线、机构拆分汇总与 VPS 热力图/下钻复验结果。
