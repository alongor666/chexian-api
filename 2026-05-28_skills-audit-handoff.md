# Skills 审查与 GitHub 发布 — 交接上下文

> 新开会话后直接读本文件，不需要重新探索目录结构。
> 目标：逐个审查自研 skill，决定保留/删除/发布，最终整理成一个公开 GitHub Monorepo。

---

## 背景结论（已确认）

| 分类 | 数量 | 处理原则 |
|------|------|---------|
| Jeffallan 公开仓库 (MIT) | 66 个 | **绝不上传**（别人的作品） |
| 一泽 Eze (upstream-author) | 1 个 (`web-access`) | **绝不上传** |
| _archive 归档目录 | ~10 个 | 跳过（已废弃） |
| **自研候选（待审查）** | **~115 个** | 逐个审查后决定 |
| 项目级 skills (.claude/skills/) | 26 个 | 单独处理，见下方 §4 |

---

## § 1. 绝不上传清单（第三方）

```
# 来自 https://github.com/Jeffallan（66 个）：
api-designer, architecture-designer, chaos-engineer, cli-developer,
cloud-architect, code-documenter, code-reviewer, csharp-developer,
database-optimizer, debugging-wizard, devops-engineer, django-expert,
embedded-systems, fastapi-expert, feature-forge, fine-tuning-expert,
flutter-expert, fullstack-guardian, game-developer, golang-pro,
graphql-architect, java-architect, javascript-pro, kubernetes-specialist,
laravel-specialist, legacy-modernizer, mcp-developer, microservices-architect,
ml-pipeline, monitoring-expert, nestjs-expert, nextjs-developer, pandas-pro,
php-pro, playwright-expert, postgres-pro, prompt-engineer, python-pro,
rag-architect, rails-expert, react-expert, react-native-expert, rust-engineer,
salesforce-developer, secure-code-guardian, security-reviewer, shopify-expert,
spec-miner, spring-boot-engineer, sql-pro, sre-engineer, swift-expert,
terraform-engineer, test-master, the-fool, typescript-pro, vue-expert,
websocket-engineer, wordpress-pro
（_archive 中的已归档版本同样不上传）

# 来自一泽 Eze（1 个）：
web-access
```

---

## § 2. 自研审查计划（按优先级分批）

**审查格式**（每个 skill 展示）：
- 名称 + 版本 + 最后更新日期
- 一句话功能描述
- 典型用法/触发词
- 判断依据（是否还在用？有没有更好替代？）

**你的判断**：
- ✅ **发布** — 好东西，上传 GitHub
- 🗑️ **删除** — 过时/重复/没用，本地也删
- ⏸️ **保留不发布** — 太私人 / 太项目专属 / 暂不确定

---

### 批次 A：chexian 车险专属（11 个）

优先审查理由：明确自研，与 chexian-api 项目强绑定，部分可能需要脱敏才能发布。

| # | Skill | 简述 | 审查状态 |
|---|-------|------|---------|
| A1 | `chexian-channel` | 渠道投入决策（4S/经代/代理评估） | 待审 |
| A2 | `chexian-im-push` | HTML 报告→飞书/企微推送 | 待审 |
| A3 | `chexian-ir-diagnosis` | 出险率恶化根因诊断 | 待审 |
| A4 | `chexian-local-risk-control` | 本地风险选择 TypeScript 编排 | 待审 |
| A5 | `chexian-market-analysis` | 城市级市场竞争结构分析 | 待审 |
| A6 | `chexian-ops-review` | 城市级经营复盘（市场+渠道+承保+理赔） | 待审 |
| A7 | `chexian-pricing-decision` | 商车定价决策与核保策略 | 待审 |
| A8 | `chexian-report-shell` v1.19 | 诊断报告共享渲染基础设施层 | 待审 |
| A9 | `diagnose-loss-development` v2.2 | 赔付率发展诊断（cohort+矩阵） | 待审 |
| A10 | `diagnose-org-weekly` v1.19 | 三级机构经营诊断周报（10板块+22 SPA子页） | 待审 |
| A11 | `diagnose-period-trend` v1.0 | 周期趋势诊断（YTD×同期×滚动多窗） | 待审 |

---

### 批次 B：ljg 个人 workflow（17 个）

优先审查理由：用户名字前缀，100% 自研，大多是通用内容处理工具，发布价值高。

