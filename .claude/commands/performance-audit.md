---
name: performance-audit
description: 全栈性能审计（前端渲染+后端查询+内存优化）
category: optimization
version: 2.0.0
author: "@claude"
tags: [performance, optimization, duckdb, react]
scope: project
requires:
  - bun
  - Chrome DevTools
dependencies:
  - src/shared/duckdb/client.ts
  - src/features/dashboard/hooks/
  - src/widgets/table/
last_updated: "2026-01-16"
---

# /performance-audit

全栈性能审计命令，涵盖前端渲染性能、DuckDB 查询性能、内存使用优化。

## 使用方法

```bash
# 完整性能审计（推荐）
/performance-audit

# 仅审计前端性能
/performance-audit --frontend

# 仅审计数据库查询
/performance-audit --database

# 生成性能报告
/performance-audit --report
```

## 审计流程

### 第 1 步：前端性能审计（1 分钟）

**检查项**:
1. React 组件渲染性能
   - 使用 React DevTools Profiler
   - 识别不必要的重渲染
   - 检查组件树深度

2. 虚拟滚动性能
   - 检查大数据列表渲染
   - 测量滚动帧率（目标: 60 FPS）
   - 验证虚拟化效果

3. ECharts 性能
   - 检查图表渲染时间
   - 验证按需加载
   - 测试交互响应速度

**性能指标**:
```javascript
{
  "FCP": "First Contentful Paint < 1.5s",
  "LCP": "Largest Contentful Paint < 2.5s",
  "FID": "First Input Delay < 100ms",
  "CLS": "Cumulative Layout Shift < 0.1",
  "TTI": "Time to Interactive < 3.5s"
}
```

### 第 2 步：数据库查询审计（1-2 分钟）

**检查项**:
1. SQL 查询性能
   - 测量查询执行时间
   - 分析慢查询（> 2s）
   - 检查 JOIN 优化

2. 缓存命中率
   - 统计缓存使用情况
   - 计算缓存命中率（目标: > 80%）
   - 识别未缓存查询

3. 数据传输优化
   - 检查 Arrow IPC 效率
   - 验证数据序列化
   - 测量 Worker 通信开销

**查询性能基准**:
```javascript
{
  "简单查询": "< 100ms",
  "聚合查询": "< 500ms",
  "复杂 JOIN": "< 2s",
  "大数据导出": "< 5s"
}
```

### 第 3 步：内存使用审计（1 分钟）

**检查项**:
1. 内存泄漏检测
   - 检查事件监听器清理
   - 验证定时器清理
   - 检查闭包引用

2. 内存占用分析
   - 测量堆内存大小
   - 识别大对象占用
   - 检查 DuckDB 内存使用

3. 内存优化建议
   - 实现数据分页
   - 优化大对象存储
   - 使用 WeakMap/WeakSet

**内存基准**:
```javascript
{
  "初始加载": "< 50MB",
  "数据加载后": "< 200MB",
  "长时间使用": "< 500MB"
}
```

## 审计输出

```markdown
## 性能审计报告

### 前端性能
- FCP: 1.2s ✅ (目标: < 1.5s)
- LCP: 2.8s ⚠️ (目标: < 2.5s)
- FID: 85ms ✅ (目标: < 100ms)
- CLS: 0.05 ✅ (目标: < 0.1)

**优化建议**:
1. [组件名] - 使用 React.memo 减少重渲染
2. [图表名] - 延迟加载图表数据
3. [图片名] - 使用懒加载

### 数据库性能
- 平均查询时间: 350ms ✅
- 缓存命中率: 75% ⚠️ (目标: > 80%)
- 慢查询数量: 3 个 ⚠️

**优化建议**:
1. [查询名] - 添加索引或重写 SQL
2. [查询名] - 实现查询结果缓存
3. [数据表] - 考虑数据预聚合

### 内存使用
- 当前堆内存: 180MB ✅
- 内存泄漏: 未发现 ✅
- 大对象占用: 3 个 ⚠️

**优化建议**:
1. [数据名] - 实现分页加载
2. [缓存名] - 设置合理的 TTL
3. [组件名] - 清理不必要的闭包
```

## 优化命令

审计后自动执行以下优化：

```bash
# 1. React 性能优化
- 添加 React.memo 到频繁渲染的组件
- 使用 useMemo 缓存计算结果
- 使用 useCallback 稳定函数引用

# 2. DuckDB 查询优化
- 重写慢查询 SQL
- 实现查询结果缓存
- 优化 JOIN 顺序

# 3. 内存优化
- 清理事件监听器
- 实现虚拟滚动
- 添加数据分页
```

## 相关文件

- `.claude/agents/duckdb-optimizer.md` - DuckDB 优化专家
- `.claude/agents/react-performance.md` - React 性能专家
- `src/shared/cache/` - 缓存系统
- `tests/cache.test.ts` - 缓存测试

## 常见问题

**Q: 审计需要多长时间？**
A: 完整审计约 3-5 分钟，前端/数据库单独审计各 1-2 分钟。

**Q: 审计会修改代码吗？**
A: 不会，审计只提供优化建议。使用 `--fix` 选项才自动应用优化。

**Q: 如何定期审计？**
A: 建议每周或每次重大功能更新后运行一次审计。

**Q: 审计结果如何解读？**
A: ✅ 表示通过，⚠️ 表示需要优化，❌ 表示严重问题。

---

**维护者**: @claude
**版本**: 2.0.0
**最后更新**: 2026-01-16
