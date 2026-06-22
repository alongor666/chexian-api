/**
 * marketing-report / premium-report / filters 分省 RLS 注入纯函数单测（P1 15d8fd）
 *
 * 被测：SalesmanTeamMapping / SalesmanPlanFact 子查询的 branch_code 过滤注入。
 * 不变式：
 *   - 传 rlsBranchCode（'SX'）→ SQL 含 `branch_code = 'SX'` 等值过滤
 *   - 不传（undefined）→ SQL **不含** `branch_code = '`（flag off / 单省 → 字节安全）
 *
 * 注：路由层 resolveBranchRlsCode 的「列存在性 gate b」需 DuckDB，覆盖在集成测试；
 * 本文件只证 SQL 生成器拿到 branchCode 后的注入正确性（纯函数）。
 */
import { describe, it, expect } from 'vitest';
import {
  generateHolidayFreeDrilldownQuery,
  generateSalesmanHolidayDetailQuery,
} from '../marketing-report.js';
import { generateSalesmanPremiumReportQuery } from '../premium-report.js';
import { buildMappingPermissionWhere } from '../../routes/filters.js';

const BRANCH_SX = "branch_code = 'SX'";
// NO_BRANCH 用于"不含任何 branch_code 过滤"断言（包括 tm.branch_code / branch_code 两种形式）
const NO_BRANCH = "branch_code = '";

// ── marketing-report: team_mapping CTE（generateHolidayFreeDrilldownQuery） ──

describe('marketing-report SalesmanTeamMapping 分省 RLS 注入（team_mapping CTE）', () => {
  it('RLS-on: groupBy=team + rlsBranchCode → team_mapping CTE 含 branch_code 过滤', () => {
    const sql = generateHolidayFreeDrilldownQuery(
      '1=1',
      ['2026-02-01'],
      'team',
      [],
      'policy_date',
      'SX',
    );
    expect(sql).toContain(BRANCH_SX);
  });

  it('RLS-on: groupBy=org_level_3 但 drillPath 有 team + rlsBranchCode → 含 branch_code 过滤', () => {
    const sql = generateHolidayFreeDrilldownQuery(
      '1=1',
      ['2026-02-01'],
      'org_level_3',
      [{ dimension: 'team', value: '某团队' }],
      'policy_date',
      'SX',
    );
    expect(sql).toContain(BRANCH_SX);
  });

  it('RLS-off: 不传 rlsBranchCode → 不含 branch_code 过滤（字节安全）', () => {
    const sql = generateHolidayFreeDrilldownQuery(
      '1=1',
      ['2026-02-01'],
      'team',
      [],
      'policy_date',
    );
    expect(sql).not.toContain(NO_BRANCH);
  });

  it('RLS-off: groupBy=org_level_3 且无 team drillPath → 不含 branch_code 过滤', () => {
    const sql = generateHolidayFreeDrilldownQuery(
      '1=1',
      ['2026-02-01'],
      'org_level_3',
      [],
    );
    expect(sql).not.toContain(NO_BRANCH);
  });
});

// ── marketing-report: generateSalesmanHolidayDetailQuery ──

describe('marketing-report generateSalesmanHolidayDetailQuery 分省 RLS（无维度表 JOIN）', () => {
  it('RLS-off: 不含 branch_code（该函数不 JOIN 维度表，字节安全）', () => {
    const sql = generateSalesmanHolidayDetailQuery('1=1', ['2026-02-01']);
    expect(sql).not.toContain(NO_BRANCH);
  });
});

// ── premium-report: SalesmanPlanFact 子查询 ──

describe('premium-report SalesmanPlanFact 分省 RLS 注入', () => {
  it('RLS-on: rlsBranchCode → SalesmanPlanFact 子查询含 branch_code 过滤', () => {
    const sql = generateSalesmanPremiumReportQuery('1=1', 2026, 'SX');
    expect(sql).toContain(BRANCH_SX);
  });

  it('RLS-off: 不传 rlsBranchCode → 不含 branch_code 过滤（字节安全）', () => {
    const sql = generateSalesmanPremiumReportQuery('1=1', 2026);
    expect(sql).not.toContain(NO_BRANCH);
  });
});

// ── filters: buildMappingPermissionWhere 多省扩展 ──

describe('filters buildMappingPermissionWhere 分省 RLS 注入', () => {
  it('RLS-on (branchRlsCode 存在): branch_admin → 含 branch_code 过滤', () => {
    const where = buildMappingPermissionWhere('branch_admin', undefined, 'SX');
    expect(where).toContain(BRANCH_SX);
  });

  it('RLS-on (branchRlsCode 存在): org_user + organization → 含 org 过滤 + branch_code 过滤', () => {
    const where = buildMappingPermissionWhere('org_user', '天府', 'SX');
    expect(where).toContain("organization = '天府'");
    expect(where).toContain(BRANCH_SX);
  });

  it('RLS-on (branchRlsCode 存在): telemarketing_user → 含 branch_code 过滤', () => {
    const where = buildMappingPermissionWhere('telemarketing_user', undefined, 'SX');
    expect(where).toContain(BRANCH_SX);
  });

  it('RLS-off (branchRlsCode 为 undefined): branch_admin → 1=1（字节安全，行为不变）', () => {
    const where = buildMappingPermissionWhere('branch_admin', undefined, undefined);
    expect(where).toBe('1=1');
    expect(where).not.toContain(NO_BRANCH);
  });

  it('RLS-off (branchRlsCode 为 undefined): org_user → 仅 org 过滤，不含 branch_code', () => {
    const where = buildMappingPermissionWhere('org_user', '天府', undefined);
    expect(where).toBe("organization = '天府'");
    expect(where).not.toContain(NO_BRANCH);
  });

  it('SQL 注入防御：organization 中单引号被转义为双单引号，无法提前闭合字符串', () => {
    // 单引号被转义 '' → 注入者无法提前闭合字符串、后续内容仍在字符串值内（不成为 SQL 语句）
    const where = buildMappingPermissionWhere('org_user', "天府'; DROP TABLE--", 'SX');
    // 验证单引号被转义为 '' （两个连续单引号）
    expect(where).toContain("''");
    // 验证完整字符串形如 organization = '天府''; DROP TABLE--' AND branch_code = 'SX'
    // 转义后 DROP TABLE 在字符串值中，不构成独立 SQL 语句
    expect(where).toMatch(/organization = '.*''.*'/);
  });
});
