# 新增省份「全部落点」Checklist（Phase 5 · 2026-06-23）

> **状态**：📋 Phase A 检测层收口产物｜**来源**：[省份派生化与子目录方案_2026-06-23.md](./省份派生化与子目录方案_2026-06-23.md) §4 Phase 5 + §10.9「[→P5] Phase 5 落点补漏」（codex P1/P2）｜**对抗审查**：codex gpt-5.5 闸-1（修 3 overclaim）+ 闸-2（补第四类 + repair 归类 + 证据行号）+ evidence-verifier fresh-context
>
> **一句话**：接入第 3 个省份（如某省 `6XX` 前缀）时，**不能只改 `fields.json` 一处**。派生映射只是「省份代码从哪来」的唯一事实源；「这个省存在、可同步、可登录、机构可映射」还散落在多处运行时白名单，逐一改全才不漏行。
>
> **🔴 核心纠偏（codex P1 overclaim 防护）**：禁止对外宣称「新增省份唯一落点 = `fields.json`」。`fields.json` 仅是 **(a) 派生映射**（保单号前缀 → branch_code）的唯一落点；**(b) 运行时白名单** 是另一类落点，独立于派生映射，必须同改。两类缺一即「数据派生正确但省份在运行时不可用」或「省份可用但派生省码错」。
>
> **🟡 定位：文档预留，非立即开发第三省**（规划 §10.9 (c)，用户 2026-06-23 决定）：当前宇宙仅 SC（610）+ SX（618）两省。本 checklist 是「列清落点供未来加省参考」的**文档预留**，**不为第 3 省现在写代码 / 造省份注册表 / 加省决策门自动化**（过度工程）。扩展点核心 = `fields.json branch_code.derivation.mapping` 加一条「前缀→省」；运行时白名单（§2）逐站点改全。Phase B 子目录发现须**枚举实际子目录**（`readdir`），勿写 `['SC','SX']` 常量。
>
> **维护协议**：append-only。新增落点站点经 grep/代码核实后追加，不静默删行。

---

## 0. 两类落点的本质区分（为什么不能合并成"一处"）

| 类别 | 回答的问题 | 唯一/多处 | 改错的后果 |
|------|-----------|----------|-----------|
| **(a) 派生映射** | 「保单号前缀 `6XX` 映射到哪个 branch_code」 | **唯一**：`fields.json` `branch_code.derivation.mapping` | 漏改 → 新省 parquet 派生省码 NULL → ETL 自校验 `sys.exit(1)`（fail-fast，**看得见**） |
| **(b) 运行时白名单** | 「这个省存在、能同步、能登录、机构能映射、跨省汇总名怎么显示」 | **多处**（≥8 站点，见 §2） | 漏改 → 数据正确但**运行时静默不可用**（同步保护失效 / 账号无 branchCode / 中文名空 / sync 校验拒绝），比 (a) 更隐蔽 |

> **关键**：(a) 漏改会 fail-fast 阻断 ETL，(b) 漏改往往**沉默失败**——这正是本 checklist 存在的理由。

---

## 1. (a) 派生映射唯一落点

| 落点 | 文件:位置 | 改什么 | 验证 |
|------|----------|--------|------|
| 保单号前缀 → branch_code | `server/src/config/field-registry/fields.json` · `branch_code.derivation.mapping` | 加 `"6XX": "<省码>"`（如 `"620": "YN"`） | `node scripts/field-registry/generate.mjs` codegen → `bun run governance`（#17 字段一致性） |

**派生引擎前置条件**（接新省前必验，非 grep）：
- 新省 `policy_no` 前 3 位**全量唯一**、与现有 `{610, 618}` 不撞、零 NULL（duckdb 全量验收门，规划 §3.1 / §10.4 codex P1 护栏）。
- 若新省非 `6` 开头或前 3 位撞车 → 走 Option B（`policy_no[1:3]` offset 引擎扩展，规划 §3.1），不能强塞前 3 位轴。
- 依据须是**权威机构编码表 / 保单号编码规范**，不是「grep 没撞就行」。

---

## 2. (b) 运行时白名单全部落点（≥8 站点，逐一改全）

> 全部经 2026-06-23 grep + 代码核实（含 codex gpt-5.5 闸-1/闸-2 + evidence-verifier 行号校正）。行号为 main HEAD `f23c5ea2`（Phase 4 合并后），后续偏移以符号名为准。

