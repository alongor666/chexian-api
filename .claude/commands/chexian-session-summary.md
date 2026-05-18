---
name: chexian-session-summary
description: 扫描历史Session，提取用户原文和AI回复概要，增量汇总到沟通记录表
category: knowledge-management
version: 2.0.0
author: "@user"
tags: [session, summary, knowledge, review, sharing, history]
scope: global
requires: []
dependencies:
  - 开发文档/沟通记录汇总表.md
  - .claude/session-tracking.json
last_updated: "2026-01-18"
---

# /chexian-session-summary

扫描 **所有历史 Session**，提取用户原文和 AI 回复概要，**增量更新**到沟通记录汇总表。

## 核心特性

- **历史全量扫描**：默认扫描所有历史 session，不仅限于当前对话
- **增量更新**：记录已处理的 session ID，避免重复处理
- **智能筛选**：支持按关键词、日期、项目路径筛选
- **自动概要**：AI 回复自动压缩为 100-300 字摘要
- **分类标签**：自动识别对话主题并打标签

---

## Session 存储位置

Claude Code 历史 session 存储在以下位置：

| 平台 | 路径 |
|------|------|
| **macOS** | `~/.claude/projects/<project-hash>/` |
| **Linux** | `~/.claude/projects/<project-hash>/` |
| **Windows** | `%USERPROFILE%\.claude\projects\<project-hash>\` |

**项目 session 文件格式**：
- 文件名：`<session-id>.jsonl`（JSON Lines 格式）
- 每行一条消息：`{"type": "human|assistant", "message": {...}, "timestamp": "..."}`

---

## 参数

### 范围控制

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--scope` | `all`=全部历史, `new`=仅未处理, `current`=当前对话 | `new` |
| `--project` | 指定项目路径（支持模糊匹配） | 当前项目 |

### 筛选条件

| 参数 | 说明 | 示例 |
|------|------|------|
| `--filter` | 关键词筛选（支持多个，逗号分隔） | `--filter "续保,筛选"` |
| `--date-from` | 开始日期 | `--date-from "2026-01-01"` |
| `--date-to` | 结束日期 | `--date-to "2026-01-18"` |

### 处理模式

| 参数 | 说明 |
|------|------|
| `--mode batch` | 批量处理，无需确认 |
| `--mode interactive` | 交互式，逐条确认（默认） |
| `--mode preview` | 仅预览，不写入文件 |

### 输出控制

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--output` | 输出文件路径 | `开发文档/沟通记录汇总表.md` |
| `--reset` | 重置追踪记录，重新处理所有 session | - |

---

## 使用示例

```bash
# 🔥 推荐：处理所有未汇总的历史 session
/chexian-session-summary

# 处理所有历史 session（包括已处理的，会跳过重复）
/chexian-session-summary --scope all

# 筛选包含"续保"的历史对话
/chexian-session-summary --filter "续保"

# 筛选指定日期范围
/chexian-session-summary --date-from "2026-01-01" --date-to "2026-01-15"

# 批量模式（无需确认）
/chexian-session-summary --mode batch

# 仅预览，不写入
/chexian-session-summary --mode preview --filter "性能"

# 重置追踪，重新处理所有
/chexian-session-summary --reset --scope all
```

---

## 执行协议（CRITICAL）

当用户调用 `/chexian-session-summary` 时，**必须按以下步骤执行**：

### 步骤 1：定位 Session 存储

```bash
# 1. 获取当前项目的 session 目录
PROJECT_PATH=$(pwd)
PROJECT_HASH=$(echo -n "$PROJECT_PATH" | shasum -a 256 | cut -c1-16)
SESSION_DIR="$HOME/.claude/projects/-Users-xuechenglong-Downloads-01-正开发Git项目-chexianYJFX"

