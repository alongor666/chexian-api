# 需求账本 (BACKLOG)

**唯一真理来源**：所有需求登记在事件日志 [`BACKLOG_LOG.jsonl`](./BACKLOG_LOG.jsonl)（append-only 真相）。本文件是其**派生视图，禁止手工编辑**。

**模型（event-log）**：写入 = 向 `BACKLOG_LOG.jsonl` **追加事件**（永不原地改行、永不挑编号）；本看板与归档由 `governance-backlog-curate.mjs` 折叠日志渲染。多分支并发写因此**结构性地不再碰号、不再产生重复行**（`.gitattributes` 对日志设 merge=union，追加天然可交换）。

**更新规则**（一律走 `bun scripts/backlog.mjs`，写入方不挑号）：
- 新增需求：`bun scripts/backlog.mjs add --actor @<agent> --priority Px --section "板块" --desc "描述" [--docs ...] [--code ...]`
- 状态流转：`bun scripts/backlog.mjs status <id> IN_PROGRESS`；完成：`bun scripts/backlog.mjs status <id> DONE --evidence "PR/commit/测试证据"`（DONE 必须带证据）
- 弃置：`bun scripts/backlog.mjs status <id> CANCELLED|WONTFIX --evidence "弃置理由"`（终态，移出活跃看板进归档，必须带理由 —— 与 DONE 同一机制）
- 补充信息：`bun scripts/backlog.mjs note <id> "..."`；修订字段：`bun scripts/backlog.mjs amend <id> --priority P1`
- 重新渲染：`bun scripts/governance-backlog-curate.mjs --apply`（折叠日志 → 刷新本文件 + 归档 + 看板）

**编号**：历史曾用号（B234…）对迁移任务保留显示以兼容旧引用；新任务用 uid（如 `2026-06-07-claude-a3f`，稳定身份，引用以 uid 为准）。

**校验**：`bun run scripts/check-governance.mjs` 校验日志完整性（事件字段 / 孤儿事件 / uid·曾用号唯一）+ 终态（DONE/CANCELLED/WONTFIX）证据链 +「视图 == 折叠(日志)」陈旧守卫。

---

## 📋 活跃任务速查（40 项 · 数据截至 2026-07-09 · 由日志折叠自动生成，请勿手工编辑）

> 已完成任务见 [BACKLOG_ARCHIVE.md](./BACKLOG_ARCHIVE.md)。重新生成：`bun scripts/governance-backlog-curate.mjs --apply`

**P1（4 项）**

