# 进展账本 (PROGRESS)

**状态机思维**：记录里程碑、阻塞点、下一步接力入口。详细任务追踪请查看 [BACKLOG.md](./BACKLOG.md)。

**最后更新时间**: 2026-03-13（B228）

---

## 1. 里程碑 (Milestones)

| 时间 | 里程碑 | 交付物 | 备注 |
|------|--------|--------|------|
| 2026-01-07 10:00 | 项目初始化完成 | React + Vite + DuckDB-Wasm 基础架构 | 44个单元测试通过 |
| 2026-01-07 14:30 | 数据处理链路加固 | 别名-验证模式、类型校验、数据质量检查 | 支持中英文列名，自动数据质量报告 |
| 2026-01-07 16:40 | 治理体系建立 | 三大索引 + 两本账 + 核心层 INDEX.md + 校验脚本 | 可复用、可接力、可审计 |
| 2026-01-07 17:00 | 治理体系验证完成 | 全部治理检查通过，所有 INDEX.md 已创建 | 治理脚本 3/3 检查通过 |
| 2026-01-07 17:01 | 协作操作系统化 | CLAUDE.md、AGENTS.md、工作流配置 | Commit `f64dc00` |
| 2026-01-07 17:46 | 核心功能完成 | 数据导出、图表优化、趋势分析 | Commit `7144710` (Merge PR #4) |
| 2026-01-08 09:00 | 核心功能验收完成 | KPI指标、自然周计算、UI优化完成 | 89个测试通过，前端功能正常 |
| 2026-01-08 14:55 | 项目环境与数据导入验证完成 | 修复 SQL 语法错误，验证 Parquet 导入 | 浏览器实测通过，KPI显示 7963万 |
| 2026-01-08 20:00 | 治理体系加固完成 | GEMINI.md 修复、CLAUDE.md 加固、CI/CD 配置、废弃文档标记 | 所有 5 个治理校验通过 |
| 2026-01-10 21:30 | 整体优化计划完成（阶段 1/2/3） | 组件重构、类型安全、日志迁移、ECharts 按需导入 | 治理校验通过，测试日志静音配置完成 |
| 2026-01-11 09:30 | 营业货车专项分析收敛完成 | B022-B025 验收闭环（下钻交互/布局/样式/格式化） | 代码核对完成，依赖下载 403 未能截图 |
| 2026-01-13 14:00 | 增长率分析样式修复完成 | B300 盲态视觉调试复盘与修复 | 解决了日期乱码、表头灰底、样式失效等问题 |
| 2026-01-13 14:30 | 增长率KPI三级火箭上线 | B301 实现了日/月/年三级KPI卡片 | 增强了过程管理的即时性与直观性 |
| 2026-01-13 21:00 | 技术升级规划启动 | 制定方向D技术升级计划(B122-B132) | 11个任务:测试覆盖率提升+E2E测试+性能监控 |
| 2026-01-16 10:30 | 筛选器极简化改造完成 | 置顶四维度（机构/客户/险别/续保模式）+起止日期合并+按需展开 | 对齐业务规则字典 renewal_mode 口径，测试与治理校验通过 |
| 2026-02-04 13:00 | 数据刷新至1月31日 | 加载 policy-data-20260131.parquet (24.3MB, 60,272条) | 4,289万元总保费 |
| 2026-02-04 13:30 | 代码审查与安全加固 | 移除硬编码密码、统一API_BASE、添加单元测试 | 34个新测试通过 |
| 2026-02-04 13:30 | 双DuckDB架构评估完成 | 深度分析报告，建议渐进式迁移 | 见下方§4架构决策记录 |
| 2026-02-13 | 8板块API对接参数修复（B167） | 前端6文件参数名修正 + 后端3路由结构化响应增强 | 构建+治理通过，待浏览器实测 |
| 2026-02-17 18:40 | 项目安全深度研究完成（B200） | 输出分级风险报告 + 4个整改任务（B201-B204） | 认证/会话为最高优先级，建议24小时内启动修复 |
| 2026-02-19 13:55 | 成本分析优化第一阶段完成（B205） | 修复 `type=earned-new/expense-forecast` 400 + 新增变动成本率KPI下钻看板 + API/Playwright E2E证据 | `bun run build` 与 `bun run governance` 通过；`bun run test -- --run` 仍有20个历史失败 |
| 2026-02-20 02:35 | 生产应急访问方案落地（B206） | `deploy/vps-deploy.mjs` 新增 `emergency-open/rollback-access` + `at/cron` 自动回滚 + 文档 runbook | 已支持”临时公网开放（Basic Auth）→到点自动回滚白名单”闭环，脚本语法与帮助命令验证通过 |
| 2026-02-20 13:14 | 登录循环与误判失败修复（B207） | 前端修复登录回跳循环与权限恢复抖动；后端登录增加 NFKC 标准化；线上热修并重启 PM2 | 线上验证 `admin/admin123`、`ＡＤＭＩＮ / ａｄｍｉｎ１２３` 均可成功登录 |
| 2026-02-21 22:50 | 高级筛选与玫瑰图UI/UX深度优化 (B300) | AdvancedFilterPanel.tsx 分段控制重构 + RoseChart 标签防重叠修复 | 提升了核心交互体验和可视化图表的可读性，相关构建及校验均通过 |
| 2026-02-21 22:50 | 仪表盘趋势图优化与层级动态展示 (B301) | 修改时间粒度默认值为”签单自然周”；根据用户机构层级过滤 `org_level_2` 和 `org_level_3` 维度并退化展示 | 构建、代码安全和项目内治理检测完全通过 |
| 2026-02-22 | 续保分析四象限图上线 (B302) | RenewalQuadrantView 组件嵌入续保分析页面（报价率 vs 续保率） | `bun run governance` 和构建均通过 |
| 2026-02-23 | 交叉销售保费去重修复 (B303) | transform.py 改为先 sum() 累加数值字段再去重 | check_jiayi.py 验证与源文件 100% 精确对齐 |
| 2026-02-23 | sanitizeFilename 空格修复 (B304) | 修复正则表达式，允许文件名含空格 | security.test.ts 更新并全部通过 |
| 2026-02-24 | 企微扫码混合登录上线 (B305) | 实现企微 OAuth 闭环，本地与生产环境双重热验证通过 | PR #41/#43 合并至 main |
| 2026-02-24 | 安全强化 B201+B203+B204 完成 | IP+用户名双键锁定 / 环境变量密码覆盖 / AI限流补齐 | `rateLimiter.ts` / `auth.ts` / `app.ts` |
| 2026-02-24 | E2E+组件测试框架完成 B123+B127 | 24 个图表组件单元测试通过；Playwright 配置完整含 README | `tests/components/` / `tests/e2e/README.md` |
| 2026-02-25 | API-only 分批清理零故障门禁完成 (B208) | 完成 Batch0-3：归档过渡代码、收紧 `tsconfig`、新增 TS 检查范围治理护栏、补齐运行门禁 E2E | 静态+自动化+运行门禁日志：`artifacts/cleanup-gates/2026-02-25/*.log`；报告：`开发文档/reviews/2026-02-25-api-only-cleanup-gate-report.md` |
| 2026-02-27 | 驾乘险机构趋势图表格视图交付（B213） | 新增图表/表格双视图与 CSV 下载 | `CrossSellOrgTrendChart` 支持按当前险种与机构导出 |
| 2026-02-25 | 驾乘险推介率子页面收敛完成 (B209) | 完成统一阈值规则源、KPI/下钻/时间维度着色、四象限颜色与标题规范、趋势图四粒度与版位；修复趋势 Hook 并发取消导致“无数据” | 验证证据：`bun run test -- --run tests/cross-sell-rate-status.test.ts tests/cross-sell-sql.test.ts` 7/7；`bun run governance` 9/9；API `cross-sell-trend` 四粒度均200；截图 `artifacts/b209/cross-sell-trend-verify.png` |
| 2026-02-25 | 受限账号页面权限落地完成 (B210) | 新增 `jiachengxian` 账号并实现页面白名单控制：仅仪表盘/驾乘险推介率可访问；其他页面菜单置灰不可点且 URL 自动拦截跳转 | 验证：`bun run governance`、`bun run build`、`bun run test -- --run tests/config/organizations.test.ts` 通过 |
| 2026-02-27 | 业务员姓名展示规则全项目统一完成 (B211) | 统一“仅中文名 + admin→直接个代”规则，落地到保费报表/营销战报/续保分析/增长分析，并补齐全局开发约束文档 | 代码证据：`formatSalesmanName` + 相关4页数据链路改造；验证证据：`tests/formatters.test.ts` 新增规则用例 |
| 2026-02-27 | 关键页面性能与体验升级完成 (B212) | 落地请求链路观测、前端请求合并、三类 bundle 聚合接口、热点缓存与并行查询、聚合表构建与灰度回退开关 | 验证：`bun run typecheck`、`bun run governance`、`bun run test -- --run`（783 tests）；新增 `scripts/benchmark-key-routes.mjs` 输出 `artifacts/perf/*.json` |
| 2026-02-28 | 综合分析页一体化交付完成 (B214) | 新增 `/comprehensive-analysis` 页面与 `comprehensive-bundle` 双路由（含别名），完成6模块复刻、成本页入口、灰度开关与适配层测试 | 代码证据：`server/src/sql/comprehensive-analysis.ts`、`server/src/routes/query.ts`、`src/features/comprehensive-analysis/*`、`src/features/pages/ComprehensiveAnalysisPage.tsx`、`tests/comprehensive/*` |
| 2026-03-03 | 全环境实时聚合闭环交付完成 (B215) | 后端固定实时聚合、子页面首次打开无需刷新、压测门槛与证据链全部收口 | 验证证据：`bun run test --run`（743/743）+ `bun run build` + `bun run governance` + `tests/e2e/04-subpage-no-refresh.spec.ts`；性能证据：`artifacts/perf/benchmark-key-routes-2026-03-02_21-36-27-008.json`、`artifacts/perf/benchmark-key-routes-soak-2026-03-02_21-49-52-153.json` |
| 2026-03-03 | 生产级门禁基线落地完成 (B216) | 新增统一 `production:gate` 脚本并接入 `production-gate.yml`，把治理/构建/全量测试/关键 E2E 串成单命令闭环，同时修复子页面导航 E2E 竞态 | 代码证据：`scripts/production-gate.mjs`、`package.json`、`.github/workflows/production-gate.yml`、`tests/e2e/04-subpage-no-refresh.spec.ts`；运行证据：`bun run production:gate` 全绿 |
| 2026-03-06 | 端到端回归与测试基线修复完成 (B217) | Playwright 全量 E2E 5/5 通过；修复 Vitest 误扫 `.claude/worktrees` 导致的工作树测试污染 | 代码证据：`vite.config.ts`；运行证据：`bun run test:e2e --reporter=line` 5/5、`bun run test -- --run` 不再收录 `.claude/worktrees/loving-satoshi/tests/e2e/*.spec.ts` |
| 2026-03-06 | 业绩分析热力图交互与周期数收口完成 (B219) | 点击热力图单元格即弹下钻维度选择、下钻标题动态展示已选维度、默认周期由14扩展到15，并同步更新线上验收脚本 | 验证证据：定向测试、构建、治理通过；线上复验 `output/playwright/vps-heatmap-verify-20260306_090250.json` / `20260306_130325.json` / `20260306_133056.json` 均 passed，热力图下钻 `output/playwright/vps-heatmap-drilldown-verify-1772775070694.json` 返回 1 次 `performance-drilldown` 200 |
| 2026-03-09 | 交叉销售页 UX 线框规格冻结完成 (B220) | 完成交叉销售页实现级线框规格 V1，冻结吸顶标题、顶部基础筛选、高级筛选抽屉、右侧锚点、KPI/AI/热力图/下钻/排行的模块顺序，并沉淀为可复用组件契约 | 文档证据：`开发文档/reviews/2026-03-09-cross-sell-ux-wireframe-v1.md`；关联入口：`src/components/layout/PageFilterPanel.tsx`、`src/components/layout/SidebarNavigation.tsx`、`src/features/dashboard/CrossSellAnalysisPanel.tsx` |
| 2026-03-10 | 交叉销售页 UX 重构第一阶段完成 (B221) | 页面容器切换为顶部基础筛选 + 高级抽屉，新增右侧锚点导航；`cross-sell` 页面模块顺序重排，KPI 卡片化、AI 洞察上移、趋势图极值注释和下钻表渐进披露落地 | 代码证据：`src/components/layout/DashboardAnchorNav.tsx`、`src/components/layout/PageFilterPanel.tsx`、`src/features/dashboard/CrossSellAnalysisPanel.tsx`、`src/features/dashboard/CrossSellSummaryKpiBoard.tsx`；验证证据：`bun run typecheck`、`bun run governance`、`bun run test -- --run tests/metric-polarity-color.test.ts tests/cross-sell-kpi-polarity.test.tsx` |
| 2026-03-10 | 长页面 UX 骨架第二阶段完成 (B222) | 锚点滚动改为容器级稳定实现，并把顶部基础筛选 + 右侧锚点骨架平移到业绩/增长/成本页；补齐 cross-sell 高级筛选抽屉、锚点导航和险种明细展开的 E2E 回归 | 代码证据：`src/components/layout/DashboardAnchorNav.tsx`、`src/features/pages/PerformanceAnalysisPage.tsx`、`src/features/pages/GrowthPage.tsx`、`src/features/pages/CostPage.tsx`、`src/features/dashboard/PerformanceAnalysisPanel.tsx`、`tests/e2e/05-cross-sell-ux.spec.ts`；验证证据：`bun run typecheck`、`bun run governance`、`bun run test:e2e tests/e2e/05-cross-sell-ux.spec.ts` |
| 2026-03-10 | 长页面 UX 回归基线补强完成 (B223) | Playwright 前置逻辑收敛到公共 helper，并新增 performance/growth/cost 页面骨架回归，确保顶部基础筛选、高级抽屉和业绩页锚点导航有稳定自动化保护 | 代码证据：`tests/e2e/helpers/session.ts`、`tests/e2e/04-subpage-no-refresh.spec.ts`、`tests/e2e/05-cross-sell-ux.spec.ts`、`tests/e2e/06-page-shell-ux.spec.ts`、`tests/e2e/README.md`；验证证据：`bun run test:e2e tests/e2e/04-subpage-no-refresh.spec.ts tests/e2e/05-cross-sell-ux.spec.ts tests/e2e/06-page-shell-ux.spec.ts` |
| 2026-03-10 | 业绩热力图下钻 E2E 基线补齐 (B224) | 新增性能页热力图单元格到下钻标题联动的端到端用例，锁定“热力图选中 -> 热力图下钻维度 -> 下钻表入口”主链路，避免后续再出现热力图下钻失效却单测未报的问题 | 代码证据：`tests/e2e/07-performance-heatmap-drilldown.spec.ts`、`tests/e2e/README.md`；验证证据：`bun run test:e2e tests/e2e/06-page-shell-ux.spec.ts tests/e2e/07-performance-heatmap-drilldown.spec.ts` |
| 2026-03-10 | 长表吸顶与冻结能力组件化完成 (B225) | 对照原计划里“热力图首列冻结 + 表头吸顶 + 下钻表 sticky header”要求，新增公共长表滚动容器与 sticky 样式，并落地到 cross-sell / performance 的热力图与下钻表 | 代码证据：`src/shared/styles/index.ts`、`src/shared/ui/StickyTableFrame.tsx`、`src/features/dashboard/CrossSellMetricsHeatmap.tsx`、`src/features/dashboard/CrossSellAnalysisPanel.tsx`、`src/features/dashboard/PerformanceAnalysisPanel.tsx`；验证证据：`bun run typecheck`、`bun run test:e2e tests/e2e/05-cross-sell-ux.spec.ts tests/e2e/06-page-shell-ux.spec.ts tests/e2e/07-performance-heatmap-drilldown.spec.ts` |
| 2026-03-10 | Code Review 回归项收口完成 (B226) | 修复 `cross-sell` 年维度热力图误入查询链路、热力图下钻维度循环、机构趋势程序解读口径写死，以及高级筛选计数基线不一致四类问题；补 1 条浏览器回归锁定年维度禁用态 | 代码证据：`src/features/dashboard/CrossSellAnalysisPanel.tsx`、`src/features/dashboard/CrossSellOrgTrendChart.tsx`、`src/components/layout/PageFilterPanel.tsx`、`tests/cross-sell-ux-review-fixes.test.tsx`、`tests/e2e/08-cross-sell-yearly-guard.spec.ts`；验证证据：`bun run test -- --run tests/cross-sell-ux-review-fixes.test.tsx tests/cross-sell-kpi-polarity.test.tsx tests/metric-polarity-color.test.ts`、`bun run test:e2e tests/e2e/08-cross-sell-yearly-guard.spec.ts`、`bun run typecheck`、`bun run governance`、`bun run build` |
| 2026-03-10 | AI 图文联动与 Growth 长表平移完成 (B227) | `cross-sell` AI 解读中的极值结论已沉淀为结构化注释并注入趋势图；增长分析页三张核心长表接入统一 sticky/frozen 容器，继续向原计划的“图文联动 + 全站长表一致体验”推进 | 代码证据：`src/features/dashboard/CrossSellAnalysisPanel.tsx`、`src/features/dashboard/CrossSellTrendChart.tsx`、`tests/cross-sell-trend-annotations.test.ts`、`src/features/growth/components/GrowthDetailSection.tsx`、`src/features/growth/components/GrowthComparisonSection.tsx`、`src/features/growth/components/ComparisonAnalysisPanel.tsx`；验证证据：`bun run test -- --run tests/cross-sell-trend-annotations.test.ts tests/cross-sell-ux-review-fixes.test.tsx`、`bun run typecheck`、`bun run build` |
| 2026-03-13 | Playwright 全量基线二次收敛完成 (B228) | 引入共享登录态 setup project，修复过期的页面断言与筛选抽屉匹配逻辑，恢复端到端全量回归 11/11 稳定通过，并完成真实登录/数据准确性/设计复用抽查 | 代码证据：`playwright.config.ts`、`tests/e2e/auth.setup.ts`、`tests/e2e/helpers/session.ts`、`tests/e2e/01-dashboard-flow.spec.ts`、`tests/e2e/02-filter-sql.spec.ts`、`tests/e2e/03-cleanup-zero-downtime-gate.spec.ts`、`tests/e2e/06-page-shell-ux.spec.ts`；验证证据：`bun run governance`、`bun run test:e2e --reporter=line` |
| 2026-03-06 | 今日夜间流水线执行记录补全 | 驾乘险推介率日报、机构拆分汇总与 VPS 热力图线上复验证据已归档 | 证据：`数据管理/驾乘险推荐率/输出/数据分析报告/驾乘险推介率日报_2026-03-06.md`、`数据管理/驾乘险推荐率/机构数据/数据拆分汇总.json`、`开发文档/reviews/2026-03-06-nightly-pipeline-summary.md` |
| 2026-02-26 | 驾乘险推介率布局优化 (B309) | 将客户类别等标签移到页面标题下方靠左对齐，筛选器条件右置，统一两区域Tabs和小chips块字体样式(@gemini) | `src/features/pages/CrossSellPage.tsx` 布局优化；`Tabs.tsx`增加 `size="mini"` |
| 2026-02-26 | 驾乘险推介率标签选项扩充 (B310) | 客户类别和车上责任增加“全部”/“不分保额”，支持全量数据查看(@gemini) | 修改 `CrossSellPage` 默认状态，更新前端组件、Zod校验及后端 `cross-sell-summary` SQL逻辑 |

## 2. 当前阻塞 (Blockers)

**格式**: `[BLOCKED_ID] 任务描述 - 阻塞原因 - 解决路径 - 责任人`

| ID | 任务描述 | 阻塞原因 | 解决路径 | 责任人 | 提出时间 |
|----|----------|----------|----------|--------|----------|
| - | （暂无阻塞） | - | - | - | - |

**说明**：若任务在 BACKLOG.md 中标记为 `BLOCKED`，必须在此处补充详细信息。

---

## 3. 下一步接力入口 (Next Steps)

### 3.1 新协作者入口

**必读三大索引**（5分钟）：
1. [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档
2. [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md) - 核心模块、关键文件
3. [PROGRESS_INDEX](./开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、接力规则

**选择任务**：
1. 查看 [BACKLOG.md](./BACKLOG.md)，筛选 `状态=TRIAGED` 且 `归属对象=Backlog` 的任务
2. 更新任务状态为 `IN_PROGRESS`，填写 `归属对象` 为自己
3. 开始开发，**完成后必须填写验收/证据**

### 3.2 当前待开发任务（优先级排序）

| 优先级 | 任务 ID | 描述 | 状态 | 入口文件 |
|--------|---------|------|------|----------|
| P0 | B202 | 会话安全改造：JWT 从 localStorage 迁移到 HttpOnly Secure Cookie，落地 access/refresh 双令牌机制 | PROPOSED | `src/shared/api/client.ts`<br>`server/src/routes/auth.ts` |
| P1 | B124 | 编写 React 筛选器组件单元测试（DateRangePicker / MultiSelectDropdown / AdvancedFilterPanel） | PROPOSED | `tests/components/` |
| P2 | B131 | 集成性能监控（Web Vitals） | PROPOSED | `src/shared/monitoring/performance.ts` |

### 3.3 性能监控与夜间流水线观察（2026-03-06）

- 驾乘险日报流水线已生成 `数据管理/驾乘险推荐率/输出/数据分析报告/驾乘险推介率日报_2026-03-06.md`，报告生成时间为 `2026-03-06 08:26:55`，统计周期最近 14 天，数据截止 `2026-03-06`。
- 机构拆分汇总 `数据管理/驾乘险推荐率/机构数据/数据拆分汇总.json` 显示，源数据 `每日数据_20250101_20260304.parquet` 已完成 13 家机构拆分，总记录数 `28,341`，汇总生成时间 `2026-03-06 09:06:32`。
- VPS 热力图验收在 `2026-03-06` 共留下 5 次执行记录，其中 `09:02:50`、`13:03:25`、`13:30:56` 三次通过；`09:01:02` 首次失败原因为“增长率”标签超时未可见，`13:29:49` 一次失败原因为未捕获到 `performance-org-heatmap` 的 200 响应，均在随后的重试中恢复。
- 成功验收样本 `output/playwright/vps-heatmap-verify-20260306_133056.json` 显示：热力图与 bundle 请求均返回 `200`，三类标签切换正常，`consoleErrorCount=0`。
- 下钻专项复验 `output/playwright/vps-heatmap-drilldown-verify-1772775070694.json` 显示：热力图标题已为“三级机构连续15天热力图”，下钻标题正确携带“已选维度：业务员 · 热力图机构：资阳”，并实际发起 1 次 `performance-drilldown` 200 请求。
- 当前性能监控仍以压测工件和专项验收脚本为主，`B131/B132` 尚未落地前端运行时 Web Vitals 与业务埋点；现有最近一次基线仍以 `artifacts/perf/benchmark-key-routes-2026-03-02_21-36-27-008.json` 和 `artifacts/perf/benchmark-key-routes-soak-2026-03-02_21-49-52-153.json` 为准。

### 3.4 已完成工作总结

**Phase 1：项目初始化与数据处理**（2026-01-07 上午）
- ✅ 项目初始化：React + Vite + DuckDB-Wasm 基础架构
- ✅ 别名-验证数据处理模式：多别名支持（中英文列名）
- ✅ 类型验证和数据质量检查
- ✅ 完善单元测试：44个测试全部通过

**Phase 2：治理体系建设**（2026-01-07 下午）
- ✅ 建立三大入口索引（DOC/CODE/PROGRESS）
- ✅ 创建两本账（BACKLOG.md + PROGRESS.md）
- ✅ 为核心层目录创建 INDEX.md
- ✅ 实现治理校验脚本并通过全部检查
- ✅ B010 治理一致性体系建设完成
- ✅ 协作操作系统化（CLAUDE.md、AGENTS.md）

**Phase 3：核心功能开发**（2026-01-07 下午晚些时候）
- ✅ 添加高级仪表盘和趋势分析功能
- ✅ 优化Dashboard和导出功能
- ✅ 添加数据导出依赖
- ✅ 优化图表和筛选组件交互逻辑
- ✅ 新增保单件数KPI指标并完成前后端集成
- ✅ 修复自然周/月视图SQL逻辑 (B012, B015, B016)
- ✅ 建立技术栈感知协作体系 (B013)
- ✅ 实现交互式SQL查询功能（B020）

**Phase 4：治理体系加固**（2026-01-08）
- ✅ 修复 GEMINI.md：移除废弃引用，添加三大索引和两本账
- ✅ 加固 CLAUDE.md：新增 §6 验证协议、§7 工作流集成、§8 数据准备
- ✅ 优化 check-governance.mjs：新增 2 个检查（共 5 个）
- ✅ 创建 CI/CD 工作流：.github/workflows/governance-check.yml
- ✅ 标记已废弃文档：DEVELOPMENT_PROGRESS.md
- ✅ 所有 5 个治理校验通过

**Phase 5: 视觉与交互优化**（2026-01-13）
- ✅ 修复增长率表格视觉样式与数据格式 (B300)
- ✅ 实现三级KPI卡片 (B301)

**当前重点（2026-03-06）**：
1. **会话机制升级** - `B202` 仍待把认证从 localStorage Token 迁移到 HttpOnly Secure Cookie。
2. **测试覆盖补齐** - `B124/B125` 仍缺筛选器组件与核心 Hooks 单测。
3. **E2E 用例扩展** - `B128/B129` 仍待覆盖更多业务主流程与专项分析场景。
4. **运行时性能监控补齐** - `B130-B132` 仍未落地 Sentry、Web Vitals 与自定义业务指标上报。

**下一步行动**：
- 推进 `B202`，明确 access/refresh token 与企微 OAuth 共存方案。
- 推进 `B124/B125`，补齐筛选器与 Hooks 回归测试。
- 推进 `B131/B132`，把当前脚本化验收补成运行时性能与业务指标监控。

---

## 4. 架构决策记录 (ADR)

### ADR-001: 双 DuckDB 架构评估 (2026-02-04)

**背景**：系统同时运行后端 DuckDB (Node.js) 和前端 DuckDB-WASM，导致数据双倍加载。

**现状分析**：
| 组件 | 查询调用点 | 使用率 | 职责 |
|-----|-----------|-------|------|
| 后端 DuckDB | ~8 个 API | ~15% | 认证、文件管理、少数预定义查询 |
| 前端 DuckDB-WASM | ~36 个调用点 | ~85% | 复杂业务逻辑（续保/营销/系数等） |

**问题**：
1. 内存双倍消耗（后端 + 前端各加载一份 24MB 数据）
2. SQL 逻辑分散在前后端，维护成本高
3. 数据同步风险（两个实例可能状态不一致）

**决策**：**保持现状，暂不重构**

**理由**：
1. 系统已稳定运行，无严重性能问题
2. 重构涉及 36+ 调用点，工作量大
3. 内网部署场景，内存开销可接受
4. `SqlQueryPage` 交互式查询强依赖前端 DuckDB

**未来迁移路径**（如需执行）：
```
Phase 1: 为 RenewalDrilldown、TruckAnalysis 添加后端 API
Phase 2: 前端改用 useApiQuery hooks
Phase 3: 保留 SqlQueryPage 使用前端 DuckDB，其余移除
```

**Windows 内网部署兼容性评估**：
| 层面 | 兼容性 | 说明 |
|-----|-------|------|
| 浏览器 DuckDB-WASM | ✅ 完全兼容 | 运行在浏览器，与 OS 无关 |
| Node.js 后端 | ✅ 完全兼容 | Node.js 跨平台，Windows 支持良好 |
| Bun 运行时 | ⚠️ 基本兼容 | Bun 1.0+ 支持 Windows，少数边缘 case |
| SharedArrayBuffer | ⚠️ 需注意 | 需 Chrome 92+/Edge 92+，已配置 COOP/COEP |
| 文件路径 | ⚠️ 需注意 | 代码已使用 `path.join()`，无硬编码路径分隔符 |

**Windows 部署建议**：
1. 推荐使用 Chrome/Edge 最新版（已是企业内网标配）
2. 后端可选用 `node` 替代 `bun` 以获得更稳定的 Windows 支持
3. 服务器部署时注意防火墙放行 3000 端口

---

## 附录：快速命令

```bash
# 查看待办任务
grep "PROPOSED\|TRIAGED" BACKLOG.md

# 查看开发中任务
grep "IN_PROGRESS" BACKLOG.md

# 查看已完成任务
grep "DONE" BACKLOG.md

# 运行治理校验
bun run scripts/check-governance.mjs

# 运行测试
bun test

# 查看 Git 提交历史
git log --oneline -20
```

---

**变更规则**：
- 里程碑更新：仅记录重大节点（如版本发布、核心功能上线）
- 阻塞登记：必须在 24 小时内提出解决路径或升级
- 接力入口：每完成一个里程碑后更新"下一步"
- **同步要求**：每次 Git 提交或 PR 合并后，必须同步更新 BACKLOG.md 和 PROGRESS.md
