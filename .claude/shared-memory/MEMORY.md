# Project Memory - chexian-api

## DuckDB Migration (2026-02-12)
- Migrated from deprecated `duckdb` to `@duckdb/node-api` (Neo)
- **Version gotcha**: All `@duckdb/node-api` versions use `-r.N` suffix (e.g. `1.4.4-r.1`). Semver `^1.4.4` won't match — must use exact version like `"1.4.4-r.1"`
- **Date serialization gotcha**: Neo API returns DATE as `{days: N}` and TIMESTAMP as `{micros: N}` objects, NOT strings. Fixed in `duckdb.ts` `convertBigIntToNumber()` — converts to "YYYY-MM-DD" / ISO strings
- Removed dead code: `queryArrow()` method + `apache-arrow` dependency (zero callers)
- `sql-query.ts` had `import { Table } from 'apache-arrow'` — replaced with `Record<string, any>[]`
- `validator.ts` has `EXPECTED_TYPES` Record that must match all `ColumnMapping` keys — keep in sync when adding fields
- Server runs on Node.js (tsx), NOT Bun — multer file uploads break on Bun runtime

## 5 New Fields Added (2026-02-12)
- insurance_grade, is_cross_sell, cross_sell_premium_driver
- **2026-03-24**: 合并 insurance_grade/small_truck_score/large_truck_score 为统一的 `insurance_grade`（车险风险等级），三字段互斥（非营业客车/小货车/大货车各自的风险评级），值域统一 A-G/X
- `交叉销售保费-驾意` renamed to `交叉销售保费_驾意` (hyphen illegal in Parquet/DuckDB column names)

## Key Paths
- Local Parquet（本地，非VPS最新）: `数据管理/warehouse/fact/policy/车险2024年清单0226.parquet` / `车险2526年清单0226.parquet`
- Server entry: `server/src/app.ts`
- DuckDB service: `server/src/services/duckdb.ts`
- Column mapping: `server/src/normalize/mapping.ts`
- Login endpoint: POST `/api/auth/login` → response at `data.token` (not top-level `token`)
- AI 能力注册表: `server/src/config/capability-registry.ts`（247行）
- 需求识别服务: `server/src/services/requirement-detector.ts`
- 预设用户配置: `server/src/config/preset-users.ts`（从 auth.ts 拆出）
- 权限控制: `server/src/services/access-control.ts`
- Parquet 来源检测: `server/src/utils/parquet-source.ts`

## Key Data Files (dim tables) — Parquet 化 (2026-03-25)
- **salesman/latest.parquet**: 296 业务员主数据（编号/姓名/团队/机构/岗位/入职/离职/状态）
- **plan/latest.parquet**: 484 行计划数据（2025 业务员 232 + 2026 业务员 240 + 2026 机构 12）
- ETL 脚本: `python3 数据管理/warehouse/dim/generate_dim_tables.py`
- 源文件: 2025年分产品保费计划达成情况.xlsx + 川分销售人员名单.xlsx + 机构业务日报.xlsx + salesman_mapping.json
- 服务器加载: `duckdb.ts:loadDimParquet()` → Parquet 优先，JSON 回退
- 兼容表: SalesmanDim → SalesmanTeamMapping(compat) → SalesmanPlanFact(compat VIEW) → achievement_cache
- 旧 JSON 映射: `salesman_organization_mapping.json` 仍保留作为回退
- VPS 路径: `server/data/dim/salesman/latest.parquet` + `server/data/dim/plan/latest.parquet`

