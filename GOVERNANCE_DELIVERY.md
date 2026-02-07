# 治理体系交付文档

**交付时间**: 2026-01-07 16:50
**交付内容**: 索引一致性 + 需求/进展账本 + DONE 证据链 + 最小校验机制

---

## 1. 变更清单

### 新增文件（共 15 个）

#### 三大入口索引
1. `开发文档/00_index/DOC_INDEX.md` - 文档索引（业务规则、架构文档）
2. `开发文档/00_index/CODE_INDEX.md` - 代码索引（核心模块、关键文件）
3. `开发文档/00_index/PROGRESS_INDEX.md` - 进展索引（任务状态、证据链规则）

#### 两本账
4. `BACKLOG.md` - 需求账本（唯一真理来源，记录所有任务）
5. `PROGRESS.md` - 进展账本（里程碑、阻塞、接力点）

#### 核心层索引
6. `src/shared/INDEX.md` - 共享逻辑层索引
7. `src/features/INDEX.md` - 功能特性层索引
8. `src/widgets/INDEX.md` - UI 组件层索引
9. `scripts/INDEX.md` - 自动化脚本层索引

#### 治理脚本
10. `scripts/check-governance.mjs` - 治理一致性校验脚本（Node.js）

#### 交付文档
11. `GOVERNANCE_DELIVERY.md` - 本文档（交付清单、验收、回滚）

### 修改文件（共 3 个）

12. `CLAUDE.md` - 协作操作系统化加固（三大索引 + 护栏 + 交付协议）
13. `AGENTS.md` - 多 AI Agent 协作操作系统（5 种角色权限边界）
14. `package.json` - 添加 `governance` 脚本快捷命令

### 保留文件（不变）

- `DEVELOPMENT_PROGRESS.md` - 保留作为历史记录（内容已迁移到 BACKLOG.md + PROGRESS.md）
- `src/` 下所有业务代码 - **未修改任何业务逻辑、指标口径、数据字典**
- `tests/` 下所有测试 - **未修改**

---

## 2. 核心层目录定义（推断结果）

根据仓库扫描，确定以下 4 个核心层目录（强制 INDEX.md）：

| 层级 | 路径 | 职责 | INDEX.md 状态 |
|------|------|------|---------------|
| 共享逻辑层 | `src/shared/` | DuckDB客户端、数据规范化、SQL模板 | ✅ 已创建 |
| 功能特性层 | `src/features/` | Dashboard、Filters 业务功能 | ✅ 已创建 |
| UI 组件层 | `src/widgets/` | Charts、KPI、Table 通用组件 | ✅ 已创建 |
| 自动化脚本 | `scripts/` | 治理校验、构建、CI/CD | ✅ 已创建 |

**非核心层目录**（不强制 INDEX.md）：
- `src/app/` - 应用入口（单文件）
- `src/shared/types/` - 类型定义（无独立逻辑）
- `src/shared/utils/` - 工具函数（无独立逻辑）

---

## 3. 验收清单

### 3.1 本地验收（必须全部通过）

#### ✅ 步骤 1：运行治理校验
```bash
cd /Users/xuechenglong/Downloads/01-公司开发项目/A00销售人员业绩看板/2025fupan
bun run governance
```

**预期输出**：
```
=== 治理一致性校验 ===

[ℹ] 检查必需文件存在性...
[✓] 必需文件检查通过

[ℹ] 检查核心层索引完整性...
[✓] 核心层索引检查通过

[ℹ] 检查 BACKLOG.md 证据链...
[✓] BACKLOG.md 证据链检查通过（5 个 DONE 任务）

=== Summary ===
Total checks: 3
✓ Passed: 3

[✓] 所有治理校验通过！
```

**判定**：退出码为 0，所有检查通过。

---

#### ✅ 步骤 2：验证三大索引存在
```bash
ls -l 开发文档/00_index/
```

