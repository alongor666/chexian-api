# 进展索引 (PROGRESS_INDEX)

**状态机思维**：快速了解当前状态、阻塞点、下一步接力入口。

## 状态机定义

```
PROPOSED → TRIAGED → IN_PROGRESS → DONE
                         ↓
                      BLOCKED → (解决后回到 IN_PROGRESS)
                         ↓
                    DEPRECATED (废弃)
```

### 状态说明

| 状态 | 含义 | 必填字段 |
|------|------|----------|
| PROPOSED | 新需求提议 | 提出时间、需求描述 |
| TRIAGED | 已评审，待排期 | 优先级、归属板块 |
| IN_PROGRESS | 开发中 | 关联文档、关联代码 |
| BLOCKED | 被阻塞 | 阻塞原因、解决路径 |
| DONE | 已完成 | 关联文档、关联代码、**验收/证据**（必填） |
| DEPRECATED | 废弃 | 废弃原因 |

## 账本位置

| 账本 | 路径 | 说明 |
|------|------|------|
| 需求账本 | `/BACKLOG.md` | 记录所有任务状态（PROPOSED → DONE） |
| 进展账本 | `/PROGRESS.md` | 记录里程碑、阻塞、接力点（精简版） |

## 当前状态快照

**更新时间**: 执行 `bun run scripts/check-governance.mjs` 时自动校验

### 待办事项 (Backlog)

- 总数：查看 [BACKLOG.md](../../BACKLOG.md) 中 `状态=PROPOSED/TRIAGED`
- 高优先级：筛选 `优先级=P0/P1`

### 开发中任务 (In Progress)

- 总数：查看 [BACKLOG.md](../../BACKLOG.md) 中 `状态=IN_PROGRESS`
- **规则**：同一时间只允许少量任务并行（建议 ≤ 3）

### 阻塞点 (Blocked)

- 总数：查看 [BACKLOG.md](../../BACKLOG.md) 中 `状态=BLOCKED`
- 阻塞详情：查看 [PROGRESS.md](../../PROGRESS.md) 第 2 节

### 已完成 (Done)

- 总数：查看 [BACKLOG.md](../../BACKLOG.md) 中 `状态=DONE`
- 里程碑：查看 [PROGRESS.md](../../PROGRESS.md) 第 1 节

## DONE 判定规则（硬约束）

任务标记为 DONE **必须同时满足**：

1. **关联文档**：已填写（若无文档则填 `N/A`）
2. **关联代码**：已填写（若纯文档任务则填 `N/A`）
3. **验收/证据**：必填（至少一项）：
   - PR 链接（如 `#123`）
   - Commit 哈希（如 `abc1234`）
   - 对比报告路径（如 `/reports/perf-compare.md`）
   - 截图路径（如 `/docs/screenshots/feature-x.png`）
   - 测试报告（如 `bun test` 输出截图）

**校验脚本**：`scripts/check-governance.mjs` 会自动检查上述规则。

## 下一步接力入口

### 新协作者入口

1. 阅读三大索引：[DOC_INDEX](./DOC_INDEX.md) + [CODE_INDEX](./CODE_INDEX.md) + [PROGRESS_INDEX](./PROGRESS_INDEX.md)（本文档）
2. 阅读 [BACKLOG.md](../../BACKLOG.md) 了解待办事项
3. 选择任务后，更新状态为 `IN_PROGRESS`，并填写关联文档/代码
4. 完成后，更新状态为 `DONE`，**必须填写验收/证据**

### 新需求提出流程

1. 在 [BACKLOG.md](../../BACKLOG.md) 添加新行，状态设为 `PROPOSED`
2. 填写：提出时间、板块、需求描述
3. 等待评审（人工或 AI 评审后更新为 `TRIAGED`）

### 发现阻塞时

1. 在 [BACKLOG.md](../../BACKLOG.md) 将任务状态改为 `BLOCKED`
2. 在 [PROGRESS.md](../../PROGRESS.md) 第 2 节补充阻塞详情
3. 创建解决阻塞的新任务（状态 `PROPOSED`）

## 链接到其他索引

- **文档索引**: [DOC_INDEX.md](./DOC_INDEX.md) - 业务规则、架构文档
- **代码索引**: [CODE_INDEX.md](./CODE_INDEX.md) - 核心模块、关键文件

---

**变更规则**：
- BACKLOG.md/PROGRESS.md 必须通过 `scripts/check-governance.mjs` 校验。
- 任何标记为 DONE 的任务缺少证据链时，校验脚本会报错并阻止提交。
