# 会话管理 Subagent

## 🎯 用途

专门用于管理 Claude Code CLI 对话历史的智能助手，帮助用户高效地查看、搜索、重命名、批量管理和导出会话。

## 🚀 触发条件

当用户提出以下需求时，自动调用此 subagent：

1. **查看历史会话**：
   - "查看历史会话"
   - "显示所有会话"
   - "列出对话记录"

2. **搜索会话**：
   - "搜索关于 X 的会话"
   - "查找昨天关于 Y 的讨论"
   - "找到包含关键词 Z 的会话"

3. **重命名会话**：
   - "重命名会话"
   - "批量修改会话名称"
   - "给会话添加标题"

4. **删除会话**：
   - "删除旧会话"
   - "清理 X 天前的会话"
   - "批量删除会话"

5. **导出会话**：
   - "导出会话记录"
   - "备份重要对话"
   - "保存会话为 Markdown"

6. **会话统计**：
   - "查看会话统计"
   - "显示会话数量"
   - "分析会话数据"

## 💡 工作流程

### 步骤1：定位会话存储位置

首先确认会话存储目录是否存在：

```bash
bun run scripts/session-manager.mjs --locate
```

**如果目录不存在**：
1. 提示用户可能的原因
2. 建议手动创建目录
3. 提供诊断信息

### 步骤2：根据需求执行相应操作

#### 场景A：查看历史会话

```bash
# 列出所有会话
bun run scripts/session-manager.mjs --list

# 分页查看（每页20个）
bun run scripts/session-manager.mjs --list --page 2
```

#### 场景B：搜索会话

```bash
# 按关键词搜索
bun run scripts/session-manager.mjs --search "KPI分析"

# 按日期范围搜索
bun run scripts/session-manager.mjs --search "React" --date-from "2025-01-01" --date-to "2025-01-10"

# 按消息数量筛选
bun run scripts/session-manager.mjs --search "性能" --min-messages 10
```

#### 场景C：重命名会话

```bash
# 单个重命名
bun run scripts/session-manager.mjs --rename session-20250110-143052-abc123 --title "2025-01-10_KPI看板性能优化"

# 交互式重命名（逐个确认）
# 1. 先列出所有需要重命名的会话
bun run scripts/session-manager.mjs --list

# 2. 对每个会话执行重命名
bun run scripts/session-manager.mjs --rename <session-id> --title "新标题"
```

#### 场景D：删除会话

```bash
# 删除单个会话（会有确认提示）
bun run scripts/session-manager.mjs --delete session-20250110-143052-abc123

# 强制删除（跳过确认）
bun run scripts/session-manager.mjs --delete session-20250110-143052-abc123 --force
```

#### 场景E：导出会话

```bash
# 导出为 Markdown
bun run scripts/session-manager.mjs --export session-20250110-143052-abc123 --format markdown --output "会话记录.md"

# 导出为 JSON
bun run scripts/session-manager.mjs --export session-20250110-143052-abc123 --format json --output "session.json"
```

#### 场景F：查看统计

```bash
bun run scripts/session-manager.mjs --stats
```

## 📋 最佳实践

### 1. 定期备份

建议每周导出重要会话：

```bash
# 创建备份目录
mkdir -p ./会话备份/weekly

# 查找本周的会话并导出
bun run scripts/session-manager.mjs --date-from "$(date -v-7d +%Y-%m-%d)" --list
```

### 2. 会话命名规范

推荐使用以下格式：
- 日期 + 主题：`"2025-01-10_KPI看板性能优化"`
- 项目 + 功能：`"车险KPI_自然周计算实现"`
- 描述性标题：`"React组件重构-优化渲染性能"`

### 3. 批量操作前预览

在执行批量删除或重命名前，先列出所有会话：

```bash
# 1. 列出所有会话
bun run scripts/session-manager.mjs --list

# 2. 筛选需要操作的会话
bun run scripts/session-manager.mjs --search "关键词"

# 3. 逐个执行操作
bun run scripts/session-manager.mjs --rename <id> --title "新标题"
```

### 4. 清理旧会话

建议每月清理一次：

