# 技术升级规划 (Tech Upgrade Plan)

**方向D: 技术升级**
**制定时间**: 2026-01-13
**负责人**: @claude

---

## 📊 当前状态评估

### 测试覆盖现状

```
✅ 单元测试套件: 23个测试文件
✅ 测试通过率: 100% (458 pass / 0 fail)
✅ 源代码文件: 119个 (.ts/.tsx)
⚠️ 测试覆盖缺口:
   - React组件测试: 0% (无组件测试)
   - Hooks测试: 0% (无Hooks测试)
   - E2E测试: 0% (未配置)
   - 集成测试: 0% (仅单元测试)
```

### 当前测试分类

| 类别 | 文件数 | 主要覆盖 |
|------|--------|----------|
| **SQL生成器测试** | 8个 | kpi.test.ts, trend-perspective.test.ts, renewal.test.ts等 |
| **数据处理测试** | 5个 | mapping.test.ts, validator.test.ts, queryBuilder.test.ts等 |
| **业务规则测试** | 6个 | dc-001-*.test.ts, dc-002-compliance.test.ts, security.test.ts等 |
| **工具函数测试** | 4个 | formatters.test.ts, logger.test.ts, template-engine.test.ts等 |

**分析结论**:
- ✅ **后端逻辑覆盖完善**: SQL生成、数据处理、业务规则测试充分
- ❌ **前端组件测试缺失**: React组件、Hooks、用户交互未测试
- ❌ **端到端测试缺失**: 无完整业务流程验证

---

## 🎯 升级目标

### 阶段1: 测试覆盖率提升 (B122-B126)

**目标**: 从当前水平提升到**90%+整体覆盖率**

**关键指标**:
- **组件测试覆盖**: 80%+ (针对核心组件)
- **Hooks测试覆盖**: 90%+ (所有自定义Hooks)
- **集成测试**: 5个关键业务流程
- **总体代码覆盖率**: 90%+

**优先级排序**:
1. **P0 - 核心图表组件** (B123): LineChart, BarChart, RoseChart
2. **P0 - 筛选器组件** (B124): DateRangePicker, MultiSelectDropdown
3. **P1 - 自定义Hooks** (B125): useKpiData, useTrendData, usePerspective
4. **P2 - 集成测试** (B126): Dashboard完整数据流

### 阶段2: E2E测试体系 (B127-B129)

**目标**: 建立**端到端自动化测试**,覆盖核心业务场景

**关键指标**:
- **E2E测试场景**: 10+个核心流程
- **浏览器覆盖**: Chrome, Firefox, Safari
- **自动化执行**: CI/CD集成,每次PR自动运行

**优先级排序**:
1. **P0 - 框架配置** (B127): Playwright安装与配置
2. **P1 - 核心流程** (B128): 数据上传→KPI查看→视角切换→导出
3. **P1 - 专项功能** (B129): 营业货车/续保/增长率/SQL查询

### 阶段3: 性能监控 (B130-B132)

**目标**: 集成**全方位性能与错误监控**

**关键指标**:
- **错误捕获率**: 99%+ (Sentry集成)
- **Core Web Vitals**: 全部达标 (LCP<2.5s, FID<100ms, CLS<0.1)
- **自定义指标**: 查询耗时、数据加载、用户路径追踪

**优先级排序**:
1. **P2 - 错误追踪** (B130): Sentry SDK + 错误边界
2. **P2 - 性能监控** (B131): Web Vitals + 自动上报
3. **P3 - 业务指标** (B132): 查询耗时、加载时间、交互路径

---

## 📋 任务详细说明

### B122: 安装测试覆盖率工具并生成基线报告 (P0)

**目标**: 安装@vitest/coverage-v8,生成当前覆盖率基线报告

**验收标准**:
```bash
✅ bun install @vitest/coverage-v8 成功
✅ bun run test:coverage 生成HTML报告 (coverage/index.html)
✅ 覆盖率报告显示文件级别的覆盖率百分比
✅ 识别出覆盖率低于50%的关键文件
```

**输出物**:
- `coverage/index.html` - 基线覆盖率报告
- `开发文档/test-coverage-baseline.md` - 基线统计与改进计划

