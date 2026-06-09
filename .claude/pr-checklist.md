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

结论：可推送 / 需先修 <项>
```

## 3. 第二意见（按需，付费 token，勿滥用）

架构变动 / 跨模块重构 / 可疑业务口径 → 追加 `/codex review`，或在 PR 评论 `@claude review` 显式触发 `claude-code.yml` 的 auto-review job。**不要**为常规变更滥用——自审不到位时才上。

## 4. 部署链 PR 特例（RED LINE）

改动 `deploy.yml` / `deploy/vps-wrapper/**` / `scripts/sync-vps.mjs` / `ecosystem.config.cjs` 的 PR：**禁止 auto-merge**，必须人工选监控窗口手动合并并盯 CI 前 5 分钟。详见 `.claude/rules/deploy-chain-sop.md`。
