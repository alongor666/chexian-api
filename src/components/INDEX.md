# 组件层 (Components Layer)

**职责**：提供跨功能模块复用的UI组件。

## 子模块

| 模块 | 路径 | 职责 | 文档 |
|------|------|------|------|
| Layout | `layout/` | 页面布局组件（侧边栏、顶部导航） | 无独立文档 |

## 关键入口文件

### Layout 模块
- **`layout/SidebarLayout.tsx`**: 侧边栏布局容器（顶部导航栏+侧边栏+主内容区）
- **`layout/SidebarNavigation.tsx`**: 侧边栏导航组件（菜单项、高亮、收起/展开）
- **`layout/TopNavigation.tsx`**: 顶部导航栏组件（项目名称、文件菜单、设置菜单）
- **`layout/DataGuard.tsx`**: 数据路由守卫（未加载数据时重定向到首页）
- **`layout/ErrorBoundary.tsx`**: 错误边界组件（捕获子组件错误，显示友好错误界面）
- **`layout/index.ts`**: 统一导出入口

## 变更历史

| 日期 | 变更内容 | 关联任务 |
|------|----------|----------|
| 2026-01-16 | 添加ErrorBoundary组件，处理Lazy路由加载失败 | Code Review修复 |
| 2026-01-16 | 添加DataGuard路由守卫，实现数据加载状态管理 | 页面布局重构Phase 2 |
| 2026-01-16 | 创建Layout模块，实现侧边栏布局重构 | 页面布局重构Phase 1 |
