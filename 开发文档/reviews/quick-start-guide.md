# 🚀 代码质量改进 - 快速开始指南

> **目标受众**: 开发者、项目经理、技术负责人
> **阅读时间**: 5分钟
> **执行周期**: 4周

---

## 📋 一分钟概览

**问题**: 测试覆盖率 < 10%，122处any，203处console.log
**目标**: 4周内测试覆盖率 → 70%，清理50% any，迁移50% console.log
**方法**: 渐进式改进 + 自动化工具 + CI/CD门禁

---

## 🎯 立即行动（今天就做）

### **第一步：启用现有测试 (2分钟)**

```bash
# 1. 进入项目目录
cd /Users/xuechenglong/Downloads/autowrKPI-v2/2025年复盘/2025fupan

# 2. 启用被跳过的测试
mv tests/logger.test.ts.skip tests/logger.test.ts
mv tests/hooks.test.ts.skip tests/hooks.test.ts

# 3. 运行测试
bun test

# 4. 查看结果
# ✅ 预期：20+ tests passed
```

### **第二步：创建测试工具库 (30分钟)**

```bash
# 1. 创建目录
mkdir -p src/shared/testing

# 2. 创建工具文件（复制以下内容）
```

**创建 `src/shared/testing/fixtures.ts`**:
```typescript
/**
 * 测试数据fixtures
 */
export const KPI_FIXTURES = {
  basic: {
    total_premium: 1000000,
    policy_count: 100,
    avg_premium: 10000,
    org_count: 5,
  },
  empty: {
    total_premium: 0,
    policy_count: 0,
    avg_premium: 0,
  },
  complex: {
    total_premium: 5000000,
    policy_count: 500,
    avg_premium: 10000,
    org_count: 10,
    salesman_count: 20,
  },
};

export const FILTER_FIXTURES = {
  singleOrg: {
    org_level_3: ['营业一部'],
  },
  multiOrg: {
    org_level_3: ['营业一部', '营业二部', '营业三部'],
  },
  withDateRange: {
    start_date: '2025-01-01',
    end_date: '2025-01-31',
  },
};
```

**创建 `src/shared/testing/helpers.ts`**:
```typescript
/**
 * 测试辅助函数
 */

/**
 * 等待loading状态结束
 */
export async function waitForLoading(
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

/**
 * 延迟指定时间
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建Mock函数
 */
export function createMockFn<T extends (...args: any[]) => any>(
  implementation?: T
): jest.Mock<void, any> {
  return (implementation || jest.fn()) as any;
}
```

### **第三步：提交代码 (5分钟)**

```bash
# 1. 添加文件
git add src/shared/testing/ tests/

# 2. 提交
git commit -m "feat(testing): 添加测试工具库并启用现有测试

- 创建 fixtures.ts (测试数据)
- 创建 helpers.ts (辅助函数)
- 启用 logger 和 hooks 测试

验收: bun test 通过 20+ 测试"

# 3. 推送
git push origin fix/dashboard-ui-layout
```

---

## 📅 Week 1 任务清单

### **Day 1 (今天)**
- [x] 启用现有测试
- [ ] 创建测试工具库
- [ ] 运行测试并确保通过

### **Day 2-3**
- [ ] 为 `src/shared/sql/kpi.ts` 创建契约测试
- [ ] 为 `src/shared/hooks/useDataFetch.ts` 创建契约测试
- [ ] 为 `src/shared/normalize/mapping.ts` 创建契约测试

### **Day 4-5**
- [ ] 创建GitHub Actions测试工作流
- [ ] 配置测试覆盖率报告
- [ ] 文档化测试策略

**目标**: 测试覆盖率 10% → 20%

---

## 🔧 自动化工具（Week 3）

### **类型强化工具**

创建 `scripts/tighten-types.mjs`:

```javascript
#!/usr/bin/env node
/**
 * 自动类型强化工具
 *
 * 用法: bun run scripts/tighten-types.mjs [path]
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const TYPE_IMPORTS = {
  KpiData: "import { KpiData } from '@/shared/types/data'",
  TrendDataPoint: "import { TrendDataPoint } from '@/shared/types/data'",
  TableDataRow: "import { TableDataRow } from '@/shared/types/data'",
};

function inferType(context, offset) {
  // 简化版：根据上下文推断类型
  // 实际应该使用AST解析

  if (context.includes('premium')) return 'KpiData';
  if (context.includes('trend')) return 'TrendDataPoint';
  if (context.includes('table')) return 'TableDataRow';

  return 'unknown'; // 默认降级
}

function tightenFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  let result = content;
  let changes = 0;

  // 替换 any
  result = result.replace(/: any/g, (match, offset) => {
    const inferred = infer(content, offset);
    if (inferred !== 'unknown') {
      changes++;
      return `: ${inferred}`;
    }
    return ': unknown'; // 降级为unknown
  });

  if (changes > 0) {
    writeFileSync(filePath, result);
    console.log(`✅ ${filePath}: ${changes} changes`);
  }

  return changes;
}

// 执行
const files = globSync(process.argv[2] || 'src/**/*.ts');
files.forEach(tightenFile);
```

