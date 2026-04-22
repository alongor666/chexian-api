---
name: session-debrief
description: 对话精华沉淀 — 提取需求追踪、问题发现、协作事项、关键转折、反思，保存到 Obsidian
category: workflow
version: 2.0.0
author: "@claude"
tags: [session, debrief, knowledge, obsidian]
scope: project
last_updated: "2026-04-13"
---

# 对话精华沉淀

在对话的**自然断点**由用户手动触发。不要等 context 满——那时细节已丢。

## 触发方式

```
/session-debrief
/session-debrief 只看流失分析部分
/session-debrief 保存到 ~/Documents/另一个目录
```

## 执行步骤

### Step 1: 获取 session 路径

找到当前 session 的 JSONL 文件路径：
```bash
ls -lt ~/.claude/projects/-Users-alongor666-Downloads------DUD-chexian-api/*.jsonl | head -1
```

### Step 2: 确定文件名

文件名必须**精准反映本次对话的精华结论**，不能叫"对话总结"或"session记录"。

好的文件名：`NCD双筛流失归因框架与AI协作反思_20260413.md`
差的文件名：`对话总结_20260413.md`、`session-debrief_20260413.md`

### Step 3: 确定保存路径

- 默认：`/Users/alongor666/Documents/人生修炼/02车险智慧分析系统/`
- 用户通过 `$ARGUMENTS` 指定时用用户路径
- 路径不存在时先创建

### Step 4: 按 8 个维度结构化提取

遍历本次对话，按下面 8 个维度提取。如果 `$ARGUMENTS` 指定了范围（如"只看流失分析部分"），只提取该范围内的内容。

### Step 5: 生成 Obsidian Markdown 并保存

## 输出结构（8 个维度）

### 一、对话关键信息
按时间线梳理做了什么、得出什么结论。**重点是结论和数据，不是过程流水账。**

### 二、需求追踪
| # | 要求 | 状态 | 说明 |

状态：✅已落实 / ⏳进行中 / ❌未开始

### 三、AI 发现的问题
| 问题 | 严重度 | 状态 |

状态：✅已修复 / ⚠️需关注 / ❓待确认。用 `==高亮==` 标记业务层面的重大发现。

### 四、协作事项
| 事项 | 状态 |

状态：✅已提供 / ❌未提供 / ❓未回应

### 五、关键纠偏
用户修正 AI 认知的转折点。格式：
```
1. **❌→✅ 标题**
   AI 原以为……用户指出……
```
这是最值钱的部分。每条纠偏已自动写入 memory，这里记录完整上下文。

### 六、待办清单
| 优先级 | 事项 | 负责人 |

负责人：AI可执行 / 用户待办。P0/P1 事项用 **加粗** 标注。

### 七、入库知识
列出本次新增/更新的 memory 文件名和一句话描述。

### 八、对话反思

> [!success] 符合最佳实践
> 列出用户做得好的协作行为（如渐进追问、即时纠偏、要求工具化）

> [!warning] 可改进的
> 列出不符合最佳实践的做法，每条附：
> - 影响：造成了什么浪费/错误
> - ==最简改变==：最小的习惯调整就能效果翻倍

> [!tip] 效果翻倍的一个改变
> 从所有"可改进"中提炼出**一个**最高杠杆的行为改变。不要列 3 个——只留 1 个最关键的。

## Obsidian 格式要求

### Frontmatter（必须）
```yaml
---
title: {精准标题}
date: YYYY-MM-DD
tags:
  - session-debrief
  - {主题标签1}
  - {主题标签2}
category: 车险智慧分析系统
session: "{session JSONL 完整路径}"
aliases:
  - {别名1}
  - {别名2}
---
```

### Obsidian 特有语法（应使用）
- **Callouts**：`[!abstract]` 摘要、`[!success]` 做得好、`[!warning]` 可改进、`[!tip]` 最简改变、`[!important]` 关键纠偏
- **高亮**：`==重要发现==` 标记业务层面重大发现
- **内部链接**：如引用其他笔记用 `[[笔记名]]`
- 不使用 wikilinks 引用项目代码文件（路径不在 vault 中）

## 质量检查

生成后自查：
1. 文件名是否反映精华（不是"总结"）？
2. 关键纠偏是否每条都有"AI 原以为/用户指出"？
3. 反思的"最简改变"是否只有 1 个且具体可行？
4. frontmatter 是否包含 session 路径？
5. 待办的 P0 事项是否都标注了负责人？

## 与其他机制的关系

| 机制 | 管什么 | 触发 |
|------|--------|------|
| auto-compact | 当下能继续工作 | 自动 |
| memory | 未来 AI 记得住 | AI 主动 |
| /extract-knowledge | 代码库旁的隐性知识 | 手动 |
| **/session-debrief** | **人能回顾的决策记录 + 反思** | **手动** |
