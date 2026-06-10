---
name: chexian-ui-review
description: UI/UX 设计审查与优化建议。当用户说"审查 UI/界面审查/检查可访问性/查响应式"时触发。
category: development-tools
version: 2.1.0
author: "@claude"
tags: [ui, ux, design, accessibility]
scope: project
requires:
  - Chrome DevTools
dependencies:
  - DESIGN.md
  - src/shared/styles/index.ts
last_updated: "2026-06-09"
---

# /chexian-ui-review

UI/UX 设计审查：6 维评分（视觉/交互/布局/响应式/可访问性/性能），依据本项目设计系统给出改进建议。

## 使用方法

```bash
/chexian-ui-review                               # 完整审查
/chexian-ui-review --accessibility               # 仅可访问性
/chexian-ui-review --responsive                  # 仅响应式
/chexian-ui-review --component PremiumDashboard  # 指定组件
```

## 评分标准

详见 `DESIGN.md` "UI 审查评分基准" 小节（§11 Agent 快速参考内）：
- 优秀：90-100 分 / 良好：75-89 分 / 需改进：60-74 分 / 不合格：< 60 分

间距体系以 `src/shared/styles/index.ts` `spacing` 对象为准（xs=4px / sm=8px / md=16px / lg=24px）。

## 审查三步流程

### 第 1 步：Lighthouse 自动化检查

```bash
# Chrome DevTools → Lighthouse → 勾选 Performance + Accessibility
# 目标：Accessibility > 90 分
```

### 第 2 步：手动 6 维审查

| 维度 | 关键检查点 |
|------|-----------|
| 视觉设计 | 颜色对比度（WCAG AA 4.5:1）、字体层级、圆角/阴影一致性 |
| 交互设计 | 按钮四态（默认/hover/active/disabled）、加载状态、错误提示 |
| 布局与结构 | 信息层级、视觉流、相关内容分组 |
| 响应式设计 | 移动端(<768px)、平板(768-1024px)、桌面(>1024px) |
| 可访问性 | Tab 键导航、图片 alt、表单 label、焦点状态可见 |
| 性能与体验 | FCP<1.5s、FID<100ms、动画 60FPS |

### 第 3 步：生成报告

```markdown
## UI/UX 审查报告

### 总体评分: XX/100（良好/优秀/需改进/不合格）

| 维度 | 得分 | 主要问题 | 优化建议 |
|------|------|---------|---------|
| 视觉设计 | XX | ... | ... |
| 交互设计 | XX | ... | ... |
| ...（6 维逐一列出） |
```

## 相关文件

- `DESIGN.md` — 设计系统（§11 Agent 快速参考含评分基准与间距体系）
- `src/shared/styles/index.ts` — 样式系统唯一事实源
- `.claude/agents/ui-ux-designer.md` — UI/UX 设计专家 agent
