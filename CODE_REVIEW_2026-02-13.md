# 代码审查报告 - 2026-02-13

## 审查范围

5 个修改文件，346 行新增，79 行删除：
- `server/src/app.ts`
- `server/src/services/duckdb.ts`
- `src/features/dashboard/CrossSellAnalysisPanel.tsx`
- `src/features/dashboard/hooks/useCrossSellAnalysis.ts`
- `src/shared/api/client.ts`

## 发现的问题

### 🔴 High: `team` 维度在映射表缺失时会触发运行时失败

**位置：**
- `src/features/dashboard/hooks/useCrossSellAnalysis.ts:44`
- `server/src/services/duckdb.ts:208, 214`
- `server/src/app.ts:125`

**问题：** 用户选择 `team` 下钻时，SQL 会 `JOIN SalesmanTeamMapping`，若表不存在将直接报错 500。

**建议：** 在失败路径创建空表，或在后端能力不可用时禁止暴露 `team` 维度。

### 🟡 Medium: `NaN` 预处理方式过于宽泛

**位置：** `server/src/services/duckdb.ts:206`

**问题：** `replace(/\bNaN\b/g, 'null')` 会改写字符串值中的独立 `NaN`。

**建议：** 改为更结构化的解析/清洗策略。

### 🟡 Medium: 新增层层下钻功能缺少自动化测试

**涉及文件：**
- `src/features/dashboard/CrossSellAnalysisPanel.tsx`
- `src/features/dashboard/hooks/useCrossSellAnalysis.ts`
- `src/shared/api/client.ts`

**建议：** 补充 hook/API 单测验证：
- `drillPath/groupBy` 参数序列化与后端契约
- `drillUp` 回退层级正确性
- 多次快速点击下钻时的状态一致性

## 验证情况

- ✅ `bun run build`: 通过
- ⚠️ `bun run test`: 14 个失败用例（现有问题，非本次改动引入）
