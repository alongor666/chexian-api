# 项目 Skills 索引

> 项目专属技能（`.md` 单文件）。第三方/全局 skill 一律走 `~/.claude/skills/`，本目录只放**项目独有**的方法论与模板。

**最后更新**: 2026-05-18 · **维护者**: @claude

---

## 治理规则（来自 `.gitignore`）

```
.claude/skills/*       # 全部忽略
!.claude/skills/*.md   # 但保留顶层 .md 文件
```

**含义**：

- ✅ **项目专属技能 = `.md` 单文件**（被 git 跟踪）
- ❌ **目录形式的 skill 一律不属于本项目**（属于全局 `~/.claude/skills/` 或第三方分发）
- ❌ **不要在 `.claude/skills/` 下创建子目录**，git 不会跟踪，且会产生与全局 skill 的冲突

历史背景：2026-01 ~ 2026-05 期间本目录曾混入 22 个全局 skill 的本地副本（含整个 gstack 源码仓 831MB），已于 2026-05-18 清理。规则升级后这种情况不会再发生。

---

## 当前项目专属技能（3 个）

| 技能 | 用途 | 文件 |
|------|------|------|
| `accident-profile-report` | 基于理赔明细文本生成分车种/分险种事故画像报告 | [accident-profile-report.md](./accident-profile-report.md) |
| `incident-rate-development` | **纵向**：按维度构建等发展天数的出险率+案均+赔付率三角形 | [incident-rate-development.md](./incident-rate-development.md) |
| `ncd-pricing-diagnosis` | **横向**：NCD 档位定价扭曲诊断，与 `incident-rate-development` 互补 | [ncd-pricing-diagnosis.md](./ncd-pricing-diagnosis.md) |

---

## 决策树：要不要新建项目级 skill？

```
你想做的事...

├─ 已有 chexian-* / diagnose-* 全局 skill 能做
│   → 用全局 skill，不要新建
│
├─ 是通用工程能力（codex review / qa / browse / make-pdf 等）
│   → 用 ~/.claude/skills/ 全局 skill，不要复制到项目
│
├─ 是车险业务方法论且**可复用于其他项目**
│   → 在 ~/.claude/skills/ 创建（参考 chexian-report-shell 簇）
│
└─ 是**只属于本项目**的分析方法论 / 模板
    → 在 .claude/skills/ 创建 .md 单文件（本目录）
```

---

## 相关索引

- **指令**：[`.claude/commands/README.md`](../commands/README.md) — 41 个 chexian-* / diagnose-*
- **智能体**：[`.claude/agents/README.md`](../agents/README.md) — 14 个项目 agent
- **全局 skill 速查**：[`.claude/rules/skills-map.md`](../rules/skills-map.md) — 本项目相关全局 skill 的"项目用法"标注
- **协作宪法**：[`CLAUDE.md`](../../CLAUDE.md) §12 扩展机制前缀规范
