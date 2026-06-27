# 地域/机构硬编码全域审计总报告（多省全国平台）

- 日期：2026-06-27　范围：server/src · src(前端) · 数据管理(ETL) · scripts(运维)
- 方法：5 域并行只读审计，按四象限分类（框架见 `硬编码审计框架.md`）
- 明细：`findings/{sql,auth-config,frontend,etl,scripts}.json`

## 一、总账（91 处，5 域 findings 原始合计；跨域近似项未去重）

| 域 | A 默认回落SC | B 真硬编码 | C 通用(勿动) | D 待确认 | 致命 | 高 |
|---|---|---|---|---|---|---|
| SQL 生成器 | 1 | 5 | 12 | 1 | 3 | 3 |
| 鉴权/路由/配置 | 5 | 4 | 8 | 1 | 1 | 4 |
| 前端 | 5 | 9 | 3 | 1 | 2 | 8 |
| ETL/管道 | 10 | 5 | 6 | 3 | 2 | 6 |
| 运维脚本 | 2 | 5 | 3 | 2 | 0 | 3 |
| **合计** | **23** | **28** | **32** | **8** | **8** | **24** |

**变量（应消除硬编码）= A+B = 51 处**；**通用（保持不动）= C = 32 处**；**灰色待业务确认 = D = 8 处**。

## 二、三大统一根因（逐条修是错的，要根因级根治）

### 根因①：`?? 'SC'` / `|| 'SC'` 静默默认四川 —— 贯穿全栈的反模式（A 象限 23 处）
- 致命变体：
  - `config/sql-federation-policy.ts getDeploymentBranchCode()` 缺省返回 `'SC'`——给 Parquet 补 `branch_code` 常量列的根基，VPS 漏配 `BRANCH_CODE` → **全省数据打成四川码，RLS 静默失效，零报错**。
  - `daily.mjs` 6 处 `process.env.BRANCH_CODE || 'SC'`——env 拼错静默查四川。
  - `sql/kpi-detail.ts:53`、`services/permission.ts:137` 等回落四川机构名单。
- **本质**：渐进迁移时为"不破坏四川、逐字节一致"刻意保留的兼容垫片。多省时代必须反转为 **fail-closed**：漏配/未知省 → 抛错+告警，禁止静默回落。

### 根因②：机构清单/省份名/标题写死四川 —— 散落前后端+ETL（B 象限主体）
- 同一份"机构清单"在 4 处各写一遍四川 12 机构：前端 `organizations.ts`（权限+筛选唯一来源）、`DEFAULT_USER_PERMISSIONS`、ETL `wecom ORG_SLUGS`、`org-groups` 同城分组。
- 省份名写死："四川分公司"出现在前端 `useScopeLabel`、`cross-sell.ts` 默认参数、地图 `GeoSection` 默认省"四川"。
- **本质**：缺单一事实源。机构清单应只在 `branch-org-mapping/<省>.json`，前端从 `/api/filters/options` 派生；省份名只在 `branch-names.ts`。

### 根因③：SX 数据域未补全 —— SX 当前故障的真根因（跨 SQL/ETL 域印证）
- `generate_dim_tables.py` 业务员/计划维度表只有四川 xlsx → **SX salesman/plan 维度表为空**（已证实）。**强怀疑（待生产日志验证）**：这是 performance-drilldown/bundle 400+空 body 的根因——但"维度缺失 → Binder Error 空 body"的具体机制尚需生产错误日志/失败 SQL 坐实，修复**不应锁死为"仅生成 SX dim 即可"**（缺 dim 也可能只是计划/团队为空或 SC 计划污染）。
- `quote-conversion/customer-flow` 的 `policy_date` 报错根因**待最终定位**（VIEW/JOIN/cache 层 + RLS flag），SQL 生成器本身不引用该列。

## 三、山西用户「当前就看到的错误」（不是扩展性，是在线 bug）

| 现象 | 位置 | 根因象限 |
|---|---|---|
| 页面标题显示"四川分公司XX分析" | 前端 `useScopeLabel.ts:57` | B·致命 |
| 首屏地图渲染四川省热力图 | 前端 `GeoSection.tsx:42` 默认'四川' | B·致命 |
| 交叉销售汇总行显示"SX分公司"/"四川分公司" | `branch-names.ts:22` SX 中文名被注释 + `cross-sell.ts` 默认 | B·高 |
| 理赔地理分布对 SX 哑火（晋字头车牌→NULL） | `claims-detail.ts` 车牌映射只有四川 川A→成都 | B·高 |
| 业绩分析下钻/bundle 子板块 400 | SX 维度表缺失（根因③） | B·致命 |

## 四、多省可扩展性量化（"新增一省要改多少处"）

| 链路 | 必改 | 最危险遗漏 |
|---|---|---|
| 鉴权/配置 | 6 文件 9 触点（permission/preset-users/branch-names/kpi-detail/.env/测试） | 漏配 `BRANCH_CODE` env → RLS 全失效 |
| ETL | 5 类文件（dim 生成/wecom 同步/renewal 路径/域白名单/机构映射） | `daily.mjs __branchReadyDomains` 7 域白名单，新省非白名单域 exit1 |
| 前端 | 整套机构清单+标题+地图初始省 | 机构清单写死，新省机构不显示 |
| 运维脚本 | 3 必改（sync-vps 白名单/2 处 oracle 断言死认['SC']）+ sx-promote 复制 | oracle 字节断言 `!= ['SC']` 非 SC 必 exit1 |

**结论：当前架构新增一省 ≈ 改动 20+ 处（A+B 变量项跨链路去重估算，区别于 51 处变量条目总数）、跨 4 链路、含多个静默失效陷阱。这是核心架构债。**

## 五、四大治理工程（根因级根治路线图，可并行）

| 工程 | 治什么根因 | 关键动作 | 优先级 |
|---|---|---|---|
| **工程一 省份解析 fail-closed** | 根因① | 建单一 `resolveBranchCode()`，漏配/未知→抛错告警；替换全栈 23 处 `?? 'SC'`；governance 加 lint 禁新增 `?? 'SC'` | **P0**（致命+防未来重蹈） |
| **工程二 机构/省份元数据单一事实源** | 根因②+在线bug | 机构清单唯一源 `branch-org-mapping/<省>.json`，前端改从接口派生删 `organizations.ts` 硬编码；`branch-names.ts` 补全（先修 SX 注释在线bug）；标题/地图/车牌映射按省配置 | **P1**（含山西在线可见错误） |
| **工程三 SX 数据域补全** | 根因③ | `generate_dim_tables.py` 加 `--branch-code`+SX xlsx 生成 SX 维度表；定位 quote/customer-flow `policy_date` 真根因；SQL 生成器补 branchCode 参数 | **P1**（修 SX 当前故障） |
| **工程四 多省可扩展性收口+防回归** | 扩展性债 | "新增省 checklist"配置驱动/codegen；oracle 断言参数化；sync-vps 白名单+sx-promote 通用化(--branch)；governance 加多省一致性校验+哨兵分省 | **P1** |

**调度**：工程一最高（致命+一处反转防所有省重蹈）；工程二含山西在线 bug（业务方已能看到错误）；三四并行。四个工程互不阻塞。
