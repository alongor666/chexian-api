---
name: pr-review-playbook
description: 本项目 PR 评审打法 — 通用 code review 之上的项目特化层，自带自进化协议（实测优先/三口径分离/CI盲区分类/护栏复跑/回退实验）。Use when 用户要求评审本仓库 PR（"评审 pr NNN"/"审 prNNN"/review PR）、复审被反驳的评审结论、或把评审意见发到 PR 评论区时。
version: 1.0.0
---

# PR 评审打法（含自进化协议）

> 来源：2026-06 ApiClient 神类拆分系列（PR #533–#557，20+ 个 PR）评审实战沉淀。定位：**不替代**通用 code review（正确性/安全/风格照常），只编码"本项目哪里不一样"。
>
> 结构按进化速率分三层：**L1 不变量**（几乎不变）→ **L2 探测器**（随项目护栏自动变强，本文件零修改）→ **L3 战技**（随模型能力替换）。配套**校准账**（append-only）记录判错/反转案例——判错案例比规则更能校准判断。

## L1 不变量（模型无关、手段无关）

| # | 不变量 | 违反后果（实证） |
|---|--------|----------------|
| 1 | **实测优先**：worktree 锁定 head SHA 实跑，数字以实跑为准，不信 PR 自述 | #548 自述 79 实测 83——rebase 后自述陈旧是常态 |
| 2 | **三口径分离**：数据断言裁决前先问是**文档口径、生成器口径还是运行时口径**，三者分开验 | #543 评审方向判反：生成器 union_by_name=41、运行时裸读、文档误标，混为一谈 |
| 3 | **CI 可见性标注**：每条 finding 标注 CI 抓得到/抓不到；Parquet 不进 CI，数据断言必须要求 duckdb 直查证据 | #543 governance 全绿 ≠ field_count 被验证过 |
| 4 | **注册表第一问**：新指标/字段/路由/枚举先问"注册表登记了吗"（CLAUDE.md §2）；派生文件（BACKLOG.md / data-sources.json / 指标字典）的 diff 只问"是否重渲"，不逐行评内容 | 绕过注册表 = 红线；手评派生物 = 白费 |
| 5 | **残留命中必甄别**：旧名 grep 命中分四类再判——同名 UI 工具函数 / server 侧同名函数 / 注释与来源标注 / golden 夹具 | #544/#549/#557 三类误报，机械 grep 必误伤 |
| 6 | **意见可执行可证伪**：findings 编号 + 分级（阻塞/非阻塞/trivial）；每轮先核对上轮意见采纳情况；被反驳时用证据裁决——错了就认、对的部分坚持 | #543 复审：认错数值方向，同时证伪"server 加载=union" |
| 7 | **业务口径零假设**：车险因果/口径不确定先查 [business-domain.md](../rules/business-domain.md) 与业务规则字典，禁止替业务下因果结论 | CLAUDE.md §10 红线 |
| 8 | **评审深度配风险**：纯搬运/文档 PR 轻验（残留+等价+护栏）；动传输内核/部署链/业务口径的 PR 重验（特征化+回退实验+源数据对账） | agent-system-design-principles 原理⑤ |

## L2 探测器（活命令层）

> **本层只写命令不写结论；清单一律现场派生**——禁止把"当前有哪些脚本/测试/子客户端"写死进本文件。项目长出新护栏，本层自动变强，零修改。

按序执行，输出贴进评审：

1. **取证**：`git fetch origin <branch>` → 比对 FETCH_HEAD 与 PR head SHA → `git worktree add -d /tmp/pr<N> <sha>`。评审专用 worktree（detached 只读、用毕 `git worktree remove --force` + `prune`）；开发 worktree 仍按 [worktree-setup.md §A](../rules/worktree-setup.md) 放兄弟目录。主目录永不 checkout 业务分支。
2. **基线**：`bun install` → `bunx tsc --noEmit` → `bunx vitest run <受影响测试>`（受影响 = diff 里的测试文件 + 被改源码对应的测试；注意是 `bunx vitest`，`bun run test` 是全量）。
3. **护栏复跑**（清单现场派生）：`ls scripts/check-*.mjs scripts/*conservation*.mjs` → 与改动面相关者逐个跑；`bun run governance` 必跑。
4. **CI/合并态判读**：check_runs 全绿才可合；`mergeable_state` = behind → 要求 rebase 后重验（CI 跑的是旧 base）；blocked → 找出未完成/失败的 check 再裁决，扫描器红了先按 L3 解码甄别。
5. **残留扫描**：grep 全部被删旧名于 `src/ tests/ server/` → 按 L1#5 逐条甄别。
6. **数据口径**（涉数据才跑）：duckdb 直查 Parquet 对账（命令模板见 CLAUDE.md §6 验证协议），区分本地 `数据管理/warehouse/` 与 VPS 运行时 `server/data/`，区分 union_by_name 与裸读。
7. **检索选刀**：按 [code-search-routing](./code-search-routing.md)——字面量/路由串/中文口径词用 grep，"改 X 波及谁"用 LSP。

