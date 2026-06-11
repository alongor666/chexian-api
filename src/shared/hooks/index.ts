/**
 * 自定义 Hooks 导出
 */

export { useLoadingStates } from './useLoadingStates';
export type { LoadingStates, UseLoadingStatesReturn } from './useLoadingStates';

export { usePagination, useServerPagination } from './usePagination';
export type {
  PaginationConfig,
  PaginationState,
  UsePaginationReturn,
  ServerPaginationConfig,
} from './usePagination';

// 数据范围标签
export { useScopeLabel } from './useScopeLabel';
export type { ScopeInfo } from './useScopeLabel';

// 可访问性相关 Hooks
export { useFocusTrap, useKeyboardNavigation } from './useFocusTrap';

// 引用稳定化（筛选参数透传防重复请求，治理计划 Task 1-B 评审 🟡3）
export { useStableParams } from './useStableParams';
