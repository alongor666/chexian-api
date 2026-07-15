# 销售队伍业绩（sales_team_performance）— 板块索引与协作规范

> 最后更新: 2026-07-15 · 标保口径迁移自《标保核对表（新版）.xlsx》
> 落地提交: c62b0bb9（phase 1+2）· 口径决策: sales_portrait 仓库 ADR-006

本文件是「销售队伍业绩」板块的**单一导航入口**：新会话 / 审核人 / 接手人读完即可定位
该板块的口径、字段、ETL、代码、注册表、测试与协作规则，无需重新摸索。

## 1. 业务定义

- 一行事实 = 一张山西直营华安保单（标保底表 A:K 原样，来自 BI 系统导出）。
- 核心指标 **标保** = 实收保费 × 险种系数 × 一司一策系数（大同机构车险自 2025-05-15 起
  最终系数封顶 1.05）。这是修复后口径，非底表原值。
- 按 业务员 / 销售团队 / 机构 / 险种大类 四个维度聚合展示实收保费与标保。
- 时间维度 = 承保确认时间窗口（标保考核口径，非签单日期）。

下游服务端固定读取：
`数据管理/warehouse/fact/sales_team_performance/biaobao_enriched.parquet`

## 2. 口径 / 规则（审核核心）

| 地址 | 作用 | 性质 |
|---|---|---|
| `数据管理/pipelines/sales_team_rules.sql` | **规则层唯一事实源（SSOT）**：三套险种系数规则 + 一司一策 + 大同封顶 | 改口径只改这里 |
| `../sales_portrait/02_decisions/ADR-006_口径迁移chexian-api数据域.md` | 迁移决策 + 隐性规则清单（信用保证险硬编码 0.65、P/Q 非死列、15 行冲销单兜底） | 决策记录 |
| `../sales_portrait/02_decisions/ADR-001~005*.md` | 前序口径修复（一司一策 / 个代默认系数 / 团队匹配 / 报表切换 / 金融标保） | 历史演进 |
| `../sales_portrait/03_technical_design/验证基准.md` | 回归基准值清单 | 回归测试 |

**关键基准（改动后必须命中）**：标保总额 `150,327,494.46`｜业务员 118050119郭保东
按人汇总 `646,751.2375`｜`194,191` 行｜未匹配折标的车险 `15` 行按系数 1 兜底。

## 3. 字段 / 数据字典

| 地址 | 内容 |
|---|---|
| `../sales_portrait/03_technical_design/数据字典.md` | 标保底表 A:K 字段含义、四层架构、已知数据坑（保单号非唯一等） |
| `数据管理/data-sources.json` → `sales_team_performance` | 域契约：key_fields / output / update_cadence |
| `src/features/sales-team-performance/types.ts` | 前端字段 TS 类型（维度 / 行 / 汇总） |

## 4. ETL / 数据

| 地址 | 作用 |
|---|---|
| `数据管理/pipelines/sales_team_etl.py` | 抽取 xlsx→parquet + 回归断言 + `--verify-workbook` 逐行对账 |
| `数据管理/warehouse/fact/sales_team_performance/biaobao_enriched.parquet` | 规则层算好的明细（服务端直读，本机产物，不入 git） |
| `数据管理/warehouse/dim/standard_coeff_factor/` | 车险折标因子规则表 parquet |

运行（含迁移对账）：
```
python3 数据管理/pipelines/sales_team_etl.py -i "<标保核对表（新版）.xlsx>" --verify-workbook
```

## 5. 服务端代码

| 地址 | 作用 |
|---|---|
| `server/src/services/duckdb-domain-loaders.ts` → `loadSalesTeamPerformance` | parquet → 视图 `SalesTeamPerformanceFact` |
| `server/src/services/data-bootstrapper.ts` | 惰性域注册（首次访问触发加载） |
| `server/src/config/paths.ts` → `getSalesTeamPerformancePaths` | parquet 路径解析 |
| `server/src/sql/sales-team-performance.ts` | SQL 生成器（维度白名单 + 日期校验 + limit 校验） |
| `server/src/routes/query/sales-team-performance.ts` | REST 路由（admin-only + 缓存 + ETag） |

