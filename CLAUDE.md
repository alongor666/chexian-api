# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。React + TypeScript + Vite + ECharts，后端 Express + DuckDB。生产环境 `https://chexian.cretvalu.com`。

> **共享记忆**：项目记忆存储在 `.claude/shared-memory/`（git 跟踪）+ `~/.claude/shared-memory/chexian/`（本地运行时）。clone 后执行 `bash .claude/shared-memory/sync-memory.sh --pull` 拉取记忆到本地。多项目共享（私董会/作战地图/chexian-api），详见 `reference_shared_memory.md`。

---

## 0. 红线规则

**写代码前两问**：1) 已有实现？→ `grep -r` 搜索 2) 怎么验证？→ 执行验证命令并贴出结果

| 红线 | 做法 |
|------|------|
| 先搜再写 | `grep/glob` 搜整个项目，禁止假设"不存在"；**符号级"谁调用/改动波及谁"用 LSP**（grep 是有损代理），按查询意图选刀见 skill `code-search-routing` |
| 验证不声称 | 必须通过真实 API 请求验证并贴出结果 |
| 修补不拆除 | 安全加固禁止删除整个模块，只能修补 |
| 并行不串行 | 3+ 独立任务必须并行 sub-agents |
| 执行不规划 | `commit/push/PR` 直接执行，零分析 |
| 源数据验证 | 修改 SQL 生成器后，必须用 Parquet 直查与 API 返回对比验证 |
| 报告必须清晰中文 | 报告类技能产物（HTML/Markdown/PPT/图卡/IM 推送）与回复禁止英文术语缩写堆砌（赔付率/观察期/保单年度/成熟度/降维兜底等必须中文全称）。详细对照表与自检机制见 `~/.claude/rules/common/report-language-redline.md` |

**Pre-flight（每次任务前）**：1) `grep -r` 搜索已有实现 2) 涉及数据时 `find 数据管理/` 3) 声称完成前 `curl` 验证 4) 删除前列影响清单等用户确认（push 时大文件/分支保护/冲突标记/governance 由 `.claude/settings.json` hooks 自动拦截）

**方法确认协议**：遇到"下钻/层级"→先问用户交互模型再实现（其余触发词的处置见上方红线表与 Pre-flight）

---

## 1. 索引与文档

| 索引 | 路径 |
|------|------|
| 文档索引 | `开发文档/00_index/DOC_INDEX.md` |
| 代码索引 | `开发文档/00_index/CODE_INDEX.md` |
| 数据索引 | `开发文档/00_index/DATA_INDEX.md` |
| 进展索引 | `开发文档/00_index/PROGRESS_INDEX.md` |

**必读文档**：`ARCHITECTURE.md`（模块层级）· `开发文档/TECH_STACK.md`（技术栈）· `开发文档/DEVELOPER_CONVENTIONS.md`（DC-001 三要素）· `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`（38 字段定义）· `开发文档/缺口清单.md`（信息缺口追踪）

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求）· [PROGRESS.md](./PROGRESS.md)（进展）

**数据知识协议**：数据处理任务必读 [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)。唯一事实源：`数据管理/knowledge/rules/车险数据业务规则字典.md`

---

## 2. 指标注册表（RED LINE）

**唯一事实源**：`server/src/config/metric-registry/`（L1-L3 原子指标）· 指标字典：`开发文档/指标字典.md`（自动生成，禁止手动编辑）

**新增/修改指标流程**（必须按顺序）：
1. `grep -r "id: '${NEW_ID}'" server/src/config/metric-registry/` — 确认不存在
2. 判断复杂度：L1-L3（单行 SQL 表达式）→ 添加到 `categories/*.ts`；L4（CTE/窗口函数/多表 JOIN）→ SQL 生成器中实现，引用注册表原子指标
3. 必须包含：id + name + formula + sql.expression + display + 至少 1 个 testCase + changelog
4. `bun scripts/metric-registry/validate.ts` 校验通过
5. `bun scripts/metric-registry/generate-frontend-map.ts` 更新前端映射

**禁止**：
- ❌ 在 SQL 生成器中硬编码新指标公式而不在注册表注册
- ❌ 在前端硬编码指标标签/阈值而不从注册表派生
- ❌ 新增与已有指标公式重复的指标（先 `grep` 注册表确认不存在）
- ❌ 修改已发布指标公式而不更新 version 和 changelog

**跨项目对齐**：作战地图 `00_规范与协议/指标字典_v2.0.md` 是业务层权威定义，本注册表是代码层实现。两者公式必须一致。

### 字段注册表（RED LINE）

**唯一事实源**：`server/src/config/field-registry/fields.json`（56 个字段：14 必需 + 42 可选）

**新增/修改字段流程**（必须按顺序）：
1. 修改 `fields.json` 中的字段定义
2. 运行 `node scripts/field-registry/generate.mjs` → 自动更新 mapping.ts + validator.ts + etl_fields.json
3. `bun run governance` 验证一致性（#17 检查）

