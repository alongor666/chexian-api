# UI显示与SQL智能生成增强计划

## 📋 需求概述

1. **统一数字格式化**: 保费使用万元单位并取整（123万），率值占比使用1位小数（12.3%）
2. **玫瑰图防重叠**: 通用防重叠方案，支持多种业务场景（客户类别、来源、机构等）
3. **SQL智能生成**: 自然语言转SQL + 智能提示补全 + 预设查询模板

---

## 🎯 实施方案

### 一、统一数字格式化系统 (P0 - Week 1)

#### 1.1 创建全局格式化工具模块

**新建文件**: `/src/shared/utils/formatters.ts`

**核心API**:
```typescript
// 保费格式化（万元单位，取整）
export function formatPremium(value: number): string {
  return Math.round(value / 10000).toLocaleString() + '万';
}

// 率值格式化（1位小数）
export function formatRate(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

// ECharts Y轴格式化器
export function yAxisPremiumFormatter(value: number): string {
  return formatPremium(value);
}
```

**测试文件**: `/src/tests/formatters.test.ts`
- 边界值测试（0, NaN, Infinity）
- 精度测试（四舍五入）
- 千分位分隔符测试

#### 1.2 迁移现有图表组件

**需要更新的组件**:
- `/src/widgets/charts/LineChart.tsx` - 替换 `(val/10000).toFixed(1)+'万'` → `formatPremium(val)`
- `/src/widgets/charts/BarChart.tsx` - 添加格式化支持
- `/src/widgets/charts/RoseChart.tsx` - 使用 `formatRate` 格式化百分比
- `/src/charts/BubbleChart.ts` - 更新 `formatValue` 方法
- `/src/features/dashboard/PremiumDashboard.tsx` - 替换现有的 `fmtMoney/fmtPct`

**迁移示例** (LineChart.tsx):
```typescript
// 修改前
yAxis: [{
  axisLabel: {
    formatter: (value: number) => (value / 10000).toFixed(1) + '万'
  }
}]

// 修改后
import { formatPremium } from '../../shared/utils/formatters';

yAxis: [{
  axisLabel: {
    formatter: formatPremium
  }
}]
```

---

### 二、玫瑰图防重叠策略 (P1 - Week 1-2)

#### 2.1 增强RoseChart组件

**目标文件**: `/src/widgets/charts/RoseChart.tsx`

**核心配置**:
```typescript
interface RoseChartProps {
  preventOverlap?: boolean;  // 启用防重叠
  minAngle?: number;         // 最小扇区角度（默认5度）
  labelLineLength?: number;  // 标签引线长度（默认15）
}

// 防重叠策略实现
series: [{
  type: 'pie',
  roseType: 'radius',

  // 标签引线配置
  label: {
    show: true,
    position: 'outer',      // 外部标签
    alignTo: 'edge',        // 对齐到边缘
    distance: labelLineLength,
    fontSize: data.length > 15 ? 10 : 12,  // 动态字体
    formatter: (params) => {
      // 小扇区隐藏标签
      if (params.angle < minAngle) return '';
      return `${params.name}\n${params.percent}%`;
    }
  },

  // 标签引线
  labelLine: {
    show: preventOverlap,
    length: labelLineLength,
    length2: 10,
    smooth: true,           // 平滑曲线
  },

  // 数据预处理：聚合小扇区
  data: preprocessSmallSlices(data, minAngle)
}]
```

**小扇区聚合函数**:
```typescript
function preprocessSmallSlices(data, minAngle) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const minAngleRad = (minAngle * Math.PI) / 180;
  const minValue = total * minAngleRad / (2 * Math.PI);

  const bigSlices = data.filter(item => item.value >= minValue);
  const smallSlices = data.filter(item => item.value < minValue);

  if (smallSlices.length === 0) return data;

  const othersValue = smallSlices.reduce((sum, item) => sum + item.value, 0);
  return [...bigSlices, { name: '其他', value: othersValue }];
}
```

