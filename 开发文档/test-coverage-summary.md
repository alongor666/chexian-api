# 测试覆盖率报告

**生成时间**: 2026-01-12
**测试框架**: Vitest 2.1.9
**覆盖率工具**: V8

---

## 📊 总览

| 指标 | 覆盖率 | 状态 |
|------|--------|------|
| **总测试数** | 304个（303 pass, 1 fail） | ⚠️ 有1个失败 |
| **快照数** | 28个 | ✅ |
| **函数覆盖率** | 80.77% | ✅ |
| **语句覆盖率** | 79.99% | ⚠️ 接近80%阈值 |
| **分支覆盖率** | - | - |
| **行覆盖率** | 79.99% | ⚠️ 接近80%阈值 |

---

## 🎯 格式化函数覆盖率

### formatters.ts
- **函数覆盖率**: 75%
- **行覆盖率**: 100% ✅
- **状态**: ✅ **优秀**

**覆盖的函数**:
- ✅ `formatPremium()` - 保费格式化（万元取整 + 千分位）
- ✅ `formatRate()` - 百分比格式化（1位小数）
- ✅ `formatNumber()` - 数字格式化（千分位分隔）

**测试覆盖**:
- ✅ 零值处理
- ✅ 边界值（0.05%, 极大值）
- ✅ NaN 和 Infinity 处理
- ✅ 千分位分隔符验证
- ✅ 四舍五入逻辑

### 快照测试详情
**文件**: `tests/formatters-snapshot.test.ts`
- **测试数**: 24个
- **快照数**: 23个（5个内联快照 + 18个文件快照）
- **状态**: ✅ 全部通过

**快照测试覆盖场景**:
1. **formatPremium**:
   - 零值、小数值、万级、亿元
   - 千分位分隔符
   - 四舍五入到万元
   - 负数、NaN、Infinity

2. **formatRate**:
   - 0%、小数百分比、整数百分比
   - 大于100%的值
   - 微小值、极大值

3. **formatNumber**:
   - 零值、小整数、千分位
   - 整数截断（无小数）

4. **边界值**:
   - NaN、Infinity
   - 一致性验证

---

## 📁 各文件覆盖率详情

| 文件 | 函数覆盖率 | 行覆盖率 | 状态 |
|------|-----------|---------|------|
| `src/shared/utils/formatters.ts` | 75% | 100% | ✅ 优秀 |
| `src/shared/normalize/mapping.ts` | 100% | 100% | ✅ 完美 |
| `src/shared/normalize/validator.ts` | 100% | 97.33% | ✅ 优秀 |
| `src/shared/utils/security.ts` | 100% | 100% | ✅ 完美 |
| `src/shared/sql/kpi-detail.ts` | 100% | 100% | ✅ 完美 |
| `src/shared/sql/renewal.ts` | 100% | 99.24% | ✅ 优秀 |
| `src/shared/utils/templateEngine.ts` | 100% | 97.65% | ✅ 优秀 |
| `src/shared/utils/logger.ts` | 75% | 98.57% | ✅ 良好 |
| `src/features/sql-query/ruleEngine/index.ts` | 100% | 88.13% | ✅ 良好 |
| `src/shared/sql/kpi.ts` | 75% | 81.36% | ✅ 良好 |
| `src/shared/utils/queryBuilder.ts` | 45.45% | 63.44% | ⚠️ 需改进 |
| `src/shared/utils/sql-validator.ts` | 71.43% | 54.72% | ⚠️ 需改进 |
| `src/features/filters/DateRangePicker.tsx` | 50% | 8.45% | ❌ 低覆盖率 |
| `src/features/sql-query/ruleEngine/patterns.ts` | 80.49% | 74.45% | ⚠️ 中等 |
| `src/shared/sql/trend.ts` | 20% | 16.44% | ❌ 低覆盖率 |

---

## ✅ 格式化统一性验证

### 验收标准
- [x] formatPremium 覆盖率 ≥ 90%（实际：100% 行覆盖率）
- [x] formatRate 覆盖率 ≥ 90%（实际：100% 行覆盖率）
- [x] formatNumber 覆盖率 ≥ 90%（实际：100% 行覆盖率）
- [x] 快照测试覆盖边界值
- [x] 快照测试覆盖 NaN/Infinity
- [x] 千分位分隔符一致性验证

### 测试结果
✅ **所有格式化函数通过统一性验证**

---

## 🔧 改进建议

### 高优先级
1. **修复失败的测试**:
   - ~~`tests/nl2sql-rule-engine.test.ts:278` - 示例查询转换失败~~（其引用的 `src/features/sql-query/` 已删除，测试文件已随 2026-07-05 测试审计移除）

2. **提高低覆盖率文件**:
   - `src/features/filters/DateRangePicker.tsx` (8.45%) - 添加组件渲染测试
   - `src/shared/sql/trend.ts` (16.44%) - 添加趋势 SQL 生成测试
   - `src/shared/utils/queryBuilder.ts` (63.44%) - 补充查询构建测试

### 中优先级
3. **补充集成测试**:
   - 图表组件交互测试
   - 筛选器联动测试
   - 数据加载流程测试

4. **性能测试**:
   - 大数据集渲染性能
   - DuckDB 查询性能
   - 组件重渲染优化

---

## 📋 测试命令

```bash
# 运行所有测试
bun test

# 运行测试并生成覆盖率
bun test --coverage

# 运行快照测试
bun test tests/formatters-snapshot.test.ts

# 更新快照
bun test -u

# 查看覆盖率报告（HTML）
open coverage/index.html
```

---

## 🎯 结论

**格式化统一性**: ✅ **达标**
- 所有格式化函数行覆盖率达到 100%
- 快照测试确保输出一致性
- 边界值和异常情况全覆盖

**整体测试覆盖率**: ⚠️ **接近目标**
- 总覆盖率 79.99%，接近 80% 阈值
- 建议补充低覆盖率文件的测试用例

**下一步行动**:
1. 修复 NL2SQL 测试失败
2. 补充 DateRangePicker 组件测试
3. 补充 trend.ts SQL 生成测试
4. 定期运行覆盖率报告（建议每周）

---

*本报告由 B044 任务生成 - 格式化统一性回归测试*
