# 保险经营图表账本（Chart Ledger）

> 路由 `/chart-ledger` · 侧边栏「工具 · 图表账本」。把「12 类经营图表方法论」按承保业务链路
> （渠道 → 承保 → 理赔 → 续保 → 财务）组织为单页，**全部图表由本项目真实数据驱动**，随全局筛选联动。

## 设计出发点

图表分类应从**业务动作**出发，而非图表形态。每张图「结论先行 + 怎么看 + 真实数据要点 + 经营动作
（加码/复制/优化/整改/预警/暂停）」，回答"看完图之后谁来改、改什么"。

## 数据映射（真实查询，无后端改动）

所有金额指标单位「元」，展示层 ÷1e4 转「万元」；比率单位「%」。异常/控制限/五数概括等"规则"在客户端计算。

| # | 图 | 维度 × 指标（真实源） |
|---|----|----------------------|
| 01 | 客群产能-质量矩阵（气泡） | `pivot` customer_category × total_premium / earned_claim_ratio / policy_count |
| 02 | 费用率异常散点 | `pivot` org_level_3 × expense_ratio / total_premium；异常 = 均值±2σ |
| 03 | 机构×险种赔付率热力图 | `pivot` org_level_3 × insurance_type × earned_claim_ratio |
| 04 | 案均赔款箱线图 | `pivot` customer_category × org_level_3 × avg_claim_amount（客群内机构分布五数概括） |
| 05 | 出险频度趋势 | `pivot` week_number × earned_loss_frequency |
| 06 | 赔款发展三角 | `claims-detail/loss-ratio-development`（起保年度 × 发展月 × 累计赔付率） |
| 07 | 报价转化漏斗 | `quote-conversion/funnel` |
| 08 | 承保利润瀑布 | `pivot` is_nev × earned_premium / earned_margin_amount / earned_claim_ratio（客户端拆解赔款/费用） |
| 09 | 机构亏损帕累托 | `pivot` org_level_3 × earned_margin_amount（负边际=亏损）+ 累计占比 |
| 10 | 险种结构树图 | `pivot` insurance_type × total_premium（占比） |
| 11 | 变动成本率控制图 | `pivot` week_number × variable_cost_ratio；控制限 = CL±2σ |
| 12 | 赔付率-保费增速四象限 | `pivot` org_level_3 × earned_claim_ratio + `performance/org-heatmap` 机构同比增速 |

> 指标全部为 pivot-safe 原子指标（见 `server/src/config/metric-registry`）；避开 L4 占位指标
> （combined_cost_amount / earned_profit_amount 等）。阈值口径见 CLAUDE.md §10 / 业务规则字典。

## 文件

- `ChartLedgerPage.tsx` — 页面装配（Hero + 三层框架 + 5 阶段 × 12 卡片 + 反方观点）
- `ledgerMeta.ts` — 静态叙述（框架/阶段/卡片「怎么看+动作」；结论句由数据动态派生）
- `hooks/useChartLedgerData.ts` — 10 个真实查询 + 逐图整形 + 结论派生（每查询错误隔离）
- `components/EchartsPanels.tsx` — ECharts 面板（气泡/散点/折线/瀑布/帕累托/控制图/四象限）
- `components/CustomPanels.tsx` — HTML/SVG 面板（热力图/发展三角/箱线图/漏斗/树图，避免膨胀共享 echarts bundle）
- `components/LedgerCard.tsx` — 单卡外壳

## 相关

- API 入口：`apiClient.getPivot(dimensions, metrics, filters, limit)`（新增，`src/shared/api/client.ts`）
- 上位方法论：源自上传 HTML「保险经营图表账本」，本页以真实数据补齐原静态 mock。
