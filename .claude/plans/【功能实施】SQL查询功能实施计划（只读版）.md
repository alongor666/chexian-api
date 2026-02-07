# SQL 查询功能实施计划（只读查询版）

## 需求概述

在现有车险销售业绩看板中增加交互式 SQL 查询功能，允许用户输入 SQL 查询 Parquet 数据并查看结果。

**强制约束（必须满足）**
- **只读**：禁止任何写入/修改/导入/导出数据文件，禁止对 DuckDB 数据执行 DDL/DML
- **视图边界**：所有查询只能访问 `PolicyFact` 视图，禁止 `raw_parquet`
- **隐私口径**：禁止单条保单明细（如 `policy_no` 明细查询）
- **单语句**：只允许单条 `SELECT` / `WITH` 语句，不允许多语句执行

**实施范围**：Phase 2（增强版）
- 独立路由页面的 SQL 查询界面
- 预置 8-10 个常用聚合查询模板
- CSV/Excel 数据导出（复用现有导出工具）
- 无权限控制（所有用户访问全量数据）
- 完整安全与资源限制

**预估时间**：5-7 天（54 小时）

---

## 技术架构

### 核心依赖
**已安装**：
- `duckdbClient.query(sql)` - DuckDB 查询方法（Arrow IPC 通信）
- `exceljs@4.4.0` - Excel 导出
- `react-window@1.8.10` - 虚拟表格
- `apache-arrow@17.0.0` - Arrow 数据格式

**需新增**：
```bash
bun add react-router-dom @monaco-editor/react
bun add -D @types/react-router-dom
```

### 文件结构

```
src/
├── app/
│   └── App.tsx                    # MODIFY: 添加路由系统
├── features/
│   ├── dashboard/                 # 现有（不修改）
│   ├── sql-query/                 # NEW - SQL 查询功能模块
│   │   ├── SqlQueryPage.tsx       # 主容器组件
│   │   ├── SqlEditor.tsx          # Monaco 编辑器封装
│   │   ├── QueryResults.tsx       # 结果展示 + 分页
│   │   ├── TemplateLibrary.tsx    # 模板库侧边栏
│   │   ├── useQueryExecutor.ts    # 查询执行 hook
│   │   ├── QUERY_TEMPLATES.ts     # 预置模板定义
│   │   └── README.md              # 功能文档
│   ├── filters/                   # 现有（不修改）
│   └── INDEX.md                   # MODIFY: 添加 sql-query 入口
├── shared/
│   ├── duckdb/
│   │   └── client.ts              # REUSE: query() 方法
│   ├── utils/
│   │   ├── export.ts              # REUSE: CSV/Excel 导出
│   │   ├── security.ts            # EXTEND: 添加查询限制常量
│   │   └── sql-validator.ts       # NEW: SQL 安全验证
│   └── types/
│       └── sql-query.ts           # NEW: TypeScript 类型定义
└── widgets/
    └── table/
        └── VirtualTable.tsx       # REUSE: 虚拟表格组件
```

---

## 实施步骤

### Phase 1: 基础设施搭建（Day 1, 4 小时）

**任务1.1：安装依赖**
```bash
bun add react-router-dom @monaco-editor/react
bun add -D @types/react-router-dom
```

**任务1.2：修改 App.tsx 引入路由**
- 添加 React Router（HashRouter 模式）
- 创建导航栏（业绩看板 | SQL 查询）
- 路由：`/dashboard` → PremiumDashboard, `/sql-query` → SqlQueryPage

**任务1.3：创建目录和类型定义**
- 创建 `src/features/sql-query/` 目录
- 创建 `src/shared/types/sql-query.ts`：
  - `QueryTemplate`：模板数据结构
  - `QueryResult`：查询结果类型
  - `QueryHistoryItem`：历史记录类型

**任务1.4：更新 INDEX.md**
- 在 `src/features/INDEX.md` 追加 sql-query 模块
- 在 `src/shared/INDEX.md` 追加新增工具条目

---

### Phase 2: 只读安全防护层（Day 1-2, 6 小时）