**禁止**：
- ❌ 手动编辑 `mapping.ts` / `validator.ts`（由 codegen 生成，标注 `DO NOT EDIT MANUALLY`）
- ❌ 在 `transform.py` 中硬编码字段列表（从 `etl_fields.json` 读取）
- ❌ 新增 ETL 源字段不在 `shard-config.json:explicitly_ignored_fields` 或 `fields.json` 中声明（Schema 契约会 `sys.exit(1)` 阻断）

### 注册表体系总览

| 注册表 | 路径 | 覆盖范围 | codegen |
|--------|------|---------|---------|
| 指标注册表 | `server/src/config/metric-registry/` | 52 个指标 | `generate-frontend-map.ts` |
| 字段注册表 | `server/src/config/field-registry/fields.json` | 56 个字段 | `field-registry/generate.mjs` |
| 客户类别 | `src/shared/config/customer-categories.ts` + `server/src/config/` | 11 类枚举 | — |
| 环境变量 | `server/src/config/env.ts` | 20+ 变量（6 分组） | — |
| API 路由 | `server/src/config/api-routes.ts` + `src/shared/api/routes.ts` | 50+ 路由 | — |
| ETL 配置 | `数据管理/shard-config.json` | 分片边界 + 显式忽略字段 | — |
| 数据域注册表 | `数据管理/data-sources.json` | 9 域元数据 | ETL 自动更新 |

---

## 3. 护栏（RED LINE）

**架构协议**：Bun 包管理器（禁止 npm/yarn）· 智谱 API `glm-4.7-flash` · 三级限流（禁止降低）· `security.ts` 危险字符黑名单支持中文

> 分片架构、VPS 分层查询、数据同步等详细规则见 `.claude/rules/data-pipeline.md`。业务口径护栏见 `.claude/rules/sql-generators.md`。报价口径修正见 BACKLOG B255。

---

## 4. API 架构

```
前端 Hook → apiClient → GET /api/query/*
  → Service Worker (stale-while-revalidate, 0ms 二次访问)
  → server/src/routes/query.ts（聚合器）
    → authMiddleware → permissionMiddleware
    → query/*.ts → route-cache（LRU 内存层, <1ms 命中）
      ├→ 命中: sendWithEtag → respond
      └→ 未命中: sql/*.ts → duckdb.ts → JSON
```

**Service Worker**：`public/sw.js` · 仅生产环境 + 仅 `/api/query/*` GET · 每日轮询 `/api/data/version` 检测 ETL 更新 · SW 活跃时 React Query staleTime=Infinity

**启动**：`bun run dev:full`（禁止只运行 `bun run dev`）

**关键文件**：`src/shared/contexts/DataContext.tsx`（isDataLoaded）· `src/shared/api/client.ts`（API 入口 `apiClient`；Phase 2 拆为 client-core 传输内核 + 13 域命名空间子客户端 `apiClient.{auth,ai,data,workflows,crossSell,performance,repair,claimsDetail,quoteConversion,customerFlow,premium,geo,patrol}.*`，详见 CODE_INDEX.md）· `server/src/services/duckdb.ts`（查询执行 + `loadMultipleParquet()`）· `server/src/config/paths.ts`（路径配置）· `server/src/routes/query.ts`（路由聚合器）+ `query/*.ts`（20 子路由 + shared）· `server/src/sql/`（50 个 SQL 模块：30 顶层 + 20 子目录拆分）· `server/src/config/preset-users.ts`（用户）· `server/src/services/access-control.ts`（权限）

**API 前缀**：`/api/query/*`（KPI/趋势/排名/成本/系数/续保/交叉销售）· `/api/data/*`（文件）· `/api/ai/*`（NL2SQL/需求识别）· `/api/auth/*`（登录 + tokens + route-catalog）· `/api/filters/*`（筛选器）

**PAT + CLI + MCP 三件套**（程序化只读访问，详见 `开发文档/PAT_GUIDE.md`）：
- **PAT**：长期 Bearer Token，格式 `cx_pat_<id8>.<secret43>`，强制只读（`readonlyMiddleware` 拦 POST/PUT/DELETE），权限完全继承用户（dataScope/allowedRoutes）；DB 存 `bcrypt(secret)`，明文仅生成时返回一次
- **CLI**（`@chexian/cli`）：`cx login/whoami/routes/query`，commander + cli-table3 + kleur，配置 `~/.chexian/config.json`（chmod 600）
- **MCP**（`@chexian/mcp`）：stdio，启动拉 `/api/auth/route-catalog` 转 MCP tools；Claude Desktop 配 `mcpServers.chexian.env.CX_PAT`
- **限流**：PAT 单独桶 60/min（基线 100/200 不变）；**审计** `logs/audit.log` 加 `auth_kind` + `token_id` 字段

---

## 5. 交付与技术栈

**DONE 判定**：关联文档 + 关联代码 + 验收证据（至少一项）。核心层改动须更新 INDEX.md。提交前：`bun run governance`

**技术栈**：React + TypeScript + Vite + DuckDB + ECharts · Bun 包管理器 · DuckDB CLI（`brew install duckdb`，与 Neo `@duckdb/node-api` minor 兼容，用于源数据直查与口径验证）

