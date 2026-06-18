# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。React + TypeScript + Vite + ECharts，后端 Express + DuckDB。生产环境 `https://chexian.cretvalu.com`。

> **共享记忆**：项目记忆存储在 `.claude/shared-memory/`（git 跟踪，`MEMORY.md` 索引 + 多个 `feedback_*`/`project_*` 专题文件）+ `~/.claude/shared-memory/chexian/`（本地运行时）。clone 后执行 `bash .claude/shared-memory/sync-memory.sh --pull` 拉取记忆到本地。AI 读取入口见 §13。

> **CLAUDE.md 体积预算**：≤20KB / ≤300 行。`generate-claude-md` 注入的 stack/conventions/architecture/skills 四区块为冗余，已用墓碑 marker 占位（见 `.claude/rules/claude-md-budget.md` + governance #23）。

---

## 0. 红线规则

**写代码前两问**：1) 已有实现？→ `grep -r` 搜索 2) 怎么验证？→ 执行验证命令并贴出结果

| 红线 | 做法 |
|------|------|
| 先搜再写 | `grep/glob` 搜索整个项目，禁止假设"不存在" |
| 验证不声称 | 必须通过真实 API 请求 / Parquet 直查验证并贴出结果（不只看代码） |
| 修补不拆除 | 安全加固禁止删除整个模块，只能修补 |
| 并行不串行 | 3+ 独立任务必须并行 sub-agents |
| 源数据验证 | 修改 SQL 生成器后，必须用 Parquet 直查与 API 返回对比验证 |
| 文档同步 | 涉及 3+ 文件变更的重构完成后，扫描并更新受影响的索引（CODE_INDEX / DATA_INDEX / PARQUET_SCHEMA_KNOWLEDGE / CLAUDE.md 注册表章节） |
| 业务口径不擅改 | 业务逻辑/口径错误一律 BACKLOG 登记等用户确认，禁止 AI 自行修正（如报价口径） |
| 不规划只执行（限定） | 仅适用于已定义的 `/chexian-commit-push-pr`/`/chexian-sync-and-rebase` 等快捷命令；其他破坏性操作必须先列影响清单等用户确认 |

**Pre-flight（每次任务前）**：1) `grep -r` 搜索已有实现 2) 涉及数据时 `find 数据管理/` 3) 声称完成前 `curl` 验证 4) 删除前列影响清单等用户确认 5) push 前 `bun run governance` + `grep -rn '<<<<<<'` 扫描冲突标记

**方法确认协议**：遇到"下钻/层级"→问用户交互模型；"已完成"→curl 验证；"不存在"→先搜索；"安全加固/重构"→列清单等确认

---

## 1. 索引与文档

| 索引 | 路径 |
|------|------|
| 文档索引 | `开发文档/00_index/DOC_INDEX.md` |
| 代码索引 | `开发文档/00_index/CODE_INDEX.md` |
| 数据索引 | `开发文档/00_index/DATA_INDEX.md` |
| 进展索引 | `开发文档/00_index/PROGRESS_INDEX.md` |

**必读文档**：`ARCHITECTURE.md`（模块层级）· `开发文档/TECH_STACK.md`（技术栈）· `开发文档/DEVELOPER_CONVENTIONS.md`（DC-001 三要素）· `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`（业务字段定义，与 `server/src/config/field-registry/fields.json` 字段总数一致）· `开发文档/缺口清单.md`（信息缺口追踪）

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求）· [PROGRESS.md](./PROGRESS.md)（进展）

**数据知识协议**：数据处理任务必读 [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)。唯一事实源：`数据管理/knowledge/rules/车险数据业务规则字典.md`

---

## 2. 指标注册表（RED LINE）

**唯一事实源**：`server/src/config/metric-registry/`（L1-L3 原子指标）· 指标字典：`开发文档/指标字典.md`（自动生成，禁止手动编辑）

**新增/修改指标流程**（必须按顺序）：
1. `grep -r "id: '${NEW_ID}'" server/src/config/metric-registry/` — 确认不存在
2. 判断复杂度：L1-L3（单行 SQL 表达式）→ 添加到 `categories/*.ts`；L4（CTE/窗口函数/多表 JOIN）→ SQL 生成器中实现，引用注册表原子指标
3. 必须包含：id + name + formula + sql.expression + display + 至少 1 个 testCase + changelog
4. `bun scripts/metric-registry/validate.ts` 校验通过（脚本带 `#!/usr/bin/env bun` shebang，禁止 `npx tsx`）
5. `bun scripts/metric-registry/generate-frontend-map.ts` 更新前端映射；失败时用 `git checkout -- server/src/config/field-registry/` 回滚未提交的 codegen 产物

