---
name: init-project
description: 为新项目生成完整的 Claude Code 工作流配置
category: project-setup
version: 1.0.0
author: "@claude"
tags: [initialization, setup, template, scaffolding]
scope: global
requires:
  - git
dependencies: []
last_updated: "2026-01-11"
---

# 项目初始化

为新项目或现有项目生成完整的 Claude Code 工作流配置。

---

## 功能

自动生成以下内容：
1. CLAUDE.md 项目文档
2. .claude/commands/ 自定义命令
3. .claude/agents/ AI 子代理
4. .claude/settings.json 配置
5. .mcp.json MCP 服务器配置
6. Git hooks
7. CI/CD 配置模板

---

## 交互式配置

### 1. 项目信息收集

询问用户以下问题：

**基础信息**：
- 项目名称：
- 项目描述：
- 项目类型（Web应用/数据分析/API服务/其他）：

**技术栈**：
- 后端语言（Python/Node.js/Java/其他）：
- 前端框架（React/Vue/None）：
- 数据库（PostgreSQL/MySQL/MongoDB/其他）：
- 包管理器（pnpm/npm/yarn/pip）：

**团队规模**：
- 开发人员数量：
- 是否需要 PR 模板：(Y/N)
- 代码审查流程：(简单/标准/严格)

**业务领域**（可选）：
- 行业（金融/医疗/电商/其他）：
- 特殊需求（合规/安全/性能）：

---

## 生成内容

### 1. CLAUDE.md 模板

根据项目类型生成定制的 CLAUDE.md：

**数据分析项目**：
- 数据格式规范
- 分析方法论
- 可视化标准
- 报告模板

**Web 应用**：
- API 规范
- 前端组件规范
- 状态管理规则
- 测试策略

**API 服务**：
- 接口设计原则
- 认证授权
- 错误处理
- 性能要求

### 2. Slash Commands

**通用命令**（所有项目）：
- `/chexian-commit-push-pr` - Git 工作流
- `/chexian-security-review` - 安全审查
- `/test` - 运行测试

**数据项目专用**：
- `/data-analysis` - 数据分析
- `/weekly-report` - 周报生成
- `/data-quality` - 数据质量检查

**Web 项目专用**：
- `/api-doc` - API 文档生成
- `/deploy` - 部署流程
- `/perf-test` - 性能测试

### 3. Subagents

**通用 Subagents**：
- `code-reviewer` - 代码审查
- `test-generator` - 测试生成
- `doc-writer` - 文档撰写

**专业 Subagents**（根据需求）：
- `data-validator` - 数据验证
- `security-auditor` - 安全审计
- `performance-optimizer` - 性能优化

### 4. .claude/settings.json

```json
{
  "permissions": {
    "autoAllow": [
      "git add",
      "git commit",
      "git push",
      "npm install",
      "pnpm install",
      "pip install --break-system-packages",
      "pytest",
      "edit"
    ]
  },
  "hooks": {
    "postToolUse": {
      "enabled": true,
      "script": "scripts/hooks/post-tool-use.sh"
    }
  },
  "models": {
    "default": "opus-4-5",
    "thinking": true
  }
}
```

### 5. .mcp.json 模板

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

### 6. Git Hooks

**pre-commit**:
```bash
#!/bin/bash
# 运行代码格式化
pnpm format

# 运行 linter
pnpm lint

# 运行测试
pnpm test
```

**commit-msg**:
```bash
#!/bin/bash
# 验证 commit message 格式
commit_msg=$(cat $1)

if ! echo "$commit_msg" | grep -qE "^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?: .+"; then
    echo "错误：commit message 格式不正确"
    echo "格式：<type>(<scope>): <subject>"
    exit 1
fi
```

---

## 执行流程

