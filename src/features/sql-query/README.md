## SQL 查询功能

交互式 SQL 查询功能,允许用户通过 SQL 语句查询 Parquet 数据并查看结果。

### 功能特性

- **只读查询**: 仅支持 SELECT/WITH 语句,禁止任何数据修改操作
- **安全边界**: 只能访问 PolicyFact/PolicyFactRenewal 视图,禁止访问原始数据表
- **聚合要求**: 强制包含聚合函数或 GROUP BY,禁止单条明细查询
- **隐私保护**: 禁止查询 policy_no 等保单明细字段
- **参数化查询**: 支持动态参数输入,自动防止 SQL 注入
- **防重复筛选**: 参数自动继承全局筛选器,避免重复过滤
- **预置模板**: 提供 17 个常用查询模板,分为 7 大类(KPI、分析、趋势、示例、增长分析、达成分析、续保分析)
- **Monaco 编辑器**: SQL 语法高亮、智能补全（字段/函数/关键字）、快捷键(Ctrl+Enter 执行、Ctrl+Space 补全)
- **结果展示**: 虚拟表格+分页+导出(CSV/Excel)
- **超时控制**: 30秒查询超时保护
- **批次管理**: 自动丢弃过期查询结果

### 核心组件

#### SqlQueryPage.tsx
主容器组件,整合编辑器、模板库、结果展示

```tsx
// 使用示例
import { SqlQueryPage } from './SqlQueryPage';

function App() {
  return <SqlQueryPage />;
}
```

#### useQueryExecutor.ts
查询执行 Hook,封装验证、执行、超时控制

```tsx
const { result, status, error, executeQuery } = useQueryExecutor();

executeQuery('SELECT COUNT(*) FROM PolicyFact');
```

#### SqlEditor.tsx
Monaco 编辑器封装,SQL 高亮+快捷键（基础版）

```tsx
<SqlEditor
  value={sql}
  onChange={setSql}
  onExecute={handleExecute}
/>
```

#### EnhancedSqlEditor.tsx
增强版 Monaco 编辑器，集成智能补全功能

```tsx
<EnhancedSqlEditor
  value={sql}
  onChange={setSql}
  onExecute={handleExecute}
/>
```

**智能补全特性**:
- **字段补全**: PolicyFact/PolicyFactRenewal 视图的所有字段（含类型和注释）
- **函数补全**: SQL 聚合函数（SUM、COUNT、AVG 等）、日期函数、字符串函数、数学函数
- **关键字补全**: SQL 关键字（SELECT、FROM、WHERE、GROUP BY 等）
- **上下文感知**: 根据当前光标位置提供不同类型的补全建议
- **快捷键**: Ctrl+Space 触发补全，Tab 接受建议

#### useSqlAutocomplete.ts
SQL 自动补全 Hook，为 Monaco 编辑器注册自定义补全提供器

```tsx
const { } = useSqlAutocomplete(monaco);
```

**补全内容**:
- 15 个 PolicyFact 字段 + 2 个 PolicyFactRenewal 专属字段
- 5 个聚合函数 + 7 个日期函数 + 5 个字符串函数 + 4 个数学函数
- 20+ 个 SQL 关键字

#### QueryResults.tsx
结果展示组件,分页+导出

```tsx
<QueryResults result={result} />
```

#### TemplateLibrary.tsx
预置模板库侧边栏,支持 7 大类 17 个模板

```tsx
<TemplateLibrary onSelectTemplate={handleSelect} />
```

#### ParameterForm.tsx
参数化查询表单,动态渲染参数输入控件

```tsx
<ParameterForm
  template={selectedTemplate}
  globalFilters={globalFilters}
  onGenerate={handleGenerate}
  onCancel={handleCancel}
/>
```

**支持的参数类型**:
- `date`: 日期选择器
- `daterange`: 日期范围选择器
- `number`: 数字输入框(支持最小/最大值验证)
- `text`: 文本输入框(支持正则验证)
- `select`: 单选下拉框(静态或动态选项)
- `multiselect`: 多选下拉框