**策略选择逻辑**:
- 扇区数 ≤ 8: 内部标签 + 动态字体
- 扇区数 9-15: 外部标签 + 引线
- 扇区数 16-20: 外部标签 + 引线 + 小扇区隐藏
- 扇区数 > 20: 外部标签 + 引线 + 小扇区聚合

---

### 三、SQL智能生成系统 (P0 - Week 2-3)

#### 3.1 自然语言转SQL（NL2SQL）

**技术方案**: 混合策略（规则引擎 80% + LLM 20%）

##### 3.1.1 规则引擎实现

**新建文件**: `/src/features/sql-query/ruleEngine/patterns.ts`

**核心逻辑**:
```typescript
export const PATTERN_RULES = [
  {
    id: 'trend-daily',
    pattern: /(?:最近)?(\d+)?(?:天|日)(?:的)?(.+?)?(?:趋势|走势)/,
    template: (entities) => `
      SELECT
        CAST(policy_date AS DATE) as date,
        ${entities.metric || 'SUM(premium)'} as value
      FROM PolicyFact
      WHERE policy_date >= CURRENT_DATE - INTERVAL ${entities.days || 30} DAY
      GROUP BY CAST(policy_date AS DATE)
      ORDER BY date DESC
    `
  },
  {
    id: 'topn-salesmen',
    pattern: /(?:保费|业绩)?(?:最高|最好|top|Top)(\d+)?(?:个)?(?:的)?业务员/,
    template: (entities) => `
      SELECT
        salesman_name,
        COUNT(*) as policy_count,
        SUM(premium) as total_premium
      FROM PolicyFact
      GROUP BY salesman_name
      ORDER BY total_premium DESC
      LIMIT ${entities.limit || 10}
    `
  },
  // ... 更多规则
];
```

##### 3.1.2 NL2SQL Hook

**新建文件**: `/src/features/sql-query/useNL2SQL.ts`

```typescript
export function useNL2SQL(options: { llmApiKey?: string }) {
  const convertToSQL = async (input: string) => {
    // 策略1: 规则引擎
    const ruleBasedSql = generateSqlFromRules(input);
    if (ruleBasedSql && validateSQL(ruleBasedSql).valid) {
      return { sql: ruleBasedSql, method: 'rule', confidence: 'high' };
    }

    // 策略2: LLM生成（如果配置了API Key）
    if (options.llmApiKey) {
      const provider = createLlmProvider('qwen', options.llmApiKey);
      const llmSql = await provider.generateSql(input, DATABASE_SCHEMA);
      const validation = validateLLMGeneratedSQL(llmSql);
      if (validation.valid) {
        return { sql: llmSql, method: 'llm', confidence: 'medium' };
      }
    }

    // 策略3: 失败返回友好提示
    return {
      sql: '',
      method: 'fallback',
      confidence: 'low',
      error: '无法理解您的需求，请尝试使用更明确的关键词'
    };
  };

  return { convertToSQL, isLoading, error };
}
```

##### 3.1.3 LLM集成（可选）

**新建文件**: `/src/features/sql-query/llm/client.ts`

