---
name: chexian-performance-audit
description: 全栈性能审计（前端渲染+后端查询+内存优化）。当用户说"跑性能审计/审查性能/查内存占用"时触发。
category: optimization
version: 2.1.0
author: "@claude"
tags: [performance, optimization, duckdb, react]
scope: project
requires:
  - bun
  - Chrome DevTools
dependencies:
  - .claude/agents/duckdb-optimizer.md
  - .claude/agents/react-performance.md
  - server/src/services/duckdb.ts
last_updated: "2026-06-09"
---

# /chexian-performance-audit

全栈性能审计：前端渲染 → DuckDB 查询 → 内存三步流程。

## 使用方法

```bash
/chexian-performance-audit              # 完整审计
/chexian-performance-audit --frontend   # 仅前端
/chexian-performance-audit --database   # 仅数据库
/chexian-performance-audit --report     # 生成报告
```

## 审计三步流程

### 第 1 步：前端渲染性能

使用 Chrome DevTools Lighthouse 与 React DevTools Profiler 检查：
- 首次内容绘制（FCP < 1.5s）/ 最大内容绘制（LCP < 2.5s）
- 首次输入延迟（FID < 100ms）/ 累积布局偏移（CLS < 0.1）
- 识别不必要的重渲染组件与虚拟滚动效果

### 第 2 步：DuckDB 查询性能

- 测量查询执行时间，识别慢查询（> 2s）
- 计算缓存命中率（目标 > 80%），识别未缓存的高频查询
- 检查 JOIN 顺序与聚合效率

查询耗时与内存基准详见 `.claude/agents/duckdb-optimizer.md` "性能基准" 章节。

### 第 3 步：内存使用

- 检查堆内存大小（初始 < 50MB / 数据加载后 < 200MB / 长期使用 < 500MB）
- 检查事件监听器与定时器清理是否到位

## 输出格式

```markdown
## 性能审计报告

### 前端性能
- FCP: Xs ✅/⚠️/❌  LCP: Xs ✅/⚠️/❌

### 数据库性能
- 平均查询时间: Xms  缓存命中率: X% ✅/⚠️

### 内存使用
- 当前堆内存: XMB ✅/⚠️

**各项优化建议**（逐条列出）
```

## 相关文件

- `.claude/agents/duckdb-optimizer.md` — DuckDB 性能优化与基准值
- `.claude/agents/react-performance.md` — React 性能优化专家
- `src/shared/cache/` — 路由缓存实现
