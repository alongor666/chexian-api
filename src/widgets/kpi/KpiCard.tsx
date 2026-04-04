/**
 * KpiCard 组件
 * 基础 KPI 指标卡片，用于展示单个数值指标
 *
 * 使用统一设计系统：
 * - 卡片样式：bg-white rounded-lg border border-neutral-200 shadow-sm
 * - 标题样式：text-sm font-medium text-neutral-500
 * - 数值样式：text-2xl font-bold text-neutral-900
 * - 数值字体：Avenir Next / Century Gothic（Futura/Avenir 风格）
 */
import { memo } from 'react';
// font-kpi 类已在 CSS 中定义，无需 inline style

interface KpiCardProps {
  /** 指标标题 */
  title: string;
  /** 指标数值 */
  value: number | bigint | string | undefined;
  /** 数值格式化函数 */
  formatter?: (val: number | bigint) => string;
  /** 是否加载中 */
  loading?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 基础 KPI 卡片组件
 *
 * @example
 * <KpiCard title="总保费" value={123456} formatter={formatCurrency} />
 */
export const KpiCard = memo(function KpiCard({
  title,
  value,
  formatter,
  loading,
  className = '',
}: KpiCardProps) {
  const displayValue = loading
    ? '--'
    : value == null
      ? '-'
      : ((typeof value === 'number' || typeof value === 'bigint') && formatter
        ? formatter(value)
        : value);

  return (
    <div className={`bg-white p-5 rounded-xl shadow-sm border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800 transition-shadow hover:shadow-md ${className}`}>
      <h3 className="text-sm text-neutral-500 dark:text-neutral-400 font-medium mb-2">{title}</h3>
      <div
        className="text-3xl tracking-tight font-bold text-neutral-900 dark:text-white mt-1 leading-none font-kpi"
      >
        {String(displayValue)}
      </div>
    </div>
  );
});
