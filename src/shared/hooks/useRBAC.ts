import { useCallback } from 'react';
import { usePermission } from '../contexts/PermissionContext';

export function useRBAC() {
    // 改读已挂载的 PermissionContext（AuthContext/AuthProvider 从未挂载到 Provider 树，
    // 旧实现里 useAuth() 恒返回默认值，导致 isOrgUser 恒 false、机构用户作用域全部失效）。
    const { isOrgUser, userPermission } = usePermission();

    const userOrg: string | undefined = userPermission?.organization;
    const canGoToTop = !isOrgUser;

    /**
     * Returns the minimum safe drill-up index to prevent org_users from clearing their organization filter.
     */
    const getMinDrillUpIndex = useCallback((baseIndex: number = 0): number => {
        return isOrgUser ? Math.max(1, baseIndex) : baseIndex;
    }, [isOrgUser]);

    /**
     * Helper to safely merge the rigorous org filter into an existing filter parameter object.
     * This is intended for use in API parameter building to ensure the query is scoped.
     */
    const enforceOrgFilter = useCallback(<T extends Record<string, any>>(params: T): T => {
        if (isOrgUser && userOrg) {
            return {
                ...params,
                org_level_3: userOrg,
                // If there's a legacy `orgFilter` property used by some legacy panels, enforce that too
                ...(params.orgFilter !== undefined ? { orgFilter: userOrg } : {})
            };
        }
        return params;
    }, [isOrgUser, userOrg]);

    return {
        isOrgUser,
        userOrg,
        canGoToTop,
        getMinDrillUpIndex,
        enforceOrgFilter
    };
}
