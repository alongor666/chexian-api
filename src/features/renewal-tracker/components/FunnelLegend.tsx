/**
 * 漏斗 + 健康线图例 — 表格底部说明色彩语义
 */
import { cn, colorClasses } from '@/shared/styles';

function Key({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('w-2.5 h-2.5 rounded-sm inline-block', swatch)} />
      {label}
    </span>
  );
}

export default function FunnelLegend() {
  return (
    <div className={cn('flex items-center gap-3.5 flex-wrap text-[11px]', colorClasses.text.neutralLight)}>
      <Key swatch="bg-primary" label="已续 C" />
      <Key swatch="bg-primary-border" label="报价未续 B−C" />
      <Key swatch="bg-neutral-200 dark:bg-white/10" label="未报价 A−B" />
      <span className="ml-1">
        <Key swatch="bg-danger" label="续保率低于健康线" />
      </span>
    </div>
  );
}
