# chexian-api 后端服务

后端已运行于 **API-only 架构**：前端仅通过 `/api/*` 访问后端 DuckDB（`@duckdb/node-api`）。

## 当前状态

- 状态：生产可用
- 架构：Express + TypeScript + DuckDB（Server Side）
- 鉴权：JWT
- 安全：限流、权限过滤、审计中间件

## 目录结构

```text
server/
├── src/app.ts
├── src/routes/            # auth / wecom-auth / query / data / filters / ai
├── src/services/          # duckdb / auth / permission / wecom
├── src/sql/               # 业务 SQL 生成器
├── src/middleware/        # auth / permission / error / rate limiter / audit
├── src/types/
├── src/utils/
├── data/                  # 本地 Parquet 数据目录
└── tsconfig.json
```

## 本地启动

在仓库根目录执行（推荐）：

```bash
bun run dev:full
```

仅后端：

```bash
bun run start:server
```

健康检查：

```bash
curl http://localhost:3000/health
```

## 核心 API

- 认证：`/api/auth/*`、`/api/auth/wecom/*`
- 数据：`/api/data/*`
- 查询：`/api/query/*`
- 筛选：`/api/filters/options`
- AI：`/api/ai/*`

详细端点请以代码为准：`server/src/routes/*.ts`

## 环境变量

最小必需：

```env
PORT=3000
JWT_SECRET=change-me
CORS_ORIGIN=http://localhost:5173
```

企微登录（可选）：

```env
WECOM_CORP_ID=...
WECOM_AGENT_ID=...
WECOM_SECRET=...
WECOM_ADMIN_USERIDS=userA,userB
```

## 开发与验证

```bash
bun run typecheck
bun run governance
bun run test -- --run tests/api/client.test.ts tests/integration/critical-path.test.ts
```

## 说明

- 历史双模式（DuckDB-WASM）仅保留在历史文档中，不再是当前运行架构。
- 业务口径与 SQL 语义以 `server/src/sql/*` 与 `server/src/services/duckdb.ts` 为准。
