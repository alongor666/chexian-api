# 零冲突协作实施指南

**文档ID**: CONFLICT-AVOIDANCE-001
**创建时间**: 2026-01-11
**适用范围**: 所有 Agent 和开发者

---

## 📋 核心原则（完全避免冲突的4大支柱）

### ✅ 1. 遵守文档分区协议（防止文档冲突）
### ✅ 2. 使用不同的任务 ID（防止任务编号冲突）
### ✅ 3. 及时 rebase（防止代码文件冲突）
### ✅ 4. 小步快跑，频繁提交（减少冲突范围）

---

## 🛠️ 实施方案

### ✅ 1. 文档分区协议实施

#### 1.1 分区标记规范

**在需要分区的文档中添加标记**：

```markdown
<!-- @claude-section-start -->
## Claude 工作区
... (只有 @claude 可以修改这部分)
<!-- @claude-section-end -->

<!-- @codex-section-start -->
## Codex 工作区
... (只有 @codex 可以修改这部分)
<!-- @codex-section-end -->
```

#### 1.2 已分区文档列表

| 文档 | 分区方式 | 写入权限 |
|------|---------|---------|
| `CLAUDE.md` | §1-8 (@user), §9 (@user), 无分区 | @user 专属，Agent 只读 |
| `BACKLOG.md` | 待拆分为 `BACKLOG_CLAUDE.md` 等 | 当前所有 Agent 共享（需工具支持） |
| `开发文档/DOC_INDEX.md` | 按 Agent 分区 | 各 Agent 只能写自己的 section |
| `开发文档/CODE_INDEX.md` | 按模块分区，非按 Agent | 谁修改模块谁更新 |

#### 1.3 实施工具：`scripts/check-document-partition.mjs`

**新建脚本，自动检测文档分区违规**：

```javascript
#!/usr/bin/env bun
/**
 * 文档分区检查
 * 检测：
 * 1. Agent 是否修改了其他 Agent 的分区
 * 2. 是否在没有分区标记的文档中并发写入
 */

const AGENT_SECTIONS = {
  '@claude': ['@claude-section', 'Claude工作区'],
  '@codex': ['@codex-section', 'Codex工作区'],
  '@gemini': ['@gemini-section', 'Gemini工作区'],
};

async function checkPartitionViolations() {
  const currentAgent = process.env.AGENT_NAME || '@unknown';

  // 获取当前分支修改的所有文档
  const changedFiles = await getChangedFiles();

  for (const file of changedFiles) {
    if (!file.endsWith('.md')) continue;

    const content = await readFile(file);
    const violations = detectPartitionViolations(content, currentAgent);

    if (violations.length > 0) {
      console.error(`❌ 文档分区违规: ${file}`);
      violations.forEach(v => console.error(`  - ${v}`));
      process.exit(1);
    }
  }

  console.log('✅ 文档分区检查通过');
}
```

**使用方法**：

```bash
# 在 commit 前自动运行
bun run scripts/check-document-partition.mjs

# 集成到 pre-commit hook
echo "bun run scripts/check-document-partition.mjs" >> .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

### ✅ 2. 任务 ID 分配实施

#### 2.1 ID 范围分配（已定义）

| Agent | ID 范围 | 当前使用 | 剩余 |
|-------|--------|---------|------|
| @user | B001-B099 | B001-B055 | 44 |
| @claude | B100-B199 | 未使用 | 100 |
| @codex | B200-B299 | 未使用 | 100 |
| @gemini | B300-B399 | 未使用 | 100 |
| 未来扩展 | B400-B999 | - | 600 |

#### 2.2 实施工具：`scripts/assign-task-id.mjs`

**新建脚本，自动分配 Agent 专属 ID**：

```javascript
#!/usr/bin/env bun
/**
 * 自动分配任务 ID
 *
 * 使用方法：
 *   bun run scripts/assign-task-id.mjs @claude
 *   bun run scripts/assign-task-id.mjs @codex
 */