**防重复筛选机制**:
- 参数配置 `globalFilterKey` 字段映射到全局筛选器
- 若全局筛选器已有值,参数自动隐藏并继承该值
- 用户手动输入的参数优先级高于全局筛选器

### SQL 安全验证

#### 验证规则 (sql-validator.ts)

1. **长度限制**: 最大 8000 字符
2. **单语句**: 禁止 `;` 分隔的多语句
3. **只读**: 仅允许 SELECT/WITH 开头
4. **黑名单**: 禁止 CREATE/ALTER/DROP/DELETE/INSERT/UPDATE 等
5. **文件保护**: 禁止 read_parquet/read_csv/copy_to 等文件操作
6. **访问边界**: 必须引用 PolicyFact 或 PolicyFactRenewal,禁止 raw_parquet
7. **隐私口径**: 禁止 SELECT 子句中的 policy_no 字段
8. **聚合要求**: 必须包含聚合函数或 GROUP BY

#### 示例

```typescript
// ✅ 有效查询
validateSQL(`
  SELECT
    salesman_name,
    SUM(premium) as total_premium
  FROM PolicyFact
  GROUP BY salesman_name
`); // { valid: true }

// ❌ 无效查询:禁止修改
validateSQL('DELETE FROM PolicyFact');
// { valid: false, error: '只允许 SELECT 或 WITH 查询语句' }

// ❌ 无效查询:禁止明细
validateSQL('SELECT * FROM PolicyFact');
// { valid: false, error: '查询必须包含聚合函数...' }

// ❌ 无效查询:禁止 policy_no
validateSQL('SELECT policy_no, SUM(premium) FROM PolicyFact GROUP BY policy_no');
// { valid: false, error: '禁止查询保单明细字段 policy_no' }
```

### 预置查询模板

#### KPI 类 (2个)
1. **核心 KPI 总览**: 汇总保费、保单数、业务员数
2. **业务员绩效 Top 10**: 按保费排序的业务员排名

#### 分析类 (3个)
3. **客户类别保费占比**: 按客户类别统计
4. **险别组合分析**: 统计不同险别组合
5. **终端来源对比**: 电销 vs 非电销

#### 趋势类 (2个)
6. **每日保费趋势**: 按日期统计(最近90天)
7. **月度保费汇总**: 按年月统计(最近12月)

#### 示例类 (4个) - 参数化查询示例
8. **自定义过滤示例**: 演示 WHERE 条件用法
9. **业务员绩效 Top N**: 参数化 Top N 查询,支持日期范围筛选
10. **分机构保费统计**: 参数化机构选择,支持单机构或多机构对比
11. **多维度交叉分析**: 参数化维度选择,支持客户类别、险别组合、终端来源等

#### 增长分析类 (2个)
12. **同比增长率（签单口径）**: 基于 policy_date 计算分机构年度同比增长率
13. **同比增长率（起保口径）**: 基于 insurance_start_date 计算分机构年度同比增长率

#### 达成分析类 (2个)
14. **分机构目标达成率**: 对比实际保费与 2026 年目标值,计算达成率
15. **分业务员目标达成率**: 对比业务员实际保费与个人目标值,计算达成率

#### 续保分析类 (2个)
16. **分机构续保率统计**: 按机构统计续保率,基于 PolicyFactRenewal 视图
17. **月度续保率趋势**: 按月统计续保率变化趋势,支持同比对比

### 安全限制常量

```typescript
// src/shared/utils/security.ts
MAX_SQL_LENGTH: 8000        // SQL 最大长度(字符)
QUERY_TIMEOUT: 30000        // 查询超时(毫秒)
MAX_RESULT_ROWS: 100000     // 最大结果行数
```

### 类型定义

