import { useState } from 'react';
import { colorClasses, inputStyles, cn } from '../../../shared/styles';
import { CollapsibleFilterSection } from '../../filters/CollapsibleFilterSection';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
  onChange: (filters: QuoteFilters) => void;
}

const FILTER_OPTIONS = {
  orgs: ['天府','高新','青羊','宜宾','新都','德阳','武侯','资阳','泸州','乐山','自贡','达州','本部'],
  customerCategories: ['非营业个人客车','非营业货车','营业货车','非营业企业客车','营业出租租赁','特种车'],
  insuranceCombos: ['主全', '交三'] as const,
} as const;

/** 快捷日期区间 */
function getQuickDateRange(key: 'month' | 'quarter' | 'year'): { dateStart: string; dateEnd: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${y}-${pad(m + 1)}-${pad(now.getDate())}`;

  if (key === 'month') return { dateStart: `${y}-${pad(m + 1)}-01`, dateEnd: today };
  if (key === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { dateStart: `${y}-${pad(qStart + 1)}-01`, dateEnd: today };
  }
  return { dateStart: `${y}-01-01`, dateEnd: today };
}

const selectCls = cn('text-xs px-2 py-1.5', inputStyles.base, inputStyles.default, inputStyles.dark);

export function GlobalFilters({ filters, onChange }: Props) {
  const [quickKey, setQuickKey] = useState<string | null>(null);
  const update = (patch: Partial<QuoteFilters>) => {
    setQuickKey(null);
    onChange({ ...filters, ...patch });
  };

  const applyQuick = (key: 'month' | 'quarter' | 'year') => {
    setQuickKey(key);
    const range = getQuickDateRange(key);
    onChange({ ...filters, ...range });
  };

  const hasFilters = Object.values(filters).some(v => v !== undefined);

  return (
    <CollapsibleFilterSection id="quote-conversion-filters" title="筛选条件" defaultExpanded={true}>
      <div className="flex flex-wrap items-center gap-3">
        {/* 时间区间 */}
        <label className="flex items-center gap-1">
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>起始</span>
          <input
            type="date"
            value={filters.dateStart ?? ''}
            onChange={e => update({ dateStart: e.target.value || undefined })}
            className={selectCls}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>截止</span>
          <input
            type="date"
            value={filters.dateEnd ?? ''}
            onChange={e => update({ dateEnd: e.target.value || undefined })}
            className={selectCls}
          />
        </label>

        {/* 快捷日期 */}
        <div className="flex gap-1">
          {([['month', '本月'], ['quarter', '本季'], ['year', '本年']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => applyQuick(k)}
              className={cn(
                'text-xs px-2 py-1 rounded-md transition-colors',
                quickKey === k
                  ? 'bg-primary text-white'
                  : `${colorClasses.text.primary} hover:bg-blue-50 dark:hover:bg-blue-900/20`,
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 hidden sm:block" />

        {/* 业务维度筛选 */}
        <select
          value={filters.renewalType ?? ''}
          onChange={e => update({ renewalType: (e.target.value || undefined) as QuoteFilters['renewalType'] })}
          className={selectCls}
        >
          <option value="">全部续转保</option>
          <option value="续保">续保</option>
          <option value="转保">转保</option>
        </select>
        <select
          value={filters.orgName ?? ''}
          onChange={e => update({ orgName: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">全部机构</option>
          {FILTER_OPTIONS.orgs.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select
          value={filters.customerCategory ?? ''}
          onChange={e => update({ customerCategory: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">全部类别</option>
          {FILTER_OPTIONS.customerCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filters.insuranceCombo ?? ''}
          onChange={e => update({ insuranceCombo: (e.target.value || undefined) as QuoteFilters['insuranceCombo'] })}
          className={selectCls}
        >
          <option value="">全部险别</option>
          {FILTER_OPTIONS.insuranceCombos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {hasFilters && (
          <button
            onClick={() => { onChange({}); setQuickKey(null); }}
            className={`text-xs px-2 py-1.5 rounded-md ${colorClasses.text.primary} hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
          >
            重置
          </button>
        )}
      </div>
    </CollapsibleFilterSection>
  );
}
