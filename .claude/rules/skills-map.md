# 本项目相关全局 Skills 速查表

> **唯一事实源**：每个 skill 完整定义在 `~/.claude/skills/<name>/SKILL.md`。本文件**只记录"本项目怎么用它"**，不重复 skill 自我描述；发现未登记 skill 当场补登。
>
> **上游同步**：`chexian-*`/`diagnose-*`/`rewrite-conclusion` 源在 `alongor666/alongor666-skills`（走 `crystallize-skill`）；`chexian-commit-push-pr`=`commit-push-pr-core` wrapper。

---

## A. 诊断报告生产链（一线·高频）

### A1. 业务诊断 skill（diagnose-* 家族 · user_invocable）

| Skill | 本项目用法 | 一键命令 |
|-------|-----------|---------|
| **diagnose-org-weekly** (v1.19) | 三级机构经营诊断周报（10 板块 + 22 SPA 下钻·单文件） | `python3 ~/.claude/skills/diagnose-org-weekly/cli.py --org "<机构>" --year 2026` → `/tmp/<机构>_周报.html` |
| **diagnose-period-trend** (v2.0) | 短中长期对照三视图（V1 驾驶舱/V3 叙事周报/V4 超表）。触发"周期趋势/超表/驾驶舱" | `python3 ~/.claude/skills/diagnose-period-trend/lib/cli.py --view all` → `<cutoff>-*.html` |
| **diagnose-loss-development** (v2.2) | 赔付率发展诊断（cohort + 月份矩阵 + 多维下钻）。触发"赔付率发展/loss-development" | → `server/data/reports/diagnose-loss-development/YYYY-MM-DD/` |
| **diagnose-lr-triage** (v1.0) | 满期赔付率哨兵报警「先证伪再归因」（复现→成熟度证伪→归因→敏感性带）。触发"赔付率报警/真恶化还是准备金没跑完" | 终端 `duckdb` 出结论 |
| **rewrite-conclusion** | L2 结论 AI 重写（读 L1 车型子文档+机构诊断卡 → 管理层判断） | `--topic 出险率\|费用率\|保费达成` |

### A2. 渲染基础设施（被 A1 集成，**不直接调用**）

| Skill | 角色 |
|-------|------|
| **chexian-report-shell** (v1.19) | A1 共享渲染层（render_page / 亮灯 / SPA / 取数 / IM 推送）。user_invocable=false |

## B. 车险业务场景咨询（一线·决策辅助）

| Skill | 何时调用 |
|-------|---------|
| **chexian-ir-diagnosis** | 出险率恶化根因分析（"为什么出险率上升"） |
| **chexian-channel** | 渠道经营评估：4S / 经代 / 代理 / 经纪是否值得继续投入 |
| **chexian-pricing-decision** | 定价决策：商业险报价/核保（前瞻；已成交复盘见 chexian-pricing-redline） |
| **chexian-market-analysis** | 市场竞争结构分析 / 增长机会评估 |
| **chexian-ops-review** | 城市级（华安）经营复盘：市场+渠道+承保+理赔合并视图 |
| **chexian-local-risk-control** | 本项目专属：本地个人版风险选择/成本控制编排（`/api/local-skills/run`） |

## C. 报告分发与演示（二线·按需）

| Skill | 用途 |
|-------|------|
| **chexian-im-push** | HTML→链接式 PPT 推飞书/企微（**首选**，替代已弃 `xcl-pdf2lark`/`xcl-ppt2im`） |
| **magazine-web-ppt** | 杂志风/电子墨水风网页 PPT（发布会、对外分享） |
| **pdf2wecom** | PDF 推企微（旧链路，新需求优先 chexian-im-push） |

## D. 通道集成（按需 · 域=平台 skill 对照）

- **飞书**：`lark-im`/`lark-doc`/`lark-base`/`lark-sheets`/`lark-vc`/`lark-minutes`/`lark-calendar`/`lark-contact`/`lark-task`/`lark-mail`/`lark-drive`/`lark-wiki`/`lark-event`/`lark-whiteboard`/`lark-openapi-explorer`
- **企微**：`wecomcli-msg`/`wecomcli-doc`/`wecomcli-smartsheet`/`wecomcli-meeting`/`wecomcli-schedule`/`wecomcli-contact`/`wecomcli-todo`

