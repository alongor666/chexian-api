export interface BranchScope {
  defaultBranch?: string;
  visibleBranches: string[];
  canSwitch: boolean;
  canAggregateAll: boolean;
}

const isBranchCode = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Z]{2}$/.test(value)
);

/**
 * 把认证用户范围压缩为稳定机器契约。只有 branch_admin 才消费 visibleBranches；
 * 其他角色即使误配该字段，也只能看到自己的 branchCode。
 */
export function buildBranchScope(user: {
  role: string;
  branchCode?: string;
  visibleBranches?: unknown[];
}): BranchScope {
  const defaultBranch = isBranchCode(user.branchCode) ? user.branchCode : undefined;
  const configured = user.role === 'branch_admin' && Array.isArray(user.visibleBranches)
    ? [...new Set(user.visibleBranches.filter(isBranchCode))]
    : [];
  const visibleBranches = configured.length > 0
    ? configured
    : (defaultBranch ? [defaultBranch] : []);
  const canSwitch = user.role === 'branch_admin' && visibleBranches.length > 1;
  return {
    defaultBranch,
    visibleBranches,
    canSwitch,
    canAggregateAll: canSwitch,
  };
}
