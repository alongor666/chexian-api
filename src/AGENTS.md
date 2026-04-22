# src/AGENTS.md

> 前端、组件、页面和轻量前端服务相关任务优先遵守这里的规则；根目录 `AGENTS.md` 仍然适用。

## 1. 工作原则

- 优先复用现有组件、布局和服务层结构，不要为单点修改引入新的分层。
- 先看 `src/components/INDEX.md`、`src/widgets/INDEX.md`、`src/services/README.md`，再改相关模块。
- 组件和样式修改应尽量沿用仓库现有视觉语言，不要随意换设计体系。

## 2. 变更方式

- 变更前先搜索相似组件或实现，尽量在现有文件边界内完成。
- 页面、组件、hook、服务的职责要保持清晰，不要把无关逻辑混进同一层。
- 需要新增 UI 时，优先补充或复用现有组件，而不是复制粘贴新实现。

## 3. 验证要求

- 前端变更至少做一次 `bun run build` 或等价类型检查。
- 涉及交互、路由或可视化布局时，优先用真实页面或浏览器验证。
- 如改动影响导出、图表或复杂布局，优先做一次针对性的回归检查。

## 4. 常用参考

- 组件索引：[`src/components/INDEX.md`](./components/INDEX.md)
- Widgets 索引：[`src/widgets/INDEX.md`](./widgets/INDEX.md)
- 服务说明：[`src/services/README.md`](./services/README.md)

