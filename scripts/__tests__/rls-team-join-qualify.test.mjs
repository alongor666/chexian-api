/**
 * 分省 RLS × 团队维度 JOIN 消歧闸 红/绿 fixture 对照
 * （2026-07-09 生产 Binder Error 防回归 · scripts/governance/rls-team-join-qualify.mjs）
 *
 * 红：人为违规样本 → 必须拦截（≥1 违规）。绿：安全/豁免样本 → 必须放行（零违规）。
 * 末尾集成断言：真实 server/src/sql/** 必须全绿（4 处已修 + claims-heatmap 白名单不回退）。
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  scanRlsTeamJoinSource,
  checkRlsTeamJoinQualify,
} from '../governance/rls-team-join-qualify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

// ---- 红：必须拦截 ----
const RED = {
  '违规A-整体裸where无消歧': `
    export function gen(whereWithoutDate) {
      return \`
        FROM PolicyFact p
        LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
        WHERE \${whereWithoutDate}
      \`;
    }`,
  '违规B-单行回退保留dangling-qualify': `
    import { qualifyBranchCodeColumn } from '../utils/branch-rls-qualify.js';
    export function gen(whereWithoutDate) {
      const pfWhere = qualifyBranchCodeColumn(whereWithoutDate, 'p.'); // 还挂着但没用
      return \`
        FROM PolicyFact p
        LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
        WHERE \${whereWithoutDate}
      \`;
    }`,
  '违规B-baseWhereClause裸注入': `
    import { qualifyBranchCodeColumn } from '../utils/branch-rls-qualify.js';
    export function gen(baseWhereClause) {
      const x = qualifyBranchCodeColumn(baseWhereClause, 'c.');
      return \`
        FROM CrossSellDailyAgg c
        LEFT JOIN SalesmanTeamMapping tm ON c.salesman_name = tm.full_name
        WHERE \${baseWhereClause}
      \`;
    }`,
};

// ---- 绿：必须放行 ----
const GREEN = {
  '安全-改名变量pfWhere': `
    import { qualifyBranchCodeColumn } from '../utils/branch-rls-qualify.js';
    export function gen(whereWithoutDate) {
      const pfWhere = qualifyBranchCodeColumn(whereWithoutDate, 'p.');
      return \`
        FROM PolicyFact p
        LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
        WHERE \${pfWhere}
      \`;
    }`,
  '安全-构造期消歧fullWhere': `
    import { qualifyBranchCodeColumn } from '../utils/branch-rls-qualify.js';
    export function gen(baseWhereClause) {
      const fullWhere = [qualifyBranchCodeColumn(baseWhereClause, 'c.')].join(' AND ');
      return \`
        FROM CrossSellDailyAgg c
        LEFT JOIN SalesmanTeamMapping tm ON c.salesman_name = tm.full_name
        WHERE \${fullWhere}
      \`;
    }`,
  '安全-CTE别名非实体表': `
    export function gen(baseWhereClause) {
      return \`
        WITH team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)
        SELECT * FROM CrossSellDailyAgg c
        LEFT JOIN team_mapping tm ON c.salesman_name = tm.full_name
        WHERE \${baseWhereClause}
      \`;
    }`,
  '安全-互斥分支裸where在无JOIN侧': `
    import { qualifyBranchCodeColumn } from '../utils/branch-rls-qualify.js';
    export function gen(baseWhereClause, usePF) {
      const pfWhere = qualifyBranchCodeColumn(baseWhereClause, 'p.');
      return usePF ? \`
        FROM PolicyFact p
        LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
        WHERE \${pfWhere}
      \` : \`
        FROM CrossSellDailyAgg
        WHERE \${baseWhereClause}
      \`;
    }`,
  '安全-逃生阀marker豁免': `
    // governance-allow: rls-team-join #997 走 eligible_policies CTE 不投影 branch_code，无二义
    export function gen(whereWithoutDate) {
      return \`
        FROM eligible_policies p
        LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
        WHERE \${whereWithoutDate}
      \`;
    }`,
  '安全-注释里提到JOIN不算': `
    // 说明：团队维度会 LEFT JOIN SalesmanTeamMapping tm 并可能撞裸 branch_code
    export function gen(baseWhereClause) {
      return \`FROM CrossSellDailyAgg WHERE \${baseWhereClause}\`;
    }`,
};

describe('rls-team-join-qualify 红/绿 fixture', () => {
  for (const [name, src] of Object.entries(RED)) {
    it(`红：${name} → 拦截`, () => {
      const v = scanRlsTeamJoinSource('fixture.ts', src);
      expect(v.length).toBeGreaterThanOrEqual(1);
    });
  }
  for (const [name, src] of Object.entries(GREEN)) {
    it(`绿：${name} → 放行`, () => {
      const v = scanRlsTeamJoinSource('fixture.ts', src);
      expect(v).toEqual([]);
    });
  }
});

describe('rls-team-join-qualify 真实代码集成', () => {
  it('真实 server/src/sql/** 全绿（4 处已修 + claims-heatmap 白名单不回退）', () => {
    const noop = () => {};
    const ok = checkRlsTeamJoinQualify({ rootDir: ROOT_DIR, io: { info: noop, success: noop, error: noop } });
    expect(ok).toBe(true);
  });
});
