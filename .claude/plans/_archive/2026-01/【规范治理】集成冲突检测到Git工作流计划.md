# 实施计划：集成冲突检测到 commit-push-pr 命令

## 📋 需求概述

将冲突检测功能集成到 `/commit-push-pr` 命令中，采用**方案2：独立工具 + 调用**的方式。

**核心原则**：
- ✅ 遵循 SOLID 原则（单一职责）
- ✅ 关注点分离（工具独立、命令调用）
- ✅ 代码复用（其他命令也能使用）
- ✅ 易于维护和测试

---

## 🎯 实施方案

### 方案：保持独立工具 + commit-push-pr.md 调用

**架构设计**：

```
commit-push-pr.md (命令层)
    ↓ 调用
scripts/check-write-conflict.mjs (冲突检测层)
    ↓ 调用
├── scripts/assign-task-id.mjs (任务 ID 分配)
├── scripts/check-document-partition.mjs (文档分区检查)
└── git 命令 (merge 冲突检测)
```

---

## 📁 需要修改的文件

### 1. 主命令：`.claude/commands/commit-push-pr.md`

**修改位置**：第75-80行（"### 3. 执行 Git 操作" 之前）

**插入内容**：

```markdown
### 3. 前置检查（PR前必做）

**⚠️ 根据 CLAUDE.md §9.4 多Agent协作协议，创建 PR 前必须执行冲突检测**

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

---

### 2. 工具脚本：保持不变

以下文件**不需要修改**，已存在并可正常使用：

- ✅ `scripts/assign-task-id.mjs` - 任务 ID 自动分配
- ✅ `scripts/check-document-partition.mjs` - 文档分区检查
- ✅ `scripts/check-write-conflict.mjs` - PR 前冲突检测（综合检查）

---

### 3. 可选：创建快捷命令

创建 `.claude/commands/sync-and-rebase.md`（可选，方便用户日常同步）：

```markdown
# 同步并 Rebase

一键执行：
1. git fetch origin main
2. git rebase origin/main
3. 运行冲突检测
4. 运行测试

**使用方法**：
```
/sync-and-rebase
```

适用场景：每天开始工作前、创建 PR 前
```

---

## 🔄 工作流

### 用户使用流程

```bash
# 场景1：完成功能，准备提交 PR
/commit-push-pr

# 自动执行：
# ✅ 1. 分析变更
# ✅ 2. 生成 commit message
# ✅ 3. 前置检查
#     - git fetch origin main
#     - bun run scripts/check-write-conflict.mjs
#     - bun run scripts/check-governance.mjs
# ✅ 4. git add + commit + push
# ✅ 5. 创建 PR
```

### 冲突检测脚本内部流程

`scripts/check-write-conflict.mjs` 会自动执行：

1. ✅ 检查分支是否基于最新的 main
2. ✅ 检查 BACKLOG.md 是否有追加冲突
3. ✅ 检查索引文件是否跨区写入
4. ✅ 模拟 merge 检测冲突
5. ✅ 如果全部通过，返回 0；否则返回 1

---

## ✅ 验收标准

### 功能验证

1. **正常情况（无冲突）**：
   ```bash
   /commit-push-pr
   # 预期：所有检查通过，成功创建 PR
   ```

2. **分支基准过期**：
   ```bash
   /commit-push-pr
   # 预期：检测到分支不是基于最新 main，给出警告，询问是否继续
   ```

3. **存在 merge 冲突**：
   ```bash
   /commit-push-pr
   # 预期：检测到冲突，列出冲突文件，终止操作，给出解决指引
   ```

4. **文档分区违规**：
   ```bash
   /commit-push-pr
   # 预期：检测到违规，终止操作，说明哪些文档违规
   ```

### 测试步骤

1. **测试工具独立性**：
   ```bash
   bun run scripts/assign-task-id.mjs @claude      # 应输出 B100
   bun run scripts/check-document-partition.mjs    # 应通过
   bun run scripts/check-write-conflict.mjs        # 应通过
   ```

2. **测试命令集成**：
   ```bash
   /commit-push-pr
   # 验证是否调用了冲突检测脚本
   ```

3. **测试错误处理**：
   - 创建一个与 main 冲突的分支
   - 运行 `/commit-push-pr`
   - 验证是否正确终止并给出指引

---

## 📊 优势分析

### 为什么选择方案2？

| 维度 | 方案1（集成） | 方案2（独立+调用） |
|------|--------------|-------------------|
| **单一职责** | ❌ 违反（一个命令做多件事） | ✅ 遵守（每个工具职责单一） |
| **代码复用** | ❌ 无法单独使用 | ✅ 可独立调用 |
| **可测试性** | ❌ 难以单独测试 | ✅ 每个工具可独立测试 |
| **可维护性** | ❌ 修改影响整体 | ✅ 修改影响范围小 |
| **扩展性** | ❌ 添加新功能困难 | ✅ 易于添加新工具 |
| **用户体验** | ✅ 一个命令完成 | ✅ 一个命令完成（调用多个） |
| **符合规范** | ❌ 违反 SOLID 原则 | ✅ 遵守 SOLID 原则 |

---

## 📝 实施步骤

### Step 1：修改 commit-push-pr.md

在第75行之前插入"前置检查"章节：

```markdown
### 3. 前置检查（PR前必做）
...
（内容见上文）
```

### Step 2：更新注意事项

在"注意事项"章节添加：

```markdown
1. **前置检查（强制执行）**：
   - ⚠️ **必须通过冲突检测**才能创建 PR
   - ⚠️ **必须通过治理校验**才能提交代码
   - 如果检测到冲突，参考 CLAUDE.md §9.5 处理流程
   - 建议在开发前先 `git rebase origin/main` 同步最新代码
```

### Step 3：（可选）创建快捷命令

创建 `.claude/commands/sync-and-rebase.md`

---

## 🎯 预期成果

完成后，用户只需：

```bash
/commit-push-pr
```

就会自动：
1. ✅ 分析变更
2. ✅ 生成 commit message
3. ✅ **同步最新代码**
4. ✅ **运行冲突检测**
5. ✅ **运行治理校验**
6. ✅ 提交代码
7. ✅ 推送远程
8. ✅ 创建 PR

**如果任何检查失败，自动终止并给出详细指引。**

---

## 📚 相关文档

- `CLAUDE.md §9` - 多Agent协作协议
- `开发文档/CONFLICT_AVOIDANCE_IMPLEMENTATION.md` - 详细实施指南
- `开发文档/CONFLICT_FREE_GUIDE.md` - 完整总结
- `.claude/commands/conflict-free-quick-reference.md` - 快速参考卡片

---

**维护者**: @claude
**创建时间**: 2026-01-11
**预计耗时**: 15分钟（修改1个文件 + 测试）