const AGENT_ID_RANGES = {
  '@user': { start: 1, end: 99 },
  '@claude': { start: 100, end: 199 },
  '@codex': { start: 200, end: 299 },
  '@gemini': { start: 300, end: 399 },
};

async function assignTaskId(agent) {
  const range = AGENT_ID_RANGES[agent];
  if (!range) {
    console.error(`❌ 未知 Agent: ${agent}`);
    process.exit(1);
  }

  // 读取 BACKLOG.md，找出已使用的 ID
  const backlog = await readFile('BACKLOG.md');
  const usedIds = extractUsedIds(backlog);

  // 在 Agent 的范围内找下一个可用 ID
  for (let i = range.start; i <= range.end; i++) {
    const id = `B${String(i).padStart(3, '0')}`;
    if (!usedIds.has(id)) {
      console.log(id);
      return;
    }
  }

  console.error(`❌ Agent ${agent} 的 ID 范围已满！`);
  process.exit(1);
}

const agent = process.argv[2];
assignTaskId(agent);
```

**使用示例**：

```bash
# Claude 创建新任务
NEW_ID=$(bun run scripts/assign-task-id.mjs @claude)
echo "| $NEW_ID | ... |" >> BACKLOG.md

# Codex 创建新任务
NEW_ID=$(bun run scripts/assign-task-id.mjs @codex)
echo "| $NEW_ID | ... |" >> BACKLOG.md
```

#### 2.3 Slash Command 集成

创建 `.claude/commands/add-task.md`：

```markdown
# 添加新任务到 BACKLOG.md

自动：
1. 识别当前 Agent
2. 分配专属任务 ID
3. 在 BACKLOG.md 末尾追加任务

**使用方法**：
```
/add-task 板块:数据分析 描述:优化SQL查询性能 优先级:P1
```

**自动执行**：
```bash
AGENT_ID="@claude"
TASK_ID=$(bun run scripts/assign-task-id.mjs $AGENT_ID)
echo "| $TASK_ID | ... |" >> BACKLOG.md
```
```

---

### ✅ 3. 及时 Rebase 实施方案

#### 3.1 自动 Rebase 工作流

**方式1：Git Hooks 自动提醒**

创建 `.git/hooks/post-merge`：

```bash
#!/bin/bash
# 每次 git pull 后自动检查是否需要 rebase

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "main" ]; then
  exit 0
fi

# 检查当前分支是否基于最新的 main
CURRENT_BASE=$(git merge-base HEAD origin/main)
LATEST_MAIN=$(git rev-parse origin/main)

if [ "$CURRENT_BASE" != "$LATEST_MAIN" ]; then
  echo ""
  echo "⚠️  警告：main 分支有新更新，建议立即 rebase！"
  echo "   执行: git rebase origin/main"
  echo ""
fi
```

**启用**：

```bash
chmod +x .git/hooks/post-merge
```

**方式2：定时自动 Rebase（GitHub Actions）**

创建 `.github/workflows/auto-rebase.yml`：

```yaml
name: Auto Rebase Feature Branches

on:
  schedule:
    # 每天 UTC 00:00 (北京时间 08:00)
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  rebase:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Rebase all feature branches
        run: |
          for branch in $(git branch -r | grep -v 'main' | grep -v 'HEAD' | sed 's|origin/||'); do
            echo "Rebasing $branch..."
            git checkout $branch
            git rebase origin/main || echo "⚠️  $branch 有冲突，需要手动处理"
          done
```

#### 3.2 命令快捷方式

创建 `.claude/commands/sync-and-rebase.md`：

```markdown
# 同步并 Rebase

一键执行：
1. git fetch origin main
2. 检查是否有冲突
3. git rebase origin/main
4. 运行测试

**使用方法**：
```
/sync-and-rebase
```
```

#### 3.3 最佳实践工作流

```bash
# 每天开始工作前
git fetch origin main
git rebase origin/main

# 每次 commit 前
git status  # 检查是否有未提交的更改
git add .
git commit -m "..."

