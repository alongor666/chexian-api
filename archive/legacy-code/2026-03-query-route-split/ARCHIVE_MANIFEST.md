# Query 路由拆分归档清单（2026-03）

## 归档目的

- 将 `server/src/routes/query.legacy.ts` 从活跃源码目录移出。
- 保留 2789 行历史实现，作为路由拆分的审计基线。
- 避免后续维护误回退到单体文件，确保 `server/src/routes/query.ts` 成为唯一入口。

## 归档目录

`archive/legacy-code/2026-03-query-route-split/`

## 已归档文件

- `query.legacy.ts`

## 活跃链路现状

- 统一入口：`server/src/routes/query.ts`
- 子模块目录：`server/src/routes/query/*.ts`
- 自动化护栏：`tests/query-route-modularization.test.ts`

## 归档后验证要点

- `server/src/app.ts` 仅从 `./routes/query.js` 挂载查询路由。
- `server/src/routes/query.legacy.ts` 不再存在于活跃目录。
- 33 个历史查询端点在拆分后保持完全等价。
