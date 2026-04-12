# Phase 2: SQL 查询优化 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 02-sql-查询优化
**Areas discussed:** 黄金快照基线范围, 系数查询重构策略, 回归验证精度标准

---

## 黄金快照基线范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全部接口 | 50+ 个 API 端点全部纳入回归基线 | ✓ |
| 仅核心接口 | 筛选高频使用的核心端点 | |

**User's choice:** 全部 50 多个接口
**Notes:** 用户直接选择全量覆盖，不做筛选

---

## 系数查询重构策略

| Option | Description | Selected |
|--------|-------------|----------|
| 删除整个功能 | 系数监控板块从产品中移除，前后端全链路清理 | ✓ |
| CTE 窗口函数重写 | 保留功能，重构 UNION ALL 为单次扫描 | |
| 删除后从零重写 | 移除现有实现，重新设计 | |

**User's choice:** 前端系数监控页面从产品中移除，SQL 如果在其他板块不会用到也删除
**Notes:** 用户补充记得业绩分析热力图有用到平均自主系数。经代码验证，热力图的 `avg_pricing_coefficient` 是在 `performance-heatmap.ts` 中独立内联计算的，不依赖 coefficient.ts，可安全删除系数模块。

---

## 回归验证精度标准

| Option | Description | Selected |
|--------|-------------|----------|
| 严格精确匹配 | 每个字段误差为零，不接受浮点容忍度 | ✓ |
| 数值等价 | 允许浮点精度差异（如 1e-10） | |
| 逐字节一致 | JSON byte-for-byte 完全一致 | |

**User's choice:** 每个字段误差为零
**Notes:** 无额外说明

---

## 满期保费明细决策流程

**Skipped:** 用户表示暂时忘了具体上下文，明确搁置

---

## Claude's Discretion

- `formatDate` 迁移的具体目标路径
- 黄金快照的存储格式和对比脚本实现
- 删除操作的执行顺序

## Deferred Ideas

- SQL-03 满期保费明细 EXPLAIN ANALYZE — 搁置到后续阶段
- ROADMAP Phase 2 Success Criteria 需同步更新