# 每2小时（或完成一个小功能后）
git push origin $(git branch --show-current)

# 创建 PR 前必须执行
/sync-and-rebase  # 或 /commit-push-pr（已内置）
```

---

### ✅ 4. 小步快跑，频繁提交实施

#### 4.1 提交粒度原则

| 场景 | 建议提交频率 | 示例 |
|------|------------|------|
| **开发新功能** | 每30-60分钟 | 完成1个小函数 → commit |
| **修复 Bug** | 每15-30分钟 | 修复1个测试用例 → commit |
| **重构代码** | 每重构1个文件 | 完成单个文件重构 → commit |
| **更新文档** | 每更新1个章节 | 完成1节文档 → commit |

**反例**（❌ 禁止）：
- 开发一整天后才提交1次
- 修改10个文件后只提交1个commit
- 完成3个功能后才提交

#### 4.2 提交消息规范

**小提交消息示例**：

```bash
# ✅ 好的提交消息（粒度小，意图清晰）
git commit -m "feat(kpi): 添加赔付杠杆率计算函数"

git commit -m "fix(dashboard): 修复趋势图日期显示错误"

git commit -m "docs: 更新 TECH_STACK.md §4 验证协议"

git commit -m "test: 添加杠杆率计算的单元测试"

git commit -m "refactor(client): 优化 PolicyFact 视图查询性能"

# ❌ 差的提交消息（粒度太大，模糊不清）
git commit -m "update some files"
git commit -m "fix bugs"
git commit -m "working on stuff"
```

#### 4.3 频繁 Push 工具

**方式1：自动 Push 后脚本**

创建 `.git/hooks/post-commit`：

```bash
#!/bin/bash
# 每次 commit 后自动 push（可配置）

# 检查是否启用自动 push
if [ -f ".git/auto-push-enabled" ]; then
  echo "📤 自动 push 到远程..."
  git push
fi
```

**启用/禁用**：

```bash
# 启用自动 push
touch .git/auto-push-enabled

# 禁用自动 push
rm .git/auto-push-enabled
```

**方式2：Slash Command 快捷提交+Push**

创建 `.claude/commands/quick-commit.md`：

```markdown
# 快速提交并推送

自动：
1. 分析变更
2. 生成语义化 commit message
3. git add + commit + push

**使用方法**：
```
/quick-commit
```

**适用场景**：
- 完成1个小功能/修复
- 需要立即保存进度
- 频繁同步代码
```

#### 4.4 最佳实践工作流

```bash
# 开发新功能（示例：添加杠杆率计算）

# Step 1: 创建函数（15分钟）
vim src/shared/sql/kpi.ts
git add src/shared/sql/kpi.ts
git commit -m "feat(kpi): 添加赔付杠杆率计算函数"
git push

# Step 2: 添加单元测试（10分钟）
vim tests/kpi.test.ts
git add tests/kpi.test.ts
git commit -m "test: 添加杠杆率计算的单元测试"
git push

# Step 3: 集成到 UI（20分钟）
vim src/features/dashboard/PremiumDashboard.tsx
git add src/features/dashboard/PremiumDashboard.tsx
git commit -m "feat(dashboard): 集成杠杆率到业绩看板"
git push

# Step 4: 更新文档（5分钟）
vim 开发文档/DOC_INDEX.md
git add 开发文档/DOC_INDEX.md
git commit -m "docs: 更新 DOC_INDEX 记录杠杆率功能"
git push

# 总计：4次 commit + push，覆盖完整功能，降低冲突风险
```

---

## 🚀 完整工作流示例

### 场景：Claude 开发新功能

```bash
# ===== 早上开始工作前 =====
# 1. 同步最新代码
git fetch origin main
git rebase origin/main

# 2. 创建功能分支
git checkout -b feat/add-loss-ratio

# 3. 领取任务 ID
TASK_ID=$(bun run scripts/assign-task-id.mjs @claude)
echo "当前任务: $TASK_ID"

