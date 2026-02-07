# 代码质量改进：工程化实施路线图

**版本**: v1.0
**制定日期**: 2026-01-10
**执行周期**: 4周 (2026-01-13 ~ 2026-02-07)
**目标**: 测试覆盖率 10% → 70%，清理 122 处 any，迁移 203 处 console.log

---

## 📊 总体策略

### **核心原则**
1. **渐进式改进**: 不停止新功能开发，每次PR包含质量改进
2. **自动化优先**: 用工具替代手工，减少错误
3. **高ROI优先**: 聚焦核心模块（20% = 80%价值）
4. **CI/CD门禁**: 用技术手段保证质量不倒退

### **依赖关系**
```
Week 1: 测试基础设施 ← Week 2: 核心模块测试
     ↓                      ↓
Week 4: CI/CD集成 ← Week 3: 类型+日志优化
```

---

## 📅 Week 1: 测试基础设施 (2026-01-13 ~ 2026-01-17)

### **目标**
- ✅ 启用被跳过的测试文件
- ✅ 创建测试工具库（fixtures、helpers）
- ✅ 建立3个核心模块的契约测试框架
- ✅ CI/CD集成测试执行

### **任务拆解**

#### **任务 1.1: 启用现有测试**
**优先级**: P0
**预估**: 1小时
**负责人**: @claude
**验收标准**:
```bash
✅ tests/logger.test.ts 通过所有测试
✅ tests/hooks.test.ts 通过所有测试
✅ bun test 输出显示 20+ tests passed
```

**执行步骤**:
```bash
# 1. 重命名文件
mv tests/logger.test.ts.skip tests/logger.test.ts
mv tests/hooks.test.ts.skip tests/hooks.test.ts

# 2. 运行测试
bun test

# 3. 修复失败的测试（如果有）
# 4. 提交代码
git add tests/
git commit -m "test: 启用logger和hooks单元测试"
```

---

#### **任务 1.2: 创建测试工具库**
**优先级**: P0
**预估**: 4小时
**负责人**: @claude
**验收标准**:
```typescript
✅ src/shared/testing/fixtures.ts 导出测试数据
✅ src/shared/testing/helpers.ts 导出测试辅助函数
✅ tests/shared/mocking.ts 导出Mock工具
```

**实现内容**:
```typescript
// src/shared/testing/fixtures.ts
/**
 * 测试数据fixtures
 */
export const KPI_FIXTURES = {
  basic: {
    total_premium: 1000000,
    policy_count: 100,
    avg_premium: 10000,
  },
  empty: {
    total_premium: 0,
    policy_count: 0,
  },
};

// src/shared/testing/helpers.ts
/**
 * 测试辅助函数
 */
export function waitForLoading(
  getState: () => { loading: boolean }
): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!getState().loading) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

// tests/shared/mocking.ts
/**
 * DuckDB Mock工具
 */
export function mockDuckDBClient() {
  return {
    query: vi.fn().mockResolvedValue({ /* ... */ }),
    loadParquet: vi.fn().mockResolvedValue({ /* ... */ }),
  };
}
```

---

#### **任务 1.3: 核心模块契约测试框架**
**优先级**: P0
**预估**: 8小时
**负责人**: @claude
**验收标准**:
```typescript
✅ src/shared/sql/kpi.contract.ts 定义KPI计算契约
✅ src/shared/normalize/mapping.contract.ts 定义映射契约
✅ src/shared/hooks/useDataFetch.contract.ts 定义Hook契约
✅ 运行 bun test 契约测试全部通过
```

**实现示例**:
```typescript
// src/shared/sql/kpi.contract.ts
import { describe, it, expect } from 'vitest';
import { generateKpiSQL } from './kpi';

describe('KPI SQL Generator Contract', () => {
  it('should generate basic KPI query', () => {
    const input = {
      filters: {},
      timeRange: { start: '2025-01-01', end: '2025-01-31' },
    };

    const sql = generateKpiSQL(input);

    // 契约验证
    expect(sql).toContain('SELECT');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('WHERE');
  });

  it('should apply org filter', () => {
    const input = {
      filters: { org_level_3: ['营业一部'] },
      timeRange: { start: '2025-01-01', end: '2025-01-31' },
    };

    const sql = generateKpiSQL(input);

    expect(sql).toContain("org_level_3 = '营业一部'");
  });
});
```

---

