# 需求账本 (BACKLOG)

**唯一真理来源**：所有需求、任务、变更请求必须在此登记，不得在其他文件散落记录。

**更新规则**：
- 新增需求：添加新行，状态设为 `PROPOSED`
- 状态流转：`PROPOSED → TRIAGED → IN_PROGRESS → DONE` 或 `BLOCKED`
- 完成任务：状态设为 `DONE` 时，**必须填写验收/证据**

**校验脚本**：`bun run scripts/check-governance.mjs` 会检查 DONE 任务的证据链完整性。

---

## 任务列表

| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |
|----|----------|------|----------|----------|--------|------|----------|----------|-----------|
| B234 | 2026-03-25 | Enhancement/Backend | @claude | 续保分析自由维度下钻：后端 API 从固定层级（company→org→team→salesman→coverage）改造为 groupBy+drillPath 动态查询模式，前端 hook 同步适配 | P2 | PROPOSED | N/A | `server/src/sql/renewal-drilldown.ts`<br>`server/src/routes/query/renewal.ts`<br>`src/features/dashboard/hooks/useRenewalDrilldown.ts`<br>`src/features/dashboard/RenewalDrilldownPanel.tsx` | 当前续保 API 按固定5层级设计（level 参数），前端使用线性下钻 + DrilldownCell(autoOnSingle)。升级为自由维度模式需：1) 后端 SQL 生成器支持动态 GROUP BY 2) API 参数从 level 改为 groupBy+drillPath 3) Hook 从线性状态机改为 drillPath+currentGroupBy+availableDimensions 模型 |
| B235 | 2026-03-25 | Enhancement/Backend | @claude | 假日营销自由维度下钻：后端 API 从固定2层（org→salesman）改造为 groupBy+drillPath 动态查询模式 | P3 | PROPOSED | N/A | `server/src/sql/marketing-report.ts`<br>`server/src/routes/query/marketing-report.ts`<br>`src/features/marketing-report/components/HolidayDrilldownPanel.tsx` | 假日营销当前仅2层固定下钻，改造为自由维度可支持按团队、新能源、续保等维度分析假日营销表现 |
| B236 | 2026-03-25 | Enhancement/Frontend | @claude | 驾意险 insurance_grade 维度下钻支持：后端 cross-sell SQL 生成器添加 insurance_grade 作为可选 GROUP BY 维度 | P2 | PROPOSED | N/A | `server/src/sql/cross-sell.ts`<br>`src/features/dashboard/hooks/useCrossSellAnalysis.ts`<br>`src/shared/config/drilldown-dimensions.ts` | drilldown-dimensions.ts 已预留 CrossSellDrillDimension 扩展点，待后端 SQL 支持后前端添加 insurance_grade 到 ALL_DIMENSIONS |
| B237 | 2026-03-30 | Chore/Hygiene | @user | 废弃路由退出机制：query.ts 红线"只追加不删除"增加退出条件——用户明确确认 + 日志证明零流量后，允许清理废弃端点。当前无废弃端点（premium-plan 和 plan-achievement 均有前端调用方） | P4 | PROPOSED | `CLAUDE.md` §2 护栏 | `server/src/routes/query/premium-plan.ts`<br>`server/src/routes/query.ts` | 清理条件：1) 用户确认 2) 生产日志证明 ≥30 天零流量 3) 前端无调用方（grep 验证） |
