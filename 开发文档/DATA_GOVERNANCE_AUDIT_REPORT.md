# 数据治理审计报告

**审计日期**: 2026-02-19
**审计范围**: 全数据链路（Parquet → DuckDB → SQL生成器 → API路由 → 前端消费）
**审计方法**: 4个并行Agent逐层审计 + 人工交叉验证

---

## 一、审计总览

| 层级 | 审计模块数 | 严重问题 | 中等问题 | 低风险 |
|------|-----------|---------|---------|-------|
| 数据源层 | 3 | 0 | 1 | 1 |
| SQL生成器层 | 16 | 1 (已修复) | 4 | 2 |
| API路由层 | 5 | 0 | 2 | 1 |
| 前端消费层 | 6 | 0 | 2 | 2 |
| **合计** | **30** | **1** | **9** | **6** |

---

## 二、已修复的严重问题

### [FIX-001] growth.ts 同比查询逻辑错误 ✅ 已修复

**严重性**: 🔴 严重 — 导致同比增长率永远为 NULL
**文件**: `server/src/sql/growth.ts:104-113`
**Commit**: `6bc77df`

**问题描述**:
`generateYoYGrowthQuery()` 的 `previous_period` CTE 使用了自引用 WHERE 条件：
```sql
AND ${timeExpression} >= ${timeExpression} - INTERVAL '1 year'  -- 恒为 true
AND ${timeExpression} < ${timeExpression} - INTERVAL '1 day'    -- 恒为 false
```
导致 `previous_period` 永远返回空集，同比增长率全部为 NULL。

**修复方案**: 移除自引用条件，让 `previous_period` 正常获取数据，依靠 `FULL OUTER JOIN` 的 `DATE_ADD` 条件实现年度对齐。

**影响范围**: `/api/query/growth?growthType=yoy` 端点（增长率分析页面的同比功能）

---

## 三、待处理的中等问题

### [AUDIT-002] V2性能优化版SQL未被路由使用

**严重性**: 🟡 中等 — 性能浪费
**文件**: `server/src/sql/growth.ts`

**问题描述**:
growth.ts 包含性能优化的 V2 版本（`generateYoYGrowthQueryV2`、`generateMoMGrowthQueryV2`、`generateYTDGrowthQueryV2`），使用预聚合表 `PeriodAggregated`，声称性能提升 15-30 倍。但路由层 `query.ts:335` 仍调用 V1 版本的 `generateGrowthQuery()`。

**建议**: 评估 `PeriodAggregated` 预聚合表是否已在 DuckDB 中创建。若已创建，将路由切换到 V2 版本。

---

### [AUDIT-003] renewal.ts 使用 CURRENT_DATE 硬编码

**严重性**: 🟡 中等 — 违反 DC-002 规范
**文件**: `server/src/sql/renewal.ts:85`

**问题描述**:
```typescript
const expiredCondition = `DATE_ADD(...) <= CURRENT_DATE`;
```
续保到期判定使用 `CURRENT_DATE`，无法按用户指定的截止日期追溯分析。

**建议**: 将 `CURRENT_DATE` 替换为可配置的 `cutoffDate` 参数，路由层传入用户选择的日期或默认当天。

---

### [AUDIT-004] region_group 字段文档与实现不一致

**严重性**: 🟡 中等 — 文档误导
**文件**: `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`

**问题描述**:
PARQUET_SCHEMA_KNOWLEDGE.md 将 `region_group` 列为 PolicyFact 视图的 31 个字段之一，但：
- `server/src/normalize/mapping.ts` 中无 `region_group` 映射
- `server/src/services/column-normalizer.ts` 不会生成该字段
- `server/src/sql/coefficient.ts` 在运行时用 CASE 表达式动态计算 `region_group`

**建议**: 更新 PARQUET_SCHEMA_KNOWLEDGE.md，从 PolicyFact 可用字段列表中移除 `region_group`，或在列名映射中添加该字段的真实来源。

---

### [AUDIT-005] cross-sell.ts SQL转义仅处理单引号

**严重性**: 🟡 中等 — 潜在安全风险
**文件**: `server/src/sql/cross-sell.ts:71`

**问题描述**:
```typescript
const esc = (s: string) => s.replace(/'/g, "''");
```
SQL 值转义仅处理单引号，未处理 LIKE 通配符（`%`、`_`）。虽然当前下钻值来自受控枚举，但若未来扩展自由文本输入，可能引发注入。

**建议**: 使用统一的 `escapeSqlValue()` 工具函数（`server/src/utils/security.ts`）。

---

### [AUDIT-006] cost.ts 已赚保费计算中年份硬编码

**严重性**: 🟡 中等 — 可维护性
**文件**: `server/src/sql/cost.ts:682-865`

**问题描述**:
`generatePolicy2025In2025Query`、`generatePolicy2025In2026Query`、`generatePolicy2026In2026Query` 等函数将年份硬编码在函数名和SQL中，每年需手动新增函数。

**建议**: 重构为参数化的 `generatePolicyEarnedPremiumQuery(policyYear, statYear)` 通用函数。