| # | Skill | 简述 | 审查状态 |
|---|-------|------|---------|
| B1 | `ljg-card` v1.8 | 内容→PNG卡片（7种模具：长图/信息图/漫画/白板/小红书…） | 待审 |
| B2 | `ljg-invest` | 投资分析报告（秩序创造机器框架） | 待审 |
| B3 | `ljg-learn` | 概念深度解剖（8维度+顿悟压缩） | 待审 |
| B4 | `ljg-paper` | 非学术论文阅读伴侣 | 待审 |
| B5 | `ljg-paper-flow` | 论文→分析+漫画卡片一条龙 | 待审 |
| B6 | `ljg-paper-river` | 论文溯源：递归找前序/后续演化史 | 待审 |
| B7 | `ljg-plain` | 任何内容→12岁都能看懂的白话版 | 待审 |
| B8 | `ljg-rank` | 降秩：找领域背后不可再少的生成器 | 待审 |
| B9 | `ljg-read` | 伴读：翻译+批注+追问+跨域洞察 | 待审 |
| B10 | `ljg-relationship` | （待展示） | 待审 |
| B11 | `ljg-roundtable` | （待展示） | 待审 |
| B12 | `ljg-skill-map` | 已安装 skills 可视化地图 | 待审 |
| B13 | `ljg-think` | 追本之箭：纵向深钻到不可再分的本质 | 待审 |
| B14 | `ljg-travel` | 旅行前深度研究（博物馆/古建）→org+PNG | 待审 |
| B15 | `ljg-word` | 英文单词深度解构 | 待审 |
| B16 | `ljg-word-flow` | 单词分析+信息图卡片一条龙 | 待审 |
| B17 | `ljg-writes` | 写作引擎（手术刀剖析观点，1000-1500字） | 待审 |
| B18 | `ljg-xray` | X光系列统一入口（路由到子技能） | 待审 |
| B19 | `ljg-xray-article` | ⚠️ 无 SKILL.md，需检查 | 待审 |
| B20 | `ljg-xray-book` | ⚠️ 无 SKILL.md，需检查 | 待审 |
| B21 | `ljg-xray-paper` | ⚠️ 无 SKILL.md，需检查 | 待审 |
| B22 | `ljg-xray-prompt` | ⚠️ 无 SKILL.md，需检查 | 待审 |
| B23 | `ljg-xray-skill` | ⚠️ 无 SKILL.md，需检查 | 待审 |

---

### 批次 C：lark 飞书集成（17 个）

| # | Skill | 简述 | 审查状态 |
|---|-------|------|---------|
| C1 | `lark-im` | 飞书消息收发/群聊管理 | 待审 |
| C2 | `lark-doc` | 飞书云文档操作 | 待审 |
| C3 | `lark-base` | 飞书多维表格 | 待审 |
| C4 | `lark-sheets` | 飞书电子表格 | 待审 |
| C5 | `lark-calendar` | 飞书日程 | 待审 |
| C6 | `lark-task` | 飞书任务 | 待审 |
| C7 | `lark-contact` | 飞书联系人 | 待审 |
| C8 | `lark-drive` | 飞书云盘 | 待审 |
| C9 | `lark-wiki` | 飞书知识库 | 待审 |
| C10 | `lark-mail` | 飞书邮件 | 待审 |
| C11 | `lark-minutes` | 妙记（会议录音转写） | 待审 |
| C12 | `lark-approval` | 飞书审批 | 待审 |
| C13 | `lark-vc` | 飞书视频会议 | 待审 |
| C14 | `lark-vc-agent` | 飞书 VC agent | 待审 |
| C15 | `lark-openapi-explorer` | 飞书 OpenAPI 探索 | 待审 |
| C16 | `lark-workflow-meeting-summary` | 飞书工作流：会议纪要 | 待审 |
| C17 | `lark-workflow-standup-report` | 飞书工作流：站会报告 | 待审 |
| C18 | `lark-shared` | 飞书共享基础 | 待审 |
| C19 | `lark-apps` | 飞书应用 | 待审 |
| C20 | `lark-event` | 飞书事件 | 待审 |
| C21 | `lark-markdown` | 飞书 Markdown | 待审 |
| C22 | `lark-okr` | 飞书 OKR | 待审 |
| C23 | `lark-skill-maker` | 飞书 skill 制作工具 | 待审 |
| C24 | `lark-slides` | 飞书幻灯片 | 待审 |
| C25 | `lark-whiteboard` | 飞书白板 | 待审 |

---

### 批次 D：wecomcli 企微集成（7 个）