**禁止**：
- ❌ 在 SQL 生成器中硬编码新指标公式而不在注册表注册
- ❌ 在前端硬编码指标标签/阈值而不从注册表派生
- ❌ 新增与已有指标公式重复的指标（先 `grep` 注册表确认不存在）
- ❌ 修改已发布指标公式而不更新 version 和 changelog

**跨项目对齐**：作战地图 `00_规范与协议/指标字典_v2.0.md` 是业务层权威定义，本注册表是代码层实现。两者公式必须一致。

### 字段注册表（RED LINE）

**唯一事实源**：`server/src/config/field-registry/fields.json`

**新增/修改字段流程**（必须按顺序）：
1. 修改 `fields.json` 中的字段定义
2. 运行 `node scripts/field-registry/generate.mjs` → 自动更新 mapping.ts + validator.ts + etl_fields.json
3. `bun run governance` 验证一致性（#17 检查）

**禁止**：
- ❌ 手动编辑 `mapping.ts` / `validator.ts`（由 codegen 生成，标注 `DO NOT EDIT MANUALLY`）
- ❌ 在 `transform.py` 中硬编码字段列表（从 `etl_fields.json` 读取）
- ❌ 新增 ETL 源字段不在 `shard-config.json:explicitly_ignored_fields` 或 `fields.json` 中声明（Schema 契约会 `sys.exit(1)` 阻断）

### 注册表体系总览

| 注册表 | 路径 | codegen |
|--------|------|---------|
| 指标注册表 | `server/src/config/metric-registry/` | `generate-frontend-map.ts` |
| 字段注册表 | `server/src/config/field-registry/fields.json` | `field-registry/generate.mjs` |
| 客户类别 | `src/shared/config/customer-categories.ts` + `server/src/config/` | — |
| 环境变量 | `server/src/config/env.ts` | — |
| API 路由 | `server/src/config/api-routes.ts` + `src/shared/api/routes.ts` | — |
| ETL 配置 | `数据管理/shard-config.json` | — |
| 数据域注册表 | `数据管理/data-sources.json` | ETL 自动更新 |

> 各注册表覆盖数（指标/字段/路由）以 codegen 输出与 `bun run governance` 报告为准，不在本文档硬编码。

---

## 3. 护栏（RED LINE）

**架构协议**：Bun 包管理器（禁止 npm/yarn）· 智谱 API `glm-4.7-flash` · 三级限流（禁止降低）· `security.ts` 危险字符黑名单支持中文

**报价数据口径**（待修正）：当前 `是否报价` 字段不可靠，正确逻辑应以「续保单号非空」判定已报价。用户待办，AI 不得擅自修改。

> 详细规则在 [.claude/rules/](./.claude/rules/)：`data-pipeline`（分片/VPS 同步）· `sql-generators`（口径护栏）· `api-routes`（路由+权限）· `frontend`（React+设计系统）· `security-config`（JWT/RBAC/限流/CORS）· `shared-modules`（`src/shared/` 约定）· `design-system`（colorClasses/formatters）· `claude-md-budget`（CLAUDE.md 体积守恒）

---

## 4. API 架构

```
前端 Hook → apiClient → GET /api/query/*
  → Service Worker（cache-first，命中 0ms；过期/未命中走网络）
  → server/src/routes/query.ts（聚合器）
    → authMiddleware → permissionMiddleware
    → route-cache（内存 LRU + ETag/304, brotli/gzip 预编码）
      ├→ 命中: 直接 setHeader + send → respond
      └→ 未命中: query/*.ts → sql/*.ts → duckdb.ts → JSON → 写入缓存
```

**服务端缓存**：`server/src/services/route-cache.ts` · 内存 LRU + `ETag` + `If-None-Match` 走 304 · 同时缓存 brotli/gzip 编码 · 缓存键含 `dataVersion`，ETL 刷新自然失效

**Service Worker**（Phase C）：`public/sw.js` · 仅 `/api/query/*` GET · cache-first（命中即返回 0ms，不走后台 revalidate）· 每 5 分钟轮询 `GET /api/data/version`，版本变更即清空缓存并通知客户端

**启动**：`bun run dev:full`（禁止只运行 `bun run dev`）