```plaintext
1. 收集项目信息（交互式问答）
   ↓
2. 检测现有配置（避免覆盖）
   ↓
3. 生成 CLAUDE.md
   ↓
4. 创建 .claude/ 目录结构
   ↓
5. 生成 slash commands
   ↓
6. 创建 subagents
   ↓
7. 配置 settings.json
   ↓
8. 生成 .mcp.json（如需要）
   ↓
9. 安装 Git hooks
   ↓
10. 生成 README（使用说明）
   ↓
11. 输出配置报告
```

---

## 输出报告

```markdown
# 项目初始化完成 ✅

## 生成的文件

### 核心配置
- [x] CLAUDE.md - 项目上下文文档
- [x] .claude/settings.json - Claude Code 配置

### Slash Commands (5个)
- [x] /chexian-commit-push-pr - Git 工作流自动化
- [x] /data-analysis - 数据分析
- [x] /weekly-report - 周报生成
- [x] /chexian-security-review - 安全审查
- [x] /test - 测试运行

### Subagents (3个)
- [x] data-validator - 数据质量验证
- [x] code-reviewer - 代码审查
- [x] test-generator - 测试生成

### 其他
- [x] .mcp.json - MCP 服务器配置
- [x] Git hooks - pre-commit, commit-msg
- [x] README-CLAUDE-CODE.md - 使用文档

## 快速开始

### 1. 验证安装
\```bash
# 启动 Claude Code
claude

# 测试 slash command
/help
\```

### 2. 配置 GitHub CLI
\```bash
gh auth login
\```

### 3. 设置环境变量
\```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置
vim .env
\```

### 4. 第一次提交
\```bash
claude
> /chexian-commit-push-pr
\```

## 下一步

1. **自定义 CLAUDE.md**
   - 添加项目特定的规范
   - 补充业务规则
   - 更新技术栈细节

2. **创建自定义命令**
   - 识别重复工作流
   - 创建新的 slash commands
   - 分享给团队

3. **配置 MCP 服务器**
   - 连接项目使用的外部工具
   - 配置认证信息
   - 测试连接

4. **团队协作**
   - 将配置签入 Git
   - 分享最佳实践
   - 建立 CLAUDE.md 更新机制

## 文档

详细使用说明见 `README-CLAUDE-CODE.md`

## 支持

遇到问题？
- 查看 CLAUDE.md 中的常见问题
- 运行 `/help` 查看可用命令
- 访问 https://docs.claude.com/code
```

---

## 示例对话

```
Claude: 欢迎使用项目初始化向导！我会帮你配置 Claude Code 工作流。

我需要了解一些项目信息：

1. 项目名称是什么？
用户: 车险数据分析系统

Claude: 2. 这是什么类型的项目？
A) Web 应用
B) 数据分析
C) API 服务
D) 其他
用户: B

Claude: 3. 使用的后端语言？
A) Python
B) Node.js
C) Java
D) 其他
用户: A

[继续问答...]

Claude: 好的！我现在开始生成配置...

[执行生成流程]

✅ 初始化完成！生成了 15 个文件。

接下来你可以：
1. 运行 `claude` 启动
2. 使用 `/help` 查看可用命令
3. 阅读 README-CLAUDE-CODE.md 了解详情
```

---

## 特殊处理

### 现有项目
- 检测现有配置，询问是否覆盖
- 合并模式：保留现有内容，添加新内容
- 备份模式：保存旧配置为 `*.backup`

### 团队项目
- 生成团队共享的配置
- 提供 onboarding 文档
- 创建贡献指南

### 单人项目
- 简化配置
- 减少不必要的流程
- 专注于效率工具

---

## 验证步骤

生成后自动验证：

1. **文件完整性**
   - 所有文件生成成功
   - 权限正确（执行脚本）
   - JSON 格式有效

2. **配置有效性**
   - settings.json 语法正确
   - MCP 配置有效
   - 命令可执行

3. **依赖检查**
   - 必需工具已安装（gh, git）
   - Python/Node 版本符合要求
   - 依赖包可访问

---

现在开始交互式初始化流程。