| # | 落点 | 文件:位置 | 改什么 | 漏改后果 |
|---|------|----------|--------|---------|
| 1 | **账号注册表** | `server/src/config/preset-users.ts:393` `getAllBranchCodes()`（返回去重 `['SC','SX']`，被 `cache-warmer.ts:11` 消费按 branch 预热）+ 各 `org_user` 的 `branchCode` 字段（:57 起多账号） | 加新省超管 + 经营单元 org_user，`branchCode='<省码>'` | 新省用户无账号 / branchCode 缺失 → RLS-on 时 `permission.ts:88-99` **fail-closed 401**；缓存预热漏新省变体 |
| 2 | **分公司中文名** | `server/src/config/branch-names.ts:21-22`（`SC:'四川'`，`SX` 注释预留），消费 `getBranchChineseName`(:31)/`getBranchCompanyName`(:42) | 加 `<省码>:'<省名>'` | 未注册 code → fallback 为 code 本身 / `${code}分公司`（**不是** '全国汇总'，'全国汇总' 仅 code 为空时）→ 标签显示生省码 |
| 3 | **部署级编码白名单** | `server/src/config/sql-federation-policy.ts:152`（部署省编码注释）+ `getDeploymentBranchCode` 白名单校验（`^[A-Z]{2}$`） | 确认新省码通过 2 位大写校验（结构性，通常无需改值） | 新省码格式非法 → loader 视图层补常量列拒绝内插 |
| 4 | **派生视图 federation policy 登记**（codex P2 补漏） | `server/src/config/sql-federation-policy.ts:23-26`（branch_code 例外注释）+ `FEDERATION_POLICIES` 各域 `permissionColumns`/`strategy`（约 :96-140 区间，逐域 `direct`/`exempt` 声明） | 新省派生域 parquet 若仍缺 branch_code 列，loader `selectUnionWithBranchCode` 用部署省常量补列；确认新省域已纳 federation policy | 新省派生域未登记 → federation RLS 拒新省 branch_admin |
| 5 | **机构映射表** | `数据管理/config/branch-org-mapping/<省>.json`（现仅 `SX.json`） | 新建 `<省>.json` 机构编码映射 | 新省机构维度无映射 → org_level 维度查询空结果 |
| 6 | **sync-vps 省份保护白名单** | `scripts/sync-vps.mjs:814` `SUPPORTED_BRANCH_CODES = new Set(['SC','SX'])` + `:468 buildRsyncBranchFilterArgs` 默认 `['SC','SX']` | 加新省码（**Phase B 退役 #753 前缀方案后**此处随之重构，见规划 §4 B3） | `SYNC_VPS_BRANCH_CODE=<新省>` 被拒（格式校验通过但不在 SUPPORTED 集）→ 同步分省保护失效 |
| 7 | **环境变量声明省** | ETL 编排 `daily.mjs` 经 `BRANCH_CODE` env / `--branch-code` 传声明省 → `transform.py` `assertDeclaredBranch` 核对派生省 | 新省 ETL 跑批时传 `BRANCH_CODE=<新省>`（声明省 ≠ 派生省即 fail-fast） | 声明省与派生省不符 → ETL `sys.exit(1)`（**fail-fast 看得见**，护栏正确工作） |
| 8 | **压测白名单**（codex 闸-1 P2 补漏） | `scripts/multi-branch-stress-test.mjs:182` `allBranches = simulateSx ? ['SC','SX'] : ['SC']`（Phase 5 oracle 自身） | 加新省码使 `--simulate-<省>` 串读断言覆盖新省 | 非生产，但**会误导验证**：新省 RLS 串读隔离不被压测覆盖 → 假「通过」 |

**易混淆站点（标注，非省份白名单——避免误改）**：
- `数据管理/daily.mjs:1398` `__branchReadyDomains` 是 **ETL「域能力门控」白名单**（哪些域已支持 branch-aware ETL），**不是省份注册表**。新增省份通常**无需**改它；改它的触发是「新增**派生域**纳入 branch-aware ETL」，与省份正交。codex 闸-1 P2 明确二者勿混。
- `paths.ts` validation 路径、`resolveBranchDimExtras`/`resolveBranchFactExtras`/`resolveBranchFromParquet` 是**动态 `<省>` 发现**（按目录/字段映射），非手工白名单，新增省份不需逐一改（codex 闸-2 确认）。
- `server/src/routes/data.ts` web 上传归档正则属 **Phase B 子目录改造面**，非本期"运行时白名单"同类项。