**任务2.1：创建 SQL 验证器（只读 + 口径）**
- 新建 `src/shared/utils/sql-validator.ts`
- 校验策略（均为强制约束）：
  1. **长度限制**：`MAX_SQL_LENGTH = 8000`
  2. **单语句**：禁止 `;`，禁止多语句拼接
  3. **只读语句**：仅允许 `SELECT` / `WITH` 开头
  4. **黑名单**：`CREATE/ALTER/DROP/DELETE/INSERT/UPDATE/TRUNCATE/REPLACE/ATTACH/DETACH/COPY/EXPORT/IMPORT/INSTALL/LOAD/PRAGMA/SET/CALL`
  5. **资源/文件保护**：禁止 `read_parquet/read_csv/copy_to` 等文件操作
  6. **访问边界**：必须引用 `PolicyFact`，禁止 `raw_parquet`
  7. **隐私口径**：禁止选择 `policy_no` 与明显的单条明细投影
  8. **聚合要求**：必须出现聚合函数或 `GROUP BY`

**任务2.2：扩展安全限制常量**
- 在 `src/shared/utils/security.ts` 添加：
  - `MAX_SQL_LENGTH: 8000`
  - `QUERY_TIMEOUT: 30000`
  - `MAX_RESULT_ROWS: 100000`

**任务2.3：单元测试**
- 新建 `tests/sql-validator.test.ts`
- 覆盖：只读限制、单语句、PolicyFact 边界、禁止明细与 raw_parquet

---

### Phase 3: 核心组件开发（Day 2-3, 12 小时）

**任务3.1：useQueryExecutor Hook**
- 创建 `src/features/sql-query/useQueryExecutor.ts`
- 封装查询逻辑：
  - SQL 验证（validateSQL）
  - 查询执行（duckdbClient.query）
  - 超时控制（30 秒，超时后忽略结果）
  - 执行时间统计、错误处理
  - 使用 `startBatch` / `isBatchValid` 丢弃过期请求

**任务3.2：SqlEditor 组件**
- 创建 `src/features/sql-query/SqlEditor.tsx`
- 集成 Monaco Editor（SQL 高亮、行号、快捷键）

**任务3.3：QueryResults 组件**
- 创建 `src/features/sql-query/QueryResults.tsx`
- 复用 `VirtualTable` 展示结果
- 分页控件（50/100/200/500 行/页）
- 元数据：行数、列数、执行时间
- 导出按钮：CSV/Excel（复用 `export.ts`）

**任务3.4：TemplateLibrary 组件**
- 创建 `src/features/sql-query/TemplateLibrary.tsx`
- 侧边栏布局、搜索、分类
- 点击模板加载 SQL

---

### Phase 4: 主页面集成（Day 3-4, 6 小时）

**任务4.1：预置查询模板（聚合 + PolicyFact）**
- 新建 `src/features/sql-query/QUERY_TEMPLATES.ts`
- 所有模板必须聚合、禁止 `policy_no` 与 `raw_parquet`

**分类：KPI（2 个）**
1. 核心 KPI 总览：聚合 KPI 指标
2. 业务员绩效 Top N：按保费排序排名（参数：limit）

**分类：分析（3 个）**
3. 客户类别保费占比（GROUP BY customer_category）
4. 险别组合分析（GROUP BY coverage_combination）
5. 终端来源对比（GROUP BY is_telemarketing）

**分类：趋势（2 个）**
6. 每日保费趋势（GROUP BY policy_date）
7. 月度保费汇总（按年月聚合）

**分类：示例（1 个）**
8. 自定义条件示例（带 WHERE 过滤）

**任务4.2：SqlQueryPage 容器组件**
- 创建 `src/features/sql-query/SqlQueryPage.tsx`
- 维护查询状态（SQL、结果、错误、加载）
- 左侧模板库 + 右侧编辑器与结果区

**任务4.3：数据加载状态**
- 与 Dashboard 共享 `isInitialized` 状态（Context/Store）
- 未加载数据时，展示引导提示

---

### Phase 5: 优化与打磨（Day 4-5, 10 小时）

**任务5.1：错误处理 UI**
- SQL 校验失败：清晰错误提示
- 查询超时：提示优化 SQL
- 数据未加载：上传引导

**任务5.2：性能优化**
- Monaco 懒加载
- 客户端分页（默认 100 行）
- 相同 SQL 结果缓存（可选）

**任务5.3：UI/UX**
- Tailwind 与现有风格一致
- 响应式布局
- 加载状态动画

---

