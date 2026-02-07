# 技术栈声明与验证协议

**唯一事实来源**：本文档定义项目技术栈、架构约束、验证方法。所有AI协作者必须先读本文档。

---

## 1. 技术栈核心依赖（CRITICAL）

### 1.1 前端技术栈
```
React 18.3.1          - UI 框架
TypeScript 5.5.3      - 类型系统
Vite 5.4.1            - 构建工具
Tailwind CSS 3.4.4   - 样式框架
ECharts 5.5.0         - 图表库
```

### 1.2 数据分析引擎（⚠️ 特殊约束）
```
DuckDB-WASM 1.28.0    - 浏览器内 SQL 引擎
Apache Arrow 17.0.0   - 内存数据格式
```

**关键约束**：
- ❌ DuckDB 不是 PostgreSQL/MySQL，语法有差异
- ❌ SQL 在浏览器中执行，无法用后端工具测试
- ✅ 必须用 **Chrome DevTools Console** 验证 SQL 执行结果
- ✅ 字段类型在 `src/shared/duckdb/client.ts:78-95` PolicyFact 视图定义

### 1.3 测试框架
```
Vitest 2.0.5          - 单元测试
```

---

## 2. 架构强制入口（开发前必读）

### 规则：修改任何层级代码前，必须先读对应文件

| 修改内容 | 必须先读的文件 | 原因 |
|----------|----------------|------|
| **SQL 查询生成** | `src/shared/duckdb/client.ts:78-95` | 查看 PolicyFact 视图字段定义（类型、去重规则） |
| **日期时间处理** | `开发文档/TECH_STACK.md` § 3.1 | DuckDB 日期函数与标准 SQL 差异 |
| **数据映射** | `src/shared/normalize/mapping.ts` | 列名别名规则（不可删除已有映射） |
| **KPI 计算** | `src/shared/sql/kpi.ts` | 指标口径定义（不可修改已有模板） |
| **React 组件** | `src/features/INDEX.md` | 组件职责边界 |
| **图表配置** | `src/widgets/charts/README.md` | ECharts 配置规范 |

**违反后果**：
- 类型不匹配（如 `YEAR(VARCHAR)` 报错）
- 业务逻辑错误（如使用 ISO 周而非自然周）
- 数据重复或缺失（如破坏去重规则）

---

## 3. DuckDB 特定约束（CRITICAL）

### 3.1 日期时间处理

**字段类型约束**：
```sql
-- PolicyFact 视图中日期字段是 VARCHAR 类型（来自 Parquet 文件）
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
第2层：浏览器实测（逻辑验证）
  ↓
第3层：用户验收（体验验证）
```

### 4.2 各层级验证方法

| 层级 | 验证对象 | 工具 | 通过标准 |
|------|----------|------|----------|
| **单元测试** | SQL 生成逻辑 | `bun test` | 所有测试通过 |
| **浏览器实测** | SQL 执行结果 | Chrome DevTools | Console 无错误 + 数据格式正确 |
| **用户验收** | 前端交互 | 人工测试 | 用户确认功能正常 |

### 4.3 DuckDB SQL 验证强制流程

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
bun test
```

**步骤3：浏览器验证（CRITICAL）**
1. 启动开发服务器：`bun run dev`
2. 打开 `http://localhost:5173/`
3. **打开 Chrome DevTools**（F12 或 Cmd+Option+I）
4. 切换到 **Console** 标签页
5. 上传数据文件
6. 触发目标功能（如切换周/月视图）
7. **检查 Console 输出**：
   - ❌ 如有红色错误 → 复制完整错误信息
   - ✅ 查看 `[Trend Data]` 日志，验证字段格式
   - ✅ 检查 `time_period` 等关键字段的**实际值**

**步骤4：记录验证结果**
- 截图 Console 输出
- 记录关键字段样本（如前3条数据）
- 在 BACKLOG.md 填写验证/证据字段

### 4.4 禁止自我安慰式开发

**❌ 错误做法**：
- 只看测试通过就认为功能正常
- 只看 SQL 语法正确就标记完成
- 猜测 DuckDB 支持某函数而不查文档

**✅ 正确做法**：
- 单元测试 + 浏览器实测 + 用户确认
- 有疑问先查 [DuckDB 官方文档](https://duckdb.org/docs/)
- 复制实际执行结果（而非预期结果）

---

## 5. 常见陷阱与解决方案

| 陷阱 | 表现 | 根因 | 解决方案 |
|------|------|------|----------|
| **类型不匹配** | `No function matches YEAR(VARCHAR)` | PolicyFact 字段是 VARCHAR | 先 `CAST(field AS DATE)` |
| **ISO 周 ≠ 自然周** | 周编号不符合预期 | `WEEK()` 遵循 ISO 8601 | 自定义计算（DAYOFYEAR + ISODOW） |
| **STRFTIME 格式符** | `%G` `%V` 不支持 | DuckDB 未实现所有格式符 | 查文档，用 CONCAT 拼接 |
| **浏览器缓存** | 代码更新后无变化 | Vite HMR 失效 | 硬刷新（Cmd+Shift+R） |

---

## 6. 快速决策树

```
修改代码前：
  ├─ 修改 SQL 生成逻辑？
  │   ├─ ✅ 读取 client.ts:78-95（查看字段类型）
  │   ├─ ✅ 读取 开发文档/TECH_STACK.md § 3（DuckDB 约束）
  │   └─ ✅ 编写单元测试 → 浏览器验证
  │
  ├─ 修改数据映射？
  │   ├─ ✅ 读取 src/shared/normalize/mapping.ts
  │   └─ ⚠️  只能追加别名，不得删除已有映射
  │
  ├─ 修改 KPI 计算？
  │   ├─ ✅ 读取 src/shared/sql/kpi.ts
  │   └─ ⚠️  只能追加模板，不得修改已有模板
  │
  └─ 修改 React 组件？
      ├─ ✅ 读取 src/features/INDEX.md
      └─ ✅ 运行 `bun run dev` 热重载验证
```

---

## 7. 协作AI清单

**所有协作AI必须：**
- [ ] 1. 读取本文档了解技术栈约束
- [ ] 2. 修改代码前读取对应的强制入口文件
- [ ] 3. 遵守三层验证体系（单元测试 → 浏览器实测 → 用户验收）
- [ ] 4. 禁止自我安慰式开发（必须看实际执行结果）
- [ ] 5. 有疑问先查官方文档，不猜测

---

## 8. 协作协议与索引（引用增强）

- 协作总则与交付协议：[`CLAUDE.md`](../CLAUDE.md)
- 多智能体权限边界：[`AGENTS.md`](../AGENTS.md)
- Gemini 协作入口与偏好：[`GEMINI.md`](../GEMINI.md)
- 文档索引（权威入口）：[`开发文档/00_index/DOC_INDEX.md`](./00_index/DOC_INDEX.md)

---

**维护规则**：
- 新增技术栈 → 更新 § 1 + § 3（特定约束） + § 5（常见陷阱）
- 发现新陷阱 → 补充到 § 5
- 变更验证流程 → 更新 § 4

**变更历史**：
- 2026-01-08：同步 package.json 版本号并补充协作引用入口
- 2026-01-08：创建技术栈声明，记录 DuckDB 验证教训
