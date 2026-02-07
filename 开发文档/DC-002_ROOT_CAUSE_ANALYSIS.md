# DC-002 规则失效根因分析及多Agent执行保障方案

**问题编号**: `DC-002-BUG-001`
**发现日期**: 2026-01-13
**严重程度**: 🔴 P0 严重
**影响范围**: 续保专项分析板块

---

## 1. 问题现象

**用户报告**：
- 用户在筛选器中设置 `policy_date_end = '2026-01-08'`（截止到1月8日）
- 但续保明细表格仍显示截止到 `2026-01-13`（当天），未尊重用户选择

**预期行为**（DC-002规范）：
```typescript
// 用户选择的值应优先于系统默认值
const effectiveEndDate = filters.policy_date_end ?? new Date().toISOString().split('T')[0];
// 应返回 '2026-01-08'
```

**实际行为**：
```typescript
// SQL查询仍使用默认值（当天）
endDateExpr = 'CURRENT_DATE';  // 返回 '2026-01-13'
```

---

## 2. 根因追溯

### 2.1 调用链路分析

```
RenewalAnalysisPanel.tsx:68
  ↓ 调用
generateRenewalDetailTableQuery(filters, targetYear)
  ↓ 参数传递
src/shared/sql/renewal.ts:528-533
  ↓ 问题代码
const endDateExpr = endDate ? `'${endDate}'` : 'CURRENT_DATE';
  ↓ 硬编码默认值
未从 filters.policy_date_end 读取用户选择
```

### 2.2 关键代码缺陷

