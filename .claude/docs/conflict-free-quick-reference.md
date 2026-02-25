# 零冲突协作 - 快速参考卡片

## 🎯 目标

**完全避免 Git merge 冲突的4大支柱**

---

## ✅ 支柱1：遵守文档分区协议

### 原则
- 每个只修改自己的文档分区
- 不修改其他 Agent 的专属内容

### 实施工具

```bash
# 检查文档分区违规
bun run scripts/check-document-partition.mjs

# 集成到 pre-commit hook
echo "bun run scripts/check-document-partition.mjs" >> .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### 分区标记示例

```markdown
<!-- @claude-section-start -->
## Claude 工作区
... (只有 @claude 可以修改)
<!-- @claude-section-end -->

<!-- @codex-section-start -->
## Codex 工作区
... (只有 @codex 可以修改)
<!-- @codex-section-end -->
```

### 常见违规场景

| 场景 | 违规行为 | 正确做法 |
|------|---------|---------|
| CLAUDE.md §1-8 | Agent 修改核心协议 | 只在 §9 添加内容 |
| BACKLOG.md | 所有 Agent 末尾追加 | 使用专属 ID 范围 |
| 索引文件 | 修改别人的 section | 只修改自己的 section |

---

## ✅ 支柱2：使用不同的任务 ID

### 原则
- 每个 Agent 使用专属 ID 范围
- 避免任务编号冲突

### ID 范围分配

| Agent | ID 范围 | 示例 |
|-------|--------|------|
| @user | B001-B099 | B001, B002, ... |
| @claude | B100-B199 | B100, B101, ... |
| @codex | B200-B299 | B200, B201, ... |
| @gemini | B300-B399 | B300, B301, ... |

### 实施工具

```bash
# 自动分配任务 ID
bun run scripts/assign-task-id.mjs @claude
# 输出：B100

# 使用 ID 创建任务
NEW_ID=$(bun run scripts/assign-task-id.mjs @claude)
echo "| $NEW_ID | 添加XXX功能 | IN_PROGRESS | ... |" >> BACKLOG.md
```

### Slash Command

```bash
# 快速添加任务
/add-task 板块:数据分析 描述:优化SQL查询 优先级:P1
```

---

## ✅ 支柱3：及时 Rebase

### 原则
- 开发前先同步最新 main
- 防止代码文件冲突

### 实施工具

```bash
# 方式1：手动 rebase
git fetch origin main
git rebase origin/main

# 方式2：使用 Slash Command
/sync-and-rebase

# 方式3：Git Hooks 自动提醒
# .git/hooks/post-merge
chmod +x .git/hooks/post-merge
```

### 最佳实践

```bash
# ===== 每天开始工作前（必做） =====
git fetch origin main
git rebase origin/main

# ===== 创建 PR 前（必做） =====
git fetch origin main
git rebase origin/main

# ===== 中午休息前（推荐） =====
git fetch origin main
git rebase origin/main
```

### Rebase 冲突处理

```bash
# 1. 开始 rebase
git rebase origin/main

# 2. 如果出现冲突
# 编辑冲突文件...
git add <冲突文件>
git rebase --continue

# 3. 如果想放弃
git rebase --abort
```

---

## ✅ 支柱4：小步快跑，频繁提交

### 原则
- 每30-60分钟提交一次
- 减少冲突范围

### 提交频率建议

| 场景 | 建议频率 | 示例 |
|------|---------|------|
| 开发新功能 | 每30-60分钟 | 完成1个小函数 → commit |
| 修复 Bug | 每15-30分钟 | 修复1个测试 → commit |
| 重构代码 | 每重构1个文件 | 完成单文件 → commit |
| 更新文档 | 每更新1个章节 | 完成1节 → commit |

### 实施工具

```bash
# 方式1：手动提交
git add .
git commit -m "feat(kpi): 添加损失率计算"
git push

# 方式2：Slash Command
/quick-commit

# 方式3：启用自动 push
touch .git/auto-push-enabled
```

### Commit Message 规范

```bash
# ✅ 好的提交消息
git commit -m "feat(kpi): 添加赔付杠杆率计算函数"
git commit -m "fix(dashboard): 修复趋势图日期显示错误"
git commit -m "docs: 更新 TECH_STACK.md §4"
git commit -m "test: 添加杠杆率单元测试"