```bash
bun install && bun run dev:full    # 安装+启动
bun run build                      # 类型检查+构建
bun run test                       # 单元测试（⚠️ 不是 bun test）
bun run test:integration           # 集成测试（需 DuckDB 原生二进制，仅本地）
bun run test:e2e                   # E2E（需先 dev:full，凭据 admin/CxAdmin@2026!）
bun run governance                 # 治理校验
```

**CI 测试分层协议**（RED LINE）：
- **单元测试** (`bun run test`): 198 文件 / 2559 测试 — CI + 本地
- **集成测试** (`bun run test:integration`): 4 文件 — 仅本地（需 DuckDB 原生二进制）
- CI 环境无法解析 `.node` 原生模块（vitest/jsdm 限制），相关测试必须在 `vite.config.ts` exclude 中排除
- 新增原生模块依赖时，必须检查是否有对应测试需排除

---

## 6. 验证协议

| 场景 | 验证命令 |
|------|----------|
| 修改 SQL | `curl -s localhost:3000/api/query/kpi \| jq '.data \| length'` |
| 修改交叉销售 SQL | `python3 scripts/verify-cross-sell.py --date <YYYY-MM-DD>` |
| 源数据口径验证 | `duckdb -c "SELECT ... FROM '数据管理/warehouse/<域>/.../*.parquet'"` 直查 → 与 API 返回对比 |
| 修改路由 | `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/[路由]` |
| 修改前端 | `bun run build` 零 TS 报错 |
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

---

## 8. 协作与部署

**任务 ID**：@user B001-B099 / @claude B100-B199 / @codex B200-B299

**PR 前**：`git fetch origin main && git rebase origin/main && bun run governance`（并行规则见 §0 红线"并行不串行"）

**生产环境**：腾讯云 2核4G `162.14.113.44` · `https://chexian.cretvalu.com` · PM2 `chexian-api` 端口 3000 · Nginx 前端 `/var/www/chexian/frontend/dist` · **PM2 重启**：deployer 无法直接调 pm2，须 `sudo /usr/local/bin/deploy-chexian-api reload`（或 `restart`/`install`）

**日常数据发布**：优先用 `bun run release:daily:dry`（只看计划）· `bun run release:daily:check`（ETL/VPS/reload/health，企微 dry-run）· `bun run release:daily`（ETL → VPS → reload → health → 企微同步）。细节见 `数据管理/integrations/wecom_smartsheet/README.md` 与 `scripts/sync-and-reload.mjs --help`

**数据 ETL**：`node 数据管理/daily.mjs`（智能检测）· `node 数据管理/daily.mjs premium|claims|quotes|all`（强制）· 维度表：`python3 数据管理/warehouse/dim/generate_dim_tables.py`

**数据同步**：`node scripts/sync-vps.mjs`（rsync `policy/current/` + `claims/` + `quotes/` + 维度表 `salesman/` + `plan/`）

**CI/CD**：`deploy.yml`（push main → 构建→部署→健康检查）· `claude-code.yml`（@claude 触发）· `governance-check.yml`（PR 治理）

**工具箱**：命令在 `.claude/commands/`、agent 在 `.claude/agents/`（AI-native：均由各文件 frontmatter `description` 自动注入上下文被发现，不维护人类向 README 索引）· 常用：`/chexian-commit-push-pr` `/chexian-data-analysis` `/chexian-security-review` `/chexian-verify` `/chexian-deploy`

---

## 9. 部署清单

声称"已部署"前必须逐项验证 build / governance / PM2 / env / CORS / Parquet schema / 健康检查 / 核心 API 共 8 项 — 详见 [.claude/rules/deploy-chain-sop.md §4](./.claude/rules/deploy-chain-sop.md)。

---

## 10. 领域知识

车险分析任务**禁止假设因果关系或业务定义**，不确定时先问用户。9 条铁律（风险等级 / 终端来源 ≠ 渠道 / 定价系数 ≠ 赔付因果 / 出险率分母 / 驾乘推介率与渗透率 / 推介率分母 / 赔付率分子 / 客户类别 11 类）+ 业务规则字典唯一事实源 — 详见 [.claude/rules/business-domain.md](./.claude/rules/business-domain.md)。

---

## 11. 文件与路径规则

| 规则 | 说明 |
|------|------|
| 先确认再动手 | 用户提到文档/计划，若有多版本先问"哪个版本？" |
| Session 数据 | 读 `~/.claude/` 下 JSONL 文件，不是项目文档 |
| 禁止硬编码路径 | 使用 `server/src/config/paths.ts` 或环境变量 |
| 数据文件 | `数据管理/warehouse/` 是本地源，`server/data/` 是 VPS 运行时 |

---

## 12. 扩展机制前缀规范

`chexian-*` / `diagnose-*` 簇命名规则、`xcl-*` 遗留治理、frontmatter 必填项、单一事实源策略、审计脚本 — 详见 [.claude/rules/skill-prefix.md](./.claude/rules/skill-prefix.md)。本项目相关全局 skill 的"项目用法"见 [.claude/rules/skills-map.md](./.claude/rules/skills-map.md)。