---

### B123: React组件单元测试 (Phase 1) - 图表组件 (P0)

**目标**: 为核心图表组件编写单元测试,覆盖率达80%+

**测试文件结构**:
```
tests/
  components/
    charts/
      LineChart.test.tsx
      BarChart.test.tsx
      RoseChart.test.tsx
      TruckDrillDownChart.test.tsx
      QualityBusinessChart.test.tsx
```

**测试内容**:
1. **渲染测试**: 组件正常渲染,无崩溃
2. **Props测试**: 必需Props缺失时报错,可选Props使用默认值
3. **数据驱动**: 不同数据格式的渲染结果
4. **交互测试**: 点击、悬停、下钻等用户交互
5. **边界测试**: 空数据、大数据集、异常数据

**示例测试**:
```typescript
// tests/components/charts/LineChart.test.tsx
import { render, screen } from '@testing-library/react';
import { LineChart } from '@/widgets/charts/LineChart';

describe('LineChart', () => {
  it('应正常渲染图表容器', () => {
    const mockData = [
      { time_period: '2026-01-01', premium: 1000000 },
      { time_period: '2026-01-02', premium: 1200000 },
    ];

    render(<LineChart data={mockData} title="保费趋势" />);

    expect(screen.getByText('保费趋势')).toBeInTheDocument();
  });

  it('空数据时应显示提示信息', () => {
    render(<LineChart data={[]} title="保费趋势" />);

    expect(screen.getByText(/暂无数据/i)).toBeInTheDocument();
  });

  // 更多测试用例...
});
```

**验收标准**:
```bash
✅ 5个核心图表组件测试文件创建
✅ 每个组件至少5个测试用例
✅ 所有测试通过 (bun test tests/components/charts/)
✅ 图表组件覆盖率 >80%
```

---

### B124: React组件单元测试 (Phase 2) - 筛选器组件 (P1)

**目标**: 为筛选器组件编写单元测试,重点测试状态管理和用户交互

**测试文件结构**:
```
tests/
  components/
    filters/
      DateRangePicker.test.tsx
      MultiSelectDropdown.test.tsx
      AdvancedFilterPanel.test.tsx
      DateCriteriaSelector.test.tsx
      CollapsibleFilterSection.test.tsx
```

**测试内容**:
1. **状态管理**: 筛选值变更正确触发onChange回调
2. **用户交互**: 点击、输入、选择等操作
3. **验证逻辑**: 日期范围校验、必填字段检查
4. **Props传递**: 父组件传入的筛选值正确显示
5. **边界测试**: 无效日期、空选项、极端值

**验收标准**:
```bash
✅ 5个筛选器组件测试文件创建
✅ 每个组件至少6个测试用例
✅ 所有测试通过
✅ 筛选器组件覆盖率 >80%
```

---

### B125: React Hooks单元测试 (P1)

**目标**: 为自定义Hooks编写单元测试,确保状态逻辑正确

**测试文件结构**:
```
tests/
  hooks/
    useKpiData.test.ts
    useTrendData.test.ts
    usePerspective.test.ts
    useFilterState.test.ts
    useDashboardData.test.ts
```

**测试工具**: `@testing-library/react-hooks`

**测试内容**:
1. **初始状态**: Hook初始化后的默认值
2. **状态更新**: 调用更新函数后状态正确变更
3. **依赖触发**: 依赖项变化时重新执行effect
4. **错误处理**: 异常情况的错误状态
5. **清理函数**: 组件卸载时正确清理

**示例测试**:
```typescript
// tests/hooks/usePerspective.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { usePerspective } from '@/features/dashboard/hooks/usePerspective';

describe('usePerspective', () => {
  it('应返回默认视角为保费', () => {
    const { result } = renderHook(() => usePerspective());

    expect(result.current.perspective).toBe('premium');
  });

  it('切换视角后应更新状态', () => {
    const { result } = renderHook(() => usePerspective());

    act(() => {
      result.current.setPerspective('policy_count');
    });

    expect(result.current.perspective).toBe('policy_count');
  });

  // 更多测试用例...
});
```

