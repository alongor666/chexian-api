# Linear 任务导出 - 代码质量改进

**项目**: 2025fupan
**迭代**: Code Quality Improvement
**时间线**: 2026-01-13 ~ 2026-02-07

---

## 📋 任务清单

### **Week 1: 测试基础设施**

#### **Task 1.1: 启用现有测试**
```yaml
Title: "启用被跳过的logger和hooks单元测试"
Description: |
  将 tests/logger.test.ts.skip 和 tests/hooks.test.ts.skip 重命名为正式测试文件并运行

  **验收标准**:
  - tests/logger.test.ts 所有测试通过
  - tests/hooks.test.ts 所有测试通过
  - bun test 输出 20+ tests passed

  **执行步骤**:
  ```bash
  mv tests/logger.test.ts.skip tests/logger.test.ts
  mv tests/hooks.test.ts.skip tests/hooks.test.ts
  bun test
  ```

Priority: Urgent
Estimate: 1h
Labels: ["test", "quick-win"]
Status: Todo
Assignee: @claude
Due Date: 2026-01-13
```

---

#### **Task 1.2: 创建测试工具库**
```yaml
Title: "创建测试工具库 (fixtures, helpers, mocks)"
Description: |
  创建可复用的测试工具库，包括测试数据fixtures、辅助函数和Mock工具

  **交付物**:
  - src/shared/testing/fixtures.ts
  - src/shared/testing/helpers.ts
  - tests/shared/mocking.ts

  **关键功能**:
  - KPI_FIXTURES: 测试用的KPI数据
  - waitForLoading: 等待loading状态的辅助函数
  - mockDuckDBClient: DuckDB客户端的Mock工具

Priority: High
Estimate: 4h
Labels: ["test", "infrastructure"]
Parent: "Week 1: 测试基础设施"
Status: Todo
Assignee: @claude
Due Date: 2026-01-14
```

---

#### **Task 1.3: 核心模块契约测试框架**
```yaml
Title: "为3个核心模块创建契约测试框架"
Description: |
  为关键SQL生成器和Hooks创建契约测试，定义输入输出的正式契约

  **范围**:
  - src/shared/sql/kpi.contract.ts
  - src/shared/normalize/mapping.contract.ts
  - src/shared/hooks/useDataFetch.contract.ts

  **验收标准**:
  - 每个模块至少5个契约测试用例
  - 契约测试验证输入输出的类型和值
  - bun test contracts 全部通过

Priority: Urgent
Estimate: 8h
Labels: ["test", "contract"]
Parent: "Week 1: 测试基础设施"
Status: Todo
Assignee: @claude
Due Date: 2026-01-15
```

---

#### **Task 1.4: CI/CD测试集成**
```yaml
Title: "在CI/CD中集成自动化测试"
Description: |
  创建GitHub Actions工作流，在push和PR时自动运行测试并生成覆盖率报告

  **交付物**:
  - .github/workflows/test.yml

  **验收标准**:
  - Push到main时自动运行测试
  - PR时显示测试结果和覆盖率
  - 覆盖率报告上传到Codecov

Priority: High
Estimate: 2h
Labels: ["cicd", "test"]
Parent: "Week 1: 测试基础设施"
Status: Todo
Assignee: @claude
Due Date: 2026-01-16
```

---

### **Week 2: 核心模块测试**

#### **Task 2.1: SQL生成器测试**
```yaml
Title: "为SQL生成器模块编写完整单元测试"
Description: |
  为kpi.ts, trend.ts, truck.ts编写全面的单元测试，达到80%+覆盖率

  **范围**:
  - tests/sql/kpi.test.ts
  - tests/sql/trend.test.ts
  - tests/sql/truck.test.ts

  **测试用例**:
  - 基础查询生成
  - 各种筛选器组合
  - 边界情况（空值、特殊字符）
  - 性能测试（< 100ms）

  **验收标准**:
  - 每个文件至少15个测试用例
  - 覆盖率 ≥ 80%
  - 所有测试通过

Priority: Urgent
Estimate: 12h
Labels: ["test", "sql"]
Parent: "Week 2: 核心模块测试"
Status: Todo
Assignee: @claude
Due Date: 2026-01-20
```

---

#### **Task 2.2: Hooks单元测试**
```yaml
Title: "为Hooks编写完整单元测试"
Description: |
  使用@testing-library/react-hooks为useDataFetch和useLoadingStates编写测试

  **范围**:
  - tests/hooks/useDataFetch.test.ts
  - tests/hooks/useLoadingStates.test.ts

  **测试场景**:
  - 初始状态验证
  - 成功数据获取
  - 错误处理
  - 回调函数触发
  - 状态重置
  - 重复调用

  **验收标准**:
  - 每个Hook至少8个测试用例
  - 覆盖率 ≥ 80%
  - 正确使用renderHook, waitFor等API

Priority: High
Estimate: 8h
Labels: ["test", "hooks"]
Parent: "Week 2: 核心模块测试"
Status: Todo
Assignee: @claude
Due Date: 2026-01-21
```

---