**关键文件**：`src/shared/contexts/DataContext.tsx`（isDataLoaded）· `src/shared/api/client.ts`（API 入口）· `server/src/services/duckdb.ts`（查询执行 + `loadMultipleParquet()`）· `server/src/config/paths.ts`（路径配置，禁止硬编码）· `server/src/config/env.ts`（启动时校验所有环境变量）· `server/src/routes/query.ts`（路由聚合器）+ `query/*.ts` 子路由 · `server/src/sql/` SQL 生成器模块 · `server/src/config/preset-users.ts`（用户）· `server/src/services/access-control.ts`（权限）· `server/ecosystem.config.cjs`（PM2 生产配置）

> 各目录文件数详见 `开发文档/00_index/CODE_INDEX.md`（不在本文档硬编码，避免漂移）。

**API 前缀**：`/api/query/*`（KPI/趋势/排名/成本/系数/续保/交叉销售）· `/api/data/*`（文件）· `/api/ai/*`（NL2SQL/需求识别）· `/api/auth/*`（登录）· `/api/filters/*`（筛选器）

---

## 5. 交付与技术栈

**DONE 判定**：关联文档 + 关联代码 + 验收证据（至少一项）。核心层改动须更新 INDEX.md。提交前：`bun run governance`

**技术栈唯一事实源**：`package.json`（依赖版本）+ `server/src/config/env.ts`（环境变量）+ `开发文档/TECH_STACK.md`（架构选型说明）

```bash
bun install && bun run hooks:install  # 安装依赖 + 注册 git hooks（首次必跑，post-checkout 自愈链依赖）
bun run dev:full                      # 启动前后端
bun run build                         # 类型检查+构建
bun run test --run                    # 单元测试（必须带 --run，否则进 vitest watch 模式）
bun run test:integration              # 集成测试（需 DuckDB 原生二进制，仅本地）
bun run test:e2e                      # E2E（需先 dev:full；凭据用户名 admin，密码读 E2E_PASSWORD 环境变量）
bun run governance                    # 治理校验
bun run verify:quick                  # preflight + governance + typecheck（推 PR 前快速门禁）
bun run verify:full                   # verify:quick + 全量单测
```

**CI 测试分层协议**（RED LINE）：
- **单元测试** (`bun run test`) — CI + 本地（套件数以 `vitest --run` 输出为准，不在本文档硬编码）
- **集成测试** (`bun run test:integration`) — 仅本地（需 DuckDB 原生 `.node` 模块）
- CI 环境无法解析 `.node` 原生模块（vitest/jsdom 限制），相关测试必须在 `vite.config.ts` exclude 中排除
- 新增原生模块依赖时，必须检查是否有对应测试需排除

---

## 6. 验证协议

| 场景 | 验证命令 |
|------|----------|
| 修改 SQL | `curl -s localhost:3000/api/query/kpi \| jq '.data \| length'` |
| 修改交叉销售 SQL | `python3 scripts/verify-cross-sell.py --date <YYYY-MM-DD>` |
| 源数据口径验证 | DuckDB 直查 Parquet → 与 API 返回对比 |
| 修改路由 | `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/[路由]` |
| 修改权限/RBAC | 三个角色（branch_admin/regional_manager/salesman）各登录一次，对比同一端点返回数据范围差异 |
| 修改环境变量 | `bun --bun -e "import('./server/src/config/env.ts').then(m=>console.log(Object.keys(m)))"` 不抛异常（直接吃 TS，无需先编译） |
| 修改字段注册表 | `node scripts/field-registry/generate.mjs && bun run governance` 全过 |
| 修改前端 | `bun run build` 零 TS 报错 |
| 修改服务端缓存 | 命中端点二次请求带 `If-None-Match: <上次 ETag>` → 期望返回 304 |
| 声称完成 | 至少一个 API 200 + 非空 JSON |
| Git 推送 | `bun run governance && git diff --check` |