```typescript
export class QwenLlmProvider {
  async generateSql(input: string, schema: string): Promise<string> {
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        input: {
          messages: [
            { role: 'system', content: '你是SQL查询生成专家，专门生成只读聚合查询。' },
            { role: 'user', content: `# 用户需求\n${input}\n\n# 数据库Schema\n${schema}` }
          ]
        },
        parameters: {
          temperature: 0.1,
          max_tokens: 1000
        }
      })
    });

    const data = await response.json();
    const sql = data.output?.choices?.[0]?.message?.content || '';
    const match = sql.match(/```sql\n([\s\S]+?)\n```/) || sql.match(/SELECT[\s\S]+/);
    return match ? match[1].trim() : sql.trim();
  }
}
```

##### 3.1.4 NL2SQL UI组件

**新建文件**: `/src/features/sql-query/Nl2SqlPanel.tsx`

```typescript
export function Nl2SqlPanel({ onSqlGenerated, llmApiKey }: Nl2SqlPanelProps) {
  const [input, setInput] = useState('');
  const { convertToSQL, isLoading, error } = useNL2SQL({ llmApiKey });

  const handleConvert = async () => {
    const result = await convertToSQL(input);
    if (result.sql) {
      onSqlGenerated(result.sql);
    }
  };

  const EXAMPLES = [
    '查看最近30天的保费趋势',
    '保费最高的10个业务员',
    '按客户类别查看保费占比',
  ];

  return (
    <div className="bg-white p-4 rounded shadow mb-4">
      <h3>🤖 AI生成SQL</h3>

      {/* 示例提示 */}
      <div className="mb-3">
        {EXAMPLES.map(example => (
          <button onClick={() => setInput(example)}>{example}</button>
        ))}
      </div>

      {/* 输入框 */}
      <textarea value={input} onChange={e => setInput(e.target.value)} />

      {/* 错误提示 */}
      {error && <div className="error">⚠️ {error}</div>}

      {/* 转换按钮 */}
      <button onClick={handleConvert} disabled={!input || isLoading}>
        {isLoading ? '生成中...' : '🪄 生成SQL'}
      </button>
    </div>
  );
}
```

#### 3.2 SQL智能提示补全 (P1 - Week 3)

##### 3.2.1 自动补全Hook

**新建文件**: `/src/features/sql-query/useSqlAutocomplete.ts`

```typescript
const POLICY_FACT_FIELDS = [
  { name: 'premium', type: 'DECIMAL', comment: '签单保费(元)' },
  { name: 'policy_date', type: 'DATE', comment: '签单日期' },
  { name: 'salesman_name', type: 'VARCHAR', comment: '业务员姓名' },
  // ... 更多字段
];

const SQL_FUNCTIONS = [
  { name: 'SUM', detail: '聚合函数: 求和' },
  { name: 'COUNT', detail: '聚合函数: 计数' },
  // ... 更多函数
];

export function useSqlAutocomplete() {
  useEffect(() => {
    const provider: editor.languages.CompletionItemProvider = {
      provideCompletionItems: (model, position) => {
        const line = model.getLineContent(position.lineNumber);
        const isAfterSelect = /SELECT\s+[^,]*$/i.test(line);

        const suggestions = [];

        if (isAfterSelect) {
          // 字段补全
          POLICY_FACT_FIELDS.forEach(field => {
            suggestions.push({
              label: field.name,
              kind: languages.CompletionItemKind.Field,
              detail: `${field.name} (${field.type})`,
              documentation: field.comment
            });
          });
        }

        return { suggestions };
      }
    };

    const dispose = editor.registerLanguageCompletionItemProvider('sql', provider);
    return () => dispose();
  }, []);
}
```

##### 3.2.2 增强编辑器组件

**新建文件**: `/src/features/sql-query/EnhancedSqlEditor.tsx`

```typescript
import Editor from '@monaco-editor/react';
import { useSqlAutocomplete } from './useSqlAutocomplete';

export function EnhancedSqlEditor({ value, onChange, onExecute }: EnhancedSqlEditorProps) {
  useSqlAutocomplete(); // 注册自动补全

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    // 快捷键: Ctrl+Enter 执行
    if (onExecute) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onExecute);
    }
  };

  return (
    <Editor
      height="400px"
      defaultLanguage="sql"
      value={value}
      onChange={(val) => onChange(val || '')}
      onMount={handleEditorDidMount}
      options={{
        minimap: { enabled: false },
        lineNumbers: 'on',
        automaticLayout: true,
        quickSuggestions: true,
        parameterHints: { enabled: true }
      }}
    />
  );
}
```

#### 3.3 参数化查询模板 (P2 - Week 4)

**增强文件**: `/src/features/sql-query/QUERY_TEMPLATES.ts`

```typescript
export interface ParameterizedTemplate extends QueryTemplate {
  parameters: TemplateParameter[];
}

