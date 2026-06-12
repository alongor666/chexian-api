# 技术栈声明与验证协议

**唯一事实来源**：本文档定义项目技术栈、架构约束、验证方法。所有AI协作者必须先读本文档。

> **架构模式**：API-only 模式（React 客户端 + Express REST API + 后端 DuckDB native）。从 chexianYJFX 双模式项目拆分而来，当前运行架构不包含 DuckDB-WASM / Local 模式。

---

## 1. 技术栈核心依赖（CRITICAL）

> **版本以 `package.json` / `server/package.json` 为唯一事实来源**。下方清单仅列关键库与约束；实际版本号以锁文件为准，此处不重复维护具体数字。

### 1.1 前端技术栈
```
React          - UI 框架（当前 19.x）
TypeScript     - 类型系统（当前 5.x）
Vite           - 构建工具（当前 5.x，P2 技术债待升级）
Tailwind CSS   - 样式框架（当前 3.x，设计系统绑定 3.x 写法）
ECharts        - 图表库（当前 5.x）
Vitest         - 单元测试（当前 3.x，≥3.2.6 修复严重级通告）
```

**包管理器**：Bun（禁止使用 npm/yarn/pnpm）

### 1.2 后端技术栈
```
Express        - Web 框架（当前 4.22.x，≥4.22.2 修复高危路由解析）
@duckdb/node-api - DuckDB native SQL 引擎（非 WASM，受小版本兼容红线约束，见 CLAUDE.md §5）
jsonwebtoken   - JWT 认证
bcrypt         - 密码哈希（原生模块，post-checkout 自愈链路）
Helmet         - HTTP 安全头
Zod            - 输入校验（当前 4.x，前后端同版）
TypeScript     - 类型系统
tsx            - 开发热重载
multer         - 文件上传（当前 2.x，使用点：server/src/routes/data.ts）
better-sqlite3 - PAT 持久化存储
lru-cache      - 路由缓存（LRU 内存层）
```

**关键约束**：
- DuckDB 运行在后端 Node.js 进程中（`@duckdb/node-api` 原生绑定）
- 前端不直接执行 SQL，所有查询通过 REST API 发送到后端
- 后端 DuckDB 服务为单例模式，带连接池管理
- SQL 模板定义在 `server/src/sql/` 目录，字段类型在 `server/src/services/duckdb.ts`
- 所有 `/api/*` 路由必须经过 JWT 认证中间件

### 1.3 数据流架构

```
前端组件 → useApiQuery() → src/shared/api/client.ts → HTTP → server/src/routes/*.ts
                                                                    ↓
前端渲染 ← JSON 响应 ← server/src/services/duckdb.ts ← server/src/sql/*.ts
```

---

## 2. 架构强制入口（开发前必读）

### 规则：修改任何层级代码前，必须先读对应文件

| 修改内容 | 必须先读的文件 | 原因 |
|----------|----------------|------|
| **SQL 查询模板** | `server/src/sql/*.ts` | 各查询模板的口径定义（KPI、趋势、排名等） |
| **DuckDB 查询执行** | `server/src/services/duckdb.ts` | 连接管理、视图定义、字段类型约束 |
| **日期时间处理** | `开发文档/TECH_STACK.md` SS 3.1 | DuckDB 日期函数与标准 SQL 差异 |
| **列名映射** | `server/src/normalize/mapping.ts` | 列名别名规则（不可删除已有映射） |
| **KPI 计算** | `server/src/sql/kpi.ts` | 指标口径定义（不可修改已有模板） |
| **API 路由** | `server/src/routes/*.ts` | 后端 API 端点定义（不可删除已有路由） |
| **API 客户端** | `src/shared/api/client.ts`（+ `client-core.ts` 传输内核 + 13 个 `*-api.ts` 命名空间子客户端） | 前端所有后端请求的统一入口 `apiClient`；按域细分 `apiClient.{auth,ai,data,workflows,crossSell,performance,repair,claimsDetail,quoteConversion,customerFlow,premium,geo,patrol}.*` |
| **React 组件** | `src/features/INDEX.md` | 组件职责边界 |
| **图表配置** | `src/widgets/charts/README.md` | ECharts 配置规范 |

