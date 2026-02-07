# AI 协作指南

**适用对象**：所有参与本项目的AI（Claude、Gemini、GPT-4、DeepSeek等）

**文档目的**：建立统一的协作协议，避免重复踩坑，确保知识传递。

---

## 1. 协作原则（ALL AI MUST FOLLOW）

### 1.1 入场强制流程

```
步骤1：阅读技术栈声明
  ↓  /开发文档/TECH_STACK.md
  ↓  了解项目技术特性（DuckDB、React、Vite）
  ↓
步骤2：查看任务上下文
  ↓  /BACKLOG.md（需求状态）
  ↓  /PROGRESS.md（里程碑、阻塞点）
  ↓
步骤3：定位责任区域
  ↓  /开发文档/00_index/CODE_INDEX.md
  ↓  确认要修改的模块和强制入口文件
  ↓
步骤4：执行开发任务
  ↓  遵守三层验证（单元测试 → 浏览器实测 → 用户验收）
  ↓
步骤5：记录证据链
  ↓  在 BACKLOG.md 填写验收/证据字段
```

### 1.2 禁止事项（RED LINE）

| 禁止行为 | 原因 | 后果 |
|----------|------|------|
| **跳过浏览器实测** | 无法验证 DuckDB SQL 实际执行结果 | SQL 类型错误、逻辑错误 |
| **猜测 API 支持** | DuckDB ≠ PostgreSQL/MySQL | 语法错误、功能缺失 |
| **修改护栏文件** | 破坏业务口径、数据去重规则 | 数据错误、指标失准 |
| **自我安慰式开发** | 只看测试通过就认为完成 | 实际运行报错 |
| **删除已有别名** | 破坏向后兼容性 | 用户数据无法加载 |

### 1.3 强制验证清单

每个AI完成任务后，必须在 BACKLOG.md 填写以下证据：

- [ ] 单元测试通过截图/日志（`bun test`）
- [ ] 浏览器 Console 截图（无红色错误）
- [ ] 关键字段实际值样本（如 `time_period: "2025-W01"`）
- [ ] Commit 哈希或 PR 链接

**缺少任何一项 = 任务未完成**

---

## 2. 知识传递协议

### 2.1 踩坑后必须记录

发现新问题后，必须在对应文档补充：

| 问题类型 | 记录位置 | 必须包含 |
|----------|----------|----------|
| DuckDB 语法陷阱 | `/开发文档/TECH_STACK.md` § 5 | 错误表现、根因、解决方案 |
| 架构约束 | `/开发文档/TECH_STACK.md` § 2 | 强制入口文件、违反后果 |
| 业务口径错误 | `/BACKLOG.md`（新增 BLOCKED 任务） | 错误内容、影响范围、产品确认 |
| 验证流程缺陷 | `/开发文档/TECH_STACK.md` § 4 | 缺失步骤、补充方法 |

**格式示例**：
```markdown
| 陷阱 | 表现 | 根因 | 解决方案 |
|------|------|------|----------|
| 类型不匹配 | `No function matches YEAR(VARCHAR)` | PolicyFact 字段是 VARCHAR | 先 `CAST(field AS DATE)` |
```

### 2.2 接力上下文传递

当前AI完成任务后，必须在 `/PROGRESS.md` 更新：

```markdown
## 2. 当前阻塞与下一步行动

### 已完成
- ✅ [2026-01-08] 自然周/月视图 SQL 实现（B012）
  - 关键发现：PolicyFact 字段类型为 VARCHAR，需 CAST
  - 验证方法：Chrome Console 查看 time_period 实际值
  - 文档更新：TECH_STACK.md § 3.1（DuckDB 日期处理）

### 下一步
- [ ] 上传 签单清洗/优化处理后的业务数据.parquet
- [ ] 验证周视图 X 轴显示 2025-W01 格式
- [ ] 验证月视图 X 轴显示 2025-01 格式
```

---

## 3. 通用验证方法（适用所有技术栈）

### 3.1 决策树：如何验证