export const PARAMETERIZED_TEMPLATES: ParameterizedTemplate[] = [
  {
    id: 'param-trend-by-date-range',
    name: '自定义日期范围趋势',
    category: '趋势',
    parameters: [
      { name: 'startDate', type: 'date', label: '开始日期', defaultValue: '2025-01-01' },
      { name: 'endDate', type: 'date', label: '结束日期', defaultValue: '2025-12-31' },
      {
        name: 'groupBy',
        type: 'select',
        label: '时间维度',
        defaultValue: 'day',
        options: [
          { label: '按天', value: 'day' },
          { label: '按周', value: 'week' },
          { label: '按月', value: 'month' }
        ]
      }
    ]
  },
  // ... 更多模板
];

export function generateSqlFromTemplate(template: ParameterizedTemplate, params: Record<string, any>): string {
  // 根据参数动态生成SQL
}
```

---

### 四、集成与安全验证

#### 4.1 增强SQL验证器

**修改文件**: `/src/shared/utils/sql-validator.ts`

**新增函数**:
```typescript
/**
 * 验证LLM生成的SQL（更严格）
 */
export function validateLLMGeneratedSQL(sql: string): ValidationResult {
  // 基础验证
  const baseValidation = validateSQL(sql);
  if (!baseValidation.valid) return baseValidation;

  // LLM特有检查
  const cteCount = (sql.match(/\bWITH\b/gi) || []).length;
  if (cteCount > 3) {
    return { valid: false, error: '查询过于复杂，包含过多CTE' };
  }

  // 强制LIMIT
  if (!/\bLIMIT\s+\d+/i.test(sql)) {
    return { valid: false, error: 'LLM生成的SQL必须包含LIMIT子句' };
  }

  return { valid: true };
}
```

#### 4.2 集成到SQL查询页面

**修改文件**: `/src/features/sql-query/SqlQueryPage.tsx`

```typescript
export function SqlQueryPage() {
  const [sql, setSql] = useState('');
  const [showNL2SQL, setShowNL2SQL] = useState(true);

  return (
    <div className="flex h-screen">
      {/* 左侧模板库 */}
      <div className="w-80 border-r">
        <TemplateLibrary onSelectTemplate={setSql} />
      </div>

      {/* 右侧主区域 */}
      <div className="flex-1">
        {/* NL2SQL面板 */}
        {showNL2SQL && (
          <Nl2SqlPanel
            onSqlGenerated={setSql}
            llmApiKey={localStorage.getItem('qwen_api_key')}
          />
        )}

        {/* 增强编辑器 */}
        <EnhancedSqlEditor
          value={sql}
          onChange={setSql}
          onExecute={handleExecute}
        />

        {/* 执行按钮和结果 */}
        <button onClick={handleExecute}>▶ 执行查询</button>
        {result && <QueryResults result={result} />}
      </div>
    </div>
  );
}
```

---

## 📊 实施计划

### 阶段1: 核心格式化统一 (Week 1, P0)
- [ ] Day 1: 创建 `formatters.ts` + 单元测试
- [ ] Day 2: 迁移 LineChart、BarChart、RoseChart
- [ ] Day 3: 迁移其他图表组件 + 回归测试

### 阶段2: 玫瑰图防重叠 (Week 1-2, P1)
- [ ] Day 4: 增强 RoseChart 组件（标签引线配置）
- [ ] Day 5: 实现小扇区聚合逻辑 + 响应式设计
- [ ] Day 6: 测试各种数据场景

### 阶段3: SQL智能生成基础 (Week 2-3, P0)
- [ ] Day 7-8: 实现规则引擎（patterns.ts）
- [ ] Day 9: 创建 NL2SQL Hook + Nl2SqlPanel 组件
- [ ] Day 10: 集成到SQL查询页面 + 测试常见查询

### 阶段4: SQL自动补全 (Week 3, P1)
- [ ] Day 11: 实现元数据提取 + Monaco自动补全
- [ ] Day 12: 创建 EnhancedSqlEditor 组件

### 阶段5: 参数化模板 (Week 4, P2)
- [ ] Day 13-14: 设计参数化模板格式 + 实现3-5个常用模板
- [ ] Day 15: 实现参数化面板组件

### 阶段6: LLM增强（可选） (Week 5+, P3)
- [ ] Day 16-17: LLM客户端封装 + Prompt工程
- [ ] Day 18: 混合策略集成 + 安全验证增强
- [ ] Day 19-20: 测试复杂查询

---

## ✅ 验证测试

### 格式化统一性测试
```bash
# 单元测试
bun test src/tests/formatters.test.ts

