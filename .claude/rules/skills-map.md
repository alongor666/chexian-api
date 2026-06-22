# 本项目相关全局 Skills 速查表

> **唯一事实源**：每个 skill 完整定义在 `~/.claude/skills/<name>/SKILL.md`。本文件**只记录"本项目怎么用它"**，不重复 skill 自我描述，避免漂移。
>
> **更新规则**：会话中发现"找一个 skill 又花 5K+ token"或"用户提到我没识别的 skill"——必须当场补登记。
>
> **上游同步**：B 段 `chexian-*`/A1 `rewrite-conclusion` 源在分享仓 `alongor666/alongor666-skills`（再同步 `npx skills add <repo> -g --skill <name>`）；`chexian-commit-push-pr` = 基座 `commit-push-pr-core` wrapper。
>
> **赔款口径治理**：5 个 diagnose/report skill 赔款 CTE 已对齐 SSOT `server/src/sql/cost/cost-ratios.ts`。详见 memory `feedback_claims_window_aligned_to_earned`、BACKLOG B299。

---

## A. 诊断报告生产链（一线·高频）

### A1. 业务诊断 skill（diagnose-* 家族 · user_invocable）

| Skill | 本项目用法 | 一键命令 |
|-------|-----------|---------|
| **diagnose-org-weekly** (v1.19) | 三级机构经营诊断周报（10 板块 + 22 SPA 下钻·单文件） | `python3 ~/.claude/skills/diagnose-org-weekly/cli.py --org "<机构>" --year 2026` → `/tmp/<机构>_周报.html` |
| **diagnose-period-trend** (v2.0) | 短中长期对照（YTD/同期/滚动 6-36 月 × 5 指标 × 11 类 × 14 机构），三视图 V1 驾驶舱/V3 叙事周报/V4 超表。触发"周期趋势/短中长期对照/超表/驾驶舱" | `python3 ~/.claude/skills/diagnose-period-trend/lib/cli.py --view all` → `.../diagnose-period-trend/<cutoff>-{dashboard,weekly,table}.html` |
| **diagnose-loss-development** (v2.2) | 赔付率发展诊断（cohort + 月份矩阵 + 多维下钻）。触发"赔付率发展/loss-development" | → `server/data/reports/diagnose-loss-development/YYYY-MM-DD/` |
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

- **飞书**：`lark-im`(消息) · `lark-doc`(云文档) · `lark-base`(多维表) · `lark-sheets`(电子表格) · `lark-vc`(会议) · `lark-minutes`(妙记) · `lark-calendar`(日程) · `lark-contact`(联系人) · `lark-task`(任务) · 其他 `lark-mail`/`lark-drive`/`lark-wiki`/`lark-event`/`lark-whiteboard`/`lark-openapi-explorer`
- **企微**：`wecomcli-msg`(消息) · `wecomcli-doc`(文档) · `wecomcli-smartsheet`(智能表格) · `wecomcli-meeting`(会议) · `wecomcli-schedule`(日程) · `wecomcli-contact`(联系人) · `wecomcli-todo`(任务)

## E. 开发工具（项目工作流）

| Skill | 触发场景 |
|-------|---------|
| **codex** | 第二意见 / 对抗式 review（"ask codex" / "codex review"） |
| **qa** / **qa-only** | 系统性 QA 并修 bug（生产前最后一道闸） |
| **review** | Pre-landing PR review（SQL 安全 / LLM 信任边界 / 条件副作用） |
| **security-review** | 处理用户输入 / 鉴权 / 敏感数据时强制触发 |
| **tech-stack-audit** | 技术栈只读审计 + 治理热启动 prompt（"审计技术栈/依赖审计/技术栈体检"触发）。首次产出见 开发文档/reviews/2026-06-12-技术栈审计.md |
| **investigate** | 系统性 debug 四阶段，铁律"无根因不修复" |
| **claude-api** | 修改本项目 Anthropic SDK 调用（智谱→真 Claude、prompt caching 调优） |
| **sql-pro** | DuckDB 复杂 SQL 优化（窗口函数 / CTE / 执行计划） |
| **chexian-crystallize-skill** | "沉淀成 skill / 固化成技能" → 五步流水线。铁律「改在仓库·装到本地·本地只读」，详见 memory `project_skills_maintenance_model` |
| **cleanup-worktrees** | "清理/回收 worktree" → 安全回收器，默认只删零损失（`--dry-run` 盘点 / `--archive` 备份后清理） |
| **/chexian-evidence-loop**（基座 `evidence-loop-core`） | "按证据闭环做 / evidence loop / 先建 harness 再动手" → 三阶段（harness 报告 → loop checkpoint → verifier 证伪）。本项目 §4 表见 `.claude/rules/evidence-loop.md` |

---

## 触发对齐规则（路由）

- "X 经营诊断周报/跑一份周报" → A1 `diagnose-org-weekly` 直接套命令，**禁止搜索 skill 位置**
- "出险率为什么升/为什么赔得多" → B `chexian-ir-diagnosis` · 报告要推 → C `chexian-im-push` · 发 IM → D 查域+平台 · 写代码/debug/PR → E

## 维护协议

- **新增 skill**：走 `chexian-crystallize-skill` 流水线（共享 skill 改仓库 + 装软链；项目级放 `.claude/skills/*.md`）。**禁止在 `~/.claude/skills/` 直接建实体目录**；创建后同会话内把"本项目用法"补登到对应小节
- **skill 弃用**：表格行尾标注 `[DEPRECATED YYYY-MM]`（参 `xcl-pdf2lark` 不在本表的处理）
- **eager-load 体积监控**：本表保持 ≤ 6KB。再涨先压顶部治理 blockquote（已入 memory/BACKLOG 的留一行指针即可），再裁 D 段低频条目；**skill 名指针一律不可删**
