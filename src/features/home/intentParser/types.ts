/**
 * 本地意图解析器 — 类型定义
 *
 * 纯前端关键词解析，<10ms 响应，零网络请求。
 */

/** 单个能力的匹配结果 */
export interface CapabilityMatch {
  id: string;
  route: string;
  name: string;
  description: string;
  /** 综合评分 0-100 */
  score: number;
  /** 命中的关键词列表 */
  matchedKeywords: string[];
}

/** 从用户输入提取的筛选参数（可直接 spread 进 AdvancedFilterState） */
export interface ExtractedFilters {
  org_level_3?: string[];
  salesman_name?: string[];
  customer_category?: string[];
  policy_date_start?: string; // YYYY-MM-DD
  policy_date_end?: string;   // YYYY-MM-DD
}

/** 一条可点击的快捷跳转链接 */
export interface QuickLink {
  capability: CapabilityMatch;
  filters: ExtractedFilters;
  /** 展示文本，如 "天府中支续保分析" */
  label: string;
  /** 是否为置信度最高的主匹配 */
  isPrimary: boolean;
}

/** parseIntent() 的返回值 */
export interface ParseResult {
  /**
   * high  (≥60):  显示 3 个链接，不调 AI
   * low   (20-59): 显示 3 个链接 + "AI 深度分析"按钮
   * none  (<20):  直接调后端 AI（原有逻辑）
   */
  confidence: 'high' | 'low' | 'none';
  /** 最多 3 个快捷链接 */
  links: QuickLink[];
  /** 提取到的筛选参数 */
  extractedFilters: ExtractedFilters;
  /** 最高评分 */
  topScore: number;
}