**文件**: [src/shared/sql/renewal.ts:528-533](../src/shared/sql/renewal.ts#L528-L533)

```typescript
export function generateRenewalDetailTableQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  startDate?: string,  // ❌ 问题1: 参数设计错误
  endDate?: string     // ❌ 问题2: 未从 filters 中提取
): string {
  const whereClause = buildWhereClauseForRenewal(filters);
  const baseYear = targetYear - 1;

  // ❌ 问题3: 当 endDate 参数为 undefined 时，直接使用 CURRENT_DATE
  const startDateExpr = startDate ? `'${startDate}'` : `'${targetYear}-01-01'`;
  const endDateExpr = endDate ? `'${endDate}'` : 'CURRENT_DATE';  // 🔥 违反 DC-002
```

**调用方**: [src/features/dashboard/RenewalAnalysisPanel.tsx:68](../src/features/dashboard/RenewalAnalysisPanel.tsx#L68)

```typescript
// ❌ 问题4: 调用时未传递日期参数，依赖函数内部默认值
const sql = generateRenewalDetailTableQuery(filters, targetYear);
//                                         ^^^^^^^  ^^^^^^^^^^
//                                         参数1     参数2
//                                         缺失 startDate 和 endDate
```

### 2.3 违反规则清单

| 违反规则 | 代码位置 | 违反表现 |
|---------|---------|---------|
| **DC-002 § 2.3** | `renewal.ts:539` | 函数内部硬编码 `CURRENT_DATE`，忽略 `filters.policy_date_end` |
| **DC-002 § 2.1** | `renewal.ts:528` | 使用 `?:` 三元运算符判断 `endDate`，而非 `??` |
| **DC-002 § 2.4** | `renewal.ts:534-539` | SQL构建器未透传用户筛选（filters.policy_date_end） |

---

## 3. 为何代码审查未发现问题？

### 3.1 审查盲区分析

| 盲区类型 | 原因 | 示例 |
|---------|------|------|
| **跨文件调用链路** | 审查时只看单个文件，未追踪完整调用链 | `RenewalAnalysisPanel.tsx` → `renewal.ts` 跨度2个文件 |
| **参数设计缺陷** | 函数接受可选参数，但调用方未传递 | `generateRenewalDetailTableQuery(filters, targetYear)` 缺失参数 |
| **隐式默认值** | 默认值在函数内部，调用方无感知 | `CURRENT_DATE` 隐藏在 `renewal.ts:539` |

### 3.2 DC-002 规则的不可见性问题

**问题**：DC-002 规则要求"用户筛选优先"，但**未在类型系统中强制执行**。

**示例**：
```typescript
// ❌ 类型系统无法检测以下违规
function generateQuery(filters: AdvancedFilterState) {
  const endDate = 'CURRENT_DATE';  // 类型检查通过，但违反 DC-002
}
```

---

## 4. 多Agent执行保障方案

### 4.1 根本问题

**核心矛盾**：
- **人类可理解的规则** ≠ **机器可执行的规则**
- DC-002 是**语义约束**（"用户意图优先"），无法通过 TypeScript 类型系统强制

**类比**：
```
就像告诉 AI "要遵守交通规则"（语义规则）
但没有红绿灯（强制机制）和摄像头（自动检测）
→ AI 必须依赖记忆和理解，容易遗忘或误判
```

### 4.2 分层保障策略

#### 第1层：类型系统强制（编译时）

**目标**：让违规代码**无法编译**

**方案**：创建强类型接口，禁止绕过 filters

```typescript
// 文件：src/shared/types/filter-protocol.ts
/**
 * DC-002 强制类型：禁止函数绕过 filters 直接接受日期参数
 */
export type DateRangeSource =
  | { source: 'from-filters'; filters: AdvancedFilterState }  // ✅ 唯一合法来源
  | { source: 'override'; reason: string; startDate: string; endDate: string };  // ⚠️ 需文档说明

// ❌ 修复前：可以绕过 filters
export function generateRenewalDetailTableQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  startDate?: string,  // ❌ 允许绕过 filters
  endDate?: string
): string;

// ✅ 修复后：强制从 filters 读取
export function generateRenewalDetailTableQuery(
  dateRangeSource: DateRangeSource,
  targetYear: number
): string {
  let startDate: string;
  let endDate: string;

  if (dateRangeSource.source === 'from-filters') {
    const filters = dateRangeSource.filters;
    // DC-002: 用户选择优先于默认值
    startDate = filters.policy_date_start ?? `${targetYear}-01-01`;
    endDate = filters.policy_date_end ?? new Date().toISOString().split('T')[0];
  } else {
    // 明确标记为业务强制覆盖
    startDate = dateRangeSource.startDate;
    endDate = dateRangeSource.endDate;
  }
  // ...
}

// 调用方必须显式声明数据来源
const sql = generateRenewalDetailTableQuery(
  { source: 'from-filters', filters },
  targetYear
);
```

#### 第2层：ESLint 自动检测（开发时）

**目标**：在代码编写时**实时警告**违规代码

**方案**：自定义 ESLint 规则

```javascript
// 文件：.eslintrc.js
module.exports = {
  rules: {
    // 自定义规则：禁止使用 || 判断 filters 字段
    'no-logical-or-for-filters': 'error',
    // 自定义规则：SQL生成函数必须从 filters 读取日期
    'sql-generator-must-use-filters': 'error',
  }
};

// 文件：eslint-plugin-dc002/rules/no-logical-or-for-filters.js
module.exports = {
  create(context) {
    return {
      LogicalExpression(node) {
        // 检测 filters.xxx || defaultValue 模式
        if (
          node.operator === '||' &&
          node.left.type === 'MemberExpression' &&
          node.left.object.name === 'filters'
        ) {
          context.report({
            node,
            message: 'DC-002 违规：禁止使用 || 判断 filters 字段，请使用 ??',
          });
        }
      }
    };
  }
};
```

#### 第3层：单元测试覆盖（测试时）

**目标**：测试用例**验证 DC-002 规则**

**方案**：专项测试套件

```typescript
// 文件：tests/dc-002-compliance.test.ts
import { describe, it, expect } from 'vitest';
import { generateRenewalDetailTableQuery } from '../src/shared/sql/renewal';

describe('DC-002 用户筛选优先规则', () => {
  it('应优先使用 filters.policy_date_end 而非默认值', () => {
    const filters = {
      policy_date_end: '2026-01-08',  // 用户选择
      date_criteria: 'policy_date',
    };

    const sql = generateRenewalDetailTableQuery(
      { source: 'from-filters', filters },
      2026
    );

    // ✅ 断言：SQL 应包含用户选择的日期
    expect(sql).toContain("'2026-01-08'");
    // ❌ 断言：SQL 不应包含 CURRENT_DATE
    expect(sql).not.toContain('CURRENT_DATE');
  });

  it('当 filters.policy_date_end === undefined 时才使用默认值', () => {
    const filters = {
      policy_date_end: undefined,  // 用户未选择
      date_criteria: 'policy_date',
    };

    const sql = generateRenewalDetailTableQuery(
      { source: 'from-filters', filters },
      2026
    );

    // ✅ 此时允许使用 CURRENT_DATE
    expect(sql).toContain('CURRENT_DATE');
  });

  it('当 filters.policy_date_end === null 时视为用户主动清空', () => {
    const filters = {
      policy_date_end: null as any,  // 用户主动清空（边界情况）
      date_criteria: 'policy_date',
    };

    const sql = generateRenewalDetailTableQuery(
      { source: 'from-filters', filters },
      2026
    );

    // ⚠️ null 应被视为"未选择"，使用默认值
    expect(sql).toContain('CURRENT_DATE');
  });
});
```

#### 第4层：代码审查清单（PR 时）

**目标**：人工审查时**强制检查**

**方案**：GitHub PR 模板强制检查

```markdown
## DC-002 用户筛选优先规则检查清单

**SQL 查询生成器**：
- [ ] 是否从 `filters` 对象读取日期范围？
- [ ] 是否使用 `??` 而非 `||` 判断默认值？
- [ ] 函数签名是否禁止绕过 `filters` 直接接受日期参数？

**组件内部逻辑**：
- [ ] 是否尊重 `props.filters` 中的用户选择？
- [ ] 本地默认值是否仅在 `props.xxx === undefined` 时使用？

**跨文件调用链路**：
- [ ] 调用方是否正确传递 `filters`？
- [ ] 是否存在中间函数丢失 `filters` 的情况？

**证据**：
- [ ] 已添加单元测试验证 DC-002 规则
- [ ] 已用 Chrome DevTools 验证实际 SQL 包含用户选择的日期
```

#### 第5层：自动化检测脚本（CI 时）

**目标**：CI 流程中**自动拒绝**违规代码

**方案**：治理检查脚本扩展

```javascript
// 文件：scripts/check-dc-002-compliance.mjs
import { readFileSync } from 'fs';
import { glob } from 'glob';

// 检测规则1：SQL 生成函数必须从 filters 读取日期
const sqlGeneratorFiles = glob.sync('src/shared/sql/**/*.ts');
const violations = [];

for (const file of sqlGeneratorFiles) {
  const content = readFileSync(file, 'utf8');

  // 检测模式：函数签名包含 startDate/endDate 可选参数
  const badPattern = /export function generate\w+\([^)]*\bstartDate\?:/;
  if (badPattern.test(content)) {
    violations.push({
      file,
      rule: 'DC-002 § 2.3',
      message: 'SQL生成函数不应接受可选日期参数，应从 filters 读取',
    });
  }

  // 检测模式：硬编码 CURRENT_DATE
  const currentDatePattern = /const \w+DateExpr = .* : 'CURRENT_DATE'/;
  if (currentDatePattern.test(content)) {
    violations.push({
      file,
      rule: 'DC-002 § 2.4',
      message: 'SQL生成器硬编码 CURRENT_DATE，应从 filters 读取',
    });
  }
}

if (violations.length > 0) {
  console.error('❌ DC-002 规则违规：');
  violations.forEach(v => {
    console.error(`  ${v.file}: ${v.message} (${v.rule})`);
  });
  process.exit(1);
}
```

---

## 5. 多Agent协作保障机制

### 5.1 问题：不同Agent记忆不同步

| Agent | 记忆来源 | 是否看到 DC-002 | 执行风险 |
|-------|---------|----------------|----------|
| Claude | CLAUDE.md + DEVELOPER_CONVENTIONS.md | ✅ 是 | 🟢 低（有规则文档） |
| Codex | 仅代码上下文 | ❌ 否 | 🔴 高（无规则文档） |
| Gemini | GEMINI.md | ⚠️ 需同步 | 🟡 中 |
| Trae | 未知 | ❌ 否 | 🔴 高 |

### 5.2 解决方案：规则机器化

#### 方案A：强制引用机制（推荐）

**原理**：让规则成为代码的一部分，Agent 无法绕过

```typescript
// 文件：src/shared/types/dc-002-guard.ts
/**
 * DC-002 强制守卫：任何 Agent 必须通过此类型才能构建 SQL
 */
export class DC002FilterGuard {
  private constructor(
    private readonly filters: AdvancedFilterState,
    private readonly targetYear: number
  ) {}

  /**
   * 唯一入口：强制从 filters 读取日期范围
   */
  static fromFilters(filters: AdvancedFilterState, targetYear: number) {
    return new DC002FilterGuard(filters, targetYear);
  }

  /**
   * DC-002: 用户选择优先，undefined 时才使用默认值
   */
  getDateRange(): { startDate: string; endDate: string } {
    const startDate = this.filters.policy_date_start ?? `${this.targetYear}-01-01`;
    const endDate = this.filters.policy_date_end ?? new Date().toISOString().split('T')[0];
    return { startDate, endDate };
  }

  /**
   * 业务强制覆盖（需文档说明）
   */
  override(reason: string, startDate: string, endDate: string): { startDate: string; endDate: string } {
    console.warn(`DC-002 Override: ${reason}`);
    return { startDate, endDate };
  }
}

// SQL 生成器强制使用守卫
export function generateRenewalDetailTableQuery(
  guard: DC002FilterGuard  // ✅ 强制使用守卫
): string {
  const { startDate, endDate } = guard.getDateRange();
  const startDateExpr = `'${startDate}'`;
  const endDateExpr = `'${endDate}'`;
  // ...
}

// 调用方必须通过守卫
const guard = DC002FilterGuard.fromFilters(filters, targetYear);
const sql = generateRenewalDetailTableQuery(guard);
```

**优势**：
- ✅ 所有 Agent（Claude/Codex/Gemini/Trae）都必须使用同一套代码
- ✅ 无法绕过类型系统
- ✅ 自动包含 DC-002 规则

#### 方案B：自动化文档同步

**问题**：CLAUDE.md、GEMINI.md、AGENTS.md 可能不同步

**解决**：源文件统一，自动生成 Agent 特定文档

```bash
# 文件：scripts/sync-agent-docs.mjs
# 从 DEVELOPER_CONVENTIONS.md 自动生成各 Agent 的规则文档

# DEVELOPER_CONVENTIONS.md（唯一真理源）
#   ↓ 自动提取 DC-002 章节
# CLAUDE.md § 1        - Claude 专用引用
# GEMINI.md § 协作规则  - Gemini 专用引用
# AGENTS.md § 全局规则  - 其他 Agent 通用引用
```

#### 方案C：强制前置检查

**原理**：在 Agent 开始工作前，强制运行检查脚本

```bash
# 文件：.claude/hooks/pre-task.sh
# 任何 Agent 开始任务前自动运行

echo "🔍 检查 DC-002 规则合规性..."
bun run scripts/check-dc-002-compliance.mjs

if [ $? -ne 0 ]; then
  echo "❌ DC-002 规则检查失败，禁止开始任务"
  exit 1
fi

echo "✅ DC-002 规则检查通过"
```

---

## 6. 立即行动计划

| 优先级 | 任务 | 预计工时 | 负责Agent | 截止日期 |
|-------|------|---------|----------|----------|
| **P0** | 修复 `generateRenewalDetailTableQuery` 函数 | 1小时 | @claude | 2026-01-13 |
| **P0** | 添加 DC-002 单元测试 | 2小时 | @claude | 2026-01-13 |
| **P1** | 实现 `DC002FilterGuard` 类型守卫 | 3小时 | @claude | 2026-01-14 |
| **P1** | 扩展治理检查脚本（dc-002-compliance） | 2小时 | @claude | 2026-01-14 |
| **P2** | 自定义 ESLint 规则 | 4小时 | @codex | 2026-01-15 |
| **P2** | 自动化文档同步脚本 | 2小时 | @gemini | 2026-01-15 |

---

## 7. 长期改进建议

### 7.1 架构改进

**问题**：当前架构依赖 Agent "记住"规则

**改进方向**：让规则成为架构的一部分

```
当前架构（依赖记忆）：
  Agent 看文档 → 理解规则 → 写代码 → 希望不违规

理想架构（规则内嵌）：
  代码框架强制规则 → Agent 只能按规则写 → 无法违规
```

### 7.2 治理工具链

**建议新增工具**：

1. **规则可视化仪表板**
   - 显示所有 DC-* 规则的合规率
   - 标记高风险代码文件

2. **Agent 工作日志**
   - 记录每个 Agent 的修改
   - 自动标记潜在违规

3. **跨Agent代码审查**
   - Codex 写代码 → Claude 自动审查
   - Gemini 写SQL → Claude 验证 DC-002

---

## 8. 总结

**核心教训**：
1. ❌ 文档化规则**不足以保证执行**（人类会忘记，AI 也会）
2. ✅ **类型系统强制** > 文档提醒
3. ✅ **自动化检测** > 人工审查

**关键行动**：
- 立即修复 `generateRenewalDetailTableQuery`
- 实现 `DC002FilterGuard` 类型守卫
- 扩展 CI 自动检测

**最终目标**：
> 让违反 DC-002 的代码**无法编译、无法提交、无法合并**。