**验收标准**:
```bash
✅ 5个Hooks测试文件创建
✅ 每个Hook至少5个测试用例
✅ 所有测试通过
✅ Hooks覆盖率 >90%
```

---

### B126: 集成测试 - Dashboard数据流 (P2)

**目标**: 测试从数据加载到图表渲染的完整流程

**测试文件结构**:
```
tests/
  integration/
    dashboard-data-flow.test.tsx
    filter-to-chart.test.tsx
    perspective-switch.test.tsx
```

**测试内容**:
1. **完整流程**: 加载Parquet → 解析数据 → 生成SQL → 查询 → 渲染
2. **筛选联动**: 修改筛选器 → 重新查询 → 图表更新
3. **视角切换**: 切换视角 → SQL重新生成 → 数据重新查询
4. **错误场景**: 文件加载失败、SQL执行失败、数据格式错误

**验收标准**:
```bash
✅ 3个集成测试文件创建
✅ 每个流程至少3个测试用例
✅ 所有测试通过
✅ 集成测试覆盖5个关键流程
```

---

### B127: 配置Playwright E2E测试框架 (P0)

**目标**: 安装并配置Playwright,创建E2E测试基础设施

**安装步骤**:
```bash
bun add -D @playwright/test
bunx playwright install  # 安装浏览器
```

**配置文件**:
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

**示例测试**:
```typescript
// tests/e2e/example.spec.ts
import { test, expect } from '@playwright/test';

test('首页应正常加载', async ({ page }) => {
  await page.goto('/');

  // 等待应用加载
  await expect(page.locator('text=车险业绩分析看板')).toBeVisible();
});
```

**验收标准**:
```bash
✅ Playwright安装成功
✅ playwright.config.ts配置完成
✅ 示例测试通过 (bunx playwright test)
✅ tests/e2e/README.md编写完成
```

---

### B128: E2E测试 (Phase 1) - 核心业务流程 (P1)

**目标**: 编写核心业务流程的E2E测试

**测试文件结构**:
```
tests/
  e2e/
    01-data-upload.spec.ts
    02-kpi-view.spec.ts
    03-perspective-switch.spec.ts
    04-export-report.spec.ts
    05-filter-interaction.spec.ts
```

**测试场景**:

**场景1: 数据上传与加载**
```typescript
test('用户应能上传Parquet文件并查看数据', async ({ page }) => {
  await page.goto('/');

  // 上传文件
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('签单清洗/优化处理后的业务数据.parquet');

  // 等待数据加载完成
  await expect(page.locator('text=数据加载成功')).toBeVisible({ timeout: 10000 });

  // 验证KPI显示
  await expect(page.locator('text=总保费')).toBeVisible();
  await expect(page.locator('text=/\\d+万/')).toBeVisible();
});
```

**场景2: 视角切换**
```typescript
test('用户应能切换分析视角', async ({ page }) => {
  // 假设数据已加载
  await page.goto('/');
  await uploadTestData(page);

  // 切换到商业险件数视角
  await page.click('text=商业险件数');

  // 验证Y轴标签变化
  await expect(page.locator('text=/件数/')).toBeVisible();

  // 切换到交强险件数视角
  await page.click('text=交强险件数');
  await expect(page.locator('text=/件数/')).toBeVisible();
});
```

**验收标准**:
```bash
✅ 5个E2E测试文件创建
✅ 每个场景至少2个测试用例
✅ 所有测试通过 (bunx playwright test)
✅ 生成HTML测试报告
```

---

### B129: E2E测试 (Phase 2) - 专项分析功能 (P1)

**目标**: 编写专项分析功能的E2E测试

**测试文件结构**:
```
tests/
  e2e/
    06-truck-analysis.spec.ts
    07-renewal-analysis.spec.ts
    08-growth-analysis.spec.ts
    09-sql-query.spec.ts
```

**测试场景**:

**场景1: 营业货车专项分析**
```typescript
test('用户应能查看营业货车下钻分析', async ({ page }) => {
  await page.goto('/');
  await uploadTestData(page);

  // 切换到营业货车标签页
  await page.click('text=营业货车专项');

  // 点击机构柱状图下钻
  await page.click('.truck-chart >> nth=0');

  // 验证吨位饼图显示
  await expect(page.locator('text=← 返回机构列表')).toBeVisible();
  await expect(page.locator('text=/吨位分段/')).toBeVisible();
});
```

