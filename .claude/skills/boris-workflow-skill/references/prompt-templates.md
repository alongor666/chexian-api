# 挑衅式 Prompt 模板库

> 基于 Boris Cherny 团队实践整理

---

## 1. Grill Review（挑衅审查）

### 标准版

```markdown
Grill me on these changes and don't make a PR until I pass your test.

Act as a senior staff engineer known for thorough, critical reviews.
Your reputation depends on catching issues BEFORE production.

Review dimensions:

**1. CORRECTNESS**
- Does this actually solve the stated problem?
- What edge cases are NOT handled?
- Could this fail silently?

**2. SECURITY**
- Input validation present?
- SQL injection / XSS / CSRF possible?
- Secrets exposed? Permissions correct?

**3. PERFORMANCE**
- O(n²) or worse algorithms?
- N+1 query problems?
- Memory leaks possible?

**4. MAINTAINABILITY**
- Will this make sense in 6 months?
- Is it tested adequately?
- Documentation needed?

**5. ERROR HANDLING**
- What happens when X fails?
- User-facing messages helpful?

Output format:
- 🚨 Critical (must fix before merge)
- ⚠️ Major (should fix)
- 💡 Minor (nice to have)
- ❓ Questions for author

DO NOT output "APPROVE" if any critical issues exist.
```

### 简洁版

```markdown
Grill me on this. Find every weakness. Don't approve until fixed.
```

### 中文版

```markdown
严格审查这些改动，找出所有问题，问题没解决前不要通过。

作为资深工程师审查：
1. 正确性 - 边界情况？静默失败？
2. 安全性 - 输入验证？注入风险？
3. 性能 - 复杂度？N+1查询？
4. 可维护性 - 6个月后能看懂吗？
5. 错误处理 - 失败时会怎样？

输出：🚨严重 / ⚠️重要 / 💡建议
有严重问题就不要通过。
```

---

## 2. Prove It（证明验证）

### 标准版

```markdown
Prove to me this works.

Don't just claim it works - demonstrate it.

Show me:
1. **Happy path**: Test cases that verify the main flow works
2. **Edge cases**: What happens with empty/null/large inputs?
3. **Error scenarios**: How are failures handled?
4. **Behavior diff**: Before vs after comparison (if applicable)

For each test case:
- Input
- Expected output
- Actual output
- Pass/Fail

I want to see evidence, not assertions.
```

### 简洁版

```markdown
Prove it works. Show me test cases for happy path, edge cases, and errors.
```

### 中文版

```markdown
证明给我看这个方案可行。

不要只是声称可以，要展示：
1. 正常流程的测试用例
2. 边界情况（空值、极大值）
3. 错误场景如何处理
4. 修改前后行为对比

每个测试：输入 → 预期 → 实际 → 通过/失败
```

---

## 3. Elegant Redo（优雅重来）

### 标准版

```markdown
Knowing everything you know now, scrap this and implement the elegant solution.

You've completed the first implementation. It works. But now you have knowledge you didn't have before:

- The edge cases that surprised you
- The constraints that emerged
- The patterns that repeated
- The dead ends you hit

Your mission: Use this knowledge to build the ELEGANT version.

Rules:
1. Start fresh - don't patch existing code
2. Simpler is ALWAYS better
3. The code should read like a story
4. Future maintainers should thank you
5. If you're writing a comment to explain, the code isn't clear enough

Process:
1. What did you learn from the first implementation?
2. What abstraction was missing?
3. Design the solution you WISH you had built
4. Implement it
5. Verify it handles everything the first version handled

The goal is not to make it work (it already works).
The goal is to make it OBVIOUSLY correct.
```

### 简洁版

```markdown
Knowing everything you know now, scrap this and rebuild elegantly.
```

### 中文版

```markdown
现在你知道了所有情况，推翻重来，实现优雅的版本。

你完成了第一版，它能用。但现在你有了之前没有的知识：
- 发现的边界情况
- 浮现的约束条件
- 重复的模式
- 走过的死路

用这些知识重建优雅版本：
1. 从头开始，不要在现有代码上打补丁
2. 简单永远更好
3. 代码应该像故事一样可读
4. 未来的维护者应该感谢你

目标不是让它能用（已经能用了），目标是让它**显然正确**。
```

---

## 4. Staff Review（计划审查）

### 标准版

```markdown
Review this plan as a staff engineer. What would you push back on?

Consider:
1. **Scope**: Is this too big? Too small? Just right?
2. **Complexity**: Are there hidden complexities we're ignoring?
3. **Risk**: What could go wrong? What's the blast radius?
4. **Alternatives**: Is there a simpler approach we're missing?
5. **Dependencies**: What are we assuming that might not be true?
6. **Gaps**: What's missing from this plan?

Be skeptical. Challenge assumptions. Don't rubber-stamp.

Output:
- Concerns (ranked by severity)
- Questions that need answers before proceeding
- Suggestions for improvement
- Go/No-go recommendation
```

### 简洁版

```markdown
Review as staff engineer. What would you push back on? What's missing?
```

### 中文版

