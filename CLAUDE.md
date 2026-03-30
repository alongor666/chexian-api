# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。React + TypeScript + Vite + ECharts，后端 Express + DuckDB。生产环境 `https://chexian.cretvalu.com`。

---

## 0. 红线规则

**写代码前三问**：1) 已有实现？→ `grep -r` 搜索 2) 改多少行？→ <30% 用 Edit，≥50% 用 Write 3) 怎么验证？→ 执行验证命令并贴出结果

| 红线 | 做法 |
|------|------|
| 先搜再写 | `grep/glob` 搜索整个项目，禁止假设"不存在" |
| 验证不声称 | 必须通过真实 API 请求验证并贴出结果 |
| 修补不拆除 | 安全加固禁止删除整个模块，只能修补 |
| 并行不串行 | 3+ 独立任务必须并行 sub-agents |
| Edit > Write | 改动少用 Edit，新建/大改用 Write |
| 执行不规划 | `commit/push/PR` 直接执行，零分析 |

**Pre-flight（每次任务前）**：1) `grep -r` 搜索已有实现 2) 涉及数据时 `find 数据管理/` 3) 声称完成前 `curl` 验证 4) 删除前列影响清单等用户确认 5) push 前检查大文件 6) push 前 `grep -rn '<<<<<<'` 扫描冲突标记 7) push 前 `bun run governance`

**方法确认协议**：遇到"下钻/层级"→问用户交互模型；"已完成"→curl 验证；"不存在"→先搜索；"安全加固/重构"→列清单等确认；"commit/push"→直接执行；"全部检查"→并行 sub-agents

**生产完成定义**（声称"已部署"前缺一不可）：`GET /` 200 + `GET /health` 200 + `POST /api/auth/login` 200 + 至少一个核心 API 200+非空 JSON + 至少一个浏览器场景通过。发布期间有新 commit 必须基于最终 HEAD 重新发布。发布脚本禁止固定 sleep，必须轮询重试。

---

## 1. 索引与文档

| 索引 | 路径 |
|------|------|
| 文档索引 | `开发文档/00_index/DOC_INDEX.md` |
| 代码索引 | `开发文档/00_index/CODE_INDEX.md` |
| 数据索引 | `开发文档/00_index/DATA_INDEX.md` |
| 进展索引 | `开发文档/00_index/PROGRESS_INDEX.md` |

**必读文档**：`ARCHITECTURE.md`（模块层级）· `开发文档/TECH_STACK.md`（技术栈）· `开发文档/DEVELOPER_CONVENTIONS.md`（DC-001 三要素）· `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`（30 字段定义）· `开发文档/缺口清单.md`（信息缺口追踪）

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求）· [PROGRESS.md](./PROGRESS.md)（进展）

**数据知识协议**：数据处理任务必读 [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)。唯一事实源：`数据管理/knowledge/rules/车险数据业务规则字典.md`

---

## 2. 护栏（RED LINE）

**业务口径**：`server/src/services/duckdb.ts` 和 `server/src/routes/query.ts` — 不得修改/删除已有逻辑，只能追加。**废弃路由退出条件**：满足以下全部条件时允许清理——① 用户明确确认 ② 生产日志证明 ≥30 天零流量 ③ 前端无调用方（grep 验证）。见 BACKLOG B237。

**架构协议**：Bun 包管理器（禁止 npm/yarn）· 智谱 API `glm-4.7-flash` · 三级限流（禁止降低）· JWT 认证（禁止绕过）· `security.ts` 危险字符黑名单支持中文

**分域 Lakehouse 架构**（RED LINE）：数据拆分为 3 个独立域，禁止合回单体 parquet：

```
warehouse/fact/
├── policy/daily/YYYY-MM-DD.parquet   ← 保单+保费（每日增量追加，~100KB/天）
├── claims/latest.parquet             ← 赔付+费用（每周全量替换，~10MB）
└── quotes/latest.parquet             ← 报价状态（每日全量替换，~3MB）
```

- 服务器启动自动检测 `policy/daily/` → 走 JOIN 加载；不存在 → 回退旧 `current/` 模式
- ETL 入口：`node 数据管理/etl.mjs`（智能检测，无参数自动判断需更新的域）
- 强制子命令：`node 数据管理/etl.mjs premium|claims|quotes|all`
- 关键方法：`duckdb.ts:loadDomainParquet()` — 创建 3 路 LEFT JOIN 的 `raw_parquet` 视图
- PolicyFact 视图接口不变 — 24 个 SQL 生成器零改动

**VPS 数据目录**：`server/data/fact/policy/daily/`、`server/data/fact/claims/`、`server/data/fact/quotes/`、`server/data/dim/salesman/`、`server/data/dim/plan/`

**报价数据口径**（待修正）：当前 `是否报价` 字段不可靠，正确逻辑应以「续保单号非空」判定已报价。用户待办，AI 不得擅自修改。

