import React, { useState, useMemo, useCallback } from 'react';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { PremiumDashboard } from '../dashboard/PremiumDashboard';
import { PdfExportService } from '../../services/PdfExportService';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { Logger } from '../../shared/utils/logger';
import { buttonStyles, cn, textStyles } from '../../shared/styles';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

const logger = new Logger('PremiumDashboardPage');

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export const PremiumDashboardPage: React.FC = () => {
  const { isDataLoaded } = useDataStatus();
  const { filters, setFilters } = useGlobalFilters();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [showCustomizerPanel, setShowCustomizerPanel] = useState(false);

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 保费分析看板` : '保费分析看板';
  }, [quickFilters]);

  const handleExportPdf = async () => {
    if (!isDataLoaded || isExportingPdf) return;

    const shouldRestoreCustomizer = showCustomizerPanel;

    try {
      if (shouldRestoreCustomizer) {
        setShowCustomizerPanel(false);
        await waitForNextFrame();
      }

      setIsExportingPdf(true);
      await PdfExportService.exportDashboardToPdf('premium-dashboard-content', '保费分析看板报告');
    } catch (err) {
      logger.error('PDF export failed', err);
      alert('PDF导出失败，请重试');
    } finally {
      setIsExportingPdf(false);
      if (shouldRestoreCustomizer) {
        setShowCustomizerPanel(true);
      }
    }
  };

  return (
    <PageFilterPanel
      preset="full"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'dashboard-kpi', label: 'KPI指标' },
        { id: 'dashboard-trend', label: '趋势分析' },
        { id: 'dashboard-table', label: '业务员明细' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions}>
          <button
            type="button"
            onClick={() => setShowCustomizerPanel((prev) => !prev)}
            disabled={isExportingPdf}
            className={cn(
              buttonStyles.base,
              buttonStyles.sizeSmall,
              showCustomizerPanel
                ? 'bg-primary-bg text-primary-dark border border-primary-border'
                : buttonStyles.secondary,
              textStyles.caption
            )}
          >
            自定义看板
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!isDataLoaded || isExportingPdf}
            className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.secondary, textStyles.caption)}
          >
            {isExportingPdf ? '正在导出...' : '导出PDF报告'}
          </button>
        </FilterQuickActions>
      )}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <PremiumDashboard showCustomizerPanel={showCustomizerPanel} />
    </PageFilterPanel>
  );
};
