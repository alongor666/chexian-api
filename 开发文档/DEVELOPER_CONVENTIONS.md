# 开发者全局约定 (DEVELOPER_CONVENTIONS)

**强制性规则**：所有代码、文档、报表、页面必须遵循的硬性约定。

---

## 📌 第一原则：数据分析三要素强制前置

**规则编号**: `DC-001`
**优先级**: **P0 (CRITICAL)**
**生效日期**: 2026-01-11
**影响范围**: 所有数据分析、报表、看板、查询功能

### 强制要求

**任何数据分析功能必须先确定以下三要素，否则禁止展示数据：**

```
1. 分析年度（Analysis Year）
   └─ 可选值：2025、2026、2027、... (动态扩展)
   └─ 必须提供UI选择器（下拉菜单/年份选择器）

2. 数据口径（Date Criteria）
   └─ 可选值：
       • 签单日期（policy_date）
       • 起保日期（insurance_start_date）
   └─ 必须提供UI选择器（单选按钮/Segmented Control）

3. 时间段（Date Range）
   └─ 开始日期（Start Date）：YYYY-MM-DD
   └─ 结束日期（End Date）：YYYY-MM-DD
   └─ 必须提供日期选择器（DatePicker/DateRangePicker）
```

### 实施细则

#### 1.1 UI组件要求

**所有报表页面必须包含统一的"数据范围选择器"组件**，推荐实现：

```tsx
<DataScopeSelector
  // 必选项
  year={selectedYear}
  onYearChange={setSelectedYear}
  yearOptions={[2025, 2026, 2027, 2028]}  // 动态生成

  dateCriteria={dateCriteria}
  onDateCriteriaChange={setDateCriteria}
  dateTypeOptions={[
    { value: 'policy_date', label: '按签单日期' },
    { value: 'insurance_start_date', label: '按起保日期' }
  ]}

  dateRange={{ start: startDate, end: endDate }}
  onDateRangeChange={setDateRange}

  // 可选项
  defaultYear={new Date().getFullYear()}
  defaultDateCriteria="policy_date"
  defaultDateRange={{
    start: `${new Date().getFullYear()}-01-01`,
    end: new Date().toISOString().split('T')[0]
  }}
/>
```

#### 1.2 状态管理要求

**禁止硬编码日期口径**，必须通过状态管理：

```typescript
// ❌ 错误示例（硬编码）
const sql = `SELECT * FROM PolicyFact WHERE policy_date >= '2025-01-01'`;

// ✅ 正确示例（动态构建）
const dateField = dateCriteria === 'policy_date' ? 'policy_date' : 'insurance_start_date';
const sql = `SELECT * FROM PolicyFact WHERE ${dateField} >= '${startDate}'`;
```

#### 1.3 SQL查询构建规则

**所有SQL查询生成器必须支持数据口径参数**：

```typescript
// src/shared/utils/queryBuilder.ts
export interface AdvancedFilterState {
  // 新增：数据口径
  date_criteria: 'policy_date' | 'insurance_start_date';  // ✅ 必填

  // 新增：分析年度
  analysis_year: number;  // ✅ 必填

  // 现有：时间段（字段名动态调整）
  policy_date_start?: string;      // ❌ 废弃，改用 date_range_start
  policy_date_end?: string;        // ❌ 废弃，改用 date_range_end
  date_range_start: string;        // ✅ 新字段
  date_range_end: string;          // ✅ 新字段

  // 其他筛选条件...
}

export function buildWhereClauseFromFilters(filters: AdvancedFilterState): string {
  const dateField = filters.date_criteria;  // 动态确定字段名
  const conditions: string[] = ['1=1'];

  if (filters.date_range_start) {
    conditions.push(`${dateField} >= '${sanitizeDate(filters.date_range_start)}'`);
  }
  if (filters.date_range_end) {
    conditions.push(`${dateField} <= '${sanitizeDate(filters.date_range_end)}'`);
  }

  return conditions.join(' AND ');
}
```

#### 1.4 默认值规则

**系统默认值**：