| # | Skill | 简述 | 审查状态 |
|---|-------|------|---------|
| D1 | `wecomcli-msg` | 企微消息发送 | 待审 |
| D2 | `wecomcli-doc` | 企微文档 | 待审 |
| D3 | `wecomcli-smartsheet` | 企微智能表格 | 待审 |
| D4 | `wecomcli-meeting` | 企微会议 | 待审 |
| D5 | `wecomcli-schedule` | 企微日程 | 待审 |
| D6 | `wecomcli-contact` | 企微联系人 | 待审 |
| D7 | `wecomcli-todo` | 企微待办 | 待审 |

---

### 批次 E：通用工具（待分类，~40 个）

需要逐个确认是否自研还是从模板改写：

```
backend-patterns, baoyu-translate, brainstorming, claude-to-im,
clickhouse-io, coding-standards, company-vortex, configure-ecc,
consolidate-memory, content-hash-cache-pattern, continuous-learning-v2,
cost-aware-llm-pipeline, cpp-coding-standards, database-migrations,
deployment-patterns, dispatching-parallel-agents, django-patterns,
django-security, django-tdd, django-verification, docker-patterns,
e2e-testing, eval-harness, executing-plans, finishing-a-development-branch,
frontend-patterns, golang-patterns, golang-testing, iterative-retrieval,
java-coding-standards, jpa-patterns, khazix-writer, magazine-web-ppt,
nutrient-document-processing, postgres-patterns, project-guidelines-example,
python-patterns, python-testing, receiving-code-review, regex-vs-llm-structured-text,
requesting-code-review, rewrite-conclusion, security-review, security-scan,
springboot-patterns, springboot-security, springboot-tdd, springboot-verification,
strategic-compact, subagent-driven-development, swift-protocol-di-testing,
systematic-debugging, tdd-workflow, test-driven-development, using-git-worktrees,
using-superpowers, verification-before-completion, verification-loop, weread-skills,
writing-plans, writing-skills, xcl-pdf2lark
```

---

## § 3. 新会话工作流程

**新会话开始后的指令**：

> 读 `/Users/alongor666/Downloads/底层数据湖DUD/chexian-api/2026-05-28_skills-audit-handoff.md`，
> 然后按批次 A → B → C → D → E 的顺序，每次展示 **3-5 个** skill 的详细信息（名称/版本/描述/典型用法/SKILL.md 关键片段），
> 让我逐个判断：✅发布 / 🗑️删除 / ⏸️保留不发布。
> 完成所有审查后，将 ✅ 的 skills 整理到 GitHub Monorepo。

**每个 skill 展示格式**：
```
### [名称] vX.X（最后更新 YYYY-MM-DD）
**一句话**：xxx
**触发词**：xxx
**SKILL.md 关键片段**：（前30行）
**你的判断**：[✅发布 / 🗑️删除 / ⏸️保留]
```

---

## § 4. 项目级 skills 单独处理

位于 `chexian-api/.claude/skills/`（26 个），这些不迁移到全局仓库：

```
autoplan, benchmark, benchmark-models, canary, checkpoint,
connect-chrome, context-restore, context-save, cso, design-html,
design-shotgun, devex-review, gstack, health, land-and-deploy,
learn, make-pdf, open-gstack-browser, pair-agent, plan-devex-review,
plan-tune, setup-deploy
（另有 3 个 .md 单文件：accident-profile-report, incident-rate-development, ncd-pricing-diagnosis）
```

这些随 chexian-api 仓库一起版本管理，**不纳入本次审查**。

---

## § 5. 最终 GitHub 仓库结构（审查完成后）

```
claude-skills/                    ← 仓库名（公开）
├── README.md
├── install.sh                    ← ln -sf ~/.claude/skills/<name>
├── chexian/                      ← 批次 A（车险专属，需配置环境）
├── personal/                     ← 批次 B（ljg 系列，个人 workflow）
├── lark/                         ← 批次 C（飞书集成）
├── wecom/                        ← 批次 D（企微集成）
└── general/                      ← 批次 E（通用工具）
```

---

## 进度追踪

- [x] 信息收集完成（2026-05-28）
- [ ] 批次 A 审查（chexian/diagnose，11 个）
- [ ] 批次 B 审查（ljg，23 个含子系列）
- [ ] 批次 C 审查（lark，25 个）
- [ ] 批次 D 审查（wecomcli，7 个）
- [ ] 批次 E 审查（通用，~40 个）
- [ ] GitHub 仓库创建 + 推送
- [ ] install.sh 脚本验证
