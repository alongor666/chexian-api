---
name: session-manager
description: 管理 Claude Code CLI 对话历史（查看、搜索、重命名、导出）
category: development-tools
version: 1.0.0
author: "@claude"
tags: [session, history, management, export, search]
scope: global
requires:
  - bun
dependencies:
  - scripts/session-manager.mjs
  - .claude/subagents/session-manager.md
last_updated: "2026-01-11"
---

# 会话管理器 (Session Manager)

## 📋 功能概述

专门用于管理 Claude Code CLI 对话历史的技能，提供查看、搜索、重命名、批量管理和导出会话的完整功能。

## 🎯 核心功能

### 1. 查找会话存储位置
自动检测 Claude Code 会话数据的存储位置（支持跨平台）：
- **macOS**: `~/Library/Application Support/Claude Code/sessions/`
- **Linux**: `~/.local/share/claude-code/sessions/`
- **Windows**: `%APPDATA%\Claude Code\sessions\`

### 2. 列出历史会话
```bash
/session-manager --list
```
**功能**：
- 显示所有历史会话
- 包含会话 ID、创建时间、最后修改时间、消息数量
- 按时间倒序排列（最新的在前）
- 支持分页显示（每页 20 个）

**输出格式**：
```
📚 历史会话列表（共 45 个）

[1] session-20250110-143052-abc123
    📅 创建: 2025-01-10 14:30:52
    🕒 最后修改: 2025-01-10 16:45:23
    💬 消息数: 42
    🏷️  标题: 车险KPI数据分析和可视化优化

[2] session-20250109-091534-def456
    📅 创建: 2025-01-09 09:15:34
    🕒 最后修改: 2025-01-09 18:20:11
    💬 消息数: 28
    🏷️  标题: React组件性能优化

...

显示第 1-20 个，输入 n 查看下一页
```

### 3. 查看会话详情
```bash
/session-manager --detail <session-id>
```
**功能**：
- 显示完整会话信息
- 包含所有对话内容
- 显示时间戳、用户消息、助手回复
- 代码高亮显示

### 4. 搜索会话
```bash
# 按关键词搜索
/session-manager --search "KPI分析"

# 按日期范围搜索
/session-manager --date-from "2025-01-01" --date-to "2025-01-10"

# 按消息数量筛选
/session-manager --min-messages 20

# 组合搜索
/session-manager --search "React" --date-from "2025-01-05" --min-messages 10
```

### 5. 重命名会话
```bash
# 重命名单个会话
/session-manager --rename <session-id> --title "新标题"

# 批量重命名（支持正则表达式）
/session-manager --batch-rename --pattern "session-(\d+)" --template "备份会话_$1"

# 交互式重命名
/session-manager --interactive-rename
# 逐个询问是否重命名，支持预览和确认
```

### 6. 删除会话
```bash
# 删除单个会话（需要确认）
/session-manager --delete <session-id>

# 批量删除（需要确认）
/session-manager --batch-delete --ids "id1,id2,id3"

# 按条件删除
/session-manager --delete-before "2025-01-01"  # 删除指定日期之前的会话
```

### 7. 导出会话
```bash
# 导出为 Markdown
/session-manager --export <session-id> --format markdown --output "会话记录.md"

# 导出为 JSON
/session-manager --export <session-id> --format json --output "session.json"

# 批量导出
/session-manager --export-all --format markdown --output-dir "./exports/"
```

### 8. 会话统计
```bash
/session-manager --stats
```
**输出**：
```
📊 会话统计信息

总会话数: 45
本月新增: 12
本周新增: 3
今日新增: 1

平均消息数: 32.5
最活跃会话: 89 条消息
最常讨论话题: 车险KPI分析 (8个会话)