| 要素 | 默认值 | 规则 |
|------|--------|------|
| 分析年度 | 当前年份 | `new Date().getFullYear()` |
| 数据口径 | 签单日期 | `'policy_date'` |
| 开始日期 | 当年1月1日 | `${currentYear}-01-01` |
| 结束日期 | 今天 | `new Date().toISOString().split('T')[0]` |

**特殊场景例外**：

- **续保率分析**：强制使用"起保日期"口径，忽略用户选择（需在UI上明确提示）
- **次月起保占比**：强制使用"起保日期"，但允许用户选择年度和时间段

#### 1.5 验证规则

**在执行查询前必须验证三要素完整性**：

```typescript
function validateDataScope(scope: {
  year?: number;
  dateCriteria?: string;
  startDate?: string;
  endDate?: string;
}): { valid: boolean; error?: string } {
  if (!scope.year) {
    return { valid: false, error: '未选择分析年度' };
  }
  if (!scope.dateCriteria || !['policy_date', 'insurance_start_date'].includes(scope.dateCriteria)) {
    return { valid: false, error: '未选择数据口径或口径无效' };
  }
  if (!scope.startDate || !scope.endDate) {
    return { valid: false, error: '未选择时间段' };
  }
  if (new Date(scope.startDate) > new Date(scope.endDate)) {
    return { valid: false, error: '开始日期不能晚于结束日期' };
  }
  return { valid: true };
}
```

---

## 🚨 当前系统诊断报告

**诊断日期**: 2026-01-11
**诊断范围**: 所有现有报表和分析功能
**符合性评级**: ⚠️ **不合格 (Non-Compliant)**

### 发现的问题

| 问题编号 | 严重程度 | 问题描述 | 影响范围 | 违反规则 |
|---------|---------|---------|---------|---------|
| **ISSUE-001** | 🔴 严重 | **缺少统一的数据口径选择器** | 所有报表 | DC-001 |
| **ISSUE-002** | 🔴 严重 | **年度选择功能不统一** | 除续保分析外的所有报表 | DC-001 |
| **ISSUE-003** | 🟡 中等 | **DateRangePicker 标签硬编码为"签单日期"** | `src/features/filters/DateRangePicker.tsx` | DC-001 § 1.2 |
| **ISSUE-004** | 🟡 中等 | **续保分析忽略签单日期筛选，但UI未明确提示** | `RenewalAnalysisPanel.tsx` | DC-001 § 1.4 |
| **ISSUE-005** | 🟡 中等 | **AdvancedFilterState 类型定义缺少 date_criteria 字段** | `src/shared/utils/queryBuilder.ts` | DC-001 § 1.3 |

### ISSUE-001: 缺少统一的数据口径选择器

**详细描述**：
- 用户无法选择按"签单日期"或"起保日期"进行分析
- 两种日期口径的应用场景硬编码在业务逻辑中
- 导致用户困惑：为什么有些报表不受签单日期筛选影响？

**受影响文件**：
```
src/features/dashboard/PremiumDashboard.tsx       # 综合分析（仅支持签单日期）
src/features/dashboard/TruckAnalysisPanel.tsx    # 营业货车专项（仅支持签单日期）
src/features/dashboard/RenewalAnalysisPanel.tsx  # 续保分析（仅支持起保日期，且硬编码）
src/features/filters/AdvancedFilterPanel.tsx     # 高级筛选面板（缺少口径选择器）
```

**违反的规则**：
- DC-001 § 强制要求 - 必须提供数据口径UI选择器
- DC-001 § 1.2 状态管理要求 - 禁止硬编码日期口径

**建议修复方案**：
1. 创建新组件 `DateCriteriaSelector.tsx`（单选按钮组）
2. 在 `AdvancedFilterPanel` 中集成该选择器
3. 更新 `AdvancedFilterState` 类型定义，添加 `date_criteria` 字段
4. 修改所有 SQL 查询构建器，支持动态日期字段

### ISSUE-002: 年度选择功能不统一

**详细描述**：
- 只有 `RenewalAnalysisPanel` 提供年度选择器（2024-2028）
- `PremiumDashboard`、`TruckAnalysisPanel` 无法按年度筛选
- 年度范围硬编码，无法动态扩展

