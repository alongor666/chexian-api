# ETL 异常哨兵（ETL Anomaly Sentinel）

> **定位**：发布后监控（post-publish），**不是准入闸门**。哨兵走生产 API，只能看到已 sync-vps、已 reload、对用户可见的数据；捕获异常时坏数据已上线。做"发布前闸门"是 P2（嵌进 reload 之前）。

每日 ETL 后对核心业务指标做「当前 vs 历史」对比：**统计层确定性判定是否告警，LLM 仅做归因（不裁决）**，异常才在 GitHub 追踪 issue 告警，无异常静默。

## 组成

| 文件 | 作用 |
|------|------|
| `etl-anomaly-sentinel.mjs` | 主编排：幂等门 → 取数 → 成熟度过滤 → 统计判定 → LLM 归因 → 产出。**不碰 GitHub** |
| `sentinel.config.json` | 声明式配置：监控指标 + 各自阈值/方向/环比同比门、成熟度排除窗口、LLM 设置 |
| `lib/stats.mjs` | 统计纯函数（Z-score / 环比 / 成熟度过滤 / 指标判定）。单测 `tests/sentinel/stats.test.ts` |
| `lib/fetch-metrics.mjs` | 取数封装（data/version、comprehensive、trend、YoY），PAT 只读，ETag 幂等 |
| `lib/llm-judge.mjs` | LLM 归因（Anthropic/智谱，temperature=0），不可用时规则兜底 |
| `../../.github/workflows/etl-anomaly-sentinel.yml` | 定时工作流（schedule + workflow_dispatch） |

## 数据流

```
GET /api/data/version                         → etlDate（上下文）
GET /api/query/comprehensive-bundle (If-None-Match)  → 304? 静默退出 : 4 比率快照 + 逐期赔付率序列 + cutoffDate + timeProgress
GET /api/query/trend ×2                        → 保费/件数断崖序列
GET /api/query/comprehensive-bundle(去年同期)          → 赔付率 YoY 交叉
→ 统计判定（排除未成熟近期，IBNR 防线）→ LLM 归因 → verdict.json + summary.md
```

## 关键设计（来自 codex 评审）

- **取数坍缩**：`/api/query/comprehensive-bundle` 一次拿全 4 比率快照 + `earned_claim_ratio` **逐期月度序列** + 已归一 `achievement_rate` + `timeProgress`。不再逐期循环调 cost。
- **幂等用 ETag**：comprehensive 响应的 ETag 绑定 `getDataVersion()` 的 parquet 内容指纹（"数据未变→版本不变"）。`If-None-Match` 命中 304 即静默。比 `MAX(policy_date)` 可靠。
- **成熟度过滤（IBNR）**：满期赔付率近期受赔款报告滞后影响系统性偏低、随时间向上发展（参考 `diagnose-loss-development`）。统计判定**排除最近 N 个完整期**，只对已成熟期判异常——这是确定性处理，**不交给 LLM 兜底**。
- **逐期而非累计**：比率 Z-score 必须用 per-period 值（comprehensive lossTrend 即逐期），禁止用累计序列（强自相关会压低标准差、频繁误触）。
- **统计判定，LLM 归因**：是否告警 100% 由统计层决定（可复现）；LLM 只给 severity + 一句话归因。

## 本地 dry-run

```bash
export CX_PAT='cx_pat_xxxxx'            # 只读 PAT，见下方 bootstrap
export ANTHROPIC_API_KEY='sk-ant-...'  # 可选；缺失则 LLM 归因降级为规则兜底
node scripts/sentinel/etl-anomaly-sentinel.mjs \
  --dry-run \
  --api-base https://chexian.cretvalu.com \
  --out-dir /tmp/sentinel-out
```

`--dry-run` 不推 GitHub，只把告警 markdown 打印到终端并写 `verdict.json` / `summary.md`。

## 一次性设置（bootstrap）

### 1. 生成只读 PAT（手动，无 CLI）
PAT 不能由 PAT 自铸（`POST /api/auth/tokens` 强制会话）。须**浏览器登录** admin 账户（`branch_admin`，`dataScope:'all'` 全机构只读）→ 用户管理页生成 PAT（`cx_pat_<id>.<secret>`，明文仅显示一次）。

