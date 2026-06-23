# 时间口径反问协议（B290 语义层 v0.1 · RED LINE）

policy: append-only

> 来源：BACKLOG B290。2026-05-12 用户问"5/1 到 5/11 分公司保费**完成率**排行"，Claude 解读为"截至 5/11 的 YTD 进度完成率"（产出 314%），Codex 解读为"5/1-5/11 窗口期保费 ÷ 月计划(年/12)"（产出 22%）。**两个口径都不算错，但缺乏约束导致同一问题不同 LLM 答案完全不同。** 本协议把"应反问而非自由选口径"的判定固化，跨 CLI/MCP/前端/会话级 LLM 共享。
>
> 用户决策（2026-06-22）：**4 类触发全部纳入**。

## 机器可读 SSOT（唯一事实源）

`server/src/config/disambiguation-protocol.ts`（`DISAMBIGUATION_PROTOCOL` 数组 + `composeAskBackHint()`）。本文件是其人/LLM 向说明，**新增/修改触发以 TS SSOT 为准**，本文件随之同步。

## 4 类触发（满足任一 → 先反问，禁止自由选口径直接作答）

| id | 触发名 | 何时反问 | 反问要点 |
|----|--------|---------|---------|
| `window-vs-progress` | 窗口 × 进度冲突（**原始事故**） | 用户给了**具体日期窗口**（如 5/1-5/11）却查询**完成率/达成率/计划进度**这类年度计划进度（YTD 进度）指标 | 要的是「截至该日期、按时间进度折算的**年度计划达成率**」，还是「该窗口期内的**实际保费/窗口口径**」？二者数值差异极大 |
| `denominator-period` | 分母周期不明 | 用户问"**月度/季度**计划达成"，但系统仅有**年度**计划 | 月度/季度计划取官方派生口径**年计划 ÷ 12（或按时间占比）**，确认采用？ |
| `cross-caliber` | 跨口径横向对比 | 把**不同 timeWindow** 的指标并列排名/相加（如 `cutoff-based` 满期赔付率与自由窗口保费并列；发展三角形不同成熟度横向比） | 时间口径不同直接并列会误导，是否先对齐同一 cutoff 再比？ |
| `date-anchor` | 日期锚点歧义 | 用户给了日期但未指明锚点是**签单/起保/到期/出险** | 续保盯盘按「到期」、签单分析按「签单」差异很大，请指明日期锚点 |

## 口径速查（反问后据此取数）

- **计划达成率（标准）** = 年初累计签单保费 ÷（年计划 × 时间进度）；时间进度 = 数据内最新签单日 day-of-year ÷ 全年天数（闰年感知）。路由 `/plan-achievement`（`ytd-progress`），**禁用于任意日期窗口提问**。
- **月度计划** = 年计划 ÷ 12（官方派生口径，非真实逐月计划）。详见业务规则字典 §「计划与时间进度口径」。
- **窗口期保费** = `/kpi` + `startDate/endDate`（`window` 口径）。

## 自动执行点（v0.1 已落地）

| 层 | 机制 |
|----|------|
| 路由元数据 | `query-routes-metadata.ts` 每路由 `timeWindow` 七枚举（编译期强制）；`/plan-achievement` 的 `timeWindowNote` 经 `composeAskBackHint('ytd-progress')` 拼装反问指令 |
| MCP / CLI | 既有 `mcp/src/tools/build-tools.ts`（tool description 注入 timeWindowNote）+ CLI `cx query --describe`（回显 timeWindow）自动透出反问提示给 LLM |
| 编译期不变量 | `route-helpers.ts findYtdProgressWindowParamViolations`：`ytd-progress` 路由禁声明自由窗口参数（`startDate/endDate/dateStart/dateEnd`），单测锁死（`time-window-invariants.test.ts`） |
| 指标语义 | `MetricDefinition.timeWindow`（`any`/`cutoff-based`，`validation.ts` 强制显式声明）|

## 诚实边界（v0.1 不声称完整根治）

本协议 + 编译期不变量是**提示 + 防回归**，**不能在运行时强制 LLM 反问/拒答**——LLM 遵从率非 100%（参 memory `feedback_prompt_needs_code_backup`）。运行时强制拒绝路径（如 ytd-progress 路由收到窗口参数即 400）属重量方案/follow-up，不在 v0.1。

## 关联

- 机器可读 SSOT：`server/src/config/disambiguation-protocol.ts`
- 业务口径：`数据管理/knowledge/rules/车险数据业务规则字典.md` §「计划与时间进度口径」
- 路由口径标注：`server/src/config/query-routes-metadata.ts`（`RouteTimeWindow`）
- 上位红线：`CLAUDE.md §0`（业务口径错误禁直接改）、§10（领域知识）
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
