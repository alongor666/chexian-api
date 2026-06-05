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
GET /api/query/comprehensive (If-None-Match)  → 304? 静默退出 : 4 比率快照 + 逐期赔付率序列 + cutoffDate + timeProgress
GET /api/query/trend ×2                        → 保费/件数断崖序列
GET /api/query/comprehensive(去年同期)          → 赔付率 YoY 交叉
→ 统计判定（排除未成熟近期，IBNR 防线）→ LLM 归因 → verdict.json + summary.md
```

## 关键设计（来自 codex 评审）

- **取数坍缩**：`/api/query/comprehensive` 一次拿全 4 比率快照 + `earned_claim_ratio` **逐期月度序列** + 已归一 `achievement_rate` + `timeProgress`。不再逐期循环调 cost。
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
- BACKLOG：`/api/filters/options` 漏挂 `readonlyMiddleware`（对比 `server/src/routes/query.ts:44`）
- 记忆：`feedback_claims_window_aligned_to_earned`（IBNR 早期窗口虚高）
