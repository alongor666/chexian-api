# 本项目相关全局 Skills 速查表

> **唯一事实源**：每个 skill 完整定义在 `~/.claude/skills/<name>/SKILL.md`。本文件**只记录"本项目怎么用它"**，不重复 skill 自我描述，避免漂移。
>
> **更新规则**：会话中发现"找一个 skill 又花 5K+ token"或"用户提到我没识别的 skill"——必须当场补登记。
>
> **上游同步（2026-05-30）**：B 段 5 个 `chexian-*` 与 A1 `rewrite-conclusion` 权威版已在分享仓 `alongor666/alongor666-skills` 升级到官方最佳实践（frontmatter 重写 + 拆 `references/`，领域口径零改动），安装态 `~/.claude/skills/` 已同步到位。该仓后续再升级后用 `npx skills add alongor666/alongor666-skills -g --skill <name>` 重新同步。新基座 `commit-push-pr-core`（提交建 PR + 通用 git 护栏）亦在该仓，本项目 `chexian-commit-push-pr` 即其 wrapper。

---

## A. 诊断报告生产链（一线·高频）

### A1. 业务诊断 skill（diagnose-* 家族 · user_invocable）

| Skill | 本项目用法 | 一键命令 |
|-------|-----------|---------|
| **diagnose-org-weekly** (v1.19) | 三级机构经营诊断周报（10 板块 + 22 个 SPA 下钻子页·单文件） | `python3 ~/.claude/skills/diagnose-org-weekly/cli.py --org "<机构>" --year 2026` 产出 `/tmp/<机构>_2026_经营诊断周报.html` (~780KB) |
| **diagnose-period-trend** (v2.0) | 短中长期对照（YTD × 上年同期 × 滚动 6/12/24/36 月 × 5 指标 × 11 客户类别 × 14 机构），三视图：V1 驾驶舱 / V3 叙事周报 / V4 超表 + legacy | 用户说"周期趋势/趋势诊断/短中长期对照/超表/驾驶舱"时触发，`python3 ~/.claude/skills/diagnose-period-trend/lib/cli.py --view all`，产出 `public/reports/diagnose-period-trend/<cutoff>-{dashboard,weekly,table}.html`（cutoff 默认取 MAX 起保日） |
| **diagnose-loss-development** (v2.2) | 赔付率发展诊断（cohort + 月份矩阵 + 多维下钻） | 用户说"赔付率发展/loss-development"时触发，产出 `server/data/reports/diagnose-loss-development/YYYY-MM-DD/` |
| **rewrite-conclusion** | L2 诊断结论 AI 重写：读 L1 脚本的车型子文档和机构诊断卡，提炼为管理层可读判断 | `--topic 出险率\|费用率\|保费达成` |

### A2. 渲染基础设施（被 A1 集成，**不直接调用**）

| Skill | 角色 |
|-------|------|
| **chexian-report-shell** (v1.19) | A1 共享渲染层（render_page / 亮灯 / SPA / 取数 / IM 推送）。user_invocable=false。2026-05-17 由 `diagnose-html-render` 重命名 + 剥离业务工具 |

## B. 车险业务场景咨询（一线·决策辅助）

| Skill | 何时调用 |
|-------|---------|
| **chexian-ir-diagnosis** | 出险率恶化根因分析（"为什么出险率上升"） |
| **chexian-channel** | 渠道经营评估：4S / 经代 / 代理 / 经纪是否值得继续投入 |
| **chexian-pricing-decision** | 定价决策：商业险报价、核保策略（与 chexian-pricing-redline 反事实定价分析平行） |
| **chexian-market-analysis** | 市场竞争结构分析 / 增长机会评估 |
| **chexian-ops-review** | 城市级（华安）经营复盘：市场+渠道+承保+理赔合并视图 |
| **chexian-local-risk-control** | 本项目专属：本地个人版车险风险选择 / 成本控制 TypeScript 编排（`/api/local-skills/run`） |

## C. 报告分发与演示（二线·按需）