#### **Task 2.3: 数据规范化测试**
```yaml
Title: "扩展数据规范化模块的单元测试"
Description: |
  为mapping.ts和validator.ts补充完整的单元测试

  **范围**:
  - tests/normalize/mapping.test.ts (扩展)
  - tests/normalize/validator.test.ts (扩展)

  **新增测试**:
  - 多别名解析
  - 边界值验证
  - 错误消息准确性
  - 类型推断正确性

  **验收标准**:
  - 覆盖率 ≥ 80%
  - 所有边界情况覆盖

Priority: High
Estimate: 6h
Labels: ["test", "normalize"]
Parent: "Week 2: 核心模块测试"
Status: Todo
Assignee: @claude
Due Date: 2026-01-22
```

---

#### **Task 2.4: 测试覆盖率监控**
```yaml
Title: "配置测试覆盖率阈值和报告"
Description: |
  在vitest.config.ts中配置覆盖率阈值，并生成可视化报告

  **配置项**:
  - 覆盖率阈值: lines 70%, functions 70%, branches 70%
  - 报告格式: text, json, html
  - 失败策略: 低于阈值时测试失败

  **验收标准**:
  - vitest.config.ts 配置完成
  - bun test --coverage 生成报告
  - README.md 添加覆盖率徽章

Priority: Medium
Estimate: 2h
Labels: ["test", "configuration"]
Parent: "Week 2: 核心模块测试"
Status: Todo
Assignee: @claude
Due Date: 2026-01-23
```

---

### **Week 3: 类型安全 + 日志系统**

#### **Task 3.1: 类型强化工具**
```yaml
Title: "开发自动类型强化工具"
Description: |
  创建自动化脚本，智能推断并替换any类型为具体类型

  **功能**:
  - 扫描src/目录下所有any使用
  - 从上下文推断类型（函数签名、赋值、导入）
  - 自动替换为具体类型或unknown
  - 生成类型强化报告

  **交付物**:
  - scripts/tighten-types.mjs

  **验收标准**:
  - 可执行脚本
  - 推断准确率 ≥ 70%
  - 生成before/after对比报告

Priority: High
Estimate: 6h
Labels: ["tool", "typescript"]
Parent: "Week 3: 类型安全+日志"
Status: Todo
Assignee: @claude
Due Date: 2026-01-27
```

---

#### **Task 3.2: 手动清理核心模块any**
```yaml
Title: "手动清理核心模块的any类型"
Description: |
  在工具辅助下，手动清理核心模块的any类型，达到零any目标

  **范围**:
  - src/shared/hooks/
  - src/shared/utils/
  - src/shared/sql/

  **验收标准**:
  - 上述目录零any
  - TypeScript编译无错误
  - 所有类型定义准确

Priority: Urgent
Estimate: 8h
Labels: ["typescript", "refactor"]
Parent: "Week 3: 类型安全+日志"
Status: Todo
Assignee: @claude
Due Date: 2026-01-28
```

---

#### **Task 3.3: 日志迁移工具**
```yaml
Title: "开发日志迁移自动化工具"
Description: |
  创建脚本自动将console.log迁移到logger，包括导入语句和级别推断

  **功能**:
  - 扫描console.*调用
  - 根据上下文推断日志级别
  - 自动添加logger导入
  - 替换为logger.debug/info/warn/error

  **交付物**:
  - scripts/migrate-logs.mjs

  **验收标准**:
  - 可执行脚本
  - 迁移准确率 ≥ 95%
  - 保留关键error日志

Priority: High
Estimate: 4h
Labels: ["tool", "logging"]
Parent: "Week 3: 类型安全+日志"
Status: Todo
Assignee: @claude
Due Date: 2026-01-29
```

---

#### **Task 3.4: 手动迁移核心模块日志**
```yaml
Title: "手动迁移核心模块的console.log"
Description: |
  在工具辅助下，手动迁移核心模块的日志，评估每个console的必要性

  **范围**:
  - src/shared/
  - src/services/

  **验收标准**:
  - 上述目录零console.log
  - 保留关键error日志
  - 日志级别正确使用

Priority: High
Estimate: 4h
Labels: ["logging", "refactor"]
Parent: "Week 3: 类型安全+日志"
Status: Todo
Assignee: @claude
Due Date: 2026-01-30
```

---

### **Week 4: CI/CD门禁 + 收尾**

#### **Task 4.1: CI/CD质量门禁**
```yaml
Title: "实现CI/CD质量门禁机制"
Description: |
  在PR时自动检查覆盖率、any数量、console.log数量，阻止质量下降

  **检查项**:
  - 测试覆盖率不能下降
  - any类型数量不能增加
  - console.log数量不能增加

  **交付物**:
  - .github/workflows/quality-gate.yml

  **验收标准**:
  - 质量下降时PR无法合并
  - 显示清晰的错误信息
  - 提供改进建议

Priority: Urgent
Estimate: 4h
Labels: ["cicd", "quality-gate"]
Parent: "Week 4: CI/CD门禁"
Status: Todo
Assignee: @claude
Due Date: 2026-02-03
```