```
你的任务类型是？
├─ 前端UI开发（React组件）
│   ├─ 单元测试：Vitest
│   ├─ 浏览器验证：开发服务器热重载（bun run dev）
│   └─ 用户验收：人工操作确认
│
├─ SQL开发（DuckDB查询）
│   ├─ 单元测试：验证SQL生成逻辑
│   ├─ ⚠️ **浏览器实测**：Chrome Console 查看执行结果
│   └─ 用户验收：数据格式、图表显示正确
│
├─ 数据处理（Parquet加载、验证）
│   ├─ 单元测试：mapping、validator 测试
│   ├─ 浏览器验证：上传实际文件测试
│   └─ 用户验收：数据正确加载、无报错
│
├─ API开发（后端服务）【本项目暂无】
│   ├─ 单元测试：API逻辑测试
│   ├─ 集成测试：Postman/Curl 实测
│   └─ 用户验收：前端集成测试
│
└─ 文档更新
    ├─ 链接检查：确保内部链接有效
    ├─ 格式检查：Markdown 渲染正确
    └─ 治理校验：bun run scripts/check-governance.mjs
```

### 3.2 本项目特殊性

**为什么必须浏览器实测？**
- DuckDB-WASM 在浏览器中运行（不是后端数据库）
- SQL 执行结果只能通过 Chrome Console 查看
- 字段类型定义在 PolicyFact 视图中（`client.ts:78-95`）

**示例：如何验证 SQL 查询**
```javascript
// 1. 打开 Chrome DevTools (F12)
// 2. 切换到 Console 标签页
// 3. 查找 [Trend Data] 日志

[Trend Data] Loaded 8 rows for weekly view
[Trend Data] SQL: SELECT ...
[Trend Data] Sample: [
  { time_period: "2025-W01", total_premium: 1500000 },
  { time_period: "2025-W02", total_premium: 1800000 },
  { time_period: "2025-W03", total_premium: 1650000 }
]

// ✅ 验证 time_period 格式为 "YYYY-WXX"
// ❌ 如果显示 "2025-01-27"，说明 SQL 有问题
```

---

## 4. 跨AI协作场景

### 4.1 场景1：接替未完成任务

**步骤**：
1. 读取 `/BACKLOG.md`，找到 `IN_PROGRESS` 或 `BLOCKED` 状态任务
2. 读取 `/PROGRESS.md` § 2（当前阻塞与下一步行动）
3. 读取任务关联的代码/文档（见 BACKLOG 的"关联代码"列）
4. 如果前任AI有记录问题，先读 `/开发文档/TECH_STACK.md` § 5（常见陷阱）

**示例**：
```markdown
# BACKLOG.md
| B012 | ... | 修复周/月视图SQL | P0 | IN_PROGRESS | ... | ... | N/A |

# PROGRESS.md
### 当前阻塞
- [ ] B012 周视图SQL报错：No function matches YEAR(VARCHAR)
  - 原因：policy_date 是 VARCHAR 类型
  - 解决方案：需要 CAST(policy_date AS DATE)
```

你应该：
1. 检查 `client.ts:78-95` PolicyFact 视图定义
2. 修改 SQL 添加 CAST
3. 编写单元测试验证
4. **浏览器实测** Chrome Console
5. 更新 BACKLOG.md 状态为 DONE，填写证据

### 4.2 场景2：发现前任AI的错误

**不要直接修改！**

正确流程：
1. 在 `/BACKLOG.md` 添加新任务（状态=PROPOSED）
2. 描述问题：前任AI的实现有何问题
3. 提供证据：错误日志、截图、测试失败
4. 标注影响范围：哪些功能受影响
5. 等待产品确认后再修复

**示例**：
```markdown
| B013 | 2026-01-09 | Bug/SQL | @gemini | B012的周计算逻辑使用ISO周而非自然周 | P1 | PROPOSED | 开发文档/TECH_STACK.md | src/shared/sql/trend.ts | N/A |
```

### 4.3 场景3：多AI并行开发

**冲突预防**：
1. 每个AI在 `/BACKLOG.md` 认领任务时，状态改为 `IN_PROGRESS`
2. 在任务的"归属对象"列填写AI名称（如 `@claude`, `@gemini`）
3. 开始前读取最新的 `PROGRESS.md`，避免重复工作

