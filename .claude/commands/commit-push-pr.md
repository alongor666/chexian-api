---
name: commit-push-pr
description: Git 提交并创建 Pull Request（含冲突检测和治理校验）
category: git-workflow
version: 2.0.0
author: "@claude"
tags: [git, pr, workflow, automation, conflict-detection]
scope: global
requires:
  - gh CLI
  - bun
dependencies:
  - scripts/check-write-conflict.mjs
  - scripts/check-governance.mjs
last_updated: "2026-02-18"
---

# Git 提交并创建 PR

自动完成以下流程：
1. 生成语义化 commit message
2. 提交代码
3. 推送到远程
4. 创建 Pull Request

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

**最近的 commits**：
```bash
$(git log --oneline -3)
```

**文件变更统计**：
```bash
$(git diff --stat main)
```

---

## 任务要求

请执行以下操作：

### 1. 分析变更
- 查看所有变更的文件
- 理解改动的目的和范围
- 识别变更类型（feat/fix/refactor/docs/test）

### 2. 生成 Commit Message
使用以下格式：
```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型 (type)**：
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构
- `docs`: 文档更新
- `test`: 测试代码
- `chore`: 构建/工具变更

**范围 (scope)**: kpi, dashboard, report, data, api 等

**示例**：
```
feat(kpi): 添加赔付杠杆率计算功能

- 实现杠杆率计算公式：赔款/保费
- 添加四象限分类逻辑
- 支持多维度筛选（机构、险种、时间）

Closes #123
```

### 3. 执行前置检查（CRITICAL - 防止推送失败和 merge 冲突）

**⚠️ 根据 CLAUDE.md §13 AI 协作行为规范 + §9.4 多Agent协作协议**

#### 3.0 大文件检查（防止推送被 GitHub 拒绝）
```bash
find . -not -path './.git/*' -not -path './node_modules/*' -size +50M -exec ls -lh {} \;
```

**如果发现大文件（>50MB）**：
1. 检查是否已被 `.gitignore` 忽略
2. 如果需要提交，配置 Git LFS：`git lfs track "*.parquet"` 等
3. 如果不需要提交，添加到 `.gitignore`
4. **禁止忽略此步骤直接 push**

#### 3.0b 分支共同祖先检查（防止 unrelated histories）
```bash
git merge-base main HEAD
```

**如果返回错误（无共同祖先）**：
1. 不要尝试 rebase（会产生大量 add/add 冲突）
2. 改用 cherry-pick 策略：从 main 创建新分支，cherry-pick 独有 commits
3. 用新分支创建 PR

#### 3.1 同步远程最新代码
```bash
git fetch origin main
```

#### 3.2 运行冲突检测
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

**如果失败**：
- 脚本会自动终止（exit 1）
- 输出详细的错误信息
- 给出解决步骤指引

#### 3.3 运行治理校验
```bash
if [ -f "scripts/check-governance.mjs" ]; then
  bun run scripts/check-governance.mjs
fi
```

**只有所有检查通过后，才执行步骤4（Git 操作）**

### 4. 执行 Git 操作
```bash
git add .
git commit -m "<生成的 commit message>"
git push origin <当前分支>
```

### 5. 创建 PR
使用 GitHub CLI 创建 PR：
```bash
gh pr create \
  --title "<PR 标题>" \
  --body "<PR 描述>" \
  --base main
```

**PR 标题规则**：
- 与 commit message 的 subject 一致
- 简洁明确，不超过 60 字符

**PR 描述模板**：
```markdown
## 变更说明
[描述本次变更的目的和内容]

## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新

## 测试
- [ ] 单元测试通过
- [ ] 手动测试完成

## 相关 Issue
Closes #[issue编号]
```

---

## 注意事项

1. **前置检查（强制执行）**：
   - ⚠️ **必须通过冲突检测**才能创建 PR
   - ⚠️ **必须通过治理校验**才能提交代码
   - 如果检测到冲突，参考 CLAUDE.md §9.5 处理流程
   - 建议在开发前先 `git rebase origin/main` 同步最新代码

2. **Commit Message 质量**：
   - subject 使用动词开头（"添加"、"修复"、"优化"）
   - body 说明 what 和 why，不是 how
   - 每行不超过 72 字符

3. **PR 创建检查**：
   - 确保在 feature/bugfix 分支，不在 main
   - 检查是否有未提交的文件
   - 验证测试是否通过

4. **分支命名**：
   - feature/\*: 新功能
   - bugfix/\*: Bug 修复
   - hotfix/\*: 紧急修复

5. **如果失败**：
   - **冲突检测失败**：先 rebase，解决冲突后重新运行
   - **治理校验失败**：修复代码规范问题后重新运行
   - **gh CLI 失败**：检查 gh CLI 是否已安装并认证
   - **推送失败**：确认有推送权限

## 冲突处理参考

如果检测到 merge 冲突，请参考：
- **快速处理**：`git rebase origin/main` → 解决冲突 → `git rebase --continue`
- **复杂情况**：参考 CLAUDE.md §9.5 紧急冲突处理流程
- **多Agent协作**：遵守 CLAUDE.md §9 任务ID分配规则

---

## 执行

现在请执行上述完整流程。如遇到问题，请说明具体情况。

