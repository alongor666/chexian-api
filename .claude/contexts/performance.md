# Performance Context

Mode: 性能优化与调优
Focus: 查询性能、渲染效率、资源使用

## Behavior
- 先量化瓶颈（DuckDB 查询耗时、React Profiler、Network 面板）再优化
- DuckDB 查询目标: <3s（单查询）、<10s（复合分析）
- 前端渲染目标: <100ms（组件更新）、<2s（首屏加载）
- 优化后必须验证功能不回退

## Backend Performance
- DuckDB 服务: `server/src/services/duckdb.ts`
- SQL 生成器: `server/src/sql/*.ts`
- 常见瓶颈: 全表扫描、缺少 WHERE 过滤、聚合粒度过细
- 优化手段: 添加日期范围过滤、减少返回列、使用 LIMIT

## Frontend Performance
- React 渲染循环: useEffect 依赖数组检查 → 稳定化 filters 引用
- 大数据列表: 虚拟滚动（react-window）
- ECharts: 按需加载、避免重复初始化
- 图片/资源: 懒加载、代码分割

## Tools
- `React DevTools Profiler` — 组件渲染次数和耗时
- `curl -w '%{time_total}'` — API 响应时间
- `bun run build` — 构建产物大小分析

## Priorities
1. 找到真正的瓶颈（不要猜测）
2. 最小改动最大收益
3. 优化后验证无功能回退
