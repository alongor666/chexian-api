# Claude Code 工作流使用指南

本项目已集成 Claude Code 工作流，提供自动化命令、AI子代理和MCP服务器集成。

---

## 🚀 快速开始

### 1. 可用的 Slash Commands

在 Claude Code CLI 中，可以使用以下命令：

#### `/commit-push-pr` - Git 工作流自动化
自动生成语义化 commit message，提交代码并创建 PR。

```bash
# 使用示例
/commit-push-pr
```

**功能**：
- ✅ 分析代码变更
- ✅ 生成符合规范的 commit message
- ✅ 执行 git add, commit, push
- ✅ 使用 gh CLI 创建 Pull Request

---

#### `/data-analysis` - 车险数据分析
对已加载的 test_data.parquet 执行深度分析。

```bash
# 基础分析
/data-analysis

# 指定维度
/data-analysis --dimensions 机构,业务员

# 指定时间范围
/data-analysis --start 2025-01-01 --end 2025-12-31
```

**功能**：
- 📊 数据探索性分析 (EDA)
- 📈 业绩排名分析（Top业务员、Top机构）
- 📅 时间趋势分析（月度/环比）
- 🎯 四象限分析（业务员分类）
- 🔄 续保率分析
- 🔋 新能源车险分析
- ⚠️ 异常值检测

**输出**：
- Markdown 分析报告
- 可复制的 SQL 查询语句
- 浏览器控制台可执行的代码

---

#### `/weekly-report` - 周报生成
生成董事会级别的车险业务周报。

```bash
# 生成全年报告
/weekly-report

# 生成特定周报告
/weekly-report week 50

# 指定时间范围
/weekly-report 2025-12-01 2025-12-31
```

**功能**：
- 📊 16个核心KPI计算
- 🏢 机构业绩排名
- 👥 Top 20 业务员分析
- 🔄 续保情况分析
- 🔋 新能源业务分析
- 📅 时间趋势分析
- ⚠️ 风险提示
- 💡 改进建议

**输出**：
- 完整的 Markdown 报告（12个章节）
- SQL 查询集合
- 数据表格（Markdown table 格式）

---

#### `/security-review` - 代码安全审查
对代码进行全面的安全审查。

```bash
# 审查所有变更文件
/security-review

# 审查特定文件
/security-review src/api
/security-review src/utils/data_loader.py
```

**检查项**：
- 🔒 数据安全（敏感数据、API密钥）
- 🛡️ SQL注入防护
- 🔐 身份认证与授权
- 📁 文件操作安全
- 🌐 API安全（速率限制、CORS）
- 📦 依赖包安全（使用 `bun audit`）
- 🔑 加密与哈希
- ✅ 数据验证
- ⚠️ 错误处理
- 🖥️ 前端安全（XSS、CSRF）

**输出**：
- 详细的安全审查报告
- 问题清单（高/中/低危）
- 修复建议和代码示例
- 合规性评分

---

#### `/init-project` - 项目初始化
为新项目生成完整的 Claude Code 工作流配置（仅供参考）。

---

### 2. 可用的 Subagents

在需要时，Claude Code 会自动调用以下专业子代理：

#### `data-validator` - 数据质量验证专家
- 验证数据完整性
- 检查数据类型
- 识别异常值
- 生成数据质量报告

#### `code-simplifier` - 代码重构专家
- 简化复杂代码
- 移除冗余逻辑
- 优化性能
- 提高可读性

#### `verify-app` - 应用验证专家
- 端到端测试
- 功能验证
- 性能检查
- 错误排查

---

### 3. MCP 服务器集成

项目已配置以下 MCP 服务器（在 `.mcp.json` 中）：

#### GitHub MCP
**功能**：
- 创建 Issue 和 PR
- 搜索仓库
- 读取/更新文件
- 列出 Issues

**环境变量**：
```bash
export GITHUB_TOKEN="your_github_token"
```

#### Puppeteer MCP
**功能**：
- 浏览器自动化
- UI 测试
- 截图
- 页面交互（navigate, click, fill）

**用途**：自动测试 dashboard 功能（http://localhost:5175/）

#### Filesystem MCP
**功能**：
- 文件读写
- 目录操作
- 文件搜索
- 文件移动

---

## 📋 使用场景

### 场景1：完成功能开发后提交代码
```bash
# 1. 查看变更
git status

# 2. 使用 Claude Code
/commit-push-pr

# Claude 会：
# - 分析你的变更
# - 生成 commit message
# - 提交并推送代码
# - 创建 Pull Request
```

---

