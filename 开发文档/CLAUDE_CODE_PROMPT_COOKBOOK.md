# @claude Prompt 实战手册

> 基于 chexian-api 3 月份 184 个 commit 的真实场景提炼，拿来即用。
> 适用：在 PR / Issue 评论中 `@claude` 触发。
> 最后更新：2026-04-02

---

## 目录

1. [使用原则](#1-使用原则)
2. [Bug 修复类](#2-bug-修复类)（3 月 61 次 fix，占比 33%）
3. [功能实现类](#3-功能实现类)（3 月 44 次 feat，占比 24%）
4. [重构类](#4-重构类)（3 月 16 次 refactor）
5. [测试加固类](#5-测试加固类)
6. [CI/CD 与部署类](#6-cicd-与部署类)
7. [安全加固类](#7-安全加固类)
8. [代码审查类](#8-代码审查类)
9. [数据/ETL 类](#9-数据etl-类)
10. [文档与治理类](#10-文档与治理类)
11. [反模式：不要这样写](#11-反模式不要这样写)

---

## 1. 使用原则

### Prompt 五要素

```
① WHO    — 你要 Claude 扮演什么角色（可选，复杂任务加）
② WHAT   — 具体要做什么（必须，越具体越好）
③ WHERE  — 涉及哪些文件/模块（必须，给路径）
④ WHY    — 为什么要做（背景/根因，帮助 Claude 做正确判断）
⑤ HOW    — 验证标准/约束条件（可选但推荐）
```

### 黄金法则

| 规则                           | 说明                                                  |
| ------------------------------ | ----------------------------------------------------- |
| **给路径**               | `server/src/sql/kpi-sql.ts` 比 "KPI 模块" 好 10 倍  |
| **给根因**               | "因为 X 导致 Y" 比 "修复 Y" 好——Claude 不会修错方向 |
| **给边界**               | "只改这个文件/不要改 XX" 防止 Claude 越界             |
| **给验证**               | "改完跑 `bun run test`" 让 Claude 自我校验          |
| **一个 prompt 一个任务** | 拆分 > 堆叠，Claude 在 Actions 中没有持续对话能力     |

---

## 2. Bug 修复类

> 3 月教训：61 个 fix commit，其中 SQL 口径错误、类型错误、E2E 失败是三大重灾区。

### 2.1 SQL 口径/逻辑错误

**场景**：`premium-plan level=company 查询因缺少 GROUP BY 返回 400`

```markdown
@claude 修复 `server/src/sql/premium-plan-sql.ts` 中 `level=company` 时的 SQL 错误。

**根因**：当 level 为 company 时，SELECT 中包含聚合字段但 GROUP BY 子句缺少对应的分组列，
导致 DuckDB 报 SQL 语法错误，API 返回 400。

**修复要求**：
1. 补全 GROUP BY 子句，确保所有非聚合列都包含在内
2. 添加对应的单元测试用例覆盖 level=company 场景
3. 修改后运行 `bun run test --run` 确保无回归

**参考**：同类 SQL 生成器 `server/src/sql/kpi-sql.ts` 的 GROUP BY 处理模式。
```

---

**场景**：`驾乘推介率整体行分母排除纯交强，与业务定义对齐`

```markdown
@claude 修复 `server/src/sql/cross-sell-sql.ts` 中驾乘推介率整体行的分母计算。

**业务定义**（来自 `数据管理/knowledge/rules/车险数据业务规则字典.md`）：
- 推介率 = 驾意险推介件数 / 商业险出单件数
- 分母"商业险出单件数"仅含主全+交三，排除纯交强/单交

**当前问题**：整体行(total)的分母没有排除纯交强，导致推介率偏低。

**修复约束**：
- 遵循指标注册表 `server/src/config/metric-registry/` 中的公式定义
- 不要修改其他指标的计算逻辑
- 添加测试用例验证：整体行分母 < 全部保单数
```

---

**场景**：`率值指标全项目修正 — 禁止加权平均，统一绝对值聚合`

```markdown
@claude 全项目扫描并修复率值指标的聚合方式。

**规则**：赔付率、出险率、推介率等率值指标，汇总时**禁止加权平均**，
必须基于分子分母的绝对值重新计算。

**错误模式**（需要搜索并修复）：
```sql
-- ❌ 错误：对率值直接 AVG
AVG(loss_ratio) AS loss_ratio
-- ✅ 正确：基于绝对值聚合后重算
SUM(claim_amount) / NULLIF(SUM(earned_premium), 0) AS loss_ratio
```

**扫描范围**：`server/src/sql/*.ts` 所有 SQL 生成器
**验证**：修复后 `bun run test --run` + `bun run governance` 全通过
**约束**：只改率值指标的聚合方式，不改其他逻辑

```

---

### 2.2 TypeScript 类型错误

**场景**：`KpiData 缺少 vehicle_plan_wan + useTruckAnalysis 类型错误`

```markdown
@claude 修复 TypeScript 类型错误导致的构建失败。

**错误信息**：
```

src/features/dashboard/types.ts - Property 'vehicle_plan_wan' does not exist on type 'KpiData'
src/hooks/useTruckAnalysis.ts - Parameter 'data' implicitly has an 'any' type

```

**修复要求**：
1. 在 `KpiData` 类型定义中补充缺少的字段（类型从 API 实际返回推断）
2. 为 `useTruckAnalysis` 添加正确的参数类型注解
3. 运行 `bun run build` 确认零 TS 报错
4. 不要添加 `// @ts-ignore` 或 `any` 类型逃逸
```

---

### 2.3 E2E 测试失败

**场景**：`CI 登录超时根因修复——GitHub Secrets 凭据 + 就绪增强`

```markdown
@claude 修复 E2E 测试在 CI 中的登录超时问题。

**现象**：`bun run test:e2e` 在 GitHub Actions 中 auth.setup.ts 阶段超时失败，
本地运行正常。

**已知信息**：
- CI 环境通过 `E2E_USERNAME` / `E2E_PASSWORD` 环境变量传入凭据
- 正确凭据：admin / <在凭据库/E2E_PASSWORD 环境变量中获取>
- 后端可能未完全就绪时前端已开始测试

**排查方向**：
1. 检查 `tests/e2e/auth.setup.ts` 是否正确读取环境变量
2. 检查是否有后端就绪检测（health check）逻辑
3. 如无就绪检测，添加：循环 curl `/health` 直到 200，最多等 30s

**约束**：不要修改实际的测试用例逻辑，只修复基础设施问题。
```

---

### 2.4 前端渲染/交互 Bug

**场景**：`营业货车饼图按机构聚合，消除吨位×机构交叉行导致的标签重叠`

```markdown
@claude 修复营业货车分析饼图的标签重叠问题。

**根因**：SQL 返回的是吨位×机构的交叉行（如 "1-2吨/天府" 和 "1-2吨/乐山"），
但饼图预期按机构维度聚合展示。交叉行导致标签过多重叠不可读。

**修复方案**：
1. 在 SQL 层面 GROUP BY org_level_3 聚合保费（不要在前端聚合）
2. 或者在 API 响应处理层做数据预聚合
3. 饼图标签数 > 8 时自动隐藏小于 3% 占比的标签

**涉及文件**：
- SQL: `server/src/sql/truck-sql.ts`（看具体的饼图查询函数）
- 前端: 搜索 `grep -r "营业货车" src/` 定位组件

**验证**：`bun run build` 无报错
```

---

### 2.5 数据空值防护

**场景**：`row.time_period` 可能 undefined，`?? ''` 再 `.includes()`

```markdown
@claude 扫描 `server/src/routes/query.ts` 和 `server/src/sql/*.ts` 中的空值风险。

**背景**：DuckDB 查询返回的字段可能为 null/undefined，
直接调用 `.includes()` / `.startsWith()` 等方法会抛 TypeError。

**任务**：
1. `grep -rn '\.includes\|\.startsWith\|\.endsWith\|\.split\|\.trim' server/src/` 
   找出所有直接调用字符串方法的位置
2. 对来自 DuckDB 查询结果的字段，添加 `?? ''` 或 `?. ` 防护
3. 不要改动硬编码的常量字符串（那些不会是 null）

**约束**：只添加空值防护，不要重构函数签名或改变业务逻辑。
```

---

### 2.6 VPS 内存溢出（OOM）

**场景**：`CrossSellDailyAgg 按月分批物化解决 VPS OOM`

```markdown
@claude 修复 `server/src/services/duckdb.ts` 中 CrossSellDailyAgg 物化时的 OOM 问题。

**环境**：VPS 4核4G，DuckDB 默认可能占用过多内存。

**根因**：一次性物化全量 CrossSellDailyAgg 表时，DuckDB 内存峰值超过 4G 导致进程被 kill。

**修复方向**：
1. 改为按月分批物化：循环 12 个月，每次 INSERT INTO ... SELECT ... WHERE month = N
2. 在启动时显式 `SET memory_limit = '1GB'`（或从环境变量读取）
3. 物化前先 DROP TABLE IF EXISTS，避免残留数据

**参考**：`server/src/services/duckdb.ts` 中 `materializeTable()` 的现有实现。
**验证**：本地 `bun run dev:full` 启动无报错，`/api/query/cross-sell` 返回正常数据。
```

---

## 3. 功能实现类

> 3 月 44 个 feat commit，热力图下钻、续保漏斗、诊断工具是三大主题。

### 3.1 新增 API 端点（标准模式）

**场景**：`续保漏斗分析模块——四级漏斗+行动优先级+机构矩阵`

```markdown
@claude 新增续保漏斗分析 API 端点。

**需求**：
- 端点：`GET /api/query/renewal-funnel`
- 参数：`year`, `org_level_3`, `customer_category`（均可选）
- 返回：四级漏斗数据（到期→报价→承保→续保）

**实现步骤**（按项目规范）：
1. **SQL 生成器**：新建 `server/src/sql/renewal-funnel-sql.ts`，参考 `renewal-sql.ts` 模式
2. **路由注册**：在 `server/src/routes/query/` 下新建路由文件，注册到 `query.ts`
3. **前端 API**：在 `src/shared/api/routes.ts` 注册路由常量
4. **类型定义**：在 `src/shared/types/` 添加响应类型

**约束**：
- SQL 中率值指标用绝对值聚合重算，禁止 AVG
- 参数用 `security.ts` 的 `escapeSqlValue()` 转义
- 遵循 `server/src/config/api-routes.ts` 的路由命名规范

**验证**：`curl localhost:3000/api/query/renewal-funnel | jq '.data | length'` 返回 > 0
```

---

### 3.2 扩展现有维度/下钻

**场景**：`热力图行点击下钻` + `自由维度下钻组件`

```markdown
@claude 为性能热力图添加行点击下钻功能。

**交互模型**：点击热力图某行（如机构"天府"） → 展开该行的下一级维度（团队） → 
显示团队级别的同类热力图指标。面包屑导航支持回退。

**已有实现**（必须复用）：
- 通用下钻组件：`src/shared/components/DrillDown.tsx`（搜索确认是否存在）
- 下钻 SQL 模式：`server/src/sql/` 中带 `drillPath` 参数的生成器

**实现要点**：
1. 后端 SQL 生成器支持 `groupBy` + `filterBy` 参数组合
2. 前端点击行时，将当前行值作为 filter 传入下一级查询
3. 面包屑 state 用 React useState 管理，不用 URL params

**约束**：
- 不要新建独立的下钻组件，复用已有的通用组件
- 不要改动热力图的基础数据查询逻辑
```

---

### 3.3 新增指标（遵循注册表）

**场景**：`版本化指标注册表 — Phase 0-2`

```markdown
@claude 在指标注册表中新增"满期赔付率"指标。

**前置检查**：
`grep -r "满期赔付率\|earned_loss_ratio" server/src/config/metric-registry/` 确认不存在。

**指标定义**（来自业务规则字典）：
- id: `earned_loss_ratio`
- name: 满期赔付率
- formula: 已结案取 settled_amount、未结案取 reserve_amount（二选一，不相加） / 满期保费
- SQL expression: `SUM(CASE WHEN settlement_time IS NOT NULL THEN settled_amount ELSE reserve_amount END) / NULLIF(SUM(earned_premium), 0)`
- display: { format: 'percent', precision: 2, thresholds: { warning: 0.7, danger: 0.9 } }

**流程**（按 CLAUDE.md §14 指标开发协议）：
1. 添加到 `server/src/config/metric-registry/categories/cost.ts`（含 testCase + changelog）
2. `bun scripts/metric-registry/validate.ts` — 校验通过
3. `bun scripts/metric-registry/generate-frontend-map.ts` — 更新前端映射
4. 不要在 SQL 生成器中硬编码此指标公式

**验证**：`bun run governance` 通过
```

---

### 3.4 权限/认证功能

**场景**：`DEV_SKIP_AUTH 开发环境免密登录 + 清除全部硬编码密码`

```markdown
@claude 添加开发环境免密登录机制。

**需求**：当环境变量 `DEV_SKIP_AUTH=true` 且 `NODE_ENV=development` 时，
跳过密码验证，直接以 admin 身份登录。

**实现位置**：`server/src/services/auth.ts` 或 `server/src/routes/auth.ts`

**安全约束（RED LINE）**：
1. 必须同时满足两个条件：`DEV_SKIP_AUTH=true` AND `NODE_ENV=development`
2. 生产环境（`NODE_ENV=production`）即使设了 `DEV_SKIP_AUTH` 也不生效
3. 跳过密码时在日志中打印 WARNING 提示
4. 不要删除或修改现有的密码验证逻辑，只在前面加一个 early return

**验证**：
- `DEV_SKIP_AUTH=true bun run dev:server` → POST `/api/auth/login` 无需密码返回 token
- 不设变量时行为不变
```

---

## 4. 重构类

### 4.1 模块拆分

**场景**：`query.ts modular split into 14 sub-route files`

```markdown
@claude 将 `server/src/routes/query.ts` 拆分为子模块。

**当前问题**：`query.ts` 超过 800 行，包含 14 个独立的路由处理器，违反单文件 <800 行规范。

**拆分方案**：
1. 创建 `server/src/routes/query/` 目录
2. 每个路由处理器提取为独立文件（如 `kpi.ts`, `trend.ts`, `cost.ts`）
3. `query/index.ts` 作为路由注册入口，导入并挂载所有子路由
4. 保持所有 API 路径不变（`/api/query/kpi` 等）

**约束**：
- 纯结构重构，零功能变更
- 不要改动 SQL 生成器的导入路径
- 不要改动前端 API 调用
- 拆分后 `bun run test --run` 全部通过
- 拆分后 `curl localhost:3000/api/query/kpi` 返回与拆分前一致
```

---

### 4.2 SQL 生成器引用注册表

**场景**：`SQL 生成器引用指标注册表（Phase 3a+3b）`

```markdown
@claude 将 `server/src/sql/cost-sql.ts` 中硬编码的指标公式替换为指标注册表引用。

**当前问题**：
```typescript
// ❌ cost-sql.ts 中硬编码
const sql = `SUM(commission) / NULLIF(SUM(premium), 0) AS commission_rate`
```

**目标**：

```typescript
// ✅ 从注册表获取 SQL expression
import { getMetric } from '../config/metric-registry'
const metric = getMetric('commission_rate')
const sql = `${metric.sql.expression} AS ${metric.id}`
```

**范围**：仅改 `cost-sql.ts`，其他 SQL 生成器后续 PR 再处理。
**验证**：改前改后 API 返回数据一致（用 `curl` 对比 `/api/query/cost` 的输出）。

```

---

### 4.3 字段合并/统一

**场景**：`合并三个互斥风险等级字段为统一的 insurance_grade`

```markdown
@claude 将 `insurance_grade` / `small_truck_score` / `large_truck_score` 三个互斥字段
合并为统一的 `insurance_grade`（车险风险等级）。

**业务背景**：三个字段分别对应非营业客车/小货车/大货车的风险评级，
值域统一为 A-G/X，同一保单只有一个字段有值，其余为 NULL。

**改动范围**：
1. **字段注册表**：`server/src/config/field-registry/fields.json` — 删除两个旧字段，保留 insurance_grade
2. **ETL**：`数据管理/` 中的 transform 逻辑，用 `COALESCE(insurance_grade, small_truck_score, large_truck_score)` 合并
3. **SQL 生成器**：`grep -r 'small_truck_score\|large_truck_score' server/src/sql/` 替换为 insurance_grade
4. **codegen**：`node scripts/field-registry/generate.mjs` 重新生成

**禁止**：不要改动前端组件中的 insurance_grade 引用（前端已经用的是统一字段名）。
**验证**：`bun run governance` 通过 + `bun run test --run` 全绿。
```

---

### 4.4 消除重复代码

**场景**：`eliminate 4-CTE duplication and fix heatmap business_nature`

```markdown
@claude 消除 `server/src/sql/heatmap-sql.ts` 中的 CTE 重复代码。

**当前问题**：4 个查询函数各自定义了几乎相同的 CTE（公共表表达式），
仅 WHERE 条件和最终 SELECT 不同。约 200 行重复。

**重构方案**：
1. 提取公共 CTE 为 `buildBaseCTE(filters)` 函数
2. 每个查询函数只定义差异部分（最终 SELECT + 特有 WHERE）
3. 不要创建单独的 utils 文件——就在 heatmap-sql.ts 内部提取

**约束**：
- 纯结构重构，SQL 输出与重构前完全一致
- 不要改动 business_nature 的 4 类分类逻辑
- 用 `bun run test --run -- heatmap` 验证
```

---

## 5. 测试加固类

### 5.1 补充单元测试

```markdown
@claude 为 `server/src/sql/renewal-sql.ts` 补充单元测试。

**目标覆盖率**：80%+，重点覆盖：
1. 无筛选条件 → 生成的 SQL 无 WHERE 子句
2. 按 org_level_3 筛选 → WHERE 包含机构条件
3. 按日期范围筛选 → WHERE 包含日期条件
4. level=company → GROUP BY 包含 company 列
5. 率值指标 → 用绝对值聚合而非 AVG

**测试规范**：
- 文件：`server/src/sql/__tests__/renewal-sql.test.ts`
- 使用 vitest，参考 `server/src/sql/__tests__/kpi-sql.test.ts` 的结构
- 测试 SQL 字符串包含/不包含特定片段，不要实际执行 SQL
- 不要 mock DuckDB（单元测试只验证 SQL 生成逻辑）
```

---

### 5.2 契约测试 / 防回归

**场景**：`推介率 fail-fast 断言 + 率值治理防回归测试`

```markdown
@claude 添加率值指标的防回归契约测试。

**背景**：3 月份多次出现率值指标被错误地用 AVG 聚合的回归。
需要一个自动化测试防止未来再犯。

**测试内容**：
1. 扫描 `server/src/sql/*.ts` 所有文件
2. 断言：不存在 `AVG(.*_rate)` 或 `AVG(.*_ratio)` 模式
3. 断言：率值指标的 SQL 表达式都是 `SUM(...) / NULLIF(SUM(...), 0)` 模式
4. 如果有新增的率值指标用了 AVG，测试立即 fail 并输出文件名+行号

**文件**：`server/src/sql/__tests__/rate-invariant.test.ts`
**运行**：`bun run test --run -- rate-invariant`
```

---

### 5.3 E2E 测试稳定化

```markdown
@claude 稳定化 E2E 测试中的登录流程。

**当前问题**：CI 中 auth.setup.ts 偶发超时，原因是后端未完全启动时前端已开始请求。

**修复要求**：
1. 在 `tests/e2e/auth.setup.ts` 开头添加后端就绪检测：
   循环请求 `GET /health`，200 后再继续，最多等 30s
2. 登录凭据从环境变量读取，fallback 到硬编码默认值
3. 登录成功后保存 auth state 到文件，供后续测试复用

**约束**：
- 不要修改其他 spec 文件
- 不要增加 `sleep` / `waitForTimeout`（用 `waitForResponse` 或 polling）
- 参考 Playwright 官方的 `globalSetup` 模式
```

---

## 6. CI/CD 与部署类

### 6.1 Workflow 修复

**场景**：`全面修复四个 workflow 文件`

```markdown
@claude 修复 `.github/workflows/deploy.yml` 中的部署问题。

**错误日志**：
```

Error: Process completed with exit code 255.
ssh: connect to host 162.14.113.44 port 22: Connection timed out

```

**修复方向**：
1. SSH 连接添加超时和重试（`-o ConnectTimeout=10`，最多重试 3 次）
2. 部署前添加 SSH preflight check：`ssh -o BatchMode=yes user@host exit`
3. 部署命令使用 `sudo /usr/local/bin/deploy-chexian-api reload`（不是 pm2 restart）

**约束**：
- 不要修改 secrets 配置（SSH key 等在 GitHub Settings 中管理）
- 不要修改 governance-check.yml（那个没问题）
```

---

### 6.2 Production Gate

```markdown
@claude 在 `.github/workflows/production-gate.yml` 中添加 Parquet schema 一致性检查。

**目的**：PR 合并前自动检测 field-registry 与 ETL 产出的 Parquet schema 是否一致。

**实现**：
1. `bun run governance` 已包含 #17 检查，确保直接调用
2. 如果 governance 失败，gate 应该 fail 并在 PR 评论中输出失败原因
3. 使用 `continue-on-error: false`（不是 true）

**参考**：现有的 `governance-check.yml` 实现。
```

---

## 7. 安全加固类

**场景**：`全面安全加固 — 13 项漏洞修复`

```markdown
@claude 对 `server/src/` 进行安全审查并修复发现的漏洞。

**审查清单**（OWASP Top 10 + 项目特有）：
1. SQL 注入：所有用户输入是否经过 `escapeSqlValue()` 转义？
2. XSS：API 响应中的用户输入是否被转义？
3. 认证绕过：是否有路由缺少 `authMiddleware`？
4. 路径穿越：文件操作是否校验了路径？
5. 密码硬编码：`grep -rn 'password\|secret\|apiKey' server/src/` 有无泄露？

**约束（RED LINE）**：
- 修补不拆除——不要删除整个模块，只修补漏洞
- 不要降低现有的三级限流配置
- 不要绕过 JWT 认证
- `security.ts` 的危险字符黑名单支持中文，不要破坏

**输出**：以 PR 评论列出发现的问题清单 + 修复 diff。
```

---

**场景**：`diagnose_agent.py SQL 转义缺失`

```markdown
@claude 修复 `数据管理/tools/diagnose_agent.py` 中 `resolve_agent_name()` 函数的 SQL 注入漏洞。

**漏洞**：用户输入的经代公司名直接拼接到 SQL 字符串中，未转义单引号。
输入 `O'Brien` 会导致 SQL 语法错误，恶意输入可注入任意 SQL。

**修复**：
1. 对用户输入的 agent_name 进行转义：`agent_name.replace("'", "''")`
2. 或使用 DuckDB 的参数化查询（`?` 占位符 + params 列表）

**约束**：只改这一个函数，不要重构整个文件。
**验证**：`python3 数据管理/tools/diagnose_agent.py --agent "测试'公司"` 不报 SQL 错误。
```

---

## 8. 代码审查类

### 8.1 标准审查

```markdown
@claude review
```

> `@claude review` 由 `claude.yml`（`@claude` 触发）接住，按 CLAUDE.md 规范执行一次 review。
> 注：旧 `auto-review` 专用 Job 及 PR 自动触发已于 2026-06-13（PR #620）取消，现仅手动触发。

---

### 8.2 定向审查

```markdown
@claude review 请重点审查以下方面：

1. **SQL 注入风险**：所有 SQL 生成器中的用户输入是否经过转义
2. **率值指标**：是否有率值用了 AVG 而非绝对值聚合
3. **空值防护**：DuckDB 返回字段是否有 `?? ''` 防护
4. **指标注册表一致性**：SQL 中硬编码的指标公式是否与注册表定义一致
```

---

### 8.3 性能审查

```markdown
@claude review 请审查此 PR 的性能影响：

1. **SQL 复杂度**：新增查询的 CTE 层数是否超过 3 层？是否有不必要的子查询？
2. **内存风险**：物化操作是否会在 VPS 4G 内存下 OOM？是否需要分批？
3. **N+1 查询**：前端是否有循环调用 API 的模式？
4. **Bundle size**：新增的前端依赖是否过大？
```

---

## 9. 数据/ETL 类

### 9.1 ETL 管道修改

**场景**：`daily.mjs 支持 claims/quotes/all 子命令`

```markdown
@claude 为 `数据管理/daily.mjs` 添加子命令支持。

**当前**：`node 数据管理/daily.mjs` 只能全量更新所有域。
**目标**：`node 数据管理/daily.mjs claims` 只更新赔付域。

**子命令定义**：
- `premium` — 只更新保单+保费（4 个分片）
- `claims` — 只更新赔付（`claims/latest.parquet`）
- `quotes` — 只更新报价（`quotes/latest.parquet`）
- `all` — 全部更新（默认行为）

**约束**：
- 遵循分片 current/ 架构（RED LINE），不要创建新的数据目录
- 更新完成后自动调用 `sync-vps.mjs` 同步到 VPS
- ETL 中未知字段必须被 Schema 契约拦截（`sys.exit(1)`）
```

---

### 9.2 字段注册表变更

```markdown
@claude 在字段注册表中新增 `renewal_mode`（续保模式）字段。

**步骤**（按 CLAUDE.md §2 字段注册表流程）：
1. 编辑 `server/src/config/field-registry/fields.json`：
   ```json
   { "id": "renewal_mode", "name": "续保模式", "type": "VARCHAR", "source": "续保业务类型", "category": "renewal" }
```

2. 运行 `node scripts/field-registry/generate.mjs` → 自动更新 mapping.ts + validator.ts + etl_fields.json
3. 运行 `bun run governance` 验证 #17 检查通过

**禁止**：不要手动编辑 `mapping.ts` 或 `validator.ts`（codegen 自动生成）。

```

---

## 10. 文档与治理类

### 10.1 文档同步

```markdown
@claude 本 PR 涉及 5 个文件变更，请同步更新相关索引文档。

**检查并更新**：
1. `开发文档/00_index/CODE_INDEX.md` — 如有新文件/模块，补充索引
2. `src/widgets/INDEX.md` — 如有新 UI 组件，补充登记
3. `CLAUDE.md` 注册表章节 — 如有注册表变更，更新数量/描述

**约束**：只更新索引和引用，不要修改实际代码。
```

---

### 10.2 治理校验

```markdown
@claude 运行 `bun run governance` 并修复所有失败项。

**常见失败项及修复方式**：
- #17 codegen 不一致 → `node scripts/field-registry/generate.mjs`
- 指标注册表校验失败 → `bun scripts/metric-registry/validate.ts` 查看具体错误
- 大文件检测 → 检查是否有 Parquet/Excel 文件被误提交

**约束**：只修复治理失败项，不要顺手重构其他代码。
```

---

## 11. 反模式：不要这样写

### ❌ 模糊无上下文

```markdown
@claude 修一下 bug
```

→ Claude 不知道哪个 bug，会随机找问题改。

---

### ❌ 一次性堆叠多个任务

```markdown
@claude 重构 SQL 层 + 加 5 个新指标 + 修复 E2E + 更新文档 + 部署到生产
```

→ 超出 30 分钟超时，Claude 在 Actions 中无法持续对话跟进。拆成 5 个独立 prompt。

---

### ❌ 只给"做什么"不给"为什么"

```markdown
@claude 把 AVG(loss_ratio) 改成 SUM/SUM 模式
```

→ Claude 不知道这是全项目修正还是单文件修改，不知道边界在哪。加上背景和范围。

---

### ❌ 假设 Claude 记得上次对话

```markdown
@claude 继续上次的工作
```

→ GitHub Actions 中每次运行是独立的，没有会话记忆。完整描述任务。

---

### ❌ 让 Claude 做需要本地数据的事

```markdown
@claude 用 DuckDB 查询 server/data/ 下的 Parquet 文件验证数据
```

→ CI 环境没有生产数据文件。数据验证在本地 CLI 做。

---

### ❌ 让 Claude 做需要网络访问生产环境的事

```markdown
@claude curl https://chexian.cretvalu.com/api/query/kpi 验证生产环境
```

→ GitHub Actions runner 无法访问你的内网 VPS。生产验证在本地做。

---

## 附录：3 月高频场景速查表

| 场景（3月出现次数）     | 推荐 Prompt 模板 | 章节     |
| ----------------------- | ---------------- | -------- |
| SQL 口径错误（8次）     | §2.1            | Bug 修复 |
| TS 类型错误（5次）      | §2.2            | Bug 修复 |
| E2E 超时/失败（6次）    | §2.3            | Bug 修复 |
| 热力图/饼图渲染（4次）  | §2.4            | Bug 修复 |
| VPS OOM（3次）          | §2.6            | Bug 修复 |
| 新增 API 端点（5次）    | §3.1            | 功能实现 |
| 维度下钻（6次）         | §3.2            | 功能实现 |
| 新增指标（3次）         | §3.3            | 功能实现 |
| 模块拆分（3次）         | §4.1            | 重构     |
| 消除重复（4次）         | §4.4            | 重构     |
| CI workflow 修复（7次） | §6.1            | CI/CD    |
| 安全漏洞（2次）         | §7              | 安全     |
| 字段注册表（2次）       | §9.2            | 数据/ETL |
