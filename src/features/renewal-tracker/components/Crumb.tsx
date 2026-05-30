/**
 * 面包屑 — 整体 › 机构 › 团队 › 业务员
 *
 * 末段为当前选中项，以 primary 高亮，让右栏「我正在看左边选中的谁」一目了然。
 */
import { cn, colorClasses } from '@/shared/styles';

interface Props {
  path: string[];
}

export default function Crumb({ path }: Props) {
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap text-xs', colorClasses.text.neutralLight)}>
      {path.map((seg, i) => {
        const last = i === path.length - 1;
        return (
          <span key={`${seg}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className={colorClasses.text.neutralMuted}>›</span>}
            {last ? (
              <span
                className={cn(
                  'px-2 py-0.5 rounded-md font-semibold',
                  colorClasses.bg.primary,
                  colorClasses.text.primaryDark,
                  colorClasses.border.primary,
                  'border',
                )}
              >
                {seg}
              </span>
            ) : (
              <span className={cn('font-semibold', colorClasses.text.neutralBlack)}>{seg}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
