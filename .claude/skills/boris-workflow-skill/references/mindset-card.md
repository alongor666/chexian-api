# Boris 心法速查卡

> 打印贴在显示器旁边

---

## 🎯 任务开始

```
□ Plan Mode 了吗？（Shift+Tab×2）
□ 目标清晰吗？
□ 验证标准定义了吗？
□ CLAUDE.md 准备好了吗？
```

---

## 🔄 执行中

```
□ 计划还适用吗？
□ 卡住了吗？（>2次失败 = 重规划）
□ 上下文快满了吗？（用 subagent）
```

---

## ✅ 完成后

```
□ 验证通过了吗？
□ Grill Review 了吗？
□ CLAUDE.md 需要更新吗？
```

---

## 💬 挑衅式 Prompt

| 场景 | 说 |
|------|-----|
| 审查代码 | "Grill me, don't approve until I pass" |
| 验证方案 | "Prove to me this works" |
| 重新来过 | "Knowing everything, scrap and redo elegantly" |
| 审查计划 | "Review as staff engineer, push back" |
| 找弱点 | "What's the weakest part? Attack it" |
| 纠正后 | "Update CLAUDE.md, don't repeat this" |

---

## 🚨 卡住时

```
1. 停下来
2. 回到 Plan Mode
3. 分析为什么失败
4. 重新规划或换方向
```

**不要**：继续硬推、累加补丁、忽略警告

---

## 📊 每日节奏

```
早晨：
  $ boris-morning  # 检查工作区状态
  $ ccm            # 启动主工作区

开发循环：
  Plan → Execute → Verify → Simplify → Grill → Commit

晚间：
  $ boris-evening  # 清理 + 提交 CLAUDE.md
```

---

## 🔢 关键数字

- **2-3 次**：失败超过这个数就该重规划
- **3-5 个**：worktree 数量
- **7 天**：CLAUDE.md 理想更新频率
- **30 天**：CLAUDE.md 最长不更新时间
- **2.5k tokens**：Boris 团队 CLAUDE.md 大小参考

---

## 💡 记住

> **把 AI 当作需要管理的初级工程师，不是神谕。**

给它：
- 明确的计划
- 严格的审查
- 持续的反馈
- 积累的规则