- 2026-06-20-claude-f1c991 — 趋势/增长/业务员立方体首批切流（行级可加，T1 证明构建稳~0.5s/累积内存214M
- 2026-06-23-claude-801409 `IN_PROGRESS` — Phase B 隔离层根治(承接 Phase A 检测层 bc36e8 已完成 P0-P
- 2026-06-29-claude-a5aa03 `PARTIAL` — 分省隔离四道纵深防线根治（任何情况下 SC/SX 不混·fail-closed，根因=物
- 2026-07-08-claude-4210ab `IN_PROGRESS` — B346 续作·GATED（生成端在仓外）

**P2（20 项）**

- B304 `PARTIAL` — earned-premium 双口径未文档化
- B306 — DuckDB 性能高危三件套
- B311 — ETL version bump 早于视图物化竞态（后端架构审计 S4·待对账）
- B335 — 批量卫生项（21 目录排查 §3 P2 汇总）
- 2026-06-10-claude-e2240c — 续保页吨位货车(1T/2-9T/1-2T)与自卸/牵引/普货 chip 无法接通
- 2026-06-11-claude-3093a3 `IN_PROGRESS` — 重复组件收拢（全站重复审计 主题②）
- 2026-06-11-claude-fdbba5 — [口径裁决]硬编码阈值违反红线
- 2026-06-15-claude-edbd61 — B330 follow-up
- 2026-06-19-claude-35998a `PARTIAL` — cx-cli 全面能力升级（5 阶段，对齐 dbt/Cube 级语义层 CLI）
- 2026-06-20-claude-2eccfa `PARTIAL` — 山西机构规范化映射 (61 原始机构 → 11 经营单元)
- 2026-06-22-16ab1c-b842bc `PARTIAL` — 报告托管 phase-2 GATED 续作
- 2026-06-27-claude-4b1de1 — 主查询限流回落per-IP
- 2026-07-03-claude-05dff4 — 前端审查中危债打包（2026-07-03四维审查）
- 2026-07-03-claude-131dd8 — 后端审查
- 2026-07-03-claude-6c23b3 `IN_PROGRESS` — 后端审查
- 2026-07-06-claude-de1e40 — org_user 路由白名单扩展到非 query 域(/api/data、/api/ai
- 2026-07-08-claude-fd244c — [硬编码专项遗留]已赚保费月度明细模块年份深度耦合
- 2026-07-09-claude-78cc23 — sync-vps
- 2026-07-09-claude-c2c219 — 4210ab 续作·SX 机构级报告生成端（41205d9 交付 SC-only）
- 2026-07-09-claude-e17707 `PARTIAL` — diagnose-period-trend 技能省份化

**P3（16 项）**

- B247 — 图表 hex 色值审计
- B254 — wecom_smartsheet state 生命周期管理（missing_vins T
- B321 — super-powers 精髓 skills 两项后续（PR #469 审计衍生）
- 2026-06-11-claude-02aa70 `IN_PROGRESS` — 产品层冗余裁剪决策（需用户拍板，全站重复审计 主题⑤）
- 2026-06-12-claude-055a12 `BLOCKED` — 立方体灰度哨兵降频里程碑
- 2026-06-22-claude-03f6f0 — PerformanceAnalysisPanel 主组件(~900行)抽 usePerf
- 2026-07-03-claude-b714a7 — 安全审计L5
- 2026-07-03-claude-fdaa10 — 安全审计L2
- 2026-07-05-claude-fed2b1 — 评估 wecom_smartsheet 续保推送 v1（sync_renewal.py，
- 2026-07-06-claude-0e26ba — session 级 IP 绑定评估
- 2026-07-07-claude-322e6e — 矩阵热力图抽共享组件
- 2026-07-07-claude-beb706 — 热重载（同进程 ETL）后 CrossSellDailyAgg 物化表不自动重建
- 2026-07-07-claude-ca822c — KPI 卡归一到 widgets/kpi/EnhancedKpiCard
- 2026-07-07-claude-cfaf91 `IN_PROGRESS` — 企微续保同步脚本 数据管理/integrations/wecom_smartsheet/
- 2026-07-08-claude-a28f3d — 后端硬编码专项残留（需契约/业务拍板，未随批次一 2026-07-08-claude-7
- 2026-07-09-claude-50d62e — 非daily手动工具省份轴收窄（branch=None取全省）

---

## 任务列表（活跃）

| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |
|----|----------|------|----------|----------|--------|------|----------|----------|-----------|
| B247 | 2026-04-17 | Chore/Hygiene | @claude | **图表 hex 色值审计**：`WaterfallChart.tsx` / `EnhancedKpiCard.tsx` / `quoteChartColors`（index.ts:644+）等处 ECharts option 中硬编码 h… | P3 | PROPOSED | `DESIGN.md` §2 / `CLAUDE.md` §1 | `src/shared/styles/index.ts`<br>相关图表组件 |  |
| B254 | 2026-04-24 | Enhancement/Integration | @claude | **wecom_smartsheet state 生命周期管理（missing_vins TTL）**：当前 `plan_upsert` 对不再符合筛选条件的 VIN 只记录到 `missing_vins` 日志、不从 state 文件剔除… | P3 | PROPOSED | 模块 README "故障排查"章节 errcode 40058 | `数据管理/integrations/wecom_smartsheet/sync_renewal.py`(plan_upsert + new archive helpers)<br>`数据管理/integrations/wecom_smartsheet/state_archive/`(新目录)<br>`数据管理/integrations/wecom_smartsheet/config.*.json`(state_ttl_days) | 对象转移（fed2b1 评估附带结论）：v1 推送调度已退役（daily.mjs 只走 v2），config.*.json 已不存在；missing_vins 只记不删的债务在 v2 sync_renewal_v2.py plan_upse… |
| B304 | 2026-05-31 | Chore/Docs | @claude | **earned-premium 双口径未文档化**：`cost/earned-premium.ts:76-93`（+INTERVAL 364 DAY + 险类系数 α=0.82/0.94「财务口径」）vs `cost-ratios.ts:… | P2 | PARTIAL | `开发文档/审计/SQL审计报告_2026-05-31.md` §2 D-5 | `server/src/sql/cost/earned-premium.ts`(文件头 JSDoc + 76-93)<br>`server/src/sql/cost/cost-ratios.ts`(文件头 JSDoc + 53,57-63) | 架构价值审计（2026-07-04）：字段重命名（API breaking change）冻结——JSDoc 双向警示表可能已拿到 80% 收益；触发条件=再次出现双口径混用实证（过去一个月无新增混用则维持观察不做重命名） |
| B306 | 2026-05-31 | Performance/Backend | @claude | **DuckDB 性能高危三件套**：F-03 `performance-analysis/shared.ts:123-155` segmentCaseExpr 8 层 LIKE+CAST/TRIM 逐行（建议物化层预算 segment_t… | P2 | PROPOSED | `开发文档/审计/SQL审计报告_2026-05-31.md` §3 | `server/src/sql/performance-analysis/shared.ts`(123-155)<br>`server/src/sql/claims-heatmap.ts`(331)<br>`server/src/sql/growth/yoy.ts`(32-62)<br>`server/src/services/duckdb-materialization.ts` |  |
| B311 | 2026-05-31 | Bugfix/Backend | @claude | **ETL version bump 早于视图物化竞态（后端架构审计 S4·待对账）**：`duckdb-parquet-loader.ts:155` / `duckdb.ts:134` 的 `setDataVersion` 在 Polic… | P2 | PROPOSED | 后端架构审计报告（本次会话）；`.claude/rules/sql-generators.md`(duckdb.ts 红线) | `server/src/services/duckdb-parquet-loader.ts`(155)<br>`server/src/services/duckdb.ts`(134 loadParquet)<br>`server/src/services/data-bootstrapper.ts`(reloadDomains 530) | 架构价值审计冻结（2026-07-04）：最危险路径（首次 bootstrap）已由监听者注册时序缓解，残留仅日常 reload 低频窗口；触发条件=下次生产 ETL reload 时顺带验证修复（setDataVersion 挪到物化后+… |
| B321 | 2026-06-03 | Refactor/Governance | @claude | **super-powers 精髓 skills 两项后续**（PR #469 审计衍生）：(1) **上提共享仓**——`code-search-routing` / `agent-system-design-principles` 整体… | P3 | PROPOSED | PR #469 审计；`.claude/skills/silent-failure-guard.md`；`.claude/skills/rule-promotion-gate.md` | `.claude/skills/*.md`（上提候选）<br>`scripts/check-governance.mjs`(#25 空catch门已落地)<br>新增 `eslint.config.*`（待建） | 架构价值审计拆分（2026-07-04）：(1) 上提共享仓=纯搬库净简化，可做；(2) ESLint AST 硬门冻结——仓库当前无 ESLint，为「空 catch 有内容但吞异常」边缘场景从零引入整套 lint 工具链+CI 接线属防… |
| B335 | 2026-06-05 | Refactor/Quality | @claude | **批量卫生项**（21 目录排查 §3 P2 汇总）：any 收敛（前端 ECharts 回调 ~130+、services 31 用 CallbackDataParams）、escapeSqlValue @deprecated 迁 es… | P2 | PROPOSED | 开发文档/目录排查报告_2026-06-05.md §3 | src/widgets；src/shared；server/src/utils/security.ts；server/src/sql | 架构价值审计窄化（2026-07-04）：escapeSqlValue 165 处迁移移出范围——实测已是 escapeSqlLiteral 纯别名、功能完全等价，机械替换的 diff 噪音与 review 成本超过收益（五分类=纯装饰）；… |
| 2026-06-10-claude-e2240c | 2026-06-10 | 续保追踪 | @claude | 续保页吨位货车(1T/2-9T/1-2T)与自卸/牵引/普货 chip 无法接通。根因：RenewalTrackerFact 派生域缺 tonnage_segment 与 vehicle_model 字段。需续保派生域 ETL 从主表 jo… | P2 | PROPOSED | N/A | server/src/sql/renewal-tracker.ts | 审计标注（2026-07-04）：tonnage_segment/vehicle_model 仍未接入属实；本条按 D3=B 决策挂起，已被多省派生域工程（6d5a267a/f955a467）认领为子项，勿独立重复排期 |
| 2026-06-11-claude-02aa70 | 2026-06-11 | 产品决策 | @claude | 产品层冗余裁剪决策（需用户拍板，全站重复审计 主题⑤）：a) 报价转化页 A 版/B 版六专题大面积同件复用，同一内容 3 个入口，是否保留双版本；b) 成本分析页 basic 与 comprehensive 两视图明细表实质重叠（综合视图… | P3 | IN_PROGRESS | /Users/alongor666/.claude/plans/dedup-remediation-kind-black.md | src/features/quote-conversion；src/features/cost；src/features/customer-flow；src/features/report | 3 条 note，最新：PR2(a)落地:删报价转化 A 版、保留 B 版(六专题富版)。改:QuoteConversionPage 去版本切换逻辑直接渲染 VersionBView;删 VersionAView.tsx+VersionSwitcher.tsx;G… |
| 2026-06-11-claude-3093a3 | 2026-06-11 | Refactor/Frontend | @claude | 重复组件收拢（全站重复审计 主题②）：机构×维度×时间热力图 4 套独立实现（performance-org/cross-sell/claims-detail/quote-conversion）、机构→团队→业务员下钻表 5 处、KPI 卡… | P2 | IN_PROGRESS | /Users/alongor666/.claude/plans/dedup-remediation-kind-black.md | src/widgets；src/shared；src/features/dashboard | 5 条 note，最新：③格式化函数收拢·仅迁安全子集（用户 2026-07-04 拍板）：formatNum(renewal-tracker) 与 shared formatCount 对整数件数输出一致（取整不变）+ formatCount 多 null 保护… |
| 2026-06-11-claude-fdbba5 | 2026-06-11 | 指标口径 | @claude | [口径裁决]硬编码阈值违反红线：drilldown.ts:216、top-salesman.ts:162 四象限 growth_rate>=7/achievement_rate>=100，注册表阈值为 10/5/2 与 110/100/95… | P2 | PROPOSED | N/A | server/src/sql/performance-analysis/drilldown.ts,server/src/sql/kpi-detail.ts | 窄化（2026-07-04 审计）：7%/100% 硬编码阈值已改 QUADRANT_GROWTH_THRESHOLD/QUADRANT_ACHIEVEMENT_THRESHOLD 常量（源自注册表 thresholds），该部分已解决；残… <br>架构价值审计冻结（2026-07-04）：SAME_CITY_ORGS_BY_BRANCH 机构白名单本质是地理行政区划事实，已显式常量化+按省分组注释，接受为合理设计决策；触发条件=6 个月内新增机构 ≥3 次都需同步改白名单，才值得注册… |
| 2026-06-12-claude-055a12 | 2026-06-12 | 性能/灰度收尾 | @claude | 立方体灰度哨兵降频里程碑：现在每小时一次；待 CUBE_ROUTING_ENABLED='true' 切流稳定 1 个月后（mismatch 持续 0、cost.exact 稳定）改 .github/workflows/cube-grays… | P3 | BLOCKED | N/A | .github/workflows/cube-grayscale-sentinel.yml,scripts/sentinel/README.md | 3 条 note，最新：架构价值审计（2026-07-04）：成本/KPI 立方体已 owner 拍板退役（65f495 CANCELLED），哨兵此后仅服务趋势/增长/业务员立方体（f1c991）；触发条件不变=切流后 30 天降频；若 f1c991 时间盒（2… |
| 2026-06-15-claude-edbd61 | 2026-06-15 | Refactor/Frontend | @claude | B330 follow-up：components/layout → features 依赖倒置（TopNavigation/PageFilterPanel）。当前 TopNavigation 直接 import features/file… | P2 | PROPOSED | ARCHITECTURE.md §2.2 | src/components/layout/TopNavigation.tsx;src/components/layout/PageFilterPanel.tsx;src/App.tsx | PR #643 同时关闭了 shared→features 第 6 处（orgSalesman），但 layout→features 倒置（TopNavigation 用 features/file 的 3 个 Modal、PageFilt… |
| 2026-06-19-claude-35998a | 2026-06-19 | Enhancement/Architecture | @claude | cx-cli 全面能力升级（5 阶段，对齐 dbt/Cube 级语义层 CLI）。背景：实测 cx-cli 分析内核是「单表牢笼 + 黑箱路由 + 零自省 + 错误不透明」，派生域分析既算不了也验不了（续保率无法在工具内独立验算）。计划见 … | P2 | PARTIAL | .claude/plans/cx-cli-swift-pudding.md | server/src/config/sql-federation-policy.ts,server/src/utils/sql-validator.ts,server/src/utils/sql-permission-injector.ts | 3 条 note，最新：架构价值审计冻结 P2/P3（2026-07-04）：P0-P1.5 每步对应已发生的真实故障，P2 语义层/P3 --explain 对应的是「对标 dbt/Cube」抽象目标（防假想敌）；触发条件=出现第二个真实场景证明 /pivot … |
| 2026-06-20-claude-2eccfa | 2026-06-20 | 数据/ETL · 多省机构口径(G5/G6) | @claude | 山西机构规范化映射 (61 原始机构 → 11 经营单元)。用户 2026-06-19 已定: 02=太原一部, 10=太原二部, 01=经代/车商/重客(合并为一单元，需按业务员人员进一步细分，后续补充); 地理类区域码清晰(03大同/0… | P2 | PARTIAL | 开发文档/multi-branch/口径对齐_山西.md | 数据管理/pipelines/transform.py | 4 条 note，最新：下游依赖发现（2026-07-09，来自 e17707 SX period-trend 报告省份化）：SX 近月(2026)保单 org_level_3 仍全为『其他』——未清分到 11 经营单元；仅历史(定稿 2021~2025-05)已… |
| 2026-06-20-claude-f1c991 | 2026-06-20 | 立方体加速 | @claude | 趋势/增长/业务员立方体首批切流（行级可加，T1 证明构建稳~0.5s/累积内存214MB/任意签单日窗命中；cost/kpi 已搁置见 65f495）。前置：CUBE_SHADOW_COMPARE=true 影子期已启动。晋级门槛(cub… | P1 | PROPOSED | 开发文档/架构设计/通用立方体查询加速方案.md | ecosystem.config.cjs server/src/services/cube-routing.ts scripts/release/cube-promote.mjs | 2026-06-22 门槛核验(cube-promote+/health+哨兵issue#608)：切流未就绪——①影子样本 trend/salesman-ranking 仅 12~14≪门槛1000(PM2 reload 重置+并发部署频… <br>架构价值审计（2026-07-04）：趋势/增长/业务员立方体为活资产（与已退役的成本/KPI 立方体独立）；样本积累被 PM2 reload 重置打断是门槛打不满的根因——先修 294022（冷启动 502）间接解锁。时间盒：2026-0… |
| 2026-06-22-16ab1c-b842bc | 2026-06-22 | Enhancement/Backend | 16ab1c | 报告托管 phase-2 GATED 续作：生产方 emit 机构归属 sidecar。B328 phase-2 已在 reports.ts 实现 sidecar 解析+org 行级安全（36 单测+live 验证），但生产方未写 .met… | P2 | PARTIAL | 开发文档/缺口清单.md | 数据管理/integrations/wecom_bot/push_html.py |  |
| 2026-06-22-claude-03f6f0 | 2026-06-22 | 前端重构 follow-up | @claude | PerformanceAnalysisPanel 主组件(~900行)抽 usePerformancePanelController hook —— b331 拆分后续。codex 闸-1 判此项需先补行为测试再动(主组件 10+ 耦合 s… | P3 | PROPOSED | N/A | src/features/dashboard/PerformanceAnalysisPanel.tsx | 3 条 note，最新：check-merged-drift 命中 1e19b486(b331 拆分主提交,已在 main)系误报：该提交正是事项描述中『codex 闸判需先补行为测试、b331 本轮不做』的那次拆分，未实现 usePerformancePanel… |
| 2026-06-23-claude-801409 | 2026-06-23 | 数据架构 · 多省 Phase B 隔离层(current/<省>/子目录) | @claude | Phase B 隔离层根治(承接 Phase A 检测层 bc36e8 已完成 P0-P4): 用分省子目录 current/<省>/ 替代 #753 扁平目录+SX_前缀+rsync filter。高爆炸半径,用户 2026-06-23 … | P1 | IN_PROGRESS | 开发文档/multi-branch/省份派生化与子目录方案_2026-06-23.md | server/src/services/data-bootstrapper.ts | 7 条 note，最新：生产 cutover 实跑完成（2026-07-07，Fable 5 会话）：SOP T-0~T-7 全勾。关键数字——迁移 5 个 parquet（SC 3 + SX 2，本地 find 先 SX_ 后 SC）；生产 reload 后 D… |
| 2026-06-27-claude-4b1de1 | 2026-06-27 | 限流/中间件 | @claude | 主查询限流回落per-IP：限流中间件在authMiddleware之前执行(rateLimiter.ts:21注释)，req.user未注入→keyByPatOrUser回落到IP。NAT后同机构多用户共享100/60s桶,高频操作互相挤… | P2 | PROPOSED | N/A | server/src/middleware/rateLimiter.ts | 架构价值审计冻结（2026-07-04）：触发条件=真实业务场景限流误伤（非一次性并发测试触发）。届时先试最简修法：提高已认证用户桶容量（一行常量），不上 auth 后二次限流中间件 |
| 2026-06-29-claude-a5aa03 | 2026-06-29 | 架构治理/多省 | @claude | 分省隔离四道纵深防线根治（任何情况下 SC/SX 不混·fail-closed，根因=物理混放current/+靠记得加WHERE branch_code的fail-open默认混省）：①统一取数入口SSOT(三运行时JS/诊断Python… | P1 | PARTIAL | 开发文档/multi-branch/省份派生化与子目录方案_2026-06-23.md | 数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py | 4 条 note，最新：架构价值审计（2026-07-04）：P4 子目录化并入 801409 主线（owner 已拍板 B3 终局）；P1 出口零信任断言保留——与路径方案正交的纵深第二层，子目录化后仍有价值；P0/P2/P3 待子目录落地后重估（checkPo… |
| 2026-07-03-claude-05dff4 | 2026-07-03 | 前端 | @claude | 前端审查中危债打包（2026-07-03四维审查）：①copilot/forecast手写fetch绕过apiClient(useForecastBaseline.ts:421等4处) ②业务阈值硬编码无SSOT(comprehensive… | P2 | PROPOSED | N/A | src/features/copilot,src/shared/api/client-core.ts,src/app/App.tsx | 架构价值审计拆分处置（2026-07-04）：①手写fetch统一入口③403/429全局拦截④staleTime双态bug⑥Panel错误态→立即做；②阈值SSOT（归入既有注册表，禁新建第9个）⑧E2E补齐→按需排期；⑤9hook与Re… |
| 2026-07-03-claude-131dd8 | 2026-07-03 | CI/测试 | @claude | 后端审查：CI 完全不跑 DuckDB 原生绑定集成测试(vite.config.ts exclude 22个 duckdb-*.test.ts + 立方体影子对账7个)，含当前最活跃的多省 RLS 隔离测试(duckdb-branch-r… | P2 | PROPOSED | N/A | vite.config.ts |  |
| 2026-07-03-claude-6c23b3 | 2026-07-03 | 生产可靠性 | @claude | 后端审查：核心数据目录 policy/current(critical) 走普通 rsync --delete 非原子，覆盖期间与意外重启/reload 重叠会 glob 到半份数据(仅 customer_flow/new_energy_c… | P2 | IN_PROGRESS | N/A | scripts/sync-vps.mjs |  |
| 2026-07-03-claude-b714a7 | 2026-07-03 | 安全 | @claude | 安全审计L5：诊断报告(diagnose-*skills)生成HTML时,数据字段(机构名/业务员名)的转义依赖skill层;配合报告CSP的script-src 'unsafe-inline',存在理论性数据驱动XSS(数据来自内部BI字… | P3 | PROPOSED | N/A | N/A | 5 条 note，最新：check-merged-drift 命中 d6ad418e/40092939(PR #944) 系误报：#944 是漂移误报压制机制本身（其账本改动引用本 uid 作先例），未动 diagnose-* skills HTML 转义。保持 … |
| 2026-07-03-claude-fdaa10 | 2026-07-03 | 安全 | @claude | 安全审计L2：Express全局CSP scriptSrc保留'unsafe-inline'(csp.ts:29)。当前Express唯一HTML响应是报告(reports.ts自设REPORT_HTML_CSP覆盖全局),JSON/hea… | P3 | PROPOSED | N/A | server/src/config/csp.ts | 架构价值审计冻结（2026-07-04）：Express csp.ts 的 unsafe-inline 实测无功能影响（唯一 HTML 响应 reports.ts 有独立 REPORT_HTML_CSP；SPA 的 CSP 基线已由 PR … |
| 2026-07-05-claude-fed2b1 | 2026-07-05 | 数据管道/企微 | @claude | 评估 wecom_smartsheet 续保推送 v1（sync_renewal.py，daily.mjs 现役调度）退役并统一到 v2（sync_renewal_v2.py + field_registry*.yaml）：先确认 v2 功… | P3 | PROPOSED | N/A | 数据管理/integrations/wecom_smartsheet/ | 评估完成（严格对等矩阵）：①推送引擎职责 v2 完全对等且严格更优——v1 DEFAULT_SCHEMA 18 个 field_id 在 field_registry.yaml 全部有声明且实例 fields_enabled 全启用；sta… |
| 2026-07-06-claude-0e26ba | 2026-07-06 | 安全治理 | @claude | session 级 IP 绑定评估:allowedIps 目前只在登录时校验一次(JWT 签发后不再比对,PAT 侧已于权限治理 PR 补齐每次校验)。若要 JWT 会话也绑 IP,需评估移动网络/办公网出口 IP 漂移导致正常用户会话中断… | P3 | PROPOSED | N/A | server/src/middleware/auth.ts,server/src/services/auth.ts:136 | check-merged-drift 命中 c59a5058/37a3c234(PR #943) 系误报：#943 只补了 PAT 侧每次 IP 校验（事项文本自述），JWT session 侧未动——origin/main 核实 midd… |
| 2026-07-06-claude-de1e40 | 2026-07-06 | 安全治理 | @claude | org_user 路由白名单扩展到非 query 域(/api/data、/api/ai、/api/agent、/api/copilot 等)需改为按域显式声明是否纳管,替代 mountedOutsideQuery 一刀切跳过。⚠️ 242… | P2 | PROPOSED | N/A | server/src/middleware/permission.ts:186-201 | check-merged-drift 命中 c59a5058/37a3c234(PR #943) 系误报：本项是 #943 会话立的 follow-up（按域显式声明纳管），origin/main 核实 permission.ts moun… |
| 2026-07-07-claude-322e6e | 2026-07-07 | 前端重构 follow-up | @claude | 矩阵热力图抽共享组件：业绩机构热力图V2(8组件族)、交叉销售指标热力图、赔案热力图、报价转化维度热力图四套并存，抽「行×期矩阵+打灯+下钻回调」共享件，各页保留取数与口径。侦察证据见 开发文档/架构设计/前端极简架构规划_2026-07-… | P3 | PROPOSED | 开发文档/架构设计/前端极简架构规划_2026-07-07.md | N/A |  |
| 2026-07-07-claude-beb706 | 2026-07-07 | 数据管道 | @claude | 热重载（同进程 ETL）后 CrossSellDailyAgg 物化表不自动重建：LazyDomainRegistry 对已 loaded 域 no-op，invalidateCache 只清 SQL 缓存不重建物化表——交叉销售数据可能滞… | P3 | PROPOSED | N/A | server/src/services/lazy-domain-registry.ts,server/src/services/data-bootstrapper.ts |  |
| 2026-07-07-claude-ca822c | 2026-07-07 | 前端重构 follow-up | @claude | KPI 卡归一到 widgets/kpi/EnhancedKpiCard：GrowthKpiCards、CrossSellSummaryKpiBoard、VariableCostKpiBoard、quote-conversion KpiCa… | P3 | PROPOSED | 开发文档/架构设计/前端极简架构规划_2026-07-07.md | N/A |  |
| 2026-07-07-claude-cfaf91 | 2026-07-07 | 架构治理/多省 | @claude | 企微续保同步脚本 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py 的 ORG_SLUGS 常量写死四川12机构中文名→拼音slug映射（高新→gaoxin等）… | P3 | IN_PROGRESS | N/A | 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py | 实现完成，PR #1002（ready，未 auto-merge）：slug 抽到省份化 SSOT org-slugs.json；CI Governance+Production Gate 双绿；合并后置 DONE。 |
| 2026-07-08-claude-4210ab | 2026-07-08 | 安全 | @claude | B346 续作·GATED（生成端在仓外）：diagnose-period-trend 按机构产出报告。skill（alongor666-skills 仓 ~/.claude/skills/diagnose-period-trend）当前只… | P1 | IN_PROGRESS | 开发文档/缺口清单.md | 数据管理/daily.mjs | 4 条 note，最新：生成端 skill --org 采用落地（非重建）：远端未合并分支 origin/claude/diagnose-period-trend-org-reports（41205d9 v2.3.0）审查干净（SQL注入单引号双写转义/率值赔案半… |
| 2026-07-08-claude-a28f3d | 2026-07-08 | 架构治理/硬编码 | @claude | 后端硬编码专项残留（需契约/业务拍板，未随批次一 2026-07-08-claude-773784 改动）：①/api/query/cost?type=earned-new 保单年度已赚保费 API 契约把年份烧进函数名与响应键（gener… | P3 | PROPOSED | N/A | server/src/sql/cost/earned-premium-detail.ts；server/src/routes/query/cost.ts；src/features/premium-report/ |  |
| 2026-07-08-claude-fd244c | 2026-07-08 | 指标口径 | @claude | [硬编码专项遗留]已赚保费月度明细模块年份深度耦合：后端 earned-premium-detail.ts 写死 2025/2026/2027（generatePolicy2025/2026EarnedPremiumQuery、滚动汇总 U… | P2 | PROPOSED | N/A | server/src/sql/cost/earned-premium-detail.ts,src/features/cost/utils/transformData.ts,src/features/cost/utils/cost-summary-calc.ts,src/features/dashboard/crossSellRateStatus.ts |  |
| 2026-07-09-claude-50d62e | 2026-07-09 | 数据/ETL·多省债 | @claude | 非daily手动工具省份轴收窄（branch=None取全省）：agent_diagnose_report.py/sync_may_renewal_fields.py/tools/analyze_flow.py/scripts/ad-hoc… | P3 | PROPOSED | 开发文档/reviews/2026-07-08-B5子目录cutover残留glob排查.md | N/A |  |
| 2026-07-09-claude-78cc23 | 2026-07-09 | 生产可靠性 | @claude | sync-vps: claims_detail 原子同步（承接 2026-07-03-claude-6c23b3 范围拆分）。claims_detail 与 policy/current 同为 critical:true 且同被 loadM… | P2 | PROPOSED | N/A | scripts/sync-vps.mjs |  |
| 2026-07-09-claude-c2c219 | 2026-07-09 | 安全 | @claude | 4210ab 续作·SX 机构级报告生成端（41205d9 交付 SC-only）：SC 机构 org_user 本级报告已解锁，但 SX 机构 org_user 仍『本机构报告暂未生成』。根因两处：(L2) diagnose-period… | P2 | PROPOSED | 开发文档/缺口清单.md | alongor666-skills/skills/diagnose-period-trend/lib/query.py |  |
| 2026-07-09-claude-e17707 | 2026-07-09 | 技能层 · 多省报告省份化（4210ab SX follow-up） | @claude | diagnose-period-trend 技能省份化：SX 三级机构 org_user 首页卡打开本级「短中长期对照」报告（当前恒显示「本机构报告暂未生成」）。根因=skill lib/query.py policy_glob/claim… | P2 | PARTIAL | 开发文档/缺口清单.md | alongor666-skills/skills/diagnose-period-trend/lib/query.py | 4 条 note，最新：PUSH BLOCKED（用户侧网络/鉴权，非代码问题）：skills 仓改动已本地提交 f5f6418（分支 claude/dpt-sx-province-e17707，含 1d84f50+75adcc7+本 SX 提交，待一并 PR 到… |
