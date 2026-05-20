/**
 * Severity 类型 + 设计系统色映射 — 整个 claims-detail 域共享。
 *
 * 跨 Tab 复用：Tab 1 (未决赔案监控) / Tab 2 (地理风险热力图) / 后续 Tab 都用这一份。
 * 提到 shared/ 后，pending/insights.ts 和 pending/types.ts 通过 re-export
 * 维持对外 API 不变，旧引用无需迁移。
 */
export type Severity = 'bad' | 'warn' | 'good' | 'neutral';

/**
 * 严重度 → Tailwind 语义令牌映射
 * 与 src/shared/styles/index.ts 的 colorClasses 同源
 */
export function severityToColor(s: Severity): {
  text: string;
  bg: string;
  border: string;
  ring: string;
} {
  switch (s) {
    case 'bad':
      return {
        text: 'text-danger',
        bg: 'bg-danger-bg',
        border: 'border-danger-border',
        ring: 'bg-danger',
      };
    case 'warn':
      return {
        text: 'text-warning',
        bg: 'bg-warning-bg',
        border: 'border-warning-border',
        ring: 'bg-warning',
      };
    case 'good':
      return {
        text: 'text-success',
        bg: 'bg-success-bg',
        border: 'border-success-border',
        ring: 'bg-success',
      };
    default:
      return {
        text: 'text-neutral-400 dark:text-neutral-500',
        bg: 'bg-neutral-50 dark:bg-surface-2',
        border: 'border-neutral-200 dark:border-subtle',
        ring: 'bg-neutral-400',
      };
  }
}
