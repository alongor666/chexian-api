# Agent Forecast B+C 推进交接文档

> **跨会话延续锚点**。任何会话被 token 用尽中断后，新会话直接读取此文档即可接续，不需重读历史对话。
>
> **使用方法**：进入新会话先读 `git log --oneline -10` 与本文档底部"当前推进状态"，定位下一步。

---

## 0. 上下文（一段话讲清楚）

`chexian-api` Agent 守门员体系经过 PR #300 + #301 + cc28ab9 + #305 已完成：观察层 25 metrics + forecast 输出独立注册表 + 7 项确定性诊断 + Stage 5A 解释入口（无 LLM）+ readiness/observability + caller display smoke harness + route-question 响应统一包装。当前任务：**扩展 forecast 能力到分群预测（B），并把单情景 forecast API 接入 Copilot UI 面板（C）**。**不释放 LLM**（仍 readyForLlm=false），不引入 NL2SQL/free SQL。

---

## 1. 决策锁定（用户已批准 2026-04-28）

| # | 决策 |
|---|------|
| 1 | segment 维度白名单 = `['org_level_3', 'customer_category', 'coverage_combination', 'salesman_name']` |
| 2 | 当前变动成本率由调用方传，后端纯算术，**不**调既有 `/api/query/cost` |
| 3 | 每分群独立假设（每个分群可传不同 vc/fc） |
| 4 | 权限过滤在 service 层显式校验：分群标签必须在调用方 `permissionMiddleware` 暴露的权限范围内 |
| 5 | 前端面板入口：Copilot 新增 tab，与 narrative/audit/approval 并列 |
| 6 | 场景输入 localStorage 持久化 |
| 7 | 多情景对比 v1 不做，留 v2 |
| 8 | 边际贡献额联动展示（保费 × (1 - 终极变动成本率)，让用户看清"扣变动→边际→扣固定→利润"的层次） |
| 9 | C1 v1 只调单情景 API（不调 segment），分群面板留 v2 |
| 10 | 时序：**串行** PR-B1 → PR-C1（可并行但放弃，留视觉反馈链） |
| 11 | 不做 PR-B2 观测埋点（留给 E） |

> **铁律**：Stage 5 LLM 释放保持 blocked，本批工作不踩 LLM 红线。所有新代码 grep 不到 `duckdb`、`@anthropic`、`openai`、`fetch(`、`SELECT `、`CURRENT_DATE`。

---

## 2. PR-B1 — 后端分群预测能力

### 2.1 目标
新增 `POST /api/agent/forecast/profit-segment`，按维度批量计算多个独立 forecast 情景。

### 2.2 必新建文件
- `server/src/agent/schemas/agent-forecast.schema.ts` 内追加：
  - `SegmentDimensionSchema = z.enum(['org_level_3', 'customer_category', 'coverage_combination', 'salesman_name'])`
  - `ProfitSegmentScenarioSchema`（每分群一项：dimensionLabel + premium + ultimateVariableCostRatio + ultimateFixedCostRatio + earningSchedule + assumptionSource）
  - `ProfitSegmentRequestSchema`（dimension + scenarios[] + scenarioName）
  - `ProfitSegmentResponseSchema`（per-segment forecast 数组 + warnings + forbiddenInterpretations）

### 2.3 必改文件
- `server/src/agent/services/agent-profit-forecast-service.ts` — 新增 `calculateProfitSegment(input, allowedLabels)` 包成批量版本，**复用现有 `calculateProfitScenario`**
- `server/src/agent/routes/agent-forecast.ts` — 新增 `POST /profit-segment`，从 `req.user` 推导 `allowedLabels`
- `server/src/agent/registry/agent-forecast-output-registry.ts` — 加 `forecast_operating_profit_by_segment` 输出条目
- `server/src/agent/registry/agent-data-capability-registry.ts` — 新增 capability `forecast_operating_profit_segment`
- `server/src/agent/tools/tool-registry.ts` — 新增 tool `forecast.profit_segment`
- `server/src/config/api-routes.ts` + `src/shared/api/routes.ts` — 加常量 `PROFIT_SEGMENT`
- `server/src/agent/services/agent-question-router-service.ts` — `isForecastQuestion` 关键词加 `'分群'/'按机构预测'/'按客户类别预测'`，命中走新 capability

### 2.4 权限过滤实现要点
- `req.user` 已有 `branchPermissions` / `salesmanPermissions` 字段（参考 customer-flow service 的 403 模式）
- 调用方传分群标签必须落在权限内，否则 service 层抛 `AppError(403, ...)`
- branch_admin 等高权限用户白名单跳过

