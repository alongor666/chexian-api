import { useMemo } from 'react';
import type { AdvancedFilterState } from '../types/data';

export interface ScopeInfo {
  /** 标题前缀（如 "天府蒲江团队"） */
  prefix: string;
  /** 当前数据范围层级 */
  level: 'company' | 'org' | 'team' | 'salesman';
}

/**
 * 根据筛选器状态 + 业务员团队映射推导当前数据范围标签
 *
 * 层级规则（从窄到宽）：
 * 1. 单个业务员 → "{机构}{团队}{业务员}"
 * 2. 多个业务员同属一个团队 → "{机构}{团队}团队"
 * 3. 单个机构 → "{机构}"
 * 4. 多机构/全部 → "四川分公司"
 */
export function useScopeLabel(
  filters: AdvancedFilterState,
  salesmanTeamMap: Map<string, string>,
): ScopeInfo {
  return useMemo(() => {
    const orgs = filters.org_level_3 ?? [];
    const salesmen = filters.salesman_name ?? [];

    // 1. 单个业务员 → 显示"机构+团队+业务员"
    if (salesmen.length === 1) {
      const salesman = salesmen[0];
      const team = salesmanTeamMap.get(salesman) ?? '';
      const org = orgs.length === 1 ? orgs[0] : '';
      const prefix = [org, team, salesman].filter(Boolean).join('');
      return { prefix, level: 'salesman' as const };
    }

    // 2. 多业务员同一机构时，检查是否同属一个团队
    if (salesmen.length > 1 && orgs.length === 1) {
      const teamSet = new Set<string>();
      for (const s of salesmen) {
        const t = salesmanTeamMap.get(s);
        if (t) teamSet.add(t);
      }
      if (teamSet.size === 1) {
        const team = Array.from(teamSet)[0];
        return { prefix: `${orgs[0]}${team}团队`, level: 'team' as const };
      }
      return { prefix: orgs[0], level: 'org' as const };
    }

    // 3. 单个机构
    if (orgs.length === 1) {
      return { prefix: orgs[0], level: 'org' as const };
    }

    // 4. 多机构或全部
    return { prefix: '四川分公司', level: 'company' as const };
  }, [filters.org_level_3, filters.salesman_name, salesmanTeamMap]);
}