验证结果必须出现在输出中。SQL 报错查 [DuckDB 文档](https://duckdb.org/docs/)，禁止猜测。

---

## 7. 异常处理

| 情况 | 处理 |
|------|------|
| 信息缺口 | 登记缺口清单 → BLOCKED |
| 业务口径错误 | 禁止直接改 → BACKLOG 登记 |
| API 失败 | 检查 apiClient 与路由对应，前端新增方法须确认后端路由存在 |
| ETL Schema 契约失败 | `sys.exit(1)` 时查 stderr 列出的未声明字段 → 加入 `fields.json` 或 `shard-config.json:explicitly_ignored_fields` |
| 服务端缓存异常 | 用 `data-version` 查最新 ETag；缓存键含 `dataVersion`，刷新 ETL 后自然失效，不需手动清缓存 |
| VPS 同步冲突 | ⚠️ `sync-vps.mjs` 默认直接执行 rsync（`dryRun: false`）；要预览必须显式 `--dry-run`；线上有改动时禁止覆盖，先 `git pull` 同步 |
| 权限 401/403 | 查 `access-control.ts` 角色定义 → 查 `permission.ts` WHERE 注入；复现需指定 token |

---

## 8. 协作与部署

**任务 ID**：@user B001-B099 / @claude B100-B199 / @codex B200-B299

**Git 分支命名**：`claude/<desc>`（AI 主导）· `user/<desc>`（用户）· `codex/<desc>`（codex 主导）· `feat/<desc>`/`fix/<desc>`（中性）

**首次 clone 流程**：
```bash
git clone <repo> && cd chexian-api
bash .claude/shared-memory/sync-memory.sh --pull   # 拉记忆到本地
bun install                                         # 安装依赖
bun run hooks:install                               # 注册 git hooks（post-checkout 自愈链前置条件，见 .claude/rules/worktree-setup.md §B）
bun run dev:full                                    # 启动开发环境
```

**并行规则**：3+ 独立模块/任务必须并行 sub-agents。PR 前：`git fetch origin main && git rebase origin/main && bun run governance`

**生产环境**：腾讯云 2核4G `162.14.113.44` · `https://chexian.cretvalu.com` · PM2 `chexian-api` 端口 3000 · Nginx 前端 `/var/www/chexian/frontend/dist` · **PM2 重启**：deployer 无法直接调 pm2，须 `sudo /usr/local/bin/deploy-chexian-api reload`（或 `restart`/`install`）

**数据 ETL**：`node 数据管理/daily.mjs`（智能检测）· `node 数据管理/daily.mjs premium|claims|quotes|all`（强制）· 维度表：`python3 数据管理/warehouse/dim/generate_dim_tables.py`

**数据同步**：`node scripts/sync-vps.mjs`（rsync `policy/current/` + `claims/` + `quotes/` + 维度表 `salesman/` + `plan/`）

**CI/CD**：`deploy.yml`（push main → 构建→部署→健康检查）· `claude-code.yml`（@claude 触发）· `governance-check.yml`（PR 治理）

**工具箱入口**：`.claude/commands/`（`chexian-*` 前缀）+ `.claude/agents/` · 常用：`/chexian-commit-push-pr` `/chexian-sync-and-rebase` `/chexian-data-analysis` `/chexian-security-review` `/chexian-verify`（命令/agent 数量与名称以目录列表为准）

---

## 9. 部署清单

声称"已部署"前，按顺序逐项验证：

1. `bun run build` — 零 TS 报错
2. `bun run governance` — 治理通过
3. PM2 状态检查 — `sudo /usr/local/bin/deploy-chexian-api describe`，若 errored 则 `sudo /usr/local/bin/deploy-chexian-api reload`（禁止只 restart）
4. 环境变量 — `ssh deployer@162.14.113.44 'grep -c "=" /var/www/chexian/server/ecosystem.config.cjs'`，与本地比对数量一致
5. CORS — `curl -I -H "Origin: https://chexian.cretvalu.com" https://chexian.cretvalu.com/health` 返回 `Access-Control-Allow-Origin` 头（端点是 `/health`，不是 `/api/health`）
6. DuckDB/Parquet 兼容 — `union_by_name` schema 一致性
7. 健康检查 — `curl -s https://chexian.cretvalu.com/health` 返回 200
8. 数据版本 — `curl -s https://chexian.cretvalu.com/api/data/version` 返回当前 ETL 版本（驱动 SW 缓存失效）
9. 核心 API — 至少一个 `/api/query/*` 返回 200 + 非空 JSON

**回滚方案**：`sudo /usr/local/bin/deploy-chexian-api rollback`（恢复上一版 PM2 进程）。重大故障同时：`git revert <SHA> && git push` 让 deploy.yml 重新部署上一版代码。

---

## 10. 领域知识

车险分析任务中，**禁止假设因果关系或业务定义**，不确定时必须先问用户确认。

| 规则 | 说明 |
|------|------|
| 风险等级是结构性数据 | `insurance_grade`(A-G/X) 是车辆属性字段，不是"质量泄漏"或可控因子 |
| 终端来源 ≠ 渠道 | `terminal_source`(出单终端) 和 `channel`(业务渠道) 是不同维度，禁止混用 |
| 定价系数 ≠ 赔付因果 | `商车自主定价系数` 不直接导致出险率变化，禁止假设因果链 |
| 出险率分母 | 用已赚暴露(earned exposure)，不是签单件数(written count) |
| 满期保费 vs 已赚保费 | 满期保费 = 保单完整到期时的应收保费；已赚保费 = 按时间比例摊销的部分。满期赔付率分母用满期保费，已赚赔付率用已赚保费 |
| 驾乘推介率 | = 驾意险推介件数 / 商业险出单件数（非保费比）。分母仅含主全+交三，排除纯交强/单交 |
| 驾乘渗透率 | = 驾意险承保件数 / 商业险承保件数 |
| 推介率分母 | 商业险出单件数（去重车架号），不含纯交强/单交。整体行 = 主全 + 交三 |
| 赔付率分子 | 已决赔款 + 未决赔款（满期赔付率用满期保费做分母） |
| 客户类别 | 11 类，按车辆使用性质分，详见业务规则字典 |
| 摩托车交强险+人身险捆绑 | 摩托车通常捆绑销售，分析口径见 `/diagnose-motorcycle` 命令 |
| 赔付字段已内嵌 policy | `policy/current/*.parquet` 已含赔案件数/已报告赔款/费用，**不要 JOIN `claims/latest.parquet`**（已废弃） |

**唯一事实源**：`数据管理/knowledge/rules/车险数据业务规则字典.md`。公式/口径有疑问先查此文件，查不到再问用户。

---

## 11. 文件与路径规则

| 规则 | 说明 |
|------|------|
| 先确认再动手 | 用户提到文档/计划，若有多版本先问"哪个版本？" |
| 禁止硬编码路径 | 使用 `server/src/config/paths.ts` 或环境变量 |
| 数据文件分层 | `数据管理/warehouse/` 是本地源（`fact/` 事实表 · `dim/` 维度表）；`server/data/` 是 VPS 运行时镜像 |
| ETL 输入/输出 | 输入 Excel 放 `数据管理/` 根目录（命名见 `.claude/rules/data-pipeline.md` 源文件命名约定）；输出 Parquet 落 `数据管理/warehouse/`；元数据落 `数据管理/data-sources.json` |

---

## 12. 审查与业务标注

审查计划/文档/数据分析结论时，所有假设的业务逻辑标注 `⚠️ 待用户确认`。其余审查通用原则（事实核查、逻辑一致性、诚实评分）已在 §0 红线和 `~/.claude/rules/common/coding-style.md` 中定义，不在此重复。

---

## 13. 共享记忆导航（AI 入口）

`.claude/shared-memory/MEMORY.md` 是项目运行时知识总索引（DuckDB 迁移坑、字段映射、维度表 Parquet 化、Auth 凭据等）。**所有数据/SQL/认证任务开工前必读**。

**专题文件命名约定**（按需 `ls .claude/shared-memory/` 列举，不在本文档枚举避免漂移）：

- `feedback_*.md` — 经验教训（需求确认 · 修复前验证 · 报告规范 · VIEW 禁参数化 · 已赚/赔付口径 · 告警阈值 · 巡检方法论 · 比率禁加权 · 表格规范 等）
- `project_*.md` — 项目决策（claims 废弃 · 边际贡献 · 计划维度 · 报价数据问题 · 风险等级三字段互斥 · 车型分类 等）
- `tool_*.md` / `claims_detail_field_mapping.md` / `repair_source_field_mapping.md` / `reference_shared_memory.md` — 工具/字段映射/跨项目机制说明

⚠️ shared-memory 是 user-only 路径，AI 仅可只读引用，禁止 Write/Edit/git add（详见 `.claude/rules/shared-memory-discipline.md`）。

---

<!-- GSD 墓碑（4 区块禁内联，见 .claude/rules/claude-md-budget.md）：stack→§5+package.json · conventions→~/.claude/rules/common/coding-style.md · architecture→ARCHITECTURE.md+§4 · skills→system-reminder 自动注入 -->
<!-- GSD:stack-start --><!-- GSD:stack-end -->
<!-- GSD:conventions-start --><!-- GSD:conventions-end -->
<!-- GSD:architecture-start --><!-- GSD:architecture-end -->
<!-- GSD:skills-start --><!-- GSD:skills-end -->
