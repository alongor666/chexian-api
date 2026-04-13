/**
 * AI 洞察模块类型定义
 */

/**
 * 洞察类型
 */
export type InsightType =
  | 'warning'      // 告警：需要关注的问题
  | 'opportunity'  // 机会：可以改进的领域
  | 'highlight'    // 亮点：表现优异的地方
  | 'trend'        // 趋势：变化趋势分析
  | 'action';      // 行动：具体建议

/**
 * 单条洞察
 */
export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  metric?: {
    name: string;
    value: string | number;
    benchmark?: string | number;
    delta?: number;
    metricPolarity?: 'positive' | 'negative';
  };
  affectedEntities?: string[];  // 受影响的实体（如业务员名字）
  priority: 'high' | 'medium' | 'low';
}

/**
 * 洞察分析结果
 */
export interface InsightAnalysisResult {
  success: boolean;
  insights: Insight[];
  summary?: string;
  error?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  duration?: number;
}

/**
 * 数据上下文（传给AI的数据摘要）
 */
export interface DataContext {
  type: 'renewal' | 'premium' | 'cost' | 'growth';
  title: string;
  metrics: Record<string, number | string>;
  tableData?: Array<Record<string, unknown>>;
  filters?: Record<string, unknown>;
}

/**
 * 洞察生成配置
 */
export interface InsightConfig {
  maxInsights?: number;
  focusAreas?: string[];
  language?: 'zh' | 'en';
}

/**
 * 续保分析数据上下文（专用类型）
 * 用于 RenewalDrilldownPanel 的 AI 洞察
 */
export interface RenewalDataContext {
  type: 'renewal';
  kpi: {
    dueCount: number;
    renewedCount: number;
    quotedCount: number;
    duePremium: number;
    renewedPremium: number;
    quotedPremium: number;
    renewalRate: number;
    quoteRate: number;
    conversionRate: number;
  };
  top20Salesmen: Array<{
    name: string;
    org: string;
    dueCount: number;
    renewedCount: number;
    quotedCount: number;
    renewalRate: number;
    quoteRate: number;
    duePremium: number;
    renewedPremium: number;
  }>;
  filters?: {
    bundleOnly?: boolean;
    selfRenewalOnly?: boolean;
    dueMonth?: number | null;
    customerCategory?: string;
  };
}

/**
 * 页面洞察 Hook 返回值
 */
export interface UsePageInsightsResult {
  insights: Insight[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  generate: () => Promise<void>;
  reset: () => void;
  isConfigured: boolean;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  duration?: number;
}
