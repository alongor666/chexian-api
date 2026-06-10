# cx CLI 全能力重构设计

> 日期：2026-06-09 · 状态：已批准（用户确认：保持 PAT 只读边界 + 一个 PR 一次到位 + 全流程自动执行）
> 范围：server 端能力登记补全 + governance 对账检查 + cx CLI 重构（@chexian/cli 0.1.0 → 0.2.0）

## 1. 背景与问题

cx CLI 定位为"程序化只读访问"三件套（PAT + CLI + MCP）之一，但当前只能发现
route-catalog 登记的 33 条查询路由，约为实际能力的 46%。能力登记层层漂移：

| 层 | 登记数 | 缺口 |
|---|---|---|
| `/api/query/*` 实际挂载 GET 端点 | 71 | —（不含 /test） |
| `server/src/config/api-routes.ts` QUERY_ROUTES（自称唯一事实源） | 54 | claims-detail(11)、customer-flow(5)、expense-development(1) 未登记 |
| `server/src/config/query-routes-metadata.ts` route-catalog | 33 | 再缺 quote-conversion(7)、policy-geo(2)、repair(13) |

同时 CLI 自身存在最佳实践缺口：版本号双源硬编码、退出码不成契约、
非 query 域（filters / data 版本 / 健康检查）无入口、无 shell 补全、无 stdin 管道支持。

## 2. 设计决策（已确认）

1. **能力边界 = PAT 只读**。POST/PUT/DELETE 由 `readonlyMiddleware` 架构层强制 403（RED LINE），
   CLI 不引入 session 登录。AI 问答（NL2SQL）、PAT 自助管理保留在 Web 端。
2. **交付 = 一个 PR**。server catalog 补全与 CLI 重构内聚（catalog 是 CLI 的数据源），
   体量超门禁时用 `GOVERNANCE_LARGE_PR_OK=1` 豁免并在 PR body 说明。
3. **架构 = 混合式**：query 域走动态 catalog（一次补全、永不漂移）；
   非 query 域加少量静态领域命令。否决"全静态 71 子命令"（重新制造漂移）。

## 3. server 端改动（纯追加，符合 append-only RED LINE）

### 3.1 QUERY_ROUTES 补 17 条常量

`api-routes.ts` 补 `CLAIMS_DETAIL.*`（11）、`CUSTOMER_FLOW.*`（5）、`EXPENSE_DEVELOPMENT`（1），
同步前端镜像 `src/shared/api/routes.ts`（两文件值必须完全一致）。

claims-detail 端点：pending-overview / pending-by-org / pending-aging / cause-analysis /
geo-accident / geo-plate / geo-comparison / claim-cycle / frequency-yoy /
loss-ratio-development / heatmap。
customer-flow 端点：summary / inflow / outflow / trend / metadata。

### 3.2 QUERY_ROUTE_METADATA 补约 38 条元数据

- 每条含中文 summary / description / parameters / dataScope / tags
- 参数定义从各子路由实际解析的 query 参数提炼（提示性，不做强校验，与现有约定一致）
- **catalog key 统一扁平 SCREAMING_SNAKE**（如 `QUOTE_CONVERSION_KPI`），
  禁止带点号——MCP tool 命名规范 `[a-zA-Z0-9_-]` 不允许点号，
  MCP 以 `cx_query_<key小写>` 生成工具名
- 补全后 MCP 零代码改动自动新增约 38 个工具

### 3.3 governance 对账检查（根治再漂移）

新增检查：扫描 `server/src/routes/query/*.ts` 实际挂载的 `router.get(path)` 集合，
与 QUERY_ROUTES 常量集、QUERY_ROUTE_METADATA 集三方对账，不一致即报错。
豁免清单显式声明（如 `/test` 仅本地）。

## 4. CLI 改动（9 → 14 命令，全部向后兼容）

### 4.1 命令面

