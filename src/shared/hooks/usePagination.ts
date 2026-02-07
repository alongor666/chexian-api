/**
 * 分页加载Hook
 *
 * 用于大数据集的分页加载，避免一次性加载全部数据
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createLogger } from '../utils/logger';

const logger = createLogger('usePagination');

export interface PaginationConfig {
  /** 每页行数 */
  pageSize?: number;
  /** 初始页码 */
  initialPage?: number;
  /** 是否自动加载下一页（滚动到底部时） */
  autoLoadNext?: boolean;
  /** 触发自动加载的阈值（距离底部多少行时触发） */
  loadThreshold?: number;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface UsePaginationReturn<T> {
  /** 当前页数据 */
  currentPageData: T[];
  /** 分页状态 */
  paginationState: PaginationState;
  /** 加载下一页 */
  loadNextPage: () => void;
  /** 加载上一页 */
  loadPreviousPage: () => void;
  /** 跳转到指定页 */
  goToPage: (page: number) => void;
  /** 设置每页行数 */
  setPageSize: (size: number) => void;
  /** 重置分页 */
  resetPagination: () => void;
  /** 处理滚动事件（用于自动加载） */
  handleScroll: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  /** 获取显示的数据范围（用于切片大数据集） */
  getDataRange: (allData: T[]) => T[];
}

/**
 * 分页Hook
 */
export function usePagination<T>(
  allData: T[],
  config: PaginationConfig = {}
): UsePaginationReturn<T> {
  const {
    pageSize = 100,
    initialPage = 1,
    autoLoadNext = false,
    loadThreshold = 10,
  } = config;

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const loadingNextRef = useRef(false);

  const totalItems = allData.length;
  const totalPages = Math.ceil(totalItems / currentPageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPreviousPage = currentPage > 1;

  // 计算当前页数据范围
  const getDataRange = useCallback(
    (data: T[]): T[] => {
      const startIndex = (currentPage - 1) * currentPageSize;
      const endIndex = startIndex + currentPageSize;
      return data.slice(startIndex, endIndex);
    },
    [currentPage, currentPageSize]
  );

  // 当前页数据
  const currentPageData = getDataRange(allData);

  // 加载下一页
  const loadNextPage = useCallback(() => {
    if (hasNextPage && !loadingNextRef.current) {
      loadingNextRef.current = true;
      setCurrentPage(prev => prev + 1);
      logger.debug('Loading next page', { newPage: currentPage + 1 });

      // 防止快速连续加载
      setTimeout(() => {
        loadingNextRef.current = false;
      }, 300);
    }
  }, [hasNextPage, currentPage]);

  // 加载上一页
  const loadPreviousPage = useCallback(() => {
    if (hasPreviousPage) {
      setCurrentPage(prev => prev - 1);
      logger.debug('Loading previous page', { newPage: currentPage - 1 });
    }
  }, [hasPreviousPage, currentPage]);

  // 跳转到指定页
  const goToPage = useCallback(
    (page: number) => {
      const validPage = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(validPage);
      logger.debug('Go to page', { page: validPage });
    },
    [totalPages]
  );

  // 设置每页行数
  const setPageSize = useCallback((size: number) => {
    const newSize = Math.max(10, size); // 最小10行
    setCurrentPageSize(newSize);
    setCurrentPage(1); // 重置到第一页
    logger.debug('Page size changed', { newSize });
  }, []);

  // 重置分页
  const resetPagination = useCallback(() => {
    setCurrentPage(1);
    logger.debug('Pagination reset');
  }, []);

  // 处理滚动事件（自动加载下一页）
  const handleScroll = useCallback(
    (scrollTop: number, scrollHeight: number, clientHeight: number) => {
      if (!autoLoadNext || !hasNextPage || loadingNextRef.current) {
        return;
      }

      // 计算距离底部的距离
      const distanceToBottom = scrollHeight - clientHeight - scrollTop;
      const thresholdInPixels = loadThreshold * 40; // 假设每行约40px

      if (distanceToBottom < thresholdInPixels) {
        logger.debug('Auto-loading next page', { distanceToBottom });
        loadNextPage();
      }
    },
    [autoLoadNext, hasNextPage, loadThreshold, loadNextPage]
  );

  const paginationState: PaginationState = {
    currentPage,
    pageSize: currentPageSize,
    totalPages,
    totalItems,
    hasNextPage,
    hasPreviousPage,
  };

  return {
    currentPageData,
    paginationState,
    loadNextPage,
    loadPreviousPage,
    goToPage,
    setPageSize,
    resetPagination,
    handleScroll,
    getDataRange,
  };
}

/**
 * 增强型分页Hook（支持服务器端分页）
 */
export interface ServerPaginationConfig {
  pageSize?: number;
  initialPage?: number;
  fetchPage: (page: number, pageSize: number) => Promise<{ data: any[]; total: number }>;
}

export function useServerPagination(config: ServerPaginationConfig) {
  const { pageSize = 100, initialPage = 1, fetchPage } = config;

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [data, setData] = useState<any[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const totalPages = Math.ceil(totalItems / currentPageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPreviousPage = currentPage > 1;

  // 获取指定页数据
  const fetchPageData = useCallback(
    async (page: number) => {
      setLoading(true);
      setError(null);

      try {
        logger.debug('Fetching page', { page, pageSize: currentPageSize });
        const result = await fetchPage(page, currentPageSize);
        setData(result.data);
        setTotalItems(result.total);
        setCurrentPage(page);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch page');
        setError(error);
        logger.error('Failed to fetch page', { page, error });
      } finally {
        setLoading(false);
      }
    },
    [currentPageSize, fetchPage]
  );

  // 加载下一页
  const loadNextPage = useCallback(() => {
    if (hasNextPage && !loading) {
      fetchPageData(currentPage + 1);
    }
  }, [hasNextPage, loading, currentPage, fetchPageData]);

  // 加载上一页
  const loadPreviousPage = useCallback(() => {
    if (hasPreviousPage && !loading) {
      fetchPageData(currentPage - 1);
    }
  }, [hasPreviousPage, loading, currentPage, fetchPageData]);

  // 跳转到指定页
  const goToPage = useCallback(
    (page: number) => {
      const validPage = Math.max(1, Math.min(page, totalPages));
      fetchPageData(validPage);
    },
    [totalPages, fetchPageData]
  );

  // 设置每页行数
  const setPageSize = useCallback((size: number) => {
    const newSize = Math.max(10, size);
    setCurrentPageSize(newSize);
    fetchPageData(1); // 重置到第一页
  }, [fetchPageData]);

  // 重置分页
  const resetPagination = useCallback(() => {
    fetchPageData(1);
  }, [fetchPageData]);

  // 初始加载
  useEffect(() => {
    fetchPageData(initialPage);
  }, []);

  const paginationState: PaginationState = {
    currentPage,
    pageSize: currentPageSize,
    totalPages,
    totalItems,
    hasNextPage,
    hasPreviousPage,
  };

  return {
    data,
    paginationState,
    loading,
    error,
    loadNextPage,
    loadPreviousPage,
    goToPage,
    setPageSize,
    resetPagination,
  };
}
