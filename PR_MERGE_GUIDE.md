# PR合并指南：解决 #38 和 #39 的依赖冲突

**问题**: PR #39 完全包含了 PR #38 的所有提交，导致合并顺序和冲突问题。

**推荐方案**: 先合并 PR #38（组件重构），再 rebase 并合并 PR #39（文档补充）

---

## 🚀 执行步骤

### 第1步：合并 PR #38（组件重构）

```bash
# 1. 切换到 main 分支并更新
git checkout main
git pull origin main

# 2. 合并 PR #38 (通过GitHub UI或命令行)
# 方式A: 使用GitHub UI (推荐)
# - 访问 PR #38 页面
# - 点击 "Merge pull request"
# - 选择 "Squash and merge" 或 "Create a merge commit"

# 方式B: 命令行合并
git merge --no-ff refactor/component-optimization -m "Merge PR #38: PremiumDashboard组件拆分优化"
git push origin main
```

### 第2步：Rebase PR #39 到最新的 main

```bash
# 1. 切换到 PR #39 的分支
git checkout docs/code-quality-review

# 2. 从远程获取最新的 main
git fetch origin main

# 3. Rebase 到最新的 main
git rebase origin/main

# 预期结果:
# - Git会发现 PR #38 的所有提交已经在 main 中
# - 只会保留 c206aed (docs: 添加代码质量审查文档和改进路线图)
# - 可能会有 BACKLOG.md 的合并冲突
```

### 第3步：解决冲突（如果有）

如果 rebase 时出现 BACKLOG.md 冲突:

```bash
# 1. 查看冲突文件
git status

# 2. 编辑 BACKLOG.md，保留两个分支的所有新增内容
# - 保留 main 分支新增的任务记录
# - 保留 PR #39 新增的文档更新

# 3. 标记冲突已解决
git add BACKLOG.md

# 4. 继续 rebase
git rebase --continue
```

### 第4步：强制推送更新后的分支

```bash
# ⚠️ 注意：rebase会改写历史，需要强制推送
git push origin docs/code-quality-review --force-with-lease
```

### 第5步：合并 PR #39（文档补充）

```bash
# 方式A: 使用GitHub UI (推荐)
# - 访问 PR #39 页面
# - 确认只有1个新提交 (c206aed)
# - 点击 "Merge pull request"

# 方式B: 命令行合并
git checkout main
git pull origin main
git merge --no-ff docs/code-quality-review -m "Merge PR #39: 代码质量审查文档和改进路线图"
git push origin main
```

---

## ✅ 验证清单

合并完成后，验证以下内容：

- [ ] `bun test` 所有测试通过
- [ ] `bun run scripts/check-governance.mjs` 治理校验通过
- [ ] `bun run dev` 应用正常启动
- [ ] Git 历史中可以清晰看到两个独立的PR合并记录
- [ ] `开发文档/reviews/` 目录下有4个新文档

---

## 🔧 如果出现问题

### 问题1: Rebase失败，冲突太复杂

**解决方案**: 放弃rebase，使用方案2（直接合并PR #39并关闭PR #38）

```bash
git rebase --abort
git checkout main
git merge docs/code-quality-review
# 然后在GitHub上关闭PR #38，备注 "Included in PR #39"
```

### 问题2: 强制推送失败

**解决方案**: 确认分支保护规则

```bash
# 如果 docs/code-quality-review 有分支保护，需要临时关闭
# 或者创建新分支重新提PR
git checkout -b docs/code-quality-review-rebased
git push origin docs/code-quality-review-rebased
# 然后创建新的PR替代 #39
```

---

## 📊 合并后的Git历史结构

```
main
  ├─ ... (早期提交)
  ├─ a73e41b fix(growth): 修复续保率计算字段名错误
  ├─ [Merge PR #38] PremiumDashboard组件拆分优化
  │   ├─ 9c96c78 fix(dashboard): 修复续保分析面板 UI 布局问题
  │   ├─ 5efdcac feat(shared): 新增通用 Hooks 和日志工具模块
  │   ├─ de21aea docs(refactor): 添加整体优化计划和阶段1总结报告
  │   ├─ 74bf1d7 refactor(dashboard): 应用 useLoadingStates Hook
  │   ├─ d31466c refactor(dashboard): 提取 useTrendData Hook
  │   ├─ 6380862 refactor(dashboard): 拆分 PremiumDashboard 组件
  │   └─ a955c93 chore: 更新 .gitignore
  │
  └─ [Merge PR #39] 代码质量审查文档和改进路线图
      └─ c206aed docs: 添加代码质量审查文档和改进路线图
```

---

**生成时间**: 2026-01-10
**相关任务**: BACKLOG.md B038 (依赖升级与文档整理)
