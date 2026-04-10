# P1 架构优化 — 会话交接文档

## 已完成进度

| 计划项 | Commit | 状态 |
|--------|--------|------|
| P0 全部 5 项 | `39c1ede` | ✅ Monaco 删除 + GeoJSON 懒加载 + 死代码清理 + Guard 参数化 |
| P1#6 duckdb.ts 拆分 | `eed38d0` | ✅ 1487行 → 5 模块 |
| P1#7 startServer 拆分 | `356b549` | ✅ app.ts 525→198行，DataBootstrapper 类 |
| P1#8 recharts→ECharts | `1176724` | ✅ ScissorsTrendChart 迁移，bun remove recharts |
| P1#9 SQL 大文件拆分 | `1176724` | ✅ 两个 1500+ 行文件各拆为 3 模块 |
| P1#10 KPI_SQL 废弃清理 | `91a61b3` (PR #153) | ✅ 删除 KPI_SQL 中间层，21 处引用改为 getMetricSql() 直调 |
| P1#11 VirtualTable 统一 | pending commit | ✅ EnhancedVirtualTable 零使用→删除(288行)，index.ts 导出修复 |

## P1 全部完成 🎉

P0（5项）+ P1（6项）= **11 项全部完成**。

## 遗留技术债务（本次 code review 发现但未修复）

| # | 问题 | 位置 | 原因 |
|---|------|------|------|
| M2 | useMemo 58 行超 50 行限制 | `ScissorsTrendChart.tsx:137-295` | SQL 模板图表普遍现象，强拆降低可读性 |
| M3 | `escapeSQL()` 与 `escapeSqlValue()` 重复 | `renewal-drilldown-shared.ts:29-32` | 涉及全量替换 + null 处理行为差异，需单独处理 |
| M4 | `prev_mom_data`/`prev_yoy_data` CTE 完全相同 | `performance-heatmap.ts:401-410` | 预存在问题（非本次引入），JOIN offset 不同所以结果不同 |
| M5 | 6 处 `any` 类型 | `ScissorsTrendChart.tsx` | ECharts 类型系统复杂，后续统一 |
| M-extra | `insurance_grade` 未加入路由 Zod enum | `server/src/routes/query/performance.ts:72` | 热力图传 insurance_grade 会被 Zod 默认覆盖为 org_level_3 |
| M-extra | renewal-drilldown barrel 944 行 > 800 目标 | `renewal-drilldown.ts` | 7 个生成器都是大段 SQL 模板；可再拆 distribution 模块 |

## 下一步：P2 项

| 计划项 | 复杂度 | 关键信息 |
|--------|--------|---------|
| P2#12 DuckDB CI 测试覆盖 | 大 | 方案 B：内存 DuckDB mock 层，@duckdb/node-api 支持 `:memory:` |
| P2#13 依赖注入改造 | 大 | 工厂函数模式 createDuckDBService(config)，P1#6 拆分后已具备注入点 |
| P2#14 构建内存优化 | 中 | Monaco 已删除（P0），重新评估是否仍需 4GB |
| P2#15 Layout 目录迁移 | 小 | src/components/layout/ → src/shared/layout/，~30 处 import |

## 历史教训（给 AI 的行为指导）

1. **拆分≠复制粘贴**：每一行搬运的代码都要过安全眼，特别是 SQL 模板中的字符串插值。
2. **不要导出 logger 实例**：TypeScript TS4094 泄露私有成员。每个模块自建 logger。
3. **一次只拆一个文件**：同时拆两个 1500+ 行文件，第二个质量明显不如第一个。
4. **写新 React 组件时立即使用设计系统 token**。
5. **code review 应在每个逻辑单元完成后立即执行**。
6. **删除前先 grep 确认零引用**：P1#11 发现 EnhancedVirtualTable 零调用方，从"大型统一重构"简化为"删除死代码"。

## 完整计划文件

原始计划在 `~/.claude/plans/floating-stirring-curry.md`，包含 P0-P3 全部 15 项 + 4 个长期方向。

## 验证命令

```bash
bun run build          # 零 TS 报错
bun run test           # 74 文件 / 910 测试
bun run governance     # 21 检查
```
