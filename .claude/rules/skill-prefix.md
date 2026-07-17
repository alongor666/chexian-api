---
paths: [".claude/skills/**", ".claude/agents/**", ".claude/commands/**"]
---

# Skill 命名前缀规范（chexian 簇治理）

> CLAUDE.md §12 下沉。新增 / 重命名 / 审计 `~/.claude/skills/` 下的 chexian 簇 skill 时遵守。

## 前缀语义表

| 前缀 | 真实语义 | 簇角色 | 代表 |
|------|------|------|------|
| `chexian-*` | 中文"车险"前缀 | 项目基础设施 / 工程任务（通常被 import 或为项目改造任务） | chexian-report-shell（渲染基础设施）、chexian-local-risk-control |
| ~~`auto-*`~~ → `chexian-*` | ✅ 2026-05-18 P3.1 已治理改名，全部归入 chexian 簇：chexian-channel / chexian-pricing-decision / chexian-market-analysis / chexian-ir-diagnosis / chexian-ops-review |
| `diagnose-*` | 诊断报告前缀 | 数据驱动诊断（Python + DuckDB → HTML） | diagnose-org-weekly / diagnose-period-trend / diagnose-loss-development |

**前缀语义不绑定内容形式**：`chexian-*` 不强制项目专属（含决策协议 + 业务推理）、`diagnose-*` 不强制必须含 `lib/*.py`。前缀只表达**业务定位**。`auto-*` → `chexian-*` 历史冗余已于 2026-05-18 P3.1 治理完成（5 个 skill 全部归并到 chexian 簇）。

## 遗留前缀 — `xcl-*`（用户名字缩写，违反"前缀语义化"原则）

| Skill | 状态 | 治理动作 |
|---|---|---|
| `xcl-pdf2lark` | DEPRECATED（2026-11 退役） | 等自然退役 |
| ~~`xcl-ppt2im`~~ → `chexian-im-push` | ✅ 已改名归入 chexian 簇（2026-05-18 P3.2 完成） | — |

## 新增 skill 铁律

- ✅ 业务领域前缀（`chexian-` / `auto-` / `diagnose-`）
- ✅ 角色/功能前缀（`lark-` / `wecomcli-` 等中性工具集前缀）
- ❌ 禁止个人/机构名字缩写做前缀（`xcl-` 等）— 命名要让任何人/AI 看名字就能猜功能

## Frontmatter

**必填**：`name`（与目录名一致）、`description`（含触发语义：`Use when` / `当用户` / `触发` / `适用于` 任一）。

**推荐**：`version`（业务 skill 演进可追溯）、`user_invocable`（基础设施层显式 `false`）；agent 文件推荐显式 `model`（默认 sonnet，仅架构推理类用 opus，搜索归档类用 haiku）。

## 单一事实源

跨 skill 重复的常量 / 模板 / 规则 ≥ 2 处出现 → 上提到 `~/.claude/skills/chexian-report-shell/lib/`。

## 审计

`bash ~/.claude/audits/scripts/{T1,T2,T4}.sh` 出基线 TSV。完整方法论与流程见 `~/.claude/plans/claude-dode-slash-agent-refactored-crane.md`。

## 项目内不再新建实体 skill（[policy-override] 2026-07-16）

> **授权来源**：用户 2026-07-16 铁律指令（"所有技能必须创建在 alongor666-skills 仓库，不同项目和 Agent 通过软链使用"）+ backlog uid `2026-07-16-claude-10446a` 登记。本条修改本文件下方"项目级 skill 放 `.claude/skills/*.md`"一类既有口径的**主体**，属 AGENTS.md §8.2 append-only 例外场景，授权与落地见 PR「refactor(skills): [policy-override] 14 个存量项目技能迁入 skills 仓，项目侧改软链消费」。

新铁律：**所有 skill（含仅本项目使用的车险业务 skill）一律建在 `alongor666-skills` 仓库 `skills/<name>/SKILL.md`，项目侧不再新建实体 `.claude/skills/*.md` 文件**，改为经 `sync-skills` 装到 `~/.claude/skills/<name>` 的软链消费（与 chexian-daily-loop / chexian-ir-diagnosis 等既有共享 skill 消费方式一致）。原 14 个扁平存量项目 skill（`accident-profile-report` / `adr-tiered-response` / `agent-system-design-principles` / `chexian-bug-hunt` / `chexian-refactor-audit-execute` / `chexian-refactor-audit-review` / `chexian-sentinel-attribution` / `code-search-routing` / `dev-stop-on-mismatch` / `incident-rate-development` / `ncd-pricing-diagnosis` / `pr-review-playbook` / `rule-promotion-gate` / `silent-failure-guard`）已按此迁出。`.claude/skills/` 目录预期为空/不存在；`scripts/governance/skill-frontmatter.mjs` 闸对此优雅通过，并扩展支持 `<name>/SKILL.md` 目录/软链形态，防止未来有人绕铁律往项目里塞实体技能时闸失效。

## 关联

- 全局 skill 速查与"本项目用法"：[skills-map.md](./skills-map.md)
- ~~项目级 skill（`.claude/skills/*.md`）由各自 frontmatter `description` 自动注入上下文被发现（AI-native，不维护 README 索引）~~ — 2026-07-16 起该口径被上方「项目内不再新建实体 skill」取代；本项目仍是 AI-native（不维护人工 README 索引），但发现机制改为 Skill 工具扫描 `~/.claude/skills/`（skills 仓软链目标），不再扫描项目内路径
