---
name: 共享记忆机制
description: 所有车险项目通过符号链接共享同一份记忆，修复脚本 sync-memory-links.sh
type: reference
---

所有车险相关项目（chexian-api、私董会、作战地图、knowledge-hub 等）共享同一份记忆。

**物理位置**：`~/.claude/shared-memory/chexian/`

**同步机制**：各项目的 `memory/` 是符号链接，指向上述物理目录。任何一个项目写入记忆，所有项目立即可见。

**修复脚本**：`bash ~/.claude/shared-memory/sync-memory-links.sh`
- 自动扫描 `~/.claude/projects/` 中目录名含 `chexian`/`车险`/`私董` 的项目
- 已有链接 → 跳过
- 链接指向错误 → 修正
- 无 memory 目录 → 创建链接
- 是真实目录 → 合并内容后替换为链接

**运行时机**：
- 项目改名后
- 新建车险相关项目后（如在新目录打开 Claude Code）
- 发现某个项目记忆丢失时

**Why:** Claude Code 的项目目录名根据首次打开时的路径编码生成，目录改名后不会更新。符号链接 + 稳定路径解决此问题。