### Phase 6: 测试验证（Day 5-6, 8 小时）

**任务6.1：单元测试**
```bash
bun run test tests/sql-validator.test.ts
```

**任务6.2：浏览器实测**
- 正常聚合查询：`SELECT salesman_name, SUM(premium) FROM PolicyFact GROUP BY salesman_name LIMIT 100`
- 禁止语句：`DROP TABLE PolicyFact` / `SELECT * FROM raw_parquet`
- 大结果集分页检查（10k+ 行）

**任务6.3：集成测试**
- 导航 → 模板 → 执行 → 导出
- SQL 查询页与 Dashboard 切换

---

### Phase 7: 文档更新（Day 6-7, 4 小时）

**任务7.1：功能文档**
- 创建 `src/features/sql-query/README.md`

**任务7.2：治理回写**
- 更新 `src/features/INDEX.md`（只追加条目）
- 更新 `src/shared/INDEX.md`（只追加条目）
- 更新 `BACKLOG.md` / `PROGRESS.md` 证据链

---

## 关键文件清单

### 新建文件（9 个）

| 文件路径 | 职责 |
|---------|------|
| `src/features/sql-query/SqlQueryPage.tsx` | 主容器 |
| `src/features/sql-query/SqlEditor.tsx` | 编辑器封装 |
| `src/features/sql-query/QueryResults.tsx` | 结果 + 分页 + 导出 |
| `src/features/sql-query/TemplateLibrary.tsx` | 模板库 |
| `src/features/sql-query/useQueryExecutor.ts` | 查询执行 Hook |
| `src/features/sql-query/QUERY_TEMPLATES.ts` | 预置模板 |
| `src/shared/utils/sql-validator.ts` | SQL 只读验证 |
| `src/shared/types/sql-query.ts` | 类型定义 |
| `src/features/sql-query/README.md` | 文档 |

### 修改文件（5 个）

| 文件路径 | 修改内容 |
|---------|---------|
| `src/app/App.tsx` | 路由与导航 |
| `src/features/INDEX.md` | 追加 sql-query 入口 |
| `src/shared/INDEX.md` | 追加 utils/types 条目 |
| `src/shared/utils/security.ts` | 只读查询限制常量 |
| `BACKLOG.md` | 任务状态与证据 |

---

## 只读安全策略（最佳实践）

### SQL 允许范围
- 仅 `SELECT` / `WITH`
- 必须使用 `PolicyFact`
- 必须聚合（含 `GROUP BY` 或聚合函数）
- 禁止 `policy_no` 明细字段

### SQL 禁止清单
- DDL/DML：`CREATE/ALTER/DROP/DELETE/INSERT/UPDATE/TRUNCATE/REPLACE`
- 连接与扩展：`ATTACH/DETACH/INSTALL/LOAD`
- 文件与导入导出：`COPY/EXPORT/IMPORT/read_csv/read_parquet/write_parquet`
- 系统级：`PRAGMA/SET/CALL`

### 资源限制
- 单次查询最大 30 秒
- 结果行数超过 100k 给出提示
- 结果渲染默认分页

---

## 验收标准（只读 + 口径）

### 功能完整性
- [ ] 可通过导航栏进入 SQL 页面
- [ ] 编辑器正常工作（高亮、快捷键）
- [ ] 预置模板可执行且均为聚合查询
- [ ] 结果表格分页、导出正常

### 安全性
- [ ] 任何 DDL/DML/文件操作 SQL 被拦截
- [ ] `raw_parquet` 与 `policy_no` 明细被拦截
- [ ] 仅允许 `PolicyFact` 聚合查询

### 性能与质量
- [ ] 简单聚合 <2s
- [ ] 复杂聚合 <5s
- [ ] TypeScript 编译无错误
- [ ] 现有测试通过

---

## 实施前提条件

1. **数据已加载**：用户先上传 Parquet 以建立 `PolicyFact` 视图
2. **浏览器兼容**：推荐 Chrome/Edge
3. **开发环境**：Node.js 18+，Bun 1.0+

---

## 总结

本计划以“只读查询 + 业务口径保护”为最高优先级，严格限制 SQL 语句的范围和访问边界，确保不会修改或导入数据文件，并与现有 DuckDB + Arrow 架构保持一致，符合当前项目治理与最佳实践要求。
