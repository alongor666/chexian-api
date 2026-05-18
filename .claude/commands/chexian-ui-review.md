---
name: chexian-ui-review
description: UI/UX 设计审查与优化建议
category: development-tools
version: 2.0.0
author: "@claude"
tags: [ui, ux, design, accessibility]
scope: project
requires:
  - Chrome DevTools
  - React DevTools
dependencies:
  - src/features/dashboard/
  - src/widgets/
  - tailwind.config.js
last_updated: "2026-01-16"
---

# /chexian-ui-review

UI/UX 设计审查命令，检查界面设计、交互体验、可访问性、响应式布局。

## 使用方法

```bash
# 完整 UI 审查（推荐）
/chexian-ui-review

# 仅审查可访问性
/chexian-ui-review --accessibility

# 仅审查响应式设计
/chexian-ui-review --responsive

# 审查指定组件
/chexian-ui-review --component PremiumDashboard
/chexian-ui-review --component AdvancedFilterPanel

# 生成设计优化报告
/chexian-ui-review --report
```

## 审查清单

### 1. 视觉设计 (Visual Design)

**检查项**:
- [ ] 颜色对比度符合 WCAG AA 标准（4.5:1）
- [ ] 间距使用统一的间距系统（4/8/12/16/24px）
- [ ] 字体层级清晰（h1/h2/h3/p）
- [ ] 一致的圆角、阴影、边框样式
- [ ] 图标风格统一

**评分标准**:
```javascript
{
  "优秀": "90-100分 - 符合设计规范，视觉统一",
  "良好": "75-89分 - 大部分符合，有少量不一致",
  "需改进": "60-74分 - 存在明显的视觉问题",
  "不合格": "< 60分 - 严重违反设计原则"
}
```

### 2. 交互设计 (Interaction Design)

**检查项**:
- [ ] 按钮状态清晰（默认/hover/active/disabled）
- [ ] 表单验证及时反馈
- [ ] 加载状态明确（Spinner/Skeleton）
- [ ] 错误提示友好具体
- [ ] 空状态有引导
- [ ] 操作可撤销（删除/编辑）

**交互模式**:
```typescript
// ✅ 好的交互
<Button
  onClick={() => setShowConfirm(true)}
  className="hover:bg-blue-600 active:bg-blue-700"
>
  删除
</Button>

{showConfirm && (
  <ConfirmDialog
    title="确定删除？"
    message="删除后无法恢复"
    onConfirm={() => {
      handleDelete()
      setShowConfirm(false)
    }}
    onCancel={() => setShowConfirm(false)}
  />
)}

// ❌ 不好的交互
<div onClick={handleDelete}>删除</div>
```

### 3. 布局与结构 (Layout & Structure)

**检查项**:
- [ ] 信息层级清晰（主次分明）
- [ ] 视觉流符合阅读习惯（从左到右，从上到下）
- [ ] 相关内容分组（使用 Card/Section）
- [ ] 对齐方式统一（左对齐/居中）
- [ ] 留白适当（不拥挤不空旷）

**布局模式**:
```tsx
// 侧边栏布局（推荐）
<div className="flex h-screen">
  <aside className="w-64 border-r">
    {/* 侧边栏 */}
  </aside>
  <main className="flex-1 overflow-auto">
    {/* 主内容 */}
  </main>
</div>

// 顶部导航布局
<div className="flex flex-col h-screen">
  <header className="h-16 border-b">
    {/* 顶部导航 */}
  </header>
  <main className="flex-1 overflow-auto">
    {/* 主内容 */}
  </main>
</div>
```

### 4. 响应式设计 (Responsive Design)

**检查项**:
- [ ] 移动端（< 768px）布局合理
- [ ] 平板（768px - 1024px）布局合理
- [ ] 桌面（> 1024px）充分利用空间
- [ ] 图片自适应（max-w-full）
- [ ] 表格横向滚动（sticky 表头）

**响应式断点**:
```tsx
<div className="
  grid-cols-1        // 手机: 1 列
  md:grid-cols-2     // 平板: 2 列
  lg:grid-cols-3     // 桌面: 3 列
  xl:grid-cols-4     // 大屏: 4 列
  gap-4
">
```

### 5. 可访问性 (Accessibility)

**检查项**:
- [ ] 所有交互元素可通过键盘访问（Tab 键）
- [ ] 图片包含 alt 属性
- [ ] 表单元素包含 label
- [ ] 颜色不是唯一的信息传达方式
- [ ] 焦点状态可见（focus:ring）
- [ ] ARIA 标签正确使用

**可访问性测试**:
```bash
# 使用 Chrome DevTools Lighthouse
1. 打开 Chrome DevTools
2. 切换到 Lighthouse 标签
3. 选择 Accessibility
4. 点击 Analyze page load

# 目标分数
- Accessibility: > 90 分
- Best Practices: > 90 分
- SEO: > 90 分
```

