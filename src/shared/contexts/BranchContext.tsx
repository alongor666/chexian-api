/**
 * 分公司（省）切换上下文 — 全国超管「切省 + 全国合并视图」
 *
 * 仅全国超管（visibleBranches.length > 1）可切省；普通用户 selectedBranch 恒 null，
 * 不向请求注入 targetBranch，行为与上线前完全一致（天然灰度，无需 feature flag）。
 *
 * 切省必清缓存（CRITICAL）：React Query + Service Worker 的 /api/query 缓存都要失效，
 * 否则切到新省后会看到上一个省的残留数据（跨省串读）。后端 RLS 仍是安全边界，
 * 本上下文只负责「请求带对的 targetBranch + 清掉旧省缓存」。
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usePermission } from './PermissionContext';

/** 省份码 → 中文显示名（仅用于下拉文案；省份枚举本身数据驱动来自 visibleBranches） */
const BRANCH_LABELS: Record<string, string> = {
  SC: '四川',
  SX: '山西',
};

/** 省份码显示名（未登记的码回落为码本身，禁臆造） */
export function branchLabel(code: string): string {
  if (code === 'ALL') return '全国';
  return BRANCH_LABELS[code] ?? code;
}

interface BranchContextValue {
  /** 该用户可切换/可合并的省集合（visibleBranches）；普通用户为空数组 */
  branches: string[];
  /** 是否多省（决定是否显示切省下拉） */
  isMultiBranch: boolean;
  /** 当前有效省（'SC'/'SX'/'ALL'）；普通用户为 null。用于下拉高亮当前项 */
  currentBranch: string | null;
  /** 切省（含清 React Query + Service Worker 缓存）。值 ∈ visibleBranches ∪ {'ALL'} */
  setBranch: (branch: string) => void;
}

const BranchContext = createContext<BranchContextValue>({
  branches: [],
  isMultiBranch: false,
  currentBranch: null,
  setBranch: () => {},
});

export const useBranch = () => useContext(BranchContext);

interface BranchProviderProps {
  children: ReactNode;
}

export const BranchProvider: React.FC<BranchProviderProps> = ({ children }) => {
  const { userPermission } = usePermission();
  const queryClient = useQueryClient();

  const branches = useMemo(
    () => userPermission?.visibleBranches ?? [],
    [userPermission?.visibleBranches]
  );
  const isMultiBranch = branches.length > 1;
  const defaultBranch = userPermission?.branchCode ?? null;

  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // 登录/登出/换号时同步默认省：
  //  - 全国超管 → 默认省 = 本人 branchCode，并把 targetBranch 同步给 apiClient；
  //  - 普通用户 → null（不注入 targetBranch，零行为变化）。
  useEffect(() => {
    if (isMultiBranch) {
      setSelectedBranch(defaultBranch);
      apiClient.setTargetBranch(defaultBranch);
    } else {
      setSelectedBranch(null);
      apiClient.setTargetBranch(null);
    }
  }, [isMultiBranch, defaultBranch]);

  const setBranch = useCallback((branch: string) => {
    setSelectedBranch(branch);
    // 1) 请求侧：之后所有 /query/* 与 /filters/* 带 targetBranch（后端按 token 白名单校验）
    apiClient.setTargetBranch(branch);
    // 2) 关闭 in-flight 串读窗口（codex 闸-2 P1-2）：先取消所有在飞的旧省请求 + 旧省 React Query 进行态，
    //    再清缓存。否则旧省（如 SC）请求晚于 clear() 返回，会按同一 query key 回填，界面显示新省数据却来自旧省。
    apiClient.cancelAllRequests();
    queryClient.cancelQueries();
    // 3) 清 React Query 缓存（防上一个省的数据残留）
    queryClient.clear();
    // 4) 清 Service Worker 的 /api/query 缓存（FORCE_REFRESH → clearAndPrefetch 删除全部缓存键）
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FORCE_REFRESH' });
    }
  }, [queryClient]);

  const value = useMemo<BranchContextValue>(
    () => ({ branches, isMultiBranch, currentBranch: selectedBranch, setBranch }),
    [branches, isMultiBranch, selectedBranch, setBranch]
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
};