使用方法:
```bash
# 1. 添加执行权限
chmod +x scripts/tighten-types.mjs

# 2. 运行（扫描整个项目）
bun run scripts/tighten-types.mjs src/

# 3. 检查结果
git diff

# 4. 提交
git add .
git commit -m "refactor(types): 自动强化类型（any → unknown/具体类型）"
```

### **日志迁移工具**

创建 `scripts/migrate-logs.mjs`:

```javascript
#!/usr/bin/env node
/**
 * 日志迁移工具
 *
 * 用法: bun run scripts/migrate-logs.mjs [path]
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

function migrateLogs(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  let result = content;
  let changes = 0;

  // 检查是否需要添加导入
  if (content.match(/console\.(log|debug|info|warn|error)/)
      && !content.includes("from '@/shared/utils/logger'")) {
    // 在第一个import后添加logger导入
    result = result.replace(
      /(import.*\n)/,
      `$1import { logger } from '@/shared/utils/logger';\n`
    );
    changes++;
  }

  // 替换console调用
  const replacements = [
    [/console\.debug\(/g, 'logger.debug('],
    [/console\.log\(/g, 'logger.debug('],
    [/console\.info\(/g, 'logger.info('],
    [/console\.warn\(/g, 'logger.warn('],
    [/console\.error\(/g, 'logger.error('],
  ];

  replacements.forEach(([pattern, replacement]) => {
    const matches = content.match(pattern);
    if (matches) {
      result = result.replace(pattern, replacement);
      changes += matches.length;
    }
  });

  if (changes > 0) {
    writeFileSync(filePath, result);
    console.log(`✅ ${filePath}: ${changes} console.* → logger.*`);
  }

  return changes;
}

// 执行
const files = globSync(process.argv[2] || 'src/**/*.{ts,tsx}');
files.forEach(migrateLogs);
```

使用方法:
```bash
# 1. 添加执行权限
chmod +x scripts/migrate-logs.mjs

# 2. 运行（先在shared目录测试）
bun run scripts/migrate-logs.mjs src/shared/

# 3. 检查结果
git diff

# 4. 运行测试确保没有破坏
bun test

# 5. 提交
git add .
git commit -m "refactor(logging): 迁移console.* → logger.*"
```

---

## 📊 进度追踪

### **每日检查**

```bash
# 运行测试
bun test

# 查看覆盖率
bun test --coverage

# 检查any数量
grep -r "any" src/ --include="*.ts" | wc -l

# 检查console数量
grep -r "console\." src/ --include="*.ts" | wc -l
```

### **每周目标**

| 周次 | 测试覆盖率 | any数量 | console.log | 关键任务 |
|------|-----------|---------|------------|---------|
| Week 0 | 10% | 122 | 203 | - |
| Week 1 | 20% | 122 | 203 | 测试基础设施 |
| Week 2 | 40% | 122 | 203 | 核心模块测试 |
| Week 3 | 40% | 61 | 100 | 类型+日志工具 |
| Week 4 | 60% | 30 | 20 | CI/CD门禁 |

---

## 🚨 常见问题

### **Q1: 时间不够，无法按计划完成怎么办？**

**A**: 采用"MVP策略" - 优先完成高价值任务：

```markdown
Week 1 必做:
- ✅ 启用现有测试 (1h)
- ✅ 创建测试工具库 (4h)
- ❌ CI/CD集成 (延后到Week 4)

Week 2 必做:
- ✅ SQL生成器测试 (12h)
- ❌ Hooks测试 (简化为关键用例)

Week 3 必做:
- ✅ 自动化工具开发 (10h)
- ❌ 手动清理 (分批进行)
```

### **Q2: 测试运行太慢怎么办？**

**A**: 优化测试策略：

```typescript
// 1. 使用 vi.mock() 避免真实数据库调用
vi.mock('@/shared/duckdb/client', () => ({
  query: vi.fn().mockResolvedValue({ /* ... */ }),
}));

// 2. 只测试核心逻辑，不测试I/O
test('KPI calculation logic', () => {
  const result = calculateKpi(rawData);
  expect(result.avgPremium).toBe(10000);
});

// 3. 并行运行测试
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 4, // 4个并发进程
  },
});
```

### **Q3: 遗留代码太多，从哪里开始？**

**A**: 使用"热点分析"：

```bash
# 1. 找出最常用的文件
git log --name-only --pretty=format | sort | uniq -c | sort -rg | head -20

# 2. 优先测试这些文件
# 它们是"热点"，bug影响最大

# 3. 使用80/20法则
# 20%的文件 = 80%的业务价值
```

---

## 📚 相关文档

- **详细计划**: `开发文档/reviews/quality-improvement-roadmap.md`
- **Linear任务**: `开发文档/reviews/linear-tasks-export.md`
- **审查报告**: `开发文档/reviews/2026-01-10-code-quality-review.md`

---

## 🎓 核心原则

1. **渐进式改进**: 不追求完美，追求进步
2. **自动化优先**: 用工具替代手工
3. **测试保护网**: 测试让重构更安全
4. **CI/CD门禁**: 技术手段保证质量
5. **高ROI优先**: 聚焦核心模块（20% = 80%）

---

**开始时间**: 2026-01-13
**完成时间**: 2026-02-07
**预计工时**: 90小时
**团队规模**: 1-2人

**准备好了吗？让我们开始吧！** 🚀
