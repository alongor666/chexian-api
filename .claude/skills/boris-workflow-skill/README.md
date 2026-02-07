# Boris Workflow Skill

基于 Claude Code 创建者 Boris Cherny 的 AI 协作顶级实践框架。

## 安装

将整个 `boris-workflow` 目录复制到你的 Claude Skills 目录：

```bash
cp -r boris-workflow ~/.claude/skills/user/
```

或者如果使用项目级 skills：

```bash
cp -r boris-workflow /path/to/your/project/.claude/skills/
```

## 功能

### 1. 心法检查
提醒你在任务各阶段是否遵循了 Boris 工作流的核心原则。

### 2. 挑衅式 Prompt 模板
提供 8 种经过验证的 prompt 模式：
- Grill Review（挑衅审查）
- Prove It（证明验证）
- Elegant Redo（优雅重来）
- Staff Review（计划审查）
- Attack（攻击弱点）
- Teach（教学理解）
- Update Rules（更新规则）
- Re-plan（重新规划）

### 3. 项目配置诊断
检查你的项目是否具备完整的 Boris 工作流配置：
- CLAUDE.md 是否存在且内容充实
- .claude/ 目录结构是否完整
- slash commands 是否配置
- git worktrees 是否设置

## 使用

### 触发词
- "检查工作流"
- "Boris 心法"
- "挑衅审查" / "Grill review"
- "项目配置诊断"
- "我卡住了"
- "重新规划"

### 诊断脚本
```bash
./scripts/diagnose.sh        # 运行诊断
./scripts/diagnose.sh --fix  # 诊断并修复
```

## 目录结构

```
boris-workflow/
├── SKILL.md                    # 主技能文件
├── README.md                   # 本文件
├── references/
│   ├── mindset-card.md         # 心法速查卡（可打印）
│   ├── prompt-templates.md     # 完整 prompt 模板库
│   └── claude-md-template.md   # CLAUDE.md 模板
└── scripts/
    └── diagnose.sh             # 配置诊断脚本
```

## 与其他技能协作

| 技能 | 关系 |
|------|------|
| intent-architect | 需求模糊时先用它，再用 boris-workflow 执行 |
| code-prompt-engineer | boris-workflow 提供心法，它提供具体技术 |
| skill-quality-validator | 新建 skill 后用 grill 审查 |

## 来源

- [Boris Cherny 个人工作流](https://x.com/bcherny/status/2007179832300581177) (2026.01.02)
- [Boris Cherny 团队实践](https://x.com/bcherny/status/2017742741636321619) (2026.02.01)

## 版本

- v1.0.0 (2026-02-04): 初始版本

## 作者

Alongor
