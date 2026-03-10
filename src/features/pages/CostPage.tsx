import React from 'react';
import { Link } from 'react-router-dom';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { buttonStyles, cardStyles, colorClasses, textStyles, cn } from '@/shared/styles';
import { ArrowRight } from 'lucide-react';
import { usePermission } from '@/shared/contexts/PermissionContext';
import { canAccessCost } from '@/shared/config/organizations';

export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();
  const { userPermission } = usePermission();

  const comprehensiveSwitch = import.meta.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS;
  const enableComprehensiveAnalysis =
    comprehensiveSwitch === 'true'
      || (comprehensiveSwitch !== 'false' && canAccessCost(userPermission?.username));

  return (
    <PageFilterPanel
      preset="cost"
      title="成本分析"
      basicFilterVisibleFields={{
        dateCriteria: true,
        analysisYear: true,
        dateRange: true,
        organization: true,
        coverageCombination: false,
        customerCategory: false,
        renewalMode: false,
      }}
      filterBarExtraContent={(
        <div className={cn(cardStyles.compact, 'space-y-1.5')}>
          <p className={cn(textStyles.caption, colorClasses.text.neutralDark)}>
            成本分析默认保留起保口径、年度、日期范围和机构筛选，细项维度由各子板块内部控制。
          </p>
        </div>
      )}
      headerRightContent={
        enableComprehensiveAnalysis ? (
          <Link
            to="/comprehensive-analysis"
            className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
          >
            进入综合分析
            <ArrowRight size={14} className="ml-1" />
          </Link>
        ) : null
      }
    >
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
    </PageFilterPanel>
  );
};
