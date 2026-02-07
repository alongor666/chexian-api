# 会话管理器 - 快速参考

## 🚀 一分钟上手

### 1️⃣ 查找会话存储位置
```bash
bun run scripts/session-manager.mjs --locate
```

### 2️⃣ 列出所有会话
```bash
bun run scripts/session-manager.mjs --list
```

### 3️⃣ 搜索会话
```bash
bun run scripts/session-manager.mjs --search "关键词"
```

### 4️⃣ 重命名会话
```bash
bun run scripts/session-manager.mjs --rename <会话ID> --title "新标题"
```

### 5️⃣ 导出会话
```bash
bun run scripts/session-manager.mjs --export <会话ID> --output "会话.md"
```

## 📋 常用命令

| 操作 | 命令 |
|------|------|
| 📁 查找目录 | `--locate` |
| 📄 列出会话 | `--list [--page N]` |
| 🔍 搜索会话 | `--search "关键词" [--date-from YYYY-MM-DD]` |
| 👁️ 查看详情 | `--detail <会话ID>` |
| ✏️ 重命名 | `--rename <会话ID> --title "新标题"` |
| 🗑️ 删除 | `--delete <会话ID> [--force]` |
| 📤 导出 | `--export <会话ID> --format markdown --output "文件.md"` |
| 📊 统计 | `--stats` |
| ❓ 帮助 | `--help` |

## 💡 典型场景

### 场景1：查找昨天的讨论
```bash
bun run scripts/session-manager.mjs --search "KPI" --date-from "2025-01-09" --date-to "2025-01-09"
```

### 场景2：批量重命名
```bash
# 1. 列出所有会话
bun run scripts/session-manager.mjs --list

# 2. 逐个重命名
bun run scripts/session-manager.mjs --rename <id> --title "2025-01-10_新标题"
```

### 场景3：导出备份
```bash
bun run scripts/session-manager.mjs --export <id> --format markdown --output "备份.md"
```

## ⚠️ 注意事项

1. **删除不可恢复**：删除前请导出备份
2. **使用描述性标题**：如 `"2025-01-10_KPI看板优化"`
3. **定期备份**：建议每周导出重要会话

## 📚 完整文档

- 详细使用指南：[开发文档/会话管理器使用指南.md](../开发文档/会话管理器使用指南.md)
- 功能说明：[.claude/commands/session-manager.md](.claude/commands/session-manager.md)
- Subagent：[.claude/subagents/session-manager.md](.claude/subagents/session-manager.md)