**场景2: SQL查询功能**
```typescript
test('用户应能执行自定义SQL查询', async ({ page }) => {
  await page.goto('/');
  await uploadTestData(page);

  // 导航到SQL查询页面
  await page.click('text=SQL查询');

  // 输入SQL
  await page.fill('.monaco-editor', 'SELECT org_name, SUM(premium) FROM PolicyFact GROUP BY org_name');

  // 执行查询
  await page.click('text=执行');

  // 验证结果表格
  await expect(page.locator('text=查询结果')).toBeVisible();
  await expect(page.locator('table >> tr').nth(1)).toBeVisible();
});
```

**验收标准**:
```bash
✅ 4个专项功能E2E测试文件创建
✅ 每个功能至少3个测试用例
✅ 所有测试通过
✅ 总E2E测试覆盖10+个核心场景
```

---

### B130: 集成Sentry错误追踪 (P2)

**目标**: 集成Sentry SDK,自动捕获前端错误并上报

**安装步骤**:
```bash
bun add @sentry/react
```

**配置代码**:
```typescript
// src/shared/monitoring/sentry.ts
import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

export function initSentry() {
  if (import.meta.env.PROD) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [
        new BrowserTracing(),
        new Sentry.Replay(),
      ],
      tracesSampleRate: 0.1,  // 10%采样
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,  // 错误时100%录制
      environment: import.meta.env.MODE,
    });
  }
}

// 错误边界组件
export const SentryErrorBoundary = Sentry.ErrorBoundary;
```

**集成到App**:
```typescript
// src/main.tsx
import { initSentry, SentryErrorBoundary } from './shared/monitoring/sentry';

initSentry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>
);
```

**验收标准**:
```bash
✅ Sentry SDK集成成功
✅ 错误边界配置完成
✅ 手动触发错误后Sentry收到上报
✅ 文档: 开发文档/monitoring/sentry-setup.md
```

---

### B131: 集成性能监控 (Web Vitals) (P2)

**目标**: 监控Core Web Vitals指标(LCP, FID, CLS, TTFB)

**安装步骤**:
```bash
bun add web-vitals
```

**监控代码**:
```typescript
// src/shared/monitoring/performance.ts
import { onCLS, onFID, onLCP, onFCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  // 上报到Sentry或自定义后端
  console.log('[Web Vitals]', metric.name, metric.value);

  if (import.meta.env.PROD) {
    // 示例: 上报到Sentry
    Sentry.captureMessage(`Web Vital: ${metric.name}`, {
      level: 'info',
      extra: {
        value: metric.value,
        rating: metric.rating,
      },
    });
  }
}

export function initPerformanceMonitoring() {
  onCLS(sendToAnalytics);
  onFID(sendToAnalytics);
  onLCP(sendToAnalytics);
  onFCP(sendToAnalytics);
  onTTFB(sendToAnalytics);
}
```

**集成到App**:
```typescript
// src/main.tsx
import { initPerformanceMonitoring } from './shared/monitoring/performance';

initPerformanceMonitoring();
```

**验收标准**:
```bash
✅ web-vitals集成成功
✅ 5个核心指标监控启用
✅ 浏览器Console可见指标输出
✅ 文档: 开发文档/monitoring/performance.md
```

---

### B132: 自定义业务指标监控 (P3)

**目标**: 监控业务关键指标(查询耗时、数据加载时间、用户交互路径)