| 命令 | 状态 | 设计 |
|---|---|---|
| `cx query <key\|path>` | 增强 | key 宽容匹配（大小写/中划线/下划线）；**path 直通**：以 `/` 开头时直接拼 `/api/query` 请求，不依赖 catalog；新增 `--limit <n>`（客户端截断行数）、`--timeout <ms>` |
| `cx routes` | 增强 | 新增 `--search <kw>`（匹配 key/summary/description）；默认按 tag 分组展示 |
| `cx sql <query\|->` | 增强 | `-` 或检测到非 TTY stdin 时从 stdin 读 SQL（管道友好） |
| `cx whoami` | 增强 | 显示 username / role / organization / dataScope / tokenType / tokenId / baseUrl |
| `cx filters` | 新增 | GET `/api/filters/options`，列维度可选值；`--dimension <name>` 过滤 |
| `cx data <sub>` | 新增 | `version` / `files` / `metadata`（GET /api/data/*），数据新鲜度与文件盘点 |
| `cx health` | 新增 | `/health` + `/api/data/version` + 延迟测量的一站式连通性诊断；无 PAT 也可跑 `/health` 部分 |
| `cx config <sub>` | 新增 | `get <key>` / `set <key> <val>` / `unset <key>` / `list` / `path`；管理 `~/.chexian/config.json` 的 baseUrl 等（token 只能经 login/logout 改） |
| `cx completion <shell>` | 新增 | 输出 bash / zsh 补全脚本（静态生成，覆盖命令与全局选项） |
| `cx login` / `logout` / `fields` / `metrics` / `presets` | 保留 | 不变（fields/metrics/presets 即 /api/discover/* 三端点） |

### 4.2 最佳实践契约

1. **版本单源**：`--version` 从 package.json 读取（构建时注入或运行时读取），删除硬编码
2. **退出码契约**（文档化 + 测试）：
   - 0 成功 · 1 通用/服务端错误 · 2 鉴权失败(401) · 3 权限不足(403) · 4 用法/参数错误 · 5 限流(429 重试后仍失败)
3. **流纪律**：stdout 只输出数据；诊断、进度、告警一律 stderr
4. **格式策略**：TTY 默认 table，非 TTY 默认 json；`--format table|json|csv` 全局一致
5. **颜色**：尊重 `NO_COLOR` 环境变量；新增全局 `--no-color`
6. **全局选项**：`--quiet`（抑制非数据输出）、`--verbose`（打印请求 URL/耗时）
7. **help**：全中文 + 每命令 `addHelpText('after', examples)`
8. **错误可操作**：401→`cx login`；403→提示 dataScope 受限；未知路由→提示 `cx routes`；网络错误→提示 baseUrl 与 `--base-url`
9. **README 重写** + `开发文档/PAT_GUIDE.md` CLI 章节同步

### 4.3 文件组织（200-400 行/文件）

```
cli/src/
  index.ts            # 命令注册 + 全局选项（瘦入口）
  api.ts              # HTTP 内核（重试/退避/退出码映射）
  config.ts           # 配置存取（不变 + config 子命令支撑）
  output.ts           # table/json/csv 渲染（+ --limit 截断提示）
  exit-codes.ts       # 退出码常量 + CxApiError → exit code 映射（新）
  commands/
    （现有 9 个 + filters.ts / data.ts / health.ts / config-cmd.ts / completion.ts）
```

## 5. 明确不做（YAGNI / 边界外）

- AI 问答 `cx ask`（POST，PAT 只读边界外）
- PAT 自助管理 `cx tokens`（服务端 requireSessionAuth，安全设计如此）
- reports HTML 拉取（浏览器场景）
- 交互式 REPL / TUI
- admin / workflows / skills / copilot 域

## 6. 测试与验证

- **单元测试**（vitest，沿用 cli/src/__tests__/）：
  路由解析（key 宽容匹配 / path 直通）、参数解析、输出渲染（含 --limit）、
  退出码映射、config 子命令、stdin SQL、completion 脚本生成
- **server 测试**：catalog 完整性单测（71 端点对账）、governance 检查自测
- **真实 API 验证**（验证协议 RED LINE，结果必须贴出）：
  本地 `bun run dev:full` 起服务 → 生成 PAT → 逐命令打通：
  `cx health` / `cx routes` / `cx query KPI --year=2026` / `cx query /repair/overview` /
  `cx query CLAIMS_DETAIL_PENDING_OVERVIEW`（新 catalog 条目）/ `cx filters` / `cx data version` /
  `cx sql` stdin 管道 / 退出码抽查（错 token → exit 2）
- `bun run build` 零 TS 报错 + `bun run governance` 通过

## 7. 交付物

1. server：api-routes.ts + 前端镜像 + query-routes-metadata.ts + governance 检查
2. cli：14 命令 + 退出码契约 + README
3. 文档：PAT_GUIDE.md 同步、本设计文档、BACKLOG 登记（bun scripts/backlog.mjs add）
4. PR：一个 PR 交付，含验证证据