### 场景2：分析业务数据
```bash
# 1. 启动开发服务器
bun run dev

# 2. 在浏览器打开 http://localhost:5175/
# 3. 上传 test_data.parquet

# 4. 使用 Claude Code
/data-analysis

# Claude 会：
# - 执行 EDA 分析
# - 生成业绩排名
# - 识别异常值
# - 输出 Markdown 报告
```

---

### 场景3：生成周报
```bash
# 确保数据已加载后
/weekly-report

# Claude 会：
# - 计算所有 KPI
# - 生成 12 章节报告
# - 提供 SQL 查询集合
# - 输出 Markdown 格式报告
```

---

### 场景4：代码安全审查
```bash
# 在提交代码前
/security-review

# Claude 会：
# - 扫描安全漏洞
# - 检查依赖包（bun audit）
# - 生成安全报告
# - 提供修复建议
```

---

## 🔧 配置说明

### `.claude/settings.local.json`
项目的 Claude Code 配置文件，包含：

- **自动允许的命令**（autoAllow）:
  ```json
  ["git add", "git commit", "bun install", "bun run dev", "bun test"]
  ```

- **禁止的命令**（alwaysDeny）:
  ```json
  ["rm -rf /", "sudo rm", "dd if=", "mkfs"]
  ```

- **Hooks**:
  - `postToolUse`: 自动格式化代码
  - `preCommit`: 提交前检查代码质量

- **模型配置**:
  - 默认模型: opus-4-5
  - 启用思考模式: true

---

### `.mcp.json`
MCP 服务器配置，定义了可用的外部工具集成。

**已启用服务器**：
- `github`: GitHub API 集成
- `puppeteer`: 浏览器自动化
- `filesystem`: 文件系统访问

---

## 📝 命令文件位置

所有命令定义在 `.claude/commands/` 目录：

```
.claude/
├── commands/
│   ├── commit-push-pr.md      # Git 工作流
│   ├── data-analysis.md       # 数据分析
│   ├── weekly-report.md       # 周报生成
│   ├── security-review.md     # 安全审查
│   └── init-project.md        # 项目初始化（参考）
├── subagents/
│   ├── data-validator.md      # 数据验证代理
│   ├── code-simplifier.md     # 代码简化代理
│   └── verify-app.md          # 应用验证代理
└── settings.local.json        # Claude Code 配置
```

---

## 🎯 最佳实践

### 1. 提交代码
- ✅ 使用 `/commit-push-pr` 自动化 Git 工作流
- ✅ Commit message 遵循 `<type>(<scope>): <subject>` 格式
- ✅ 提交前自动运行 lint 和 format

### 2. 数据分析
- ✅ 先在浏览器加载数据，再执行分析命令
- ✅ 使用 `/data-analysis` 快速生成洞察
- ✅ SQL 查询可复制到浏览器控制台验证

### 3. 安全审查
- ✅ 提交代码前运行 `/security-review`
- ✅ 定期检查依赖包安全（bun audit）
- ✅ 修复高危问题后再部署

### 4. 周报生成
- ✅ 使用 `/weekly-report` 自动生成报告
- ✅ Markdown 格式便于编辑和分享
- ✅ 可将 SQL 查询保存为文档

---

## 🔍 调试技巧

### 查看 Claude Code 日志
日志文件位置：`.claude/logs/claude-code.log`

### 验证 MCP 服务器连接
```bash
# 检查 GitHub MCP
echo $GITHUB_TOKEN

# 测试 Puppeteer MCP
# 启动 dev server 后，Puppeteer 可自动打开浏览器
```

### 测试 Slash Command
在 Claude Code CLI 中直接输入：
```bash
/data-analysis
```

---

## 📚 更多资源

- **项目文档**: `CLAUDE.md` - 项目上下文和开发规范
- **测试指南**: `TESTING_GUIDE.md` - 测试步骤和预期结果
- **代理说明**: `AGENTS.md` - AI代理使用说明
- **技术架构**: `README.md` - 项目架构和技术栈

---

## 🆘 常见问题

### Q: 如何启用 GitHub MCP？
A: 设置环境变量 `GITHUB_TOKEN`
```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

### Q: Slash Command 不工作？
A: 确保：
1. 在 Claude Code CLI 中执行
2. 命令文件在 `.claude/commands/` 目录
3. 命令文件格式正确（Markdown）

### Q: 数据分析报告为空？
A: 确保：
1. 已在浏览器加载 test_data.parquet
2. DuckDB-WASM 已初始化
3. PolicyFact 视图可查询

### Q: 如何自定义 Slash Command？
A: 在 `.claude/commands/` 创建新的 Markdown 文件，参考现有命令格式。

---

**版本**: 1.0.0
**最后更新**: 2026-01-07
**维护者**: Alongor