#### **任务 1.4: CI/CD测试集成**
**优先级**: P1
**预估**: 2小时
**负责人**: @claude
**验收标准**:
```yaml
✅ .github/workflows/test.yml 创建
✅ Push到main时自动运行测试
✅ PR时自动运行测试并报告覆盖率
```

**配置文件**:
```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

---

### **Week 1 产出物**
- [ ] 15+ 新增测试用例
- [ ] 3个测试工具文件
- [ ] 1个CI工作流
- [ ] 测试覆盖率：10% → 20%

---

## 📅 Week 2: 核心模块测试 (2026-01-20 ~ 2026-01-24)

### **目标**
- ✅ 核心SQL生成器测试覆盖 80%+
- ✅ 核心Hooks测试覆盖 80%+
- ✅ 数据规范化测试覆盖 80%+
- ✅ 总体覆盖率达到 40%+

### **任务拆解**

#### **任务 2.1: SQL生成器测试**
**优先级**: P0
**预估**: 12小时
**负责人**: @claude
**验收标准**:
```bash
✅ tests/sql/kpi.test.ts 覆盖所有分支
✅ tests/sql/trend.test.ts 覆盖所有分支
✅ tests/sql/truck.test.ts 覆盖所有分支
✅ coverage report显示 sql/ 目录 80%+
```

**测试用例清单**:
```typescript
describe('KPI SQL Generator', () => {
  // 基础查询
  test('generate base query');
  test('generate with time range filter');

  // 筛选器
  test('apply org filter');
  test('apply salesman filter');
  test('apply customer_category filter');
  test('apply multiple filters');

  // 边界情况
  test('handle empty filters');
  test('handle invalid date range');
  test('handle special characters in filter values');

  // 性能
  test('generate complex query < 100ms');
});
```

---

#### **任务 2.2: Hooks单元测试**
**优先级**: P0
**预估**: 8小时
**负责人**: @claude
**验收标准**:
```bash
✅ tests/hooks/useDataFetch.test.ts 完整覆盖
✅ tests/hooks/useLoadingStates.test.ts 完整覆盖
✅ @testing-library/react-hooks 正确使用
```

**关键测试场景**:
```typescript
describe('useDataFetch', () => {
  test('initial state should be correct');
  test('should fetch data successfully');
  test('should handle fetch error');
  test('should call onSuccess callback');
  test('should call onError callback');
  test('should reset state correctly');
  test('should update data when fetch called again');
});
```

---

#### **任务 2.3: 数据规范化测试**
**优先级**: P1
**预估**: 6小时
**负责人**: @claude
**验收标准**:
```bash
✅ tests/normalize/mapping.test.ts 扩展测试
✅ tests/normalize/validator.test.ts 扩展测试
✅ 覆盖率：normalize/ 目录 80%+
```

---

#### **任务 2.4: 测试覆盖率监控**
**优先级**: P1
**预估**: 2小时
**负责人**: @claude
**验收标准**:
```typescript
✅ vitest.config.ts 配置覆盖率阈值
✅ coverage报告自动生成
✅ README.md添加覆盖率徽章
```

**配置示例**:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

---

### **Week 2 产出物**
- [ ] 40+ 新增测试用例
- [ ] 核心模块 80%+ 覆盖率
- [ ] 总覆盖率：20% → 40%

---

## 📅 Week 3: 类型安全 + 日志系统 (2026-01-27 ~ 2026-01-31)

### **目标**
- ✅ 清理 50% 的 any 类型（61处）
- ✅ 迁移 50% 的 console.log（100处）
- ✅ 核心模块零 any
- ✅ 创建自动化工具

### **任务拆解**

#### **任务 3.1: 类型强化工具**
**优先级**: P0
**预估**: 6小时
**负责人**: @claude
**验收标准**:
```bash
✅ scripts/tighten-types.mjs 可执行
✅ 自动推断类型准确率 > 70%
✅ 生成类型强化报告
```

**实现脚本**:
```javascript
// scripts/tighten-types.mjs
import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const TYPE_MAPPING = {
  'KpiData': 'import { KpiData } from "@/shared/types/data"',
  'TrendDataPoint': 'import { TrendDataPoint } from "@/shared/types/data"',
};

function inferTypeFromUsage(code, variableName) {
  // 从上下文推断类型
  // 1. 检查是否有类型导入
  // 2. 检查函数签名
  // 3. 检查赋值语句
}

function tightenFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  let changes = 0;

  // 替换 any
  content = content.replace(/: any/g, (match, offset) => {
    const inferred = inferTypeFromUsage(content, offset);
    if (inferred) {
      changes++;
      return `: ${inferred}`;
    }
    return ': unknown'; // 降级方案
  });

  if (changes > 0) {
    writeFileSync(filePath, content);
  }

  return changes;
}

// 执行
const files = globSync('src/**/*.ts');
files.forEach(tightenFile);
```

---

#### **任务 3.2: 手动清理核心模块any**
**优先级**: P0
**预估**: 8小时
**负责人**: @claude
**验收标准**:
```typescript
✅ src/shared/hooks/ 零 any
✅ src/shared/utils/ 零 any
✅ src/shared/sql/ 零 any
✅ TypeScript编译无错误
```

**清理示例**:
```typescript
// ❌ Before
function useDataFetch(fetchFn: (params?: any) => Promise<any>) {
  const [data, setData] = useState<any>(null);
}

// ✅ After
interface UseDataFetchOptions<T, P = void> {
  fetchFn: (params?: P) => Promise<T>;
  initialData?: T;
}

function useDataFetch<T, P = void>(options: UseDataFetchOptions<T, P>) {
  const [data, setData] = useState<T | null>(options.initialData ?? null);
}
```

---

#### **任务 3.3: 日志迁移工具**
**优先级**: P0
**预估**: 4小时
**负责人**: @claude
**验收标准**:
```bash
✅ scripts/migrate-logs.mjs 可执行
✅ 自动添加logger导入
✅ 自动替换console.* → logger.*
✅ 迁移准确率 > 95%
```

**实现脚本**:
```javascript
// scripts/migrate-logs.mjs
import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

