# 增长率分析功能 (Growth Rate Analysis)

基于现有项目架构的完整增长率分析解决方案，支持2026年与2025年数据的对比分析。

## 🎯 功能概述

### 支持的增长率类型
- **同比 (YoY)**：与去年同期比较，适合年度业绩分析
- **环比 (MoM)**：与上一周期比较，适合月度监控  
- **年累计 (YTD)**：今年累计 vs 去年同期累计，适合进度跟踪
- **自定义期间**：任意两个时间段比较，适合专项分析

### 支持的分析维度
- **机构维度**：按 `org_level_3` 分析各机构表现
- **业务员维度**：按 `salesman_name` 分析个人业绩
- **险类维度**：按 `insurance_type` 细分业务结构
- **多维度组合**：支持同时按多个维度分组分析

## 📁 文件结构

```
src/features/growth/
├── hooks/
│   └── useGrowthAnalysis.ts      # React Hook - 增长率分析逻辑
├── components/
│   └── GrowthAnalysisPanel.tsx   # React组件 - 分析界面
├── examples/
│   └── GrowthDashboardExample.tsx # 集成示例
└── README.md                     # 本文档

src/shared/sql/
└── growth.ts                     # SQL生成器 - 核心增长率计算逻辑
```

## 🚀 快速开始

### 1. 基本使用

```typescript
import { useGrowthAnalysis } from '../features/growth/hooks/useGrowthAnalysis';

function MyComponent() {
  const { analyzeGrowth, data, loading, error } = useGrowthAnalysis();

  const handleAnalyze = async () => {
    // 使用预定义配置
    const result = await analyzeGrowth('premiumByOrgMonthlyYoY');
    console.log('增长率数据:', result.data);
  };

  return (
    <button onClick={handleAnalyze} disabled={loading}>
      {loading ? '分析中...' : '开始分析'}
    </button>
  );
}
```

### 2. 自定义配置

```typescript
// 分析特定机构的保费环比增长
const config = {
  growthType: 'mom' as const,
  timeView: 'monthly' as const,
  metric: 'SUM(premium)',
  groupBy: ['salesman_name'],
  whereClause: "org_level_3 = '北京分公司'"
};

const result = await analyzeGrowth(config);
```

### 3. 业务员专项分析

```typescript
import { useGrowthAnalysis } from '../features/growth/hooks/useGrowthAnalysis';

function SalesmanAnalysis({ salesmanName }) {
  const { analyzeSalesmanGrowth } = useGrowthAnalysis();

  const analyzeSalesman = async () => {
    const result = await analyzeSalesmanGrowth(salesmanName, 'yoy');
    // 返回该业务员各险类的同比增长情况
  };
}
```

## 🔧 高级用法

### 预定义配置

系统提供了常用的预配置，可直接使用：

```typescript
// 机构保费月度同比
generateGrowthQuery('premiumByOrgMonthlyYoY');

// 业务员季度环比  
generateGrowthQuery('salesmanQuarterlyMoM');

// KPI年度同比
generateGrowthQuery('kpiByOrgYearlyYoY');

// 保费年累计
generateGrowthQuery('premiumYTD');
```

### 自定义期间比较

```typescript
// 对比2026年Q1 vs 2025年Q1
const customConfig = {
  growthType: 'custom' as const,
  timeView: 'quarterly' as const,
  metric: 'SUM(premium)',
  groupBy: ['org_level_3'],
  currentPeriod: {
    startDate: '2026-01-01',
    endDate: '2026-03-31'
  },
  baselinePeriod: {
    startDate: '2025-01-01', 
    endDate: '2025-03-31'
  }
};
```

### KPI指标分析

```typescript
// 续保率分析
const renewalAnalysis = await analyzeKPIGrowth(
  '(COUNT(CASE WHEN is_renewal THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0)) AS renewal_rate',
  'yoy',
  ['org_level_3']
);

// 人均保费分析
const perCapitaAnalysis = await analyzeKPIGrowth(
  'SUM(premium) / COUNT(DISTINCT salesman_name) AS per_capita_premium',
  'mom',
  ['org_level_3']
);
```

## 📊 数据格式

### 返回数据结构

