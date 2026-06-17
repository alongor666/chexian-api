# chexian-api PR 自审红线清单

> **commit-push-pr-core §3.4「自审 diff」的本项目挂载点。** push 前 Claude 必须读完 `git diff origin/main` 后，逐条对照本清单自查；发现问题当场修复，重跑前置检查全 ✅ 才提交。
>
> 背景（2026-05-17）：`claude-code-review.yml`（PR 后自动跑 `/code-review`）已下线——拖慢 CI 且产出价值低。改为本步骤强制 Claude 本地自审，diff 还在本地、问题就地修，省一轮"补丁 commit + 等 CI"。

## 0. 依赖链完整性（先于 commit）

修改前端 API 调用（`client.ts` / 命名空间子客户端 `api/*-api.ts` / 传输内核 `client-core.ts` / `routes.ts` / `query-keys.ts`）→ 必须 `grep` 确认后端对应路由文件、`paths.ts`、`api-routes.ts` 均已同步。前端新增方法须确认后端路由存在；改动 `client.ts` / 任一 `*-api.ts` / `client-core.ts` 须同步对应契约/特征化测试（热点契约门禁强制）。

## 1. 红线自审表

| 红线 | 自查问题 |
|------|---------|
| 指标/字段注册表 | 是否在 SQL 生成器中硬编码新指标？是否手编了 `mapping.ts`/`validator.ts`？是否新增 ETL 字段没声明到 `shard-config.json`/`fields.json`？ |
| SQL 安全 | 是否拼接了用户输入？是否绕过 `security.ts` 黑名单？分子/分母 cohort 是否一致？ |
| 业务口径 | 是否假设了因果关系（终端来源 vs 渠道、定价系数 vs 出险率）？分母是否用了 earned exposure？驾乘推介率分母是否排除纯交强/单交？ |
| 验证证据 | 声称"完成"是否贴出 `curl` 200 + 非空 JSON？修改 SQL 是否同时用 DuckDB CLI 直查 Parquet 对账？ |
| 安全敏感 | 是否处理用户输入/鉴权/敏感数据但**没**触发 `/chexian-security-review`？是否新增 PAT/token 相关代码未走 `readonlyMiddleware`？ |
| 影响半径 | `client.ts` / `api/*-api.ts` / `client-core.ts` / `routes.ts` / `query-keys.ts` 改了，后端路由/`paths.ts`/`api-routes.ts` 是否同步？契约/特征化测试是否同步？前端硬编码的指标标签/阈值是否从注册表派生？ |
| 大文件/路径 | diff 是否引入 >50MB 文件？是否出现硬编码路径（应走 `paths.ts` 或环境变量）？ |
| sink/scorecard 落位 | diff 是否写入 user-only 路径？`.claude/shared-memory/**` / `~/.claude/projects/**/memory/**` 是 AGENTS.md §8.3 user-only —— AI 只读不写；evidence-loop scorecard、流程沉淀、自进化日志一律写 `.claude/workflow/pr-evolution.md`（append-only，与 `commit-push-pr-core` 共享文件）。**根因来自 PR #662**：scorecard 误落 shared-memory，根治见 [evidence-loop.md §3.2](./rules/evidence-loop.md) "scorecard 落位 SSOT" |
| CLI 一致性 | 新增 `isTTY` / 入口判据 / format 检测时，必先 `grep cli/src/commands/*.ts` 对照现有 10+ 处用法（如 stdout 决定输出格式 / stdin 决定是否读管道），不创造独此一家的过严或过松判据。**根因来自 PR #662**：TTY guard 写 `stdin && stdout` 双 TTY 误拒 `cx query -i -f json > out.json` |
| CLI 性能 CI 闸预测 | 新增 / 改动 `cli/src/index.ts` 顶层 import 或 cold path 的 .ts 文件 → push 前 `cd cli && bun run build:bin && bun run bench` 看 A p95；按 `CI_FACTOR ≈ 14`（GitHub Actions ubuntu-latest 共享 runner vs M-series 本地）估算：**`本地 A p95 × 14 必须 ≤ 250ms`** 才允许 push。**根因来自 PR #662**：本地 19→21ms 似乎"零退化"，但 CI 上 ≈ 298ms 直接红 cli-perf-sentinel 闸 |

## 2. 输出格式（贴对话，便于用户复核）

```
🔍 自审清单
- 指标/字段注册表 ✅
- SQL 安全 ✅
- 业务口径 ⚠️ <说明>
- 验证证据 ✅ <curl 输出摘要>
- 安全敏感 N/A
- 影响半径 ✅
- 大文件/路径 ✅
- sink/scorecard 落位 ✅ <"未写 shared-memory" or "写 pr-evolution.md">
- CLI 一致性 N/A <若不动 cli/>
- CLI 性能 CI 闸预测 N/A <若不动 cli 顶层 import> / ✅ 本地 A p95 = Xms × 14 = Yms ≤ 250

结论：可推送 / 需先修 <项>
```

## 3. 第二意见（按需，付费 token，勿滥用）

架构变动 / 跨模块重构 / 可疑业务口径 → 追加 `/codex review`，或在 PR 评论 `@claude review` 由 `claude.yml`（`@claude` 触发）执行一次 review。**不要**为常规变更滥用——自审不到位时才上。

> 注：PR 自动 review（`claude-code.yml` 旧 `auto-review` job + `pull_request` 触发器）已于 2026-06-13（PR #620）取消，不再每次提交自动跑。现仅保留 `@claude` 手动触发。

## 4. 部署链 PR 特例（RED LINE）

改动 `deploy.yml` / `deploy/vps-wrapper/**` / `scripts/sync-vps.mjs` / `ecosystem.config.cjs` 的 PR：**禁止 auto-merge**，必须人工选监控窗口手动合并并盯 CI 前 5 分钟。详见 `.claude/rules/deploy-chain-sop.md`。