### 6. 性能与体验 (Performance & UX)

**检查项**:
- [ ] 页面加载时间 < 3s
- [ ] 首次内容绘制 < 1.5s
- [ ] 交互响应时间 < 100ms
- [ ] 动画流畅（60 FPS）
- [ ] 无布局抖动（CLS < 0.1）

**性能优化**:
```tsx
// 使用 React.memo 减少重渲染
const Component = React.memo(({ data }) => {
  return <div>{data}</div>
})

// 使用 useMemo 缓存计算
const sorted = useMemo(() =>
  data.sort((a, b) => a.value - b.value),
  [data]
)

// 懒加载图片
<img
  src={src}
  loading="lazy"
  alt={alt}
/>

// 延迟加载组件
const HeavyComponent = React.lazy(() =>
  import('./HeavyComponent')
)
```

## 审查流程

### 第 1 步：自动化检查（30 秒）

```bash
# 运行 Lighthouse 审计
lighthouse http://localhost:5173 --view

# 运行可访问性检查
bun run scripts/check-accessibility.mjs

# 检查颜色对比度
bun run scripts/check-color-contrast.mjs
```

### 第 2 步：手动审查（2-3 分钟）

**使用工具**:
- Chrome DevTools (Elements/Console/Lighthouse)
- React DevTools (Components/Profiler)
- axe DevTools (可访问性)

**审查要点**:
1. 打开应用，逐页浏览
2. 测试所有交互元素
3. 检查不同屏幕尺寸
4. 使用键盘导航
5. 检查控制台错误

### 第 3 步：生成报告（1 分钟）

```markdown
## UI/UX 审查报告

### 总体评分: 82/100 (良好)

### 视觉设计: 85/100 (良好)
✅ 颜色系统统一，对比度符合标准
✅ 间距使用统一的间距系统
⚠️ 部分图标风格不一致（建议统一使用 Heroicons）

**优化建议**:
1. 统一图标库为 Heroicons
2. 增加深色模式支持

### 交互设计: 78/100 (需改进)
✅ 按钮状态清晰
⚠️ 部分表单缺少验证反馈
❌ 删除操作无确认对话框

**优化建议**:
1. 添加表单验证提示
2. 删除操作增加确认对话框
3. 添加操作成功/失败提示

### 布局结构: 88/100 (良好)
✅ 信息层级清晰
✅ 相关内容分组合理
✅ 留白适当

**优化建议**:
1. 考虑使用栅格系统优化对齐
2. 增加面包屑导航

### 响应式设计: 75/100 (需改进)
✅ 移动端布局基本合理
⚠️ 平板端表格显示不佳
❌ 桌面端空间利用不充分

**优化建议**:
1. 表格添加横向滚动
2. 桌面端增加列数（2 → 3）

### 可访问性: 80/100 (良好)
✅ 键盘导航基本可用
⚠️ 部分图片缺少 alt 属性
⚠️ 表单元素缺少 label

**优化建议**:
1. 添加图片 alt 属性
2. 为表单元素添加 label
3. 增加 ARIA 标签

### 性能与体验: 85/100 (良好)
✅ 页面加载时间: 2.3s
✅ 首次内容绘制: 1.2s
⚠️ 部分动画卡顿（50 FPS）

**优化建议**:
1. 优化动画性能（使用 transform）
2. 懒加载非关键资源
```

## 优化命令

审查后自动执行以下优化：

```bash
# 1. 添加可访问性属性
- 为图片添加 alt 属性
- 为表单添加 label
- 为交互元素添加 aria-label

# 2. 优化响应式布局
- 添加断点样式
- 实现表格横向滚动
- 优化移动端间距

# 3. 改进交互设计
- 添加确认对话框
- 添加表单验证
- 添加加载状态
```

## 相关文件

- `.claude/agents/ui-ux-designer.md` - UI/UX 设计专家
- `src/shared/config/chartStyles.ts` - 图表样式
- `tailwind.config.js` - Tailwind 配置

## 设计资源

- shadcn/ui 组件库: https://ui.shadcn.com/
- Tailwind CSS: https://tailwindcss.com/docs
- Heroicons 图标: https://heroicons.com/
- WCAG 2.1: https://www.w3.org/WAI/WCAG21/quickref/

## 常见问题

**Q: 审查需要多长时间？**
A: 完整审查约 3-5 分钟，自动化检查 30 秒。

**Q: 审查会修改代码吗？**
A: 不会，审查只提供优化建议。使用 `--fix` 选项才自动应用优化。

**Q: 如何快速检查可访问性？**
A: 使用 axe DevTools 插件或 Chrome DevTools Lighthouse。

**Q: 评分标准是什么？**
A: 优秀 (90-100)、良好 (75-89)、需改进 (60-74)、不合格 (< 60)。

---

**维护者**: @claude
**版本**: 2.0.0
**最后更新**: 2026-01-16
