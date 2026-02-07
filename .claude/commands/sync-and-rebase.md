---
name: sync-and-rebase
description: 同步远程代码并 Rebase（含冲突检测和测试）
category: git-workflow
version: 1.0.0
author: "@claude"
tags: [git, rebase, sync, testing, workflow]
scope: global
requires:
  - git
  - bun
dependencies:
  - scripts/check-write-conflict.mjs
  - bun test
last_updated: "2026-01-11"
---

# 同步并 Rebase

一键执行代码同步和冲突检测：

1. **同步远程最新代码**：`git fetch origin main`
2. **Rebase 到最新 main**：`git rebase origin/main`
3. **运行冲突检测**：`bun run scripts/check-write-conflict.mjs`
4. **运行测试**：`bun test`

---

## 适用场景

- ✅ 每天开始工作前
- ✅ 创建 PR 前（推荐先执行此命令）
- ✅ 从其他分支切换回来后
- ✅ 长时间未同步代码后

---

## 当前上下文

**当前分支**：
```bash
$(git branch --show-current)
```

**Git 状态**：
```bash
$(git status --short)
```

---

## 执行流程

### Step 1: 同步远程最新代码

```bash
git fetch origin main
```

### Step 2: Rebase 到最新 main

```bash
git rebase origin/main
```

**如果出现冲突**：
1. 编辑冲突文件，解决冲突
2. `git add <冲突文件>`
3. `git rebase --continue`
4. 如果想放弃：`git rebase --abort`

### Step 3: 运行冲突检测

```bash
bun run scripts/check-write-conflict.mjs
```

**预期输出**：
```
🔍 PR前冲突检测

当前 Agent: @unknown

📋 分支基准检查... ✅ 通过
📋 BACKLOG.md 冲突检查... ✅ 通过
📋 索引文件跨区写入检查... ✅ 通过
📋 Merge 冲突检测... ✅ 通过

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 所有检查通过，可以创建 PR
```

### Step 4: 运行测试

```bash
bun test
```

**确保所有测试通过后再继续开发或创建 PR。**

---

## 一键执行（高级）

如果想一次性执行所有步骤（不处理冲突）：

```bash
git fetch origin main && \
git rebase origin/main && \
bun run scripts/check-write-conflict.mjs && \
bun test
```

**注意**：如果任何步骤失败，后续步骤不会执行。

---

## 常见问题

### Q: rebase 时出现冲突怎么办？

**A**:
1. 手动解决冲突（编辑文件）
2. `git add <冲突文件>`
3. `git rebase --continue`
4. 重复直到所有冲突解决
5. 重新运行 `/sync-and-rebase`

### Q: 冲突检测失败怎么办？

**A**:
- 查看错误信息，了解具体问题
- 根据指引修复问题
- 重新运行 `bun run scripts/check-write-conflict.mjs`

### Q: 测试失败怎么办？

**A**:
- 查看测试失败的详细信息
- 修复失败的测试
- 重新运行 `bun test`

---

## 最佳实践

1. **每天开始工作前先同步**
   - 避免基于旧代码开发
   - 减少后续 rebase 冲突

2. **创建 PR 前必须同步**
   - 确保基于最新的 main
   - 减少合并冲突

3. **长时间未同步后先备份**
   ```bash
   git branch backup-before-rebase
   /sync-and-rebase
   ```

4. **如果 rebase 失杂度过高**
   - 考虑创建新分支
   - 手动 cherry-pick 关键提交

---

## 执行

现在请执行上述完整流程。如遇到问题，请说明具体情况。
