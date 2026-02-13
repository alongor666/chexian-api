# FORalongor.md -- chexian-api 深度理解指南

> 读完这篇文章，你应该能在脑子里画出一张完整的系统架构图，并且知道出问题时该去哪里找答案。

---

## 一、这个项目是什么？

一句话：**一个用 DuckDB 驱动的车险数据分析平台，所有查询都在服务器上完成。**

想象你是一位保险公司的分析师，手头有十几万条车险保单数据，想知道这个月哪个分公司保费增长最猛、哪类车型续保率在下跌、业务员人均保费排名如何。传统方案是写 Excel 透视表，但数据一多就卡到怀疑人生。

这个项目把所有分析查询交给了 **DuckDB**（一个嵌入式的分析型数据库引擎），它像一台专门为 OLAP 查询打造的涡轮增压发动机。你在浏览器里操作仪表盘，背后是 Express 服务器接收请求、DuckDB 执行 SQL、结果以 JSON 返回、前端渲染成图表。

就像你在餐厅点菜，服务员把菜单递给后厨（DuckDB），后厨做好菜端上来（JSON），你只管吃。

---

## 二、项目的前世今生：一次重要的拆分

### 双模式时代（chexianYJFX）

这个项目的前身叫 **chexianYJFX**，它做了一件野心勃勃的事：让用户既能在浏览器里直接跑 DuckDB-WASM（数据不出本机），也能连接后端 API（多人协作）。听起来很美好，对吧？

但现实给了一巴掌。

双模式意味着**每一个数据获取逻辑都要写两套**：一套走 Web Worker + Arrow IPC（浏览器内），一套走 fetch + JSON（后端 API）。状态管理变成了噩梦——`DataContext.isDataLoaded`、`duckdbClient.isDataLoaded()`、组件自己的 `isInitialized`，三层状态互相打架，经常出现"数据明明加载了，但仪表盘显示暂无数据"的灵异事件。

调试这种问题就像在三个抽屉里找一把钥匙，每个抽屉里还有三个暗格。

### API-only 新生（chexian-api）

2026 年 2 月，我们做了一个果断的决定：**砍掉 DuckDB-WASM 模式，只保留后端 API 模式**。

理由很简单：
- **用户场景收敛了**：实际使用中，绝大多数用户都是登录后通过 API 查询，纯离线场景几乎没有
- **维护成本减半**：不再需要维护 COOP/COEP 安全头、Web Worker 通信、Arrow IPC 序列化这一整套浏览器端基础设施
- **状态管理变清晰**：数据来源只有一个（后端 API），`isDataLoaded` 的含义不再模糊

这次拆分的教训值一百万：**两个模式并存不是"灵活"，是"两倍的 bug 面积"。** 如果 90% 的用户只用一种模式，那另一种模式就是纯粹的维护负担。

---

## 三、技术架构：餐厅的三层结构

整个系统分成三层，就像一个组织有序的餐厅：

```
┌──────────────────────────────────────────────────────┐
│  前厅（前端）                                          │
│  React + Vite + ECharts                              │
│  用户操作仪表盘、筛选数据、看图表                        │
│            │                                          │
│            ▼  REST API (fetch + JSON)                 │
├──────────────────────────────────────────────────────┤
│  后厨（后端）                                          │
│  Express + JWT + Zod                                 │
│  验证身份、校验参数、拼接 SQL、控制权限                   │
│            │                                          │
│            ▼  DuckDB Node.js Binding                  │
├──────────────────────────────────────────────────────┤
│  仓库（数据层）                                        │
│  DuckDB + Parquet 文件                                │
│  执行 SQL、列名映射、PolicyFact 去重视图                 │
└──────────────────────────────────────────────────────┘
```

**一个典型的请求旅程**：

1. 用户在仪表盘选了"2025年、全部机构、按月趋势"
2. 前端 `ApiClient.getTrend()` 发起 `GET /api/query/trend?startDate=2025-01-01&endDate=2025-12-31&timeView=month`
3. Express 路由 `query.ts` 接收请求，先过 JWT 认证中间件和权限中间件
4. Zod 校验参数格式，`buildSafeDateConditions` 构建安全的 WHERE 子句
5. `generatePremiumTrendQuery(whereClause, 'month')` 生成 SQL
6. `duckdbService.query(sql)` 执行查询
7. 结果 JSON 返回前端，ECharts 渲染成折线图

---

## 四、代码结构漫游

### 前端：`src/`

