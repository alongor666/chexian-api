# ETL 发布前准入闸门（prepublish-gate）

> **数据管道硬化路线图 P2 — 与 `scripts/sentinel/` 互补的发布前防线。**

## 它解决什么问题

`bun run release:daily` 把数据从本地 ETL 推到 VPS 生产。在 PR #484 之前没有任何"坏数据
不准上线"的拦截。PR #484 加了 `scripts/sentinel/`（发布**后**监控），但等它发现异常时
坏数据已经在生产上待了几小时。

**本闸门补齐缺口**：在 ETL 完成之后、`rsync 到 VPS 之前`，对本地 parquet 做指标体检；
任一指标统计触发即 **fail-fast 阻断**，不让坏数据上线。

## 与 sentinel 的关系

| | scripts/sentinel/ | scripts/prepublish-gate/（本工具） |
|---|---|---|
| 时机 | 发布**后** | 发布**前** |
| 数据源 | live API（`/api/query/*`） | 本地刚 ETL 出的 parquet |
| 异常行为 | 写 GitHub issue 打扰人 | **fail-fast 阻断发布** |
| 状态 | 数据已上线，亡羊补牢 | 数据未上线，阻断在源头 |
| LLM | 触发后 LLM 归因 | 不引 LLM（必须可复现 / 无外部依赖） |
| 共享 | `lib/stats.mjs`（统计纯函数） | 复用 `sentinel/lib/stats.mjs` |

## 流程

```
node 数据管理/daily.mjs    # ETL 把 xlsx 转为 parquet 写入 warehouse/fact/*
        ↓
bun run governance         # 代码治理
        ↓
🚦 prepublish-gate         # ← 本工具：查刚 ETL 出的 parquet，异常即阻断
        ↓ （通过）
node scripts/sync-vps.mjs  # rsync 推 VPS
        ↓
sudo deploy-chexian-api reload  # PM2 reload
```

由 `scripts/sync-and-reload.mjs` Stage 2.5 自动调用，无需手动触发。

## 检查的指标（v1）

| ID | 含义 | 口径 | 触发条件 |
|---|---|---|---|
| `monthly_premium` | 月签单保费 | `policy_dedup` 按 (policy_no, insurance_start_date) 聚合 + `SUM(premium) > 0` 后按起期月 `SUM(premium)`，口径与 `server/src/sql/cost/cost-ratios.ts` 一致（B252） | 双向 \|Z\|>2.5 或环比>30% |
| `monthly_policy_count` | 月签单件数 | 同上口径 `COUNT(DISTINCT policy_no)` | 双向 \|Z\|>2.5 或环比>30% |
| `monthly_claim_amount` | 月出险报告金额 | `accident_time` 分月 `SUM(settled_amount + reserve_amount)`（已决+未决，项目标准口径） | 双向 \|Z\|>2.5 或环比>40% |
| `monthly_claim_count` | 月出险报案件数 | `COUNT(DISTINCT claim_no) by accident_time month` | 双向 \|Z\|>2.5 或环比>40% |

**统计层**：复用 `scripts/sentinel/lib/stats.mjs` — 逐期 Z-score（拒绝累计序列）、成熟度
过滤（排除未成熟近期，抗 IBNR/迟到报案）、方向敏感。

**SQL 时间窗**：所有指标 SQL 都过滤 `time_period < date_trunc('month', current_date)`，
排除当前不完整月（policy 有预签未来起期、claims 有迟到报案）；excludeRecent 再排掉前一期。

**禁止自创口径**：率值统计的话必须 `SUM(分子)/SUM(分母)`（铁律，见
`.claude/rules/business-domain.md`）；本闸门**只对分子分母独立 Z-score**，
不在闸门层算率值，避免触碰这条铁律。

## 用法

### 默认（被 sync-and-reload.mjs 自动调用）

```bash
bun run release:daily        # ETL → governance → 🚦 gate → sync → reload
```

闸门通过静默放行；触发则以退出码 1 中断流程，**不 rsync、不 reload**，控制台打印
触发指标与排查指引。

### 紧急旁路（人工核对后强制发布）

