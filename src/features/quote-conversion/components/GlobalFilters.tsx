import { useMemo, useState } from 'react';
import { colorClasses, inputStyles, cn } from '../../../shared/styles';
import { CollapsibleFilterSection } from '@/shared/components/filters/CollapsibleFilterSection';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import type { QuoteFilters } from '../types';
import {
  CAT_NON_COMMERCIAL_PERSONAL,
  CAT_NON_COMMERCIAL_TRUCK,
  CAT_COMMERCIAL_TRUCK,
  CAT_NON_COMMERCIAL_ENTERPRISE,
  CAT_RENTAL,
  CAT_SPECIAL,
} from '../../../shared/config/customer-categories';

interface Props {
  filters: QuoteFilters;
  onChange: (filters: QuoteFilters) => void;
}

/**
 * 机构兜底名单 —— 仅在 /api/filters/options 尚未返回（或返回空）时使用；
 * 常规路径机构选项与全局筛选器同源（FilterContext.filterOptions.org_level_3），
 * 新增/调整机构无需改代码（2026-07-07 硬编码专项：原为写死 13 机构，跨省/新机构即过期）。
 */
const FALLBACK_ORGS = ['天府', '高新', '青羊', '宜宾', '新都', '德阳', '武侯', '资阳', '泸州', '乐山', '自贡', '达州', '本部'];

const FILTER_OPTIONS = {
  customerCategories: [
    CAT_NON_COMMERCIAL_PERSONAL,
    CAT_NON_COMMERCIAL_TRUCK,
    CAT_COMMERCIAL_TRUCK,
    CAT_NON_COMMERCIAL_ENTERPRISE,
    CAT_RENTAL,
    CAT_SPECIAL,
  ],
  insuranceCombos: ['主全', '交三'] as const,
  yesNo: ['是', '否'] as const,
  telemarketingOptions: ['电销', '非电销'] as const,
  riskGrades: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'X'],
} as const;

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

const selectCls = cn('text-xs px-2 py-1.5', inputStyles.base, inputStyles.default);

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | '';
  placeholder: string;
  options: readonly T[];
  onChange: (value: T | undefined) => void;
}

function SelectField<T extends string>({ label, value, placeholder, options, onChange }: SelectFieldProps<T>) {
  return (
    <label className="flex items-center gap-1">
      <span className={`text-xs whitespace-nowrap ${colorClasses.text.neutralMuted}`}>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
        className={selectCls}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function GlobalFilters({ filters, onChange }: Props) {
  const [quickKey, setQuickKey] = useState<string | null>(null);
  const { filterOptions } = useGlobalFilters();
  const orgOptions = useMemo(() => {
    const orgs = (filterOptions.org_level_3 ?? []).map((option) => option.value);
    return orgs.length > 0 ? orgs : FALLBACK_ORGS;
  }, [filterOptions.org_level_3]);
  const update = (patch: Partial<QuoteFilters>) => {
    setQuickKey(null);
    onChange({ ...filters, ...patch });
  };

  const applyQuick = (key: 'month' | 'quarter' | 'year') => {
    setQuickKey(key);
    onChange({ ...filters, ...getQuickDateRange(key) });
  };

  const hasFilters = Object.values(filters).some((value) => value !== undefined && value !== '');

  return (
    <CollapsibleFilterSection id="quote-conversion-filters" title="筛选条件" defaultExpanded={true}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>起始</span>
          <input
            aria-label="起始"
            type="date"
            value={filters.dateStart ?? ''}
            onChange={(e) => update({ dateStart: e.target.value || undefined })}
            className={selectCls}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>截止</span>
          <input
            aria-label="截止"
            type="date"
            value={filters.dateEnd ?? ''}
            onChange={(e) => update({ dateEnd: e.target.value || undefined })}
            className={selectCls}
          />
        </label>

        <div className="flex gap-1">
          {([['month', '本月'], ['quarter', '本季'], ['year', '本年']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyQuick(key)}
              className={cn(
                'text-xs px-2 py-1 rounded-md transition-colors',
                quickKey === key
                  ? 'bg-primary text-white'
                  : `${colorClasses.text.primary} hover:bg-primary-bg dark:hover:bg-primary-900/20`
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 hidden sm:block" />

        <SelectField
          label="续转保"
          value={filters.renewalType ?? ''}
          placeholder="全部续转保"
          options={['续保', '转保']}
          onChange={(renewalType) => update({ renewalType })}
        />
        <SelectField
          label="机构"
          value={filters.orgName ?? ''}
          placeholder="全部机构"
          options={orgOptions}
          onChange={(orgName) => update({ orgName })}
        />
        <SelectField
          label="客户类别"
          value={filters.customerCategory ?? ''}
          placeholder="全部类别"
          options={FILTER_OPTIONS.customerCategories}
          onChange={(customerCategory) => update({ customerCategory })}
        />
        <SelectField
          label="险别组合"
          value={filters.insuranceCombo ?? ''}
          placeholder="全部险别"
          options={FILTER_OPTIONS.insuranceCombos}
          onChange={(insuranceCombo) => update({ insuranceCombo })}
        />

        <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 hidden sm:block" />
        <SelectField
          label="电销"
          value={filters.isTelemarketing ?? ''}
          placeholder="全部电销"
          options={FILTER_OPTIONS.telemarketingOptions}
          onChange={(isTelemarketing) => update({ isTelemarketing })}
        />
        <SelectField
          label="新能源"
          value={filters.isNewEnergy ?? ''}
          placeholder="全部新能源"
          options={FILTER_OPTIONS.yesNo}
          onChange={(isNewEnergy) => update({ isNewEnergy })}
        />
        <SelectField
          label="过户车"
          value={filters.isTransferred ?? ''}
          placeholder="全部过户车"
          options={FILTER_OPTIONS.yesNo}
          onChange={(isTransferred) => update({ isTransferred })}
        />
        <SelectField
          label="车险分等级"
          value={filters.riskGrade ?? ''}
          placeholder="全部等级"
          options={FILTER_OPTIONS.riskGrades}
          onChange={(riskGrade) => update({ riskGrade })}
        />
        <label className="flex items-center gap-1">
          <span className={`text-xs whitespace-nowrap ${colorClasses.text.neutralMuted}`}>NCD 最小值</span>
          <input
            aria-label="NCD 最小值"
            type="number"
            min="0"
            max="100"
            step="1"
            value={filters.ncdMin ?? ''}
            onChange={(e) => update({ ncdMin: e.target.value || undefined })}
            className={selectCls}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className={`text-xs whitespace-nowrap ${colorClasses.text.neutralMuted}`}>NCD 最大值</span>
          <input
            aria-label="NCD 最大值"
            type="number"
            min="0"
            max="100"
            step="1"
            value={filters.ncdMax ?? ''}
            onChange={(e) => update({ ncdMax: e.target.value || undefined })}
            className={selectCls}
          />
        </label>

        {hasFilters && (
          <button
            onClick={() => {
              onChange({});
              setQuickKey(null);
            }}
            className={`text-xs px-2 py-1.5 rounded-md ${colorClasses.text.primary} hover:bg-primary-bg dark:hover:bg-primary-900/20 transition-colors`}
          >
            重置
          </button>
        )}
        </div>
      </div>
    </CollapsibleFilterSection>
  );
}