```
src/
├── shared/           # 共享基础设施（心脏）
│   ├── api/          #   ApiClient —— 所有后端请求的唯一入口
│   ├── contexts/     #   AuthContext / DataContext / FilterContext / PermissionContext
│   ├── styles/       #   全局样式系统（tableStyles, textStyles, buttonStyles）
│   ├── utils/        #   formatters.ts（格式化规范）、export.ts
│   ├── ui/           #   基础 UI 组件（Card, Badge, Button...）
│   ├── hooks/        #   通用 React Hooks
│   └── types/        #   TypeScript 类型定义
├── features/         # 14 个业务功能模块（办公室）
│   ├── dashboard/    #   主仪表盘：KPI 卡片 + 趋势图
│   ├── growth/       #   增长率分析：同比/环比/年累计
│   ├── cost/         #   成本分析：赔付率/费用率/综合率/变动分析
│   ├── coefficient/  #   商车自主定价系数监控
│   ├── sql-query/    #   交互式 SQL 查询（Monaco 编辑器 + 17 个模板）
│   ├── premium-report/  营销保费报表
│   ├── marketing-report/ 假日营销战报
│   ├── filters/      #   全局筛选面板
│   ├── home/         #   首页（数据导入入口）
│   ├── auth/         #   登录/认证
│   └── ...           #   settings, report, file, query-assistant, pages
└── widgets/          # 可复用的高级 UI 组件（积木库）
```

### 后端：`server/src/`

```
server/src/
├── app.ts            # Express 入口（安全头、CORS、路由注册）
├── routes/           # 5 组 API 路由
│   ├── auth.ts       #   /api/auth/* — 登录、注册
│   ├── query.ts      #   /api/query/* — KPI、趋势、排名、自定义查询（12 个端点）
│   ├── data.ts       #   /api/data/* — 文件上传、列表、加载
│   ├── ai.ts         #   /api/ai/* — NL2SQL 自然语言转 SQL
│   └── filters.ts    #   /api/filters/* — 筛选选项（机构、业务员列表）
├── services/         # 核心服务
│   ├── duckdb.ts     #   DuckDB 单例服务（连接池、查询执行、Parquet 加载）
│   ├── auth.ts       #   认证服务（JWT 生成、密码验证）
│   ├── zhipu.ts      #   智谱 AI（GLM-4.7-flash，NL2SQL）
│   ├── column-normalizer.ts  列名标准化（中英文别名映射）
│   └── permission.ts #   权限服务（行级数据过滤）
├── sql/              # 14 个 SQL 生成器（菜谱库）
│   ├── kpi.ts        #   KPI 汇总查询
│   ├── kpi-detail.ts #   KPI 分解（占比数据，用于环形图）
│   ├── trend.ts      #   保费趋势（日/周/月/年）
│   ├── growth.ts     #   增长率分析
│   ├── cost.ts       #   成本分析四维度（赔付率/费用率/综合率/变动率）
│   ├── coefficient.ts#   自主定价系数
│   ├── truck.ts      #   营业货车（吨位分段分析）
│   ├── renewal.ts    #   续保分析
│   ├── salesman-ranking.ts  业务员排名
│   └── ...           #   premiumPlan, renewal-drilldown, perspective-adapter
├── middleware/        # 中间件
│   ├── auth.ts       #   JWT 认证（所有 /api/* 路由强制经过）
│   ├── permission.ts #   权限过滤（行级安全）
│   └── error.ts      #   统一错误处理
└── utils/            # 安全工具
    ├── sql-validator.ts       SQL 安全校验（只允许 SELECT）
    ├── sql-sanitizer.ts       参数转义（防注入）
    ├── sql-permission-injector.ts  权限条件注入
    └── security.ts            通用安全函数
```

### 快速定位手册

| 你想找什么 | 去哪里 |
|-----------|--------|
| 某个 KPI 是怎么算的 | `server/src/sql/kpi.ts` |
| 前端怎么调后端 API | `src/shared/api/client.ts` |
| 用户登录流程 | `server/src/services/auth.ts` + `server/src/routes/auth.ts` |
| 某个仪表盘页面 | `src/features/{模块名}/` |
| 筛选条件怎么传到后端 | `src/shared/contexts/FilterContext.tsx` -> `ApiClient` -> `query.ts` |
| 列名映射（中英文别名） | `server/src/normalize/mapping.ts` |
| 数据格式化规范 | `src/shared/utils/formatters.ts` |
| 全局样式 | `src/shared/styles/index.ts` |

---

## 五、关键技术决策：为什么这样做？