存储空间占用: 15.3 MB
```

## 🔧 使用场景

### 场景1：查找昨天关于某个功能的讨论
```bash
/session-manager --search "自然周计算" --date-from "2025-01-09" --date-to "2025-01-09"
```

### 场景2：批量重命名会话（添加项目前缀）
```bash
/session-manager --batch-rename --pattern "(.+)" --template "车险KPI_$1"
```

### 场景3：清理30天前的会话
```bash
/session-manager --delete-before "$(date -v-30d +%Y-%m-%d)"
```

### 场景4：导出重要会话备份
```bash
/session-manager --search "架构设计" --export-all --format markdown --output-dir "./重要会话备份/"
```

## 💡 最佳实践

### 1. 定期备份
建议每周导出重要会话：
```bash
# 每周日凌晨自动备份最近7天的会话
session-manager --date-from "$(date -v-7d +%Y-%m-%d)" --export-all --format markdown --output-dir "./backups/weekly/"
```

### 2. 会话命名规范
- 使用描述性标题：`"2025-01-10_KPI看板性能优化"`
- 包含日期和主题
- 避免特殊字符

### 3. 批量操作前预览
所有批量操作都支持 `--dry-run` 参数：
```bash
/session-manager --batch-rename --pattern "(.+)" --template "[备份]$1" --dry-run
```

## ⚠️ 安全注意事项

1. **删除操作不可恢复**：删除会话前会要求二次确认
2. **敏感信息过滤**：导出前会扫描并警告包含敏感信息的会话
3. **权限保护**：会话文件权限设为 600（仅所有者可读写）

## 🔍 技术实现

### 会话文件格式
```json
{
  "sessionId": "session-20250110-143052-abc123",
  "title": "会话标题",
  "createdAt": "2025-01-10T14:30:52Z",
  "updatedAt": "2025-01-10T16:45:23Z",
  "messages": [
    {
      "role": "user",
      "content": "用户消息内容",
      "timestamp": "2025-01-10T14:31:00Z"
    },
    {
      "role": "assistant",
      "content": "助手回复内容",
      "timestamp": "2025-01-10T14:31:15Z"
    }
  ],
  "metadata": {
    "model": "claude-sonnet-4-5",
    "contextTokens": 150000,
    "projectId": "/path/to/project"
  }
}
```

### 依赖工具
- `jq`: JSON 处理
- `find`: 文件查找
- `grep`: 内容搜索
- `ripgrep` (可选): 更快的搜索

## 📝 示例输出

### 交互式重命名流程
```
🔄 交互式重命名模式

[1/45] session-20250110-143052-abc123
    当前标题: 车险KPI数据分析和可视化优化
    是否重命名? (y/n/s/k/q) y
    新标题: 2025-01-10_KPI看板性能优化

    ✅ 已重命名为: 2025-01-10_KPI看板性能优化

[2/45] session-20250109-091534-def456
    当前标题: React组件性能优化
    是否重命名? (y/n/s/k/q) n
    ⏭️  跳过

[3/45] session-20250108-153420-ghi789
    当前标题: (无标题)
    是否重命名? (y/n/s/k/q) y
    新标题: 2025-01-08_自然周计算实现

    ✅ 已重命名为: 2025-01-08_自然周计算实现

操作汇总:
  ✅ 重命名: 2 个
  ⏭️  跳过: 1 个
  ⏸️  剩余: 42 个

输入 c 继续, q 退出:
```

## 🚀 快速开始

### 首次使用
```bash
# 1. 检查会话存储位置
/session-manager --locate

# 2. 列出所有会话
/session-manager --list

# 3. 查看统计信息
/session-manager --stats
```

### 常用命令组合
```bash
# 查找最近7天关于某个主题的会话并导出
/session-manager --search "主题" --date-from "$(date -v-7d +%Y-%m-%d)" --export-all --output-dir "./exports/"

# 批量重命名所有无标题的会话
/session-manager --batch-rename --pattern "^无标题$" --template "会话_$(date +%Y%m%d)"
```

## 📚 相关文档

- Claude Code 官方文档: https://docs.anthropic.com/claude-code
- 会话数据格式规范: 参考 Claude Code 源码中的 session schema
