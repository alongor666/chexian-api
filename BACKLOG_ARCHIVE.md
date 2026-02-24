# 已归档任务 (BACKLOG_ARCHIVE)

**归档说明**：
- 本文件存储已归档的历史任务，保留证据链完整性
- 归档规则：见 [BACKLOG.md](./BACKLOG.md) 归档触发条件
- 查询方式：使用"归档ID"或"原任务ID"搜索

---

## 快速查询索引

### 按归档原因
- **功能替代**：功能已被后续任务完全替代
- **代码重构**：代码已从项目中移除
- **基础设施**：已完成的基建设施

### 按原始ID范围
- **B001-B099**：[@user 归档](#user-归档)
- **B100-B199**：[@claude 归档](#claude-归档)

---

## 2026年Q1 (1月-3月)

### 功能替代类

| 归档ID | 原ID | 归档时间 | 归档原因 | 替代任务 | 核心价值 | 证据链接 |
|--------|------|----------|----------|----------|----------|----------|
| A001 | B023 | 2026-01-13 | 营业货车专项第一阶段设计被B022优化为下钻式堆叠图 | B022 | ✅ 第一阶段实现营业货车专项标签页<br>✅ 创建吨位玫瑰图和双Y分析图<br>✅ 新增6个文件（1个SQL生成器+3个图表组件+1个容器组件+1个主页面）<br>⚠️ 后续被B022优化为下钻式堆叠图（更优交互） | Commit: 见B023原始记录 |
| A002 | B102 | 2026-01-13 | 续保率排名组件被B103重构为明细表格 | B103 | ✅ 分机构月度续保率排名：12个月标签页+三条折线<br>✅ 新增查询生成器支持闰年<br>✅ 新增RenewalRateRankingPanel组件<br>⚠️ 后续被B103重构为续保明细表格（删除原组件） | Commit: 见B102原始记录 |

### 功能重复/被覆盖类（2026-02-24 归档）

| 归档ID | 原ID | 归档时间 | 归档原因 | 替代任务 | 核心价值 | 证据链接 |
|--------|------|----------|----------|----------|----------|----------|
| A099 | B133 | 2026-02-24 | 赔付率分析已被 B144 覆盖（满期赔付率在 cost.ts 实现，无独立赔案数据表） | B144 | 无独立实现；满期赔付率=已报告赔款/满期保费已纳入成本分析 | B144 验收证据 |
| A100 | B134 | 2026-02-24 | 费用率分析已被 B144 覆盖（费用率在 cost.ts 四子板块实现） | B144 | 无独立实现；项目无独立费用数据源 | B144 验收证据 |
| A101 | B135 | 2026-02-24 | 变动成本率分析已被 B144+B205 覆盖（VariableCostKpiBoard.tsx 已实现下钻看板） | B144, B205 | 无独立实现；变动成本率 KPI 看板已上线 | B205 Playwright 截图 |
| A102 | B136 | 2026-02-24 | 已赚保费分析已被 B205 覆盖（type=earned-new 口径实现） | B205 | 无独立实现；API `/api/query/cost?type=earned-new` 已验证 200 返回 | B205 curl 证据 |

### 基础设施类

| 归档ID | 原ID | 完成时间 | 类别 | 核心价值 | 证据链接 |
|--------|------|----------|------|----------|----------|
| A003 | B001 | 2026-01-07 | 数据处理 | 别名-验证数据处理模式（多别名支持、类型验证、数据质量检查） | Commit `3538897` |
| A004 | B002 | 2026-01-07 | 测试 | 完善单元测试（mapping/validator测试、kpi测试重构） | `bun test` 44个测试全通过 |
| A005 | B003 | 2026-01-07 | 文档 | 文档索引补全（为核心模块创建README） | 4个 README 已创建 |
| A006 | B004 | 2026-01-07 | 文档 | 初始化开发文档体系（创建协作规范和进度追踪） | DEVELOPMENT_PROGRESS.md, AGENTS.md 已创建 |
| A007 | B005 | 2026-01-07 | 初始化 | 项目初始化（React + Vite + DuckDB-Wasm基础架构） | Commit `cd53095` |
| A008 | B006 | 2026-01-07 | 性能优化 | 优化请求取消机制（基于批次ID的请求追踪） | `bun run scripts/check-governance.mjs` |
| A009 | B007 | 2026-01-07 | 功能 | 数据导出功能（CSV/Excel） | Commit `b3255af` |
| A010 | B010 | 2026-01-07 | 治理 | 建立治理一致性体系（索引、账本、护栏、校验脚本） | Commit `f64dc00` |

---


### 2026-01-16 批量归档 (88 个任务)

| 归档ID | 原ID | 完成时间 | 类别 | 核心价值 | 证据摘要 |
|--------|------|----------|------|----------|----------|
| A011 | B001 | 2026-01-07 | Core/Data | 别名-验证数据处理模式：实现多别名支持（中英文列名）、类型验证、数据质量检查 | Commit `3538897` |
| A012 | B002 | 2026-01-07 | Test | 完善单元测试：新增 mapping/validator 测试，重构 kpi 测试 | `bun test` 44个测试全通过 |
| A013 | B003 | 2026-01-07 | Docs | 文档索引补全：为核心模块创建 README | 4个 README 已创建 |
| A014 | B004 | 2026-01-07 | Docs | 初始化开发文档体系：创建协作规范和进度追踪 | 文件已创建 |
| A015 | B005 | 2026-01-07 | Init | 项目初始化：React + Vite + DuckDB-Wasm 基础架构 | Commit `cd53095` |
| A016 | B006 | 2026-01-07 | Enhancement/Core | 优化请求取消机制：实现基于批次ID的请求追踪 | `bun run scripts/check-governance.mjs` |
| A017 | B007 | 2026-01-07 | Feature | 添加数据导出功能：支持导出表格数据为 CSV/Excel | Commit `b3255af` |
| A018 | B008 | 2026-01-07 | Feature | 实现图表下钻功能：点击图表自动更新过滤器 | ✅ BarChart onClick事件处理（第63-64行）<br>✅ TruckDrillDownChart实现完整下钻交互<br>✅ 点击柱状图自动更新筛选器 |
| A019 | B009 | 2026-01-07 | Enhancement/Data | 数据质量检查集成：加载 Parquet 后自动展示数据质量报告 | Commit `854d2a5`<br>TypeScript: ✓ No errors<br>Tests: ✓ 12 passed |
| A020 | B010 | 2026-01-07 | Governance | 建立治理一致性体系：索引、账本、护栏、校验脚本（第一阶段） | Commit `f64dc00` |
| A021 | B011 | 2026-01-07 | Feature | 添加高级仪表盘和趋势分析功能：PremiumDashboard、周视图、月视图 | Commit `428ce0d` |
| A022 | B012 | 2026-01-07 | Enhancement/UI | 优化图表和筛选组件交互逻辑 | Commit `37449d5` |
| A023 | B013 | 2026-01-08 | Governance/Docs | 建立技术栈感知协作体系：防止重复踩坑 | 文档已创建并纳入索引，CLAUDE.md已引用 |
| A024 | B014 | 2026-01-08 | Feature/UI | 实现周视图X轴优化+累计起保占比 | 89个测试通过，待手动验证UI效果 |
| A025 | B015 | 2026-01-08 | Bug/Trend | 修复周视图月份标签与次月起保占比口径 | `bun test tests/natural-week.test.ts` 3 pass |
| A026 | B016 | 2026-01-08 | Bug/Trend | 修复周视图 month_key 日期计算错误导致查询失败 | `bun test tests/natural-week.test.ts` 3 pass |
| A027 | B017 | 2026-01-08 | Enhancement/UI | 日视图X轴显示周一与月首/末标签并追加星期 | 待用户浏览器验收（周一/月首末标签+星期显示） |
| A028 | B018 | 2026-01-08 | Bug/UI | PremiumDashboard 增加客户类别/险别组合/终端来源占比玫瑰图（终端不显示数字） | 本地代码更新（未运行测试） |
| A029 | B019 | 2026-01-08 | QA | 验证项目启动及 `优化处理后的业务数据.parquet` 数据导入流程 | 项目启动正常，数据导入成功，KPI与图表渲染正确。 |
| A030 | B020 | 2026-01-08 | Feature/Query | 实现交互式SQL查询功能（只读+聚合，Phase 2增强版） | ✅ 36个单元测试通过 (`bun test tests/sql-validator.test.ts`)<br>✅ TypeScript编译无错误<br>✅ 8个预置查询模板<br>✅ 完整功能文档 |
| A031 | B021 | 2026-01-08 | Governance | 治理体系全面加固：修复 GEMINI.md、加固 CLAUDE.md、优化校验脚本、配置 CI/CD | 所有 5 个治理校验通过 |
| A032 | B022 | 2026-01-08 | Enhancement/UI | 营业货车优化：合并双Y图为下钻式堆叠柱状图 | ✅ **交互核对**：L1堆叠柱点击下钻到吨位饼图，支持“返回机构列表”<br>✅ **样式一致性**：堆叠图使用统一 chartStyles（X轴/网格/分隔线）<br>✅ **数据正确性**：机构... |
| A033 | B024 | 2026-01-08 | Enhancement/UI | 统一数字格式化与测试：保费万元取整、占比1位小数、格式化工具与图表迁移 | ✅ **格式化核对**：formatPremium/formatRate/formatNumber 覆盖保费万位取整与占比1位小数<br>✅ **测试证据**：formatters.test.ts 覆... |
| A034 | B025 | 2026-01-08 | Enhancement/UI | 营业货车专项分析优化：外置标题、机构占比饼图、样式统一、左右布局 | ✅ **布局与组件**：玫瑰图+机构饼图左右布局、下钻堆叠图独立区域<br>✅ **样式统一**：文本/颜色与轴样式复用 chartStyles 配置<br>✅ **交互提示**：外置标题与下钻指引文... |
| A035 | B026 | 2026-01-08 | Feature/Query | SQL智能生成增强：NL2SQL、自动补全、参数化模板、验证增强（已被B048/B049实现） | ✅ B048实现NL2SQL规则引擎（12个模式规则）<br>✅ B049实现NL2SQL Hook与UI组件 |
| A036 | B027 | 2026-01-08 | Enhancement/UI | 切片器式筛选改造：签单月份筛选、吨位分段与布尔一键切换 | Commit (this change) |
| A037 | B028 | 2026-01-09 | Docs/Rules | 补充KPI口径说明并同步KPI看板优化计划口径规则 | 文档已创建并纳入 DOC_INDEX |
| A038 | B029 | 2026-01-09 | Feature/UI | KPI看板优化：增强型卡片组件+环形图可视化+承保口径实现 | ✅ **SQL层**：新增 kpi-detail.ts 生成KPI详细数据（分解数据用于环形图）<br>✅ **组件层**：新增 EnhancedKpiCard.tsx 轻量SVG自绘环形图（无ECh... |
| A039 | B030 | 2026-01-09 | Feature/Filter | 日期选择器优化：范围选择 + 今年至今默认 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A040 | B031 | 2026-01-09 | Feature/Filter | 机构-业务员联动：机构锁定后筛选业务员 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A041 | B032 | 2026-01-09 | Feature/Filter | 同城/异地机构分类按钮 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A042 | B033 | 2026-01-09 | Feature/Filter | 下拉框改造：机构/业务员/客户类别/险别组合 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A043 | B034 | 2026-01-09 | Data/Processing | 保留续保单号字段 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A044 | B035 | 2026-01-09 | Data/Processing | 保留是否交商统保字段 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A045 | B036 | 2026-01-09 | Feature/Analysis | 续保专项分析：SQL生成器 + 面板 + 标签页 | `bun test`<br>`bun run scripts/check-governance.mjs` |
| A046 | B037 | 2026-01-09 | Feature/Analysis | 分机构月度续保率排名：12个月标签页 + 三条折线（当日/当月/当年续保率） | ✅ **单元测试**：12个测试全部通过 (`bun test tests/renewal.test.ts`)<br>✅ **新增查询生成器**：`generateRenewalRateByOrgMo... |
| A047 | B038 | 2026-01-10 | QA/CodeQuality | 代码质量审查与改进：测试覆盖率70%、移除console.log、减少any类型、ECharts按需... | 审查报告已完成，待分配开发任务<br>`bun run scripts/check-governance.mjs`<br>审查报告已完成，待分配开发任务<br>`bun run scripts/che... |
| A048 | B039 | 2026-01-10 | Feature/Query | SQL查询分类扩展：增长分析/达成分析/续保分析三大新类别 | ✅ **分类扩展**：QueryCategory 从4类扩展到7类（新增增长分析/达成分析/续保分析）<br>✅ **目标数据管理**：新增 targets-2026.ts（机构/团队/业务员三级目标... |
| A049 | B040 | 2026-01-10 | Enhancement/UI | 应用全局chartStyles.ts到所有图表组件（样式统一） | ✅ **分类扩展**：QueryCategory 从4类扩展到7类（新增增长分析/达成分析/续保分析）<br>✅ **目标数据管理**：新增 targets-2026.ts（机构/团队/业务员三级目标... |
| A050 | B041 | 2026-01-10 | QA/UI | 验证营业货车优化后的样式统一性（X轴水平、网格线移除、标题外置） | ✅ PolicyFact视图日期字段转为DATE类型<br>✅ 简化SQL查询日期操作<br>✅ 所有图表功能恢复正常（KPI：总保费5亿+、60万+件；趋势图日/周/月；续保率36.38%）<br>... |
| A051 | B042 | 2026-01-10 | Enhancement/UI | 完成统一数字格式化迁移（剩余组件：BubbleChart等） | ✅ **迁移完成**：6个文件已全部迁移到统一格式化工具<br>✅ **测试验证**：225个测试通过<br>✅ **治理校验**：所有5项校验通过<br>✅ **格式统一**：所有保费显示使用for... |
| A052 | B043 | 2026-01-10 | Test | 编写formatters.test.ts单元测试（边界值、精度、千分位） | ✅ **测试增强完成**：从6个测试扩展到14个测试<br>✅ **边界值测试**：0、极大值、NaN、Infinity全覆盖<br>✅ **精度测试**：四舍五入边界情况全覆盖<br>✅ **千分位... |
| A053 | B044 | 2026-01-13 | QA | 格式化统一性回归测试（快照测试、覆盖率报告） | ✅ **覆盖率报告**：coverage-report.test.ts（47个测试，39个断言）<br>✅ **迁移验证**：formatting-migration-check.test.ts（验证... |
| A054 | B045 | 2026-01-10 | Enhancement/UI | RoseChart组件防重叠配置（标签引线、动态字体、小扇区隐藏） | ✅ 实现动态字体大小（>10扇区自动缩小2px）<br>✅ 标签布局优化（labelLayout配置）<br>✅ 小扇区标签精简（<5%只显示名称） |
| A055 | B046 | 2026-01-10 | Feature/UI | 小扇区聚合逻辑（<5%聚合为"其他"，扇区数>20启用） | ✅ aggregateSmallSectors函数（第30-66行）<br>✅ 阈值可配置（默认5%，20扇区启用）<br>✅ "其他"项tooltip显示详细列表 |
| A056 | B047 | 2026-01-10 | Enhancement/UI | 玫瑰图响应式设计（容器宽度<400px优化、字体缩小） | ✅ 动态字体计算（baseFontSize逻辑）<br>✅ 扇区数量自适应（>10扇区字体-2px）<br>✅ 响应式布局（height参数可配置） |
| A057 | B048 | 2026-01-10 | Feature/Query | NL2SQL规则引擎实现（patterns.ts：趋势、TopN、占比等模式） | ✅ **规则引擎**：12个模式规则（趋势、TopN、占比、对比、KPI）<br>✅ **实体提取**：智能提取天数、限制、时间粒度、指标、维度<br>✅ **置信度评分**：支持多规则匹配与置信度排... |
| A058 | B049 | 2026-01-10 | Feature/Query | NL2SQL Hook与UI组件（useNL2SQL、Nl2SqlPanel） | ✅ **Hook封装**：useNL2SQL Hook（转换、加载、错误处理）<br>✅ **UI组件**：Nl2SqlPanel（示例提示、输入框、结果展示）<br>✅ **集成完成**：SqlQu... |
| A059 | B050 | 2026-01-10 | Feature/Query | Monaco自动补全实现（字段/函数补全、useSqlAutocomplete Hook） | ✅ Commit `c1ae370`<br>✅ 智能字段补全（PolicyFact视图字段）<br>✅ SQL函数补全（聚合/日期/字符串函数）<br>✅ 上下文感知补全 |
| A060 | B051 | 2026-01-11 | Feature/Filter | 创建统一的数据口径选择器（签单日期/起保日期切换） | PR #60 Commit `95376e1`<br>`bun run scripts/check-governance.mjs`<br>**验收标准**：<br>✅ 新增 DateCriteriaS... |
| A061 | B052 | 2026-01-11 | Feature/Filter | 统一年度选择功能：提升到AdvancedFilterPanel | ✅ **AdvancedFilterState 新增 analysis_year**：第19行添加字段<br>✅ **年度选择器组件**：第257-286行，下拉菜单动态生成±2年选项<br>✅ **... |
| A062 | B053 | 2026-01-11 | Enhancement/UI | DateRangePicker标签动态化：支持口径切换 | ✅ **DateRangePicker.labels参数**：第29-32行（可选）<br>✅ **动态标签逻辑**：第63-64行（向后兼容默认值）<br>✅ **AdvancedFilterPan... |
| A063 | B054 | 2026-01-11 | Enhancement/UI | 续保分析特殊口径提示：UI明确说明固定使用起保日期 | ✅ 蓝色提示框已添加（第122-129行）<br>✅ 提示文案："续保率分析固定使用起保日期口径"<br>✅ 样式一致性（bg-blue-50 border-l-4 border-blue-400）<... |
| A064 | B055 | 2026-01-11 | Data/Mapping | 新增字段映射：厂牌车型、新车购置价、批单号、批改类型、商车自主定价系数 | ✅ 域字段命名：vehicle_model、new_vehicle_price、commercial_pricing_factor<br>✅ 配置中英文别名映射（各6个变体）<br>✅ 批单号/批改类... |
| A065 | B056 | 2026-01-11 | Bug/UI | 修复 DateRangePicker 无效日期字符串触发 react-datepicker Inva... | 本地代码更新（未运行测试） |
| A066 | B100 | 2026-01-11 | Enhancement/Filter | 实现 insurance_type 布尔筛选器（交强险/商业保险） | ✅ 移除TODO注释，实现布尔筛选逻辑<br>✅ 7个单元测试全部通过 (`bun test queryBuilder`)<br>✅ 治理校验通过 (`bun run scripts/check-go... |
| A067 | B101 | 2026-01-13 | Bug/Analysis | 修复增长率分析SQL歧义错误（Ambiguous reference to column name） | ✅ **根因**：FULL OUTER JOIN 查询中 groupBy 列缺少表别名<br>✅ **修复函数**：generateYoYGrowthQuery、generateMoMGrowthQu... |
| A068 | B300 | 2026-01-13 | Bug/UI | 增长率分析样式修复与数据清洗（盲态调试） | 见LESSONS_LEARNED.md复盘记录 |
| A069 | B301 | 2026-01-13 | Feature/UI | 实现增长率分析三级KPI卡片 (GrowthKpiCards) | 见增长率分析面板上方 |
| A070 | B103 | 2026-01-13 | Bug/DC-002 | P0: 修复续保明细表格日期筛选违反DC-002规则 | ✅ **问题确认**: 代码已在commit 7e6a574修复，第445行使用 `filters.policy_date_end ?? 默认值`<br>✅ **修复验证**: `generateRe... |
| A071 | B104 | 2026-01-13 | Test/DC-002 | P0: 添加DC-002合规性单元测试 | ✅ **测试文件**: 新建 `tests/dc-002-compliance.test.ts` (285行)<br>✅ **测试覆盖**: 8个测试用例，验证4个场景<br>  - 用户设置明确日期... |
| A072 | B105 | 2026-01-13 | Architecture/DC-002 | P1: 实现DC002FilterGuard类型守卫 | ✅ **类型守卫文件**: 新建 `dc-002-guard.ts` (220行)<br>✅ **核心功能**:<br>  - `extractDC002DateRange()` - 强制从filte... |
| A073 | B106 | 2026-01-13 | Governance/DC-002 | P1: 扩展治理检查脚本(DC-002自动检测) | ✅ **检测规则**: 扩展check-governance.mjs，添加第6项检查<br>  - 规则1: 禁止硬编码CURRENT_DATE（排除带DC-002 Exception注释的行）<br... |
| A074 | B108 | 2026-01-13 | Governance/MultiAgent | 多Agent任务ID冲突防护：扩展ID范围并实现自动检测 | ✅ **ID范围扩展**: @claude(B100-199), @codex(B200-299), @gemini(B300-399), @trae(B400-499), @kilo(B500-59... |
| A075 | B109 | 2026-01-13 | Architecture/View | 设计并实现图表视角切换架构（保费/商业险件数/交强险件数） | ✅ **类型系统**：ViewPerspective类型定义+3种视角配置（保费/商业险件数/交强险件数）<br>✅ **状态管理**：usePerspective Hook（全局状态+localSt... |
| A076 | B110 | 2026-01-13 | Feature/View | 实现趋势分析视角切换（日/周/月趋势图） | ✅ **SQL生成器改造**：3个函数全部支持perspective参数（generatePremiumTrendQuery、generateTotalPremiumTrendQuery、genera... |
| A077 | B111 | 2026-01-13 | Feature/View | 实现营业货车分析视角切换 | **依赖**：B109<br>**改造范围**：<br>- generateTruckOrgPremiumQuery 支持视角参数<br>- generateTruckTonnageQuery 支持视... |
| A078 | B112 | 2026-01-13 | Feature/View | 实现增长率分析视角切换 | **改造范围**：<br>- GrowthAnalysisPanel 集成 PerspectiveSwitcher<br>- useGrowthAnalysis 支持视角聚合与险类过滤<br>**验收... |
| A079 | B113 | 2026-01-13 | Feature/View | 实现续保分析视角切换 | ✅ generateRenewalDetailTableQuery 支持视角参数与险类过滤<br>✅ RenewalAnalysisPanel 集成 PerspectiveSwitcher<br>✅ ... |
| A080 | B114 | 2026-01-13 | Enhancement/UI | 筛选器UI重构：两行置顶布局 | `bun run scripts/check-governance.mjs`<br>✅ 两行置顶筛选布局（口径/年度/日期 + 机构/客户/险别）<br>✅ 其他筛选项可折叠保持向后兼容 |
| A081 | B115 | 2026-01-13 | Feature/Filter | 实现其他筛选器折叠区域（业务员/快捷组合/基本选项） | `bun run scripts/check-governance.mjs`<br>✅ 业务员/快捷组合/基本选项折叠区域已实现（Accordion）<br>✅ 默认展开快捷组合，折叠状态使用 loc... |
| A082 | B116 | 2026-01-13 | Feature/Filter | 新增"可续"快捷组合筛选器 | Commit `7be4e8d` |
| A083 | B117 | 2026-01-13 | Refactor/Naming | 重命名快捷场景为"快捷组合"，原始维度为"基本选项" | ✅ 术语更新为“快捷组合/基本选项”并同步文档<br>✅ Commit (this change) |
| A084 | B118 | 2026-01-13 | Enhancement/UI | 优质业务板块固定显示（移除折叠功能） | Commit `7be4e8d` |
| A085 | B119 | 2026-01-13 | Enhancement/Chart | 优质业务占比趋势X轴优化（<32天显示首尾月日） | Commit `7be4e8d` |
| A086 | B120 | 2026-01-13 | Enhancement/Chart | 优质业务占比趋势值标签固定显示 | Commit `7be4e8d` |
| A087 | B121 | 2026-01-13 | Feature/Table | 业务员明细拆分为双表（全部业务Top10 + 优质业务Top10） | Commit `7be4e8d` |
| A088 | B200 | 2026-01-13 | Enhancement/UX | 方向C-移动端适配：看板核心布局与表格横向滚动优化 | ✅ **VirtualTable横向滚动优化**：添加scrollbar-thin样式、sticky表头、min-w-0防止溢出<br>✅ **移动端布局优化**：PremiumDashboard响应... |
| A089 | B201 | 2026-01-13 | Feature/UX | 方向C-自定义看板：KPI与模块显示/排序自定义 | ✅ **移动端显示优化**：DashboardCustomizerPanel响应式布局、按钮flex布局、间距调整<br>✅ **UI增强**：添加emoji图标、hover效果、恢复默认按钮样式优化... |
| A090 | B202 | 2026-01-13 | Feature/Report | 方向C-报表模板：常用分析场景模板入口 | ✅ **报表模板面板**：创建ReportTemplatesPanel组件，包含6个预设模板（综合分析/业绩分析/续保分析/专项分析/增长分析/对比分析）<br>✅ **模板分类**：支持按类别筛选，... |
| A091 | B122 | 2026-01-13 | Test/Coverage | 安装测试覆盖率工具并生成基线报告 | ✅ 安装@vitest/coverage-v8 2.1.9版本（修复版本兼容性问题），生成HTML覆盖率报告（coverage/index.html），配置vite.config.ts排除DuckDB... |
| A092 | B308 | 2026-01-13 | Feature/View | 优化视角切换：移除分险种保单统计，统一为"保单件数"，支持筛选联动 | ✅ 移除 commercial_count/compulsory_count<br>✅ 新增 policy_count (requiresInsuranceTypeFilter=false)<br>✅... |
| A093 | B137 | 2026-01-14 | Performance/Cache | 方向B-1：智能查询缓存实现（LRU + TTL + 统计） | ✅ **类型系统**：缓存条目、统计信息、配置选项完整定义<br>✅ **LRU缓存**：QueryCache类支持自动淘汰、TTL过期、统计追踪<br>✅ **缓存客户端**：CachedQuery... |
| A094 | B138 | 2026-01-14 | Feature/Analysis | 方向A-3：多时间段/多口径对比分析功能 | ✅ **对比预设工具**：comparisonPresets.ts（同比YoY/环比月MoM/环比周WoW/自定义）<br>✅ **日期计算**：智能处理闰年、跨年、月末边界<br>✅ **期间对齐验... |
| A095 | B139 | 2026-01-14 | Feature/Alert | 方向A-4：业绩异常预警系统（自动检测+目标完成度提醒） | ✅ **类型系统**：AlertLevel/AlertType/AlertRule/AlertMessage/AlertSummary/TargetProgress完整定义<br>✅ **预警检测引擎... |
| A096 | B140 | 2026-01-14 | Performance/BigData | 方向B-2：大数据集加载和渲染优化（虚拟滚动+分页） | ✅ **增强虚拟滚动表格**：EnhancedVirtualTable组件（动态行高/粘性表头/排序支持/响应式布局）<br>✅ **分页加载Hook**：usePagination（客户端分页）、u... |
| A097 | B141 | 2026-01-14 | Performance/Incremental | 方向B-3：增量导入支持（智能变更检测+增量合并） | ✅ **类型系统**：DataChangeType、DataChange、IncrementalLoadResult、IncrementalLoadConfig完整定义<br>✅ **增量加载器**：... |
| A098 | B145 | 2026-01-15 | Feature/Data | 业务员保费计划数据集成（填补缺口）：团队信息、机构信息、保费计划、达成率分析 | ✅ **数据提取脚本**：extract_salesman_plan.py从Excel提取并标准化473条记录（239业务员/47团队/12机构）<br>✅ **DuckDB集成**：loadSale... |

## 按Agent分类归档

### @user 归档 (B001-B099)

| 归档ID | 原ID | 类别 | 归档原因 |
|--------|------|------|----------|
| A003-A009 | B001-B010 | 基础设施 | 已完成基建设施，保留历史记录 |

### @claude 归档 (B100-B199)

| 归档ID | 原ID | 类别 | 归档原因 |
|--------|------|------|----------|
| A001 | B023 | 功能替代 | 被B022优化（下钻式堆叠图替代双Y图） |
| A002 | B102 | 代码重构 | 被B103重构（明细表格替代排名组件） |

---

## 归档统计

**总归档任务数**: 10
- 功能替代: 2 (A001, A002)
- 基础设施: 8 (A003-A010)

**按时间分布**
- 2026-01-07: 8个任务
- 2026-01-13: 2个任务

---

## 注意事项

1. **证据保留**: 所有归档任务的证据链均完整保留在原BACKLOG.md中
2. **代码追溯**: 通过Commit Hash可追溯完整代码变更历史
3. **重新激活**: 如需恢复归档任务，可在BACKLOG.md中重新创建任务记录
4. **定期清理**: 建议每季度检查一次归档任务，移除超过1年的任务