| Skill | 用途 |
|-------|------|
| **chexian-im-push** | HTML→链接式 PPT 推飞书/企微（**首选**，替代已弃 `xcl-pdf2lark`；2026-05-18 P3.2 由 `xcl-ppt2im` 改名） |
| **magazine-web-ppt** | 杂志风/电子墨水风网页 PPT（发布会、对外分享） |
| **pdf2wecom** | PDF 推企微（旧链路，新需求优先 chexian-im-push） |
| **make-pdf** | HTML 转 PDF |

## D. 通道集成（按需，触发即用）

| 域 | 飞书 Skills | 企微 Skills |
|----|------------|------------|
| **消息** | `lark-im` | `wecomcli-msg` |
| **文档** | `lark-doc`（云文档） | `wecomcli-doc` |
| **表格** | `lark-base`（多维）<br>`lark-sheets`（电子表格） | `wecomcli-smartsheet`（智能表格） |
| **会议** | `lark-vc`（视频会议）<br>`lark-minutes`（妙记） | `wecomcli-meeting` |
| **日程** | `lark-calendar` | `wecomcli-schedule` |
| **联系人** | `lark-contact` | `wecomcli-contact` |
| **任务** | `lark-task` | `wecomcli-todo` |
| **其他** | `lark-mail` / `lark-drive` / `lark-wiki` / `lark-event` / `lark-whiteboard` / `lark-openapi-explorer` | — |

## E. 开发工具（项目工作流）

| Skill | 触发场景 |
|-------|---------|
| **codex** | 需要第二意见 / 对抗式 review（"ask codex" / "codex review"）。详见 [`.claude/skills/codex/`](~/.claude/skills/codex/) |
| **browse** | 前端 QA 测试 / 视觉验证（"开浏览器测一下"），调用 gstack daemon |
| **qa** / **qa-only** | 系统性 QA 测试并修 bug（注意：生产前最后一道闸） |
| **review** | Pre-landing PR review（SQL 安全 / LLM 信任边界 / 条件副作用） |
| **security-review** | 处理用户输入 / 鉴权 / 敏感数据时强制触发 |
| **investigate** | 系统性 debug：四阶段（investigate→analyze→hypothesize→implement），铁律"无根因不修复" |
| **claude-api** | 修改本项目 Anthropic SDK 调用（如智谱 → 真 Claude 切换、prompt caching 调优） |
| **sql-pro** | DuckDB 复杂 SQL 优化（窗口函数 / CTE / 执行计划） |
| **chexian-crystallize-skill** | 用户说"沉淀成 skill / 固化成技能 / 封装成 skill" → 自动跑五步流水线（判归属→查重叠→写 SSOT→push+装软链→登记）。维护铁律「改在仓库·装到本地·本地只读」，详见 memory `project_skills_maintenance_model` |

---

## 触发对齐规则

- **用户说"X 经营诊断周报""跑一份 X 周报"** → 直接用 A1 的 `diagnose-org-weekly` 命令模板，**禁止搜索 skill 位置**
- **用户问"X 出险率为什么升""为什么赔得多"** → B 的 `chexian-ir-diagnosis`
- **报告做完要推** → C 优先 `chexian-im-push`（飞书云文档式 HTML 链接）
- **要发到 IM** → D 表中查域 + 平台
- **写代码、debug、PR** → E

## 维护协议

- **新增 skill**：走 `chexian-crystallize-skill` 流水线（共享 skill 改在仓库 `alongor666/alongor666-skills` 再 `skills add` 装软链；项目级放 `.claude/skills/*.md`）。**禁止在 `~/.claude/skills/` 直接建实体目录**。创建后同一会话内必须把"本项目用法"补登到对应小节
- **skill 弃用**：在表格行尾标注 `[DEPRECATED YYYY-MM]`（参 `xcl-pdf2lark` 不在本表的处理）
- **eager-load 体积监控**：本表保持 ≤ 6KB（v1.19 拆分 A 段为 A1/A2 后从 4KB 上调；再涨先裁 D 表"其他"行的低频条目）
