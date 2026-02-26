import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../shared/styles';
import type { AdvancedFilterState } from '../../shared/types/data';

interface PageHeaderBarProps {
  title: string;
  filters: AdvancedFilterState;
}

/**
 * 页面标题栏组件 — sticky top-0 置顶
 *
 * 显示页面标题 + 已筛选条件摘要（极简 chips）
 */
export const PageHeaderBar: React.FC<PageHeaderBarProps> = ({ title, filters }) => {
  // 计算已筛选条件的摘要 chips
  const filterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];

    // 年度（始终显示）
    if (filters.analysis_year) {
      chips.push({ key: 'year', label: `${filters.analysis_year}年` });
    }

    // 口径
    const criteriaLabel = filters.date_criteria === 'policy_date' ? '签单' : '起保';
    chips.push({ key: 'criteria', label: criteriaLabel });

    // 机构
    if (filters.org_level_3 && filters.org_level_3.length > 0) {
      const count = filters.org_level_3.length;
      if (count === 1) {
        chips.push({ key: 'org', label: filters.org_level_3[0] });
      } else {
        chips.push({ key: 'org', label: `${filters.org_level_3[0]}+${count - 1}` });
      }
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

    // 业务员
    if (filters.salesman_name && filters.salesman_name.length > 0) {
      chips.push({ key: 'salesman', label: `${filters.salesman_name.length}业务员` });
    }

    // 布尔字段
    if (filters.is_nev === true) chips.push({ key: 'nev', label: '新能源' });
    if (filters.is_new_car === true) chips.push({ key: 'new_car', label: '新车' });
    if (filters.is_telemarketing === true) chips.push({ key: 'telemarketing', label: '电销' });
    if (filters.is_transfer === true) chips.push({ key: 'transfer', label: '过户' });
    if (filters.is_cross_sell === true) chips.push({ key: 'cross_sell', label: '交叉销售' });
    if (filters.is_commercial_insure === true) chips.push({ key: 'commercial', label: '交商同保' });
    if (filters.is_renewal === true) chips.push({ key: 'renewal', label: '续保' });

    // 等级评分
    if (filters.insurance_grade && filters.insurance_grade.length > 0) {
      chips.push({ key: 'grade', label: filters.insurance_grade.join('/') + '级' });
    }
    if (filters.small_truck_score && filters.small_truck_score.length > 0) {
      chips.push({ key: 'small_truck', label: `小${filters.small_truck_score.join('/')}` });
    }
    if (filters.large_truck_score && filters.large_truck_score.length > 0) {
      chips.push({ key: 'large_truck', label: `大${filters.large_truck_score.join('/')}` });
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
  }, [filters]);

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-neutral-200 shadow-sm px-4 py-2.5">
      <h1 className="text-lg font-semibold text-neutral-800">{title}</h1>
      {filterChips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
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
  );
};
