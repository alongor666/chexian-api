# KPI 组件索引

## 组件清单

### KpiCard.tsx
**用途**: 基础 KPI 卡片组件，纯数值展示
**状态**: 生效中
**使用场景**: 简单的数值类 KPI 展示

### EnhancedKpiCard/（目录入口 = index.tsx）
**用途**: 增强型 KPI 卡片组件，hero/standard 双变体 + value/donut/bar 三类型 + 完整参照系
**状态**: 生效中（2026-01-09 新增；2026-06-17 PR #667 把 870 行单文件拆为目录 + 5 子文件）
**使用场景**:
- 数值类 KPI（type='value'）— 标准卡 25px / hero 卡 38px BAN + ProgressBar/RingChart 参照系
- 占比类 KPI + 迷你环形图（type='donut'）
- 多段占比条（type='bar'）+ hero 变体下的多段拆解（SegmentBarReference）

**目录结构（PR #667 拆分）**:
```
src/widgets/kpi/EnhancedKpiCard/
├─ index.tsx               主入口 + memo 主组件 + 6 个 public type re-export
├─ types.ts                6 个 public interface 定义
├─ utils.ts                DEFAULT_COLORS / SEGMENT_COLORS / toneColor / normalizeNumeric
├─ LegacyRatioParts.tsx    MiniDonutChart / ChartLegend / RatioBar（donut/bar 旧三件套）
├─ HeroReferenceParts.tsx  ProgressBar / RingChart / SegmentBarReference（Hero 参照系）
└─ StatusAtoms.tsx         DeltaChip / StatusTag / StatusRail / Sparkline（状态/微视图原子）
```
单测：`__tests__/EnhancedKpiCard.test.tsx`（27 case，jsdom vitest-component）

**关键特性**:
- 纯 SVG 自绘（MiniDonut / Ring / SegmentBar / Sparkline 均 jsdom 友好，无 ECharts/canvas 依赖）
- 设计简报 §1 七条法则：BAN 巨数字 + 参照系（progress/ring/segments + threshold）+ ✓!/▲▼ 预注意编码 + 左侧状态色边条 StatusRail
- 深色模式通过 CSS 变量自动适配
- 键盘可达性：onClick 时 role=button + Enter/Space 触发

**Props 接口**（完整签名，详见 `types.ts`）:
```typescript
export interface EnhancedKpiCardProps {
  title: string;                              // KPI 标题
  value?: number | string | bigint | null;    // KPI 数值（hero/standard 通用）
  unit?: string;                              // 单位（如"万元""件""%"）
  formatter?: (val: number) => string;        // 格式化函数
  loading?: boolean;                          // 加载状态（骨架占位）
  type?: 'value' | 'donut' | 'bar';           // 卡片类型
  variant?: 'hero' | 'standard';              // 变体（hero=38px 巨数字+参照系）
  ratioData?: DonutDataItem[];                // 占比数据（type='donut'/'bar'）
  chartSize?: number;                         // 图表尺寸（默认 60px）
  progress?: KpiProgress;                     // 数值型 hero 的达成进度条
  ring?: KpiRing;                             // 比率型 hero 的环形
  segments?: KpiSegment[];                    // 拆解 hero 的多段条
  segmentsThreshold?: number;                 // segments 阈值线百分数
  deltaYoY?: KpiDelta;                        // 同比涨跌 chip
  deltaMoM?: KpiDelta;                        // 环比涨跌 chip
  sparkline?: number[];                       // 标准卡微趋势
  status?: KpiStatus;                         // 状态判定（驱动 rail + ✓!）
  note?: string;                              // 卡尾说明
  className?: string;                         // 自定义类名
  onClick?: () => void;                       // 点击回调（提供时启用 role=button）
  clickHint?: string;                         // 点击 title 提示
}

// 其余 5 个公共类型（types.ts）
export interface DonutDataItem { label: string; value: number | bigint; color?: string }
export interface KpiProgress   { value: number; threshold: number; note?: string }
export interface KpiRing       { value: number; threshold?: number; reverse?: boolean }
export interface KpiSegment    { label: string; value: number; tone: StatusTone }
export interface KpiDelta      { value: number; unit?: '%' | 'pt' | ''; reverse?: boolean; label?: string }
```

### RenewalKpiFunnel.tsx
**用途**: 续保漏斗 KPI 卡片（流程图式展示：应续→报价→已续）
**状态**: 生效中

## 使用示例

```tsx
import { EnhancedKpiCard } from '../../widgets/kpi/EnhancedKpiCard';
import { extractDonutData } from '../../shared/sql/kpi-detail';

// 数值类 KPI（标准卡）
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

// Hero 变体（数值型 + 达成进度 + 同比环比）
<EnhancedKpiCard
  title="保费达成"
  variant="hero"
  type="value"
  value={12000}
  unit="万元"
  progress={{ value: 92.3, threshold: 99, note: '目标 13,256 万元' }}
  deltaYoY={{ value: 5.2 }}
  deltaMoM={{ value: -1.5 }}
/>

// Hero 变体（变动成本率拆解 segments）
<EnhancedKpiCard
  title="变动成本率"
  variant="hero"
  type="bar"
  value={88.5}
  segments={[
    { label: '满期赔付率', value: 64.4, tone: 'danger' },
    { label: '费用率',     value: 24.1, tone: 'warning' },
  ]}
  segmentsThreshold={91}
/>
```

## 相关文档

- [KPI口径说明](../../../开发文档/KPI口径说明.md) - KPI 计算口径定义
- [kpi-detail.ts](../../shared/sql/kpi-detail.ts) - KPI 详细数据 SQL 生成器
- [PremiumDashboard.tsx](../../features/dashboard/PremiumDashboard.tsx) - Dashboard 集成示例
- [kpiStatus.ts](../../shared/utils/kpiStatus.ts) - StatusTone / KpiStatus 类型来源
- [DESIGN.md §1](../../../DESIGN.md) - 设计简报七条法则（BAN / 参照系 / 预注意编码）

## 变更记录

| 日期 | 组件 | 变更内容 |
|------|------|---------|
| 2026-01-09 | EnhancedKpiCard.tsx | 新增增强型 KPI 卡片组件，支持环形图可视化 |
| 2026-06-17 | EnhancedKpiCard/ | PR #667：单文件 870 → 目录 + 5 子文件（types/utils/Legacy/Hero/Status）+ 主入口 321 行；新增 27 case oracle 单测；6 public export 100% 兼容（调用方零修改） |