**受影响文件**：
```
src/features/dashboard/RenewalAnalysisPanel.tsx:60   # 本地状态：const [targetYear, setTargetYear]
src/features/dashboard/PremiumDashboard.tsx          # 缺少年度选择器
src/features/dashboard/TruckAnalysisPanel.tsx        # 缺少年度选择器
```

**违反的规则**：
- DC-001 § 强制要求 - 必须提供分析年度UI选择器

**建议修复方案**：
1. 将年度选择器提升到 `AdvancedFilterPanel`
2. 更新 `useFilterState` Hook，管理 `analysis_year` 状态
3. 动态生成年度选项：
   ```typescript
   const currentYear = new Date().getFullYear();
   const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
   // 生成：[2024, 2025, 2026, 2027, 2028] (假设当前是2026年)
   ```

### ISSUE-003: DateRangePicker 标签硬编码

**详细描述**：
- `DateRangePicker.tsx` 第45、61行硬编码标签为"签单日期起始"/"签单日期截止"
- 当数据口径切换为"起保日期"时，标签不会更新
- 导致用户混淆：实际筛选的是起保日期，但UI显示签单日期

**受影响文件**：
```typescript
// src/features/filters/DateRangePicker.tsx:45
<label className="block text-sm font-medium text-gray-700 mb-1">
  签单日期起始  {/* ❌ 硬编码 */}
</label>

// 第61行
<label className="block text-sm font-medium text-gray-700 mb-1">
  签单日期截止  {/* ❌ 硬编码 */}
</label>
```

**违反的规则**：
- DC-001 § 1.2 状态管理要求 - 禁止硬编码日期口径

**建议修复方案**：
```typescript
interface DateRangePickerProps {
  startDate?: string;
  endDate?: string;
  onChange: (start?: string, end?: string) => void;
  // 新增：动态标签
  labels?: {
    start: string;
    end: string;
  };
}

// 使用时
<DateRangePicker
  labels={{
    start: dateCriteria === 'policy_date' ? '签单日期起始' : '起保日期起始',
    end: dateCriteria === 'policy_date' ? '签单日期截止' : '起保日期截止'
  }}
/>
```

### ISSUE-004: 续保分析特殊处理不透明

**详细描述**：
- `buildWhereClauseForRenewal()` 专门排除签单日期筛选（设为 `undefined`）
- UI 上仍显示签单日期筛选器，但实际不生效
- 用户可能误以为筛选器有问题

**受影响文件**：
```typescript
// src/shared/sql/renewal.ts:31-53
function buildWhereClauseForRenewal(filters: AdvancedFilterState): string {
  const renewalFilters: AdvancedFilterState = {
    ...filters,
    policy_date_start: undefined,  // ❌ 静默忽略用户选择
    policy_date_end: undefined,
  };
  // ...
}
```

**违反的规则**：
- DC-001 § 1.4 特殊场景例外 - 需在UI上明确提示

**建议修复方案**：
1. 在 `RenewalAnalysisPanel` 顶部添加醒目提示：
   ```tsx
   <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
     <p className="text-sm text-blue-700">
       ℹ️ 续保率分析固定使用<strong>起保日期</strong>口径，
       不受签单日期筛选影响。
     </p>
   </div>
   ```
2. 或在续保分析 Tab 中隐藏签单日期筛选器，仅显示年度选择器

### ISSUE-005: AdvancedFilterState 缺少必要字段

**详细描述**：
- `AdvancedFilterState` 类型定义缺少 `date_criteria` 和 `analysis_year` 字段
- 导致无法在类型层面强制三要素

**受影响文件**：
```typescript
// src/shared/utils/queryBuilder.ts
export interface AdvancedFilterState {
  policy_date_start?: string;  // ❌ 应改为 date_range_start
  policy_date_end?: string;    // ❌ 应改为 date_range_end
  // 缺少：date_criteria, analysis_year

  org_level_3?: string[];
  salesman_name?: string[];
  // ...
}
```

**违反的规则**：
- DC-001 § 1.3 SQL查询构建规则 - 必须支持数据口径参数