function migrateLogs(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  let changes = 0;

  // 检查是否已有logger导入
  if (!content.includes("from '@/shared/utils/logger'")) {
    // 添加导入
    content = `import { logger } from '@/shared/utils/logger';\n${content}`;
  }

  // 替换console调用
  const replacements = [
    [/console\.log\(/g, 'logger.debug('],
    [/console\.debug\(/g, 'logger.debug('],
    [/console\.info\(/g, 'logger.info('],
    [/console\.warn\(/g, 'logger.warn('],
    [/console\.error\(/g, 'logger.error('],
  ];

  replacements.forEach(([pattern, replacement]) => {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replacement);
      changes += matches.length;
    }
  });

  if (changes > 0) {
    writeFileSync(filePath, content);
  }

  return changes;
}

// 执行
const files = globSync('src/**/*.{ts,tsx}');
files.forEach(migrateLogs);
```

---

#### **任务 3.4: 手动迁移核心模块日志**
**优先级**: P1
**预估**: 4小时
**负责人**: @claude
**验收标准**:
```bash
✅ src/shared/ 零 console.log
✅ src/services/ 零 console.log
✅ 保留关键的error日志
```

---

### **Week 3 产出物**
- [ ] any类型：122 → 61 (50%↓)
- [ ] console.log：203 → 100 (50%↓)
- [ ] 2个自动化工具脚本

---

## 📅 Week 4: CI/CD门禁 + 收尾 (2026-02-03 ~ 2026-02-07)

### **目标**
- ✅ CI/CD覆盖率门禁上线
- ✅ 总体覆盖率达到 60%+
- ✅ 核心模块零any
- ✅ 全项目logger迁移完成

### **任务拆解**

#### **任务 4.1: CI/CD质量门禁**
**优先级**: P0
**预估**: 4小时
**负责人**: @claude
**验收标准**:
```yaml
✅ .github/workflows/quality-gate.yml 创建
✅ 覆盖率下降时阻止合并
✅ any数量增加时警告
✅ console.log增加时警告
```

**配置文件**:
```yaml
# .github/workflows/quality-gate.yml
name: Quality Gate

on:
  pull_request:

jobs:
  quality-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Check test coverage
        run: |
          bun test --coverage

          # 检查覆盖率是否下降
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          BASE_COVERAGE=$(git show origin/main:coverage/coverage-summary.json | jq '.total.lines.pct')

          if (( $(echo "$COVERAGE < $BASE_COVERAGE" | bc -l) )); then
            echo "❌ Coverage dropped from $BASE_COVERAGE% to $COVERAGE%"
            exit 1
          fi

          echo "✅ Coverage: $COVERAGE% (+$((COVERAGE - BASE_COVERAGE))%)"

      - name: Check any types
        run: |
          ANY_COUNT=$(grep -r "any" src/ --include="*.ts" --include="*.tsx" | wc -l)
          BASE_ANY=$(git show origin/main:coverage/any-count.txt 2>/dev/null || echo "122")

          if [ $ANY_COUNT -gt $BASE_ANY ]; then
            echo "⚠️ any count increased: $BASE_ANY → $ANY_COUNT"
            exit 1
          fi

      - name: Check console.log
        run: |
          CONSOLE_COUNT=$(grep -r "console\." src/ --include="*.ts" --include="*.tsx" | wc -l)
          BASE_CONSOLE=$(git show origin/main:coverage/console-count.txt 2>/dev/null || echo "203")

          if [ $CONSOLE_COUNT -gt $BASE_CONSOLE ]; then
            echo "⚠️ console.log increased: $BASE_CONSOLE → $CONSOLE_COUNT"
            exit 1
          fi
```

---

#### **任务 4.2: 补充测试覆盖**
**优先级**: P0
**预估**: 12小时
**负责人**: @claude
**验收标准**:
```bash
✅ UI组件集成测试
✅ Edge case测试
✅ Error handling测试
✅ 总覆盖率：40% → 60%
```

---

#### **任务 4.3: 最终清理**
**优先级**: P1
**预估**: 4小时
**负责人**: @claude
**验收标准**:
```bash
✅ 剩余any添加@ts-ignore注释
✅ 剩余console.log评估必要性
✅ 更新文档（INDEX.md, README.md）
```

---

#### **任务 4.4: 代码质量报告更新**
**优先级**: P1
**预估**: 2小时
**负责人**: @claude
**验收标准**:
```markdown
✅ 开发文档/reviews/2026-02-07-quality-report.md
✅ 对比before/after指标
✅ 总结改进经验
```

---

### **Week 4 产出物**
- [ ] CI/CD质量门禁
- [ ] 总覆盖率：60%+
- [ ] 完整的代码质量报告

---

## 📊 度量指标与追踪

### **每周检查点**

| 周次 | 测试覆盖率 | any数量 | console.log | 新增测试 | CI/CD |
|------|-----------|---------|------------|---------|-------|
| Week 0 | 10% | 122 | 203 | - | - |
| Week 1 | 20% | 122 | 203 | 15 | ✅ 基础集成 |
| Week 2 | 40% | 122 | 203 | 40 | ✅ 覆盖率报告 |
| Week 3 | 40% | 61 | 100 | - | - |
| Week 4 | 60% | 30 | 20 | 20 | ✅ 质量门禁 |

### **Daily Standup模板**

```markdown
## 今日进度
- 完成任务: [任务ID]
- 新增测试: X 个
- 代码行数: +XXX -YYY

## 阻塞问题
- [问题描述]
- 需要帮助: [谁]

## 明日计划
- [任务ID] [任务描述]
```

---

## 🎯 成功标准

### **必须达成** (MUST)
- ✅ 测试覆盖率 ≥ 60%
- ✅ 核心模块覆盖率 ≥ 80%
- ✅ CI/CD质量门禁上线
- ✅ any类型减少 50%+
- ✅ console.log减少 50%+

### **期望达成** (SHOULD)
- ⭐ 测试覆盖率 ≥ 70%
- ⭐ 核心模块零 any
- ⭐ 完整的测试文档
- ⭐ 自动化工具开源

### **可选达成** (NICE TO HAVE)
- 🎁 性能测试用例
- 🎁 E2E测试
- 🎁 可视化测试报告

---

## 🚨 风险与应对

### **风险1: 进度延迟**
**概率**: 中 (40%)
**影响**: 高
**应对**:
- Week 2结束时评估进度
- 如延迟 > 2天，降低目标（覆盖率 60% → 50%）
- 调用额外资源（Pair Programming）

### **风险2: 回归Bug**
**概率**: 中 (30%)
**影响**: 中
**应对**:
- 每次重构前运行完整测试套件
- 使用Git Bisect快速定位问题
- 保持main分支可回滚

### **风险3: 团队抵触**
**概率**: 低 (20%)
**影响**: 高
**应对**:
- 展示测试带来的价值（减少bug）
- 提供培训和工具支持
- 渐进式推广，不强制

---

## 📚 参考资料

- [Vitest Testing Library](https://vitest.dev/guide/)
- [Testing Library React](https://testing-library.com/react)
- [TypeScript Best Practices](https://github.com/typescript-cheatsheets/react)
- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)

---

**制定人**: @claude
**审核人**: @xuechenglong
**版本**: v1.0
**最后更新**: 2026-01-10