## Auth Credentials
- admin/**CxAdmin@2026!** (branch_admin) — 非 admin123，已确认（organizations.ts L342）
- 其他用户规律：leshan/leshan123, tianfu/tianfu123（`{username}123` 模式）
- bcrypt hashes 已从 `server/src/services/auth.ts` 迁移到 `server/src/config/preset-users.ts`
- SHA-256 hashes in `server/src/config/organizations.ts` (USER_CREDENTIALS, backup)
- E2E 凭据：`E2E_USERNAME=admin / E2E_PASSWORD=CxAdmin@2026!`（auth.setup.ts, 03-cleanup.spec.ts）

## Puppeteer MCP Fix
- Root cause: `@modelcontextprotocol/server-puppeteer` pins puppeteer ^23.4.0 → Chrome 131
- System Chrome already at 145. Fix: upgrade MCP puppeteer package or set executablePath

## Node.js Compatibility
- `@duckdb/node-api` uses NAPI prebuilt binaries — works on Node 18/20/22/25+ without rebuild
- Old `duckdb` package required per-ABI binaries, broke on Node 25+

## Screenshot 安全规则
- **截图使用后必须立即删除**，避免密码/凭据泄漏
- 截图仅用于验证布局/加载状态，验证完立刻调用 preview_stop 或忽略，不保留在上下文

## 统一数据管道 (2026-03-30，替代旧分域架构)
- 唯一数据目录：`warehouse/fact/policy/current/`（4 个分片 parquet，由 daily.mjs 3层分片产出）
- 唯一 ETL 入口：`node 数据管理/daily.mjs`（末尾自动调用 sync-vps.mjs）
- 唯一同步方式：`node scripts/sync-vps.mjs`（rsync current/ + dim/ + renewal/）
- 服务端加载：`app.ts` 扫描 `current/` → legacy 回退，无 daily/ 分支
- 旧架构（policy/daily/ 1913 文件、etl.mjs、split_existing.py、loadDomainParquet）已全部删除

## 报价数据口径待修正 (2026-03-24, 用户亲自处理)
- [详情](project_quote_data_issue.md)：当前"是否报价"字段不可靠，正确逻辑应以"续保单号非空"判定已报价
- 涉及源数据修正，AI 无法替代，用户待办

## 诊断工具体系 (2026-03-31, v3.0)
- [diagnose_vehicle.py 7板块](tool_diagnose_vehicle.md) — 通用诊断，支持任意 WHERE 筛选，7板块标准结构
- [diagnose_agent.py 经代诊断](tool_diagnose_agent.md) — 按经代公司诊断，新旧车三列展示
- [边际贡献额指标](project_margin_contribution_metrics.md) — 满期+预估边际贡献额，时序对比核心
- [新转续过户四分类](project_vehicle_type_classification.md) — 新车→过户→续保→转保，判定优先级
- [风险评分智能检测](project_risk_grade_detection.md) — 三字段互斥COALESCE，按客户类别自动选择
- [四级亮灯体系](feedback_four_level_alert.md) — 🟢🔵🟡🔴 替代旧三级，含阈值配置
- [7板块报告范式](feedback_diagnosis_report_structure.md) — 标准化诊断报告结构
- [赔付数据内嵌](project_claims_embedded_in_policy.md) — policy 分片已含赔付字段，claims 废弃
- [DuckDB VIEW 不支持参数化](feedback_duckdb_no_param_in_view.md) — CREATE VIEW 用 f-string+转义
- [满期公式闰年+出险率+系数口径](feedback_earned_formulas.md) — 365→policy_term闰年感知，出险率年化，系数仅商业险
- `经代名`字段仅在原始parquet中，未进PolicyFact视图

## 表格排版与指标命名规范 (2026-03-31)
- [排版规则](feedback_table_formatting_rules.md) — 文字左对齐/数字右对齐，万元单位在备注不在列头，指标全链路统一 id

## 数据分析需求确认 (2026-03-31)
- [分析口径必须让用户选择](feedback_data_analysis_ask_before_assume.md) — 模糊需求不假设，CLI加交互提示，agent先确认假设

## 数据脚本修改方法论 (2026-03-31)
- [改路径前必须验证数据](feedback_data_verify_before_path_fix.md) — 文本替换路径不够，必须 DuckDB 直查确认数据正确性

## 生产巡检工具 (2026-03-30)
- [生产巡检脚本](tool_prod_health_check.md) — `bun run health:prod`，41 端点并行 curl，~15s 完成
- [巡检方法论](feedback_inspection_method.md) — 批量检查用脚本不用 Puppeteer MCP

## 保费计划维度限制 (2026-03-30)
- [详情](project_plan_dimension_rule.md)：只有分公司/三级机构/销售团队/业务员有保费计划，其他维度不显示达成率指标

## 共享记忆机制
- [共享记忆](reference_shared_memory.md) — 所有车险项目符号链接到 `~/.claude/shared-memory/chexian/`，修复: `bash ~/.claude/shared-memory/sync-memory-links.sh`

## Lessons Learned (2026-02-13)
- **ALWAYS search project for data before giving up**: Team data existed in `salesman_organization_mapping.json` but I removed team dimension instead of looking for it. Rule: grep/glob the entire project first.
- **ASK when uncertain, don't assume**: When SalesmanPlanFact table was missing, should have asked user where team data lives instead of silently removing the feature.
- **Drilldown ≠ flat filter**: Hierarchical drill-down means click row → choose next dimension → filter+regroup, with breadcrumb trail. NOT a single dropdown selector. Always confirm interaction model with user.