# 4. 在 BACKLOG_CLAUDE.md 记录任务
echo "| $TASK_ID | ... | IN_PROGRESS | ... |" >> BACKLOG_CLAUDE.md

# ===== 开发过程中（每30分钟） =====
# 完成小功能A
vim src/shared/sql/kpi.ts
git add src/shared/sql/kpi.ts
git commit -m "feat(kpi): 添加损失率计算SQL模板"
git push

# 完成小功能B（30分钟后）
vim tests/kpi.test.ts
git add tests/kpi.test.ts
git commit -m "test: 添加损失率单元测试"
git push

# ===== 中午休息前 =====
# 再次同步（防止其他 Agent 有更新）
git fetch origin main
git rebase origin/main

# ===== 下午继续开发 =====
# 完成UI集成
vim src/features/dashboard/PremiumDashboard.tsx
git add src/features/dashboard/PremiumDashboard.tsx
git commit -m "feat(dashboard): 集成损失率到业绩看板"
git push

# ===== 准备提交 PR 前 =====
# 1. 最终同步
git fetch origin main
git rebase origin/main

# 2. 运行所有检查
bun test
bun run scripts/check-governance.mjs
bun run scripts/check-document-partition.mjs

# 3. 使用自动命令提交 PR
/commit-push-pr  # 已内置冲突检测

# ===== PR 创建后 =====
# 4. 更新 BACKLOG_CLAUDE.md
# 将任务状态改为 DONE
```

---

## 📊 成功指标

### 定量指标

| 指标 | 目标 | 监控方式 |
|------|------|---------|
| **Merge 冲突次数** | < 1次/周 | GitHub PR 统计 |
| **平均 Commit 粒度** | < 5个文件/commit | Git log 分析 |
| **Rebase 频率** | ≥ 2次/天 | Git reflog 统计 |
| **Push 频率** | ≥ 3次/天 | Git log --since |
| **文档分区违规** | 0次 | check-document-partition.mjs |

### 定性指标

- ✅ 所有 Agent 知道自己的 ID 范围
- ✅ 所有 Agent 遵守文档分区协议
- ✅ 开发前先 rebase 成为肌肉记忆
- ✅ 小步提交成为工作习惯

---

## 🛡️ 自动化工具清单

### 待开发工具

| 工具 | 功能 | 优先级 | 预计耗时 |
|------|------|--------|---------|
| `check-document-partition.mjs` | 文档分区检查 | P0 | 1h |
| `assign-task-id.mjs` | 自动分配任务 ID | P0 | 0.5h |
| `check-write-conflict.mjs` | PR前冲突检测 | P0 | 1h |
| `merge-backlog.mjs` | 智能合并 BACKLOG.md | P1 | 2h |
| `/sync-and-rebase` | 同步并 rebase 命令 | P1 | 0.5h |
| `/quick-commit` | 快速提交+push 命令 | P1 | 0.5h |
| `/add-task` | 添加新任务命令 | P2 | 0.5h |

### 已集成工具

- ✅ `/commit-push-pr` - 已内置冲突检测和治理校验
- ✅ `check-governance.mjs` - 治理校验

---

## 📚 快速参考卡片

### 每天（必做）

```bash
# 早上第一件事
git fetch origin main && git rebase origin/main

# 每2小时
git add . && git commit -m "..." && git push

# 下班前
/commit-push-pr  # 如果完成功能
```

### 提交 PR 前（必做）

```bash
# 1. 同步
git fetch origin main
git rebase origin/main

# 2. 检查
bun test
bun run scripts/check-governance.mjs

# 3. 提交
/commit-push-pr
```

### 发现冲突时

```bash
# 1. 终止合并
git merge --abort

# 2. 同步最新
git rebase origin/main

# 3. 解决冲突
# 编辑冲突文件...
git add <冲突文件>
git rebase --continue

# 4. 重新检查
/commit-push-pr
```

---

**文档版本**: v1.0.0
**最后更新**: 2026-01-11
**维护者**: @claude
**状态**: 📝 待实施