### DuckDB 作为分析引擎

DuckDB 是一个嵌入式的列式分析数据库。你可以把它想象成 **SQLite 的分析版哥哥**：SQLite 擅长事务处理（一行一行地增删改查），DuckDB 擅长分析查询（对整列数据做聚合、分组、排序）。

在这个项目里，DuckDB 直接读取 Parquet 文件（列式存储格式），不需要提前导入数据库。一句 `SELECT * FROM read_parquet('xxx.parquet')` 就能开始分析。这意味着用户上传新数据后，几秒钟内就能查询。

为什么不用 PostgreSQL 或 MySQL？因为我们的场景是**只读分析**，不是事务处理。DuckDB 在 OLAP 场景下的性能远超传统 OLTP 数据库，而且零运维——不需要安装数据库服务，不需要 DBA。

### Zod 做 API 参数校验

后端每一个路由的请求参数都用 Zod Schema 校验。这不是可选的装饰，而是安全防线。

```typescript
const kpiQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  orgLevel3: z.string().optional(),
});
```

Zod 的好处是**类型推导和运行时校验合二为一**。定义一次 Schema，既得到了 TypeScript 类型（编译时安全），又得到了请求校验（运行时安全）。比手写 `if (!req.query.startDate)` 干净一百倍。

### SQL 生成器模式（不是 ORM）

`server/src/sql/` 目录下有 14 个 SQL 生成器，每个对应一个分析场景。它们不是 ORM，而是**模板函数**——接收筛选条件，输出完整的 SQL 字符串。

为什么不用 ORM？因为分析型查询太复杂了。CASE WHEN 嵌套、多层子查询、窗口函数、PIVOT——这些用 ORM 写出来的代码比 SQL 本身还难读。SQL 生成器的优势是：**你能直接看到最终执行的 SQL 长什么样**。调试时把 SQL 复制到 DuckDB CLI 里一跑就知道对不对。

### JWT 认证 + 行级权限

所有 `/api/*` 路由都强制经过 JWT 认证中间件。不是某些路由需要，是**全部**。

更进一步，权限中间件会根据用户角色注入数据过滤条件。比如，某个分公司的用户只能看到自己公司的数据——这是通过 `sql-permission-injector.ts` 在 SQL 的 WHERE 子句中自动追加 `org_level_3 = '某分公司'` 实现的。用户感知不到，但数据已经被过滤了。

---

## 六、血泪教训

每一个教训都是真金白银（时间）买来的。

### 教训 #1：双模式的代价

**故事**：chexianYJFX 时代，每次新增一个查询功能，都要同时实现浏览器端（Worker + Arrow）和 API 端（fetch + JSON）两套逻辑。某次修改了 API 端的返回格式但忘了改浏览器端，导致切换模式后图表全部空白。排查花了整整一天。

**教训**：不要为了"灵活性"维护两套数据通道。如果一种模式能覆盖 90% 的需求，就砍掉另一种。两套代码意味着两倍的 bug 面积、两倍的测试工作量、和两倍的认知负担。

### 教训 #2："暂无数据"的排查深渊

**故事**：用户反馈仪表盘显示"暂无数据"。排查了 UI 层、发现 `isDataLoaded` 是 false。又排查 DataContext，发现后端确实返回了文件列表但状态没更新。再排查认证，发现 token 过期了但前端没刷新。

**怎么避免**：遇到"暂无数据"，按这个检查单逐一排查，不要瞎猜：

1. 用户是否已登录？（`localStorage.getItem('auth_token')` 非空？）
2. 后端是否启动？（终端有 "Server is running on http://localhost:3000"？）
3. 后端是否有数据文件？（首页文件列表有数据？）
4. API 请求是否成功？（浏览器网络面板看 200/404/500？）
5. `isDataLoaded` 状态是否为 true？

### 教训 #3：不在浏览器测就提交 = 返工

**故事**：2026 年 1 月 8 日，一个自然周/月视图的实现，在单元测试里全部通过。提交后才发现浏览器里 API 返回的日期格式和预期不同，图表 X 轴全乱了。返工了三次。

**教训**：这是"三层验证"协议诞生的原因：(1) 单元测试验证逻辑 -> (2) 浏览器 DevTools 验证实际 API 响应 -> (3) 用户操作验收。不准跳级。单元测试通过不等于功能正确——浏览器里才是真相。

### 教训 #4：前端加了 API 调用，后端路由不存在

