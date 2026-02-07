# Skills 索引 (v2.0)

> 可复用的"技能说明"（`SKILL.md`），供 AI 在特定场景下快速选择正确的工作流与产物格式。

**最后更新**: 2026-01-28

---

## 📋 快速导航

| 技能 | 描述 | 来源 |
|------|------|------|
| [plans-manager](#plans-manager) | 扫描/归档 `.claude/plans` 并生成快照 | 项目原有 |
| [json-canvas](#json-canvas) | 创建与编辑 Obsidian `.canvas` 文件 | 项目原有 |
| [obsidian-bases](#obsidian-bases) | Obsidian Bases 结构化数据与视图 | 项目原有 |
| [obsidian-markdown](#obsidian-markdown) | Obsidian Markdown 组织与链接策略 | 项目原有 |
| [continuous-learning-v2](#continuous-learning-v2) | 置信度评分 + 持续学习机制 | everything-claude-code |
| [tdd-workflow](#tdd-workflow) | 测试驱动开发规范 | everything-claude-code |
| [security-review](#security-review) | 安全审查清单与流程 | everything-claude-code |
| [verification-loop](#verification-loop) | 验证循环与质量保证 | everything-claude-code |

---

## 🗂️ 技能详情

### 项目原有技能 (4个)

#### plans-manager
**用途**: 扫描/归档 `.claude/plans` 并生成 `STATUS_SNAPSHOT` 快照
**详细文档**: [plans-manager/SKILL.md](./plans-manager/SKILL.md)

---

#### json-canvas
**用途**: 创建与编辑 Obsidian `.canvas` 文件
**详细文档**: [json-canvas/SKILL.md](./json-canvas/SKILL.md)

---

#### obsidian-bases
**用途**: Obsidian Bases 结构化数据与视图
**详细文档**: [obsidian-bases/SKILL.md](./obsidian-bases/SKILL.md)

---

#### obsidian-markdown
**用途**: Obsidian Markdown 组织与链接策略
**详细文档**: [obsidian-markdown/SKILL.md](./obsidian-markdown/SKILL.md)

---

### 新增技能 (4个 - 来自 everything-claude-code)

#### continuous-learning-v2
**用途**: 置信度评分 + 持续学习机制
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**核心功能**:
- 为每个响应添加置信度评分（0-100%）
- 记录学习要点和知识缺口
- 跨会话知识持久化
- 自动上下文压缩建议

**目录结构**:
```
continuous-learning-v2/
├── SKILL.md           # 技能说明
├── confidence/        # 置信度评分模板
├── learning/          # 学习记录
├── memory/            # 记忆持久化
└── patterns/          # 模式识别
```

**详细文档**: [continuous-learning-v2/SKILL.md](./continuous-learning-v2/SKILL.md)

---

#### tdd-workflow
**用途**: 测试驱动开发规范
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**核心流程**:
1. 🔴 **Red**: 编写失败的测试用例
2. 🟢 **Green**: 编写最小实现通过测试
3. 🔵 **Refactor**: 重构代码保持测试通过

**覆盖率目标**: 80%+

**详细文档**: [tdd-workflow/SKILL.md](./tdd-workflow/SKILL.md)

---

#### security-review
**用途**: 安全审查清单与流程
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**审查清单**:
- [ ] 输入验证与清理
- [ ] SQL 注入防护
- [ ] XSS 防护
- [ ] CSRF 防护
- [ ] 认证与授权
- [ ] 敏感数据处理
- [ ] 依赖安全
- [ ] 错误处理与日志

**详细文档**: [security-review/SKILL.md](./security-review/SKILL.md)

---

#### verification-loop
**用途**: 验证循环与质量保证
**来源**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

**验证层级**:
1. **静态分析**: 类型检查、lint
2. **单元测试**: 模块级验证
3. **集成测试**: 组件交互验证
4. **端到端测试**: 用户流程验证

**详细文档**: [verification-loop/SKILL.md](./verification-loop/SKILL.md)

---

## 📊 技能统计

| 类别 | 技能数量 | 来源 |
|------|---------|------|
| 项目原有 | 4 | 本项目 |
| 工作流增强 | 4 | everything-claude-code |
| **总计** | **8** | - |

---

## 🔗 相关文档

- **代理索引**: [.claude/agents/README.md](../agents/README.md)
- **命令索引**: [.claude/commands/README.md](../commands/README.md)
- **协作协议**: [CLAUDE.md](../../CLAUDE.md)

---

**维护者**: @claude
**版本**: 2.0.0
**最后更新**: 2026-01-28