> ⚠️ **Blast radius**：该 PAT 是 **admin 级、全量数据只读的长期钥匙**（`readonlyMiddleware` 只拦写不拦读、无路由级强制）。**泄露即全量可读**。务必：设较短 TTL、定期轮换、GitHub Secrets 最小可见。

### 2. 配置 GitHub Secrets / Variables
| 名称 | 类型 | 值 |
|------|------|-----|
| `CX_PAT` | Secret | 上一步生成的 PAT |
| `ANTHROPIC_API_KEY` | Secret | （已存在，复用） |
| `SENTINEL_API_BASE` | Variable | `https://chexian.cretvalu.com`（可省，有默认） |

### 3. 工作流自动建追踪 issue
首次检测到异常时，工作流用 `gh` 自动创建标题为「ETL 异常哨兵追踪」、带 `sentinel-anomaly` label 的 issue，后续异常追加评论。无需手动建。

## 调阈值 / 加指标

只改 `sentinel.config.json`：
- `metrics[].alert`：是否纳入告警（`false` = 派生展示，不单独触警）
- `metrics[].zThreshold / momThreshold / yoyThreshold`：各指标独立阈值
- `metrics[].direction`：`up`（仅升高告警，如赔付率）/ `down` / `both`（断崖双向）
- `maturity.excludeRecent`：排除最近几个完整期（IBNR 保守度）

## P2 待办

- 成熟度三角形：按同成熟度比较（本期第 N 天 vs 历史各期第 N 天，复用 loss-development），替代"排除近期"的保守法。
- 季节性基线：替全局均值/标准差，根治春节/年末冲量误报。
- 费用率等快照指标接逐期历史序列（当前仅快照，未启用 Z 判定）。
- 可选：嵌入 `release:daily` reload 前做**准入闸门**（需走 review）。

## 关联

- 计划：`~/.claude/plans/synthetic-herding-cloud.md`（v3）
- 同 PR 修复：`/api/filters/options` 补挂 `readonlyMiddleware`（原漏挂，对齐 `server/src/routes/query.ts`）
- 记忆：`feedback_claims_window_aligned_to_earned`（IBNR 早期窗口虚高）

---

# 立方体灰度哨兵（Cube Grayscale Sentinel）

> **定位**：通用立方体灰度阶段 1 的自动观测器（PR #604 引入双开关 `CUBE_SHADOW_COMPARE='true'` 后）。读 `/health` 公开端点，无需 PAT；CRITICAL 异常自动追踪 GitHub issue。

每小时跑一次（cron `15 * * * *`），按确定性规则判定灰度健康度，**不阻断 ETL、不影响用户**。

## 组成

| 文件 | 作用 |
|------|------|
| `cube-grayscale-sentinel.mjs` | 主脚本：取 `/health` + `/api/data/version` → 4 条规则判定 → 产出 verdict.json/summary.md。**不碰 GitHub** |
| `../../.github/workflows/cube-grayscale-sentinel.yml` | 每小时触发的工作流，产物上传 artifact + 异常追踪 issue |

## 判定规则（确定性，可复现）

| 规则 | 严重度 | 触发条件 | 含义 |
|---|---|---|---|
| ① `shadow_no_mismatch` | **CRITICAL** | `cubeShadow.*.mismatch > 0` | 立方体结果与原路径不等 — 立刻暂停切流；根因 = 口径漂移 / 立方体逻辑 bug / ETL 引入新字段值未识别 |
| ② `shadow_no_error` | WARN | `cubeShadow.*.error > 0` | 立方体执行异常（构建失败 / 连接池耗尽），查 PM2 日志 `[CubeShadow]` |
| ③ `cost_cube_exact` | INFO | `cubes.cost.exact === false` | **数据质量信号**：跨格保单出现（同保单批改改了机构/起保日），ETL 上游应复盘 |
| ④ `cubes_fresh` | WARN | `cubes.*.builtVersion !== /api/data/version` | 立方体落后当前数据版本 — 通常 ETL 后预热请求自动追上，若长期落后查 cache-warmer 覆盖 |
| 兼容 | WARN | `cubes.*.lastError != null` | 立方体最近一次构建失败 |

**退出码**：CRITICAL→1（阻断 cron 链）；其他→0（INFO/WARN 通过 `GITHUB_OUTPUT` 透出，记录到追踪 issue 但不算"红"）。

