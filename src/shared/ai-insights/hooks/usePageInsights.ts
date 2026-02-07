/**
 * 页面洞察 Hook
 *
 * 管理 AI 洞察的生成状态、缓存和请求取消
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Insight, RenewalDataContext, UsePageInsightsResult, InsightConfig } from '../types';
import { generateInsights, isInsightConfigured } from '../insight-generator';
import { generateCacheKey } from '../context-builder';

// 内存缓存
interface CacheEntry {
  insights: Insight[];
  tokens?: { prompt: number; completion: number; total: number };
  duration?: number;
  timestamp: number;
}

const insightCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

/**
 * 清理过期缓存
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of insightCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      insightCache.delete(key);
    }
  }
}

/**
 * 页面洞察 Hook
 *
 * @param context - 数据上下文，为 null 时表示数据未就绪
 * @param config - 可选配置
 * @returns 洞察状态和操作函数
 *
 * @example
 * const { insights, status, generate } = usePageInsights(context);
 *
 * return (
 *   <InsightPanel
 *     insights={insights}
 *     loading={status === 'loading'}
 *     onGenerate={generate}
 *   />
 * );
 */
export function usePageInsights(
  context: RenewalDataContext | null,
  config?: InsightConfig
): UsePageInsightsResult {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{ prompt: number; completion: number; total: number } | undefined>();
  const [duration, setDuration] = useState<number | undefined>();

  // AbortController 引用
  const abortControllerRef = useRef<AbortController | null>(null);

  // 缓存 key
  const cacheKey = context ? generateCacheKey(context) : null;

  // 检查缓存
  useEffect(() => {
    if (!cacheKey) return;

    cleanExpiredCache();
    const cached = insightCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setInsights(cached.insights);
      setTokens(cached.tokens);
      setDuration(cached.duration);
      setStatus('success');
      setError(null);
    } else {
      // 上下文变化，重置状态
      setStatus('idle');
      setInsights([]);
      setTokens(undefined);
      setDuration(undefined);
      setError(null);
    }
  }, [cacheKey]);

  /**
   * 生成洞察
   */
  const generate = useCallback(async () => {
    if (!context) {
      setError('数据未就绪');
      return;
    }

    if (!isInsightConfigured()) {
      setError('请先配置智谱 API Key');
      setStatus('error');
      return;
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    setStatus('loading');
    setError(null);

    try {
      const result = await generateInsights(context, config, abortControllerRef.current.signal);

      if (result.success) {
        setInsights(result.insights);
        setTokens(result.tokens);
        setDuration(result.duration);
        setStatus('success');

        // 写入缓存
        if (cacheKey) {
          insightCache.set(cacheKey, {
            insights: result.insights,
            tokens: result.tokens,
            duration: result.duration,
            timestamp: Date.now(),
          });
        }
      } else {
        setError(result.error || '生成失败');
        setStatus('error');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 请求被取消，不更新状态
        return;
      }
      setError(err instanceof Error ? err.message : '未知错误');
      setStatus('error');
    }
  }, [context, config, cacheKey]);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    // 取消进行中的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setInsights([]);
    setStatus('idle');
    setError(null);
    setTokens(undefined);
    setDuration(undefined);

    // 清除当前缓存
    if (cacheKey) {
      insightCache.delete(cacheKey);
    }
  }, [cacheKey]);

  // 组件卸载时取消请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    insights,
    status,
    error,
    generate,
    reset,
    isConfigured: isInsightConfigured(),
    tokens,
    duration,
  };
}