# 2. 列出所有 session 文件
ls -la "$SESSION_DIR"/*.jsonl 2>/dev/null
```

**输出示例**：
```
📂 Session 存储位置: ~/.claude/projects/-Users-xuechenglong-Downloads-01-正开发Git项目-chexianYJFX/
📊 发现 15 个历史 session
📋 已处理: 8 个 | 待处理: 7 个
```

### 步骤 2：读取追踪文件

```bash
# 追踪文件记录已处理的 session
cat .claude/session-tracking.json
```

**追踪文件格式**：
```json
{
  "lastUpdated": "2026-01-18T15:30:00Z",
  "processedSessions": [
    {
      "sessionId": "abc123",
      "processedAt": "2026-01-17T10:00:00Z",
      "recordCount": 5
    }
  ],
  "totalRecords": 42
}
```

### 步骤 3：解析 Session 文件

```bash
# 读取单个 session 文件（JSONL 格式）
cat "$SESSION_DIR/<session-id>.jsonl" | head -20
```

**解析每条消息**：
```json
{"type": "human", "message": {"content": "用户问题..."}, "timestamp": "2026-01-18T10:30:00Z"}
{"type": "assistant", "message": {"content": "AI回复..."}, "timestamp": "2026-01-18T10:30:15Z"}
```

### 步骤 4：提取与概要

对每个 session 中的对话：

1. **提取用户原文**：`message.content`（完整保留）
2. **生成 AI 概要**：
   - 提取第一段或总结段落
   - 识别关键操作（文件修改、命令执行）
   - 压缩为 100-300 字
3. **自动分类**：根据关键词打标签

**分类规则**：
| 关键词 | 标签 |
|--------|------|
| 实现、开发、新增、功能 | `#功能开发` |
| 修复、fix、bug、错误 | `#BUG修复` |
| 架构、设计、重构 | `#架构设计` |
| 分析、查询、SQL、数据 | `#数据分析` |
| 审查、review、检查 | `#代码审查` |
| 配置、设置、config | `#配置调整` |
| commit、push、PR、分支 | `#Git工作流` |
| 类型、typecheck、tsc | `#类型检查` |
| 其他 | `#其他` |

### 步骤 5：应用筛选条件

如果指定了 `--filter`：
```python
# 伪代码
for record in records:
    if filter_keyword in record.user_question or filter_keyword in record.ai_response:
        filtered_records.append(record)
```

### 步骤 6：预览结果

```
📝 提取结果预览（共 7 条新记录）:

---
[1] 2026-01-17 14:30 | Session: abc123 | #功能开发
问: 帮我实现续保率分析功能...
答: 创建了 RenewalAnalysis 组件，包含续保率计算、趋势图表...

[2] 2026-01-17 16:45 | Session: def456 | #BUG修复
问: 筛选器选中后数据没更新...
答: 修复了 FilterContext 的状态同步问题...

[3] 2026-01-18 09:15 | Session: ghi789 | #数据分析
问: 分析一下各机构的续保情况...
答: 按机构维度分析续保率，发现...
---

确认写入汇总表? (y/n)
```

### 步骤 7：更新汇总表

1. 读取现有 `开发文档/沟通记录汇总表.md`
2. 按日期分组追加新记录
3. 更新统计概览
4. 更新追踪文件 `.claude/session-tracking.json`

**输出**：
```
✅ 已更新沟通记录汇总表

📁 文件位置: 开发文档/沟通记录汇总表.md
📊 本次新增: 7 条
📊 总记录数: 49 条
📊 已处理 Session: 15 个

下次运行将仅处理新增的 session。
```

---

## 增量更新机制

### 追踪文件位置

`.claude/session-tracking.json`

### 追踪逻辑

```
1. 读取追踪文件，获取已处理的 session ID 列表
2. 扫描 session 目录，获取所有 session 文件
3. 计算差集：待处理 = 全部 - 已处理
4. 处理待处理的 session
5. 更新追踪文件
```

### 重置追踪

```bash
# 删除追踪文件，下次运行将重新处理所有 session
/chexian-session-summary --reset
```

---

## 输出格式

### 汇总表结构

```markdown
# 沟通记录汇总表

> 最后更新: 2026-01-18 | 记录总数: 49 条 | Session: 15 个

## 📊 统计概览

| 分类 | 记录数 |
|------|--------|
| 功能开发 | 18 |
| BUG修复 | 10 |
| 数据分析 | 8 |
| Git工作流 | 6 |
| 架构设计 | 4 |
| 其他 | 3 |

---

## 2026-01-18

### [14:30] #功能开发 `session:abc123`

**用户问题**:
> 帮我实现续保率分析功能，需要按机构和时间维度展示

**AI回复概要**:
创建了 `RenewalAnalysisPanel` 组件：
1. 实现续保率计算逻辑（续保保费/到期保费）
2. 添加机构维度下钻功能
3. 集成 ECharts 趋势图表
4. 支持日期范围筛选

**关键产出**:
- `src/features/renewal/RenewalAnalysisPanel.tsx`
- `server/src/sql/renewal.ts`

---
```

---

## 最佳实践

### 1. 每日结束时运行一次
```bash
/chexian-session-summary --mode batch
```

### 2. 按主题回顾
```bash
# 回顾所有续保相关的讨论
/chexian-session-summary --filter "续保" --mode preview
```

### 3. 定期全量同步
```bash
# 每周一重置并全量同步
/chexian-session-summary --reset --scope all --mode batch
```

---

## 相关文档

- `开发文档/沟通记录汇总表.md` - 汇总表文件
- `.claude/session-tracking.json` - 追踪文件
- `.claude/commands/chexian-session-manager.md` - 会话管理器
- `.claude/commands/chexian-extract-knowledge.md` - 知识提取
