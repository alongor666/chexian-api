import React, { useState } from 'react';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { PremiumDashboard } from '../dashboard/PremiumDashboard';
import { PdfExportService } from '../../services/PdfExportService';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { Logger } from '../../shared/utils/logger';
import { buttonStyles, cn, textStyles } from '../../shared/styles';

const logger = new Logger('PremiumDashboardPage');

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export const PremiumDashboardPage: React.FC = () => {
  const { isDataLoaded } = useDataStatus();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [showCustomizerPanel, setShowCustomizerPanel] = useState(false);

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
      title="保费分析看板"
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
      <PremiumDashboard showCustomizerPanel={showCustomizerPanel} />
    </PageFilterPanel>
  );
};
