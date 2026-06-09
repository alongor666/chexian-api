---
paths: ["src/shared/**"]
---

# 共享模块规则

## 组件/工具注册表

| 类别 | 位置 | 说明 |
|------|------|------|
| UI组件 | `src/widgets/INDEX.md` | Table、Card、Badge、Button 等 |
| 样式系统 | `src/shared/styles/index.ts` | tableStyles、textStyles、buttonStyles、colorClasses |
| API客户端 | `src/shared/api/`（`client.ts` 入口 + `client-core.ts` 传输内核 + 10 个 `*-api.ts` 命名空间子客户端） | 所有后端请求统一入口；调用形 `apiClient.{域}.方法()`（auth/ai/data/workflows/crossSell/performance/repair/claimsDetail/quoteConversion/customerFlow），核心查询与会话仍在 `apiClient.*` |
| 工具函数 | `src/shared/utils/formatters.ts` | 格式化（件数/均值/比率/保费/系数/图表） |
| 类型定义 | `src/shared/types/` | 通用+业务类型 |

### 样式与格式化规范

```typescript
// 样式：使用全局样式系统
import { tableStyles, textStyles, colorClasses } from '@/shared/styles';
// 禁止硬编码 className="text-red-800" / "bg-blue-600"

// 格式化：使用 formatters.ts
import { formatCount, formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
// 禁止 (premium / 10000).toFixed(2) 等硬编码格式化

// 数字字体：等宽对齐
<span className={textStyles.numeric}>{formatPremiumWan(premium)}</span>
```

**可用函数**：`formatCount`（件数）/ `formatAverage`（均值）/ `formatPercent`（百分比%）/ `formatPremiumWan`（保费万元）/ `formatCoefficient`（4位系数）/ `formatChartValue`（图表Y轴纯数字）

## INDEX.md 同步规则

修改 `src/shared/` / `src/features/` / `src/widgets/` / `scripts/` 时，**必须**更新对应 `INDEX.md`。

## 违规判定

| 违规 | 处理 |
|------|------|
| 新建函数但已存在同功能函数 | 删除，使用现有 |
| 硬编码 Tailwind 颜色/样式 | 重构为 `colorClasses` / `tableStyles` |
| 新增通用组件未在 INDEX.md 登记 | 补充登记后方可提交 |