**代码冲突**：
- 使用 Git 分支隔离（如 `feat/claude-weekly-view`, `feat/gemini-export`）
- 提交前检查 `git status`，确保不覆盖他人修改

---

## 5. 常见反模式（ANTI-PATTERNS）

| 反模式 | 表现 | 正确做法 |
|--------|------|----------|
| **路径依赖猜测** | "这应该是PostgreSQL"，用PG语法 | 先读 `/开发文档/TECH_STACK.md` 确认技术栈 |
| **跳过强制入口** | 直接修改SQL，不查看字段类型 | 先读 `client.ts:78-95` PolicyFact 定义 |
| **测试通过=完成** | 单元测试过了就提交 | 必须浏览器实测 + 截图证据 |
| **孤岛式开发** | 只在AI内部记忆，不更新文档 | 必须更新 BACKLOG + PROGRESS + TECH_STACK |
| **无证据交付** | BACKLOG验收/证据列为空 | 提供截图、日志、Commit哈希 |

---

## 6. 文档维护责任

### 6.1 每个AI的义务

| 触发条件 | 必须更新的文档 | 更新内容 |
|----------|----------------|----------|
| 完成任务 | `/BACKLOG.md` | 状态改为 DONE，填写验收/证据 |
| 发现新陷阱 | `/开发文档/TECH_STACK.md` § 5 | 补充到"常见陷阱与解决方案"表格 |
| 发现架构约束 | `/开发文档/TECH_STACK.md` § 2 | 补充到"架构强制入口"表格 |
| 遇到阻塞 | `/PROGRESS.md` § 2 | 描述阻塞原因、影响范围、需要谁解决 |
| 新增核心模块 | `/src/*/INDEX.md` | 登记模块信息 |

### 6.2 文档优先级

```
P0（必须实时更新）
  ├─ BACKLOG.md（任务状态）
  ├─ PROGRESS.md（阻塞点）
  └─ TECH_STACK.md（陷阱、约束）

P1（任务完成后更新）
  ├─ CODE_INDEX.md（新增模块）
  ├─ DOC_INDEX.md（新增文档）
  └─ */README.md（模块文档）

P2（可延后）
  └─ 架构设计文档（重构后补充）
```

---

## 7. 质量门禁（QUALITY GATE）

### 7.1 提交前检查清单

所有AI提交代码前必须确认：

- [ ] 单元测试全部通过（`bun test`）
- [ ] 浏览器实测无错误（Chrome Console 无红色）
- [ ] 关键功能人工验证（如图表显示正确）
- [ ] BACKLOG.md 状态更新为 DONE
- [ ] BACKLOG.md 验收/证据字段已填写
- [ ] 治理校验通过（`bun run scripts/check-governance.mjs`）
- [ ] Git commit message 符合规范（见 CLAUDE.md § 3）

### 7.2 自我审查

**问自己3个问题**：
1. 我是否真的**浏览器实测**了这个功能？（不是猜的，不是看测试过了）
2. 我是否记录了**实际执行结果**的截图/日志？（不是预期结果）
3. 如果下一个AI接手，他能从我的证据链中**快速理解问题和解决方案**吗？

---

## 8. 协作效率提升

### 8.1 快速定位问题

**使用索引而非全文搜索**：
1. 技术栈问题 → `/开发文档/TECH_STACK.md`
2. 业务规则 → `/开发文档/00_index/DOC_INDEX.md` § 业务规则与口径
3. 代码入口 → `/开发文档/00_index/CODE_INDEX.md`
4. 任务状态 → `/BACKLOG.md`
5. 阻塞点 → `/PROGRESS.md` § 2

### 8.2 避免重复踩坑

**每次开发SQL前**：
1. 先读 `/开发文档/TECH_STACK.md` § 5（常见陷阱）
2. 搜索是否有类似问题的历史记录
3. 查看 BACKLOG 中是否有相关的 BLOCKED 任务

---

**维护规则**：
- 发现新的协作问题 → 补充到对应章节
- 文档过时 → 立即更新，不要拖延
- 有疑问 → 在 PROGRESS.md 提出，等待产品确认

**变更历史**：
- 2026-01-08：创建 AI 协作指南，总结自然周/月视图实现教训