```bash
# 1. 单独跑闸门旁路（写审计日志）
node scripts/prepublish-gate/prepublish-gate.mjs --skip-gate --skip-reason "已人工核对：周一保费跳点是真实业务"

# 2. 在 release:daily 整流程中旁路
node scripts/sync-and-reload.mjs --skip-gate --skip-gate-reason "..."
PREPUBLISH_GATE_SKIP=1 PREPUBLISH_GATE_SKIP_REASON="cron-bypass" node scripts/sync-and-reload.mjs
```

旁路审计自动写入 `logs/prepublish-gate-bypass.log`（JSONL：timestamp / user / hostname /
reason / cwd），便于事后追溯**谁、何时、为什么**绕过了闸门。

### 单独调用

```bash
# 默认（用 gate.config.json + 默认 warehouse 路径）
node scripts/prepublish-gate/prepublish-gate.mjs

# 自定义配置 / 仓库路径
node scripts/prepublish-gate/prepublish-gate.mjs \
  --config /custom/gate.config.json \
  --warehouse-root /custom/warehouse \
  --out-dir /tmp/gate-out
```

### 退出码

| 码 | 含义 | release:daily 行为 |
|----|------|------|
| 0  | 通过 / `--skip-gate`（带审计） | 继续 sync-vps |
| 1  | 统计触发阻断 | 中断（不 rsync、不 reload） |
| 2  | 配置 / IO / DuckDB 错误 / **parquet 缺失或未就绪** | 中断（需 `--skip-gate` 显式放行）|

> **fail-closed 原则**：parquet 缺失（ETL 失败 / 误 rm / fresh worktree 无数据）= exit 2 阻断，不再像旧版本那样"视作非闸门职责" exit 0 放行（codex PR #513 第6轮 P1）。

## 配置（`gate.config.json`）

所有指标 / 阈值 / 方向都在 `gate.config.json` 中声明，禁止硬编码到代码里。

调阈值 → 改 JSON → 重跑（无需改代码）。新增指标 → 加 JSON 条目 + 在
`lib/fetch-local-metrics.mjs::SQL_TEMPLATES` 注册 SQL → 单测覆盖。

字段说明：
- `zThreshold` — \|Z\| 阈值（建议 2.0–3.0）
- `momThreshold` — 环比%阈值（断崖检测）
- `direction` — `up` / `down` / `both`，控制只在特定方向触发
- `excludeRecent` — 排除最近 N 期不进 Z 计算（覆写全局 `maturity.excludeRecent`）

## 输出

```
logs/prepublish-gate/
├── verdict.json     # 全部指标判定明细（含未触发）
└── summary.md       # 人类可读摘要（触发时含排查建议）
```

## 测试

```bash
bun run test tests/prepublish-gate/   # 28 个单测
```

包含：参数解析、判定逻辑、注入异常 / 不足数据 / 取数错误三种边界、写旁路审计、
SQL 模板口径锚定（含 B252 / settled+reserve / 完整月过滤）。

## 已知限制 / P3 待办

- **DuckDB CLI 依赖**：闸门用 `duckdb -json -c "..."` 子进程；本机需 `brew install duckdb`。
  CI 已有 DuckDB（governance 用），生产 VPS 不用跑（release:daily 在本机发布）。
- **时间窗用系统时钟**：SQL 过滤用 `date_trunc('month', current_date)`，难以为单测
  注入固定日期。当前用注入式 fetcher 绕开。
- **没有 LLM 归因**：故意不引入，让闸门保持可复现 / 无 API 依赖；触发后归因由 sentinel
  发布后阶段补齐。
- **指标范围窄**：v1 只查 4 个 flow 量。若需加入率值（如月赔付率），需引入满期口径
  CTE 并维护与 `cost-ratios.ts` 的口径一致性。

## 相关

- 母 PR：见 git log 中的 "feat(prepublish-gate)" 提交
- 哨兵：`scripts/sentinel/` + `scripts/sentinel/README.md`
- 发布编排：`scripts/sync-and-reload.mjs` Stage 2.5
- 业务口径：`.claude/rules/business-domain.md`
- BACKLOG：B339（@claude 区间）
