# Research Summary: chexian-api 全栈性能架构重构

**Date:** 2026-04-12
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Executive Summary

chexian-api 运行在 2核4G VPS 上，核心数据层为 380万行×53列 PolicyFact 宽表。系统已具备扎实的五层分离架构（Browser → Service Worker → React Query → Express Middleware → DuckDB），**性能瓶颈是局部的而非系统性的** — 不需要重新设计，而是对三个热点做外科手术式收紧：

1. **SQL 层 N+1 UNION ALL** — coefficient.ts 6路 UNION ALL 导致 2280万行扫描，是 2-5s 慢查询根因
2. **物化层全量启动** — 90s 阻塞 + 内存基线 ~70%
3. **快照层安全漏洞** — permissionToScope 对 unknown 权限返回相同 scope，存在跨用户数据泄漏风险

## Key Findings

### Stack (工具层)

- 项目现有工具已足够 — benchmark 脚本完整（无需 autocannon），DuckDB EXPLAIN ANALYZE 覆盖 SQL 诊断
- **必须替换**：停止维护 4 年的 `vite-plugin-compression 0.5.1` → `vite-plugin-compression2 2.4.0`
- **新增**：`rollup-plugin-visualizer 7.0.1` 建立前端包体基线（目前基线未知）
- **延后**：prom-client 监控在内存压力缓解后再引入

### Features (优化技术)

| 类别 | 技术 | 优先级 |
|------|------|--------|
| **Table Stakes** | UNION ALL → CTE 窗口函数 | P0 |
| **Table Stakes** | 快照分域指纹精细化 | P0 |
| **Table Stakes** | 惰性物化次要表 | P1 |
| **Table Stakes** | duckdb.ts 关注点拆分 | P1 |
| **Differentiator** | 持久化暖启动（PM2 重启 <10s） | P2 |
| **Differentiator** | Parquet 月粒度分区 | P2 |
| **Anti-Feature** | ~~GROUPING SETS~~ | 禁用 — DuckDB 已知 bug |
| **Anti-Feature** | ~~Redis 缓存层~~ | 过度工程化 |
| **Anti-Feature** | ~~全量 React.memo~~ | React 19 Compiler 自动处理 |

### Architecture (架构模式)

- **关键不变量**：SQL 生成器 NEVER 直接调用 DuckDB（只产出字符串）— 重构必须维持此边界
- **已有先例**：`sql/cost/` 和 `sql/growth/` 已有拆分模式，可直接复用
- **依赖顺序**：Phase 1→3→4 顺序强制；Phase 2 和 5 独立可并行
- **扩展性**：DuckDB 向量化 SIMD + zone map pruning，380万→1000万行查询时间不成比例增加

### Pitfalls (避坑)

| 级别 | 编号 | 陷阱 | 防范 |
|------|------|------|------|
| **CRITICAL** | C-01 | SQL 重构后结果静默错误 | 黄金快照基线建立在重构前 |
| **CRITICAL** | C-03 | 快照 scope 碰撞跨用户泄漏 | unknown 改为 next() 回退 |
| **CRITICAL** | C-02 | 物化期间连接池耗尽 | 物化期间预留 API 连接 |
| **MODERATE** | M-03 | CTE 不一定比 UNION ALL 快 | EXPLAIN ANALYZE 先于改写 |
| **MODERATE** | M-05 | PolicyFact 惰性化首请求 90s | PolicyFact 永远 eager |

## Critical Anti-Pattern

**GROUPING SETS 不能用于替换 UNION ALL** — DuckDB 有已知 bug，ROLLUP/CUBE/GROUPING SETS 子树禁用所有列裁剪，对宽 Parquet 查询性能反而更差。正确方案是 `WITH base AS (...) SELECT ... CASE WHEN ... GROUP BY`。

## Recommended Phase Structure

| Phase | 目标 | 可并行 | 预期收益 |
|-------|------|--------|----------|
| 0 | 快照安全修复 | 前置 | 堵住数据泄漏 |
| 1 | SQL 查询优化 | — | 2-5s → <500ms |
| 2 | 前端包体优化 | 与 Phase 1 并行 | 首屏加载减少 |
| 3 | 惰性物化 | 依赖 Phase 1 | 内存 70%→50% |
| 4 | 持久化暖启动 | 依赖 Phase 3 | PM2 重启 <10s |
| 5 | 快照失效精细化 | 独立 | ETL 后快照更快恢复 |

## Open Questions

- ECharts 实际 chunk 大小需 visualizer 运行后确认
- earned-premium-detail.ts CTE 可行性需 EXPLAIN ANALYZE 运行时决定
- DuckDB 持久化 .duckdb 文件跨重启行为需本地实测
- jspdf + html2canvas 是否在首屏加载路径上

---
*Research completed: 2026-04-12*