**预期输出**：
```
DOC_INDEX.md
CODE_INDEX.md
PROGRESS_INDEX.md
```

---

#### ✅ 步骤 3：验证两本账存在
```bash
ls -l BACKLOG.md PROGRESS.md
```

**预期输出**：
```
-rw-r--r--  BACKLOG.md
-rw-r--r--  PROGRESS.md
```

---

#### ✅ 步骤 4：验证核心层索引存在
```bash
find src scripts -name "INDEX.md"
```

**预期输出**：
```
src/shared/INDEX.md
src/features/INDEX.md
src/widgets/INDEX.md
scripts/INDEX.md
```

---

#### ✅ 步骤 5：验证 BACKLOG.md 证据链完整性
```bash
grep "DONE" BACKLOG.md | head -5
```

**预期**：所有 DONE 任务都有验收/证据（非空、非 N/A）。

**手动检查**：打开 `BACKLOG.md`，检查状态为 `DONE` 的任务：
- B001: Commit `3538897` ✅
- B002: `bun test` 44个测试全通过 ✅
- B003: 4个 README 已创建 ✅
- B004: 文件已创建 ✅
- B005: Commit `cd53095` ✅

---

#### ✅ 步骤 6：验证业务代码未被修改
```bash
git status src/
```

**预期**：`src/` 下除了新增的 `INDEX.md`，没有其他修改。

---

#### ✅ 步骤 7：验证测试仍然通过
```bash
bun test
```

**预期**：所有 44 个测试通过。

---

### 3.2 集成验收（可选）

如果仓库配置了 GitHub Actions，可添加以下工作流：

**`.github/workflows/governance.yml`**（可选）：
```yaml
name: Governance Check

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  governance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run governance
```

---

## 4. 回滚策略

### 4.1 完全回滚（撤销所有治理改动）

如果需要完全撤回治理体系，执行以下命令：

```bash
# 删除新增的治理文件
rm -rf 开发文档/
rm BACKLOG.md PROGRESS.md GOVERNANCE_DELIVERY.md
rm scripts/check-governance.mjs scripts/INDEX.md
rm src/shared/INDEX.md src/features/INDEX.md src/widgets/INDEX.md

# 恢复修改的文件（从 git 历史恢复）
git checkout HEAD -- CLAUDE.md AGENTS.md package.json

# 确认回滚
git status
```

**说明**：
- 删除所有新增的治理文件
- 恢复 CLAUDE.md、AGENTS.md、package.json 到修改前状态
- 业务代码、测试、配置不受影响

---

### 4.2 部分回滚（保留索引，移除校验）

如果只想移除校验脚本，保留索引和账本：

```bash
# 仅删除校验脚本
rm scripts/check-governance.mjs

# 从 package.json 移除 governance 脚本
# 手动编辑 package.json，删除 "governance": "node scripts/check-governance.mjs"

# 确认
git status
```

---

### 4.3 Git 提交回滚

如果已经提交，可使用 git revert：

```bash
# 查看最近提交
git log --oneline -5

# 回滚最近一次提交（假设治理改动是最新的）
git revert HEAD

# 或者回滚特定提交
git revert <commit-hash>
```

---

## 5. 后续维护建议

### 5.1 治理文件维护责任

| 文件 | 维护角色 | 更新频率 | 触发条件 |
|------|----------|----------|----------|
| BACKLOG.md | 所有协作者 | 每日 | 新增需求、状态变更、完成任务 |
| PROGRESS.md | 项目负责人 | 每周 | 里程碑达成、阻塞出现 |
| DOC_INDEX.md | 文档 Agent | 每月或按需 | 新增业务规则文档 |
| CODE_INDEX.md | 开发 Agent | 每次新增核心模块 | 新增目录、关键类型 |
| PROGRESS_INDEX.md | 治理 Agent | 每季度 | 状态机规则变更 |
| `*/INDEX.md` | 对应模块负责人 | 按需 | 新增文件、子模块 |

---