**VPS 分层查询**（RED LINE）：❌ 禁止在 VPS 上查询原始 `PolicyFact`（续保除外）。新功能只能查 `DailyAggregated`/`PeriodAggregated`/`CrossSellDailyAgg`。续保 PolicyFact 最小字段集不可扩展：`policy_no, premium, salesman_name, org_level_3, customer_category, insurance_type, insurance_start_date, renewal_policy_no`

**数据同步护栏**（RED LINE）：VPS 同步使用 `rsync` 直接同步 3 个域目录。旧的 `current/` 保留作为回退。`node scripts/sync-vps.mjs` 仍可用于旧模式。

---

## 3. 复用检查

**三问**：已有吗？→ CODE_INDEX.md + `src/widgets/INDEX.md` · 能复用吗？→ `src/shared/` · 有模式吗？→ 查同类实现

| 类别 | 位置 |
|------|------|
| UI组件 | `src/widgets/INDEX.md` |
| 样式系统 | `src/shared/styles/index.ts`（tableStyles/textStyles/colorClasses） |
| API客户端 | `src/shared/api/client.ts` |
| 格式化 | `src/shared/utils/formatters.ts`（formatCount/formatPremiumWan/formatPercent/formatCoefficient） |
| 类型 | `src/shared/types/` |

**样式规范**：使用 `colorClasses`/`tableStyles`/`fontStyles` 等全局样式，禁止硬编码 Tailwind 颜色。新组件须在 INDEX.md 登记。

---

## 4. API 架构

```
前端 Hook → apiClient → GET /api/query/* → server/src/routes/query.ts → server/src/sql/*.ts → duckdb.ts → JSON
```

**启动**：`bun run dev:full`（禁止只运行 `bun run dev`）

**关键文件**：`src/shared/contexts/DataContext.tsx`（isDataLoaded）· `src/shared/api/client.ts`（API 入口）· `server/src/services/duckdb.ts`（查询执行 + `loadDomainParquet()`）· `server/src/config/paths.ts`（域路径函数）· `server/src/routes/query.ts`（路由）· `server/src/sql/`（24 个 SQL 生成器）· `server/src/config/preset-users.ts`（用户）· `server/src/services/access-control.ts`（权限）

**API 前缀**：`/api/query/*`（KPI/趋势/排名/成本/系数/续保/交叉销售）· `/api/data/*`（文件）· `/api/ai/*`（NL2SQL/需求识别）· `/api/auth/*`（登录）· `/api/filters/*`（筛选器）

**防御性编码**：`row.time_period` 可能 undefined，必须 `?? ''` 再 `.includes()`。DuckDB 返回字段都需空值防护。

---

## 5. 设计系统 (DC-003)

所有 UI 必须使用 `src/shared/styles/index.ts`，禁止手写 Tailwind 颜色。

- **数字**：`fontStyles.kpi`/`fontStyles.chart`/`fontStyles.tabular`，禁止虚构类名如 `font-kpi`
- **颜色**：`colorClasses.text.success`(绿) / `colorClasses.text.danger`(红) / `getTrendColorClass(value)`
- **组件**：`cardStyles.base` / `buttonStyles.primary`，或 `src/shared/ui/Card.tsx` / `Button.tsx`

---

## 6. 交付与技术栈

**DONE 判定**：关联文档 + 关联代码 + 验收证据（至少一项）。核心层改动须更新 INDEX.md。提交前：`bun run governance`

**技术栈**：React + TypeScript + Vite + DuckDB + ECharts · Bun 包管理器

```bash
bun install && bun run dev:full    # 安装+启动
bun run build                      # 类型检查+构建
bun run test                       # 单元测试（⚠️ 不是 bun test）
bun run test:e2e                   # E2E（需先 dev:full，凭据 admin/CxAdmin@2026!）
bun run governance                 # 治理校验
```

---

## 7. 验证协议

| 场景 | 验证命令 |
|------|----------|
| 修改 SQL | `curl -s localhost:3000/api/query/kpi \| jq '.data \| length'` |
| 修改路由 | `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/[路由]` |
| 修改前端 | `bun run build` 零 TS 报错 |
| 声称完成 | 至少一个 API 200 + 非空 JSON |
| Git 推送 | `bun run governance && git diff --check` |