---

#### **Task 4.2: 补充测试覆盖**
```yaml
Title: "补充剩余模块的测试覆盖"
Description: |
  为UI组件、Edge cases、Error handling编写测试，达到60%+总覆盖率

  **范围**:
  - UI组件集成测试
  - 边界情况测试
  - 错误处理测试

  **验收标准**:
  - 总覆盖率 ≥ 60%
  - 所有关键路径有测试
  - 错误场景有覆盖

Priority: High
Estimate: 12h
Labels: ["test", "ui"]
Parent: "Week 4: CI/CD门禁"
Status: Todo
Assignee: @claude
Due Date: 2026-02-04
```

---

#### **Task 4.3: 最终清理**
```yaml
Title: "最终清理和收尾"
Description: |
  对剩余的any和console.log进行最终处理，更新文档

  **工作内容**:
  - 剩余any添加@ts-ignore注释和说明
  - 评估剩余console.log的必要性
  - 更新INDEX.md和README.md
  - 创建质量改进总结文档

  **验收标准**:
  - 所有any都有注释说明
  - 所有console.log都有合理理由
  - 文档更新完成

Priority: Medium
Estimate: 4h
Labels: ["documentation", "cleanup"]
Parent: "Week 4: CI/CD门禁"
Status: Todo
Assignee: @claude
Due Date: 2026-02-05
```

---

#### **Task 4.4: 代码质量报告更新**
```yaml
Title: "生成最终代码质量报告"
Description: |
  对比实施前后的指标，总结改进经验，生成最终质量报告

  **内容**:
  - Before/After指标对比
  - 改进经验总结
  - 遇到的挑战和解决方案
  - 后续维护建议

  **交付物**:
  - 开发文档/reviews/2026-02-07-quality-report.md

  **验收标准**:
  - 包含完整的指标对比
  - 有可复用的经验总结
  - 有清晰的后续计划

Priority: Medium
Estimate: 2h
Labels: ["documentation", "report"]
Parent: "Week 4: CI/CD门禁"
Status: Todo
Assignee: @claude
Due Date: 2026-02-07
```

---

## 📊 项目进度追踪

### **里程碑**
```yaml
Milestone 1: 测试基础设施完成
  Due Date: 2026-01-17
  Tasks: [1.1, 1.2, 1.3, 1.4]
  Success Criteria: 测试覆盖率 20%+

Milestone 2: 核心模块测试完成
  Due Date: 2026-01-24
  Tasks: [2.1, 2.2, 2.3, 2.4]
  Success Criteria: 测试覆盖率 40%+

Milestone 3: 类型安全+日志完成
  Due Date: 2026-01-31
  Tasks: [3.1, 3.2, 3.3, 3.4]
  Success Criteria: any减少50%, console.log减少50%

Milestone 4: CI/CD门禁上线
  Due Date: 2026-02-07
  Tasks: [4.1, 4.2, 4.3, 4.4]
  Success Criteria: 测试覆盖率60%+, 质量门禁生效
```

---

## 🔧 Linear集成说明

### **如何导入到Linear**

1. **手动创建**:
   - 访问 https://linear.app
   - 创建新Team: "Code Quality"
   - 创建新Project: "Quality Improvement Q1 2026"
   - 逐个创建上述任务

2. **使用CLI** (推荐):
   ```bash
   # 安装Linear CLI
   npm install -g @linear/cli

   # 登录
   linear login

   # 创建项目
   linear project create \
     --name "Quality Improvement Q1 2026" \
     --description "4周代码质量提升计划"

   # 批量创建任务
   linear issue create --batch-file linear-tasks.json
   ```

3. **CSV导入**:
   - 将上述YAML格式转换为CSV
   - 使用Linear的CSV导入功能

### **字段映射**

| Linear字段 | 本文档字段 | 说明 |
|-----------|-----------|------|
| Title | Title | 任务标题 |
| Description | Description | 任务描述 |
| Priority | Priority | 优先级 (Urgent/High/Medium/Low) |
| Estimate | Estimate | 预估工时 |
| Labels | Labels | 标签 |
| Parent | Parent | 父任务 |
| Due Date | Due Date | 截止日期 |
| Assignee | Assignee | 负责人 |
| Status | Status | 状态 (Todo/In Progress/Done) |

---

## 📋 每周Checklist模板

```markdown
## Week X Checklist (日期范围)

### 完成的任务
- [ ] Task X.X: [任务名称]
- [ ] Task X.Y: [任务名称]

### 指标追踪
- 测试覆盖率: XX% (目标: XX%)
- any数量: XX (目标: XX)
- console.log数量: XX (目标: XX)
- 新增测试: XX 个

### 遇到的问题
1. [问题描述]
   - 影响: [高/中/低]
   - 解决方案: [方案]

### 下周计划
- [ ] Task Y.X: [任务名称]
- [ ] Task Y.Y: [任务名称]
```

---

**导出日期**: 2026-01-10
**版本**: v1.0
**任务总数**: 16
**预估总工时**: 90小时
**建议团队规模**: 1-2人