```typescript
interface GrowthData {
  time_period?: string;        // 时间周期
  current_value: number;       // 当期值
  previous_value: number;       // 基期值
  growth_rate: number | null;  // 增长率（null表示无法计算）
  [key: string]: any;          // 动态维度字段（org_level_3, salesman_name等）
}
```

### 摘要统计

```typescript
interface GrowthSummary {
  avgGrowthRate: number;           // 平均增长率
  positiveGrowthPeriods: number;   // 正增长期数
  totalPeriods: number;            // 总期数
  maxGrowthRate: number;           // 最高增长率
  minGrowthRate: number;           // 最低增长率
}
```

## 🎨 组件集成

### 使用GrowthAnalysisPanel组件

```tsx
import GrowthAnalysisPanel from '../features/growth/components/GrowthAnalysisPanel';

function Dashboard() {
  return (
    <div>
      <GrowthAnalysisPanel
        orgLevel3="北京分公司"  // 可选：限制机构
        salesmanName="张三"     // 可选：限制业务员
      />
    </div>
  );
}
```

### 完整示例

参考 `examples/GrowthDashboardExample.tsx` 查看完整的集成示例，包括：
- 筛选控制
- 多维度分析
- 结果展示
- 错误处理

## ⚡ 性能优化

### 1. 缓存策略

```typescript
const { analyzeGrowth } = useGrowthAnalysis();

// 使用配置字符串作为缓存键
const cacheKey = JSON.stringify(config);
// Hook内部会自动缓存相同配置的查询结果
```

### 2. 批量分析

```typescript
// 同时分析多个指标
const configs = [
  { growthType: 'yoy', metric: 'SUM(premium)' },
  { growthType: 'yoy', metric: 'COUNT(policy_no)' },
  { growthType: 'yoy', metric: KPI_SQL.renewal_rate }
];

const results = await Promise.all(
  configs.map(config => analyzeGrowth(config))
);
```

### 3. 数据量控制

```typescript
// 限制分析范围，避免查询过多数据
const limitedConfig = {
  growthType: 'yoy',
  timeView: 'monthly',
  whereClause: "policy_date >= '2025-01-01' AND org_level_3 IN ('北京分公司', '上海分公司')"
};
```

## 🔍 故障排除

### 常见问题

1. **查询超时**
   - 缩小时间范围
   - 减少分组维度
   - 添加更精确的WHERE条件

2. **增长率计算为null**
   - 基期数据为0
   - 检查数据时间范围
   - 验证数据完整性

3. **类型错误**
   - 确保使用正确的枚举值
   - 检查metric字段格式

### 调试技巧

```typescript
// 查看生成的SQL
const sql = generateGrowthQuery(config);
console.log('Generated SQL:', sql);

// 检查查询结果
const result = await analyzeGrowth(config);
if (!result.success) {
  console.error('Query failed:', result.error);
} else {
  console.log('Data summary:', result.summary);
}
```

## 🔄 与现有系统集成

### 1. Dashboard集成

```typescript
// 在现有Dashboard中添加增长率标签页
function EnhancedDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div>
      <div className="tab-navigation">
        <button onClick={() => setActiveTab('overview')}>概览</button>
        <button onClick={() => setActiveTab('growth')}>增长率分析</button>
      </div>
      
      {activeTab === 'growth' && <GrowthAnalysisPanel />}
      {activeTab === 'overview' && <OriginalDashboard />}
    </div>
  );
}
```

### 2. FilterPanel集成

```typescript
// 与现有筛选面板联动
function IntegratedAnalysis() {
  const [filters, setFilters] = useState({});

  return (
    <GrowthAnalysisPanel
      filters={filters}
      orgLevel3={filters.orgLevel3}
      salesmanName={filters.salesmanName}
    />
  );
}
```

## 📈 扩展建议

1. **预测分析**：基于历史增长率预测未来趋势
2. **基准对比**：与行业平均水平或目标值对比
3. **异常检测**：自动识别异常的增长率波动
4. **报告导出**：生成格式化的增长率分析报告

---

## 📞 支持

如有问题或建议，请参考：
- 项目治理框架：【R1】
- 协作协议：【R2】  
- 交付标准：【R4】

*本功能基于项目现有架构开发，确保与现有代码风格和数据处理流程完全兼容。*