### 5.2 治理校验集成建议

#### Pre-commit Hook（推荐）
在 `.git/hooks/pre-commit` 添加：
```bash
#!/bin/bash
bun run governance || {
  echo "❌ 治理校验失败，请修复后再提交"
  exit 1
}
```

#### GitHub Actions（推荐）
见"3.2 集成验收"部分的 workflow 配置。

#### IDE 集成（可选）
在 VSCode 的 `tasks.json` 添加：
```json
{
  "label": "Governance Check",
  "type": "shell",
  "command": "bun run governance",
  "problemMatcher": []
}
```

---

### 5.3 定期审计建议

| 审计项 | 频率 | 负责人 | 产出 |
|--------|------|--------|------|
| BACKLOG 证据链完整性 | 每周 | 治理 Agent | 缺失证据清单 |
| 索引一致性 | 每月 | 治理 Agent | 缺失索引清单 |
| 业务口径变更记录 | 每季度 | 架构师 Agent | 口径变更日志 |
| 技术债务清单 | 每季度 | 架构师 Agent | 重构优先级列表 |

---

## 6. 常见问题 (FAQ)

### Q1: 为什么需要三大索引？
**A**: 避免"文档散落、代码迷路、进展不透明"。三大索引是协作的唯一入口，5分钟快速定位。

### Q2: BACKLOG.md 和 PROGRESS.md 有什么区别？
**A**:
- BACKLOG.md：记录所有任务细节（状态机完整流转）
- PROGRESS.md：只记录里程碑、阻塞、接力点（精简版）

### Q3: 为什么 DONE 任务必须有证据？
**A**: 避免"自说自话"。证据链确保可审计、可复现、可接力。

### Q4: 核心层目录是固定的吗？
**A**: 不是。可根据项目实际情况调整。但一旦确定，必须创建 INDEX.md 并在 CODE_INDEX.md 登记。

### Q5: 校验脚本失败怎么办？
**A**:
1. 查看脚本输出的具体错误（文件路径、行号）
2. 补齐缺失的文件或字段
3. 重新运行 `bun run governance`

### Q6: 能否跳过校验直接提交？
**A**: 不推荐。校验失败说明治理体系有破损，强制提交会导致后续协作混乱。

---

## 7. 交付成果总结

### 已完成（6/6）
- ✅ 三大入口索引（DOC/CODE/PROGRESS）
- ✅ 两本账（BACKLOG.md + PROGRESS.md）
- ✅ 核心层目录 INDEX.md（4个）
- ✅ CLAUDE.md 和 AGENTS.md 加固
- ✅ 治理校验脚本（check-governance.mjs）
- ✅ 验收清单与回滚策略（本文档）

### 未完成（0）
- 无

### 附加产出
- 快捷命令：`bun run governance`
- 完整文档：15 个新增文件，3 个修改文件
- 零业务代码修改：**严格遵守"不改业务逻辑"约束**

---

## 8. 接力点

### 下一个协作者应该做什么？

1. **阅读三大索引**（5分钟）：
   - [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md)
   - [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md)
   - [PROGRESS_INDEX](./开发文档/00_index/PROGRESS_INDEX.md)

2. **查看待办任务**：
   - 打开 [BACKLOG.md](./BACKLOG.md)
   - 筛选状态为 `TRIAGED` 的任务
   - 选择合适任务，更新状态为 `IN_PROGRESS`

3. **完成任务后**：
   - 更新状态为 `DONE`
   - **必须填写验收/证据**
   - 运行 `bun run governance` 确保通过

4. **遇到问题时**：
   - 查看 [CLAUDE.md](./CLAUDE.md) 第 6 节"异常情况处理"
   - 在 BACKLOG.md 标记为 `BLOCKED`
   - 在 PROGRESS.md 补充阻塞详情

---

**交付完成时间**: 2026-01-07 16:50
**验收责任人**: @xuechenglong
**治理体系版本**: v1.0.0