## L3 战技（手段层，**可替换**——更强手段出现即覆盖本节，不留恋旧步骤）

| 战技 | 适用 | 实证 |
|------|------|------|
| **回退实验**（bug-fix 金标准）：还原 bug 确认测试变红，恢复 fix 确认变绿 | 一切 bug 修复 PR | #555 去 fix 后测试超时，坐实 bug/测试/fix 三真 |
| **去防御实验**：删掉可疑的 `as any`/兜底再跑 tsc，证其多余 | 类型强转、防御性代码 | #548 去强转后 tsc 仍零错 |
| **夹具解码甄别**：扫描器告警的"密钥"先 base64/JWT 解码定性 dummy 还是真泄漏 | GitGuardian/内部凭据扫描器红 | #556 jwt.io 示例误报；夹具须 key 与 value 双重混淆 |
| **字节级等价抽取**：brace-matching 抽方法体做新旧 diff | 声称"逐字符等价"的搬运 PR | #536 起多次 |
| **并发/初始化序推演**：基类字段先于派生类初始化；transport 句柄只读边界；in-flight 合并与重试的交互 | 动 client-core/共享状态 | #540/#551/#555 |

## 评审输出契约

- 全程中文、术语全称（报告语言红线）；**结论先行**（可合并/需修/blocked + 一句话理由）；验证表（项/方法/结果）；findings 编号分级并标注 CI 可见性。
- 发布到 PR 评论区用 add_issue_comment（COMMENT）——同 token 不能 approve 自己的 PR；merge 仅在用户明示后执行。
- 不阻塞但有价值的观察 → 建议作者登记 BACKLOG（event-log 写入：`bun scripts/backlog.mjs`，禁手编视图）。

## 校准账（append-only，自进化的证据底座）

账本：[project_pr_review_calibration.md](../shared-memory/project_pr_review_calibration.md)。

- **何时写**：评审结论被采纳/被反驳/被证实误报/自我反转时追加一行（学 BACKLOG event-log：只追加，纠错也追加不回改）。
- **何用**：复审与模型升级仪式前先读——判错案例是比规则更有效的校准材料。

## 自进化协议（四触发器）

| 触发器 | 动作 |
|--------|------|
| **当场补登** | 评审中出现新战技/新误报类型 → L3/校准账当场追加；新护栏 → L2 零修改（清单 fs 派生自动纳入） |
| **采纳/反驳落账** | 每轮评审开始先核对上轮意见落地情况 → 结果写校准账；同一判据连续 2 次被反驳 → 修订对应 L1/L3 条目 |
| **模型升级仪式** | 模型/能力变化后的首次评审前，先对抗式审计本 skill（零上下文独立验证，参照 [rule-promotion-gate §3](./rule-promotion-gate.md)）：删冗/补强/替换 L3 战技，diff 经用户裁决后落盘 |
| **防腐自检** | 每次修订本文件时：①体积 ≤10KB（超限先裁 L3 旧战技、归档校准账旧行）②引用的脚本/文件 `ls` 探测存在性，消失即同步 ③外部工具（GitGuardian/GitHub API/bun）的行为**永不写成事实**，只写"遇 X 信号先探测再裁决" |

**进化边界（诚实条款）**：机器能自动化的是触发、校验、防腐；进化**内容**本身由评审会话当场落账产生——沿用 skills-map/memory 的既有"发现即补登"模式，不另造机器。

**新经验放哪一层**：过 [rule-promotion-gate](./rule-promotion-gate.md) 语义独立测试——抹掉 chexian 仍成立 → 候选上提通用层；依赖本项目护栏/口径/数据架构 → 留本文件。

## 关联

- 母原理：本 skill 是 `agent-system-design-principles` 原理③（独立对抗验证）+ ①（状态外置：校准账）+ ⑤（投入配风险：L1#8）的落地件。
- 通用基座：全局 `review` / `code-review` skill 管通用维度；本 skill 只管项目特化层，两者叠加使用。
- 红线来源：CLAUDE.md §0/§2/§6/§10 · [business-domain.md](../rules/business-domain.md) · [backlog-eventlog.md](../rules/backlog-eventlog.md) · [worktree-setup.md](../rules/worktree-setup.md) §A。
