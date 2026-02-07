# KPI 组件索引

## 组件清单

### KpiCard.tsx
**用途**: 基础 KPI 卡片组件，纯数值展示  
**状态**: 生效中  
**使用场景**: 简单的数值类 KPI 展示

### EnhancedKpiCard.tsx
**用途**: 增强型 KPI 卡片组件，支持环形图可视化  
**状态**: 生效中 (2026-01-09 新增)  
**使用场景**: 
- 数值类 KPI (type="value")
- 占比类 KPI + 迷你环形图 (type="donut")

**关键特性**:
- 轻量级 SVG 自绘环形图（无 ECharts 依赖）
- 布局: 左侧次要占比 + 右侧环形图 + 底部图例
- 环形图中心显示主要占比百分比
- 响应式设计

**Props 接口**:
```typescript
export interface EnhancedKpiCardProps {
  title: string;                    // KPI标题
  value: number | string;           // KPI数值
  formatter?: (val: number) => string;  // 格式化函数
  loading?: boolean;                // 加载状态
  type?: 'value' | 'donut';         // 卡片类型
  ratioData?: DonutDataItem[];      // 占比数据（type='donut'时必填）
  chartSize?: number;               // 图表尺寸（默认60px）
}

export interface DonutDataItem {
  label: string;  // 标签（如"过户"、"非过户"）
  value: number;  // 数值
  color?: string; // 颜色（可选）
}
```

## 使用示例

```tsx
import { EnhancedKpiCard } from '../../widgets/kpi/EnhancedKpiCard';
import { extractDonutData } from '../../shared/sql/kpi-detail';

// 数值类 KPI
<EnhancedKpiCard
  title="总保费"
  value={kpis.total_premium}
  formatter={formatPremium}
  type="value"
/>

// 占比类 KPI（启用环形图）
<EnhancedKpiCard
  title="过户占比"
  value={kpis.transfer_rate}
  formatter={formatRate}
  type="donut"
  ratioData={kpiDetails ? extractDonutData(kpiDetails, 'transfer') : []}
/>
```

## 相关文档

- [KPI口径说明](../../../开发文档/KPI口径说明.md) - KPI 计算口径定义
- [kpi-detail.ts](../../shared/sql/kpi-detail.ts) - KPI 详细数据 SQL 生成器
- [PremiumDashboard.tsx](../../features/dashboard/PremiumDashboard.tsx) - Dashboard 集成示例

## 变更记录

| 日期 | 组件 | 变更内容 |
|------|------|---------|
| 2026-01-09 | EnhancedKpiCard.tsx | 新增增强型 KPI 卡片组件，支持环形图可视化 |