**建议修复方案**：
```typescript
export interface AdvancedFilterState {
  // 新增：三要素
  date_criteria: 'policy_date' | 'insurance_start_date';  // ✅ 必填
  analysis_year: number;                                  // ✅ 必填
  date_range_start: string;                               // ✅ 必填
  date_range_end: string;                                 // ✅ 必填

  // 废弃字段（保留1-2个版本，带 @deprecated 注释）
  /** @deprecated 使用 date_range_start 代替 */
  policy_date_start?: string;
  /** @deprecated 使用 date_range_end 代替 */
  policy_date_end?: string;

  // 其他筛选条件
  org_level_3?: string[];
  salesman_name?: string[];
  // ...
}
```

---

## 📋 修复任务清单

**已登记到 BACKLOG.md，状态：PROPOSED**

| 任务ID | 优先级 | 预计工作量 | 关联问题 |
|-------|--------|----------|---------|
| B051 | P0 | 6小时 | ISSUE-001, ISSUE-005 |
| B052 | P0 | 4小时 | ISSUE-002 |
| B053 | P1 | 2小时 | ISSUE-003 |
| B054 | P2 | 1小时 | ISSUE-004 |

详细需求描述和验收标准请查看 `/BACKLOG.md`。

---

## 📌 第二原则：用户筛选高于默认筛选

**规则编号**: `DC-002`
**优先级**: **P0 (CRITICAL)**
**生效日期**: 2026-01-13
**影响范围**: 所有筛选器、查询构建器、数据处理逻辑

### 核心原则

**用户主动选择的筛选条件必须优先于系统默认值，任何组件不得覆盖用户意图。**

```
优先级顺序（从高到低）：
1. 用户主动选择的值（最高优先级）
2. 组件本地默认值
3. 系统全局默认值（最低优先级）
```

### 实施细则

#### 2.1 判断用户是否主动选择

**通过检查值是否为 `undefined` 来区分**：

```typescript
// ✅ 正确：检查 undefined 判断用户是否选择
function getEffectiveValue<T>(userValue: T | undefined, defaultValue: T): T {
  return userValue !== undefined ? userValue : defaultValue;
}

// ❌ 错误：直接使用 || 会导致 0、false、'' 等有效值被覆盖
const value = userValue || defaultValue;  // 0 会被替换为 defaultValue
```

#### 2.2 筛选器状态管理

**所有筛选条件必须区分"未选择"和"已选择"状态**：

```typescript
interface FilterState {
  // ✅ 使用 undefined 表示"用户未选择，使用默认值"
  analysis_year?: number;           // undefined = 使用当年
  date_criteria?: DateCriteria;     // undefined = 使用签单日期
  policy_date_start?: string;       // undefined = 使用年初
  policy_date_end?: string;         // undefined = 使用今天

  // ✅ 多选筛选器：空数组 = 用户选择"不筛选"，undefined = 未触碰
  org_level_3?: string[];           // undefined = 不筛选，[] = 用户清空
  salesman_name?: string[];
}
```

#### 2.3 组件默认值处理

**在组件内部使用默认值时，必须尊重 props 传入的用户值**：

```typescript
// ❌ 错误：组件内部强制覆盖用户选择
const RenewalAnalysisPanel: React.FC<Props> = ({ filters }) => {
  const targetYear = new Date().getFullYear();  // 忽略了 filters.analysis_year
  // ...
};

// ✅ 正确：用户选择优先，未选择时才使用默认值
const RenewalAnalysisPanel: React.FC<Props> = ({ filters }) => {
  const targetYear = filters.analysis_year ?? new Date().getFullYear();
  // ...
};
```

#### 2.4 SQL 查询构建规则

**查询构建器必须透传用户筛选，不得静默忽略**：

```typescript
// ❌ 错误：静默忽略用户的日期筛选
function buildQuery(filters: FilterState): string {
  const cleanedFilters = {
    ...filters,
    policy_date_start: undefined,  // 强制清除用户选择
    policy_date_end: undefined,
  };
  return generateSQL(cleanedFilters);
}

// ✅ 正确：明确标注例外，并在 UI 上告知用户
function buildQuery(filters: FilterState): string {
  // 续保分析固定使用起保日期，已在 UI 上提示用户
  const effectiveFilters = {
    ...filters,
    date_criteria: 'insurance_start_date' as const,  // 业务强制
  };
  return generateSQL(effectiveFilters);
}
```