```typescript
// src/shared/types/sql-query.ts

// 查询分类
type QueryCategory = 'KPI' | '分析' | '趋势' | '示例' | '增长分析' | '达成分析' | '续保分析';

// 参数类型
type ParameterType = 'date' | 'daterange' | 'select' | 'multiselect' | 'number' | 'text';

// 参数定义
interface QueryParameter {
  name: string;                    // 参数名(用于 SQL 占位符)
  label: string;                   // 显示标签
  type: ParameterType;             // 参数类型
  required: boolean;               // 是否必填
  defaultValue?: any;              // 默认值

  // 防重复筛选
  inheritsGlobalFilter?: boolean;  // 是否继承全局筛选器(默认 true)
  globalFilterKey?: string;        // 全局筛选器键名映射
  overrideWarning?: string;        // 覆盖全局筛选器时的警告提示

  // 选项配置(select/multiselect)
  options?: Array<{ label: string; value: string | number }>;
  dynamicOptions?: {
    query: string;                 // 动态加载选项的 SQL 查询
    valueColumn: string;           // 值字段
    labelColumn?: string;          // 标签字段(可选)
  };

  // 验证规则
  validation?: {
    min?: number;                  // 最小值(number)
    max?: number;                  // 最大值(number)
    pattern?: string;              // 正则表达式(text)
    errorMessage?: string;         // 验证失败提示
  };

  helpText?: string;               // 帮助文本
}

// 查询模板
interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: QueryCategory;
  sql: string | ((params: Record<string, any>, globalFilters?: any) => string);
  parameters?: QueryParameter[];   // 参数定义(可选)
}

// 查询结果
interface QueryResult {
  data: Table | null;        // Arrow Table 数据
  rowCount: number;
  columnCount: number;
  executionTime: number;     // 毫秒
  status: QueryStatus;       // 'idle' | 'running' | 'success' | 'error'
  error?: string;
  sql: string;
  timestamp: number;
}
```

### 导航路由

功能通过 React Router 集成到应用中:

- **路由路径**: `/sql-query`
- **导航栏**: App.tsx 顶部导航(业绩看板 | SQL 查询)
- **默认路由**: `/` 重定向到 `/dashboard`

### 数据流

```
用户选择模板 / 输入 SQL
  ↓
┌─────────────────────────────┐
│ 是否为参数化模板?           │
└─────────────────────────────┘
  ↓ Yes                ↓ No
ParameterForm      直接加载 SQL
(参数输入表单)          ↓
  ↓                SqlEditor (Monaco 编辑器)
templateEngine            ↓
(生成 SQL)          useQueryExecutor Hook
  ↓                     ↓
SqlEditor           validateSQL (安全验证)
  ↓                     ↓
useQueryExecutor    duckdbClient.query (执行查询)
  ↓                     ↓
validateSQL         Arrow Table 结果
  ↓                     ↓
duckdbClient.query  QueryResults (虚拟表格 + 分页)
  ↓                     ↓
Arrow Table 结果    导出 CSV/Excel
  ↓
QueryResults
  ↓
导出 CSV/Excel
```

### 使用流程

1. **加载数据**: 在业绩看板页面上传 Parquet 文件
2. **切换到 SQL 查询页**: 点击顶部导航栏 "SQL 查询"
3. **选择模板**: 从左侧模板库选择预置查询
   - **静态模板**: 直接加载到编辑器
   - **参数化模板**: 弹出参数表单,填写参数后生成 SQL
4. **填写参数** (仅参数化模板):
   - 输入所需参数(日期、数字、选项等)
   - 部分参数可能已继承全局筛选器(自动隐藏)
   - 点击 "生成 SQL" 按钮
5. **执行查询**: 点击 "执行查询" 或按 Ctrl+Enter (Mac: Cmd+Enter)
6. **查看结果**: 结果以虚拟表格展示,支持分页浏览
7. **导出数据**: 点击 "导出 CSV" 或 "导出 Excel" 按钮