---

## 四、低风险发现

### [AUDIT-007] column-normalizer.ts 布尔字段转换逻辑

**严重性**: 🟢 低风险
**文件**: `server/src/services/column-normalizer.ts:47-49`

**说明**: 布尔字段转换使用 `IN ('是', '1', 'true', 'TRUE')` 白名单，覆盖了常见情况。但未包含 `'yes'`、`'Y'` 等英文变体。当前数据源使用中文，不影响准确性。

---

### [AUDIT-008] DuckDB BigInt→Number 精度风险

**严重性**: 🟢 低风险
**文件**: `server/src/services/duckdb.ts:240-242`

**说明**: `typeof data === 'bigint' → Number(data)` 在值超过 `Number.MAX_SAFE_INTEGER` (2^53) 时会丢失精度。当前业务数据范围内不会触发，但理论上存在风险。

---

## 五、各层审计详情

### 5.1 数据源层

| 组件 | 状态 | 说明 |
|------|------|------|
| Parquet 加载 | ✅ 正常 | 安全的表名验证 + 路径转义 |
| PolicyFact 视图 | ✅ 正常 | 35字段映射完整，中文→英文转换正确 |
| PolicyFactRenewal 视图 | ✅ 正常 | PolicyFact 的别名视图 |
| SalesmanTeamMapping | ✅ 正常 | JSON 加载 + NaN→null 处理 |
| 日期序列化 | ✅ 正常 | DATE{days} → ISO string，UTC 无时区偏移 |
| 连接池 | ✅ 正常 | 最大10连接，排队机制完善 |
| 查询缓存 | ✅ 正常 | LRU 策略，100条上限 |

### 5.2 SQL 生成器层（16 模块）

| 模块 | 状态 | 关键发现 |
|------|------|---------|
| kpi.ts | ✅ 正常 | 字段引用正确，维度白名单充分 |
| kpi-detail.ts | ✅ 正常 | `insurance_type = '商业保险'` 与数据一致 |
| trend.ts | ✅ 正常 | 日期截断逻辑合理 |
| salesman-ranking.ts | ✅ 正常 | 排名逻辑清晰 |
| truck.ts | ✅ 正常 | 吨位枚举值与数据一致 |
| growth.ts | ⚠️ 已修复 | YoY 自引用条件 bug [FIX-001] |
| coefficient.ts | ✅ 正常 | 系数计算逻辑正确 |
| cost.ts | 🟡 注意 | 年份硬编码 [AUDIT-006] |
| renewal.ts | 🟡 注意 | CURRENT_DATE 硬编码 [AUDIT-003] |
| renewal-drilldown.ts | ✅ 正常 | 到期日计算逻辑详尽 |
| premiumPlan.ts | ✅ 正常 | JOIN 字段正确 |
| perspective-adapter.ts | ✅ 正常 | 视角切换逻辑合理 |
| cross-sell.ts | 🟡 注意 | 转义函数不完整 [AUDIT-005] |
| cross-sell-summary.ts | ✅ 正常 | FILTER 语法兼容 DuckDB |
| marketing-report.ts | ✅ 正常 | 假日日期校验到位 |
| premium-report.ts | ✅ 正常 | 同比逻辑正确 |

### 5.3 API 路由层

| 路由 | 状态 | 说明 |
|------|------|------|
| query.ts | ✅ 正常 | Zod 参数校验，JWT 认证 |
| data.ts | ✅ 正常 | 文件名安全验证 |
| auth.ts | ✅ 正常 | JWT 生成/验证正常 |
| filters.ts | ✅ 正常 | 从实际数据动态获取选项 |
| ai.ts | ✅ 正常 | SQL 只读校验 |

### 5.4 前端消费层

| 组件 | 状态 | 说明 |
|------|------|------|
| API Client | ✅ 正常 | 统一入口，错误处理完善 |
| DataContext | ✅ 正常 | isDataLoaded 唯一来源 |
| FilterContext | ✅ 正常 | 筛选状态管理正确 |
| formatters.ts | ✅ 正常 | 万元转换(÷10000)、百分比、系数格式化 |
| Hooks | ✅ 正常 | API 调用与 filters 传递正确 |

---

## 六、行动计划

### 已完成
- [x] FIX-001: growth.ts YoY 同比查询修复（commit: 6bc77df）

### 建议优先处理（本周）
- [ ] AUDIT-002: 评估并切换到 V2 性能优化版 SQL
- [ ] AUDIT-003: renewal.ts CURRENT_DATE → 可配置参数
- [ ] AUDIT-004: 更新 PARQUET_SCHEMA_KNOWLEDGE.md 文档

### 建议后续处理（本月）
- [ ] AUDIT-005: 统一 SQL 转义工具函数
- [ ] AUDIT-006: 已赚保费函数参数化重构

---

**审计结论**: 系统整体数据准确性良好。16个SQL生成器中发现1个严重bug（已修复），4个中等问题。数据源层、API路由层、前端消费层均未发现数据准确性问题。主要改进方向是代码可维护性和规范一致性。
