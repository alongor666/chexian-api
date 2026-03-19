/**
 * 本地意图解析器 — 主入口
 *
 * 聚合 capabilityMatcher + filterExtractor，输出 ParseResult。
 * 纯函数，<10ms 响应，零网络请求。
 */

import type { CapabilityInfo } from '@/shared/api/client';
import type { FilterOptions } from '@/shared/types/data';
import type { ParseResult, ExtractedFilters, QuickLink } from './types';
import { matchCapabilities } from './capabilityMatcher';
import { extractFilters } from './filterExtractor';

/** 置信度阈值（2 个关键词命中 = 40 分 → HIGH，足够明确） */
const HIGH_CONFIDENCE = 40;
const LOW_CONFIDENCE = 20;

/**
 * 生成快捷链接的展示标签
 *
 * 规则：
 *   有 org_level_3  → "{orgName}{capName}"
 *   有 salesman     → "{salesmanName}的{capName}"
 *   有日期          → "{capName}（本月）" 等
 *   无筛选          → "查看{capName}"
 */
function buildLabel(capName: string, filters: ExtractedFilters): string {
  const parts: string[] = [];

  if (filters.org_level_3 && filters.org_level_3.length > 0) {
    parts.push(filters.org_level_3[0]);
  }

  if (filters.salesman_name && filters.salesman_name.length > 0) {
    parts.push(filters.salesman_name[0]);
  }

  if (parts.length > 0) {
    return `${parts.join(' ')} ${capName}`;
  }

  if (filters.policy_date_start) {
    return `${capName}（${filters.policy_date_start} 起）`;
  }

  return `查看${capName}`;
}

export interface ParseOptions {
  /** 可注入固定日期，方便测试 */
  today?: Date;
  /** 权限过滤：仅保留这些路由对应的能力 */
  allowedRoutes?: string[];
}

/**
 * 主解析函数（纯函数，<10ms）
 *
 * @param input         - 用户输入文本
 * @param capabilities  - 能力列表（来自 /api/ai/capabilities 缓存）
 * @param filterOptions - 筛选选项（来自 FilterContext）
 * @param options       - 可选配置
 */
export function parseIntent(
  input: string,
  capabilities: readonly CapabilityInfo[],
  filterOptions: FilterOptions,
  options?: ParseOptions,
): ParseResult {
  const emptyResult: ParseResult = {
    confidence: 'none',
    links: [],
    extractedFilters: {},
    topScore: 0,
  };

  if (!input.trim() || capabilities.length === 0) {
    return emptyResult;
  }

  // 权限过滤
  const visibleCaps = options?.allowedRoutes
    ? capabilities.filter((c) => options.allowedRoutes!.includes(c.route))
    : capabilities;

  if (visibleCaps.length === 0) {
    return emptyResult;
  }

  // 1. 能力匹配
  const matches = matchCapabilities(input, visibleCaps, 3);

  // 2. 筛选参数提取
  const filters = extractFilters(input, filterOptions, options?.today);

  // 3. 计算置信度
  const topScore = matches.length > 0 ? matches[0].score : 0;
  const confidence: ParseResult['confidence'] =
    topScore >= HIGH_CONFIDENCE ? 'high' :
    topScore >= LOW_CONFIDENCE ? 'low' :
    'none';

  if (confidence === 'none') {
    return { ...emptyResult, extractedFilters: filters, topScore };
  }

  // 4. 生成快捷链接
  const links: QuickLink[] = matches.map((match, idx) => ({
    capability: match,
    filters,
    label: buildLabel(match.name, filters),
    isPrimary: idx === 0,
  }));

  return {
    confidence,
    links,
    extractedFilters: filters,
    topScore,
  };
}
