/**
 * Query History Hook - 查询历史记录管理
 *
 * 提供 SQL 查询历史记录的存储、检索和管理功能
 */

import { useState, useCallback, useEffect } from 'react';
import type { QueryResult } from '../../shared/types/data';
import { getStorageJson, setStorageJson } from '../../shared/utils/storage';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('QueryHistory');

/**
 * 查询历史记录项
 */
export interface QueryHistoryItem {
  /** 唯一标识 */
  id: string;
  /** SQL 语句 */
  sql: string;
  /** 查询结果摘要 */
  resultSummary: {
    rowCount: number;
    columnCount: number;
    executionTime: number;
  };
  /** 时间戳 */
  timestamp: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 标签/备注 */
  tags?: string[];
}

/**
 * useQueryHistory Hook 配置
 */
export interface UseQueryHistoryOptions {
  /** 最大历史记录数量（默认 50） */
  maxSize?: number;
  /** 是否持久化到 localStorage（默认 true） */
  persist?: boolean;
  /** localStorage 键名（默认 'sql-query-history'） */
  storageKey?: string;
}

/**
 * useQueryHistory Hook 返回值
 */
export interface UseQueryHistoryReturn {
  /** 历史记录列表 */
  history: QueryHistoryItem[];
  /** 添加查询记录 */
  addHistory: (sql: string, result: QueryResult) => void;
  /** 删除指定记录 */
  removeHistory: (id: string) => void;
  /** 清空所有历史 */
  clearHistory: () => void;
  /** 获取指定记录 */
  getHistory: (id: string) => QueryHistoryItem | undefined;
  /** 搜索历史记录 */
  searchHistory: (keyword: string) => QueryHistoryItem[];
  /** 添加标签 */
  addTag: (id: string, tag: string) => void;
  /** 移除标签 */
  removeTag: (id: string, tag: string) => void;
  /** 按日期分组 */
  groupByDate: Record<string, QueryHistoryItem[]>;
}

const STORAGE_KEY = 'sql-query-history';
const MAX_SIZE = 50;

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 格式化日期为字符串
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return '今天';
  } else if (diffDays === 1) {
    return '昨天';
  } else if (diffDays < 7) {
    return `${diffDays} 天前`;
  } else {
    return date.toLocaleDateString('zh-CN');
  }
}

/**
 * 从 localStorage 加载历史记录（使用安全存储）
 */
function loadFromStorage(key: string): QueryHistoryItem[] {
  if (typeof window === 'undefined') return [];
  return getStorageJson<QueryHistoryItem[]>(key, []);
}

/**
 * 保存历史记录到 localStorage（使用安全存储）
 */
function saveToStorage(key: string, history: QueryHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  setStorageJson(key, history);
}

/**
 * Query History Hook
 *
 * @param options 配置选项
 * @returns Hook 返回值
 *
 * @example
 * ```tsx
 * const { history, addHistory, removeHistory, clearHistory } = useQueryHistory({
 *   maxSize: 100,
 *   persist: true
 * });
 *
 * // 添加记录
 * addHistory(sql, queryResult);
 *
 * // 清空历史
 * clearHistory();
 * ```
 */
export function useQueryHistory(options: UseQueryHistoryOptions = {}): UseQueryHistoryReturn {
  const {
    maxSize = MAX_SIZE,
    persist = true,
    storageKey = STORAGE_KEY,
  } = options;

  const [history, setHistory] = useState<QueryHistoryItem[]>(() => {
    return persist ? loadFromStorage(storageKey) : [];
  });

  // 持久化到 localStorage
  useEffect(() => {
    if (persist) {
      saveToStorage(storageKey, history);
    }
  }, [history, persist, storageKey]);

  /**
   * 添加查询记录
   */
  const addHistory = useCallback(
    (sql: string, result: QueryResult) => {
      const newItem: QueryHistoryItem = {
        id: generateId(),
        sql: sql.trim(),
        resultSummary: {
          rowCount: result.rowCount || 0,
          columnCount: result.columnCount || 0,
          executionTime: result.executionTime || 0,
        },
        timestamp: Date.now(),
        success: result.status === 'success',
        error: result.error,
      };

      setHistory((prev) => {
        // 去重：如果相同的 SQL 已存在，删除旧记录
        const filtered = prev.filter((item) => item.sql !== newItem.sql);

        // 添加新记录到开头
        const updated = [newItem, ...filtered];

        // 限制最大数量
        return updated.slice(0, maxSize);
      });
    },
    [maxSize]
  );

  /**
   * 删除指定记录
   */
  const removeHistory = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /**
   * 清空所有历史
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  /**
   * 获取指定记录
   */
  const getHistory = useCallback(
    (id: string): QueryHistoryItem | undefined => {
      return history.find((item) => item.id === id);
    },
    [history]
  );

  /**
   * 搜索历史记录
   */
  const searchHistory = useCallback(
    (keyword: string): QueryHistoryItem[] => {
      if (!keyword.trim()) return history;

      const lowerKeyword = keyword.toLowerCase();
      return history.filter((item) =>
        item.sql.toLowerCase().includes(lowerKeyword) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(lowerKeyword))
      );
    },
    [history]
  );

  /**
   * 添加标签
   */
  const addTag = useCallback((id: string, tag: string) => {
    setHistory((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const tags = item.tags || [];
          return {
            ...item,
            tags: [...new Set([...tags, tag])], // 去重
          };
        }
        return item;
      })
    );
  }, []);

  /**
   * 移除标签
   */
  const removeTag = useCallback((id: string, tag: string) => {
    setHistory((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            tags: (item.tags || []).filter((t) => t !== tag),
          };
        }
        return item;
      })
    );
  }, []);

  /**
   * 按日期分组
   */
  const groupByDate = history.reduce<Record<string, QueryHistoryItem[]>>((acc, item) => {
    const date = formatDate(item.timestamp);
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(item);
    return acc;
  }, {});

  return {
    history,
    addHistory,
    removeHistory,
    clearHistory,
    getHistory,
    searchHistory,
    addTag,
    removeTag,
    groupByDate,
  };
}

/**
 * 导出历史记录为 JSON
 *
 * @param history 历史记录数组
 * @returns JSON 字符串
 */
export function exportHistoryAsJSON(history: QueryHistoryItem[]): string {
  return JSON.stringify(history, null, 2);
}

/**
 * 从 JSON 导入历史记录
 *
 * @param json JSON 字符串
 * @returns 历史记录数组
 */
export function importHistoryFromJSON(json: string): QueryHistoryItem[] {
  try {
    const data = JSON.parse(json);
    if (Array.isArray(data)) {
      return data;
    }
    throw new Error('Invalid format');
  } catch (error) {
    logger.error('导入历史记录失败:', error);
    return [];
  }
}