**关联（非白名单但接新省须验）**：
- `server/src/middleware/permission.ts:88-99` — RLS 注入点（消费 branchCode，**代码无需改**，自动适配新省码）。

---

## 3. RLS / loader 适配核对结论（Phase 5 ① · duckdb + 代码双证 · codex 双闸修正 overclaim）

> **核对目的**：确认 RLS 注入的 `branch_code` 过滤在各消费关系上**正确闭合、不漏行**。
>
> **🔴 codex gpt-5.5 双闸实读代码推翻原"全域双保险/三类"草案**：branch_code 列供给**分四类机制**；且 typed 路由 RLS 闭合**分四档**（直接 branch / gated branch 下推 / org_level_3 降级 / 面外）。以下为修正后的诚实分层结论。

### 3.1 RLS 注入语义（不变）

`server/src/middleware/permission.ts:88-99`（`isBranchRlsEnabled()` 块）：flag 开 + 有 branchCode → 注入 `branch_code='<省>'` 等值；flag 开 + 无 branchCode → fail-closed 401；flag 关（默认/生产）→ 零注入字节安全。派生化未改注入语义。

### 3.2 🔴 branch_code 列供给的四类机制（非统一兜底）

| # | 消费关系 | loader 供给机制 | 须 parquet 物理列 | 主目录实测（2026-06-23 duckdb） |
|---|---|---|---|---|
| ① | **PolicyFact** | `duckdb-parquet-loader.ts:139` `SELECT * read_parquet(union_by_name=true)`，**无补列** | ✅ 必须物理含列 | ✅ premium 已含列（`SC`=2,600,421） |
| ② | **ClaimsDetail** | `duckdb-domain-loaders.ts:687` `SELECT * read_parquet(union_by_name=true)`，**无补列**（注释明示靠 ETL+governance #17+schema 契约） | ✅ 必须物理含列 | ⚠️ claims_detail 缺列（旧产物）→ union_by_name 补 NULL → RLS 过滤漏行 |
| ③ | **4 federation 派生视图**（QuoteConversion/CrossSellFact/NewEnergyClaims/RenewalTrackerFact） | `selectUnionWithBranchCode:486-507` DESCRIBE 零假设 → 缺列补 `SELECT *, '<部署省>' AS branch_code` | ❌ 可缺列（loader 补常量兜底） | ⚠️ 缺列 → loader 补 `'SC'` 兜底 |
| ④ | **维度/计划/达成缓存**（SalesmanDim/SalesmanTeamMapping/SalesmanPlanFact/achievement_cache）（codex 闸-2 补漏） | **gated 多源注入**：`multiProvince`（SalesmanDim DESCRIBE 含 branch_code，:82）+ `branchAware`（PolicyFact 含列，:280）时条件性注入 `m.branch_code`/`a.branch_code`/`MAX(branch_code)`（:102/:128/:271-287）；单省=不注入字节安全 | gated（多省时注入） | 单省默认不注入（SalesmanDim 无 branch_code 列） |

**结论**：仅 ③ 有 loader 补常量兜底；① ② 须物理含列；④ 是 gated 多源派生（多省激活时注入，单省零注入字节安全）。

### 3.3 🔴 RLS 启用硬前置 = Phase 4 backfill 物理补列（env.ts:127 铁证）

`server/src/config/env.ts:127`：**「`BRANCH_RLS_ENABLED='true'` 启用前提：所有 Parquet 已通过 `backfill_derived_fields.py --recursive` 补上 branch_code 列」**。即 RLS-on 正确性靠 **Phase 4 backfill 物理补列**（= PR #769 产出），非靠 loader 兜底。当前主目录：premium 已含列；claims_detail + 6 派生域 latest.parquet 缺列（旧产物）。**山西 GATED 上线（RLS-on）前必须对生产全量 parquet 跑 Phase 4 backfill**（③ federation 视图有兜底可不补，① PolicyFact / ② ClaimsDetail 必补）。

### 3.4 🔴 typed 路由 RLS 闭合机制分档（codex 双闸：repair 普通端点有 gated branch 下推）