# 快照测试
bun test src/tests/charts-snapshot.test.tsx

# 覆盖率报告
bun test --coverage
```

**验证清单**:
- [ ] 所有图表组件使用统一的 `formatPremium` 和 `formatRate`
- [ ] Tooltip显示 "123万" 格式（取整）
- [ ] Y轴标签显示 "123万" 格式（取整）
- [ ] 百分比显示 "12.3%" 格式（1位小数）

### 玫瑰图防重叠测试
**测试场景**:
- [ ] 5个扇区 → 内部标签，无引线
- [ ] 12个扇区 → 外部标签 + 引线
- [ ] 25个扇区 → 小扇区聚合
- [ ] 1个扇区占比 < 1% → 标签隐藏
- [ ] 容器宽度 < 400px → 字体缩小

### SQL智能生成测试
**规则引擎覆盖率**:
- [ ] 常见查询模式命中率 > 70%
- [ ] 测试50个真实用户查询

**LLM生成准确性**:
- [ ] SQL语法正确率 > 90%
- [ ] 查询意图匹配率 > 80%
- [ ] 安全验证通过率 = 100%

**性能测试**:
- [ ] 规则引擎响应 < 50ms
- [ ] LLM响应 < 3s
- [ ] 自动补全延迟 < 100ms

### 安全性测试
**测试清单**:
- [ ] 禁止DDL操作（CREATE/ALTER/DROP）
- [ ] 禁止DML操作（INSERT/UPDATE/DELETE）
- [ ] 禁止访问raw_parquet表
- [ ] 禁止查询policy_no字段
- [ ] 强制包含聚合函数或GROUP BY
- [ ] LLM生成SQL强制包含LIMIT

---

## 📁 关键文件清单

### 新建文件
- `/src/shared/utils/formatters.ts` - 统一格式化工具（200行）
- `/src/tests/formatters.test.ts` - 格式化单元测试（150行）
- `/src/features/sql-query/ruleEngine/patterns.ts` - 模式匹配规则（300行）
- `/src/features/sql-query/ruleEngine/index.ts` - 规则引擎入口（50行）
- `/src/features/sql-query/llm/client.ts` - LLM客户端封装（150行）
- `/src/features/sql-query/llm/schema.ts` - 数据库Schema描述（200行）
- `/src/features/sql-query/useNL2SQL.ts` - NL2SQL Hook（150行）
- `/src/features/sql-query/useSqlAutocomplete.ts` - 自动补全Hook（100行）
- `/src/features/sql-query/Nl2SqlPanel.tsx` - NL2SQL面板组件（200行）
- `/src/features/sql-query/EnhancedSqlEditor.tsx` - 增强编辑器（150行）
- `/src/features/sql-query/ParameterizedTemplatePanel.tsx` - 参数化模板面板（250行）

### 修改文件
- `/src/widgets/charts/LineChart.tsx` - 使用统一格式化函数
- `/src/widgets/charts/BarChart.tsx` - 添加格式化支持
- `/src/widgets/charts/RoseChart.tsx` - 添加防重叠配置
- `/src/charts/BubbleChart.ts` - 更新格式化方法
- `/src/features/dashboard/PremiumDashboard.tsx` - 导入统一格式化
- `/src/features/sql-query/SqlQueryPage.tsx` - 集成新功能
- `/src/shared/utils/sql-validator.ts` - 增强LLM验证
- `/src/features/sql-query/QUERY_TEMPLATES.ts` - 添加参数化模板

---

## 🎯 成功标准

1. **格式化统一**: 所有图表的保费、率值显示格式100%一致
2. **玫瑰图防重叠**: 在任何数据量下标签不重叠，可读性良好
3. **NL2SQL可用**: 规则引擎覆盖80%常见查询，响应时间 < 50ms
4. **自动补全**: Monaco Editor提供流畅的字段/函数/关键字补全
5. **安全性**: 所有SQL查询通过安全验证，零违规

---

## ⚠️ 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| LLM调用成本高 | 优化规则引擎覆盖率至80%+，LLM仅处理复杂查询 |
| LLM生成SQL不准确 | 强化安全验证器，人工审核关键查询 |
| 格式化迁移破坏现有功能 | 完整的单元测试 + 快照测试 + 视觉回归测试 |
| 自动补全影响编辑器性能 | 异步加载，防抖优化，延迟渲染 |
| ECharts配置版本兼容性 | 锁定ECharts版本，充分测试 |

---

## 📈 后续优化方向 (P4)

1. **查询历史记录** - 保存用户查询历史，智能推荐常用查询
2. **SQL格式化工具** - 集成SQL Formatter库，一键美化SQL
3. **查询结果可视化** - 自动生成图表，数据洞察建议
4. **性能优化** - 查询结果缓存，增量查询支持
# 营业货车专项分析优化实施计划（实现版）

> 本文件用于落地实施；内容与 `docs/plans/营业货车专项分析优化计划.md` 对齐。

## 1. 范围与目标

### 1.1 布局调整
- **现状**：营业货车分析面板当前上下布局，包含吨位分段玫瑰图和机构下钻堆叠图。
- **目标**：在玫瑰图右侧新增三级机构保费占比图，改为左右双列布局。

### 1.2 样式统一
- **标题外置**：图表标题从 ECharts 内部移到外部 HTML 元素，增加图表高度。
- **颜色统一**：建立全局吨位分段颜色配置，所有图表统一使用。
- **X 轴水平**：全局所有图表 X 轴标签水平排列（rotate=0）。
- **网格线移除**：所有图表移除网格线（splitLine.show=false）。
- **文字样式**：统一 XY 轴标签、动态标签、固定标签的大小和颜色。

### 1.3 内容修改
- **堆叠图命名**："三级机构营业货车堆叠图"。
- **提示语**："点击柱子看机构各吨位分段占比"。
- **固定标签**：柱状图上显示数值标签。

## 2. 依赖与约束

### 2.1 技术与数据依赖
- 使用现有数据源 `PolicyFact`，并复用/新增 SQL 聚合查询。
- 三级机构保费占比图的数据查询依赖 `org_level_3` 字段与 `premium` 聚合。

### 2.2 架构与规范约束
- 统一的图表样式配置需集中维护于 `src/shared/config/chartStyles.ts`。
- 组件内标题与外部标题展示必须可切换，以适配布局与高度要求。

## 3. 设计与实现方案

### 3.1 全局样式配置文件
**新增文件**：`src/shared/config/chartStyles.ts`

```ts
/**
 * 全局图表样式配置
 * 用于统一所有图表的颜色、字体、网格线等样式
 */