# ❌ 差的提交消息
git commit -m "update"
git commit -m "fix bug"
git commit -m "work"
```

---

## 🚀 完整工作流示例

### 场景：Claude 开发新功能

```bash
# ========================================
# 早上开始工作前
# ========================================
git fetch origin main
git rebase origin/main

# ========================================
# 开发过程中（每30分钟）
# ========================================
# 完成小功能A
vim server/src/sql/kpi.ts
git add server/src/sql/kpi.ts
git commit -m "feat(kpi): 添加损失率计算SQL模板"
git push

# 完成小功能B（30分钟后）
vim tests/kpi.test.ts
git add tests/kpi.test.ts
git commit -m "test: 添加损失率单元测试"
git push

# ========================================
# 中午休息前
# ========================================
git fetch origin main
git rebase origin/main

# ========================================
# 下午继续开发
# ========================================
# 完成UI集成
vim src/features/dashboard/PremiumDashboard.tsx
git add src/features/dashboard/PremiumDashboard.tsx
git commit -m "feat(dashboard): 集成损失率到业绩看板"
git push

# ========================================
# 准备提交 PR 前
# ========================================
# 1. 最终同步
git fetch origin main
git rebase origin/main

# 2. 运行所有检查
bun test
bun run scripts/check-governance.mjs
bun run scripts/check-document-partition.mjs
bun run scripts/check-write-conflict.mjs

# 3. 提交 PR
/commit-push-pr
```

---

## 🛡️ 预防工具清单

### 已创建工具

| 工具 | 功能 | 使用时机 |
|------|------|---------|
| `assign-task-id.mjs` | 自动分配任务 ID | 创建新任务前 |
| `check-document-partition.mjs` | 文档分区检查 | commit 前 |
| `check-write-conflict.mjs` | PR前冲突检测 | 创建 PR 前 |
| `/commit-push-pr` | 提交+推送+创建PR | 完成功能后 |

### 待开发工具

| 工具 | 功能 | 优先级 |
|------|------|--------|
| `merge-backlog.mjs` | 智能合并 BACKLOG.md | P1 |
| `/sync-and-rebase` | 同步并 rebase | P1 |
| `/quick-commit` | 快速提交+push | P1 |
| `/add-task` | 添加新任务 | P2 |

---

## ⚠️ 常见错误与解决

### 错误1：检测到 merge 冲突

```bash
❌ 检测到与 main 分支存在冲突

# 解决方案：
git rebase origin/main
# 逐个解决冲突...
git add <冲突文件>
git rebase --continue
```

### 错误2：BACKLOG.md 任务 ID 冲突

```bash
⚠️  BACKLOG.md 包含 @claude 的任务 ID 范围
当前 Agent: @codex

# 解决方案：
# 使用正确的 ID 范围
NEW_ID=$(bun run scripts/assign-task-id.mjs @codex)
```

### 错误3：文档分区违规

```bash
❌ CLAUDE.md 是只读文档（核心协议文档，仅用户可修改）
当前 Agent: @claude

# 解决方案：
# 在自己的文档中添加内容
# BACKLOG_CLAUDE.md 或其他专属文档
```

---

## 📊 成功指标

### 定量指标

- ✅ Merge 冲突次数 < 1次/周
- ✅ 平均 Commit 粒度 < 5个文件/commit
- ✅ Rebase 频率 ≥ 2次/天
- ✅ Push 频率 ≥ 3次/天
- ✅ 文档分区违规 = 0次

### 定性指标

- ✅ 所有 Agent 知道自己的 ID 范围
- ✅ 所有 Agent 遵守文档分区协议
- ✅ 开发前先 rebase 成为肌肉记忆
- ✅ 小步提交成为工作习惯

---

## 📚 相关文档

- **详细实施指南**: `开发文档/CONFLICT_AVOIDANCE_IMPLEMENTATION.md`
- **多Agent协作协议**: `CLAUDE.md §9`
- **冲突根本原因分析**: `开发文档/MERGE_CONFLICT_ROOT_CAUSE_ANALYSIS.md`

---

**版本**: v1.1.0
**最后更新**: 2026-02-24
