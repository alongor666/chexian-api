import React from 'react';
import { cn, colorClasses } from '@/shared/styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DrilldownBreadcrumbStep {
  label: string;
  dimension?: string;
  value?: string;
}

export interface DrilldownBreadcrumbProps {
  /** 下钻路径 */
  path: DrilldownBreadcrumbStep[];
  /** 点击回退到某层（index=-1 回到顶层） */
  onNavigate: (toIndex: number) => void;
  /** 顶层标签（必传：调用方按当前省 branchCompanyName(effectiveBranch) 提供，杜绝默认值硬编码省份 — codex 闸-2 P1-1） */
  topLabel: string;
  /** 是否允许回到顶层（RBAC 约束） */
  canGoToTop?: boolean;
  /** 维度标签映射（用于 tooltip） */
  dimensionLabels?: Record<string, string>;
  /** 当前分组维度名 */
  currentGroupBy?: string | null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const LINK_CLASS = cn(
  'px-2 py-1 rounded transition-colors cursor-pointer',
  colorClasses.text.primary,
  'hover:bg-primary-bg',
);

const ACTIVE_CLASS = cn(
  'px-2 py-1 rounded font-semibold',
  colorClasses.text.neutralDark,
  colorClasses.bg.neutralLight,
);

const TOP_ACTIVE_CLASS = cn(
  'px-2 py-1 rounded font-semibold',
  colorClasses.text.primary,
  colorClasses.bg.primary,
);

// ─── Component ───────────────────────────────────────────────────────────────

export const DrilldownBreadcrumb: React.FC<DrilldownBreadcrumbProps> = ({
  path,
  onNavigate,
  topLabel,
  canGoToTop = true,
  dimensionLabels,
  currentGroupBy,
}) => {
  const isAtTop = path.length === 0 && !currentGroupBy;

  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="下钻路径">
      {/* Top level */}
      {canGoToTop ? (
        <button
          type="button"
          onClick={() => onNavigate(-1)}
          className={isAtTop ? TOP_ACTIVE_CLASS : LINK_CLASS}
        >
          {topLabel}
        </button>
      ) : (
        <span className={ACTIVE_CLASS}>{topLabel}</span>
      )}

      {/* Path steps */}
      {path.map((step, idx) => {
        const isLast = idx === path.length - 1 && !currentGroupBy;
        const dimLabel = step.dimension && dimensionLabels
          ? dimensionLabels[step.dimension]
          : undefined;
        const key = step.dimension && step.value
          ? `${step.dimension}-${step.value}`
          : `step-${idx}`;

        return (
          <React.Fragment key={key}>
            <span className={colorClasses.text.neutralMuted}>/</span>
            {isLast ? (
              <span className={ACTIVE_CLASS} title={dimLabel}>
                {step.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(idx)}
                className={LINK_CLASS}
                title={dimLabel}
              >
                {step.label}
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* Current groupBy indicator */}
      {currentGroupBy && dimensionLabels && (
        <>
          <span className={colorClasses.text.neutralMuted}>/</span>
          <span className={ACTIVE_CLASS}>
            {dimensionLabels[currentGroupBy] ?? currentGroupBy}
          </span>
        </>
      )}
    </nav>
  );
};