/**
 * 吨位分段颜色映射(全局统一)
 */
export const TONNAGE_COLORS = {
  '1吨以下': '#5470C6',
  '1-2吨': '#91CC75',
  '2-5吨': '#FAC858',
  '5-10吨': '#EE6666',
  '10吨以上': '#73C0DE',
  '未知': '#9A60B4',
} as const;

/**
 * 图表文字样式配置
 */
export const CHART_TEXT_STYLES = {
  // 轴标签样式
  axisLabel: {
    fontSize: 12,
    color: '#666',
  },
  // 动态标签样式(柱状图上的数值)
  dynamicLabel: {
    fontSize: 11,
    color: '#333',
    fontWeight: 'normal',
  },
  // 固定标签样式(图例等)
  staticLabel: {
    fontSize: 12,
    color: '#666',
  },
  // 标题样式(外部HTML)
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  // 副标题/提示语样式
  subtitle: {
    fontSize: 12,
    color: '#999',
  },
} as const;

/**
 * 网格线配置
 */
export const GRID_CONFIG = {
  splitLine: {
    show: false, // 全局关闭网格线
  },
} as const;

/**
 * X轴配置(全局水平)
 */
export const X_AXIS_CONFIG = {
  axisLabel: {
    rotate: 0, // 水平排列
    interval: 0,
    fontSize: 12,
    color: '#666',
  },
} as const;
```

### 3.2 三级机构保费占比图
**新增文件**：`src/widgets/charts/OrgPremiumPieChart.tsx`

- 图表类型：环形图（radius: ['40%', '70%']）。
- 数据：每个三级机构的总保费。
- 颜色：使用 ECharts 默认调色板（与吨位颜色不同）。
- 交互：无联动，独立展示。
- 中心文字：显示总保费或“三级机构”。
- 固定标签：显示保费金额（万元）。

**数据查询（复用聚合）**：
```sql
SELECT org_level_3, SUM(premium) as total_premium
FROM PolicyFact
WHERE ... AND customer_category LIKE '%货车%'
GROUP BY org_level_3
ORDER BY total_premium DESC
```

### 3.3 布局结构调整
**修改文件**：`src/features/dashboard/TruckAnalysisPanel.tsx`

从：
```tsx
<div className="space-y-6">
  <TonnageRoseChart />
  <TruckDrillDownChart />
