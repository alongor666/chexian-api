---
name: boris-workflow
version: 1.0.0
description: >
  Boris Cherny 工作流元技能 - AI 协作的顶级实践框架。
  基于 Claude Code 创建者 Boris Cherny 的方法论，提供心法检查、挑衅式 Prompt 模板、项目配置诊断。
  Use when 开始新任务需要检查是否遵循最佳实践，需要挑衅式审查代码/方案，
  需要诊断项目 Claude 配置是否完整，或想要学习/应用 Boris 工作流。
  适用于: (1) 任务开始前的心法检查 (2) 代码/方案完成后的挑衅审查 
  (3) 新项目的配置诊断 (4) 工作流优化建议 (5) 卡住时的重规划引导
triggers:
  - "检查工作流"
  - "Boris 心法"
  - "挑衅审查"
  - "Grill review"
  - "项目配置诊断"
  - "我卡住了"
  - "重新规划"
author: Alongor
---

# Boris Workflow - AI 协作顶级实践

> 基于 Claude Code 创建者 Boris Cherny 的方法论

## 核心理念

**把 AI 当作需要管理的初级工程师，而不是神谕。**

给它：明确的计划 → 严格的审查 → 持续的反馈 → 积累的规则

## 快速入口

| 场景 | 动作 |
|------|------|
| 开始任务 | → [心法检查](#心法检查) |
| 完成初稿 | → [挑衅审查](#挑衅式-prompt) |
| 卡住了 | → [重规划引导](#卡住时的操作) |
| 新项目 | → [配置诊断](#项目配置诊断) |

---

## 心法检查

### 任务开始前检查清单

```
┌─────────────────────────────────────┐
│  Boris 心法 - 任务开始检查          │
├─────────────────────────────────────┤
│  □ 我是否进入了 Plan Mode？         │
│  □ 我是否清楚描述了任务目标？        │
│  □ 我是否提供了足够的上下文？        │
│  □ 我是否定义了验证标准？           │
│  □ CLAUDE.md 是否已准备好？         │
└─────────────────────────────────────┘
```

### 七大心法

| # | 心法 | 触发时机 | 内化习惯 |
|---|------|----------|----------|
| 1 | **Plan First** | 任何非平凡任务 | 动手前先问"计划是什么" |
| 2 | **卡住即重规划** | 推了2-3次还不对 | 停下来，不硬推 |
| 3 | **挑衅式提问** | 完成初稿后 | "Grill me / Prove it / Redo" |
| 4 | **让 AI 写规则** | 每次纠正后 | "更新规则别再犯" |
| 5 | **验证优先** | 声称完成时 | "跑一下证明给我看" |
| 6 | **语音输入** | 写长 prompt | fn×2 比打字快3倍 |
| 7 | **Subagent 卸载** | 上下文快满时 | 分任务保持主线清洁 |

### 任务执行中检查

```
当前状态诊断：
1. 我在 Plan Mode 还是 Execute Mode？
2. 计划是否足够清晰可一次执行？
3. 验证标准是否明确？
4. 是否需要拆分成子任务？
```

### 任务完成后检查

```
□ 验证是否通过（测试/运行/确认）
□ 代码是否需要简化
□ 是否触发了 CLAUDE.md 更新
□ 是否有可复用的模式值得提取
```

---

## 挑衅式 Prompt

### 核心模板

#### 1. Grill 模式（挑衅审查）

**用途**：代码/方案完成后的严格审查

```markdown
Grill me on these changes and don't approve until I pass your test.

Review as a senior staff engineer known for thorough, critical reviews.
Find EVERY possible issue:

1. **Correctness**: Edge cases? Silent failures?
2. **Security**: Input validation? Injection? Permissions?
3. **Performance**: O(n²)? N+1 queries? Memory leaks?
4. **Maintainability**: Readable in 6 months? Tested?
5. **Error Handling**: Failure paths? User messages?

Output:
- 🚨 Critical (must fix)
- ⚠️ Major (should fix)  
- 💡 Minor (nice to fix)
- ❓ Questions for author

DO NOT approve if any critical issues exist.
```

#### 2. Prove 模式（证明验证）

**用途**：要求 AI 证明方案可行

```markdown
Prove to me this works.

Show me:
1. Test cases that verify the happy path
2. Edge cases you've considered
3. Error scenarios and how they're handled
4. Before/after behavior comparison (if applicable)

Don't just claim it works - demonstrate it.
```

#### 3. Redo 模式（优雅重来）

**用途**：第一版完成后，用全部知识重新实现

```markdown
Knowing everything you know now, scrap this and implement the elegant solution.

You've learned:
- The edge cases that surprised you
- The constraints that emerged
- The patterns that repeated
- The dead ends you hit

Now build what you WISH you had built from the start.
The code should be obviously correct.
```

#### 4. Staff Review 模式（计划审查）

**用途**：让另一个视角审查计划

```markdown
Review this plan as a staff engineer. What would you push back on?

Consider:
- Is the scope appropriate?
- Are there hidden complexities?
- What could go wrong?
- Is there a simpler approach?
- What's missing from the plan?
```

#### 5. Attack 模式（找弱点）

**用途**：主动寻找方案的薄弱环节

```markdown
What's the weakest part of this implementation? Attack it.

Find:
- The assumption most likely to be wrong
- The code most likely to break
- The edge case most likely missed
- The performance bottleneck
- The security vulnerability
```

#### 6. Teach 模式（学习理解）

**用途**：通过教学加深理解

```markdown
Explain this code to me as if I'm a new team member.

Cover:
- What does it do (high level)?
- Why was it built this way?
- What would surprise me?
- What are the gotchas?
- How would I modify it safely?
```

### 快速参考卡

```
┌────────────────────────────────────────────┐
│  挑衅式 Prompt 速查                         │
├────────────────────────────────────────────┤
│  完成后审查  → "Grill me, don't approve    │
│               until I pass your test"      │
│                                            │
│  验证方案   → "Prove to me this works"     │
│                                            │
│  重新实现   → "Knowing everything you      │
│               know now, scrap and redo"    │
│                                            │
│  审查计划   → "Review as staff engineer,   │
│               what would you push back?"   │
│                                            │
│  找弱点    → "What's the weakest part?     │
│               Attack it"                   │
│                                            │
│  纠正后    → "Update CLAUDE.md so you      │
│               don't make this mistake"     │
└────────────────────────────────────────────┘
```

---

## 卡住时的操作

### 诊断当前状态

```
你现在卡住了吗？让我们诊断：

1. 你尝试了几次？（>2次 = 该重规划了）
2. 错误是相同的还是不同的？
3. 你理解为什么失败吗？
4. 是否在做计划外的事？
```

### 重规划流程

```markdown
## 重规划模式

停下来。我们需要重新规划。

### 当前状态
- 原计划是什么：[描述]
- 尝试了什么：[描述]
- 为什么失败：[描述]

### 重新规划
基于我们学到的，新的计划应该：
1. [新步骤1]
2. [新步骤2]
3. [新步骤3]

### 验证点
在继续之前，确认：
- [ ] 新计划解决了之前的问题
- [ ] 新计划是可验证的
- [ ] 新计划比之前更简单或更明确
```

### 何时放弃当前方向

- 同一错误出现 3 次
- 补丁越来越复杂
- 偏离了原始目标
- 花的时间超过预期 3 倍

**放弃时说**："Let's step back. This approach isn't working. What's a completely different way to solve this?"

---

## 项目配置诊断

### 快速诊断命令

```bash
# 检查项目 Boris 配置完整性
boris-diagnose() {
  echo "🔍 Boris Workflow 配置诊断"
  echo "=========================="
  
  # 检查 CLAUDE.md
  if [ -f "CLAUDE.md" ]; then
    echo "✅ CLAUDE.md 存在"
    lines=$(wc -l < CLAUDE.md)
    echo "   - $lines 行"
  else
    echo "❌ CLAUDE.md 不存在"
  fi
  
  # 检查 .claude 目录
  if [ -d ".claude" ]; then
    echo "✅ .claude/ 目录存在"
    [ -f ".claude/settings.json" ] && echo "   ✅ settings.json" || echo "   ❌ settings.json"
    [ -f ".claude/hooks.json" ] && echo "   ✅ hooks.json" || echo "   ❌ hooks.json"
    [ -d ".claude/commands" ] && echo "   ✅ commands/ ($(ls .claude/commands/*.md 2>/dev/null | wc -l) 个)" || echo "   ❌ commands/"
  else
    echo "❌ .claude/ 目录不存在"
  fi
  
  # 检查 git worktrees
  echo ""
  echo "Git Worktrees:"
  git worktree list 2>/dev/null || echo "   ❌ 未设置 worktrees"
}
```

### 配置完整性清单

```
项目配置诊断清单
================

## 必需配置 (P0)

□ CLAUDE.md 存在
  □ 包含代码规范
  □ 包含已知陷阱
  □ 包含项目术语

□ .claude/settings.json
  □ 权限预授权配置
  □ 常用命令白名单

## 推荐配置 (P1)

□ .claude/hooks.json
  □ PostToolUse 格式化

□ .claude/commands/
  □ commit-push-pr.md
  □ verify-app.md
  □ grill-review.md

## 可选配置 (P2)

□ Git worktrees (3-5个)
□ Shell 别名配置
□ .mcp.json (如需集成)

## 诊断结果

配置完整度: ___/10
建议优先修复: ___________
```

### CLAUDE.md 健康检查

```
CLAUDE.md 健康检查
==================

□ 基础信息
  □ 项目概述清晰
  □ 技术栈列出

□ 代码规范
  □ 命名约定定义
  □ 必须/禁止规则明确

□ 已知陷阱
  □ 至少记录 5 个陷阱
  □ 每个陷阱有日期
  □ 每个陷阱有正确做法

□ 项目术语
  □ 业务术语定义
  □ 缩写解释

□ 更新频率
  □ 最近 7 天有更新 ✅
  □ 最近 30 天有更新 ⚠️
  □ 超过 30 天未更新 ❌
```

---

## 与其他技能协作

| 技能 | 关系 | 场景 |
|------|------|------|
| `intent-architect` | 互补 | 需求模糊时先用 intent-architect，再用 boris-workflow 执行 |
| `code-prompt-engineer` | 扩展 | boris-workflow 提供心法，code-prompt-engineer 提供具体技术 |
| `skill-quality-validator` | 链式 | 新建 skill 后用 boris-workflow 的 grill 审查 |
| `project-knowledge-base` | 输入 | CLAUDE.md 可输入到知识库 |

---

## 工作流模式

### 模式 A：标准开发循环

```
1. Plan Mode 开始
   ↓
2. 迭代计划直到清晰
   ↓
3. Auto-accept 执行
   ↓
4. /verify-app 验证
   ↓
5. /code-simplifier 简化
   ↓
6. /grill-review 审查
   ↓
7. /commit-push-pr 提交
   ↓
8. 更新 CLAUDE.md（如有学习）
```

### 模式 B：卡住恢复

```
1. 识别卡住（>2次失败）
   ↓
2. 停止当前方向
   ↓
3. 进入 Plan Mode
   ↓
4. 分析失败原因
   ↓
5. 重新规划或 /elegant-redo
   ↓
6. 回到模式 A
```

### 模式 C：审查驱动

```
1. 完成初稿
   ↓
2. Grill Review（找问题）
   ↓
3. 修复所有 Critical
   ↓
4. Prove It（证明可行）
   ↓
5. Elegant Redo（可选优化）
   ↓
6. 最终提交
```

---

## 常见问题

### Q: 什么时候该用 Plan Mode？

**A**: 任何需要超过 3 步完成的任务。如果你不确定，就用 Plan Mode。

### Q: Grill Review 太严格了怎么办？

**A**: 这是特性，不是 bug。降低标准只会把问题推到后面。但你可以：
- 标记哪些 Minor 可以暂缓
- 对 Major 评估 ROI 后决定

### Q: CLAUDE.md 更新频率？

**A**: 每次 Claude 犯错都应该更新。理想情况下每周至少 1 次。如果超过 30 天没更新，要么项目稳定了，要么你忘记维护了。

### Q: 多项目怎么管理 CLAUDE.md？

**A**: 每个项目独立的 CLAUDE.md，但可以有一个全局的 `~/.claude/global-rules.md` 存放跨项目规则。

---

## 参考资源

| 资源 | 路径 |
|------|------|
| 心法速查卡 | `references/mindset-card.md` |
| Prompt 模板库 | `references/prompt-templates.md` |
| 配置诊断脚本 | `scripts/diagnose.sh` |
| CLAUDE.md 模板 | `references/claude-md-template.md` |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-02-04 | 初始版本，基于 Boris 2026.01 和 2026.02 分享 |
