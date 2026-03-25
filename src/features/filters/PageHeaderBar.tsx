import React, { useMemo, type ReactNode } from 'react';
import { cn, colorClasses } from '../../shared/styles';
import type { AdvancedFilterState } from '../../shared/types/data';
import { useScopeLabel } from '../../shared/hooks/useScopeLabel';

interface PageHeaderBarProps {
  /** 页面基础标题（如"保费分析"、"交叉销售分析"） */
  baseTitle: string;
  filters: AdvancedFilterState;
  /** 可见机构总数（用于判断是否为全选） */
  allOrgCount?: number;
  /** 业务员→团队名映射（用于动态标题中的团队层级） */
  salesmanTeamMap?: Map<string, string>;
  /** 标题右侧扩展内容（如页面级快捷切换） */
  rightContent?: ReactNode;
  /** 标题下方左侧扩展内容 */
  bottomLeftContent?: ReactNode;
  /** 已选条件 chips 对齐方式 */
  chipsAlign?: 'left' | 'right';
  /** 隐藏筛选条件 chips（数据先行模式） */
  hideChips?: boolean;
}

/**
 * 页面标题栏组件 — sticky top-0 置顶
 *
 * 显示动态标题 + 已筛选条件摘要（极简 chips）
 *
 * 标题规则（范围从窄到宽）：
 * 1. 单个业务员 → "{机构}{业务员}{baseTitle}"（如"天府罗磊交叉销售分析"）
 * 2. 多个业务员（同一机构） → "{机构}{baseTitle}"
 * 3. 单个机构（无业务员筛选） → "{机构}{baseTitle}"（如"天府保费分析"）
 * 4. 多个/全部机构 → "四川分公司{baseTitle}"
 */
const EMPTY_TEAM_MAP = new Map<string, string>();

export const PageHeaderBar: React.FC<PageHeaderBarProps> = ({
  baseTitle,
  filters,
  allOrgCount = 12,
  salesmanTeamMap = EMPTY_TEAM_MAP,
  rightContent,
  bottomLeftContent,
  chipsAlign = 'left',
  hideChips = false,
}) => {
  // 计算动态标题前缀（含机构/团队/业务员层级）
  const { prefix: dynamicTitle } = useScopeLabel(filters, salesmanTeamMap);

  const fullTitle = `${dynamicTitle}${baseTitle}`;

  // 计算已筛选条件的摘要 chips（不重复显示标题中已包含的范围信息）
  const filterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];

    // 年度（始终显示）
    if (filters.analysis_year) {
      chips.push({ key: 'year', label: `${filters.analysis_year}年` });
    }

    // 口径
    const criteriaLabel = filters.date_criteria === 'policy_date' ? '签单' : '起保';
    chips.push({ key: 'criteria', label: criteriaLabel });

    // 机构（仅在多机构时显示，单机构已在标题中）
    const selectedOrgs = filters.org_level_3 || [];
    if (selectedOrgs.length > 1) {
      chips.push({ key: 'org', label: `${selectedOrgs[0]}+${selectedOrgs.length - 1}` });
    }
    // 如果机构数等于全部机构数，显示"全部机构"
    if (selectedOrgs.length === 0 || selectedOrgs.length === allOrgCount) {
      // 全部机构时不显示（标题已经是四川分公司）
    }

    // 客户类别
    if (filters.customer_category && filters.customer_category.length > 0) {
      chips.push({ key: 'category', label: `${filters.customer_category.length}类别` });
    }

    // 险别组合
    if (filters.coverage_combination && filters.coverage_combination.length > 0) {
      chips.push({ key: 'coverage', label: filters.coverage_combination.join('/') });
    }

    // 续保模式
    if (filters.renewal_mode && filters.renewal_mode.length > 0) {
      chips.push({ key: 'renewal', label: filters.renewal_mode.join('/') });
    }

    // 业务员（仅在多业务员时显示，单业务员已在标题中）
    const selectedSalesmen = filters.salesman_name || [];
    if (selectedSalesmen.length > 1) {
      chips.push({ key: 'salesman', label: `${selectedSalesmen.length}业务员` });
    }

    // 布尔字段
    if (filters.is_nev === true) chips.push({ key: 'nev', label: '新能源' });
    if (filters.is_new_car === true) chips.push({ key: 'new_car', label: '新车' });
    if (filters.is_telemarketing === true) chips.push({ key: 'telemarketing', label: '电销' });
    if (filters.is_transfer === true) chips.push({ key: 'transfer', label: '过户' });
    if (filters.is_cross_sell === true) chips.push({ key: 'cross_sell', label: '交叉销售' });
    if (filters.is_commercial_insure === true) chips.push({ key: 'commercial', label: '交商同保' });
    if (filters.is_renewal === true) chips.push({ key: 'renewal_bool', label: '续保' });

    // 风险等级
    if (filters.insurance_grade && filters.insurance_grade.length > 0) {
      chips.push({ key: 'grade', label: `风险${filters.insurance_grade.join('/')}级` });
    }

    // 日期范围（非全年时显示）
    const start = filters.policy_date_start;
    const end = filters.policy_date_end;
    if (start && end) {
      const startMonth = start.substring(5); // MM-DD
      const endMonth = end.substring(5);
      // 不是全年时才显示
      if (!startMonth.startsWith('01-01') || !endMonth.endsWith('12-31')) {
        chips.push({ key: 'date', label: `${startMonth}~${endMonth}` });
      }
    }

    return chips;
  }, [filters, allOrgCount]);

  return (
    <div className="bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={cn('text-lg font-semibold', colorClasses.text.neutralBlack)}>{fullTitle}</h1>
        {rightContent && (
          <div className="max-w-full flex-shrink-0">
            {rightContent}
          </div>
        )}
      </div>
      {(bottomLeftContent || (!hideChips && filterChips.length > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {bottomLeftContent && <div className="flex-1 min-w-0">{bottomLeftContent}</div>}
          {!hideChips && filterChips.length > 0 && (
            <div
              className={cn(
                'flex flex-wrap gap-1',
                bottomLeftContent || chipsAlign === 'right' ? 'ml-auto justify-end' : 'justify-start'
              )}
            >
              {filterChips.map(chip => (
                <span
                  key={chip.key}
                  className={cn(
                    'inline-flex items-center gap-1',
                    'px-2 py-0.5 rounded-md text-[11px] font-medium',
                    'bg-primary-bg text-primary-dark border border-primary-border'
                  )}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