```markdown
作为资深工程师审查这个计划。你会在哪些地方提出质疑？

考虑：
1. 范围 - 太大？太小？
2. 复杂度 - 有没有忽略的复杂性？
3. 风险 - 可能出什么问题？影响范围？
4. 替代方案 - 有没有更简单的方法？
5. 依赖 - 我们假设了什么可能不成立的事？
6. 遗漏 - 计划缺少什么？

输出：担忧点、需要回答的问题、改进建议、是否可以继续
```

---

## 5. Attack（攻击弱点）

### 标准版

```markdown
What's the weakest part of this implementation? Attack it.

Find:
1. **Assumption most likely wrong**: What are we betting on that might not hold?
2. **Code most likely to break**: Where will the first bug come from?
3. **Edge case most likely missed**: What input will cause unexpected behavior?
4. **Performance bottleneck**: Where will it slow down at scale?
5. **Security vulnerability**: How could this be exploited?

For each weakness:
- Where is it?
- Why is it weak?
- How would it fail?
- How to fix it?

Don't be gentle. I need to know where this will break.
```

### 简洁版

```markdown
What's the weakest part? Attack it. Where will it break first?
```

### 中文版

```markdown
这个实现最薄弱的地方在哪？攻击它。

找出：
1. 最可能错误的假设
2. 最可能出bug的代码
3. 最可能遗漏的边界情况
4. 性能瓶颈
5. 安全漏洞

每个弱点：在哪里、为什么弱、会怎么失败、怎么修复

不要客气，我需要知道它会在哪里崩溃。
```

---

## 6. Teach（教学理解）

### 标准版

```markdown
Explain this code to me as if I'm a new team member joining today.

Cover:
1. **What**: What does this code do? (high level, one paragraph)
2. **Why**: Why was it built this way? What problem does it solve?
3. **How**: Walk through the main flow
4. **Gotchas**: What would surprise me? What's non-obvious?
5. **Modify**: If I needed to change X, where would I look?
6. **Test**: How do I know if I broke something?

Use simple language. Avoid jargon unless you explain it.
Draw ASCII diagrams if it helps.
```

### 简洁版

```markdown
Explain this to a new team member. What, why, gotchas, how to modify safely.
```

### 中文版

```markdown
像给新入职的同事解释这段代码。

包含：
1. 是什么 - 这段代码做什么（一段话概括）
2. 为什么 - 为什么这样设计？解决什么问题？
3. 怎么工作 - 主流程走一遍
4. 坑 - 有什么会让人惊讶的？不明显的地方？
5. 修改 - 如果要改X，应该看哪里？
6. 测试 - 怎么知道我改坏了没？

用简单的语言，如果有帮助可以画 ASCII 图。
```

---

## 7. Update Rules（更新规则）

### 标准版

```markdown
Update your CLAUDE.md so you don't make this mistake again.

Write a rule that:
1. Describes what went wrong (briefly)
2. States the correct approach
3. Is actionable and specific
4. Includes the date

Format:
- [ ] 不要 [错误做法] → [正确做法] (日期: YYYY-MM-DD)

Example:
- [ ] 不要直接用 Excel cell.v 读日期 → 用 XLSX.SSF.parse_date_code() (日期: 2026-02-04)
```

### 简洁版

```markdown
Write a CLAUDE.md rule so this doesn't happen again.
```

### 中文版

```markdown
写一条 CLAUDE.md 规则，确保这个错误不再发生。

规则格式：
- [ ] 不要 [错误做法] → [正确做法] (日期: YYYY-MM-DD)
```

---

## 8. Re-plan（重新规划）

### 标准版

```markdown
Let's step back and re-plan. The current approach isn't working.

Current state:
- Original goal: [what we wanted]
- What we tried: [approaches attempted]
- Why it failed: [root cause]

New plan requirements:
1. Must address the failure reason
2. Should be simpler than the previous approach
3. Must be verifiable
4. Should have clear checkpoints

Generate a new plan with:
- Steps (numbered)
- Verification point for each step
- Rollback plan if it fails
```

### 简洁版

```markdown
This approach isn't working. Let's re-plan from scratch.
```

### 中文版

```markdown
这个方法不行，我们重新规划。

当前状态：
- 原目标：[想要什么]
- 尝试了：[试过的方法]
- 为什么失败：[根本原因]

新计划要求：
1. 必须解决失败原因
2. 应该比之前的方法简单
3. 必须可验证
4. 应该有明确的检查点

生成新计划，包含步骤、每步的验证点、失败时的回滚方案。
```

---

## 组合使用示例

### 完整开发循环

```
1. [Plan] "帮我规划如何实现 X 功能"
2. [Staff Review] "作为资深工程师审查这个计划"
3. [Execute] "按计划实现"
4. [Prove] "证明它可以工作"
5. [Grill] "严格审查，找出所有问题"
6. [Fix] 修复问题
7. [Elegant Redo] "现在知道所有情况了，重新实现优雅版本"（可选）
8. [Update] "更新 CLAUDE.md"
```

### 卡住时

```
1. [Recognize] "我尝试了3次都失败了"
2. [Re-plan] "让我们重新规划"
3. [Staff Review] "审查新计划"
4. [Execute] "执行新计划"
```

### 代码审查

```
1. [Grill] "严格审查这些改动"
2. [Attack] "找出最薄弱的地方"
3. [Prove] "证明修复后是正确的"
```