## 6. 注册表（域接入平台的登记点）

| 地址 | 登记内容 |
|---|---|
| `server/src/config/api-routes.ts` | 后端路由常量 `SALES_TEAM_PERFORMANCE` |
| `server/src/config/query-routes-metadata.ts` | 路由目录元数据（参数、时间窗口口径） |
| `server/src/config/route-param-contracts.ts` | 参数契约 |
| `src/shared/api/routes.ts` + `client.ts` | 前端路由镜像 + `getSalesTeamPerformance` |
| `src/shared/config/routeRegistry.ts` | 前端页面路由 |
| `src/app/App.tsx` | 页面懒加载挂载 |

## 7. 前端页面

| 地址 | 作用 |
|---|---|
| `src/features/sales-team-performance/SalesTeamPerformancePage.tsx` | 页面主体（维度切换 + 日期窗 + 汇总卡 + 明细表） |
| `src/features/sales-team-performance/hooks/useSalesTeamPerformance.ts` | React Query 数据 hook |
| `src/features/sales-team-performance/index.ts` / `types.ts` | 导出 / 类型 |

页面路由：`/#/sales-team-performance`（hash 路由）；导航入口在「增长」组「队伍」。

## 8. 测试

| 地址 | 覆盖 |
|---|---|
| `tests/api/sales-team-performance.route-contract.test.ts` | 路由契约自证（8 项） |
| `server/src/sql/__tests__/sales-team-performance.test.ts` | SQL 生成器单测（7 项） |

## 9. 协作 / 管理规则

1. **改口径 = 改 `sales_team_rules.sql`**，绝不在 TS / SQL 生成器里复制规则。改完必跑
   `sales_team_etl.py --verify-workbook` 确认与工作簿零差异（双轨期铁律，
   见 sales_portrait 遗留问题 #21）。
2. **双轨同步**：Excel 工作簿系数公式与 `sales_team_rules.sql` 必须同步改，否则口径漂移。
   工作簿退役前一直如此。
3. **待办登记**：`BACKLOG.md`（看板）+ `BACKLOG_LOG.jsonl`（真源），命令
   `bun scripts/backlog.mjs add ...`。org_user 开放本页的后续项已登记
   `2026-07-14-claude-c14756`（P3）。
4. **提交纪律**：走 分支 → PR → 必需检查绿，**禁止直推 main**（main push 触发生产部署）。
   改动前跑 `bun run governance` + `bun run typecheck` + `bun run test --run`。
5. **权限现状**：路由 admin-only（`requireBranchAdmin`）——视图无 org_level_3 / branch_code
   等标准行级权限列。对 org_user 开放需先在 ETL 派生标准 RLS 列再改造（见第 3 条 backlog）。

## 10. 已知边界 / 待办

- 页面「销售团队」维度按单团队编码分组，与 Excel 销售团队表的「双编码合并」口径不同；
  逐行标保已零差异，合并属报表层映射，接入销售团队维表时再做。
- 生产环境需同步本域 **fact 目录** + reload 才有数据（服务端运行时只读
  `biaobao_enriched.parquet`；`dim/standard_coeff_factor` 的折标因子是 ETL 侧输入与审计
  产物，规则已固化进 enriched，不必进服务端）。发布链见 `数据管理/VPS同步配置.md`。
- `BRANCH_CODE` 是**联邦 RLS 的部署基准省**，当前实例基准源为四川（`SC`），山西为
  `validation/SX` 隔离副本。**本域山西单源不读取该变量**（loader 直接 `read_parquet`），
  勿因本域去改它——改成 `SX` 会把无 branch_code 的四川主计划误标为山西。
- `user_store.json` 账号须含 `branchCode` 字段，旧格式缺此字段会在多分公司 RLS
  开启时 401（登录后所有请求报 "Token missing branchCode"）。
