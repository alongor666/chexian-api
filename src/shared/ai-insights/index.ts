/**
 * AI 洞察模块
 *
 * 提供页面内数据的 AI 智能分析能力
 */

// 类型导出
export type {
  Insight,
  InsightType,
  InsightAnalysisResult,
  DataContext,
  RenewalDataContext,
  InsightConfig,
  UsePageInsightsResult,
} from './types';

// 上下文构建器
export { buildRenewalContext, generateCacheKey, formatContextForAI } from './context-builder';

// 洞察生成器
export { generateInsights, isInsightConfigured } from './insight-generator';

// Prompts
export { getPromptByType, RENEWAL_INSIGHT_PROMPT, PREMIUM_INSIGHT_PROMPT, GENERIC_INSIGHT_PROMPT } from './prompts';

// Hook
export { usePageInsights } from './hooks/usePageInsights';

// 组件
export { InsightCard } from './components/InsightCard';
export { InsightPanel } from './components/InsightPanel';