</div>
```

改为：
```tsx
<div className="space-y-6">
  {/* 第一行: 玫瑰图 + 机构占比饼图 (左右布局) */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div>
      <h3 className="text-lg font-bold mb-4 text-center">吨位分段保费占比</h3>
      <TonnageRoseChart showTitle={false} />
    </div>
    <div>
      <h3 className="text-lg font-bold mb-4 text-center">三级机构保费占比</h3>
      <OrgPremiumPieChart />
    </div>
  </div>

  {/* 第二行: 机构堆叠图 (全宽) */}
  <div>
    <h3 className="text-lg font-bold mb-4 text-center">三级机构营业货车堆叠图</h3>
    <TruckDrillDownChart showTitle={false} />
  </div>
</div>
```

### 3.4 图表组件改造
#### 3.4.1 TruckDrillDownChart 改造
**修改文件**：`src/widgets/charts/TruckDrillDownChart.tsx`

- 移除内部标题，支持外部标题。
- 提示语改为“点击柱子看机构各吨位分段占比”。
- 增加固定标签（柱状图显示数值）。
- 应用全局样式配置。
- 移除网格线。
- X 轴水平排列。

#### 3.4.2 TonnageRoseChart 改造
**修改文件**：`src/widgets/charts/TonnageRoseChart.tsx` 与 `src/widgets/charts/RoseChart.tsx`

- 支持显示/隐藏标题（showTitle prop）。
- 移除内部标题时增加图表高度。
- 应用全局吨位颜色配置。

#### 3.4.3 RoseChart 基础组件改造
**修改文件**：`src/widgets/charts/RoseChart.tsx`

- 支持显示/隐藏标题。
- 应用全局样式配置。

## 4. 实施步骤

1. **创建全局样式配置**
   - 创建 `src/shared/config/chartStyles.ts`。
   - 定义颜色、字体、网格线配置常量。

2. **创建三级机构保费占比图**
   - 创建 `src/widgets/charts/OrgPremiumPieChart.tsx`。
   - 实现环形图组件（radius: ['40%', '70%']）。
   - 应用全局样式配置。
   - 添加标题外部显示支持。
   - 在环形图中心显示总保费金额或“三级机构”字样。
   - 添加固定标签显示保费金额（万元）。

3. **改造现有图表组件**
   - 修改 `TruckDrillDownChart.tsx`：移除内部标题、修改提示语、增加固定标签、应用全局样式、移除网格线、X 轴水平排列。
   - 修改 `TonnageRoseChart.tsx` 和 `RoseChart.tsx`：支持显示/隐藏标题、应用全局颜色配置、移除内部标题时增加高度。

4. **调整布局和面板**
   - 修改 `TruckAnalysisPanel.tsx`：添加新数据查询（三级机构保费聚合）、改为左右布局、添加外部标题。

5. **SQL 查询优化**
   - 在 `src/shared/sql/truck.ts` 添加新查询：
   ```ts
   export function generateOrgPremiumRatioQuery(whereClause: string = '1=1'): string {
     return `
       SELECT
         org_level_3,
         SUM(premium) as premium
       FROM PolicyFact
       WHERE ${whereClause}
         AND customer_category LIKE '%货车%'
       GROUP BY org_level_3
       ORDER BY premium DESC
     `;
   }
   ```

6. **其他图表样式统一**
   - 检查并更新 `TonnageByOrgDualYChart.tsx`。
   - 检查并更新 `OrgByTonnageDualYChart.tsx`。
   - 检查并更新其他图表组件。
   - 确保所有图表：X 轴水平排列、移除网格线、应用全局文字样式。

7. **测试验证**
   - 本地开发服务器测试。
   - 验证所有图表样式统一。
   - 验证颜色一致性。
   - 验证交互功能正常。
   - 验证响应式布局。

## 5. 关键文件清单

### 新增文件
1. `src/shared/config/chartStyles.ts`
2. `src/widgets/charts/OrgPremiumPieChart.tsx`

### 修改文件
1. `src/features/dashboard/TruckAnalysisPanel.tsx`
2. `src/widgets/charts/TruckDrillDownChart.tsx`
3. `src/widgets/charts/TonnageRoseChart.tsx`
4. `src/widgets/charts/RoseChart.tsx`
5. `src/shared/sql/truck.ts`
6. `src/widgets/charts/TonnageByOrgDualYChart.tsx`
7. `src/widgets/charts/OrgByTonnageDualYChart.tsx`

## 6. 样式规范总结

### 6.1 颜色规范
- **吨位分段**：使用 `TONNAGE_COLORS` 常量。
- **三级机构**：使用 ECharts 默认调色板。
- **其他**：保持现有配色方案。

### 6.2 文字规范
- **轴标签**：12px, #666。
- **动态标签**：11px, #333。
- **固定标签**：12px, #666。
- **标题**：16px, bold, #333。
- **副标题**：12px, #999。

### 6.3 布局规范
- **X轴**：水平排列（rotate=0）。
- **网格线**：全部移除（show=false）。
- **图表高度**：
  - 玫瑰图：400px（原 320px）。
  - 环形图：400px。
  - 堆叠图：600px（原 500px）。
- **固定标签**：
  - 柱状图：显示保费金额（万元）。
  - 环形图：显示保费金额（万元）。
  - 格式：`value.toLocaleString()`。

### 6.4 标题规范
- **图表内部**：不显示标题。
- **外部标题**：作为 HTML 元素显示在图表上方。
- **提示语**：作为副标题显示在外部。

## 7. 验收标准

### 功能验收
- 三级机构保费占比图正确显示。
- 吨位分段颜色在所有图表中一致。
- 所有 X 轴标签水平排列。
- 所有网格线已移除。
- 固定标签正确显示。
- 交互功能正常（点击、下钻）。
- 响应式布局正常。

### 样式验收
- 全局文字大小颜色统一。
- 吨位颜色映射正确。
- 图表高度符合要求。
- 标题和提示语正确显示。

### 性能验收
- 数据加载速度正常。
- 图表渲染流畅。
- 无内存泄漏。

## 8. 差异清单（如有）
- 当前版本与 `docs/plans/营业货车专项分析优化计划.md` 一致，暂无差异。
