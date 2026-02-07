---
name: test-coverage
description: 测试覆盖率分析与增强建议
category: development-tools
version: 1.0.0
author: "@claude"
tags: [testing, coverage, vitest]
scope: project
requires:
  - bun
  - vitest
  - @vitest/coverage-v8
dependencies:
  - vitest.config.ts
  - tests/
last_updated: "2026-01-16"
---

# /test-coverage

测试覆盖率分析命令，检查单元测试、集成测试、E2E 测试覆盖情况。

## 使用方法

```bash
# 生成测试覆盖率报告（推荐）
/test-coverage

# 仅运行单元测试
/test-coverage --unit

# 仅运行集成测试
/test-coverage --integration

# 仅运行 E2E 测试
/test-coverage --e2e

# 生成覆盖率报告
/test-coverage --report

# 检查特定模块
/test-coverage --module sql
/test-coverage --module components
```

## 测试类型

### 1. 单元测试 (Unit Tests)

**目标覆盖率**: > 80%

**测试范围**:
```typescript
// SQL 生成器测试
tests/sql-generator.test.ts
tests/kpi.test.ts
tests/trend.test.ts
tests/growth.test.ts
tests/cost.test.ts

// 工具函数测试
tests/mapping.test.ts
tests/validator.test.ts
tests/formatters.test.ts
tests/queryBuilder.test.ts

// Hook 测试
tests/hooks/useKpiData.test.ts
tests/hooks/useFilterState.test.ts
tests/hooks/usePerspective.test.ts

// 类型测试
tests/types/view-perspective.test.ts
tests/types/cache.test.ts
```

**示例**:
```typescript
import { describe, it, expect } from 'vitest'
import { formatPremium, formatRate } from '../formatters'

describe('formatPremium', () => {
  it('should format premium in wan', () => {
    expect(formatPremium(123456)).toBe('12')
  })

  it('should handle zero', () => {
    expect(formatPremium(0)).toBe('0')
  })

  it('should handle negative values', () => {
    expect(formatPremium(-123456)).toBe('-12')
  })
})
```

### 2. 组件测试 (Component Tests)

**目标覆盖率**: > 70%

**测试范围**:
```typescript
// 图表组件
tests/components/LineChart.test.tsx
tests/components/BarChart.test.tsx
tests/components/RoseChart.test.tsx

// 筛选器组件
tests/components/DateRangePicker.test.tsx
tests/components/MultiSelectDropdown.test.tsx
tests/components/AdvancedFilterPanel.test.tsx

// 表格组件
tests/components/VirtualTable.test.tsx
tests/components/SalesmanRankingTable.test.tsx
```

**示例**:
```typescript
import { render, screen } from '@testing-library/react'
import { LineChart } from '../LineChart'

describe('LineChart', () => {
  it('should render chart with data', () => {
    const data = [
      { date: '2026-01-01', premium: 10000 }
    ]
    render(<LineChart data={data} xKey="date" yKey="premium" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('should show tooltip on hover', () => {
    // 测试交互
  })
})
```

### 3. 集成测试 (Integration Tests)

**目标覆盖率**: 核心流程 100%

**测试范围**:
```typescript
// 数据加载流程
tests/integration/data-loading.test.ts
tests/integration/filter-interaction.test.ts
tests/integration/chart-rendering.test.ts

// 完整用户流程
tests/integration/dashboard-workflow.test.ts
tests/integration/export-workflow.test.ts
```

**示例**:
```typescript
import { describe, it, expect } from 'vitest'
import { duckdbClient } from '../duckdb/client'

describe('Dashboard Integration', () => {
  it('should load parquet and render KPI', async () => {
    const file = new File([''], 'test.parquet')
    await duckdbClient.loadParquet(file)

    const kpi = await getKpiData()
    expect(kpi.totalPremium).toBeGreaterThan(0)
  })
})
```

### 4. E2E 测试 (End-to-End Tests)

**目标覆盖率**: 关键业务流程 100%

**测试范围**:
```typescript
// 核心业务流程
tests/e2e/upload-data.spec.ts
tests/e2e/view-kpi.spec.ts
tests/e2e/filter-data.spec.ts
tests/e2e/export-report.spec.ts

// 专项功能
tests/e2e/cost-analysis.spec.ts
tests/e2e/renewal-analysis.spec.ts
tests/e2e/growth-analysis.spec.ts
```

**示例**:
```typescript
import { test, expect } from '@playwright/test'

test('complete workflow', async ({ page }) => {
  await page.goto('http://localhost:5173')

  // 上传数据
  await page.setInputFiles('input[type="file"]', 'test.parquet')

  // 查看 KPI
  await expect(page.locator('text=总保费')).toBeVisible()

  // 筛选数据
  await page.selectOption('select[name="org"]', 'XX机构')

  // 导出报告
  await page.click('text=导出')
})
```