**故事**：2026 年 2 月 4 日，KPI 卡片全部显示 "--"。排查发现前端 `ApiClient` 调用了 `/api/query/kpi-detail`，但后端根本没有这个路由。前端发了请求，后端返回 404，前端默默 fallback 成空值。

**教训**：前端新增任何 API 调用之前，**先确认后端路由已经存在**。这听起来是常识，但当前后端代码由不同的人（或不同的 AI agent）同时开发时，这种脱节几乎必然发生。

### 教训 #5：dateField 参数的 SQL 注入风险

**故事**：早期 `buildSafeDateConditions` 函数的 `dateField` 参数直接拼进 SQL 字符串，没有做白名单校验。虽然这个参数通常是代码内部传入的（不是用户输入），但如果某个路由不小心把用户输入传了进去，就是一个 SQL 注入漏洞。

**怎么修的**：所有动态参数都必须经过 `sql-sanitizer.ts` 中的安全函数处理。日期用 `buildDateCondition`，字符串用 `buildStringCondition`，表名用 `sanitizeTableName`。没有例外。

---

## 七、潜在陷阱（新手必读）

### 陷阱 #1：只启动前端，忘了后端

运行 `bun run dev` 只启动了 Vite 前端开发服务器。前端能打开，登录页能看到，但登录后所有 API 请求都会失败（`fetch` 报 `ERR_CONNECTION_REFUSED`），仪表盘一片空白。

**正确姿势**：永远使用 `bun run dev:full`，它会同时启动前端（5173 端口）和后端（3000 端口）。

### 陷阱 #2：修改了 SQL 生成器但没加路由

`server/src/sql/` 里的生成器只是函数，它们不会自动暴露成 API 端点。写了一个新的 SQL 生成器后，必须在 `server/src/routes/query.ts` 里注册对应的路由，并在前端 `src/shared/api/client.ts` 里添加调用方法。三个地方缺一不可。

### 陷阱 #3：`isDataLoaded` 的含义

`DataContext.isDataLoaded` 表示"后端有可查询的数据文件"。它不是"数据已经在前端内存里"（那是 WASM 时代的概念，已不存在）。所有查询都是实时发到后端的，`isDataLoaded` 只是一个"门卫"——告诉你能不能开始查询。

### 陷阱 #4：业务口径文件不能随便改

`server/src/services/duckdb.ts` 里的 `createPolicyFactView` 方法定义了保单去重规则。`server/src/sql/` 里的每个生成器定义了各分析场景的计算口径。这些都是**业务规则**，改动需要产品团队确认。你可以追加新的查询，但不能修改已有查询的逻辑。

### 陷阱 #5：列名映射只追加不删除

`server/src/normalize/mapping.ts` 里定义了中文列名到英文标准字段的映射。用户上传的 Parquet 文件可能用"保单号"、也可能用"单号"、也可能用"policy_no"。映射表把这些全部统一。但注意：**只能往里面加新别名，不能删除已有的**。删了就意味着某些旧格式的数据文件无法被识别。

---

## 八、新技术入门路径

### DuckDB（服务端分析引擎）

**核心概念**：嵌入式列式数据库，不需要独立的数据库服务进程。就像 SQLite 一样嵌入你的应用，但专门优化了 OLAP（在线分析处理）场景。

