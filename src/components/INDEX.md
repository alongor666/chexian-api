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
- **`layout/TopNavigation.tsx`**: 顶部导航栏组件（项目名称、省份切换、主题切换；文件菜单经 `fileMenu` slot 由 App 注入，不反向依赖 features）
- **`layout/DropdownMenu.tsx`**: 顶栏通用下拉菜单原语（省份菜单 / 文件菜单复用）
- **`layout/DataGuard.tsx`**: 数据路由守卫（未加载数据时重定向到首页）
- **`layout/ErrorBoundary.tsx`**: 错误边界组件（捕获子组件错误，显示友好错误界面）
- **`layout/index.ts`**: 统一导出入口

## 变更历史

| 日期 | 变更内容 | 关联任务 |
|------|----------|----------|
| 2026-01-16 | 添加ErrorBoundary组件，处理Lazy路由加载失败 | Code Review修复 |
| 2026-01-16 | 添加DataGuard路由守卫，实现数据加载状态管理 | 页面布局重构Phase 2 |
| 2026-01-16 | 创建Layout模块，实现侧边栏布局重构 | 页面布局重构Phase 1 |
| 2026-03-10 | `layout/DashboardAnchorNav.tsx`：新增长页面锚点导航组件；`layout/PageFilterPanel.tsx`：页面容器改为顶部基础筛选 + 高级抽屉 + 右侧锚点挂载位；`layout/SidebarNavigation.tsx`：收起态新增悬浮 Tooltip 与分组层级强化 | B221 |
| 2026-03-10 | `layout/DashboardAnchorNav.tsx`：锚点跳转改为容器级稳定滚动（`scrollTop` + smooth 兜底），支撑多页面长内容导航与 E2E 回归 | B222 |
| 2026-03-10 | `layout/PageFilterPanel.tsx`：高级筛选计数改为复用 reset 基线（`resolveResetYear + maxDataDate`），修复历史数据年份下重置后仍显示计数的问题 | B226 |
| 2026-07-09 | 依赖倒置（B330 follow-up）：抽出 `layout/DropdownMenu.tsx` 通用原语；`layout/PageFilterPanel.tsx` 迁至 `features/filters/`；`TopNavigation`/`SidebarLayout` 改 slot 注入（文件菜单 / 副驾抽屉），components/layout 不再反向 import features | 2026-06-15-claude-edbd61 |
