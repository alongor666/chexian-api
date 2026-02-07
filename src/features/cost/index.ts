/**
 * 成本分析模块
 * Cost Analysis Module
 *
 * 提供赔付率、费用率、综合费用率、变动成本率分析功能
 */

// 组件
export { CostAnalysisPanel } from './components/CostAnalysisPanel';
export { CostAnalysisControlPanel } from './components/CostAnalysisControlPanel';
export { ClaimRatioTable } from './components/ClaimRatioTable';
export { NewEarnedPremiumTable } from './components/NewEarnedPremiumTable';

// Hooks
export { useCostAnalysis } from './hooks/useCostAnalysis';

// 类型
export * from './types/costTypes';