### 测试覆盖

#### 单元测试 (tests/sql-validator.test.ts)

- ✅ 基础约束:空SQL、长度限制、多语句
- ✅ 只读限制:禁止 DDL/DML/文件操作
- ✅ 访问边界:必须 PolicyFact/PolicyFactRenewal,禁止 raw_parquet
- ✅ 隐私保护:禁止 policy_no 明细
- ✅ 聚合要求:必须包含聚合或 GROUP BY
- ✅ 真实查询:KPI、TopN、趋势等场景

#### 单元测试 (tests/template-engine.test.ts)

- ✅ SQL 值转义:NULL、数字、布尔、字符串、数组、日期
- ✅ SQL 注入防护:单引号转义、特殊字符处理
- ✅ 占位符插值:{{variable}}、{{#if}}、{{#unless}}
- ✅ 参数验证:必填字段、数字范围、日期格式、正则、选项白名单
- ✅ 全局筛选器继承:globalFilterKey 映射
- ✅ 端到端生成:完整 SQL 生成流程

运行测试:
```bash
bun test tests/sql-validator.test.ts
bun test tests/template-engine.test.ts
# 或运行所有测试
bun test
```

### 注意事项

1. **数据依赖**: 需先在业绩看板页面加载 Parquet 数据,才能执行查询
2. **只读模式**: 所有查询仅读取数据,不会修改任何数据
3. **聚合要求**: 必须使用聚合函数(SUM/COUNT/AVG/...)或 GROUP BY
4. **性能建议**: 复杂查询建议添加 LIMIT 限制结果行数
5. **超时处理**: 查询超过 30 秒会自动超时,建议优化 SQL

### 参数化查询详解

#### 模板语法 (Handlebars 风格)

参数化查询使用 `{{}}` 占位符语法:

```sql
-- 基础占位符
SELECT * FROM PolicyFact WHERE salesman_name = {{salesman_name}}

-- 条件语句
{{#if date_from}}
WHERE policy_date >= {{date_from}}
{{/if}}

-- 反向条件
{{#unless exclude_telemarketing}}
AND terminal_source != '电销'
{{/unless}}

-- 嵌套条件
{{#if date_from}}
WHERE policy_date >= {{date_from}}
  {{#if date_to}}
  AND policy_date <= {{date_to}}
  {{/if}}
{{/if}}
```

#### 参数定义示例

```typescript
{
  id: 'param-example',
  name: '业务员绩效 Top N',
  category: '示例',
  parameters: [
    {
      name: 'top_n',
      label: 'Top N 数量',
      type: 'number',
      required: true,
      defaultValue: 10,
      validation: { min: 1, max: 100 },
      helpText: '返回前 N 名业务员'
    },
    {
      name: 'date_from',
      label: '开始日期',
      type: 'date',
      required: false,
      defaultValue: '2026-01-01',
      globalFilterKey: 'dateRange.start', // 继承全局筛选器
      inheritsGlobalFilter: true
    },
    {
      name: 'org_list',
      label: '机构选择',
      type: 'multiselect',
      required: false,
      dynamicOptions: {
        query: 'SELECT DISTINCT org_level_3 FROM PolicyFact ORDER BY org_level_3',
        valueColumn: 'org_level_3'
      }
    }
  ],
  sql: `
    SELECT salesman_name, SUM(premium) as total_premium
    FROM PolicyFact
    WHERE 1=1
      {{#if date_from}}AND policy_date >= {{date_from}}{{/if}}
      {{#if date_to}}AND policy_date <= {{date_to}}{{/if}}
      {{#if org_list}}AND org_level_3 IN ({{org_list}}){{/if}}
    GROUP BY salesman_name
    ORDER BY total_premium DESC
    LIMIT {{top_n}}
  `
}
```

#### 安全特性

1. **自动值转义**: 所有参数值自动转义,防止 SQL 注入
   ```typescript
   // 用户输入: '; DROP TABLE users; --
   // 转义后: '''; DROP TABLE users; --'
   ```

2. **类型验证**: 根据参数定义自动验证类型和范围
   ```typescript
   validation: { min: 1, max: 100 }  // 数字范围
   validation: { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }  // 正则验证
   ```

3. **选项白名单**: select/multiselect 只能选择预定义选项
   ```typescript
   options: [
     { label: '客户A类', value: 'A' },
     { label: '客户B类', value: 'B' }
   ]
   ```

#### 防重复筛选机制

当全局筛选器已设置某个维度时,参数表单会自动隐藏对应参数:

```typescript
// 全局筛选器状态
globalFilters = {
  dateRange: { start: '2026-01-01', end: '2026-12-31' },
  selectedOrgs: ['成都市分公司', '宜宾市中心支公司']
};

// 参数定义
parameters: [
  {
    name: 'date_from',
    globalFilterKey: 'dateRange.start',  // 映射到全局筛选器
    inheritsGlobalFilter: true           // 自动继承
  }
];

// 结果: date_from 参数在表单中隐藏,自动使用 '2026-01-01'
```

**优先级**: 用户手动输入的参数 > 全局筛选器

#### 动态选项加载

支持通过 SQL 查询动态加载下拉框选项:

```typescript
{
  name: 'salesman_list',
  type: 'multiselect',
  dynamicOptions: {
    query: `
      SELECT DISTINCT salesman_name
      FROM PolicyFact
      WHERE org_level_3 = '成都市分公司'
      ORDER BY salesman_name
    `,
    valueColumn: 'salesman_name',
    labelColumn: 'salesman_name'  // 可选,默认同 valueColumn
  }
}
```

### 相关文件

- 验证器: `src/shared/utils/sql-validator.ts`
- 模板引擎: `src/shared/utils/templateEngine.ts` (参数化查询核心)
- 类型定义: `src/shared/types/sql-query.ts`
- 安全常量: `src/shared/utils/security.ts`
- 预置模板: `src/features/sql-query/QUERY_TEMPLATES.ts`
- 目标数据: `src/shared/data/targets-2026.ts` (达成分析用)
- 参数表单: `src/features/sql-query/ParameterForm.tsx`
- 路由配置: `src/app/App.tsx`
- 单元测试: `tests/sql-validator.test.ts`, `tests/template-engine.test.ts`

### 已知限制

1. **WITH 子句**: 暂不支持复杂 CTE 嵌套验证
2. **子查询**: 复杂子查询可能无法精确检测 policy_no
3. **函数调用**: 自定义函数未在黑名单中,需人工审核
4. **结果行数**: 建议使用 LIMIT 限制结果,避免浏览器卡顿

### 未来增强

- [x] 参数化查询支持 (✅ 已完成)
- [x] 查询分类扩展 (✅ 已完成:增长/达成/续保分析)
- [x] 防重复筛选机制 (✅ 已完成)
- [ ] 全局筛选器集成 (前端集成待完成)
- [ ] 查询历史记录保存
- [ ] SQL 格式化工具
- [ ] 查询结果可视化(自动生成图表)
- [ ] 查询性能分析(EXPLAIN)
- [ ] 多用户查询隔离
- [ ] 查询权限控制

---

**文档版本**: 2.0.0
**最后更新**: 2026-01-10
**负责人**: @claude
**更新日志**:
- v2.0.0 (2026-01-10):
  - 新增参数化查询支持 (ParameterForm + templateEngine)
  - 扩展查询分类至 7 大类 (新增增长分析、达成分析、续保分析)
  - 新增 9 个模板 (总计 17 个)
  - 支持 PolicyFactRenewal 视图
  - 实现防重复筛选机制
  - 新增 targets-2026.ts 目标数据管理
  - 新增 30 个模板引擎单元测试
- v1.0.0 (2026-01-08): 初始版本,基础 SQL 查询功能
