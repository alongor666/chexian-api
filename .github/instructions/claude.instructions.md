---
description: Claude Code GitHub Actions 行为规范 - PR 中 @claude 标记交互协议
applyTo: '**'
---

# Claude Code PR 交互规范

## 1. @claude 标记触发规则

### 触发方式
在 PR 或 Issue 评论中使用 `@claude` 标记，后接任务描述：

```
@claude 请帮我修复这个类型错误
@claude review 请审查这个 PR 的代码
@claude fix 请修复 lint 错误并提交
```

### 标准动词

| 动词 | 含义 | 示例 |
|------|------|------|
| `@claude` | 通用请求 | `@claude 解释这段代码的作用` |
| `@claude review` | 代码审查 | `@claude review 检查安全问题` |
| `@claude fix` | 修复问题 | `@claude fix 修复测试失败` |
| `@claude implement` | 实现功能 | `@claude implement 添加导出功能` |
| `@claude refactor` | 重构代码 | `@claude refactor 简化这个函数` |
| `@claude test` | 测试相关 | `@claude test 为这个模块添加测试` |
| `@claude docs` | 文档更新 | `@claude docs 更新 README` |

## 2. 回复格式规范

### 任务开始时
```markdown
🤖 **Claude Code 已接收任务**

**任务**: [任务描述]
**状态**: 进行中 🔄

正在分析代码...
```

### 任务完成时
```markdown
✅ **任务已完成**

**变更摘要**:
- [变更1]
- [变更2]

**验证结果**:
- 测试: ✅ 通过
- 构建: ✅ 通过
- 治理: ✅ 通过

**提交**: `abc1234` - commit message
```

### 需要澄清时
```markdown
❓ **需要更多信息**

在继续之前，请确认：
1. [问题1]?
2. [问题2]?

请在评论中回复，我将继续处理。
```

### 遇到阻塞时
```markdown
⚠️ **任务被阻塞**

**原因**: [阻塞原因]

**需要**:
- [需要的操作或信息]

请处理后重新 @claude 继续。
```

## 3. 会话移交协议（& 符号）

### 从本地移交到 Web
当本地 Claude Code 会话需要移交到 GitHub Actions 时：

1. 在本地终端输入 `&` 符号
2. Claude Code 会生成移交链接
3. 在 PR 评论中使用：
   ```
   @claude continue session_id=<session-id>

   请继续之前的任务：<任务描述>
   ```

### Session ID 格式
```
session_<timestamp>_<random>
例如: session_20260120_a1b2c3
```

## 4. --teleport 切换协议

### 从本地切换到云端
```bash
# 本地终端
claude --teleport

# 输出:
# 🚀 Teleporting session to GitHub Actions...
# Session ID: session_xxx
#
# To continue in GitHub Actions:
# @claude teleport session_id=session_xxx
```

### 从云端返回本地
```bash
# 在 PR 评论中
@claude teleport-back

# Claude 会回复:
# 📥 Session exported. Run locally:
# claude --resume session_xxx
```

## 5. 项目特定规则

### 必须遵守
- 使用 **Bun** 包管理器（禁止 npm/yarn）
- 修改代码后运行 `bun test`
- 提交前运行 `bun run governance`
- 遵循 CLAUDE.md §2.5 实现前检查协议

### 自动检查项
每次代码变更后自动执行：
1. `bun test` - 单元测试
2. `bun run build` - 类型检查 + 构建
3. `bun run governance` - 治理校验

### 安全限制
- 不修改 `src/shared/normalize/mapping.ts`（业务口径）
- 不修改 `src/shared/sql/kpi.ts`（KPI 计算逻辑）
- 不删除现有代码别名或 SQL 模板

## 6. 错误处理

### 测试失败
```markdown
❌ **测试失败**

```
[测试输出]
```

正在分析失败原因...

**修复计划**:
1. [步骤1]
2. [步骤2]

是否继续修复？请回复 `@claude fix` 确认。
```

### 构建失败
```markdown
❌ **构建失败**

**错误类型**: TypeScript 类型错误

**错误位置**: `src/xxx/xxx.ts:123`

**错误信息**:
```
[错误详情]
```

**建议修复**: [修复建议]
```

## 7. 最佳实践

### DO ✅
- 提供清晰的任务描述
- 分步骤说明复杂需求
- 指明相关文件路径
- 等待前一个任务完成再提新任务

### DON'T ❌
- 同时提交多个 @claude 请求
- 在任务进行中编辑同一文件
- 请求删除核心业务逻辑
- 要求跳过测试或治理检查

---

**版本**: 1.0.0
**更新日期**: 2026-01-20
**维护者**: Claude Code 配置