| 档 | 路由 | RLS 闭合机制 | 证据 |
|---|---|---|---|
| 直接 branch | PolicyFact 消费路由 | 注入 `branch_code='<省>'`（列物理存在） | permission.ts:88-99 |
| **gated branch 下推** | **repair 普通端点** + premium-plan / kpi / performance / report（维度/达成缓存类） | `resolveBranchRlsCode(req, <关系>)`：关系含 branch_code 列时追加 `branch_code='<省>'`，否则 undefined 短路（单省字节安全） | `repair.ts:59 buildRepairWhere`→resolveBranchRlsCode('RepairDim')；premium-plan:43 / kpi:101 / performance:264 / report:131 |
| org_level_3 降级 | **renewal-tracker / cube** | `buildOrgScopedPermissionWhere`(shared.ts:101) 正则**只保留 org_level_3 段、丢弃 branch_code 段**（避免 loader 路径切换 Binder Error）→ branch_code 真正下推为 **follow-up** | shared.ts:101；renewal-tracker.ts:143-150 / cube.ts:112-118 注释 |
| **RLS 面外** | **repair/orphan-shops** | SQL 生成器 `void whereClause` **丢弃权限 whereClause** → 已知 RLS 面外端点 | `sql/repair.ts:416 void whereClause`；route repair.ts:246 |

### 3.5 诚实结论（不 overclaim）

- ✅ RLS 注入语义派生化无感（permission.ts 不变）；③ federation 视图 loader 兜底必在；④ 维度/达成缓存 gated 多源注入 + typed 路由下推。
- ⚠️ **不能宣称「全域双保险 / RLS 全域已闭合」**：(1) ①② 无 loader 兜底，RLS-on 前须 Phase 4 backfill 物理补列（env.ts:127）；(2) renewal-tracker/cube 靠 org_level_3 闭合，branch_code 下推 follow-up；(3) repair/orphan-shops 在 RLS 面外。
- ✅ **R28 判别法适用边界**：「loader DESCRIBE 自适应 → ETL 加列透明」**只对 ③ 走 `selectUnionWithBranchCode` 的 federation 视图成立**，不适用 ①② `union_by_name` 路径（须物理列）。
- **准确表述**：「branch_code 列供给分四类（①②须物理列 · ③loader 兜底 · ④gated 多源派生）；RLS-on 硬前置 = Phase 4 backfill 全量物理补列（env.ts:127）；typed 路由 RLS 闭合分四档（直接/gated 下推/org 降级/面外），renewal-tracker·cube 的 branch_code 下推为 follow-up」。

---

## 4. Phase B 后置任务登记（高爆炸半径 · 动工前问用户）

Phase A（检测层）收口后，以下为 Phase B（隔离层 · `current/<省>/` 子目录替代 #753 前缀）后置任务，**动工前必须问用户确认**（规划 §8 开放问题 2）：

- **B1** 装载层子目录发现（`data-bootstrapper.ts:150-164` discoverParquetFiles · 🔴 生死点）
- **B2** ETL 落盘子目录 + 全部扁平 readdir 站点改造（含 codex P1 补漏 3 承重点：full-snapshot-cache-key / fetch-local-metrics / check-governance）
- **B3** sync-vps 退役 #753 前缀 5 函数（含本 checklist §2 #6 的 sync-vps 白名单重构）
- **B4** web 上传子目录化（含 §2 标注的 `data.ts` 归档正则）
- **B5** RLS/性能/cutover（PolicyFactRealtime branch_code 索引按 bench 决定）

**RLS branch_code 下推 follow-up**（本 checklist §3.4 发现，山西 GATED 上线前评估）：renewal-tracker / cube typed 路由 branch_code 真正下推（现保守 org_level_3），BACKLOG 跟踪。

**follow-up**：`2026-06-23-claude-f77f8a` 跨省同 VIN 冲突登记（山西 GATED 上线前必修）。

---

## 5. 关联

- 规划唯一事实源：[省份派生化与子目录方案_2026-06-23.md](./省份派生化与子目录方案_2026-06-23.md)
- 架构总纲（ADR）：[全国多省架构决策_2026-06-19.md](./全国多省架构决策_2026-06-19.md)
- RLS 注入：`server/src/middleware/permission.ts` · gated 下推：`server/src/routes/query/shared.ts resolveBranchRlsCode` · loader 补列：`server/src/services/duckdb-domain-loaders.ts` · PolicyFact/ClaimsDetail loader：`duckdb-parquet-loader.ts` / `duckdb-domain-loaders.ts:687`
- RLS 启用前提：`server/src/config/env.ts:127`（所有 Parquet 须 backfill 补列）
- 派生映射 SSOT：`server/src/config/field-registry/fields.json` `branch_code.derivation`
