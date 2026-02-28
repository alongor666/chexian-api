import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveLossTrendQuery,
  generateComprehensiveSummaryQuery,
} from '../../server/src/sql/comprehensive-analysis';
import { extractOrgNames } from '../../server/src/utils/route-helpers';
import { permissionService } from '../../server/src/services/permission';

describe('comprehensive bundle route contract', () => {
  it('exposes both canonical and alias endpoints in query router', () => {
    const queryRoutePath = path.resolve(process.cwd(), 'server/src/routes/query.ts');
    const content = fs.readFileSync(queryRoutePath, 'utf-8');

    expect(content).toContain("'/comprehensive-bundle'");
    expect(content).toContain("'/comprehensive-analysis-bundle'");
    expect(content).toContain('parseFiltersAndBuildBothWhere(req)');
  });

  it('builds comprehensive summary and dimension SQL with expected fields', () => {
    const summarySql = generateComprehensiveSummaryQuery('1=1', '2026-02-27');
    const orgSql = generateComprehensiveDimensionMetricsQuery({
      dimension: 'org',
      whereClause: '1=1',
      cutoffDate: '2026-02-27',
    });

    expect(summarySql).toContain('AS variable_cost_ratio');
    expect(summarySql).toContain("DATE '2026-02-27'");
    expect(orgSql).toContain("AS dim_type");
    expect(orgSql).toContain('premium_share');
    expect(orgSql).toContain('claim_share');
  });

  it('supports loss trend granularity', () => {
    const dailySql = generateComprehensiveLossTrendQuery('1=1', '2026-02-27', 'daily');
    const monthlySql = generateComprehensiveLossTrendQuery('1=1', '2026-02-27', 'monthly');

    expect(dailySql).toContain('%Y-%m-%d');
    expect(monthlySql).toContain('%Y-%m');
  });

  it('keeps role-based scope behavior aligned with permission filter', () => {
    const branchFilter = permissionService.generatePermissionWhereClause({
      role: 'branch_admin',
      username: 'admin',
    } as any);
    const orgFilter = permissionService.generatePermissionWhereClause({
      role: 'org_user',
      username: 'tianfu',
      organization: '天府',
    } as any);
    const teleFilter = permissionService.generatePermissionWhereClause({
      role: 'telemarketing_user',
      username: 'scdianxiao',
    } as any);

    expect(branchFilter).toBe('1=1');
    expect(orgFilter).toContain("org_level_3 = '天府'");
    expect(teleFilter).toBe('is_telemarketing = true');

    const orgScope = extractOrgNames({}, orgFilter);
    expect(orgScope).toContain('天府');
  });
});