验证结果必须出现在输出中。SQL 报错查 [DuckDB 文档](https://duckdb.org/docs/)，禁止猜测。

---

## 8. 异常处理

| 情况 | 处理 |
|------|------|
| 信息缺口 | 登记缺口清单 → BLOCKED |
| 业务口径错误 | 禁止直接改 → BACKLOG 登记 |
| API 失败 | 检查 apiClient 与路由对应，前端新增方法须确认后端路由存在 |
| DuckDB 日期 | DATE→`{days:N}` TIMESTAMP→`{micros:N}`，duckdb.ts 反序列化为 ISO |
| ESM 问题 | 无 `__dirname` 用 `fileURLToPath`；Express 用 `req.originalUrl` |

---

## 9. 协作与部署

**任务 ID**：@user B001-B099 / @claude B100-B199 / @codex B200-B299

**并行规则**：3+ 独立模块/任务必须并行 sub-agents。PR 前：`git fetch origin main && git rebase origin/main && bun run governance`

**生产环境**：腾讯云 2核4G `162.14.113.44` · `https://chexian.cretvalu.com` · PM2 `chexian-api` 端口 3000 · Nginx 前端 `/var/www/chexian/frontend/dist`

**数据 ETL**：`node 数据管理/etl.mjs`（智能检测）· `node 数据管理/etl.mjs premium|claims|quotes|all`（强制）· 维度表：`python3 数据管理/warehouse/dim/generate_dim_tables.py` · 迁移脚本：`python3 数据管理/pipelines/split_existing.py`

**数据同步**：事实表 `rsync -azv 数据管理/warehouse/fact/{policy/daily,claims,quotes}/ chexian-vps-deploy:/var/www/chexian/server/data/fact/...` · 维度表 `rsync -azv 数据管理/warehouse/dim/{salesman,plan}/ chexian-vps-deploy:/var/www/chexian/server/data/dim/...`

**CI/CD**：`deploy.yml`（push main → 构建→部署→健康检查）· `claude-code.yml`（@claude 触发）· `governance-check.yml`（PR 治理）

**工具箱**：[.claude/commands/README.md](./.claude/commands/README.md)（30 命令）· `.claude/agents/`（14 agents）· 常用：`/commit-push-pr` `/sync-and-rebase` `/data-analysis` `/security-review` `/verify`

---

## 10. 领域知识

车险分析任务中，**禁止假设因果关系或业务定义**，不确定时必须先问用户确认。

| 规则 | 说明 |
|------|------|
| 风险等级是结构性数据 | `insurance_grade`(A-G/X) 是车辆属性字段，不是"质量泄漏"或可控因子 |
| 终端来源 ≠ 渠道 | `terminal_source`(出单终端) 和 `channel`(业务渠道) 是不同维度，禁止混用 |
| 定价系数 ≠ 赔付因果 | `商车自主定价系数` 不直接导致出险率变化，禁止假设因果链 |
| 出险率分母 | 用已赚暴露(earned exposure)，不是签单件数(written count) |
| 驾乘推介率 | = 驾意险推介件数 / 商业险出单件数（非保费比） |
| 驾乘渗透率 | = 驾意险承保件数 / 商业险承保件数 |
| 赔付率分子 | 已决赔款 + 未决赔款（满期赔付率用满期保费做分母） |
| 客户类别 | 11 类，按车辆使用性质分，详见业务规则字典 |

**唯一事实源**：`数据管理/knowledge/rules/车险数据业务规则字典.md`。公式/口径有疑问先查此文件，查不到再问用户。

---

## 11. 部署清单

声称"已部署"前，按顺序逐项验证：

1. `bun run build` — 零 TS 报错
2. `bun run governance` — 治理通过
3. PM2 状态检查 — `pm2 describe chexian-api`，若 errored 则 `pm2 delete chexian-api && pm2 start ecosystem.config.js`（禁止只 restart/reload）
4. 环境变量 — 确认 `ecosystem.config.js` 中所有 env 变量在 VPS 上有值
5. CORS 配置 — 确认不会因 env 缺失抛异常
6. DuckDB/Parquet 兼容 — `union_by_name` schema 一致性
7. 健康检查 — `curl -s https://chexian.cretvalu.com/health` 返回 200
8. 核心 API — 至少一个 `/api/query/*` 返回 200 + 非空 JSON

---

## 12. 文件与路径规则

| 规则 | 说明 |
|------|------|
| 先确认再动手 | 用户提到文档/计划，若有多版本先问"哪个版本？" |
| Session 数据 | 读 `~/.claude/` 下 JSONL 文件，不是项目文档 |
| 禁止硬编码路径 | 使用 `server/src/config/paths.ts` 或环境变量 |
| 数据文件 | `数据管理/warehouse/` 是本地源，`server/data/` 是 VPS 运行时 |

---

## 13. 审查质量

审查计划或文档时：

1. **事实核查**：所有声明对照实际代码/数据验证，不信任表面描述
2. **逻辑一致性**：检查边界条件和矛盾，不只看表面结构
3. **诚实评分**：浅层审查浪费时间，宁可花多一轮也不输出低质量结论
4. **业务逻辑标注**：涉及保险/分析内容，所有假设的业务逻辑都标注 `⚠️ 待用户确认`

---

## 语言规范
所有回复必须使用**中文**，除非涉及代码、命令、专有名词或英文引用。

---

## gstack
Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review,
/design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review,
/setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful,
/freeze, /guard, /unfreeze, /gstack-upgrade.
