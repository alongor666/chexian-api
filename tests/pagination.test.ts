/**
 * @vitest-environment jsdom
 */
/**
 * 分页Hook单元测试（简化版）
 *
 * 测试客户端分页功能的核心逻辑
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from '../src/shared/hooks/usePagination';

describe('usePagination (客户端分页)', () => {
  const mockData = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: (i + 1) * 100,
  }));

  it('应该返回第一页数据', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    expect(result.current.currentPageData).toHaveLength(10);
    expect(result.current.currentPageData[0].id).toBe(1);
    expect(result.current.paginationState.currentPage).toBe(1);
  });

  it('应该正确计算总页数', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    expect(result.current.paginationState.totalPages).toBe(10);
    expect(result.current.paginationState.totalItems).toBe(100);
  });

  it('应该能够加载下一页', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    act(() => {
      result.current.loadNextPage();
    });

    expect(result.current.paginationState.currentPage).toBe(2);
    expect(result.current.currentPageData[0].id).toBe(11);
  });

  it('应该能够加载上一页', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10, initialPage: 5 })
    );

    expect(result.current.paginationState.currentPage).toBe(5);

    act(() => {
      result.current.loadPreviousPage();
    });

    expect(result.current.paginationState.currentPage).toBe(4);
  });

  it('应该能够跳转到指定页', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    act(() => {
      result.current.goToPage(5);
    });

    expect(result.current.paginationState.currentPage).toBe(5);
    expect(result.current.currentPageData[0].id).toBe(41);
  });

  it('应该限制页码在有效范围内', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    act(() => {
      result.current.goToPage(0); // 太小
    });

    expect(result.current.paginationState.currentPage).toBe(1);

    act(() => {
      result.current.goToPage(100); // 太大
    });

    expect(result.current.paginationState.currentPage).toBe(10);
  });

  it('应该能够修改每页行数', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    expect(result.current.paginationState.totalPages).toBe(10);

    act(() => {
      result.current.setPageSize(20);
    });

    expect(result.current.paginationState.pageSize).toBe(20);
    expect(result.current.paginationState.totalPages).toBe(5);
    expect(result.current.paginationState.currentPage).toBe(1); // 重置到第一页
  });

  it('应该限制最小每页行数为10', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    act(() => {
      result.current.setPageSize(5); // 小于最小值
    });

    expect(result.current.paginationState.pageSize).toBe(10);
  });

  it('应该能够重置分页', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10, initialPage: 5 })
    );

    expect(result.current.paginationState.currentPage).toBe(5);

    act(() => {
      result.current.resetPagination();
    });

    expect(result.current.paginationState.currentPage).toBe(1);
  });

  it('应该正确判断是否有下一页和上一页', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10, initialPage: 5 })
    );

    expect(result.current.paginationState.hasNextPage).toBe(true);
    expect(result.current.paginationState.hasPreviousPage).toBe(true);

    act(() => {
      result.current.goToPage(1);
    });

    expect(result.current.paginationState.hasPreviousPage).toBe(false);
    expect(result.current.paginationState.hasNextPage).toBe(true);

    act(() => {
      result.current.goToPage(10);
    });

    expect(result.current.paginationState.hasPreviousPage).toBe(true);
    expect(result.current.paginationState.hasNextPage).toBe(false);
  });

  it('应该能够切片大数据集', () => {
    const { result } = renderHook(() =>
      usePagination(mockData, { pageSize: 10 })
    );

    const slicedData = result.current.getDataRange(mockData);
    expect(slicedData).toHaveLength(10);
    expect(slicedData[0].id).toBe(1);
    expect(slicedData[9].id).toBe(10);
  });

  describe('边界情况', () => {
    it('应该处理空数据集', () => {
      const { result } = renderHook(() =>
        usePagination([], { pageSize: 10 })
      );

      expect(result.current.currentPageData).toHaveLength(0);
      expect(result.current.paginationState.totalPages).toBe(0);
      expect(result.current.paginationState.hasNextPage).toBe(false);
      expect(result.current.paginationState.hasPreviousPage).toBe(false);
    });

    it('应该处理少于pageSize的数据', () => {
      const { result } = renderHook(() =>
        usePagination(mockData.slice(0, 5), { pageSize: 10 })
      );

      expect(result.current.currentPageData).toHaveLength(5);
      expect(result.current.paginationState.totalPages).toBe(1);
      expect(result.current.paginationState.hasNextPage).toBe(false);
    });

    it('应该处理正好整除的数据', () => {
      const { result } = renderHook(() =>
        usePagination(mockData.slice(0, 100), { pageSize: 10 })
      );

      expect(result.current.paginationState.totalPages).toBe(10);
    });
  });
});