**上手路径**：
1. 读 [DuckDB 官方文档](https://duckdb.org/docs/) 的 "Why DuckDB" 部分
2. 在项目里看 `server/src/services/duckdb.ts`，理解初始化、连接池、查询执行
3. 看一个 SQL 生成器（比如 `server/src/sql/kpi.ts`），理解查询是怎么拼出来的
4. 注意 DuckDB 不是 PostgreSQL——日期函数、类型转换有微妙差异，不要凭 PostgreSQL 经验猜测

**关键特性**：
- 直接读 Parquet 文件，不需要先导入
- 支持 Arrow IPC 输出（用于大结果集的高效传输）
- BigInt 类型需要手动转 Number（否则 JSON 序列化会报错）

### Zod（运行时类型校验）

**核心概念**：用 TypeScript 写 Schema，同时得到编译时类型和运行时校验。

**在本项目中的应用**：每个 API 路由的请求参数都用 Zod 校验。看 `server/src/routes/query.ts` 里的 `kpiQuerySchema`，就是一个最小示例。

### 智谱 AI（NL2SQL）

**核心概念**：用户输入自然语言（比如"查一下上个月保费最高的五个机构"），智谱 AI 把它翻译成 SQL 查询。

**实现位置**：`server/src/services/zhipu.ts`，使用 GLM-4.7-flash 模型（免费），通过标准 API 端点 `https://open.bigmodel.cn/api/paas/v4` 调用。

---

## 九、好工程师在这里怎么工作？

### 三问原则：动手前先查

在写任何新代码之前，必须回答三个问题：

1. **已有吗？** —— 查 `CODE_INDEX.md`，看看是不是已经有人实现了类似功能
2. **能复用吗？** —— 查 `src/shared/`，格式化函数、样式、API 方法可能已经存在
3. **有模式吗？** —— 查同类实现，比如要写新的分析页面就参考 `dashboard/`

这三个问题能阻止你重复造轮子。项目里曾经出现过三个不同的金额格式化函数，格式还不一样——这就是不查就写的后果。

### 防御性编码

所有从后端返回的数据，在前端使用前都要做空值防护：

```typescript
// 正确：处理可能为 undefined 的字段
const timePeriod = row.time_period ?? '';
const year = timePeriod.includes('-') ? timePeriod.split('-')[0] : '2025';

// 错误：直接访问，API 返回 null 就炸了
const year = row.time_period.includes('-') ? ...  // TypeError!
```

### 治理检查

每次提交前运行 `bun run governance`。它会检查：INDEX.md 是否更新、是否有未登记的组件、是否违反了命名规范。校验不通过就不能提交。

这不是官僚主义，这是让下一个接手代码的人能在 5 分钟内找到任何模块的"路标系统"。

---

## 十、最佳实践清单

### 格式化统一

**唯一来源**：`src/shared/utils/formatters.ts`

| 数据类型 | 函数 | 输出示例 |
|---------|------|---------|
| 件数 | `formatCount` | `1,234` |
| 均值 | `formatAverage` | `1,234.5` |
| 百分比 | `formatPercent` | `85.6%` |
| 保费（万元） | `formatPremiumWan` | `1,234` |
| 系数 | `formatCoefficient` | `0.8523` |

不要自己写 `(premium / 10000).toFixed(2)`。用统一函数，保证全平台格式一致。

### 样式统一

**唯一来源**：`src/shared/styles/index.ts`

所有 UI 组件使用 `tableStyles`、`textStyles`、`buttonStyles`，不硬编码 Tailwind 类。数字展示一律用 `textStyles.numeric`（等宽字体 `font-mono tabular-nums`），让表格里的数字对齐得像阅兵方队。

### SQL 安全层

后端所有用户输入的参数，必须经过安全函数处理后才能拼入 SQL：

- 日期：`buildDateCondition(field, operator, value)` —— 强制校验 YYYY-MM-DD 格式
- 字符串：`buildStringCondition(field, value)` —— 自动转义单引号
- 表名：`sanitizeTableName(name)` —— 白名单字符校验
- 自定义 SQL：`validateSQL(sql)` —— 只允许 SELECT，禁止 DROP/DELETE/UPDATE

---

## 十一、从这里开始

### 第一天：认识世界

1. 读这篇 FORalongor.md（你正在读）
2. 运行 `bun run dev:full`，登录系统，在仪表盘上点点看
3. 打开 Chrome DevTools 的 Network 面板，观察每次操作触发了哪些 API 请求

### 第一周：理解架构

1. 读 `CLAUDE.md` —— 项目的"协作操作系统"
2. 通读 `server/src/routes/query.ts`，理解一个完整的请求处理流程
3. 看 `server/src/sql/kpi.ts`，理解 SQL 生成器的模式
4. 看 `src/shared/api/client.ts`，理解前端怎么调后端

### 第一个月：开始贡献

1. 熟悉 `server/src/normalize/mapping.ts` 的列名映射规则
2. 尝试新增一个 SQL 生成器 + 路由 + 前端调用的完整链路
3. 养成"三层验证"习惯：单元测试 -> 浏览器实测 -> 用户验收

### 推荐先读的三个文件

| 优先级 | 文件 | 读完能获得什么 |
|--------|------|--------------|
| 1 | `CLAUDE.md` | 完整的开发规范和决策框架 |
| 2 | `server/src/routes/query.ts` | 后端 API 全貌，理解请求从进来到返回的完整链路 |
| 3 | `src/shared/api/client.ts` | 前端如何调用后端，所有 API 方法的目录 |

---

> 最后一句：这个项目的本质不是"DuckDB + React"，而是**让保险分析师打开浏览器就能看到业务真相**。所有技术决策都服务于这一个目标：从登录到看到第一张图表，不超过 10 秒。理解了这个"为什么"，你就理解了一切。
