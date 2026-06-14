---
name: chexian-sentinel-attribution
description: ETL 异常哨兵告警的本地业务归因。读「ETL 异常哨兵追踪」issue 最新 comment 里的统计触发项，注入项目业务上下文（指标字典 / 业务规则字典 / IBNR 滞后规律 / 同期数据），由 Claude Code 主体给出业务归因（是否真异常 / 最可能成因 / 建议动作），可回贴 issue comment。当用户说"看下哨兵告警/跑哨兵归因/sentinel 归因/哨兵分析/看追踪 issue"时触发。
version: 1.0
user_invocable: true
---

# 车险异常哨兵业务归因（本地）

## 定位

ETL 异常哨兵（`.github/workflows/etl-anomaly-sentinel.yml`）每天 9/12 UTC 跑两次，**统计层**确定性判定异常并发到 GitHub issue「ETL 异常哨兵追踪」，**归因列只给规则兜底文案**（如「环比 19.4% 超阈值 8%」）。

本 skill 是**业务归因层**：用 Claude Code Max 套餐 + 项目完整上下文（指标字典 / 业务规则字典 / 历史诊断 / 同期数据），把"统计触发"升级成"业务判断"。**完全本地，不依赖任何外部 LLM API key**（替代 2026-06-14 剥离的 CI 内 LLM 归因路径）。

## 触发场景

- "看下哨兵最新告警 / 跑哨兵归因 / sentinel 分析"
- "issue #627 那个新评论是怎么回事"
- 用户主动周期性体检（如周一早上看上周的 issue 增量 comment）

## 执行流程

### Step 1：拉取追踪 issue 最新 comment

```bash
# 找追踪 issue 编号（首次跑用 search，后续可记下来）
ISSUE=$(gh issue list --repo alongor666/chexian-api --state open \
  --search 'in:title "ETL 异常哨兵追踪"' --json number --jq '.[0].number')
# 拉最新一条 comment
gh api "repos/alongor666/chexian-api/issues/$ISSUE/comments?per_page=100" --jq '.[-1] | {created_at, body}'
```

如果用户传了具体 comment id（如 "看 #627 的 abc123 那条"），改成：
```bash
gh api "repos/alongor666/chexian-api/issues/comments/<id>" --jq '{created_at, body}'
```

### Step 2：解析触发项

comment 顶部 markdown 表已列出**触发**指标（按 silence 去重后的新增）。`<details><summary>全部指标判定明细</summary>` 内的 JSON 块含**所有指标**的判定细节，含：
- `triggered`: bool
- `latestMaturePeriod` / `latestMatureValue`
- `baselineMean` / `baselineStd` / `baselineTrimmedCount` / `baselineSize`
- `z` / `mom` / `yoy{current, previous, previousPeriod}`
- `excludedPeriods`（成熟度排除）
- `reasons`（统计触发的具体原因数组）
- `fingerprint`（silence 去重键）

只看 `triggered: true` 的项。`expense_ratio` 等 `snapshotOnly: true` 的快照指标当前不参与 Z 判定，跳过。

### Step 3：注入业务上下文

按触发指标拉相关业务知识（**只读不改**）：

| 指标 | 必读文档 / 数据 |
|---|---|
| 满期赔付率 `earned_claim_ratio` | `数据管理/knowledge/rules/车险数据业务规则字典.md` 赔付率口径段；`server/src/config/metric-registry/categories/loss.ts`；memory `feedback_claims_window_aligned_to_earned`、`project_lr_caliber_reconciliation` |
| 签单保费 `total_premium` | 业务规则字典保费口径段；memory `feedback_premium_net_aggregation`；季节性参考 `开发文档/historical-seasonality.md`（如存在） |
| 费用率 `expense_ratio` | 业务规则字典费用率段；memory `feedback_default_variable_cost_only` |

读取方式：用 Read 拉相关段，**不要全文重读**——只取与触发期/方向相关的部分。

### Step 4：业务归因判断

针对每个 triggered 项，输出结构化判断：

```markdown
## {指标中文名} {期} {方向}

**统计事实**：当前值 X / 基线均值 Y（trim 后 N 个有效期）/ Z = K / 环比 +M% / 同比偏离 +L%

**业务判断**：{真异常 | IBNR 滞后伪信号 | 季节性已知模式 | 数据成熟度 artifact | 其他}

**最可能成因**：（≤ 80 字，结合业务规则字典 + 历史诊断 + 数据时点）
- 例 1（IBNR 滞后）：触发期 2026-03 仅过 3 个月，赔款报告滞后系数约 0.65，trim 后基线仍含其它早期月伪低数据；实际同期可比口径下偏离应为 +9% 左右，未达告警线。
- 例 2（真异常）：触发期同比偏离 +9.5%、Z=1.73 + 环比 +19.4% 双指标共振；同期保费同比 +3% 解释不了赔付率涨幅；建议沿 customer_category × insurance_type 维度下钻定位结构性变化。

**建议动作**：
- 不真：在 `sentinel.config.json` 给该指标提 `excludeRecent` 或 `baselineTrim.dropHead` 一格，重跑验证
- 真：触发 `/diagnose-period-trend --metric earned_claim_ratio --window 2026-01..2026-03` 拿 9 维下钻报告
- 不定：标灰，等下次 cron 看是否随后续期成熟而消解
```

### Step 5：回贴 comment（可选）

询问用户："要不要把这份业务归因贴回 issue #{ISSUE}？"

得到肯定回答后：

```bash
gh issue comment "$ISSUE" --repo alongor666/chexian-api --body-file /tmp/sentinel-attribution.md
```

否则只在本地 chat 输出，用户可以自己复制。

## 红线

1. **只看 `triggered: true`，不要把整个 JSON 块的所有指标都归因一遍** — 那是噪音，浪费上下文。
2. **业务判断必须可追溯到业务规则字典 / memory / 历史诊断**，不要凭直觉编造（违反 CLAUDE.md §10 领域知识铁律）。不确定时直接说"需要 `/diagnose-period-trend` 下钻进一步确认"，**禁止猜**。
3. **不修改 sentinel 任何代码** — 如果归因结论是"阈值需要调整"，写入"建议动作"让用户决定，不要直接动 `sentinel.config.json`。
4. **回贴 comment 前必须征求用户同意** — 这是 GitHub 上对外可见的 audit trail，不可静默写入。
5. **本 skill 完全本地化，禁止调用任何外部 LLM API**（这正是它存在的理由 — 替代 2026-06-14 剥离的 ANTHROPIC_API_KEY / ZHIPU_API_KEY 路径）。

## 关联

- 哨兵实现：`scripts/sentinel/`
- 哨兵 README：`scripts/sentinel/README.md`
- 追踪 issue：title "ETL 异常哨兵追踪"，label `sentinel-anomaly`
- 业务规则字典：`数据管理/knowledge/rules/车险数据业务规则字典.md`
- 指标注册表：`server/src/config/metric-registry/`
- 同义触发的深度报告：`/diagnose-period-trend`、`/diagnose-org-weekly`、`/diagnose-loss-development`
- 历史：2026-06-14 剥离 CI 内 LLM 归因（PR #626 三件套修复后续治理），把外部 API key 路径退出，业务归因下沉到 Claude Code 主体
