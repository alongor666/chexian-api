# ✅ Claude Code Settings 配置最终修复

## 问题根因

**错误**: `hooks: Expected object, but received array`

**原因**: hooks 应该是**对象**（键值对），不是数组

## 正确的格式

### ❌ 错误格式（数组）
```json
{
  "hooks": [
    {
      "PostToolUse": [...]
    },
    {
      "UserPromptSubmit": [...]
    }
  ]
}
```

### ✅ 正确格式（对象）
```json
{
  "hooks": {
    "PostToolUse": [...],
    "UserPromptSubmit": [...]
  }
}
```

## 完整示例

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": {
          "tools": ["Bash", "Edit", "Write"]
        },
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/hooks/post-tool-use.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": {
          "promptType": "user"
        },
        "hooks": [
          {
            "type": "notification",
            "notification": {
              "title": "Ready",
              "body": "Processing your request..."
            }
          }
        ]
      }
    ]
  }
}
```

## Hooks 对象结构

```typescript
interface Hooks {
  [hookType: string]: HookConfiguration[]
}

interface HookConfiguration {
  matcher: Matcher
  hooks: Hook[]
}

interface Matcher {
  tools?: string[]
  promptType?: 'user' | 'system' | 'assistant'
  toolUseInput?: {
    pattern: string
  }
}

interface Hook {
  type: 'command' | 'notification' | 'function'
  command?: string
  notification?: {
    title: string
    body: string
  }
}
```

## 可用的 Hook 类型

根据官方文档，有效的hook类型包括：

- **PreToolUse** - 工具使用前
- **PostToolUse** - 工具使用后
- **PostToolUseFailure** - 工具使用失败后
- **UserPromptSubmit** - 用户提交提示时
- **Notification** - 通知时
- **SessionStart** - 会话开始
- **SessionEnd** - 会话结束
- **Stop** - 停止时
- **SubagentStart** - 子代理启动
- **SubagentStop** - 子代理停止
- **PreCompact** - 压缩前
- **PermissionRequest** - 权限请求时

## 当前配置

### 1. PostToolUse Hook
**触发**: 使用 Bash, Edit, Write, Read 工具后
**脚本**: `.claude/scripts/hooks/post-tool-use.sh`
**功能**: 代码格式化和linter

```json
{
  "PostToolUse": [
    {
      "matcher": {
        "tools": ["Bash", "Edit", "Write", "Read"]
      },
      "hooks": [
        {
          "type": "command",
          "command": "bash .claude/scripts/hooks/post-tool-use.sh"
        }
      ]
    }
  ]
}
```

### 2. UserPromptSubmit Hook
**触发**: 用户提交提示前
**脚本**: `.claude/scripts/hooks/pre-commit.sh`
**功能**: 代码质量检查

```json
{
  "UserPromptSubmit": [
    {
      "matcher": {
        "promptType": "user"
      },
      "hooks": [
        {
          "type": "command",
          "command": "bash .claude/scripts/hooks/pre-commit.sh"
        }
      ]
    }
  ]
}
```

## 高级配置示例

### 多个Hook组合

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": {
          "tools": ["Bash"]
        },
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Bash command executed'"
          },
          {
            "type": "notification",
            "notification": {
              "title": "Bash Executed",
              "body": "Your command has finished"
            }
          }
        ]
      },
      {
        "matcher": {
          "tools": ["Edit"]
        },
        "hooks": [
          {
            "type": "command",
            "command": "bun test --run"
          }
        ]
      }
    ]
  }
}
```

### 特定命令匹配

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": {
          "tools": ["Bash"],
          "toolUseInput": {
            "pattern": "git commit.*"
          }
        },
        "hooks": [
          {
            "type": "notification",
            "notification": {
              "title": "Git Commit",
              "body": "Changes committed successfully"
            }
          }
        ]
      }
    ]
  }
}
```

### Session生命周期Hooks

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Welcome! Starting session...' && git status"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session ended. Saving work...'"
          }
        ]
      }
    ]
  }
}
```

## 验证配置

### 1. 检查JSON语法
```bash
jq '.' .claude/settings.local.json
```

### 2. 验证hooks对象
```bash
jq '.hooks | keys' .claude/settings.local.json
# 应该输出: ["PostToolUse", "UserPromptSubmit"]
```

### 3. 检查特定hook
```bash
jq '.hooks.PostToolUse' .claude/settings.local.json
```

### 4. 测试hook脚本
```bash
bash .claude/scripts/hooks/post-tool-use.sh
bash .claude/scripts/hooks/pre-commit.sh
```

## 常见错误

### ❌ 错误1: hooks 是数组
```json
{
  "hooks": [
    {"PostToolUse": [...]}
  ]
}
```
**错误**: `hooks: Expected object, but received array`

### ❌ 错误2: 使用旧格式
```json
{
  "hooks": {
    "postToolUse": {
      "enabled": true,
      "script": "..."
    }
  }
}
```
**错误**: `Invalid hook configuration`

### ✅ 正确格式
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": {...},
        "hooks": [...]
      }
    ]
  }
}
```

## 故障排除

### Hook不执行？

1. **检查语法**:
```bash
jq '.hooks' .claude/settings.local.json
```

2. **检查脚本权限**:
```bash
ls -la .claude/scripts/hooks/
# 应该有执行权限 (-rwxr-xr-x)
```

3. **手动测试**:
```bash
bash .claude/scripts/hooks/post-tool-use.sh
```

4. **查看日志**:
```bash
tail -f .claude/logs/claude-code.log
```

### JSON格式错误？

使用jq美化输出：
```bash
jq '.' .claude/settings.local.json > /tmp/settings.json
cat /tmp/settings.json
```

### 找不到hook脚本？

确保路径正确：
```bash
ls -la .claude/scripts/hooks/
# 应该看到:
# post-tool-use.sh
# pre-commit.sh
```

## 参考文档

- **官方文档**: https://code.claude.com/docs/en/hooks
- **Schema**: https://json.schemastore.org/claude-code-settings.json
- **Hook Matchers**: https://code.claude.com/docs/en/hooks#matchers
- **Hook Types**: https://code.claude.com/docs/en/hooks#hook-types

## 关键要点

1. ✅ **hooks 必须是对象**，不是数组
2. ✅ **每个hook类型是数组**，包含多个配置
3. ✅ **每个配置包含matcher和hooks**
4. ✅ **matcher指定触发条件**
5. ✅ **hooks数组包含要执行的动作**

---

**修复状态**: ✅ 完成
**验证**: `jq '.hooks' .claude/settings.local.json`
**文件**: `.claude/settings.local.json`

配置现在使用正确的对象格式！🎉