**违反后果**：
- 类型不匹配（如 `YEAR(VARCHAR)` 报错）
- 业务逻辑错误（如使用 ISO 周而非自然周）
- 数据重复或缺失（如破坏去重规则）
- API 端点 404（前端调用了后端不存在的路由）

---

## 3. DuckDB 特定约束（CRITICAL）

> DuckDB 运行在后端（`server/src/services/duckdb.ts`），使用 `@duckdb/node-api` 原生包 v1.4.4-r.1。
> 不是 DuckDB-WASM，不在浏览器中执行。SQL 验证通过后端日志或 API 返回结果确认。

### 3.1 日期时间处理

**字段类型约束**：
```sql
-- Parquet 文件中日期字段为 VARCHAR 类型
-- 必须 CAST 为 DATE 后才能使用日期函数
-- ❌ 错误：YEAR(policy_date)        - 报错：No function matches YEAR(VARCHAR)
-- ✅ 正确：YEAR(CAST(policy_date AS DATE))
```

**常用日期函数**：
```sql
-- 提取年月日
YEAR(CAST(date AS DATE))           -- 年份（BIGINT）
MONTH(CAST(date AS DATE))          -- 月份（BIGINT）
DAYOFYEAR(CAST(date AS DATE))      -- 一年中的第几天（1-365/366）

-- 星期相关
ISODOW(CAST(date AS DATE))         -- ISO 星期几（1=周一, 7=周日）
WEEK(CAST(date AS DATE))           -- ISO 周编号（注意：非自然周！）

-- 日期截断和格式化
DATE_TRUNC('year', CAST(date AS DATE))    -- 截断到年初
STRFTIME(CAST(date AS DATE), '%Y-%m')     -- 格式化为 YYYY-MM
```

**ISO 周 vs 自然周**：
- `WEEK()` 返回 **ISO 周**：第一周包含第一个周四，周一开始
- 如需**自然周**（1月1日开始，到第一个周一前结束），必须自定义计算