### 2.5 测试矩阵（新建 `tests/api/agent-profit-segment.test.ts`）
1. 单情景输入用 segment 包装一次结果一致（与既有 forecast 黄金路径数学一致）
2. 3 个机构 × 不同假设 → 3 个独立 forecast 结果
3. 维度白名单：传 `'plate_no'` → 400
4. 权限过滤：用户传不在权限内的机构名 → 403
5. earningSchedule 合计 ≠ 100 → 400（每个分群独立校验）
6. fc 缺失 → 400（继承 PR #300 的"无默认值"决策）
7. 隔离测试加入 `tests/api/agent-profit-forecast-isolation.test.ts`：service 文件继续 grep 不到 LLM/SQL 痕迹
8. route contract 测试加入 `tests/api/agent-profit-segment.route-contract.test.ts`：路由常量、SuccessResponseSchema 包装、auth/permission/queryLimiter 链路
9. Stage 5 boundary 测试加新断言：`forecast_operating_profit_segment` capability 不在 LLM-allowed 清单
10. smoke harness 扩展 `/api/agent/forecast/profit-segment` 到扫描清单

### 2.6 PR-B1 验证命令（可直接复制）
```bash
bun run typecheck
bun run governance
bun run test --run tests/api/agent-profit-forecast.test.ts tests/api/agent-profit-segment.test.ts tests/api/agent-profit-segment.route-contract.test.ts tests/api/agent-profit-forecast-isolation.test.ts tests/api/agent-stage5-boundary-audit.test.ts tests/api/agent-question-router-profit.test.ts
bun run test --run
```

### 2.7 PR-B1 分支与提交
```bash
git checkout main && git pull --ff-only origin main
git checkout -b codex/agent-forecast-profit-segment
# ... edits ...
git add <only-B1-files>
git commit -m "feat(agent): add deterministic profit-segment forecast capability ..."
git push -u origin codex/agent-forecast-profit-segment
gh pr create --title "feat(agent): add deterministic profit-segment forecast" --body "..."
```

---

## 3. PR-C1 — Copilot 经营利润情景测算面板（仅依赖 PR-B1 merge 后**或** PR #300 已合并的单情景 API）

### 3.1 目标
Copilot 新增 "经营利润情景测算" tab，调单情景 API。

### 3.2 复用既有
- `src/shared/api/routes.ts:AGENT_FORECAST_ROUTES.PROFIT_SCENARIO`（已存在，PR #300 留下）
- `apiClient` token 注入
- shadcn 组件（Input / Button / Card / Tabs）
- React Query for mutation
- 既有 Copilot tab 结构（参照 PR #302 的 narrativeSource UI）

### 3.3 必新建/修改文件（待 PR 时再细化路径，**入口锚点**：`src/features/copilot/` 或类似目录）
- 新组件：`src/features/copilot/components/ForecastScenarioPanel.tsx`
- 新 hook：`src/features/copilot/hooks/useForecastScenario.ts`（React Query mutation + localStorage 持久化）
- 修改 Copilot 页面 tab 路由，新增 tab 项

### 3.4 UI 必须项
- 输入：scenarioName / premium / vc% / fc% / earningSchedule(动态加期) / assumptionSource(下拉)
- 输入校验：earningSchedule 合计 = 100 才允许提交
- 结果展示：终极综合成本率、预测利润率、每期利润、全周期利润、1pct 敏感性、**边际贡献额（联动展示）**
- **强制展示** `warnings` + `forbiddenInterpretations`，不可折叠
- localStorage key: `copilot.forecastScenario.draft`，每次输入即存

### 3.5 测试矩阵
1. 组件渲染测试（Vitest + RTL）
2. 输入校验 UI 状态：earningSchedule 合计 ≠ 100 时提交按钮 disabled
3. localStorage 读写
4. API mock 后断言 warnings + forbiddenInterpretations 渲染
5. E2E（Playwright）：登录 → 进 Copilot → 切到 forecast tab → 填表 → 提交 → 校验结果

### 3.6 PR-C1 验证命令
```bash
bun run typecheck
bun run governance
bun run test --run src/features/copilot/
bun run build  # 确认前端构建通过
E2E_PASSWORD=... bun run test:e2e --grep "forecast"
```

---

## 4. 当前推进状态（每次会话开始/结束时更新）

> **状态语义**：`created` = PR 已开但未合并；`merged` = 已合并到 main、已部署生产。
> **单一事实源**：本节是新会话定位"下一步"的唯一权威；正文其他章节如有不一致，以本节为准。