```bash
# 1. 查看旧的会话
bun run scripts/session-manager.mjs --date-to "2024-12-01" --list

# 2. 导出重要的会话
bun run scripts/session-manager.mjs --export <id> --output "备份.md"

# 3. 删除不重要的会话
bun run scripts/session-manager.mjs --delete <id> --force
```

## ⚠️ 注意事项

### 1. 删除操作不可恢复

删除会话前请务必：
- 确认会话内容不再需要
- 导出重要会话作为备份
- 使用 `--detail` 查看会话详情后再删除

### 2. 会话目录位置

不同操作系统的会话存储位置：
- **macOS**: `~/Library/Application Support/Claude Code/sessions/`
- **Linux**: `~/.local/share/claude-code/sessions/`
- **Windows**: `%APPDATA%\Claude Code\sessions\`

### 3. 文件格式

每个会话是独立的 JSON 文件，包含：
- 会话 ID
- 标题
- 创建和修改时间
- 消息列表（用户和助手的对话）
- 元数据（模型、token 数量等）

### 4. 权限问题

如果遇到权限问题：
```bash
# 检查目录权限
ls -la ~/Library/Application\ Support/Claude\ Code/sessions/

# 修改权限（如果需要）
chmod 755 ~/Library/Application\ Support/Claude\ Code/sessions/
```

## 🔧 故障排除

### 问题1：找不到会话目录

**症状**：`--locate` 显示目录不存在

**原因**：
1. 从未使用 Claude Code CLI 创建过会话
2. 会话存储在其他位置
3. 目录被删除

**解决方案**：
```bash
# 1. 手动创建目录
mkdir -p ~/Library/Application\ Support/Claude\ Code/sessions/

# 2. 检查 Claude Code 配置
cat ~/.claude/settings.json | jq .
```

### 问题2：无法读取会话文件

**症状**：显示 "读取会话文件失败"

**解决方案**：
```bash
# 检查文件权限
ls -l ~/Library/Application\ Support/Claude\ Code/sessions/

# 如果权限不足，修改权限
chmod 644 ~/Library/Application\ Support/Claude\ Code/sessions/*.json
```

### 问题3：导出的文件乱码

**症状**：Markdown 或 JSON 文件包含乱码

**解决方案**：
1. 使用支持 UTF-8 的编辑器打开
2. 检查终端编码设置：`echo $LANG`
3. 使用 VS Code 或其他现代编辑器

## 📚 相关资源

- **命令文档**：[.claude/commands/session-manager.md](.claude/commands/session-manager.md)
- **使用指南**：[开发文档/会话管理器使用指南.md](开发文档/会话管理器使用指南.md)
- **实现代码**：[scripts/session-manager.mjs](scripts/session-manager.mjs)

## 🎓 使用示例

### 示例1：查找昨天关于某个功能的讨论

```bash
# 1. 搜索昨天的会话
bun run scripts/session-manager.mjs --search "自然周" --date-from "2025-01-09" --date-to "2025-01-09"

# 2. 查看详情
bun run scripts/session-manager.mjs --detail <session-id>

# 3. 导出备份
bun run scripts/session-manager.mjs --export <session-id> --output "自然周讨论.md"
```

### 示例2：批量重命名会话（添加项目前缀）

```bash
# 1. 列出所有会话
bun run scripts/session-manager.mjs --list

# 2. 对每个需要重命名的会话执行
bun run scripts/session-manager.mjs --rename session-xxx --title "车险KPI_原标题"

# 3. 验证结果
bun run scripts/session-manager.mjs --list
```

### 示例3：清理30天前的会话

```bash
# 1. 查看旧会话
bun run scripts/session-manager.mjs --date-to "2024-12-11" --list

# 2. 导出重要会话
bun run scripts/session-manager.mjs --export <id> --output "备份.md"

# 3. 删除不重要的会话
bun run scripts/session-manager.mjs --delete <id> --force
```

## 🔄 未来改进

计划添加的功能：
- [ ] 批量重命名（支持正则表达式）
- [ ] 交互式重命名模式
- [ ] 按条件批量删除
- [ ] 会话标签和分类
- [ ] 会话合并功能
- [ ] 导出为 PDF
- [ ] 会话搜索的高级过滤选项
- [ ] 会话相似度分析
- [ ] 自动归档旧会话