## E. 开发工具（项目工作流）

| Skill | 触发场景 |
|-------|---------|
| ~~**codex**~~（非 skill 触发） | ⚠️ 评审一律走 **codex CLI**（`codex exec --sandbox read-only`，prompt 自包含喂 stdin），勿按 skill 触发 — 详见 memory `codex-review-is-cli-adversarial` + `loop-orchestration.md §2` |
| **qa** / **qa-only** | 系统性 QA 并修 bug（生产前最后一道闸） |
| **review** | Pre-landing PR review（SQL 安全 / LLM 信任边界 / 条件副作用） |
| **security-review** | 处理用户输入 / 鉴权 / 敏感数据时强制触发 |
| **tech-stack-audit** | 技术栈只读审计 + 治理热启动 prompt（"审计技术栈/依赖审计/技术栈体检"触发）。首次产出见 开发文档/reviews/2026-06-12-技术栈审计.md |
| **knowledge-system-audit** | 知识体系审计（"审计知识体系/文档腐化检查"触发）。golden 范例=开发文档/审计/2026-07-16-知识体系审计.md；发现的判定型问题喂 governance 闸（索引死链/skill frontmatter 两闸即其产物） |
| **investigate** | 系统性 debug 四阶段，铁律"无根因不修复" |
| **claude-api** | 修改本项目 Anthropic SDK 调用（智谱→真 Claude、prompt caching 调优） |
| **sql-pro** | DuckDB 复杂 SQL 优化（窗口函数 / CTE / 执行计划） |
| **chexian-crystallize-skill** | "沉淀成 skill / 固化成技能" → 五步流水线。铁律「改在仓库·装到本地·本地只读」，详见 memory `project_skills_maintenance_model` |
| **cleanup-worktrees** | "清理/回收 worktree" → 安全回收器，默认只删零损失（`--dry-run` 盘点 / `--archive` 备份后清理） |
| **/chexian-evidence-loop**（基座 `evidence-loop-core`） | "按证据闭环做 / evidence loop / 先建 harness 再动手" → 三阶段（harness 报告 → loop checkpoint → verifier 证伪）。本项目 §4 表见 `.claude/rules/evidence-loop.md`；**跨任务并行调度**先 `bun run loop:dispatch`（Loop v2，见 `.claude/rules/loop-orchestration.md`） |

### E2. 机制沉淀基座（skills 仓 PR #58）

> 本项目内**以 rules/scripts 原文为准**，技能是复用出口、不反向定口径。通用：**backlog-eventlog-core**·**loop-orchestration-core**·**worktree-bootstrap**·**governance-gate-core**·**registry-codegen-pattern**·**golden-baseline-harness**；车险域：**chexian-business-calibers**·**chexian-data-pipeline-patterns**·**chexian-deploy-ops**

---

## 触发对齐规则（路由）

- "X 经营诊断周报/跑一份周报" → A1 `diagnose-org-weekly` 直接套命令，**禁止搜索 skill 位置**
- "出险率为何升/赔得多" → B `chexian-ir-diagnosis`；推报告 → C `chexian-im-push`；发 IM → D；写代码/debug/PR → E

## 维护协议

- **新增 skill**：走 `chexian-crystallize-skill` 流水线（共享 skill 改仓库 + 装软链；项目级放 `.claude/skills/*.md`）。**禁止在 `~/.claude/skills/` 直接建实体目录**；创建后同会话内把"本项目用法"补登到对应小节
- **skill 弃用**：表格行尾标注 `[DEPRECATED YYYY-MM]`
- **eager-load 体积监控**：本表保持 ≤ 6KB。再涨先压顶部治理 blockquote（已入 memory/BACKLOG 的留一行指针即可），再裁 D 段低频条目；**skill 名指针一律不可删**
