/**
 * 自定义 Hooks 导出
 */

export { useLoadingStates } from './useLoadingStates';
export type { LoadingStates, UseLoadingStatesReturn } from './useLoadingStates';

export { useDataFetch, useMultipleDataFetch } from './useDataFetch';
export type { UseDataFetchOptions, UseDataFetchReturn } from './useDataFetch';

export { usePagination, useServerPagination } from './usePagination';
export type {
  PaginationConfig,
  PaginationState,
  UsePaginationReturn,
  ServerPaginationConfig,
} from './usePagination';

// 可访问性相关 Hooks
export { useFocusTrap, useKeyboardNavigation } from './useFocusTrap';
