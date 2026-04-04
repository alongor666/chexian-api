---
paths: ["src/**/*.tsx", "src/**/*.ts"]
---

# 前端开发规则

## DC-003 设计系统规范

本项目有一套严格的定制化设计系统，位于 `src/shared/styles/index.ts`。所有 UI 相关的开发**必须**使用这套系统，严禁手写离散的原生 Tailwind 颜色及布局类（如 `text-red-500`）。

### 强制排版规则（避免虚假 CSS 类）

**数字与数据展示**：
- **KPI 大数字**：强制使用 `className={fontStyles.kpi}` (通过 `import { fontStyles } from '@/shared/styles'`)
- **图表/表格数字**：强制使用 `className={fontStyles.numeric}`（已合并原 chart+tabular，保障数字等宽对齐）

**禁用虚构类名**：不要使用诸如 `<span className="font-kpi text-xl">` 这种原生的字符串注入，因为 tailwind.config 并没有将其注册为标准原子类，这会导致样式静默失效。

### 颜色语义化

不要硬编码任何颜色。必须使用全局的颜色导入：

```typescript
import { colorClasses, semanticColors, getTrendColorClass } from '@/shared/styles';
import { cn } from '@/shared/styles';
```

**应用策略**:
- **增长/成功/正面**: `colorClasses.text.success` (绿色)
- **下降/警告/负面**: `colorClasses.text.danger` (红色)
- **标签与辅助文字**: `colorClasses.text.neutralMuted` (灰色)
- **动态趋势文字颜色**: 使用 `className={getTrendColorClass(value)}`

**颜色映射快查**：
```
text-red-800   → colorClasses.text.dangerDark
text-green-600 → colorClasses.text.positive
bg-red-50      → colorClasses.bg.danger
bg-gray-50     → colorClasses.bg.neutral
```

### 组件级封装引用

开发新区块时，**严禁重写一长串 Tailwind 控制符**（如 `bg-white dark:bg-neutral-800 rounded-xl shadow-md p-6 border` 等）。
必须使用现成预设：
- 卡片（Card）：`<div className={cardStyles.base}>` 或使用 `src/shared/ui/Card.tsx` 包装器
- 按钮（Button）：`<div className={buttonStyles.primary}>` 或使用 `src/shared/ui/Button.tsx`

图表年份颜色：`import { getYearChartColor } from '@/shared/styles';`

参考：[src/shared/styles/index.ts](src/shared/styles/index.ts)

## 防御性编码（项目特有陷阱）

`row.time_period` 可能为 undefined — 必须先 `?? ''` 再 `.includes()`。图表/表格组件中所有 DuckDB 返回字段都需空值防护。

## 渲染循环排查

useEffect 依赖数组检查 → React DevTools Profiler → 稳定化 filters 引用。