**参考文档**：
- [DuckDB Date Functions](https://duckdb.org/docs/stable/sql/functions/date)
- [DuckDB Date Format](https://duckdb.org/docs/stable/sql/functions/dateformat)

### 3.2 字符串拼接

```sql
-- ✅ 使用 CONCAT 或 ||
CONCAT('2025', '-W', '01')         -- 推荐：明确语义
'2025' || '-W' || '01'             -- 可用：PostgreSQL 兼容
```

### 3.3 数值处理

```sql
-- ✅ CEIL 向上取整
CEIL(4.2)  -- 返回 5

-- ✅ 类型转换
CAST(3.14 AS INTEGER)              -- 返回 3
CAST(123 AS VARCHAR)               -- 返回 '123'
```

---

## 4. 通用验证协议（所有开发必须遵守）

### 4.1 三层验证体系

```
第1层：单元测试（语法验证）
  ↓
第2层：API 接口验证（逻辑验证）
  ↓
第3层：用户验收（体验验证）
```

### 4.2 各层级验证方法

| 层级 | 验证对象 | 工具 | 通过标准 |
|------|----------|------|----------|
| **单元测试** | SQL 生成逻辑、业务函数 | `bun run test` | 所有测试通过 |
| **API 接口验证** | 后端查询执行、API 响应 | Chrome DevTools 网络面板 / curl | 200 OK + 数据格式正确 |
| **用户验收** | 前端交互、仪表盘渲染 | 人工测试 | 用户确认功能正常 |

**全局样式设定（UI开发必用 - DC-003规则）**：
**核心规定：禁止硬编码任何样式变体。必须确保你调用的色块与间距系统全部是由 `@/shared/styles/index.ts` 提供。**
```typescript
// ✅ 正确：导入语义属性组
import { tableStyles, textStyles, buttonStyles, cardStyles, fontStyles, colorClasses, cn } from '@/shared/styles';
import { Card, Badge, Button } from '@/shared/ui';

// ❌ 错误：硬编码 Tailwind 样式组合（且不支持深色模式的严谨切换）
// className="bg-white rounded-lg shadow-sm p-4 text-gray-800"
// ❌ 错误：写入并未暴露于 tailwind theme 中的假定 CSS Class
// className="font-kpi"
```

### 4.3 后端 SQL 验证强制流程

**步骤1：编写单元测试**
```typescript
// tests/xxx.test.ts
it('should generate correct SQL', () => {
  const sql = generateXXXQuery('weekly', '1=1');

  // 验证包含关键字段
  expect(sql).toContain('CAST(policy_date AS DATE)');
  expect(sql).toContain('GROUP BY time_period');

  // 打印 SQL 供人工检查
  console.log('\n=== 生成的SQL ===');
  console.log(sql);
  console.log('================\n');
});
```

**步骤2：运行测试**
```bash
bun run test
```

**步骤3：API 接口验证（CRITICAL）**
1. 启动前后端：`bun run dev:full`
2. 登录获取 JWT Token
3. 使用 **Chrome DevTools 网络面板** 或 curl 验证 API 响应：
   - 检查 API 请求是否返回 200
   - 验证返回 JSON 的数据格式和字段名
   - 确认无 500 错误（后端日志会输出 SQL 错误详情）
4. 前端打开 `http://localhost:5173/`
5. **检查浏览器 Console**：
   - 无红色错误
   - 无 `Failed to fetch` 或 CORS 错误
   - 仪表盘数据正常渲染

**步骤4：记录验证结果**
- 记录 API 响应样本（如前3条数据）
- 截图仪表盘渲染结果
- 在 BACKLOG.md 填写验证/证据字段

### 4.4 禁止自我安慰式开发

**错误做法**：
- 只看测试通过就认为功能正常
- 只看 SQL 语法正确就标记完成
- 猜测 DuckDB 支持某函数而不查文档
- 只启动前端不启动后端就调试数据问题

**正确做法**：
- 单元测试 + API 接口验证 + 用户确认
- 有疑问先查 [DuckDB 官方文档](https://duckdb.org/docs/)
- 复制实际执行结果（而非预期结果）
- 始终使用 `bun run dev:full` 同时启动前后端

---

## 5. 常见陷阱与解决方案

| 陷阱 | 表现 | 根因 | 解决方案 |
|------|------|------|----------|
| **类型不匹配** | `No function matches YEAR(VARCHAR)` | Parquet 日期字段是 VARCHAR | 先 `CAST(field AS DATE)` |
| **ISO 周 ≠ 自然周** | 周编号不符合预期 | `WEEK()` 遵循 ISO 8601 | 自定义计算（DAYOFYEAR + ISODOW） |
| **STRFTIME 格式符** | `%G` `%V` 不支持 | DuckDB 未实现所有格式符 | 查文档，用 CONCAT 拼接 |
| **浏览器缓存** | 代码更新后无变化 | Vite HMR 失效 | 硬刷新（Cmd+Shift+R） |
| **仪表盘显示"--"** | KPI 无数据 | 后端路由不存在或 API 返回 404 | 检查 `server/src/routes/query.ts` 是否有对应端点 |
| **只启动前端** | 所有 API 请求失败 | 后端未启动 | 使用 `bun run dev:full` 同时启动前后端 |
| **API 认证失败** | 401 Unauthorized | JWT Token 过期或缺失 | 检查 localStorage 中 `auth_token`，重新登录 |

---

## 6. 快速决策树

```
修改代码前：
  ├─ 修改 SQL 查询模板？
  │   ├─ ✅ 读取 server/src/sql/ 对应文件（查看查询口径）
  │   ├─ ✅ 读取 server/src/services/duckdb.ts（查看字段类型）
  │   ├─ ✅ 读取 开发文档/TECH_STACK.md SS 3（DuckDB 约束）
  │   └─ ✅ 编写单元测试 → API 接口验证
  │
  ├─ 修改列名映射？
  │   ├─ ✅ 读取 server/src/normalize/mapping.ts
  │   └─ ⚠️  只能追加别名，不得删除已有映射
  │
  ├─ 修改 KPI 计算？
  │   ├─ ✅ 读取 server/src/sql/kpi.ts
  │   └─ ⚠️  只能追加模板，不得修改已有模板
  │
  ├─ 新增/修改 API 路由？
  │   ├─ ✅ 读取 server/src/routes/ 对应文件
  │   ├─ ✅ 确保经过 JWT 认证中间件（server/src/middleware/auth.ts）
  │   └─ ✅ 同步更新前端 API 客户端（src/shared/api/client.ts）
  │
  └─ 修改 React 组件？
      ├─ ✅ 读取 src/features/INDEX.md
      ├─ ⚠️  检查 DC-003（是否包含对颜色、模块阴影尺寸及原生类的硬编码行为？如是，替换为 `import` 集中常量方式）
      └─ ✅ 运行 `bun run dev:full` 前后端联调验证
```

---

## 7. 后端关键目录结构

> **以 [`开发文档/00_index/CODE_INDEX.md`](./00_index/CODE_INDEX.md) 为唯一事实来源**，此处不再维护文件级清单（维护滞后会误导导航）。
>
> 实际规模参考：`server/src/sql/` 含 83 个 .ts 文件（31 顶层 + 子目录拆分），`server/src/routes/query/` 下 25 个子路由文件，`server/src/config/` 含 metric-registry、field-registry、route-param-contracts、preset-users 等核心注册表。导航请用 CODE_INDEX.md。

---

## 8. 协作AI清单

**所有协作AI必须：**
- [ ] 1. 读取本文档了解技术栈约束
- [ ] 2. 修改代码前读取对应的强制入口文件
- [ ] 3. 遵守三层验证体系（单元测试 → API 接口验证 → 用户验收）
- [ ] 4. 禁止自我安慰式开发（必须看实际执行结果）
- [ ] 5. 有疑问先查官方文档，不猜测
- [ ] 6. 始终使用 `bun run dev:full` 同时启动前后端

---

## 9. 协作协议与索引（引用增强）

- 协作总则与交付协议：[`CLAUDE.md`](../CLAUDE.md)
- 文档索引（权威入口）：[`开发文档/00_index/DOC_INDEX.md`](./00_index/DOC_INDEX.md)

---

**维护规则**：
- 新增技术栈 → 更新 SS 1 + SS 3（特定约束） + SS 5（常见陷阱）
- 发现新陷阱 → 补充到 SS 5
- 变更验证流程 → 更新 SS 4
- 新增后端路由 → 补充到 SS 7 目录结构

**变更历史**：
- 2026-04-24：对齐运行时定位为 API-only + DuckDB native；明确后端使用 `@duckdb/node-api` v1.4.4-r.1，前端不运行 DuckDB-WASM / Local 模式。
- 2026-02-13：全面更新为 API-only 模式，移除所有 DuckDB-WASM 引用；更新版本号匹配 package.json（React 19.0.0, TS 5.9.3, Vite 5.4.21, ECharts 5.6.0）；新增后端技术栈（Express 4.18.2, DuckDB 1.1.3, JWT 9.0.2）；更新文件路径引用至 server/ 目录；新增后端目录结构（SS 7）；更新验证协议为 API 接口验证模式
- 2026-01-08：同步 package.json 版本号并补充协作引用入口
- 2026-01-08：创建技术栈声明，记录 DuckDB 验证教训