```
[x] D       PR #305 merged   2026-04-28 06:24 (route-question SuccessResponse 包装)
[x] B1      PR #307 merged   2026-04-28 06:58 (deterministic profit-segment)
[x] B1-fix  PR #308 merged   2026-04-28 09:40 (smoke role-gate + weighted precision + doc 语义)
[x] C1      PR #309 created  2026-04-28      (Copilot 经营利润情景测算面板，单情景 v1)
[ ] B-v2    分群预测前端面板（按交接文档 §3 锁定的 v2 方向）
[ ] A/E     评估时机                          → C1 ship 后决策
```

**最后会话推进至**（2026-04-28）：
- D 技术债清理 PR #305 已 **merged**
- 交接文档 PR #306 已 **merged**
- B1 后端分群预测 PR #307 已 **merged**（生产部署成功，health 200）
- B1 codex review fix PR #308 已 **merged**（smoke role-gate + 加权精度 + 文档语义）
- C1 前端 Copilot forecast 面板 PR #309 **created**（149 文件 / 1992 测试 passed；typecheck/governance/build 全绿）
- 下一步选项：v2 分群面板 / Stage 5B LLM 释放 / 生产 smoke 凭据闭环（A/E）— 待 C1 merge 后决策

---

## 5. 跨会话接续 Checklist（新会话进来必读）

1. **核实 git 状态**：`git status -s && git branch --show-current && git log --oneline -5`
2. **核实 PR 状态**：`gh pr list --author @me --state all -L 10`
3. **检查 D 是否合并**：`gh pr view 305 --json mergedAt,state`
4. **若 D 已 merge**：切回 main 拉最新，开 B1 分支
5. **若 D 未合并**：先解决 review，再开 B1
6. **本文档第 4 节"当前推进状态"是单一事实源**，编辑它即等于会话状态保存

---

## 6. 关键文件速查（避免新会话满地找）

| 类别 | 路径 |
|------|------|
| 既有 forecast schema | `server/src/agent/schemas/agent-forecast.schema.ts` |
| 既有 forecast service | `server/src/agent/services/agent-profit-forecast-service.ts` |
| 既有 forecast route | `server/src/agent/routes/agent-forecast.ts` |
| Forecast 输出注册表 | `server/src/agent/registry/agent-forecast-output-registry.ts` |
| 数据 capability 注册表 | `server/src/agent/registry/agent-data-capability-registry.ts` |
| Tool 注册表 | `server/src/agent/tools/tool-registry.ts` |
| 后端路由常量 | `server/src/config/api-routes.ts` |
| 前端路由镜像 | `src/shared/api/routes.ts` |
| Question router | `server/src/agent/services/agent-question-router-service.ts` |
| Audit 中间件 | `server/src/middleware/audit.ts` |
| App 挂载点 | `server/src/app.ts` |
| 既有 forecast 测试 | `tests/api/agent-profit-forecast.test.ts` |
| 既有 forecast contract 测试 | `tests/api/agent-profit-forecast.route-contract.test.ts` |
| 既有 forecast isolation 测试 | `tests/api/agent-profit-forecast-isolation.test.ts` |
| Stage 5 boundary 测试 | `tests/api/agent-stage5-boundary-audit.test.ts` |
| Smoke harness | `scripts/verify-agent-production-smoke.mjs` |
| Smoke harness 测试 | `tests/api/agent-production-smoke-harness.test.mjs` |

---

## 7. 不在本批范围（明确登记）

- Stage 5 LLM 释放（方向 A）
- 生产 smoke 凭据 + observability 闭环（方向 E）
- 指标字典/作战地图跨项目同步（方向 F）
- B261 报价转化 riskGrade A-G/X 决策（业务问题，待用户单独决策）
- 多情景对比（B+C v2）
- 分群预测的前端面板（C v2）

---

## 8. 复盘要点（写给未来的 Claude / Codex）

PR #300 实施时暴露过两个**计划层面盲点**（PR #301 修复）：

1. **关键词路由优先级**：当 forecast 关键词与利润率 hard-block 词存在子串关系时，`isForecastQuestion` 必须放在 hard-block 之前判断，但又必须在 hard-block 命中后才允许 forecast。当前 router 的 `isProfitRateOrNetProfitQuestion` 是处理这个的关键。**B1 新增分群关键词时，必须重跑全部 router 测试矩阵**。
2. **阶段间依赖**：readiness 阶段不能硬编码 `status:'completed'`，必须从前置阶段动态派生。**B1 新增 forecast_segment capability 时，stage_4_9 内是否要拆 4_9_a / 4_9_b？建议不拆，因为分群是同一类型能力的扩展**。

PR-D 的"零下游消费技术债"模式（先源码扫描+HTTP 集成测试双层 invariant）值得在 B1 复用：B1 的源码扫描断言 + HTTP 集成测试 + isolation 测试就构成三层 fence。