**监控代码**:
```typescript
// src/shared/monitoring/metrics.ts
export class BusinessMetrics {
  // 查询耗时监控
  static trackQueryTime(queryType: string, duration: number) {
    console.log(`[Query Time] ${queryType}: ${duration}ms`);

    if (duration > 3000) {
      Sentry.captureMessage(`Slow Query: ${queryType}`, {
        level: 'warning',
        extra: { duration },
      });
    }
  }

  // 数据加载监控
  static trackDataLoad(fileName: string, fileSize: number, duration: number) {
    console.log(`[Data Load] ${fileName} (${fileSize} bytes): ${duration}ms`);

    Sentry.captureMessage('Data Load', {
      level: 'info',
      extra: { fileName, fileSize, duration },
    });
  }

  // 用户交互路径
  static trackUserAction(action: string, metadata?: Record<string, any>) {
    console.log(`[User Action] ${action}`, metadata);

    Sentry.addBreadcrumb({
      category: 'user-action',
      message: action,
      data: metadata,
      level: 'info',
    });
  }
}
```

**使用示例**:
```typescript
// src/shared/duckdb/client.ts
async function query(sql: string) {
  const startTime = performance.now();
  const result = await db.exec(sql);
  const duration = performance.now() - startTime;

  BusinessMetrics.trackQueryTime('duckdb-query', duration);

  return result;
}
```

**验收标准**:
```bash
✅ BusinessMetrics类创建
✅ 3个核心指标监控实现
✅ 关键业务代码集成监控
✅ 文档: 开发文档/monitoring/custom-metrics.md
```

---

## 📈 进度追踪

### 里程碑时间表

| 阶段 | 任务范围 | 预计工期 | 目标完成时间 |
|------|---------|---------|-------------|
| **阶段1: 测试覆盖率提升** | B122-B126 | 2周 | 2026-01-27 |
| **阶段2: E2E测试体系** | B127-B129 | 1.5周 | 2026-02-07 |
| **阶段3: 性能监控** | B130-B132 | 1周 | 2026-02-14 |

### 每周检查点

**Week 1 (2026-01-13 ~ 2026-01-19)**:
- [ ] B122: 安装覆盖率工具,生成基线报告
- [ ] B123: 完成图表组件测试(5个组件)

**Week 2 (2026-01-20 ~ 2026-01-26)**:
- [ ] B124: 完成筛选器组件测试(5个组件)
- [ ] B125: 完成Hooks测试(5个Hooks)
- [ ] B126: 完成集成测试(3个流程)

**Week 3 (2026-01-27 ~ 2026-02-02)**:
- [ ] B127: 配置Playwright框架
- [ ] B128: 完成核心E2E测试(5个场景)

**Week 4 (2026-02-03 ~ 2026-02-09)**:
- [ ] B129: 完成专项E2E测试(4个功能)
- [ ] B130: 集成Sentry错误追踪

**Week 5 (2026-02-10 ~ 2026-02-14)**:
- [ ] B131: 集成Web Vitals性能监控
- [ ] B132: 实现自定义业务指标监控

---

## ✅ 验收标准总览

### 阶段1验收

```bash
# 运行所有测试
bun test

# 生成覆盖率报告
bun run test:coverage

# 验收标准
✅ 总体代码覆盖率 ≥90%
✅ 组件测试覆盖率 ≥80%
✅ Hooks测试覆盖率 ≥90%
✅ 所有新测试通过 (0 fail)
✅ 测试文档完善
```

### 阶段2验收

```bash
# 运行E2E测试
bunx playwright test

# 生成测试报告
bunx playwright show-report

# 验收标准
✅ E2E测试场景 ≥10个
✅ 所有E2E测试通过
✅ 支持3种浏览器(Chrome/Firefox/Safari)
✅ CI/CD集成完成
✅ E2E测试文档完善
```

### 阶段3验收

```bash
# 启动应用并验证监控
bun run dev

# 验收标准
✅ Sentry捕获并上报错误
✅ Web Vitals指标正常采集
✅ 自定义业务指标记录正确
✅ 监控Dashboard配置完成
✅ 监控文档完善
```

---

## 📚 相关文档

- [BACKLOG.md](../BACKLOG.md) - 任务登记与状态追踪
- [TECH_STACK.md](./TECH_STACK.md) - 技术栈约束与验证协议
- [CODE_INDEX.md](./00_index/CODE_INDEX.md) - 代码索引与测试入口

---

**维护规则**:
- 每周更新进度检查点
- 完成任务后同步更新验收证据
- 发现新测试缺口时补充到本文档

**变更历史**:
- 2026-01-13: 初版创建,定义3个阶段、11个任务