## 产物与报告去向

| 输出 | 位置 |
|---|---|
| 机器可读 | `<out-dir>/verdict.json`（默认 `sentinel-out/cube-grayscale/verdict.json`） |
| 人可读 | `<out-dir>/summary.md` |
| CI artifact | `cube-grayscale-<run_id>`，保留 **30 天** |
| 异常追踪 | GitHub issue「立方体灰度哨兵追踪」（label `cube-grayscale-anomaly`，自动建/找/追加评论） |
| GITHUB_OUTPUT | `has_anomalies` / `max_severity` / `summary_path` / `verdict_path` |

## 反哺 ETL 流程优化的具体方式

立方体哨兵不直接改 ETL 脚本，但暴露了 ETL 流程难以自查的三类信号：

1. **`cost.exact=false` 反复出现** → 上游"批改不会改维度列"的假设被打破。复盘 `pipelines/transform.py` 与签单清单 ETL 是否合规：批改行的机构/起保日/客户类别是否应当继承原单。如确认是数据源问题，提相应业务修复 ticket。
2. **`shadow.*.mismatch > 0`** → 立方体 vs 原路径口径不一致。判断 ETL 是否引入新字段值（如 `tonnage_segment` 新增枚举）落到立方体 token 白名单之外。是 ETL 问题就在 `data-pipeline.md` 流程加新字段值前的"立方体可服务性检查"步骤；是立方体口径问题就同步更新改写器并补等值测试。
3. **`builtVersion` 长期落后** → ETL 后 reload 触发的预热路由未覆盖立方体所需路由族（`trend`/`growth`/`cost`/`kpi`/`salesman-ranking`）。`cache-warmer.ts` 路由清单应当与立方体覆盖路由族对齐。

## 本地 dry-run

```bash
node scripts/sentinel/cube-grayscale-sentinel.mjs \
  --api-base https://chexian.cretvalu.com \
  --out-dir /tmp/cube-sentinel \
  --dry-run
```

`--dry-run` 不影响产物（仍写 verdict.json/summary.md），仅把 summary 打印到终端。

## 调频里程碑（BACKLOG uid=2026-06-12-claude-055a12 · BLOCKED）

灰度阶段 cron 每小时一次是合理的（mismatch 出现越早干预越好，且 public repo 完全免费）。但切流稳定后应该降频省 GHA minutes，避免长期满频次跑无意义的 match 累计：

| 阶段 | 触发条件 | cron | 月跑次 |
|---|---|---|---|
| **当前 — 灰度阶段 1（影子对账）** | `CUBE_SHADOW_COMPARE='true'` 已生效 | `15 * * * *` | 720 |
| 切流后观察期 | `CUBE_ROUTING_ENABLED='true'` 合并 + 30 天稳定（mismatch=0、cost.exact 稳定） | `15 */3 * * *` | 240 |
| 长期生产稳态 | 观察期后 + 1 个月无 CRITICAL | `15 */6 * * *` 或并入 ETL 哨兵 cron | 120 |

**触发动作**：满足条件时改 `.github/workflows/cube-grayscale-sentinel.yml` 的 `cron:` 一行 + 把 BACKLOG `2026-06-12-claude-055a12` 状态推进 BLOCKED → DOING → DONE（附 commit 证据）。

**为什么先记下来**：人脑记不住，BACKLOG event log + yml/README 三处冗余指针 = 未来任何 AI 接手都会被提醒。

## 与 ETL 异常哨兵的边界

| | ETL 异常哨兵 | 立方体灰度哨兵 |
|---|---|---|
| 关注层 | 业务指标（赔付率/费用率/保费）逐期 Z-score + 同环比 | 立方体路径正确性 + 数据版本同步 + 数据质量信号 |
| 触发频率 | 每天 2 次（cron 9,12 UTC） | 每小时一次 |
| 鉴权 | PAT 只读 | 公开端点 `/health`，无 |
| 幂等 | `data/version` ETag，数据未变 304 静默 | 否——每跑一次都是当时进程状态快照 |
| 追踪 issue | 「ETL 异常哨兵追踪」`sentinel-anomaly` | 「立方体灰度哨兵追踪」`cube-grayscale-anomaly` |
| BACKLOG | — | uid=2026-06-11-claude-90a92c |