#### 2.5 例外场景处理

**当业务规则必须覆盖用户选择时，必须满足以下条件**：

1. **UI 明确提示**：在界面上清晰告知用户该筛选项被业务规则覆盖
2. **代码注释说明**：在代码中注释为何需要覆盖
3. **文档记录**：在 DEVELOPER_CONVENTIONS.md § 1.4 "特殊场景例外"中登记

```tsx
// 示例：续保分析固定使用起保日期
<div className="bg-blue-50 border-l-4 border-blue-400 p-4">
  <p className="text-blue-700 text-sm">
    ℹ️ 续保率分析固定使用<strong>起保日期</strong>口径，
    不受页面顶部"数据口径"选择器的影响。
  </p>
</div>
```

### 禁止行为

| 禁止行为 | 原因 | 正确做法 |
|---------|------|---------|
| 使用 `\|\|` 判断筛选值 | `0`、`false`、`''` 等有效值会被覆盖 | 使用 `??` 或显式检查 `!== undefined` |
| 组件内部硬编码默认值 | 忽略用户通过 props 传入的选择 | 使用 `props.value ?? defaultValue` |
| 静默忽略 filters 中的字段 | 用户不知道筛选被忽略 | 在 UI 上明确提示，或透传筛选 |
| 重置筛选时清空用户已选项 | 破坏用户工作流 | 仅重置为默认值，保留用户选择结构 |

### 验证规则

**在执行任何数据查询前，确认筛选优先级**：

```typescript
function applyFiltersWithPriority(
  userFilters: Partial<FilterState>,
  defaults: FilterState
): FilterState {
  return {
    // 每个字段都使用 ?? 确保用户值优先
    analysis_year: userFilters.analysis_year ?? defaults.analysis_year,
    date_criteria: userFilters.date_criteria ?? defaults.date_criteria,
    policy_date_start: userFilters.policy_date_start ?? defaults.policy_date_start,
    policy_date_end: userFilters.policy_date_end ?? defaults.policy_date_end,
    org_level_3: userFilters.org_level_3,  // 多选：undefined = 不筛选
    salesman_name: userFilters.salesman_name,
    // ...其他字段
  };
}
```

---

## 🔄 后续维护

### 新增报表/页面清单检查

**在开发任何新的数据分析功能时，必须通过以下检查清单：**

**DC-001 三要素检查**：
- [ ] 是否包含"分析年度"选择器？
- [ ] 是否包含"数据口径"选择器（签单日期/起保日期）？
- [ ] 是否包含"时间段"选择器（开始日期/结束日期）？
- [ ] 是否在状态管理中定义了三要素？
- [ ] SQL查询是否支持动态日期字段？
- [ ] 是否验证了三要素的完整性？
- [ ] 如果有特殊口径要求（如续保固定用起保日期），是否在UI上明确提示？

**DC-002 用户筛选优先检查**：
- [ ] 筛选值是否使用 `??` 运算符处理默认值？
- [ ] 组件是否尊重 props 传入的用户筛选值？
- [ ] 是否区分 `undefined`（未选择）和有效值（如 `0`、`false`、`[]`）？
- [ ] 业务强制覆盖的筛选项是否在 UI 上有明确提示？

### 代码审查要点

**在 PR 审查时，必须确认：**

**DC-001 相关（数据分析三要素）**：
1. ✅ 没有硬编码 `policy_date` 或 `insurance_start_date`
2. ✅ 没有硬编码年度（如 `2025`、`2026`）
3. ✅ 日期筛选器标签随数据口径动态变化
4. ✅ 默认值符合 DC-001 § 1.4 规则

**DC-002 相关（用户筛选优先）**：
5. ✅ 筛选值使用 `??` 而非 `||` 进行默认值处理
6. ✅ 组件不会覆盖 props 传入的用户筛选值
7. ✅ 如有业务强制覆盖，UI 上有明确提示
8. ✅ 多选筛选区分 `undefined`（未触碰）和 `[]`（用户清空）

---

**变更历史**：
- 2026-01-13：新增 DC-002 规则 - 用户筛选高于默认筛选（全局优先级原则）
- 2026-01-11：初版发布，定义 DC-001 规则，诊断现有系统5个问题
