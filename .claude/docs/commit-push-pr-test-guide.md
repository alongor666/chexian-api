# commit-push-pr 冲突检测功能验证指南

## 优化内容

已为 `/commit-push-pr` 命令添加**前置冲突检测**功能，在提交 PR 前自动检查与 `main` 分支的 merge 冲突。

## 新增功能

### 3.1 同步远程最新代码
```bash
git fetch origin main
```
确保检测的是远程仓库最新状态。

### 3.2 检查分支基准
验证当前分支是否基于最新的 main 分支，如果不是则警告并建议 rebase。

### 3.3 模拟合并检测冲突
使用 `git merge --no-commit --no-ff` 模拟合并，检测是否存在冲突：
- ✅ 无冲突：继续执行后续流程
- ❌ 有冲突：列出冲突文件，终止操作，给出解决指引

### 3.4 运行治理校验
执行项目强制要求的治理校验脚本（`scripts/check-governance.mjs`）。

## 验证步骤

### 场景1：无冲突情况（正常流程）

```bash
# 1. 创建测试分支
git checkout -b test/no-conflict-branch

# 2. 修改一个不冲突的文件
echo "# 测试注释" >> README.md

# 3. 提交并运行命令
git add .
git commit -m "test: 添加测试注释"
/commit-push-pr

# 预期结果：
# ✅ 冲突检查通过
# ✅ 治理校验通过
# ✅ 成功创建 PR
```

### 场景2：分支基准过期（警告）

```bash
# 1. 模拟 main 分支有新提交
git checkout main
echo "main新内容" >> test.txt
git add .
git commit -m "test: main添加新内容"

# 2. 切换回旧分支
git checkout test/no-conflict-branch

# 3. 运行命令
/commit-push-pr

# 预期结果：
# ⚠️ 警告：当前分支不是基于最新的 main 分支
# 询问是否继续
```

### 场景3：存在冲突情况（终止）

```bash
# 1. 确保在 main 分支
git checkout main
echo "main修改" >> CLAUDE.md
git add .
git commit -m "test: main修改CLAUDE.md"

# 2. 创建测试分支并修改同一文件
git checkout -b/test/conflict-branch
echo "分支修改" >> CLAUDE.md
git add .
git commit -m "test: 分支修改CLAUDE.md"

# 3. 运行命令
/commit-push-pr

# 预期结果：
# ❌ 检测到与 main 分支存在冲突！
# 冲突文件列表：CLAUDE.md
# 终止操作，给出解决指引
```

## 正确处理冲突的流程

当检测到冲突时，按以下步骤处理：

```bash
# 1. 先终止模拟合并
git merge --abort

# 2. 同步最新代码
git rebase origin/main

# 3. 如果有冲突，逐个解决
# 编辑冲突文件，解决标记为 <<<<<<< ======= >>>>>>> 的部分
git add <冲突文件>
git rebase --continue

# 4. 重新运行命令
/commit-push-pr
```

## 优势

1. **提前发现**：在 push 和创建 PR 前就发现冲突，而不是 PR 创建后才暴露
2. **明确指引**：给出清晰的冲突文件列表和解决步骤
3. **强制治理**：确保所有提交都通过治理校验
4. **避免浪费**：避免创建无法合并的 PR，减少反复修改

## 符合项目规范

本优化严格遵守 CLAUDE.md §9.4 多Agent协作协议：

> **所有Agent在创建PR前必须执行**：
> ```bash
> # Step 1: 同步main最新更新
> git fetch origin main
> git rebase origin/main
>
> # Step 2: 运行冲突检测
> # （本命令新增的模拟合并检测）
>
> # Step 3: 运行治理校验
> bun run scripts/check-governance.mjs
>
> # Step 4: 确认所有检查通过后才能创建PR
> ```

## 注意事项

1. 命令会自动终止模拟合并，不会影响当前分支状态
2. 冲突检测结果基于当前远程仓库的 main 分支
3. 如果其他分支也在同时开发，建议在开发前先 rebase
4. 治理校验脚本是项目强制要求，未找到会警告但不会终止