## 覆盖率报告

### 生成报告

```bash
# 生成覆盖率报告
bun run test:coverage

# 查看 HTML 报告
open coverage/index.html
```

### 报告解读

```markdown
## 测试覆盖率报告

### 总体覆盖率: 72.3% (目标: > 80%)

#### 按模块统计
- SQL 生成器: 85.6% ✅ (目标: > 80%)
- 工具函数: 92.3% ✅ (目标: > 90%)
- React 组件: 65.4% ⚠️ (目标: > 70%)
- Hooks: 78.2% ⚠️ (目标: > 80%)
- 类型定义: 45.6% ❌ (目标: > 50%)

#### 未覆盖的关键文件
- src/features/dashboard/PremiumDashboard.tsx (0%)
- src/widgets/charts/TruckDrillDownChart.tsx (0%)
- src/features/cost/components/ClaimRatioTable.tsx (0%)

#### 测试用例统计
- 单元测试: 458 个 ✅
- 组件测试: 23 个 ⚠️ (目标: > 50)
- 集成测试: 8 个 ⚠️ (目标: > 20)
- E2E 测试: 0 个 ❌ (目标: > 10)

### 优化建议

1. **提高组件测试覆盖率**
   - 为 PremiumDashboard 添加测试
   - 为 TruckDrillDownChart 添加测试
   - 为所有图表组件添加快照测试

2. **增加集成测试**
   - 添加数据加载流程测试
   - 添加筛选器交互测试
   - 添加图表渲染测试

3. **实现 E2E 测试**
   - 配置 Playwright
   - 编写核心业务流程测试
   - 集成到 CI/CD

4. **提升边界情况覆盖**
   - 测试空数据处理
   - 测试错误处理
   - 测试大数据量场景
```

## 测试最佳实践

### 1. 测试命名

```typescript
// ✅ 好的命名
it('should format premium in wan', () => {})
it('should return 0 when premium is 0', () => {})
it('should throw error when file is invalid', () => {})

// ❌ 不好的命名
it('test formatPremium', () => {})
it('works', () => {})
```

### 2. 测试结构（AAA 模式）

```typescript
it('should calculate renewal rate correctly', () => {
  // Arrange (准备)
  const policies = [
    { isRenewal: true },
    { isRenewal: false }
  ]

  // Act (执行)
  const rate = calculateRenewalRate(policies)

  // Assert (断言)
  expect(rate).toBe(0.5)
})
```

### 3. 测试隔离

```typescript
// ✅ 好的测试（独立）
it('should filter data correctly', () => {
  const data = [{ value: 1 }, { value: 2 }]
  const filtered = filter(data, { value: 1 })
  expect(filtered).toEqual([{ value: 1 }])
})

// ❌ 不好的测试（依赖执行顺序）
it('should filter after add', () => {
  addData({ value: 3 })  // 依赖前面的测试
  const filtered = filter(data, { value: 3 })
  expect(filtered).toEqual([{ value: 3 }])
})
```

### 4. Mock 使用

```typescript
// ✅ 好的 Mock（仅 mock 外部依赖）
vi.mock('../duckdb/client', () => ({
  duckdbClient: {
    query: vi.fn().mockResolvedValue([{ premium: 1000 }])
  }
}))

// ❌ 不好的 Mock（过度 mock）
vi.mock('../utils/formatters', () => ({
  formatPremium: vi.fn()  // 不应 mock 简单函数
}))
```

## 测试命令

```bash
# 运行所有测试
bun test

# 运行特定文件
bun test tests/kpi.test.ts

# 监听模式（开发时使用）
bun test --watch

# 覆盖率报告
bun run test:coverage

# UI 模式
bun test --ui

# 只运行失败的测试
bun test --run --reporter=verbose --bail 1
```

## 相关文件

- `vitest.config.ts` - Vitest 配置
- `tests/` - 测试目录
- `.claude/agents/` - 测试专家代理

## 常见问题

**Q: 覆盖率目标应该是多少？**
A: 单元测试 > 80%，组件测试 > 70%，整体 > 75%。

**Q: 是否需要 100% 覆盖率？**
A: 不需要，100% 覆盖率成本太高且收益递减。

**Q: 如何测试 Hook？**
A: 使用 @testing-library/react-hooks 或直接测试使用 Hook 的组件。

**Q: E2E 测试有必要吗？**
A: 有必要，E2E 测试能发现集成问题，但不应过度依赖。

---

**维护者**: @claude
**版本**: 1.0.0
**最后更新**: 2026-01-16
