/**
 * 能力关键词匹配器
 *
 * 权重评分算法，纯函数，不依赖 React。
 * 从 CapabilityInfo 的 keywords / exampleQueries / name 计算匹配分数。
 */

import type { CapabilityInfo } from '@/shared/api/client';
import type { CapabilityMatch } from './types';

/** 评分权重常量 */
const KEYWORD_EXACT_SCORE = 20;
const KEYWORD_EXACT_CAP = 60;
const EXAMPLE_SCORE = 15;
const EXAMPLE_CAP = 30;
const NAME_FULL_SCORE = 25;
const NAME_PARTIAL_SCORE = 10;
const KEYWORD_SUBSTR_SCORE = 8;
const KEYWORD_SUBSTR_CAP = 16;
const MULTI_KEYWORD_BONUS = 10;
const MULTI_KEYWORD_THRESHOLD = 3;
const MAX_SCORE = 100;

/** 最短子串长度（防止"的"等单字误匹配） */
const MIN_KEYWORD_LEN = 2;

/**
 * 对单个能力计算匹配评分
 */
function scoreCapability(input: string, cap: CapabilityInfo): CapabilityMatch {
  const matchedKeywords: string[] = [];
  let rawScore = 0;

  // A. 精确关键词匹配：input 包含 keyword
  let keywordExactTotal = 0;
  for (const kw of cap.keywords) {
    if (kw.length >= MIN_KEYWORD_LEN && input.includes(kw)) {
      matchedKeywords.push(kw);
      keywordExactTotal += KEYWORD_EXACT_SCORE;
    }
  }
  rawScore += Math.min(keywordExactTotal, KEYWORD_EXACT_CAP);

  // B. 示例查询匹配：input 包含示例 或 示例包含 input
  let exampleTotal = 0;
  for (const example of cap.exampleQueries) {
    if (input.includes(example) || example.includes(input)) {
      exampleTotal += EXAMPLE_SCORE;
    }
  }
  rawScore += Math.min(exampleTotal, EXAMPLE_CAP);

  // C. 能力名称匹配
  if (input.includes(cap.name)) {
    rawScore += NAME_FULL_SCORE;
  } else if (cap.name.length >= MIN_KEYWORD_LEN && namePartialMatch(input, cap.name)) {
    rawScore += NAME_PARTIAL_SCORE;
  }

  // D. 关键词子串包含（keyword 部分出现在 input 中）
  let substrTotal = 0;
  for (const kw of cap.keywords) {
    if (kw.length >= 3 && !matchedKeywords.includes(kw)) {
      // 关键词的子串在输入中（或输入的子串在关键词中）
      if (input.includes(kw) || kw.includes(input)) {
        substrTotal += KEYWORD_SUBSTR_SCORE;
      }
    }
  }
  rawScore += Math.min(substrTotal, KEYWORD_SUBSTR_CAP);

  // E. 多关键词加成
  if (matchedKeywords.length >= MULTI_KEYWORD_THRESHOLD) {
    rawScore += MULTI_KEYWORD_BONUS;
  }

  return {
    id: cap.id,
    route: cap.route,
    name: cap.name,
    description: cap.description,
    score: Math.min(rawScore, MAX_SCORE),
    matchedKeywords,
  };
}

/**
 * 名称部分匹配：能力名称的某个 2 字子串出现在输入中
 */
function namePartialMatch(input: string, name: string): boolean {
  for (let i = 0; i <= name.length - MIN_KEYWORD_LEN; i++) {
    const segment = name.slice(i, i + MIN_KEYWORD_LEN);
    if (input.includes(segment)) {
      return true;
    }
  }
  return false;
}

/**
 * 对所有能力计算匹配评分，返回按分数降序的前 N 个结果
 */
export function matchCapabilities(
  input: string,
  capabilities: readonly CapabilityInfo[],
  topN = 3,
): CapabilityMatch[] {
  if (!input.trim() || capabilities.length === 0) {
    return [];
  }

  const normalizedInput = input.trim().toLowerCase();

  const results = capabilities
    .map((cap) => scoreCapability(normalizedInput, {
      ...cap,
      name: cap.name.toLowerCase(),
      keywords: cap.keywords.map((k) => k.toLowerCase()),
      exampleQueries: cap.exampleQueries.map((q) => q.toLowerCase()),
    }))
    // 恢复原始 name/description 用于展示
    .map((match, idx) => ({
      ...match,
      name: capabilities[idx].name,
      description: capabilities[idx].description,
    }))
    .sort((a, b) => b.score - a.score);

  return results.slice(0, topN);
}
