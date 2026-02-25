import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface RBACBreadcrumbItem<T = string> {
    level: T;
    label: string;
    value?: string;
}

export function useRBAC() {
    const { user } = useAuth();

    const isOrgUser = user?.role === 'org_user';
    // Use a fallback to ensure we don't crash if organization is missing on the type
    const userOrg: string | undefined = (user as any)?.organization;
    const canGoToTop = !isOrgUser;

    /**
     * Generates the initial breadcrumb stack based on the user's role.
     * Admin: [{ level: fullLevels[0], label: companyLabel }]
     * Org User: [{ level: fullLevels[0], label: companyLabel }, { level: fullLevels[1], label: org, value: org }]
     */
    const getInitialBreadcrumbs = useCallback(<T>(
        fullLevels: T[],
        companyLabel: string = '四川分公司' // Default to typical top-level name
    ): RBACBreadcrumbItem<T>[] => {
        if (!fullLevels || fullLevels.length < 2) return [];

        if (isOrgUser && userOrg) {
            return [
                { level: fullLevels[0], label: companyLabel },
                { level: fullLevels[1], label: userOrg, value: userOrg }
            ];
        }
        return [{ level: fullLevels[0], label: companyLabel }];
    }, [isOrgUser, userOrg]);

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
        getInitialBreadcrumbs,
        getMinDrillUpIndex,
        enforceOrgFilter
    };
}
