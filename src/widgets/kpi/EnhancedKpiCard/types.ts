/**
 * EnhancedKpiCard — 公共类型契约
 *
 * 从原 EnhancedKpiCard.tsx 870 行迁出的 6 个 public interface，
 * 通过 index.tsx 100% re-export，调用方零修改。
 */
import type { KpiStatus, StatusTone } from '@/shared/utils/kpiStatus';

/** 环形图数据项 */
export interface DonutDataItem {
  /** 标签（如"过户"、"非过户"） */
  label: string;
  /** 数值 */
  value: number | bigint;
  /** 颜色（可选） */
  color?: string;
}

/** Hero progress：达成进度（数值型 KPI，例如保费/件数） */
export interface KpiProgress {
  /** 当前达成百分数 0~100+ */
  value: number;
  /** 阈值百分数（如 99） */
  threshold: number;
  /** 右下角说明（如「目标 13,256 万元」） */
  note?: string;
}

/** Hero ring：达成率类（比率型 KPI） */
export interface KpiRing {
  /** 比率百分数 0~100+ */
  value: number;
  /** 阈值百分数（如 99） */
  threshold?: number;
  /** 反向指标（false=越大越好；通常达成率为 false） */
  reverse?: boolean;
}

/** Hero segments：多段占比拆解条（如 变动成本率 = 满期赔付率 + 费用率） */
export interface KpiSegment {
  label: string;
  /** 段值（百分数） */
  value: number;
  /** tone 决定颜色（沿用语义色） */
  tone: StatusTone;
}

/** Delta 涨跌指标 */
export interface KpiDelta {
  value: number;
  /** 单位：% / pt / null */
  unit?: '%' | 'pt' | '';
  /** 反向指标涨红跌绿 */
  reverse?: boolean;
  /** 文案（"同比" / "环比"） */
  label?: string;
}

/** EnhancedKpiCard 组件属性 */
export interface EnhancedKpiCardProps {
  /** KPI 标题 */
  title: string;
  /** KPI 数值（hero/standard 通用） */
  value?: number | string | bigint | null;
  /** 单位（如 "万元" "件" "%"），若 value 已自带单位可省略 */
  unit?: string;
  /** 格式化函数 */
  formatter?: (val: number) => string;
  /** 加载状态 */
  loading?: boolean;
  /** 卡片类型：value=纯数值, donut=环形图, bar=占比条 */
  type?: 'value' | 'donut' | 'bar';
  /** 变体：hero=巨数字+参照系（38px）；standard=普通卡（25px）；默认 standard */
  variant?: 'hero' | 'standard';
  /** 占比数据（type='donut'或'bar'时必填） */
  ratioData?: DonutDataItem[];
  /** 图表尺寸（默认60px） */
  chartSize?: number;
  /** Hero progress（数值型 hero 卡画进度条） */
  progress?: KpiProgress;
  /** Hero ring（比率型 hero 卡画环形） */
  ring?: KpiRing;
  /** Hero segments（拆解 hero 卡画多段条 + 阈值线） */
  segments?: KpiSegment[];
  /** segments 的阈值百分数（叠加阈值线） */
  segmentsThreshold?: number;
  /** Delta chip — 同比 */
  deltaYoY?: KpiDelta;
  /** Delta chip — 环比 */
  deltaMoM?: KpiDelta;
  /** Sparkline 微趋势（标准卡） */
  sparkline?: number[];
  /** 状态判定（驱动 status rail + ✓!） */
  status?: KpiStatus;
  /** 卡尾说明（如「阈值 91% · 健康」） */
  note?: string;
  /** 自定义类名 */
  className?: string;
  /** 点击回调 — 提供时卡片变可交互 */
  onClick?: () => void;
  /** 点击提示文案 */
  clickHint?: string;
}
