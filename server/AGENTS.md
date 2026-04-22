# server/AGENTS.md

> 后端、SQL、API、注册表相关任务优先遵守这里的规则；根目录 `AGENTS.md` 仍然适用。

## 1. 工作原则

- 使用 `bun` 和仓库已有脚本，不要引入额外包管理器或临时流程。
- 修改前先搜索现有实现，优先复用现有 SQL 模块、路由和服务边界。
- 避免硬编码路径，优先使用 `server/src/config/paths.ts` 或环境变量。

## 2. SQL 与 API

- 修改 SQL 生成器、查询路由或 API 处理逻辑时，优先用真实接口请求验证。
- 修改路由后，至少验证对应端点返回 200 和非空 JSON。
- 修改 SQL 或数据口径后，必要时对照原始数据、Parquet 或 DuckDB 查询结果做一致性检查。

## 3. 指标与字段注册表

- 指标唯一事实源：`server/src/config/metric-registry/`。
- 指标字典：`开发文档/指标字典.md`，是自动生成内容，禁止手改。
- 新增/修改指标前，先确认注册表里不存在相同 `id` 或重复公式。
- 字段唯一事实源：`server/src/config/field-registry/fields.json`。
- 字段相关生成文件不要手改，先改源定义，再跑对应生成脚本。
- 修改注册表体系后，优先运行对应校验和生成脚本，不要跳过 codegen。

## 4. 常用命令

- `bun run build`
- `bun run test`
- `bun run test:integration`
- `bun run governance`
- `bun run snapshot:build`
- `bun run snapshot:verify`

