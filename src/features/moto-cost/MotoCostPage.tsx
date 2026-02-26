/**
 * 摩意模型页面
 *
 * 使用车险平台设计系统重构的摩托车成本计算器
 */
import React, { useState, useMemo, useCallback } from 'react';
import { cardStyles, textStyles, colorClasses, buttonStyles, badgeStyles } from '@/shared/styles';
import { cn } from '@/shared/styles';
import { performCalculations, calculateBreakEvenAnalysis, calculateMotoPremiumRatio, calculateMotoHandlingFeeRate } from './services/calculator';
import { DEFAULT_INPUTS, SCHEMES, type MotoCostInputs, type AnalysisTab, type Scheme } from './types';
import { MotoCostKpiCards } from './components/MotoCostKpiCards';
import { MotoCostCharts } from './components/MotoCostCharts';
import { MotoCostDrawer } from './components/MotoCostDrawer';

// 图标组件
const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <line x1="4" y1="21" x2="4" y2="14"></line>
    <line x1="4" y1="10" x2="4" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12" y2="3"></line>
    <line x1="20" y1="21" x2="20" y2="16"></line>
    <line x1="20" y1="12" x2="20" y2="3"></line>
    <line x1="1" y1="14" x2="7" y2="14"></line>
    <line x1="9" y1="8" x2="15" y2="8"></line>
    <line x1="17" y1="16" x2="23" y2="16"></line>
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
  </svg>
);

const HelpIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
  </svg>
);

export const MotoCostPage: React.FC = () => {
  // 状态
  const [inputs, setInputs] = useState<MotoCostInputs>(DEFAULT_INPUTS);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('combined');
  const [activeScheme, setActiveScheme] = useState<Scheme>(SCHEMES[1]); // 默认保本
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  // 计算结果
  const calculation = useMemo(() => performCalculations(inputs), [inputs]);
  const breakEven = useMemo(() => calculateBreakEvenAnalysis(inputs), [inputs]);

  // 更新输入参数
  const updateInput = useCallback(<K extends keyof MotoCostInputs>(key: K, value: MotoCostInputs[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  }, []);

  // 应用方案
  const applyScheme = useCallback((scheme: Scheme) => {
    setActiveScheme(scheme);
    setInputs(prev => ({ ...prev, carLossRatio: scheme.carLossRatio }));
  }, []);

  // 重置参数
  const resetInputs = useCallback(() => {
    setInputs(DEFAULT_INPUTS);
    setActiveScheme(SCHEMES[1]);
  }, []);

  // 导出数据
  const exportData = useCallback(() => {
    // TODO: 实现 CSV 导出
    alert('导出功能开发中...');
  }, []);

  // 智能洞察文本
  const insightText = useMemo(() => {
    const profit = calculation.combined.absolute[6];
    const tcr = calculation.combined.rate[0] * 100;
    const isProfit = profit >= 0;

    return isProfit
      ? `当前盈利 ${profit.toFixed(1)} 万元，综合成本率 ${tcr.toFixed(1)}%，表现良好。`
      : `当前亏损 ${Math.abs(profit).toFixed(1)} 万元，综合成本率 ${tcr.toFixed(1)}%，需优化赔付率控制。`;
  }, [calculation]);

  return (
    <div className="h-full flex flex-col bg-neutral-50">
      {/* 页面标题栏 */}
      <div className="flex-shrink-0 bg-white border-b border-neutral-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={textStyles.titleLarge}>摩意模型</h1>
            <p className={textStyles.caption}>车险 + 摩意险成本测算与盈亏平衡分析</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 方案选择 */}
            <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
              {SCHEMES.map(scheme => (
                <button
                  key={scheme.key}
                  onClick={() => applyScheme(scheme)}
                  className={cn(
                    'px-3 py-2 text-sm font-medium transition-colors',
                    activeScheme.key === scheme.key
                      ? 'text-white'
                      : 'bg-white text-neutral-600 hover:bg-neutral-50'
                  )}
                  style={activeScheme.key === scheme.key ? { backgroundColor: scheme.color } : undefined}
                >
                  {scheme.label}
                </button>
              ))}
            </div>
            {/* 操作按钮 */}
            <button onClick={exportData} className={cn(buttonStyles.base, buttonStyles.secondary, buttonStyles.sizeMedium)}>
              <DownloadIcon />
              <span>导出</span>
            </button>
            <button onClick={() => setHelpModalOpen(true)} className={cn(buttonStyles.base, buttonStyles.secondary, buttonStyles.sizeMedium)}>
              <HelpIcon />
              <span>帮助</span>
            </button>
            <button onClick={() => setDrawerOpen(true)} className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeMedium)}>
              <SettingsIcon />
              <span>参数</span>
            </button>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 状态概览 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className={cn(cardStyles.standard, 'flex items-center gap-3')}>
            <span className={textStyles.caption}>当前方案</span>
            <span className={cn(badgeStyles.base, badgeStyles.primary)}>{activeScheme.label}</span>
          </div>
          <div className={cn(cardStyles.standard, 'flex items-center gap-3')}>
            <span className={textStyles.caption}>摩意险保费配比</span>
            <span className={textStyles.label}>{(breakEven.motoPremiumRatio * 100).toFixed(1)}%</span>
          </div>
          <div className={cn(cardStyles.standard, 'flex items-center gap-3', colorClasses.bg.success)}>
            <span className={textStyles.caption}>体验提示</span>
            <span className={textStyles.label}>实时测算已开启，调整参数即可秒级获得趋势</span>
          </div>
        </div>

        {/* 智能洞察 */}
        <div className={cn(cardStyles.standard, 'mb-6', colorClasses.bg.primary)}>
          <div className="flex items-start justify-between">
            <div>
              <p className={cn(textStyles.caption, 'uppercase tracking-wider mb-1')}>智能洞察</p>
              <h2 className={cn(textStyles.titleMedium, 'mb-2')}>盈亏平衡分析</h2>
              <p className={textStyles.body}>{insightText}</p>
            </div>
          </div>
        </div>

        {/* KPI 卡片 */}
        <MotoCostKpiCards calculation={calculation} />

        {/* 分析区 */}
        <div className="mt-6">
          {/* Tab 切换 */}
          <div className="flex gap-1 border-b border-neutral-200 mb-4">
            {[
              { key: 'combined', label: '车+摩意整体' },
              { key: 'car', label: '车险专项' },
              { key: 'moto', label: '摩意险专项' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as AnalysisTab)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 图表 */}
          <MotoCostCharts
            calculation={calculation}
            activeTab={activeTab}
          />
        </div>
      </div>

      {/* 参数抽屉 */}
      <MotoCostDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        inputs={inputs}
        onUpdate={updateInput}
        onReset={resetInputs}
        onApply={() => setDrawerOpen(false)}
      />

      {/* 帮助模态框 */}
      {helpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn(cardStyles.standard, 'max-w-lg w-full mx-4')}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={textStyles.titleMedium}>计算公式说明</h3>
              <button onClick={() => setHelpModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <p className={textStyles.body}>
              参数调整后，系统会自动重新计算所有相关的成本和盈利指标。
            </p>
            <p className={cn(textStyles.body, 'mt-2')}>
              如需了解具体的计算逻辑，请参考系统内的实时计算结果。
            </p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setHelpModalOpen(false)}
                className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeMedium)}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotoCostPage;
